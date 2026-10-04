import { openDatabase, localAll } from "../local/database";
import type { SyncOperation } from "./operations";
import { auth } from "../auth";
export async function queued(ownerId: string): Promise<SyncOperation[]> {
  if (!ownerId || auth.state.ownerId !== ownerId) return [];
  const operations = await localAll<SyncOperation>("pending_sync_operations");
  if (auth.state.ownerId !== ownerId) return [];
  return operations.filter(
    (op) => op.ownerId === ownerId,
  );
}
export async function settleOperation(
  op: SyncOperation,
  error?: string,
): Promise<void> {
  if (auth.state.ownerId !== op.ownerId) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("pending_sync_operations", "readwrite"),
      store = tx.objectStore("pending_sync_operations");
    const get = store.get(op.id);
    get.onsuccess = () => {
      const current = get.result as SyncOperation | undefined;
      // A newer local edit must survive an acknowledgement of the previous in-flight value.
      if (auth.state.ownerId !== op.ownerId || current?.version !== op.version) return;
      if (!error) store.delete(op.id);
      else
        store.put({
          ...current,
          error,
          attempts: current.attempts + 1,
          retryAt:
            Date.now() +
            Math.min(60000, 1000 * 2 ** Math.min(6, current.attempts)),
        });
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function resetRetry(ownerId: string): Promise<void> {
  if (auth.state.ownerId !== ownerId) return;
  const db = await openDatabase();
  const ops = await queued(ownerId);
  if (auth.state.ownerId !== ownerId) { db.close(); return; }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("pending_sync_operations", "readwrite"),
      store = tx.objectStore("pending_sync_operations");
    for (const op of ops) {
      const read = store.get(op.id);
      read.onsuccess = () => {
        const current = read.result as SyncOperation | undefined;
        if (auth.state.ownerId === ownerId && current?.ownerId === ownerId) store.put({ ...current, retryAt: 0 });
      };
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
