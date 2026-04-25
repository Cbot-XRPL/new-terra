// Per-user saved filter "views" for list pages. Stored in localStorage so
// they persist across reloads. Keyed per page (`scope`) so the contract
// list and a future projects list can each have their own set.

const KEY_PREFIX = 'nt_savedviews_';

export interface SavedView {
  id: string;
  name: string;
  query: string;
}

export function listViews(scope: string): SavedView[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + scope);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is SavedView =>
        v && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.query === 'string',
    );
  } catch {
    return [];
  }
}

export function saveViews(scope: string, views: SavedView[]) {
  localStorage.setItem(KEY_PREFIX + scope, JSON.stringify(views));
}

export function addView(scope: string, name: string, query: string): SavedView {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const view: SavedView = { id, name, query };
  const views = listViews(scope);
  // Replace by name if the user re-saves with the same label.
  const filtered = views.filter((v) => v.name !== name);
  filtered.push(view);
  saveViews(scope, filtered);
  return view;
}

export function removeView(scope: string, id: string) {
  saveViews(
    scope,
    listViews(scope).filter((v) => v.id !== id),
  );
}
