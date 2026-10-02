const humanAuthors = new Set(["user", "human", "koshi", "you"]);

export const sharedBookmarkLines = [
  "这里有两个人的折痕。",
  "此处有回声。",
];

const quietChapterPatterns = [
  /^(contents?|table of contents|copyright|title page|cover|toc)$/i,
  /^(目录|版权页|书名页|封面|版权|目录页)$/,
  /(作者|译者).{0,4}(注|说明|按语|序)/,
  /(author|translator).{0,12}(note|preface|foreword)/i,
  /(acknowledg|appendix|bibliography|references)/i,
  /(致谢|附录|参考文献|索引|出版说明|译后记|后记|前言|序言)/,
];

export function isHumanAuthor(author) {
  return humanAuthors.has(String(author || "").toLowerCase());
}

export function isClaudeAuthor(author) {
  const value = String(author || "").toLowerCase();
  return !isHumanAuthor(value) && (!value || value === "claude" || value === "assistant");
}

export function normalizeForOverlap(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function compactText(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

export function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function isLowSignalChunk(chunk = {}) {
  const title = String(chunk.title || chunk.id || "");
  const text = String(chunk.text || "");
  if (quietChapterPatterns.some((pattern) => pattern.test(title.trim()))) return true;
  if (text.replace(/\s+/g, "").length < 180) return true;
  return false;
}

export function quotesOverlap(left = "", right = "") {
  const a = normalizeForOverlap(left);
  const b = normalizeForOverlap(right);
  if (a.length < 8 || b.length < 8) return false;
  return a.includes(b) || b.includes(a);
}

export function rootAnnotations(annotations = []) {
  return annotations.filter((annotation) => !annotation.parentId && annotation.quote && annotation.note);
}

export function findSharedMoments(annotations = []) {
  const roots = rootAnnotations(annotations);
  const human = roots.filter((annotation) => isHumanAuthor(annotation.author));
  const claude = roots.filter((annotation) => isClaudeAuthor(annotation.author));
  const moments = [];
  for (const userNote of human) {
    for (const claudeNote of claude) {
      if (!quotesOverlap(userNote.quote, claudeNote.quote)) continue;
      const quote = userNote.quote.length <= claudeNote.quote.length ? userNote.quote : claudeNote.quote;
      moments.push({
        id: `${userNote.id}:${claudeNote.id}`,
        quote,
        userNote,
        claudeNote,
      });
    }
  }
  return moments;
}

export function sharedNoteIdSet(annotations = []) {
  const ids = new Set();
  for (const moment of findSharedMoments(annotations)) {
    ids.add(moment.userNote.id);
    ids.add(moment.claudeNote.id);
  }
  return ids;
}

function finishText(text) {
  const messages = {
    "The last page is turned.": "最后一页，已经翻过。",
    "The book is closed, but the margins are still awake.": "书已合上，页边的回声仍在。",
    "Offer the human one favorite passage, one unresolved question, or one small afterword.": "留下一段喜欢的文字、一个未解的问题，或一篇小小的后记。",
    "A shared trail is complete.": "一起走过的阅读之路，已抵达终点。",
    "Every marked page is now part of the route you took together.": "每一页留下的记号，都属于你们一起走过的路。",
    "Name the strongest resonance from the book, then invite the human to answer with theirs.": "说说书中最深的共鸣，也听听彼此的答案。",
    "Book finished, margins preserved.": "书已读完，批注仍在。",
    "The reading is done; the conversation can keep unfolding from any note.": "阅读告一段落，对话仍能从任意一条批注继续。",
    "Write a short closing note that feels like placing a bookmark after the final page.": "写一条简短的合卷寄语，像在最后一页放下书签。",
    "The shelf has one more finished thing.": "书架上，又多了一本一起读完的书。",
    "Progress says complete; the annotations say it was lived through.": "进度记录着读完，批注记录着那些真实的感受。",
    "Summarize the book in three pulses: image, feeling, question.": "用一个画面、一种感受和一个问题，留下这本书的余韵。",
    "End of book, not end of thread.": "书有结尾，话题仍在延续。",
    "All chunks are read, and the page-side rooms remain open.": "所有片段都已读完，页边的对话仍为你们敞开。",
    "Choose one annotation worth returning to later and explain why.": "选一条值得日后重访的批注，说说它为何值得留下。",
  };
  return messages[text] || text;
}

export function buildCardCandidates({ book = {}, chunk = {}, annotations = [], finish = null } = {}) {
  const candidates = [];
  const shared = findSharedMoments(annotations);
  const lowSignal = isLowSignalChunk(chunk);
  for (const [index, moment] of shared.entries()) {
    candidates.push({
      id: `shared-${moment.id}-${index}`,
      variant: index % 2 === 0 ? "crease" : "echo",
      art: index % 2 === 0 ? "fold" : "ripple",
      artSeed: hashText(`${moment.userNote.id}:${moment.claudeNote.id}:${moment.quote}`),
      kicker: index % 2 === 0 ? sharedBookmarkLines[0] : sharedBookmarkLines[1],
      title: "共同的页边",
      subtitle: [book.title, chunk.title].filter(Boolean).join(" · "),
      quote: compactText(moment.quote, 150),
      leftLabel: "共读伙伴",
      leftText: compactText(moment.claudeNote.note, 130),
      rightLabel: "你",
      rightText: compactText(moment.userNote.note, 130),
      footer: "一起读过，在同一句话旁停留。",
      source: "shared",
    });
  }

  if (finish && !lowSignal) {
    candidates.push({
      id: `finish-${book.bookId || book.id || "book"}`,
      variant: "finish",
      art: "fold",
      artSeed: hashText(`${book.bookId || book.id || book.title}:finish`),
      kicker: finishText(finish.celebration?.title) || "书已读完，批注仍在。",
      title: book.title || "读完的书",
      subtitle: book.author || "",
      quote: finishText(finish.celebration?.line) || "书已合上，页边的回声仍在。",
      leftLabel: "阅读进度",
      leftText: `${finish.chunkCount || finish.chunksRead || ""}${finish.chunkCount ? " 个片段" : ""}`.trim(),
      rightLabel: "页边批注",
      rightText: `${finish.annotationCount || 0} 条批注`,
      footer: finishText(finish.celebration?.prompt) || "选一句话，带到下一段旅程。",
      source: "finish",
    });
  }

  const visibleRoots = rootAnnotations(annotations).filter((annotation) => !isHumanAuthor(annotation.author) || annotation.status === "submitted");
  const resonant = visibleRoots.find((annotation) => ["resonance", "feeling", "annotation"].includes(annotation.kind || "annotation"));
  if (resonant && !lowSignal) {
    candidates.push({
      id: `quiet-${resonant.id}`,
      variant: "quiet",
      art: "stardust",
      artSeed: hashText(`${resonant.id}:${resonant.quote}`),
      kicker: "值得留下的想法",
      title: book.title || "共读书屋",
      subtitle: chunk.title || "",
      quote: compactText(resonant.quote, 150),
      leftLabel: isClaudeAuthor(resonant.author) ? "共读伙伴" : "你",
      leftText: compactText(resonant.note, 150),
      rightLabel: "",
      rightText: "",
      footer: "从页边拾起的一枚小书签。",
      source: "quiet",
    });
  }

  return candidates;
}

export function pickCard(candidates = [], seed = Date.now()) {
  if (!candidates.length) return null;
  const value = Math.abs(Number(seed) || 0);
  return candidates[value % candidates.length];
}
