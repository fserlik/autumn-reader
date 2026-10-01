import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { openDatabase, request, localAll } from "./services/local/database";
import { operationsForBook } from "./services/sync/operations";

export type BookFormat = "pdf" | "epub";

export type BookNote = {
  id: string;
  quote: string;
  text: string;
  color: string;
  createdAt: number;
  updatedAt?: number;
  cloudId?: string;
} & ({ format: "pdf"; page: number; y: number } | { format: "epub"; cfi: string });

export interface StoredBook {
  id: string;
  name: string;
  format: BookFormat;
  data: Blob;
  addedAt: number;
  lastOpenedAt: number;
  favorite?: boolean;
  cover?: Blob;
  /** User-facing title; name remains the original filename for file identification. */
  displayTitle?: string;
  customCover?: boolean;
  coverPath?: string | null;
  coverUploadedPath?: string;
  metadataUpdatedAt?: number;
  page: number;
  cfi: string | null;
  fontSize: number;
  pdfTextOffset?: number;
  notes?: BookNote[];
  nativeDataPath?: string;
  nativeDataSize?: number;
  nativeCoverPath?: string;
  nativeCoverSize?: number;
  ownerId?: string;
  cloudId?: string;
  fileHash?: string;
  fileSize?: number;
  author?: string;
  percentage?: number;
  status?: "unread" | "reading" | "finished";
  updatedAt?: number;
  progressUpdatedAt?: number;
  userUpdatedAt?: number;
  deletedAt?: number;
  migrationSources?: string[];
}

const nativeAndroid = isTauri() && /\bAndroid\b/i.test(navigator.userAgent);

export function nativeBookUrl(path: string): string {
  return convertFileSrc(path, "book-file");
}

let cloudLoader: ((book: StoredBook) => Promise<StoredBook>) | undefined;
export function setCloudBookLoader(loader: (book: StoredBook) => Promise<StoredBook>): void { cloudLoader = loader; }
export function hasLocalFile(book: StoredBook): boolean { return Boolean(book.nativeDataPath || book.data.size); }
export async function readLocalBookBlob(book: StoredBook): Promise<Blob> {
  if (!book.nativeDataPath) return book.data;
  const response = await fetch(nativeBookUrl(book.nativeDataPath));
  if (!response.ok) throw new Error("Couldn't read the saved book");
  return response.blob();
}
export async function readBookData(book: StoredBook): Promise<ArrayBuffer> {
  if (cloudLoader && (book.ownerId || !hasLocalFile(book))) Object.assign(book, await cloudLoader(book));
  if (!book.nativeDataPath) return book.data.arrayBuffer();
  const response = await fetch(nativeBookUrl(book.nativeDataPath));
  if (!response.ok) throw new Error("Couldn't read the saved book");
  return response.arrayBuffer();
}

export async function readBookCover(book: StoredBook): Promise<Blob | undefined> {
  if (book.customCover && book.cover) return book.cover;
  if (!book.nativeCoverPath) return book.cover;
  const response = await fetch(nativeBookUrl(book.nativeCoverPath));
  if (!response.ok) throw new Error("Couldn't read the saved cover");
  return response.blob();
}

// Cover generation can finish after navigation or a progress edit. Update only the cached image.
export async function cacheBookCover(id: string, cover: Blob): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("books", "readwrite");
    const store = tx.objectStore("books");
    const lookup = store.get(id);
    lookup.onsuccess = () => {
      const latest = lookup.result as StoredBook | undefined;
      if (latest && !latest.deletedAt && !latest.customCover) store.put({ ...latest, cover });
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function nativeMetadata(book: StoredBook): object {
  return {
    id: book.id, name: book.name, format: book.format, addedAt: book.addedAt,
    lastOpenedAt: book.lastOpenedAt, favorite: Boolean(book.favorite), page: book.page,
    cfi: book.cfi, fontSize: book.fontSize, pdfTextOffset: book.pdfTextOffset,
    hasCover: Boolean(book.nativeCoverPath || book.cover), notes: book.notes ?? [],
  };
}

const STORE_NAME = "books";

async function runRequest<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return request(STORE_NAME, mode, action);
}

export async function listBooks(ownerId: string | null = null, includeAll = false): Promise<StoredBook[]> {
  const books = await runRequest("readonly", (store) => store.getAll()) as StoredBook[];
  let result = books;
  if (nativeAndroid) {
    const native = await invoke<{ books: Omit<StoredBook, "data">[] }>("native_list_books");
    const merged = new Map(books.map((book) => [book.id, book]));
    for (const record of native.books) {
      const previous = merged.get(record.id);
      merged.set(record.id, { ...record, ...previous, nativeDataPath: record.nativeDataPath, nativeCoverPath: previous?.customCover ? undefined : record.nativeCoverPath, data: new Blob(), notes: previous?.notes ?? record.notes ?? [] });
    }
    result = [...merged.values()];
  }
  const migrated = ownerId && !includeAll ? new Set((await localAll<import("./services/sync/migration").MigrationState>("migration_state")).filter((s)=>s.ownerId===ownerId&&s.phase==="complete").map((s)=>s.localId)) : new Set<string>();
  // A cloud cache row may itself be the source of a later re-upload after
  // removing only its cloud copy. Hide migrated local originals, not that row.
  return result.filter((book) => !book.deletedAt && (includeAll || ((!book.ownerId || book.ownerId === ownerId) && (book.cloudId || !migrated.has(book.id))))).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function saveBook(book: StoredBook, options: { preserveTimestamps?: boolean } = {}): Promise<IDBValidKey> {
  const db = await openDatabase();
  await new Promise<void>((resolve,reject)=> {
    const tx = db.transaction([STORE_NAME,"pending_sync_operations"],"readwrite"), store=tx.objectStore(STORE_NAME);
    const get=store.get(book.id);
    get.onsuccess=()=> {
      const previous=get.result as StoredBook|undefined;
      const stamp=Math.max(Date.now(),(previous?.updatedAt??0)+1);book.updatedAt=stamp;
      const queue=tx.objectStore("pending_sync_operations");
      for(const operation of operationsForBook(book,previous,stamp,options.preserveTimestamps))queue.put(operation);
      if(book.deletedAt&&book.ownerId&&book.cloudId){const all=queue.getAll();all.onsuccess=()=>{for(const op of all.result as import("./services/sync/operations").SyncOperation[])if(op.ownerId===book.ownerId&&op.bookId===book.cloudId&&op.entity!=="user_book")queue.delete(op.id);};}
      store.put(book);
    };
    tx.oncomplete=()=>{db.close();resolve();};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};
  });
  // IndexedDB is authoritative for metadata and queue; the legacy native library index remains compatible.
  if(nativeAndroid && book.nativeDataPath && !book.ownerId) await invoke("native_save_book",{record:nativeMetadata(book)}).catch(()=>{});
  window.dispatchEvent(new Event("autumn-local-change"));
  return book.id;
}

export async function saveBooks(books: StoredBook[]): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    for (const book of books) store.put(book);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export async function deleteBook(id: string): Promise<undefined> {
  const existing=await runRequest("readonly",(store)=>store.get(id)) as StoredBook|undefined;
  if(existing?.ownerId&&existing.cloudId) { existing.deletedAt=Date.now();await saveBook(existing);return undefined; }
  if (nativeAndroid) await invoke("native_delete_book", { id });
  return runRequest("readwrite", (store) => store.delete(id));
}
