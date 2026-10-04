import { folders } from "../folders";
import { localGet, localPut, openDatabase } from "../local/database";
import { bookCache } from "../storage";
import { hashBlob } from "../storage/hash";
import { privateCoverPath } from "../storage/book-covers";
import { hasLocalFile, listBooks, readLocalBookBlob, saveBook, type BookNote, type StoredBook } from "../../storage";
import { noteCloudId } from "./models";
import { auth } from "../auth";
import { t } from "../../i18n";

const validHash = (hash: string | undefined): hash is string => Boolean(hash && /^[a-f0-9]{64}$/.test(hash));

/** Historical IndexedDB/native rows are hashed once, without changing reading timestamps or queuing cloud edits. */
export async function ensureBookHash(book: StoredBook): Promise<string | undefined> {
  if (!book.ownerId || book.ownerId !== auth.state.ownerId) throw new Error(t("bookOtherAccount"));
  if (validHash(book.fileHash)) return book.fileHash;
  if (!hasLocalFile(book)) return undefined;
  const blob = await readLocalBookBlob(book);
  const hash = await hashBlob(blob);
  const latest = await bookCache.get(book.id);
  if (!latest) await bookCache.put({ ...book, fileHash: hash, fileSize: blob.size });
  else if (!validHash(latest.fileHash) && !latest.deletedAt &&
      (latest.nativeDataSize ?? latest.data.size) === (book.nativeDataSize ?? book.data.size))
    await bookCache.put({ ...latest, fileHash: hash, fileSize: blob.size });
  book.fileHash = hash;
  book.fileSize = blob.size;
  return hash;
}

function mergedNotes(source: StoredBook, target: StoredBook): BookNote[] {
  const key = (note: BookNote) => target.cloudId && target.ownerId
    ? noteCloudId(target.ownerId, target.cloudId, note) : note.id;
  const notes = new Map((target.notes ?? []).map(note => [key(note), note]));
  for (const note of source.notes ?? []) {
    const id = key(note), old = notes.get(id);
    if (!old || (note.updatedAt ?? note.createdAt) > (old.updatedAt ?? old.createdAt))
      notes.set(id, target.cloudId ? { ...note, id, cloudId: id } : note);
  }
  return [...notes.values()];
}

/** Preserve the source record as a recoverable local backup; hide it only after the merged target is durable. */
export async function mergeBookIdentity(source: StoredBook, target: StoredBook, owner: string | null): Promise<StoredBook> {
  if (!owner || auth.state.ownerId !== owner || source.ownerId !== owner || target.ownerId !== owner)
    throw new Error(t("bookOtherAccount"));
  if (source.id === target.id) return target;
  const merged: StoredBook = { ...target };
  if (!hasLocalFile(merged) && hasLocalFile(source)) {
    merged.data = source.data;
    merged.nativeDataPath = source.nativeDataPath;
    merged.nativeDataSize = source.nativeDataSize;
  }
  merged.fileHash = target.fileHash ?? source.fileHash;
  merged.fileSize = target.fileSize ?? source.fileSize;
  merged.contentTitle ??= source.contentTitle;
  merged.contentAuthor ??= source.contentAuthor;
  merged.contentMetadataVersion ??= source.contentMetadataVersion;
  if (!merged.displayTitle && merged.contentAuthor && !target.displayTitle)
    merged.author = merged.contentAuthor;
  if (!merged.cover && !merged.coverPath && source.cover) merged.cover = source.cover;
  if (!merged.nativeCoverPath && source.nativeCoverPath && !merged.customCover)
    merged.nativeCoverPath = source.nativeCoverPath;
  const sourceMetadataTime = source.metadataUpdatedAt ??
    ((source.displayTitle !== undefined || source.customCover) ? source.updatedAt ?? 0 : 0);
  if (sourceMetadataTime > (target.metadataUpdatedAt ?? 0)) {
    merged.displayTitle = source.displayTitle;
    merged.author = source.author;
    merged.customCover = source.customCover;
    merged.cover = source.cover;
    merged.coverPath = source.customCover && target.cloudId && owner
      ? privateCoverPath(owner, target.cloudId) : source.coverPath;
    merged.coverUploadedPath = source.customCover && target.cloudId ? undefined : source.coverUploadedPath;
    merged.metadataUpdatedAt = sourceMetadataTime;
  }
  if ((source.progressUpdatedAt ?? source.lastOpenedAt ?? 0) > (target.progressUpdatedAt ?? target.lastOpenedAt ?? 0)) {
    merged.page = source.page; merged.cfi = source.cfi; merged.percentage = source.percentage;
    merged.pdfTextOffset = source.pdfTextOffset; merged.fontSize = source.fontSize;
    merged.progressUpdatedAt = source.progressUpdatedAt ?? source.lastOpenedAt;
  }
  const sourceUserTime = source.userUpdatedAt ?? source.updatedAt ?? source.lastOpenedAt ?? 0;
  if (sourceUserTime > (target.userUpdatedAt ?? target.lastOpenedAt ?? 0)) {
    merged.favorite = Boolean(source.favorite);
    merged.status = source.status ?? (source.lastOpenedAt ? "reading" : "unread");
    merged.lastOpenedAt = source.lastOpenedAt;
    merged.userUpdatedAt = sourceUserTime;
  }
  merged.notes = mergedNotes(source, target);
  merged.addedAt = Math.min(source.addedAt, target.addedAt);
  merged.migrationSources = [...new Set([...(target.migrationSources ?? []), source.id, ...(source.migrationSources ?? [])])];
  await saveBook(merged, { preserveTimestamps: true });
  if (owner) {
    await folders.migrateMembership(source, merged);
    const id = `${owner}:${source.id}`;
    const previous = await localGet<Record<string, unknown>>("migration_state", id);
    await localPut("migration_state", { ...previous, id, ownerId: owner, localId: source.id,
      phase: "complete", bookId: merged.cloudId, hash: merged.fileHash, format: merged.format,
      updatedAt: Date.now() });
    if (!target.cloudId) await bookCache.put({ ...source, duplicateOf: target.id });
  }
  return merged;
}

/** Reconcile local legacy duplicates and persist missing hashes before cloud matching. */
export async function reconcileLocalLibrary(owner: string | null): Promise<StoredBook[]> {
  if (!owner || auth.state.ownerId !== owner) return [];
  const visible = await listBooks(owner);
  for (const book of visible) {
    if (auth.state.ownerId !== owner) return [];
    await ensureBookHash(book);
  }
  const byHash = new Map<string, StoredBook>();
  for (const book of visible) {
    if (auth.state.ownerId !== owner) return [];
    if (!validHash(book.fileHash)) continue;
    const existing = byHash.get(book.fileHash);
    if (!existing) { byHash.set(book.fileHash, book); continue; }
    const preferBook = Number(Boolean(book.cloudId)) * 4 + Number(hasLocalFile(book)) * 2;
    const preferExisting = Number(Boolean(existing.cloudId)) * 4 + Number(hasLocalFile(existing)) * 2;
    const target = preferBook > preferExisting ? book : existing;
    const source = target === book ? existing : book;
    byHash.set(book.fileHash, await mergeBookIdentity(source, target, owner));
  }
  return listBooks(owner);
}

/** All file picker and Android SAF imports use this single atomic identity check. */
export async function importUniqueBook(book: StoredBook): Promise<{ imported: boolean; book: StoredBook }> {
  const owner = book.ownerId ?? null;
  if (!owner || auth.state.ownerId !== owner) throw new Error(t("bookOtherAccount"));
  await reconcileLocalLibrary(owner);
  book.fileHash = await hashBlob(book.data);
  if (auth.state.ownerId !== owner) throw new Error(t("bookOtherAccount"));
  book.fileSize = book.data.size;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("books", "readwrite"), store = tx.objectStore("books"), read = store.getAll();
    let result: { imported: boolean; book: StoredBook } = { imported: true, book };
    read.onsuccess = () => {
      if (auth.state.ownerId !== owner) { tx.abort(); return; }
      const existing = (read.result as StoredBook[]).find(item => !item.deletedAt && !item.duplicateOf &&
        item.ownerId === owner && item.fileHash === book.fileHash);
      if (existing) result = { imported: false, book: existing };
      else store.add(book);
    };
    tx.oncomplete = () => { db.close(); if (result.imported) window.dispatchEvent(new Event("autumn-local-change")); resolve(result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
