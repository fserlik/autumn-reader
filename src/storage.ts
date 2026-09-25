export type BookFormat = "pdf" | "epub";

export type BookNote = {
  id: string;
  quote: string;
  text: string;
  color: string;
  createdAt: number;
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
  page: number;
  cfi: string | null;
  fontSize: number;
  notes?: BookNote[];
}

const DATABASE_NAME = "autumn-reader";
const STORE_NAME = "books";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runRequest<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export async function listBooks(): Promise<StoredBook[]> {
  const books = await runRequest("readonly", (store) => store.getAll());
  return (books as StoredBook[]).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function saveBook(book: StoredBook): Promise<IDBValidKey> {
  return runRequest("readwrite", (store) => store.put(book));
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

export function deleteBook(id: string): Promise<undefined> {
  return runRequest("readwrite", (store) => store.delete(id));
}
