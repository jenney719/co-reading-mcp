const KEY = "co-reading-resume-v1";
export function loadReadingPositions(storage) {
  try {
    const data = JSON.parse(storage.getItem(KEY) || "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}
export function saveReadingPosition(storage, position) {
  if (!position?.bookId || !position?.chunkId) return;
  try {
    const positions = loadReadingPositions(storage);
    positions[position.bookId] = position;
    positions.lastBookId = position.bookId;
    storage.setItem(KEY, JSON.stringify(positions));
  } catch { /* Reading continues when browser storage is unavailable. */ }
}
export function readingPosition(storage, bookId, chunks) {
  const value = loadReadingPositions(storage)[bookId];
  if (!value || !chunks.some(chunk => chunk.id === value.chunkId && !chunk.read)) return null;
  return {
    bookId, chunkId: value.chunkId,
    pageOffset: Number.isFinite(value.pageOffset) ? Math.max(0, value.pageOffset) : 0,
    textOffset: Number.isFinite(value.textOffset) ? Math.max(0, value.textOffset) : 0,
  };
}
export function lastReadingBook(storage, books) {
  const positions = loadReadingPositions(storage);
  return books.find(book => book.bookId === positions.lastBookId)?.bookId || books[0]?.bookId || null;
}
