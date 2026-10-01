import { auth } from "../auth";
import { folders } from "../folders";
import { localAll, localGet, localPut } from "../local/database";
import { bookCache, bookStorage, type UploadProgress } from "../storage";
import { cloudLocalId, noteCloudId } from "../books/models";
import {
  saveBook,
  listBooks,
  readLocalBookBlob,
  readBookCover,
  type StoredBook,
} from "../../storage";
import { errorMessage, CloudError } from "../errors";
import { sync } from "./index";
import { t } from "../../i18n";
import { privateCoverPath } from "../storage/book-covers";
export interface MigrationState {
  id: string;
  ownerId: string;
  localId: string;
  phase: "pending" | "uploaded" | "complete" | "error" | "cancelled";
  bookId?: string;
  hash?: string;
  format?: "epub" | "pdf";
  error?: string;
  errorCode?: string;
  updatedAt: number;
}
export function migrationKey(owner: string, local: string): string {
  return `${owner}:${local}`;
}
export async function migrationRemaining(
  owner: string,
  books: StoredBook[],
): Promise<StoredBook[]> {
  const states = await localAll<MigrationState>("migration_state");
  return books.filter(
    (book) =>
      !book.cloudId && (!book.ownerId || book.ownerId === owner) &&
      !states.some(
        (s) =>
          s.ownerId === owner &&
          s.localId === book.id &&
          s.phase === "complete",
      ),
  );
}
let running = false;
let activeController: AbortController | undefined;
export function cancelMigration(): void {
  activeController?.abort();
}
export function migrationIsRunning(): boolean {
  return running;
}
export async function migrateLibrary(
  books: StoredBook[],
  signal: AbortSignal,
  onProgress: (progress: UploadProgress) => void,
): Promise<{ done: number; failed: number }> {
  if (running) throw new Error(t("migrationRunning"));
  running = true;
  const externalSignal = signal;
  activeController = new AbortController();
  const abort = () => activeController?.abort();
  externalSignal.addEventListener("abort", abort, { once: true });
  if (externalSignal.aborted) abort();
  signal = activeController.signal;
  const notifyProgress = (progress: UploadProgress) => {
    onProgress(progress);
    window.dispatchEvent(
      new CustomEvent("autumn-upload-progress", { detail: progress }),
    );
  };
  let done = 0,
    failed = 0;
  try {
    const owner = auth.requireUser();
    const candidates = await migrationRemaining(owner, books);
    // Record consent for every selected book before network work, so a suspended app can resume it.
    for (const original of candidates) {
      const id = migrationKey(owner, original.id);
      const previous = await localGet<MigrationState>("migration_state", id);
      if (!previous || previous.phase === "cancelled")
        await localPut("migration_state", {
          ...previous,
          id,
          ownerId: owner,
          localId: original.id,
          phase: "pending",
          updatedAt: Date.now(),
        });
    }
    for (const original of candidates) {
      if (signal.aborted) break;
      const id = migrationKey(owner, original.id);
      let state = await localGet<MigrationState>("migration_state", id);
      try {
        if (!state?.bookId) {
          const upload = await bookStorage.upload(original, {
            signal,
            onProgress: notifyProgress,
          });
          state = {
            id,
            ownerId: owner,
            localId: original.id,
            phase: "uploaded",
            bookId: upload.bookId,
            hash: upload.hash,
            format: upload.format,
            updatedAt: Date.now(),
          };
          await localPut("migration_state", state);
        }
        if (auth.state.ownerId !== owner)
          throw new CloudError("session_expired");
        const cloneId = cloudLocalId(owner, state.bookId!);
        const existing = await bookCache.get(cloneId);
        if (cloneId === original.id) {
          // Re-uploading a formerly cloud-backed local book should restore
          // its authorization in place. Cloning it into its own id would make
          // migrationSources self-referential and hide it from Library.
          const local = (await bookCache.get(original.id)) ?? original;
          await saveBook({
            ...local,
            cloudId: state.bookId,
            fileHash: state.hash,
            format: state.format ?? local.format,
            coverPath: local.customCover ? privateCoverPath(owner, state.bookId!) : local.coverPath,
            coverUploadedPath: undefined,
            userUpdatedAt: Date.now(),
          }, { preserveTimestamps: true });
        } else if (!existing?.migrationSources?.includes(original.id)) {
          const local = (await bookCache.get(original.id)) ?? original;
          const clone: StoredBook = {
            ...local,
            id: cloneId,
            ownerId: owner,
            cloudId: state.bookId,
            fileHash: state.hash,
            format: state.format ?? local.format,
            data: await readLocalBookBlob(local),
            cover: await readBookCover(local),
            coverPath: local.customCover ? privateCoverPath(owner, state.bookId!) : null,
            coverUploadedPath: undefined,
            nativeDataPath: undefined,
            nativeCoverPath: undefined,
            progressUpdatedAt:
              local.progressUpdatedAt ?? (local.lastOpenedAt || local.addedAt),
            userUpdatedAt: Date.now(),
            status: local.status ?? (local.lastOpenedAt ? "reading" : "unread"),
          };
          const imported = (local.notes ?? []).map((note) => ({
            ...note,
            id: noteCloudId(owner, state!.bookId!, note),
            cloudId: noteCloudId(owner, state!.bookId!, note),
          }));
          const notes = new Map((existing?.notes ?? []).map((n) => [n.id, n]));
          for (const note of imported) {
            const old = notes.get(note.id);
            if (
              !old ||
              (note.updatedAt ?? note.createdAt) >
                (old.updatedAt ?? old.createdAt)
            )
              notes.set(note.id, note);
          }
          clone.notes = [...notes.values()];
          clone.migrationSources = [
            ...(existing?.migrationSources ?? []),
            original.id,
          ];
          if (
            existing &&
            (existing.progressUpdatedAt ?? 0) > (clone.progressUpdatedAt ?? 0)
          )
            Object.assign(clone, {
              page: existing.page,
              cfi: existing.cfi,
              percentage: existing.percentage,
              pdfTextOffset: existing.pdfTextOffset,
              fontSize: existing.fontSize,
              progressUpdatedAt: existing.progressUpdatedAt,
            });
          await saveBook(clone, { preserveTimestamps: true });
          await folders.migrateMembership(original, clone);
        }
        await localPut("migration_state", {
          ...state,
          phase: "complete",
          error: undefined,
          updatedAt: Date.now(),
        });
        done++;
      } catch (error: unknown) {
        if (signal.aborted) break;
        failed++;
        window.dispatchEvent(new CustomEvent("autumn-migration-error", { detail: { book: original.name, bookId: original.id, message: errorMessage(error) } }));
        await localPut("migration_state", {
          ...state,
          id,
          ownerId: owner,
          localId: original.id,
          phase: "error",
          error: errorMessage(error),
          errorCode: error instanceof CloudError ? error.code : undefined,
          updatedAt: Date.now(),
        });
      }
    }
    if (signal.aborted) {
      for (const original of candidates) {
        const id = migrationKey(owner, original.id);
        const current = await localGet<MigrationState>("migration_state", id);
        if (current && current.phase !== "complete")
          await localPut("migration_state", {
            ...current,
            phase: "cancelled",
            updatedAt: Date.now(),
          });
      }
    }
    await sync.flush(true);
    return { done, failed };
  } finally {
    running = false;
    activeController = undefined;
    externalSignal.removeEventListener("abort", abort);
    window.dispatchEvent(new Event("autumn-migration-finished"));
  }
}
async function approvedBooks(retryQuota: boolean): Promise<StoredBook[]> {
  const owner = auth.state.ownerId;
  if (
    !owner ||
    auth.state.status !== "authenticated" ||
    !navigator.onLine ||
    running
  )
    return [];
  const states = (await localAll<MigrationState>("migration_state")).filter(
    (state) =>
      state.ownerId === owner &&
      state.phase !== "complete" &&
      state.phase !== "cancelled" &&
      !["too_large", "invalid_format", "corrupt_epub", "corrupt_pdf", "unrecognized_format"].includes(state.errorCode ?? "") &&
      (retryQuota || !["quota_exceeded", "book_limit", "storage_limit", "pending_upload_limit", "upload_rate_limited"].includes(state.errorCode ?? "")),
  );
  if (!states.length) return [];
  const ids = new Set(states.map((s) => s.localId));
  return (await listBooks(owner, true)).filter((book) => ids.has(book.id));
}
export async function resumeApprovedMigrations(): Promise<boolean> {
  const books = await approvedBooks(false);
  if (!books.length) return false;
  await migrateLibrary(books, new AbortController().signal, () => {});
  return true;
}
export async function retryApprovedMigrations(): Promise<{ done: number; failed: number } | null> {
  const books = await approvedBooks(true);
  return books.length ? migrateLibrary(books, new AbortController().signal, () => {}) : null;
}
