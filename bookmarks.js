// localStorage-backed bookmark CRUD, shared by index.html (saving) and
// bookmarks.html (listing / viewing). No backend involved.

const BOOKMARKS_KEY = "nb-bookmarks";

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveBookmarks(list) {
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
}

function upsertBookmark(entry) {
  const list = loadBookmarks();
  const index = list.findIndex((b) => b.id === entry.id);
  if (index >= 0) list[index] = entry;
  else list.push(entry);
  saveBookmarks(list);
  return list;
}

function removeBookmark(id) {
  const list = loadBookmarks().filter((b) => b.id !== id);
  saveBookmarks(list);
  return list;
}

function getBookmark(id) {
  return loadBookmarks().find((b) => b.id === id) || null;
}

window.Bookmarks = {
  loadBookmarks,
  saveBookmarks,
  upsertBookmark,
  removeBookmark,
  getBookmark,
};
