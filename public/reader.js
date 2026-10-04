import { buildCardCandidates, pickCard, sharedNoteIdSet } from "./card-logic.js";
import { groupAnnotationRanges } from "./annotation-layout.js";

const state = {
  books: [],
  chunks: [],
  annotations: [],
  bookId: null,
  chunkId: null,
  chunk: null,
  quote: "",
  quoteOffset: null,
  selectedQuote: "",
  selectedQuoteOffset: null,
  activeAnnotationId: null,
  cardCandidates: [],
  cardIndex: 0,
  lastFinish: null,
  toastTimer: null,
  refreshInFlight: false,
  composing: false,
  replyDrafts: {},
};

const $ = (id) => document.getElementById(id);
const authTokenKey = "co-reading-auth-token";
const urlToken = new URLSearchParams(location.search).get("token");
if (urlToken) {
  localStorage.setItem(authTokenKey, urlToken);
  history.replaceState(null, "", location.pathname);
}

async function api(path, options = {}) {
  const token = localStorage.getItem(authTokenKey);
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(translateError(data.error || response.statusText));
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Light Markdown-ish formatting for annotation bodies (zero dependencies). */
function formatNote(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("无法读取文件，请重新选择"));
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result);
      let binary = "";
      const size = 0x8000;
      for (let index = 0; index < bytes.length; index += size) {
        binary += String.fromCharCode(...bytes.subarray(index, index + size));
      }
      resolve(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  });
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function scrollToPanel(selector) {
  if (!isMobileLayout()) return;
  requestAnimationFrame(() => {
    document.querySelector(selector)?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  state.toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 2400);
}

function formatIdentity(author) {
  const value = String(author || "unknown").toLowerCase();
  if (["user", "human", "you", "koshi"].includes(value)) return "你";
  if (value === "claude" || value === "assistant") return "共读伙伴";
  return value === "unknown" ? "未知作者" : value;
}

function formatKind(kind) {
  return ({ note: "批注", reply: "回复", annotation: "批注", resonance: "共鸣", feeling: "感受", question: "提问", summary: "小结", thought: "想法" })[kind] || kind;
}

function formatStatus(status) {
  return ({ open: "未分享", submitted: "已分享", published: "已发布" })[status] || status;
}

function translateError(message) {
  const text = String(message || "操作失败，请稍后重试。");
  const known = {
    Unauthorized: "登录已失效，请使用带登录凭证的书屋链接重新打开。",
    Forbidden: "没有访问权限，请检查登录状态。",
    "Not found": "找不到请求的内容，请刷新书库。",
    "Not Found": "找不到请求的内容，请刷新书库。",
    "Failed to fetch": "网络连接失败，请检查网络后重试。",
    "Load failed": "网络连接失败，请检查网络后重试。",
    "NetworkError when attempting to fetch resource.": "网络连接失败，请检查网络后重试。",
    "Unsupported import format. Use EPUB or TXT.": "不支持此文件格式，请选择 EPUB、TXT 或 Markdown 文件。",
    "Imported file is empty": "文件内容为空，请重新选择。",
    "No books imported yet": "书库里还没有书，请先点击＋导入。",
    "dataBase64 is required": "没有收到文件内容，请重新上传。",
    "dataBase64 is not valid base64": "上传的文件内容无效，请重新上传。",
    "Import script failed": "导入失败，请检查文件是否完整。",
    "Content-Type must be application/json": "上传请求格式不正确，请刷新页面后重试。",
    "Internal Server Error": "服务器暂时无法完成操作，请稍后重试。",
    "Bad Gateway": "书屋暂时无法连接，请稍后重试。",
    "Service Unavailable": "书屋暂时不可用，请稍后重试。",
    "Gateway Timeout": "连接书屋超时，请稍后重试。",
  };
  if (known[text]) return known[text];
  if (/^(Imported file exceeds|Request body exceeds) \d+ bytes$/.test(text)) return "文件过大，请选择较小的文件后重试。";
  if (text.startsWith("Book already exists:")) return "书库中已有这本书，请先检查现有书籍。";
  if (text.startsWith("Unknown bookId:")) return "找不到这本书，请刷新书库。";
  if (text.startsWith("Unknown chunkId")) return "找不到这个章节，请刷新书库。";
  if (/Unexpected (token|end)|JSON\.parse/.test(text)) return "服务器返回的内容无法读取，请刷新页面或稍后重试。";
  return /\p{Script=Han}/u.test(text) ? text : "操作失败，请检查网络或文件后重试。";
}

function annotationAuthorClass(author) {
  return ["claude", "assistant"].includes(String(author || "").trim().toLowerCase())
    ? "author-partner"
    : "author-human";
}

function replyClass(reply, root) {
  const sameAuthor = String(reply.author || "").toLowerCase() === String(root.author || "").toLowerCase();
  return sameAuthor ? "reply root-author" : "reply other-author";
}

function repliesFor(parentId, notes) {
  return notes.filter((item) => item.parentId === parentId);
}

function replyCount(parentId, notes, seen = new Set()) {
  if (seen.has(parentId)) return 0;
  seen.add(parentId);
  return repliesFor(parentId, notes).reduce((count, reply) => count + 1 + replyCount(reply.id, notes, seen), 0);
}

function renderReply(reply, root, notes, depth = 1, seen = new Set()) {
  if (!reply.id || seen.has(reply.id)) return "";
  const nextSeen = new Set(seen);
  nextSeen.add(reply.id);
  const children = repliesFor(reply.id, notes);
  const visibleDepth = Math.min(depth, 4);
  return `<div class="${replyClass(reply, root)} ${annotationAuthorClass(reply.author)}" style="--reply-depth: ${visibleDepth}">
    <p class="reply-body">${formatNote(reply.note)}</p>
    <div class="note-meta">${escapeHtml(formatIdentity(reply.author))} · ${escapeHtml(formatKind(reply.kind || "reply"))}</div>
    ${
      children.length
        ? `<div class="reply-children">${children
            .map((child) => renderReply(child, root, notes, depth + 1, nextSeen))
            .join("")}</div>`
        : ""
    }
  </div>`;
}

function renderThread(note, notes) {
  const replies = repliesFor(note.id, notes);
  const draft = state.replyDrafts[note.id] || "";
  return `<div class="thread">
    ${replies.map((reply) => renderReply(reply, note, notes, 1, new Set([note.id]))).join("")}
    <form class="reply-form" data-parent-id="${escapeHtml(note.id)}">
      <textarea rows="2" placeholder="在这里回复批注……" aria-label="回复内容">${escapeHtml(draft)}</textarea>
      <button type="submit" class="primary-button">回复</button>
    </form>
  </div>`;
}

function renderInlineNote(note, notes) {
  return `<aside class="inline-note ${annotationAuthorClass(note.author)}" data-note-id="${escapeHtml(note.id)}">
    <p class="inline-note-kicker">${escapeHtml(formatIdentity(note.author))} · ${escapeHtml(formatKind(note.kind || "note"))}</p>
    <p class="note-body">${formatNote(note.note)}</p>
    ${renderThread(note, notes)}
  </aside>`;
}

function renderBooks() {
  $("books").innerHTML = state.books
    .map((book) => {
      const total = book.chunkCount || 0;
      const read = book.chunksRead || 0;
      const pct = total ? Math.round((read / total) * 100) : 0;
      return `<div class="book-row ${book.bookId === state.bookId ? "active" : ""}">
        <button class="book" data-book="${escapeHtml(book.bookId)}">
          <span class="book-title">${escapeHtml(book.title || book.bookId)}</span>
          <span class="book-meta">${escapeHtml(book.author || "未知作者")} · ${read}/${total} · ${book.annotationCount || 0} 条批注</span>
          <span class="progress"><span style="width: ${pct}%"></span></span>
        </button>
        <button class="book-delete" data-delete-book="${escapeHtml(book.bookId)}" title="从书库移除这本书">移除</button>
      </div>`;
    })
    .join("");
}

function renderChunks() {
  $("chunks").innerHTML = state.chunks
    .map(
      (chunk) => `<button class="chunk ${chunk.id === state.chunkId ? "active" : ""}" data-chunk="${escapeHtml(chunk.id)}">
        <span class="chunk-title">${escapeHtml(chunk.title)}</span>
        <span class="chunk-meta">${escapeHtml(chunk.id)} · ${chunk.read ? "已读" : "未读"} · ${chunk.annotationCount || 0} 条批注</span>
      </button>`,
    )
    .join("");
}

function renderText() {
  if (!state.chunk) return;
  const text = state.chunk.text || "";
  const notes = state.annotations.filter((item) => item.chunkId === state.chunkId);
  const sharedIds = sharedNoteIdSet(notes);
  const groups = groupAnnotationRanges(text, notes);
  let html = "";
  let cursor = 0;
  for (const group of groups) {
    const active = group.notes.find(note => note.id === state.activeAnnotationId);
    const lead = active || group.notes[0];
    const shared = group.notes.some(note => sharedIds.has(note.id));
    html += escapeHtml(text.slice(cursor, group.start));
    const quote = escapeHtml(text.slice(group.start, group.end));
    const bookmark = shared ? '<span class="shared-bookmark" title="这里有两个人的折痕。">此处有回声</span>' : "";
    html += `<mark class="${annotationAuthorClass(lead.author)} ${active ? "active" : ""} ${shared ? "shared" : ""}" data-note-id="${escapeHtml(lead.id)}" title="${escapeHtml(lead.note)}">${quote}</mark>${bookmark}`;
    if (active) html += group.notes.map(note => renderInlineNote(note, notes)).join("");
    cursor = group.end;
  }
  html += escapeHtml(text.slice(cursor));
  $("text").innerHTML = html.replace(/\n{2,}/g, (breaks) => `<span class="paragraph-break">${breaks}</span>`);
  bindMarkActions();
}

function bindMarkActions() {
  document.querySelectorAll("mark[data-note-id]").forEach((mark) => {
    const open = (event) => {
      event.stopPropagation();
      activateAnnotation(mark.dataset.noteId, { scroll: true });
    };
    mark.addEventListener("click", open);
    mark.addEventListener("touchend", open);
  });
}

function renderAnnotations() {
  const notes = state.annotations.filter((item) => item.chunkId === state.chunkId);
  const roots = notes.filter((item) => !item.parentId);
  const openCount = state.annotations.filter((item) => item.author === "user" && (item.status || "open") === "open")
    .length;

  $("margins").innerHTML = roots
    .map((note) => {
      const replies = replyCount(note.id, notes);
      const expanded = note.id === state.activeAnnotationId;
      const isShared = sharedNoteIdSet(notes).has(note.id);
      return `<article class="note-card ${annotationAuthorClass(note.author)} ${(note.status || "") === "open" ? "open" : ""} ${expanded ? "active" : ""}" data-note-id="${escapeHtml(note.id)}" tabindex="0">
        ${isShared ? `<p class="shared-line">这里有两个人的折痕。</p>` : ""}
        <p class="note-quote">${escapeHtml(note.quote)}</p>
        <p class="note-body">${formatNote(note.note)}</p>
        <div class="note-meta">${escapeHtml(formatIdentity(note.author))} · ${escapeHtml(formatKind(note.kind || "note"))} · ${escapeHtml(formatStatus(note.status || "published"))}${replies ? ` · ${replies} 条回复` : ""}</div>
        ${
          expanded
            ? renderThread(note, notes)
            : ""
        }
      </article>`;
    })
    .join("");

  $("submit-notes").disabled = openCount === 0;
  $("submit-notes").textContent = openCount ? `分享 ${openCount} 条批注` : "分享批注";
  $("status").textContent = openCount
    ? `有 ${openCount} 条未分享的批注。`
    : "批注先保存在书屋，分享后共读伙伴才能读取。";
}

function currentBook() {
  return state.books.find((item) => item.bookId === state.bookId) || {};
}

function currentChunkMeta() {
  return state.chunks.find((item) => item.id === state.chunkId) || state.chunk?.chunk || {};
}

function refreshCards({ finish = null, show = false } = {}) {
  const chunkAnnotations = state.annotations.filter((item) => item.chunkId === state.chunkId);
  state.cardCandidates = buildCardCandidates({
    book: currentBook(),
    chunk: { ...currentChunkMeta(), text: state.chunk?.text || "" },
    annotations: chunkAnnotations,
    finish,
  });
  if (state.cardIndex >= state.cardCandidates.length) state.cardIndex = 0;
  $("show-card").disabled = state.cardCandidates.length === 0;
  $("show-card").textContent = state.cardCandidates.length ? `书签卡片 ${state.cardCandidates.length}` : "书签卡片";
  if (show && state.cardCandidates.length) {
    openCardPanel();
  } else {
    renderCardPanel();
  }
}

function renderCardPanel() {
  const card = pickCard(state.cardCandidates, state.cardIndex);
  $("card-panel").hidden = !card || $("card-panel").hidden;
  if (!card) {
    $("card-preview").innerHTML = "";
    return;
  }
  $("card-preview").innerHTML = renderReadingCard(card);
}

function seededRandom(seed) {
  let value = (Number(seed) || 1) >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function readingCardArt(card) {
  const random = seededRandom(card.artSeed || 1);
  if (card.art === "ripple") {
    const centers = [
      [25 + random() * 18, 20 + random() * 18],
      [58 + random() * 18, 48 + random() * 18],
      [22 + random() * 14, 72 + random() * 12],
    ];
    const circles = centers
      .flatMap(([cx, cy], groupIndex) =>
        Array.from({ length: groupIndex === 1 ? 4 : 3 }, (_, index) => {
          const radius = 8 + index * (6 + random() * 3) + random() * 2;
          const opacity = 0.035 + random() * 0.06;
          return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" opacity="${opacity.toFixed(3)}" />`;
        }),
      )
      .join("");
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="0.36">${circles}</g></svg>`;
  }
  if (card.art === "stardust") {
    const dots = Array.from({ length: 64 }, () => {
      const cx = 7 + random() * 86;
      const cy = 8 + random() * 80;
      const radius = 0.08 + random() * 0.24;
      const opacity = 0.18 + random() * 0.42;
      return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" opacity="${opacity.toFixed(3)}" />`;
    }).join("");
    const bright = Array.from({ length: 7 }, () => {
      const cx = 12 + random() * 76;
      const cy = 12 + random() * 72;
      const opacity = 0.22 + random() * 0.26;
      return `<path d="M ${(cx - 0.9).toFixed(2)} ${cy.toFixed(2)} L ${(cx + 0.9).toFixed(2)} ${cy.toFixed(2)} M ${cx.toFixed(2)} ${(cy - 0.9).toFixed(2)} L ${cx.toFixed(2)} ${(cy + 0.9).toFixed(2)}" opacity="${opacity.toFixed(3)}" />`;
    }).join("");
    const lines = Array.from({ length: 5 }, () => {
      const x1 = 8 + random() * 84;
      const y1 = 10 + random() * 76;
      const x2 = x1 + (random() - 0.5) * 12;
      const y2 = y1 + (random() - 0.5) * 12;
      return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}" opacity="0.07" />`;
    }).join("");
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g fill="currentColor">${dots}</g><g fill="none" stroke="currentColor" stroke-width="0.14">${lines}${bright}</g></svg>`;
  }
  const lines = Array.from({ length: 14 }, () => {
    const x = 8 + random() * 84;
    const drift = (random() - 0.5) * 10;
    const opacity = 0.06 + random() * 0.14;
    return `<path d="M ${x.toFixed(2)} 3 C ${(x + drift).toFixed(2)} 30 ${(x - drift).toFixed(2)} 62 ${x.toFixed(2)} 97" opacity="${opacity.toFixed(3)}" />`;
  }).join("");
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="0.32">${lines}</g></svg>`;
}

function renderReadingCard(card) {
  return `<article class="ritual-card ${escapeHtml(card.variant)} art-${escapeHtml(card.art || "fold")} ${escapeHtml(cardSizeClass(card))}">
    <div class="card-art">${readingCardArt(card)}</div>
    <div class="card-content">
      <p class="card-kicker">${escapeHtml(card.kicker)}</p>
      <h3>${escapeHtml(card.title)}</h3>
      <p class="card-subtitle">${escapeHtml(card.subtitle)}</p>
      <blockquote>${escapeHtml(card.quote)}</blockquote>
      <div class="card-voices ${card.rightText ? "" : "single"}">
        <section>
          <span>${escapeHtml(card.leftLabel)}</span>
          <p>${escapeHtml(card.leftText)}</p>
        </section>
        ${
          card.rightText
            ? `<section>
                <span>${escapeHtml(card.rightLabel)}</span>
                <p>${escapeHtml(card.rightText)}</p>
              </section>`
            : ""
        }
      </div>
      <footer>${escapeHtml(card.footer)}</footer>
    </div>
  </article>`;
}

function cardSizeClass(card) {
  const totalLength = [card.quote, card.leftText, card.rightText, card.note]
    .filter(Boolean)
    .join("")
    .length;
  if (totalLength < 120) return "card-compact";
  if (totalLength > 360) return "card-tall";
  return "card-standard";
}

function openCardPanel() {
  if (!state.cardCandidates.length) return;
  $("card-panel").hidden = false;
  renderCardPanel();
}

function updateSelectionAction() {
  const selection = window.getSelection();
  const details = selectionDetails(selection);
  state.selectedQuote = details?.quote || "";
  state.selectedQuoteOffset = details?.quoteOffset ?? null;
  $("note-selection").disabled = !state.selectedQuote || !state.bookId || !state.chunkId;
}

function elementForNode(node) {
  return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + Math.max(needle.length, 1);
  }
  return count;
}

function findOccurrence(haystack, needle, occurrence) {
  let index = -1;
  let from = 0;
  for (let current = 0; current <= occurrence; current += 1) {
    index = haystack.indexOf(needle, from);
    if (index === -1) return -1;
    from = index + Math.max(needle.length, 1);
  }
  return index;
}

function selectionDetails(selection) {
  if (!selection || selection.rangeCount === 0 || !state.chunk?.text) return null;
  const rawQuote = selection.toString();
  const quote = rawQuote.trim();
  if (!quote) return null;

  const range = selection.getRangeAt(0);
  const textEl = $("text");
  const startEl = elementForNode(range.startContainer);
  const endEl = elementForNode(range.endContainer);
  if (!startEl || !endEl) return null;
  if (!textEl.contains(range.commonAncestorContainer) || !textEl.contains(startEl) || !textEl.contains(endEl)) return null;
  if (startEl.closest(".inline-note, .shared-bookmark") || endEl.closest(".inline-note, .shared-bookmark")) return null;

  const prefixRange = range.cloneRange();
  prefixRange.selectNodeContents(textEl);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const occurrence = countOccurrences(prefixRange.toString(), quote);
  const quoteOffset = findOccurrence(state.chunk.text, quote, occurrence);
  return {
    quote,
    quoteOffset: quoteOffset >= 0 ? quoteOffset : null,
  };
}

async function loadBooks() {
  state.books = await api("/api/books");
  renderBooks();
}

async function selectBook(bookId) {
  state.bookId = bookId;
  state.chunkId = null;
  state.chunk = null;
  state.activeAnnotationId = null;
  state.replyDrafts = {};
  state.chunks = await api(`/api/books/${encodeURIComponent(bookId)}/chunks`);
  state.annotations = await api(`/api/annotations?bookId=${encodeURIComponent(bookId)}`);
  const book = state.books.find((item) => item.bookId === bookId);
  $("book-meta").textContent = book?.author || "未知作者";
  $("book-title").textContent = book?.title || bookId;
  $("chunk-file").textContent = "尚未选择章节";
  $("chunk-title").textContent = "打开章节，开始共读";
  $("text").innerHTML = `<p class="empty">请选择章节。选中文字，就能写下你的批注。</p>`;
  $("mark-read").disabled = true;
  $("continue-reading").disabled = false;
  document.body.classList.add("has-book");
  document.body.classList.remove("has-chunk");
  renderBooks();
  renderChunks();
  renderAnnotations();
  scrollToPanel(".chapters");
}

function clearBookSelection() {
  state.bookId = null;
  state.chunkId = null;
  state.chunk = null;
  state.annotations = [];
  state.chunks = [];
  state.activeAnnotationId = null;
  state.cardCandidates = [];
  state.replyDrafts = {};
  $("book-meta").textContent = "请选择一本书";
  $("book-title").textContent = "阅读书架";
  $("chunk-file").textContent = "尚未选择章节";
  $("chunk-title").textContent = "打开章节，开始共读";
  $("text").innerHTML = `<p class="empty">请选择书籍和章节。选中文字，就能写下你的批注。</p>`;
  $("mark-read").disabled = true;
  $("continue-reading").disabled = true;
  $("show-card").disabled = true;
  document.body.classList.remove("has-book", "has-chunk");
  renderChunks();
  renderAnnotations();
}

async function deleteBookFromShelf(bookId) {
  const book = state.books.find((item) => item.bookId === bookId);
  const label = book?.title || bookId;
  if (!confirm(`确定从书库移除《${label}》吗？\n\n书籍及相关批注、进度和卡片将移入回收站，默认保留 30 天。`)) return;

  const result = await api(`/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
  $("status").textContent = `已将《${label}》移入回收站。`;
  await loadBooks();
  if (state.bookId === bookId) clearBookSelection();
  renderBooks();
}

async function selectChunk(chunkId) {
  state.chunkId = chunkId;
  state.activeAnnotationId = null;
  state.chunk = await api(`/api/books/${encodeURIComponent(state.bookId)}/chunks/${encodeURIComponent(chunkId)}`);
  state.lastFinish = null;
  $("chunk-file").textContent = state.chunk.chunk.id;
  $("chunk-title").textContent = state.chunk.chunk.title;
  $("mark-read").disabled = false;
  $("continue-reading").disabled = false;
  document.body.classList.add("has-chunk");
  renderChunks();
  renderText();
  renderAnnotations();
  refreshCards();
  scrollToPanel(".reader");
}

function syncNoteViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty("--note-viewport-top", `${viewport?.offsetTop || 0}px`);
  document.documentElement.style.setProperty("--note-viewport-height", `${viewport?.height || window.innerHeight}px`);
}

window.visualViewport?.addEventListener("resize", syncNoteViewport);
window.visualViewport?.addEventListener("scroll", syncNoteViewport);
window.addEventListener("resize", syncNoteViewport);

function closeNoteForm() {
  $("note").blur();
  $("note-form").hidden = true;
  document.body.classList.remove("note-open");
}

function openNoteForm(quote) {
  state.quote = quote.trim();
  state.quoteOffset = state.selectedQuote === state.quote ? state.selectedQuoteOffset : null;
  if (!state.bookId || !state.chunkId || !state.quote) return;
  $("quote-preview").textContent = state.quote;
  $("note").value = "";
  $("note-form").hidden = false;
  document.body.classList.add("note-open");
  syncNoteViewport();
  $("note").focus({ preventScroll: true });
}

function activateAnnotation(noteId, { scroll = false } = {}) {
  state.activeAnnotationId = noteId;
  renderText();
  renderAnnotations();
  if (scroll) {
    document.querySelector(`.inline-note[data-note-id="${CSS.escape(noteId)}"], .note-card[data-note-id="${CSS.escape(noteId)}"]`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }
}

function isEditingDraft() {
  const active = document.activeElement;
  return Boolean(
    state.composing ||
      active?.matches?.("textarea, input") ||
      active?.closest?.(".reply-form, .note-form"),
  );
}

async function refreshCurrent({ force = false } = {}) {
  if (state.refreshInFlight) return;
  if (!force && isEditingDraft()) return;
  state.refreshInFlight = true;
  try {
    await loadBooks();
    if (state.bookId) {
      if (!state.books.some((book) => book.bookId === state.bookId)) {
        clearBookSelection();
        $("status").textContent = "这本书已从书库移除。";
        return;
      }
      state.chunks = await api(`/api/books/${encodeURIComponent(state.bookId)}/chunks`);
      state.annotations = await api(`/api/annotations?bookId=${encodeURIComponent(state.bookId)}`);
      renderBooks();
      renderChunks();
      renderText();
      renderAnnotations();
      refreshCards();
    }
  } finally {
    state.refreshInFlight = false;
  }
}

$("books").addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-book]");
  if (deleteButton) {
    deleteBookFromShelf(deleteButton.dataset.deleteBook).catch(showError);
    return;
  }
  const button = event.target.closest("[data-book]");
  if (button) selectBook(button.dataset.book).catch(showError);
});

$("chunks").addEventListener("click", (event) => {
  const button = event.target.closest("[data-chunk]");
  if (button) selectChunk(button.dataset.chunk).catch(showError);
});

$("text").addEventListener("mouseup", () => {
  updateSelectionAction();
});

$("text").addEventListener("touchend", () => {
  setTimeout(updateSelectionAction, 80);
});

$("text").addEventListener("click", (event) => {
  const mark = event.target.closest("mark[data-note-id]");
  if (mark) activateAnnotation(mark.dataset.noteId, { scroll: true });
});

document.addEventListener("selectionchange", updateSelectionAction);

$("cancel-note").addEventListener("click", () => {
  closeNoteForm();
});

$("note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const note = $("note").value.trim();
  if (!note) return;
  await api("/api/annotations", {
    method: "POST",
    body: {
      bookId: state.bookId,
      chunkId: state.chunkId,
      quote: state.quote,
      quoteOffset: state.quoteOffset,
      note,
      kind: "note",
    },
  });
  closeNoteForm();
  window.getSelection()?.removeAllRanges();
  updateSelectionAction();
  await refreshCurrent({ force: true });
});

$("note-selection").addEventListener("click", () => {
  const quote = state.selectedQuote || window.getSelection()?.toString() || "";
  openNoteForm(quote);
});

$("margins").addEventListener("click", (event) => {
  if (event.target.closest("textarea, button, .reply-form, .thread")) return;
  const card = event.target.closest(".note-card[data-note-id]");
  if (card) activateAnnotation(card.dataset.noteId);
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest(".reply-form");
  if (!form) return;
  event.preventDefault();
  event.stopPropagation();
  const textarea = form.querySelector("textarea");
  const note = textarea.value.trim();
  if (!note) return;
  const savedNoteId = state.activeAnnotationId;
  await api("/api/replies", {
    method: "POST",
    body: {
      parentId: form.dataset.parentId,
      note,
      author: "user",
      kind: "reply",
    },
  });
  textarea.value = "";
  delete state.replyDrafts[form.dataset.parentId];
  state.activeAnnotationId = savedNoteId;
  await refreshCurrent({ force: true });
  if (savedNoteId) activateAnnotation(savedNoteId);
});

document.addEventListener("input", (event) => {
  const textarea = event.target.closest("textarea");
  const form = event.target.closest(".reply-form");
  if (!textarea || !form) return;
  state.replyDrafts[form.dataset.parentId] = textarea.value;
});

document.addEventListener("compositionstart", (event) => {
  if (!event.target.closest?.(".reply-form, .note-form")) return;
  state.composing = true;
});

document.addEventListener("compositionend", (event) => {
  if (!event.target.closest?.(".reply-form, .note-form")) return;
  state.composing = false;
});

$("submit-notes").addEventListener("click", async () => {
  const result = await api("/api/submit-notes", {
    method: "POST",
    body: {
      bookId: state.bookId,
      sessionId: "reader",
      contextMode: "chunk-once-per-session",
    },
  });
  await refreshCurrent({ force: true });
  $("status").textContent = result.submissionId
    ? `已分享 ${result.count} 条批注。请在聊天中让共读伙伴读取最新提交。`
    : "没有待分享的批注。";
});

$("mark-read").addEventListener("click", async () => {
  const result = await api("/api/mark-read", {
    method: "POST",
    body: { bookId: state.bookId, chunkId: state.chunkId },
  });
  state.lastFinish = result.finish || null;
  await refreshCurrent({ force: true });
  refreshCards({ finish: state.lastFinish, show: Boolean(state.lastFinish) });
  if (!state.lastFinish && state.cardCandidates.some((card) => card.source === "shared")) {
    showToast("收获了一枚回声书签");
  }
});

$("continue-reading").addEventListener("click", async () => {
  if (!state.bookId) return;
  const next = await api(`/api/continue?bookId=${encodeURIComponent(state.bookId)}`);
  const chunkId = next?.chunk?.chunk?.id || next?.chunk?.chunkId || next?.chunk?.id;
  if (!chunkId) {
    $("status").textContent = "这本书已全部读完，可以回看喜欢的章节。";
    return;
  }
  await selectChunk(chunkId);
});

$("refresh").addEventListener("click", () => refreshCurrent({ force: true }).catch(showError));

$("show-card").addEventListener("click", openCardPanel);

$("card-close").addEventListener("click", () => {
  $("card-panel").hidden = true;
});

$("card-random").addEventListener("click", () => {
  if (!state.cardCandidates.length) return;
  state.cardIndex = (state.cardIndex + 1) % state.cardCandidates.length;
  renderCardPanel();
});

$("import-book").addEventListener("click", () => {
  $("import-file").click();
});

$("import-file").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  $("import-book").disabled = true;
  try {
    const imported = [];
    for (const file of files) {
      $("status").textContent = `正在导入 ${file.name}……`;
      const manifest = await api("/api/import", {
        method: "POST",
        body: {
          filename: file.name,
          dataBase64: await fileToBase64(file),
        },
      });
      imported.push(manifest);
    }
    $("status").textContent = files.length === 1 ? `已导入 ${files[0].name}。` : `已导入 ${files.length} 本书。`;
    await loadBooks();
    renderBooks();
    if (imported.length === 1 && imported[0]?.bookId) {
      await selectBook(imported[0].bookId);
    }
  } catch (error) {
    showError(error);
  } finally {
    $("import-book").disabled = false;
    event.target.value = "";
  }
});

function showError(error) {
  const msg = translateError(error.message || String(error));
  $("status").textContent = msg;
  showToast(msg);
}

loadBooks().catch(showError);
setInterval(() => {
  if (document.hidden) return;
  refreshCurrent().catch(showError);
}, 5000);
