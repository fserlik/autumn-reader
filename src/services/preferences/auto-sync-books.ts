import { auth } from "../auth";
import { connectivity } from "../connectivity";
import { listBooks, type StoredBook } from "../../storage";
import { migrateLibrary, migrationRemaining } from "../sync/migration";

const key = (owner: string): string => `autumn-auto-sync-books:${owner}`;

export function autoSyncBooksEnabled(owner: string): boolean {
  return localStorage.getItem(key(owner)) === "true";
}

export function saveAutoSyncBooks(owner: string, enabled: boolean): void {
  localStorage.setItem(key(owner), String(enabled));
}

function queued(owner: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(`${key(owner)}:pending`) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

function saveQueue(owner: string, ids: string[]): void {
  const storageKey = `${key(owner)}:pending`;
  if (ids.length) localStorage.setItem(storageKey, JSON.stringify([...new Set(ids)]));
  else localStorage.removeItem(storageKey);
}

let running = false;
let requested = false;

async function processQueue(): Promise<void> {
  requested = true;
  if (running) return;
  running = true;
  const attempted = new Set<string>();
  try {
    while (requested) {
      requested = false;
      const owner = auth.state.ownerId;
      if (!owner || auth.state.status !== "authenticated" || !connectivity.usable) continue;
      const ids = queued(owner);
      if (!ids.length) continue;
      const books = await listBooks(owner, true);
      if (auth.state.ownerId !== owner) continue;
      const selected: StoredBook[] = books.filter(book => ids.includes(book.id) && !book.cloudId && !attempted.has(book.id));
      if (selected.length) {
        selected.forEach(book => attempted.add(book.id));
        try { await migrateLibrary(selected, new AbortController().signal, () => {}); }
        catch { /* Keep the local queue for the next authenticated online session. */ }
      }
      if (auth.state.ownerId !== owner) continue;
      const remaining = await migrationRemaining(owner, await listBooks(owner, true));
      const pendingIds = new Set(remaining.map(book => book.id));
      saveQueue(owner, ids.filter(id => pendingIds.has(id)));
    }
  } catch {
    // Preserve queued imports when local storage or the library is temporarily unavailable.
  } finally {
    running = false;
    if (requested) void processQueue();
  }
}

export function initializeAutoBookSync(): void {
  window.addEventListener("autumn-book-imported", (event) => {
    const { ownerId, bookId } = (event as CustomEvent<{ ownerId: string; bookId: string }>).detail;
    if (!ownerId || !bookId || !autoSyncBooksEnabled(ownerId)) return;
    saveQueue(ownerId, [...queued(ownerId), bookId]);
    void processQueue();
  });
  auth.subscribe(() => void processQueue());
  connectivity.subscribe(state => { if (state.status === "online") void processQueue(); });
  window.addEventListener("online", () => void processQueue());
}
