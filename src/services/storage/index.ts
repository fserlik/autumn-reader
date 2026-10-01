import { auth } from "../auth";
import { cloud } from "../client";
import { CloudError, requireOnline, type CloudErrorCode } from "../errors";
import { localGet, localPut, openDatabase } from "../local/database";
import { hashBlob } from "./hash";
import {
  hasLocalFile,
  readLocalBookBlob,
  saveBook,
  type StoredBook,
} from "../../storage";
import {
  MAX_CLOUD_BOOK_BYTES,
  identifyBookFile,
} from "../../../shared/book-file";
import { withTimeout } from "../platform/network";
import { t } from "../../i18n";
import type { CloudUsage } from "../types";

export type UploadStage =
  "hashing" | "checking" | "uploading" | "saving" | "synced";
export interface UploadProgress {
  stage: UploadStage;
  percentage?: number;
  book: string;
  bookId?: string;
}
export interface BookCache {
  get(id: string): Promise<StoredBook | undefined>;
  put(book: StoredBook): Promise<void>;
  read(book: StoredBook): Promise<Blob>;
}
export const bookCache: BookCache = {
  get: (id) => localGet<StoredBook>("books", id),
  async put(book) {
    try {
      await localPut("books", book);
    } catch (error) {
      if (error instanceof DOMException && error.name === "QuotaExceededError")
        throw new CloudError(
          "quota_exceeded",
          t("errorLocalSpace"),
        );
      throw error;
    }
  },
  read: readLocalBookBlob,
};
export async function requestPersistentCache(): Promise<{
  persistent: boolean;
  usage?: number;
  quota?: number;
}> {
  const persistent =
    (await navigator.storage?.persist?.().catch(() => false)) ?? false;
  const estimate = await navigator.storage?.estimate?.().catch(() => ({}));
  return { persistent, ...estimate };
}
const codes: CloudErrorCode[] = [
  "offline",
  "session_expired",
  "upload_failed",
  "too_large",
  "invalid_format",
  "corrupt_epub",
  "corrupt_pdf",
  "unrecognized_format",
  "storage_unavailable",
  "cloud_unavailable",
  "conflict",
  "quota_exceeded",
  "book_limit",
  "storage_limit",
  "pending_upload_limit",
  "upload_rate_limited",
  "forbidden",
  "not_configured",
  "cancelled",
];
async function backend<T>(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  requireOnline();
  auth.requireUser();
  const { data, error } = await cloud().functions.invoke<T>("book-storage", {
    body,
    signal,
  });
  if (error) {
    const context: unknown = "context" in error ? error.context : null;
    if (context instanceof Response) {
      const value: unknown = await context.json().catch(() => null);
      if (
        value &&
        typeof value === "object" &&
        "code" in value &&
        codes.includes(value.code as CloudErrorCode)
      ) {
        if (value.code === "session_expired") auth.expire();
        throw new CloudError(value.code as CloudErrorCode);
      }
      if (context.status === 401) {
        auth.expire();
        throw new CloudError("session_expired");
      }
    }
    throw new CloudError(signal?.aborted ? "cancelled" : "cloud_unavailable");
  }
  if (!data) throw new CloudError("cloud_unavailable");
  return data;
}
function uploadBlob(
  url: string,
  headers: Record<string, string>,
  blob: Blob,
  signal?: AbortSignal,
  progress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = 300000;
    for (const [key, value] of Object.entries(headers))
      xhr.setRequestHeader(key, value);
    const abort = () => xhr.abort();
    if (signal?.aborted) {
      reject(new CloudError("cancelled"));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress?.((100 * event.loaded) / event.total);
    };
    xhr.onload = () => {
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 412)
        resolve();
      else reject(new CloudError("upload_failed"));
    };
    xhr.onerror = xhr.ontimeout = () =>
      reject(new CloudError("storage_unavailable"));
    xhr.onabort = () => reject(new CloudError("cancelled"));
    xhr.onloadend = () => signal?.removeEventListener("abort", abort);
    xhr.send(blob);
  });
}
export const bookStorage = {
  removeCloud(bookId: string): Promise<{ removed: boolean; usage: CloudUsage }> {
    return backend({ action: "remove", bookId });
  },
  async upload(
    book: StoredBook,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: UploadProgress) => void;
    } = {},
  ): Promise<{ bookId: string; hash: string; format: "epub" | "pdf" }> {
    const user = auth.requireUser();
    const { signal, onProgress } = options;
    const stage = (stage: UploadStage, percentage?: number) =>
      onProgress?.({ stage, percentage, book: book.name, bookId: book.id });
    if ((book.nativeDataSize ?? book.data.size) > MAX_CLOUD_BOOK_BYTES)
      throw new CloudError("too_large");
    const blob = await bookCache.read(book);
    if (!blob.size || blob.size > MAX_CLOUD_BOOK_BYTES)
      throw new CloudError("too_large");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const format = identifyBookFile(bytes);
    if (!format) {
      const hint = book.format === "pdf" || book.format === "epub" ? book.format
        : /\.pdf$/i.test(book.name) || blob.type === "application/pdf" ? "pdf"
        : /\.epub$/i.test(book.name) || blob.type === "application/epub+zip" ? "epub" : null;
      throw new CloudError(hint === "epub" ? "corrupt_epub" : hint === "pdf" ? "corrupt_pdf" : "unrecognized_format");
    }
    if (signal?.aborted) throw new CloudError("cancelled");
    // Older IndexedDB rows may lack a reliable format or Blob.type. Repair
    // their metadata without changing the file bytes used for deduplication.
    if (book.format !== format) { book.format = format; await saveBook(book); }
    stage("hashing");
    const hash = await hashBlob(blob, signal);
    stage("checking");
    const prepared = await backend<{
      bookId?: string;
      intentId?: string;
      url?: string;
      headers?: Record<string, string>;
    }>(
      {
        action: "prepare",
        hash,
        format,
        size: blob.size,
        title: book.displayTitle?.trim() || book.name.replace(/\.(epub|pdf)$/i, ""),
        author: book.author ?? "",
      },
      signal,
    );
    let bookId = prepared.bookId;
    if (!bookId) {
      if (!prepared.url || !prepared.headers || !prepared.intentId)
        throw new CloudError("upload_failed");
      stage("uploading", 0);
      await uploadBlob(
        prepared.url,
        prepared.headers,
        blob,
        signal,
        (percent) => stage("uploading", percent),
      );
      stage("saving");
      const done = await backend<{ bookId: string }>(
        { action: "complete", intentId: prepared.intentId },
        signal,
      );
      bookId = done.bookId;
    }
    if (auth.state.ownerId !== user) throw new CloudError("session_expired");
    stage("synced", 100);
    return { bookId, hash, format };
  },
  async getBook(book: StoredBook): Promise<StoredBook> {
    if (book.ownerId && auth.state.ownerId !== book.ownerId)
      throw new CloudError("forbidden");
    if (hasLocalFile(book)) return book;
    const cached = await bookCache.get(book.id);
    if (cached && hasLocalFile(cached)) return cached;
    const user = auth.requireUser();
    if (!book.cloudId || book.ownerId !== user)
      throw new CloudError("forbidden");
    const download = await backend<{
      url: string;
      hash: string;
      size: number;
      format: string;
    }>({ action: "download", bookId: book.cloudId });
    const response = await withTimeout(
      (signal) => fetch(download.url, { signal }),
      120000,
    ).catch(() => {
      throw new CloudError("storage_unavailable");
    });
    if (!response.ok) throw new CloudError("storage_unavailable");
    if (download.size > MAX_CLOUD_BOOK_BYTES) throw new CloudError("too_large");
    const blob = await response.blob();
    if (blob.size !== download.size || (await hashBlob(blob)) !== download.hash)
      throw new CloudError(
        "conflict",
        t("errorDownloadMismatch"),
      );
    if (auth.state.ownerId !== user) throw new CloudError("session_expired");
    // Download can finish after a local note/page edit. Commit only file fields against the latest row.
    const db = await openDatabase();
    return new Promise<StoredBook>((resolve, reject) => {
      const tx = db.transaction("books", "readwrite"),
        store = tx.objectStore("books"),
        read = store.get(book.id);
      let updated: StoredBook;
      read.onsuccess = () => {
        updated = {
          ...book,
          ...(read.result as StoredBook | undefined),
          data: blob,
          fileHash: download.hash,
          fileSize: download.size,
        };
        store.put(updated);
      };
      tx.oncomplete = () => {
        db.close();
        resolve(updated);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(
          tx.error?.name === "QuotaExceededError"
            ? new CloudError("quota_exceeded", t("errorLocalSpace"))
            : tx.error,
        );
      };
    });
  },
};
