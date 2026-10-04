// Match only exact text or whitespace-only differences; never guess paraphrases.
export function locateAnnotation(text, note) {
  const quote = String(note.quote || "");
  if (!quote.trim()) return null;
  const offset = note.quoteOffset;
  if (Number.isInteger(offset) && offset >= 0 && text.slice(offset, offset + quote.length) === quote) {
    return { start: offset, end: offset + quote.length };
  }
  const exact = text.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };

  const positions = [];
  let compact = "";
  for (let index = 0; index < text.length; index++) {
    if (/\s/u.test(text[index])) continue;
    positions.push(index);
    compact += text[index];
  }
  const needle = quote.replace(/\s/gu, "");
  if (!needle) return null;
  const first = compact.indexOf(needle);
  if (first < 0) return null;
  // An explicit offset can disambiguate a repeated passage.
  const preferred = Number.isInteger(offset) ? positions.indexOf(offset) : -1;
  const start = preferred >= 0 && compact.slice(preferred, preferred + needle.length) === needle
    ? preferred
    : first;
  if (start === first && compact.indexOf(needle, first + 1) >= 0 && preferred !== first) return null;
  return { start: positions[start], end: positions[start + needle.length - 1] + 1 };
}

export function groupAnnotationRanges(text, notes) {
  const located = notes.filter(note => !note.parentId).flatMap(note => {
    const range = locateAnnotation(text, note);
    return range ? [{ ...range, note }] : [];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const groups = [];
  for (const item of located) {
    const previous = groups.at(-1);
    if (previous && item.start < previous.end) {
      previous.end = Math.max(previous.end, item.end);
      previous.notes.push(item.note);
    } else {
      groups.push({ start: item.start, end: item.end, notes: [item.note] });
    }
  }
  return groups;
}
