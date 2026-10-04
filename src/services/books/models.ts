import { sha256 } from "@noble/hashes/sha2.js";
import { t } from "../../i18n";
import type { StoredBook, BookNote } from "../../storage";
import type { Book, UserBook, ReadingProgress, Note } from "../types";
export const cloudLocalId = (owner: string, book: string): string =>
  `cloud-${owner}-${book}`;
export function noteCloudId(
  user: string,
  book: string,
  note: BookNote,
): string {
  if (note.cloudId) return note.cloudId;
  const digest = sha256(
    new TextEncoder().encode(`${user}:${book}:${note.id}`),
  ).slice(0, 16);
  digest[6] = (digest[6] & 15) | 80;
  digest[8] = (digest[8] & 63) | 128;
  const hex = [...digest].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function toCloudNote(
  book: StoredBook,
  note: BookNote,
  stamp: number,
  deleted = false,
): Note {
  if (!book.ownerId || !book.cloudId)
    throw new Error(t("errorForbidden"));
  return {
    id: noteCloudId(book.ownerId, book.cloudId, note),
    user_id: book.ownerId,
    book_id: book.cloudId,
    format: note.format,
    page: note.format === "pdf" ? note.page : null,
    y: note.format === "pdf" ? note.y : null,
    cfi: note.format === "epub" ? note.cfi : null,
    quote: note.quote,
    content: note.text,
    color: note.color,
    created_at: new Date(note.createdAt).toISOString(),
    updated_at: new Date(stamp).toISOString(),
    deleted_at: deleted ? new Date(stamp).toISOString() : null,
  };
}
export function toLocalNote(note: Note): BookNote {
  const common = {
    id: note.id,
    cloudId: note.id,
    quote: note.quote,
    text: note.content,
    color: note.color,
    createdAt: Date.parse(note.created_at),
    updatedAt: Date.parse(note.updated_at),
  };
  return note.format === "pdf"
    ? { ...common, format: "pdf", page: note.page ?? 1, y: note.y ?? 0 }
    : { ...common, format: "epub", cfi: note.cfi ?? "" };
}
export function fromCloudBook(
  book: Book,
  user: UserBook,
  progress?: ReadingProgress | null,
  previous?: StoredBook,
): StoredBook {
  return {
    ...previous,
    id: cloudLocalId(user.user_id, book.id),
    ownerId: user.user_id,
    cloudId: book.id,
    name: `${book.title}.${book.format}`,
    displayTitle: user.display_title ?? undefined,
    author: user.display_author ?? previous?.contentAuthor ?? book.author,
    coverPath: user.cover_path,
    customCover: Boolean(user.cover_path),
    coverUploadedPath: user.cover_path ?? undefined,
    cover: user.cover_path && previous?.coverPath !== user.cover_path ? undefined : previous?.cover,
    metadataUpdatedAt: Date.parse(user.metadata_updated_at ?? "1970-01-01T00:00:00Z"),
    format: book.format,
    data: previous?.data ?? new Blob(),
    addedAt: Date.parse(user.added_at),
    lastOpenedAt: user.last_opened_at ? Date.parse(user.last_opened_at) : 0,
    favorite: user.favorite,
    status: user.status,
    deletedAt: user.deleted_at ? Date.parse(user.deleted_at) : undefined,
    userUpdatedAt: Date.parse(user.updated_at),
    progressUpdatedAt: progress ? Date.parse(progress.updated_at) : 0,
    page: progress?.page ?? 1,
    cfi: progress?.cfi ?? null,
    percentage: progress?.percentage ?? 0,
    fontSize: progress?.font_size ?? 100,
    pdfTextOffset: progress?.pdf_text_offset ?? 0,
    notes: previous?.notes ?? [],
  };
}
