import type { StoredBook } from "../../storage";

/** A personal edit wins over metadata extracted from the file and the filename. */
export function bookDisplayTitle(book: StoredBook): string {
  return book.displayTitle?.trim() || book.contentTitle?.trim() || book.name.replace(/\.(pdf|epub)$/i, "");
}
