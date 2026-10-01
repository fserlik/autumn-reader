import type { StoredBook } from "../../storage";
import { noteCloudId, toCloudNote } from "../books/models";
import { newUuid } from "../platform/ids";
export type SyncEntity = "progress" | "user_book" | "book_metadata" | "note" | "folder" | "folder_book";
export interface SyncOperation {
  id: string;
  ownerId: string;
  bookId: string;
  entity: SyncEntity;
  entityId: string;
  payload: Record<string, unknown>;
  version: string;
  attempts: number;
  retryAt: number;
  error?: string;
}
const progressFields = (b: StoredBook) => [
  b.page,
  b.cfi,
  b.percentage ?? 0,
  b.pdfTextOffset ?? 0,
  b.fontSize,
];
const userFields = (b: StoredBook) => [
  Boolean(b.favorite),
  b.status ?? "unread",
  b.lastOpenedAt,
  b.deletedAt ?? null,
];
const metadataFields = (b: StoredBook) => [b.displayTitle ?? null, b.author ?? "", b.coverPath ?? null];
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function operationsForBook(
  book: StoredBook,
  previous: StoredBook | undefined,
  stamp: number,
  preserveTimestamps = false,
): SyncOperation[] {
  // A local copy that is reauthorized in the cloud must enqueue its full
  // retained reading state, even if no visible field changed during upload.
  if (previous?.cloudId !== book.cloudId) previous = undefined;
  const ownerId = book.ownerId,
    bookId = book.cloudId;
  if (!ownerId || !bookId) return [];
  const result: SyncOperation[] = [];
  const add = (
    entity: SyncEntity,
    entityId: string,
    payload: Record<string, unknown>,
  ) =>
    result.push({
      id: `${ownerId}:${entity}:${entityId}`,
      ownerId,
      bookId,
      entity,
      entityId,
      payload,
      version: newUuid(),
      attempts: 0,
      retryAt: 0,
    });
  if (!previous || !equal(progressFields(book), progressFields(previous))) {
    book.progressUpdatedAt = preserveTimestamps
      ? (book.progressUpdatedAt ?? stamp)
      : stamp;
    add("progress", bookId, {
      user_id: ownerId,
      book_id: bookId,
      page: book.page,
      cfi: book.cfi,
      percentage: book.percentage ?? 0,
      pdf_text_offset: book.pdfTextOffset ?? 0,
      font_size: book.fontSize,
      updated_at: new Date(book.progressUpdatedAt).toISOString(),
    });
  }
  if (!previous || !equal(userFields(book), userFields(previous))) {
    book.userUpdatedAt = preserveTimestamps
      ? (book.userUpdatedAt ?? stamp)
      : stamp;
    add("user_book", bookId, {
      user_id: ownerId,
      book_id: bookId,
      favorite: Boolean(book.favorite),
      status: book.status ?? "unread",
      last_opened_at: book.lastOpenedAt
        ? new Date(book.lastOpenedAt).toISOString()
        : null,
      deleted_at: book.deletedAt
        ? new Date(book.deletedAt).toISOString()
        : null,
      updated_at: new Date(book.userUpdatedAt).toISOString(),
    });
  }
  if ((book.displayTitle !== undefined || book.customCover || previous?.displayTitle !== undefined) &&
      (!previous || !equal(metadataFields(book), metadataFields(previous)))) {
    book.metadataUpdatedAt = preserveTimestamps ? (book.metadataUpdatedAt ?? stamp) : stamp;
    add("book_metadata", bookId, {
      user_id: ownerId, book_id: bookId,
      title: book.displayTitle ?? book.name.replace(/\.(epub|pdf)$/i, ""),
      author: book.author ?? "", cover_path: book.coverPath ?? null,
      updated_at: new Date(book.metadataUpdatedAt).toISOString(),
    });
  }
  const oldNotes = new Map(
    (previous?.notes ?? []).map((n) => [noteCloudId(ownerId, bookId, n), n]),
  );
  for (const note of book.notes ?? []) {
    const id = noteCloudId(ownerId, bookId, note),
      old = oldNotes.get(id);
    oldNotes.delete(id);
    if (
      !old ||
      !equal(
        [note.text, note.color, note.quote],
        [old.text, old.color, old.quote],
      )
    ) {
      note.updatedAt = preserveTimestamps
        ? (note.updatedAt ?? note.createdAt)
        : stamp;
      add("note", id, { ...toCloudNote(book, note, note.updatedAt) });
    }
  }
  for (const old of oldNotes.values())
    add("note", noteCloudId(ownerId, bookId, old), {
      ...toCloudNote(book, old, stamp, true),
    });
  return result;
}
