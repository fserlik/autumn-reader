import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { openDatabase, request, localAll } from "./services/local/database";
import { operationsForBook } from "./services/sync/operations";
import { auth } from "./services/auth";
import { t } from "./i18n";

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
  /** Metadata read from the EPUB/PDF; never represents a personal edit. */
  contentTitle?: string;
  contentAuthor?: string;
  /** Version of the local file-metadata extraction, including books without a cover. */
  contentMetadataVersion?: number;
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
  /** Recoverable legacy duplicate; its content was merged into another local row. */
  duplicateOf?: string;
}

const nativeAndroid = isTauri() && /\bAndroid\b/i.test(navigator.userAgent);

export function nativeBookUrl(path: string): string {
  return convertFileSrc(path, "book-file");
}

let cloudLoader: ((book: StoredBook) => Promise<StoredBook>) | undefined;
export function setCloudBookLoader(loader: (book: StoredBook) => Promise<StoredBook>): void { cloudLoader = loader; }
export function hasLocalFile(book: StoredBook): boolean { return Boolean(book.nativeDataPath || book.data.size); }
export function assertBookOwner(book: StoredBook): void {
  if (!book.ownerId || book.ownerId !== auth.state.ownerId) throw new Error(t("bookOtherAccount"));
}
export async function readLocalBookBlob(book: StoredBook): Promise<Blob> {
  assertBookOwner(book);
  if (!book.nativeDataPath) return book.data;
  const response = await fetch(nativeBookUrl(book.nativeDataPath));
  if (!response.ok) throw new Error("Couldn't read the saved book");
  return response.blob();
}
export async function readBookData(book: StoredBook): Promise<ArrayBuffer> {
  assertBookOwner(book);
  if (cloudLoader && (book.ownerId || !hasLocalFile(book))) Object.assign(book, await cloudLoader(book));
  assertBookOwner(book);
  if (!book.nativeDataPath) return book.data.arrayBuffer();
  const response = await fetch(nativeBookUrl(book.nativeDataPath));
  if (!response.ok) throw new Error("Couldn't read the saved book");
  return response.arrayBuffer();
}

export async function readBookCover(book: StoredBook): Promise<Blob | undefined> {
  assertBookOwner(book);
  if (book.customCover && book.cover) return book.cover;
  if (!book.nativeCoverPath) return book.cover;
  const response = await fetch(nativeBookUrl(book.nativeCoverPath));
  if (!response.ok) throw new Error("Couldn't read the saved cover");
  return response.blob();
}

// Cover generation can finish after navigation or a progress edit. Update only the cached image.
export async function cacheBookCover(id: string, cover: Blob): Promise<void> {
  const owner = auth.state.ownerId;
  if (!owner) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("books", "readwrite");
    const store = tx.objectStore("books");
    const lookup = store.get(id);
    lookup.onsuccess = () => {
      const latest = lookup.result as StoredBook | undefined;
      if (latest?.ownerId === owner && auth.state.ownerId === owner && !latest.deletedAt && !latest.customCover) store.put({ ...latest, cover });
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function nativeMetadata(book: StoredBook): object {
  return {
    id: book.id, name: book.name, format: book.format, addedAt: book.addedAt,
    ownerId: book.ownerId,
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

async function allBookRecords(): Promise<StoredBook[]> {
  const books = await runRequest("readonly", (store) => store.getAll()) as StoredBook[];
  if (!nativeAndroid) return books;
  const native = await invoke<{ books: Omit<StoredBook, "data">[] }>("native_list_books");
  const merged = new Map(books.map((book) => [book.id, book]));
  for (const record of native.books) {
    const previous = merged.get(record.id);
    merged.set(record.id, { ...record, ...previous, nativeDataPath: record.nativeDataPath,
      nativeCoverPath: previous?.customCover ? undefined : record.nativeCoverPath,
      data: previous?.data ?? new Blob(), notes: previous?.notes ?? record.notes ?? [] });
  }
  return [...merged.values()];
}

/** Persist extracted file metadata without touching reading state or the sync outbox. */
export async function cacheBookContentMetadata(
  id: string,
  metadata: { title?: string; author?: string; cover?: Blob },
  expectedHash?: string,
): Promise<StoredBook | undefined> {
  const owner = auth.state.ownerId;
  if (!owner) return undefined;
  const db = await openDatabase();
  let updated: StoredBook | undefined;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("books", "readwrite"), store = tx.objectStore("books"), read = store.get(id);
    read.onsuccess = () => {
      const latest = read.result as StoredBook | undefined;
      if (!latest || latest.ownerId !== owner || auth.state.ownerId !== owner || latest.deletedAt ||
          (expectedHash && latest.fileHash && latest.fileHash !== expectedHash)) return;
      updated = {
        ...latest,
        contentTitle: metadata.title || latest.contentTitle,
        contentAuthor: metadata.author || latest.contentAuthor,
        author: latest.displayTitle === undefined && metadata.author ? metadata.author : latest.author,
        cover: !latest.customCover && !latest.coverPath && metadata.cover ? metadata.cover : latest.cover,
        contentMetadataVersion: 1,
      };
      store.put(updated);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
  return updated;
}

/** Only existing account evidence can assign historical rows automatically. */
async function resolveLegacyOwners(books: StoredBook[]): Promise<void> {
  const unowned = books.filter(book => !book.ownerId);
  if (!unowned.length) return;
  const [states, memberships] = await Promise.all([
    localAll<{ ownerId?: string; localId?: string }>("migration_state"),
    localAll<{ ownerId?: string; bookLocalId?: string }>("folder_memberships"),
  ]);
  const candidates = new Map<string, Set<string>>();
  const add = (id: string | undefined, owner: string | undefined): void => {
    if (!id || !owner) return;
    if (!candidates.has(id)) candidates.set(id, new Set());
    candidates.get(id)!.add(owner);
  };
  for (const state of states) add(state.localId, state.ownerId);
  for (const membership of memberships) add(membership.bookLocalId, membership.ownerId);
  for (const book of books) {
    if (book.ownerId) for (const source of book.migrationSources ?? []) add(source, book.ownerId);
    else if (book.cloudId) {
      const match = /^cloud-([a-f0-9-]{36})-[a-f0-9-]{36}$/i.exec(book.id);
      add(book.id, match?.[1]);
    }
  }
  const certain = unowned.filter(book => candidates.get(book.id)?.size === 1);
  if (!certain.length) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("books", "readwrite"), store = tx.objectStore("books");
    for (const book of certain) {
      const ownerId = [...candidates.get(book.id)!][0];
      const read = store.get(book.id);
      read.onsuccess = () => {
        const stored = read.result as StoredBook | undefined;
        if (stored?.ownerId && stored.ownerId !== ownerId) return;
        book.ownerId = ownerId;
        store.put({ ...book, ...stored, ownerId });
      };
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
  if (nativeAndroid) for (const book of certain) if (book.ownerId && book.nativeDataPath)
    await invoke("native_save_book", { record: nativeMetadata(book) }).catch(() => {});
}

export async function unclaimedBookCount(): Promise<number> {
  if (!auth.state.ownerId) return 0;
  const owner = auth.state.ownerId;
  const books = await allBookRecords();
  await resolveLegacyOwners(books);
  return auth.state.ownerId === owner ? books.filter(book => !book.ownerId && !book.deletedAt && !book.duplicateOf).length : 0;
}

/** Explicit recovery for records with no reliable historical account evidence. */
export async function claimUnownedBooks(ownerId: string): Promise<number> {
  if (!ownerId || auth.state.ownerId !== ownerId) throw new Error(t("bookOtherAccount"));
  const books = await allBookRecords();
  await resolveLegacyOwners(books);
  const unowned = books.filter(book => !book.ownerId && !book.deletedAt && !book.duplicateOf);
  if (!unowned.length) return 0;
  const db = await openDatabase();
  let claimed = 0;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("books", "readwrite"), store = tx.objectStore("books");
    for (const book of unowned) {
      const read = store.get(book.id);
      read.onsuccess = () => {
        if (auth.state.ownerId !== ownerId) { tx.abort(); return; }
        const stored = read.result as StoredBook | undefined;
        if (stored?.ownerId) return;
        book.ownerId = ownerId;
        store.put({ ...book, ...stored, ownerId });
        claimed++;
      };
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
  window.dispatchEvent(new Event("autumn-local-change"));
  if (nativeAndroid) for (const book of unowned) if (book.ownerId === ownerId && book.nativeDataPath)
    await invoke("native_save_book", { record: nativeMetadata(book) }).catch(() => {});
  return claimed;
}

export async function listBooks(ownerId: string | null, includeAll = false): Promise<StoredBook[]> {
  if (!ownerId || auth.state.ownerId !== ownerId) return [];
  const result = await allBookRecords();
  await resolveLegacyOwners(result);
  if (auth.state.ownerId !== ownerId) return [];
  const migrated = ownerId && !includeAll ? new Set((await localAll<import("./services/sync/migration").MigrationState>("migration_state")).filter((s)=>s.ownerId===ownerId&&s.phase==="complete").map((s)=>s.localId)) : new Set<string>();
  if (auth.state.ownerId !== ownerId) return [];
  // A cloud cache row may itself be the source of a later re-upload after
  // removing only its cloud copy. Hide migrated local originals, not that row.
  return result.filter((book) => book.ownerId === ownerId && !book.deletedAt && !book.duplicateOf && (includeAll || (book.cloudId || !migrated.has(book.id)))).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function saveBook(book: StoredBook, options: { preserveTimestamps?: boolean } = {}): Promise<IDBValidKey> {
  assertBookOwner(book);
  const db = await openDatabase();
  await new Promise<void>((resolve,reject)=> {
    const tx = db.transaction([STORE_NAME,"pending_sync_operations"],"readwrite"), store=tx.objectStore(STORE_NAME);
    const get=store.get(book.id);
    get.onsuccess=()=> {
      const previous=get.result as StoredBook|undefined;
      if (auth.state.ownerId !== book.ownerId || (previous && previous.ownerId !== book.ownerId)) { tx.abort(); return; }
      const stamp=Math.max(Date.now(),(previous?.updatedAt??0)+1);book.updatedAt=stamp;
      const queue=tx.objectStore("pending_sync_operations");
      for(const operation of operationsForBook(book,previous,stamp,options.preserveTimestamps))queue.put(operation);
      if(book.deletedAt&&book.ownerId&&book.cloudId){const all=queue.getAll();all.onsuccess=()=>{for(const op of all.result as import("./services/sync/operations").SyncOperation[])if(op.ownerId===book.ownerId&&op.bookId===book.cloudId&&op.entity!=="user_book")queue.delete(op.id);};}
      store.put(book);
    };
    tx.oncomplete=()=>{db.close();resolve();};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};
  });
  // IndexedDB is authoritative for metadata and queue; the legacy native library index remains compatible.
  if(nativeAndroid && book.nativeDataPath) await invoke("native_save_book",{record:nativeMetadata(book)}).catch(()=>{});
  window.dispatchEvent(new Event("autumn-local-change"));
  return book.id;
}

export async function saveBooks(books: StoredBook[]): Promise<void> {
  for (const book of books) assertBookOwner(book);
  const owner = auth.state.ownerId;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    for (const book of books) {
      const read = store.get(book.id);
      read.onsuccess = () => {
        const previous = read.result as StoredBook | undefined;
        if (auth.state.ownerId !== owner || (previous && previous.ownerId !== owner)) { transaction.abort(); return; }
        store.put(book);
      };
    }
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
  if (!existing) return undefined;
  assertBookOwner(existing);
  if(existing?.ownerId&&existing.cloudId) { existing.deletedAt=Date.now();await saveBook(existing);return undefined; }
  const owner = existing.ownerId!;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("books", "readwrite"), store = tx.objectStore("books"), read = store.get(id);
    read.onsuccess = () => {
      const latest = read.result as StoredBook | undefined;
      if (auth.state.ownerId !== owner || latest?.ownerId !== owner) { tx.abort(); return; }
      store.delete(id);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
  });
  if (nativeAndroid) {
    try { await invoke("native_delete_book", { id }); }
    catch (error) {
      await runRequest("readwrite", store => store.put(existing));
      throw error;
    }
  }
  return undefined;
}
