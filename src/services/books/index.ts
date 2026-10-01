import { auth } from "../auth";
import { t } from "../../i18n";
import { cloud, checkError } from "../client";
import { bookCache } from "../storage";
import { fromCloudBook } from "./models";
import { mergeRemoteBook } from "./merge";
import type { StoredBook } from "../../storage";
import type { Book, CloudStorageBook, Note, ReadingProgress, UserBook } from "../types";
export const LIBRARY_PAGE_SIZE = 50;
export const library = {
  async cloudStoragePage(offset = 0, sort: "recent" | "size" | "title" = "recent"): Promise<{ books: CloudStorageBook[]; hasMore: boolean }> {
    auth.requireUser();
    const { data, error } = await cloud().rpc("cloud_storage_books", { p_offset: offset, p_limit: LIBRARY_PAGE_SIZE, p_sort: sort });
    checkError(error);
    return { books: data ?? [], hasMore: (data?.length ?? 0) === LIBRARY_PAGE_SIZE };
  },
  async quota(): Promise<{ used_books: number; max_books: number; used_bytes: number; max_bytes: number;
    active_pending_uploads?: number; reserved_bytes?: number; recent_unique_uploads?: number;
    expired_reservations?: number; max_pending_uploads?: number }> {
    auth.requireUser();
    const { data, error } = await cloud().rpc("library_quota", {});
    checkError(error);
    if (!data) throw new Error(t("quotaLoadFailed"));
    return data;
  },
  async page(offset = 0, collection?: "favorites" | "finished"): Promise<{ books: StoredBook[]; hasMore: boolean }> {
    const user = auth.requireUser();
    let query = cloud()
      .from("user_books")
      .select("*")
      .eq("user_id", user)
      .is("deleted_at", null);
    if (collection === "favorites") query = query.eq("favorite", true);
    if (collection === "finished") query = query.eq("status", "finished");
    const { data: relations, error } = await query.order("added_at", { ascending: false })
      .order("id")
      .range(offset, offset + LIBRARY_PAGE_SIZE - 1);
    checkError(error);
    const rows = relations ?? [];
    if (!rows.length) return { books: [], hasMore: false };
    const ids = rows.map((u) => u.book_id);
    const [metadata, progress] = await Promise.all([
      cloud().from("books").select("*").in("id", ids),
      cloud()
        .from("reading_progress")
        .select("*")
        .eq("user_id", user)
        .in("book_id", ids),
    ]);
    checkError(metadata.error);
    checkError(progress.error);
    const books: StoredBook[] = [];
    for (const row of rows) {
      const book = metadata.data?.find((b) => b.id === row.book_id);
      if (!book) continue;
      const local = await bookCache.get(`cloud-${user}-${book.id}`);
      const remote = fromCloudBook(
        book,
        row,
        progress.data?.find((p) => p.book_id === book.id),
        local,
      );
      if (auth.state.ownerId !== user) return { books: [], hasMore: false };
      books.push(await mergeRemoteBook(remote));
    }
    return { books, hasMore: rows.length === LIBRARY_PAGE_SIZE };
  },
  async refreshBook(local: StoredBook): Promise<StoredBook> {
    const user = auth.requireUser();
    if (local.ownerId !== user || !local.cloudId) return local;
    const [
      { data: row, error: ue },
      { data: book, error: be },
      { data: progress, error: pe },
    ] = await Promise.all([
      cloud()
        .from("user_books")
        .select("*")
        .eq("user_id", user)
        .eq("book_id", local.cloudId)
        .maybeSingle(),
      cloud().from("books").select("*").eq("id", local.cloudId).single(),
      cloud()
        .from("reading_progress")
        .select("*")
        .eq("user_id", user)
        .eq("book_id", local.cloudId)
        .maybeSingle(),
    ]);
    checkError(ue);
    checkError(be);
    checkError(pe);
    if (!book || !row) throw new Error(t("errorForbidden"));
    if (row.deleted_at) {
      const removed = { ...local, deletedAt: Date.parse(row.deleted_at) };
      await bookCache.put(removed);
      return removed;
    }
    const notes: Note[] = [];
    // Only the book being opened; paginated to avoid PostgREST's default row limit.
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await cloud()
        .from("notes")
        .select("*")
        .eq("user_id", user)
        .eq("book_id", local.cloudId)
        .order("id")
        .range(offset, offset + 99);
      checkError(error);
      notes.push(...(data ?? []));
      if ((data?.length ?? 0) < 100) break;
    }
    const updated = fromCloudBook(book, row, progress, local);
    if (auth.state.ownerId !== user) return local;
    return mergeRemoteBook(updated, notes);
  },
};
export type LibraryRows = {
  book: Book;
  relation: UserBook;
  progress: ReadingProgress | null;
};
