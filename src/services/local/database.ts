import { t } from "../../i18n";
export const DB_NAME = "autumn-reader";
export const DB_VERSION = 4;
export const stores = [
  "books",
  "pending_sync_operations",
  "migration_state",
  "cloud_state",
  "library_folders",
  "folder_memberships",
] as const;
export type StoreName = (typeof stores)[number];
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const store of stores)
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store, { keyPath: "id" });
      const books = request.transaction!.objectStore("books");
      if (!books.indexNames.contains("by_owner")) books.createIndex("by_owner", "ownerId");
      if (!books.indexNames.contains("by_owner_hash"))
        books.createIndex("by_owner_hash", ["ownerId", "fileHash"]);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new Error(
          t("cacheUpgradeBlocked"),
        ),
      );
  });
}
export async function request<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode),
      operation = action(tx.objectStore(store));
    tx.oncomplete = () => {
      db.close();
      resolve(operation.result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error ?? operation.error);
    };
  });
}
export async function localGet<T>(
  store: StoreName,
  id: string,
): Promise<T | undefined> {
  return request(store, "readonly", (s) => s.get(id)) as Promise<T | undefined>;
}
export async function localPut<T extends { id: string }>(
  store: StoreName,
  value: T,
): Promise<void> {
  await request(store, "readwrite", (s) => s.put(value));
}
export async function localAll<T>(store: StoreName): Promise<T[]> {
  return request(store, "readonly", (s) => s.getAll()) as Promise<T[]>;
}
