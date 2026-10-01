import { auth } from "../auth";
import { cloud, checkError } from "../client";
import { CloudError, requireOnline } from "../errors";
import { openDatabase } from "../local/database";
import { bookStorage, bookCache } from "../storage";
import { cloudLocalId } from "./models";
import { migrationKey } from "../sync/migration";
import { hasLocalFile, listBooks, type StoredBook } from "../../storage";
import type { SyncOperation } from "../sync/operations";
import type { CloudUsage } from "../types";

/** Keep file bytes and reading state, while removing stale cloud authorization/outbox state. */
export async function detachCloudBook(owner: string, bookId: string): Promise<void> {
  const id = cloudLocalId(owner, bookId);
  const previous = await bookCache.get(id);
  // listBooks(includeAll) also sees Android's private native-file records;
  // IndexedDB alone might not contain the old source file path.
  const recoverSources = previous && !hasLocalFile(previous)
    ? (await listBooks(owner, true)).filter(book =>
        previous.migrationSources?.includes(book.id) && hasLocalFile(book))
    : [];
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["books", "pending_sync_operations", "migration_state"], "readwrite");
    const books = tx.objectStore("books");
    const read = books.get(id);
    read.onsuccess = () => {
      const current = read.result as StoredBook | undefined;
      if (!current || current.ownerId !== owner || current.cloudId !== bookId) return;
      books.put({ ...current, cloudId: undefined,
        deletedAt: hasLocalFile(current) ? undefined : Date.now() });
      if (!hasLocalFile(current)) for (const source of recoverSources)
        tx.objectStore("migration_state").delete(migrationKey(owner, source.id));
    };
    const pending = tx.objectStore("pending_sync_operations");
    const all = pending.getAll();
    all.onsuccess = () => {
      for (const op of all.result as SyncOperation[])
        if (op.ownerId === owner && op.bookId === bookId) pending.delete(op.id);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
  window.dispatchEvent(new Event("autumn-local-change"));
}

export const cloudStorage = {
  async remove(bookId: string): Promise<CloudUsage> {
    requireOnline();
    const owner = auth.requireUser();
    const result = await bookStorage.removeCloud(bookId);
    if (auth.state.ownerId !== owner) throw new CloudError("session_expired");
    await detachCloudBook(owner, bookId);
    window.dispatchEvent(new Event("autumn-cloud-storage-changed"));
    return result.usage;
  },
  /** Reconcile cached books removed from another device without downloading files. */
  async reconcile(localBooks: StoredBook[]): Promise<void> {
    if (!navigator.onLine || auth.state.status !== "authenticated") return;
    const owner = auth.requireUser();
    const ids = [...new Set(localBooks.filter(book => book.ownerId === owner && book.cloudId)
      .map(book => book.cloudId!))];
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = ids.slice(offset, offset + 50);
      const { data, error } = await cloud().from("user_books")
        .select("book_id,deleted_at").eq("user_id", owner).in("book_id", batch);
      checkError(error);
      if (auth.state.ownerId !== owner) return;
      const removed = new Set((data ?? []).filter(row => row.deleted_at).map(row => row.book_id));
      for (const id of batch) if (removed.has(id)) await detachCloudBook(owner, id);
    }
  },
};
