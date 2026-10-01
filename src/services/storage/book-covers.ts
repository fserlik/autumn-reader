import { auth } from "../auth";
import { cloud } from "../client";
import { t } from "../../i18n";
import { optimizeCover } from "./covers";
import { newUuid } from "../platform/ids";
import type { StoredBook } from "../../storage";
import { openDatabase } from "../local/database";

const bucket = "book-covers";
const maxBytes = 512 * 1024;
export async function prepareBookCover(file: Blob): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error(t("editBookCoverInvalid"));
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(t("editBookCoverTooLarge"));
  try { return await optimizeCover(file, 512); }
  catch { throw new Error(t("editBookCoverInvalid")); }
}
export function privateCoverPath(owner: string, bookId: string): string {
  return `${owner}/${bookId}/${newUuid()}.webp`;
}
export async function uploadPrivateCover(book: StoredBook): Promise<void> {
  if (!book.ownerId || !book.cloudId || auth.requireUser() !== book.ownerId || !book.coverPath || !book.cover)
    throw new Error(t("errorForbidden"));
  if (book.coverUploadedPath === book.coverPath) return;
  if (book.cover.type !== "image/webp" || !book.cover.size || book.cover.size > maxBytes)
    throw new Error(t("editBookCoverInvalid"));
  const expected = `${book.ownerId}/${book.cloudId}/`;
  if (!book.coverPath.startsWith(expected)) throw new Error(t("errorForbidden"));
  const { error } = await cloud().storage.from(bucket).upload(book.coverPath, await book.cover.arrayBuffer(), { contentType: "image/webp", upsert: false });
  if (error && String(error.statusCode) !== "409") throw new Error(t("editBookCoverUploadFailed"));
}
export async function markPrivateCoverUploaded(id: string, path: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("books", "readwrite"), store = tx.objectStore("books"), read = store.get(id);
    read.onsuccess = () => {
      const current = read.result as StoredBook | undefined;
      if (current?.coverPath === path) store.put({ ...current, coverUploadedPath: path });
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
export async function downloadPrivateCover(book: StoredBook): Promise<Blob> {
  if (!book.ownerId || !book.cloudId || auth.requireUser() !== book.ownerId ||
      !book.coverPath?.startsWith(`${book.ownerId}/${book.cloudId}/`)) throw new Error(t("errorForbidden"));
  const { data, error } = await cloud().storage.from(bucket).download(book.coverPath);
  if (error || !data || data.size > maxBytes || data.type !== "image/webp") throw new Error(t("editBookCoverDownloadFailed"));
  return data;
}
