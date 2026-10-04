import { auth } from "../auth";
import { cloud, checkError } from "../client";
import { localAll, openDatabase } from "../local/database";
import { newUuid } from "../platform/ids";
import { hexColor } from "../../book-colors";
import type { StoredBook } from "../../storage";
import type { LibraryFolder, FolderMembership } from "../types";
import type { SyncOperation, SyncEntity } from "../sync/operations";
import { t } from "../../i18n";

export interface LocalMembership {
  id: string; ownerId: string; bookLocalId: string; cloudId?: string;
  folderId: string | null; updatedAt: string;
}
const key = (owner: string, book: string): string => `${owner}:${book}`;
function operation(owner: string, entity: SyncEntity, entityId: string, payload: Record<string, unknown>, bookId = ""): SyncOperation {
  return { id: `${owner}:${entity}:${entityId}`, ownerId: owner, bookId, entity, entityId, payload, version: newUuid(), attempts: 0, retryAt: 0 };
}
/** Commit organization and outbox together; no network dependency and no book Blob writes. */
async function transaction(action: (tx: IDBTransaction) => void, notify = true): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["library_folders", "folder_memberships", "pending_sync_operations"], "readwrite");
    action(tx);
    tx.oncomplete = () => { db.close(); if (notify) window.dispatchEvent(new Event("autumn-local-change")); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
function queueMembership(tx: IDBTransaction, value: LocalMembership): void {
  tx.objectStore("folder_memberships").put(value);
  if (value.cloudId) tx.objectStore("pending_sync_operations").put(operation(value.ownerId, "folder_book", value.cloudId, {
    user_id: value.ownerId, book_id: value.cloudId, folder_id: value.folderId, updated_at: value.updatedAt,
  }, value.cloudId));
}
export const folders = {
  async snapshot(owner = auth.state.ownerId): Promise<{ folders: LibraryFolder[]; memberships: LocalMembership[] }> {
    if (!owner || auth.state.ownerId !== owner) return { folders: [], memberships: [] };
    const [all, memberships] = await Promise.all([localAll<LibraryFolder>("library_folders"), localAll<LocalMembership>("folder_memberships")]);
    return { folders: all.filter(f => f.user_id === owner && !f.deleted_at).sort((a,b) => a.name.localeCompare(b.name)), memberships: memberships.filter(m => m.ownerId === owner) };
  },
  async create(name: string, color: string | null = null): Promise<LibraryFolder> {
    const owner = auth.state.ownerId;
    if (!owner) throw new Error(t("folderSignIn"));
    const stamp = new Date().toISOString();
    const folder: LibraryFolder = { id: newUuid(), user_id: owner, name: name.trim(), color, created_at: stamp, updated_at: stamp, deleted_at: null };
    await folders.save(folder); return folder;
  },
  async save(folder: LibraryFolder): Promise<void> {
    if (folder.user_id !== auth.state.ownerId) throw new Error(t("folderOtherAccount"));
    if (!folder.name.trim() || folder.name.trim().length > 100) throw new Error(t("folderNameInvalid"));
    if (folder.color != null && !hexColor(folder.color)) throw new Error(t("folderColorInvalid"));
    if (folder.color) folder.color = hexColor(folder.color);
    await transaction(tx => {
      const store = tx.objectStore("library_folders"), read = store.get(folder.id);
      read.onsuccess = () => {
        const previous = read.result as LibraryFolder | undefined;
        folder.updated_at = new Date(Math.max(Date.now(), Date.parse(previous?.updated_at ?? "") + 1 || 0)).toISOString();
        if (folder.deleted_at) folder.deleted_at = folder.updated_at;
        store.put(folder);
        tx.objectStore("pending_sync_operations").put(operation(folder.user_id, "folder", folder.id, { ...folder }));
        if (folder.deleted_at) {
          const readMembers = tx.objectStore("folder_memberships").getAll();
          readMembers.onsuccess = () => {
            for (const member of readMembers.result as LocalMembership[]) if (member.ownerId === folder.user_id && member.folderId === folder.id)
              queueMembership(tx, { ...member, folderId: null, updatedAt: folder.updated_at });
          };
        }
      };
    });
  },
  async move(book: StoredBook, folderId: string | null): Promise<void> {
    const owner = auth.state.ownerId;
    if (!owner || book.ownerId !== owner) throw new Error(t("bookOtherAccount"));
    await transaction(tx => {
      const assign = (): void => {
        const read = tx.objectStore("folder_memberships").get(key(owner, book.id));
        read.onsuccess = () => {
          const old = read.result as LocalMembership | undefined;
          queueMembership(tx, { id: key(owner, book.id), ownerId: owner, bookLocalId: book.id, cloudId: book.cloudId,
            folderId, updatedAt: new Date(Math.max(Date.now(), Date.parse(old?.updatedAt ?? "") + 1 || 0)).toISOString() });
        };
      };
      if (!folderId) { assign(); return; }
      const read = tx.objectStore("library_folders").get(folderId);
      read.onsuccess = () => {
        const folder = read.result as LibraryFolder | undefined;
        if (!folder || folder.user_id !== owner || folder.deleted_at) { tx.abort(); return; }
        assign();
      };
    });
  },
  async migrateMembership(original: StoredBook, clone: StoredBook): Promise<void> {
    const owner = clone.ownerId!;
    await transaction(tx => {
      const read = tx.objectStore("folder_memberships").get(key(owner, original.id));
      read.onsuccess = () => {
        const old = read.result as LocalMembership | undefined;
        if (!old) return;
        const target = tx.objectStore("folder_memberships").get(key(owner, clone.id));
        target.onsuccess = () => {
          const current = target.result as LocalMembership | undefined;
          if (!current || current.updatedAt < old.updatedAt)
            queueMembership(tx, { ...old, id: key(owner, clone.id), bookLocalId: clone.id, cloudId: clone.cloudId });
        };
      };
    });
  },
  async refresh(bookIds: string[] = []): Promise<void> {
    const owner = auth.state.ownerId;
    if (!owner || auth.state.status !== "authenticated" || !navigator.onLine) return;
    const remoteFolders: LibraryFolder[] = [], remoteMembers: FolderMembership[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await cloud().from("library_folders").select("*").eq("user_id", owner).order("id").range(offset, offset + 99);
      checkError(error); remoteFolders.push(...(data ?? []));
      if ((data?.length ?? 0) < 100) break;
    }
    // Fetch organization only for library metadata already loaded on this device.
    const ids = [...new Set(bookIds)];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data, error } = await cloud().from("library_folder_books").select("*").eq("user_id", owner).in("book_id", ids.slice(offset, offset + 100));
      checkError(error); remoteMembers.push(...(data ?? []));
    }
    if (auth.state.ownerId !== owner) return;
    await transaction(tx => {
      const readOps = tx.objectStore("pending_sync_operations").getAll();
      readOps.onsuccess = () => {
        const pending = new Set((readOps.result as SyncOperation[]).map(op => op.id));
        for (const folder of remoteFolders) {
          const read = tx.objectStore("library_folders").get(folder.id);
          read.onsuccess = () => {
            const old = read.result as LibraryFolder | undefined;
            if (!pending.has(`${owner}:folder:${folder.id}`) && (!old || old.updated_at <= folder.updated_at)) tx.objectStore("library_folders").put(folder);
          };
        }
        for (const member of remoteMembers) {
          const bookLocalId = `cloud-${owner}-${member.book_id}`, id = key(owner, bookLocalId);
          const read = tx.objectStore("folder_memberships").get(id);
          read.onsuccess = () => {
            const old = read.result as LocalMembership | undefined;
            if (!pending.has(`${owner}:folder_book:${member.book_id}`) && (!old || old.updatedAt <= member.updated_at))
              tx.objectStore("folder_memberships").put({ id, ownerId: owner, bookLocalId, cloudId: member.book_id, folderId: member.folder_id, updatedAt: member.updated_at } satisfies LocalMembership);
          };
        }
      };
    }, false);
  },
};
