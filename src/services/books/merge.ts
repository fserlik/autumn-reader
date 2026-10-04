import { openDatabase } from "../local/database";
import type { StoredBook } from "../../storage";
import type { SyncOperation } from "../sync/operations";
import type { Note } from "../types";
import { noteCloudId, toLocalNote } from "./models";
import { auth } from "../auth";
import { t } from "../../i18n";
/** Apply a remote snapshot atomically against local edits and their outbox. */
export async function mergeRemoteBook(
  remote: StoredBook,
  remoteNotes?: Note[],
): Promise<StoredBook> {
  if (!remote.ownerId || auth.state.ownerId !== remote.ownerId) throw new Error(t("bookOtherAccount"));
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
        ["books", "pending_sync_operations"],
        "readwrite",
      ),
      store = tx.objectStore("books");
    const read = store.get(remote.id),
      readOps = tx.objectStore("pending_sync_operations").getAll();
    let result = remote;
    let ready = 0;
    const merge = () => {
      if (++ready !== 2) return;
      if (auth.state.ownerId !== remote.ownerId) { tx.abort(); return; }
      const local = read.result as StoredBook | undefined;
      if (local && local.ownerId !== remote.ownerId) { tx.abort(); return; }
      const pending = (readOps.result as SyncOperation[]).filter(
        (op) => op.ownerId === remote.ownerId && op.bookId === remote.cloudId,
      );
      if (local) {
        const sameFile = !remote.fileHash || !local.fileHash || remote.fileHash === local.fileHash;
        if (sameFile) remote.data = local.data;
        else { remote.data = new Blob(); remote.nativeDataPath = undefined; }
        if (!remote.coverPath || remote.coverPath === local.coverPath) remote.cover = local.cover;
        remote.contentTitle = local.contentTitle;
        remote.contentAuthor = local.contentAuthor;
        remote.contentMetadataVersion = local.contentMetadataVersion;
        if (sameFile) remote.nativeDataPath = local.nativeDataPath;
        remote.nativeCoverPath = local.nativeCoverPath;
        if (sameFile) { remote.fileHash ??= local.fileHash; remote.fileSize ??= local.fileSize; }
        remote.migrationSources = local.migrationSources;
        if (remote.coverPath === local.coverPath) remote.coverUploadedPath = local.coverUploadedPath;
        remote.updatedAt = local.updatedAt;
        if (!remoteNotes) remote.notes = local.notes;
        if (
          pending.some((p) => p.entity === "progress") ||
          (local.progressUpdatedAt ?? 0) > (remote.progressUpdatedAt ?? 0)
        )
          Object.assign(remote, {
            page: local.page,
            cfi: local.cfi,
            percentage: local.percentage,
            pdfTextOffset: local.pdfTextOffset,
            fontSize: local.fontSize,
            progressUpdatedAt: local.progressUpdatedAt,
          });
        if (
          pending.some((p) => p.entity === "user_book") ||
          (local.userUpdatedAt ?? 0) > (remote.userUpdatedAt ?? 0)
        )
          Object.assign(remote, {
            favorite: local.favorite,
            status: local.status,
            lastOpenedAt: local.lastOpenedAt,
            deletedAt: local.deletedAt,
            userUpdatedAt: local.userUpdatedAt,
          });
        if (
          pending.some((p) => p.entity === "book_metadata") ||
          (local.metadataUpdatedAt ?? 0) > (remote.metadataUpdatedAt ?? 0)
        ) Object.assign(remote, {
          displayTitle: local.displayTitle,
          author: local.author,
          cover: local.cover,
          customCover: local.customCover,
          coverPath: local.coverPath,
          metadataUpdatedAt: local.metadataUpdatedAt,
        });
      }
      if (remoteNotes) {
        const ids = new Set(
          pending.filter((p) => p.entity === "note").map((p) => p.entityId),
        );
        remote.notes = [
          ...remoteNotes
            .filter((n) => !n.deleted_at && !ids.has(n.id))
            .map(toLocalNote),
          ...(local?.notes ?? []).filter((n) =>
            ids.has(noteCloudId(remote.ownerId!, remote.cloudId!, n)),
          ),
        ];
      }
      result = remote;
      store.put(remote);
    };
    read.onsuccess = readOps.onsuccess = merge;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
