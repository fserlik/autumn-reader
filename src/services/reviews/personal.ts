import { auth } from "../auth";
import { t } from "../../i18n";
import { cloud, checkError } from "../client";
import { localGet, localPut, localAll } from "../local/database";
import { requireOnline } from "../errors";
import { newUuid } from "../platform/ids";
import { reviews, SOCIAL_PAGE_SIZE } from ".";
import type { Book, Review } from "../types";
import type { StoredBook } from "../../storage";

export interface ReviewEntry { review: Review; book: Book; sourceLocalId?: string }
export interface ReviewDraft {
  id: string; kind: "review-draft"; ownerId: string; bookId: string;
  title: string; author: string; format: "pdf" | "epub"; rating: number; text: string;
  dirty: boolean; updatedAt: number;
  catalogExists: boolean;
}
interface ReviewCache { id: string; ownerId: string; entries: ReviewEntry[] }
const cacheKey = (owner: string): string => `personal-reviews:${owner}`;
const cacheVersions = new Map<string, number>();
async function withLocalSources(owner: string, entries: ReviewEntry[]): Promise<ReviewEntry[]> {
  const drafts = (await localAll<ReviewDraft>("cloud_state")).filter(row => row.kind === "review-draft" && row.ownerId === owner && row.id.startsWith(`review-draft:${owner}:local:`));
  return entries.map(entry => {
    const draft = drafts.find(row => row.bookId === entry.book.id);
    return draft ? { ...entry, sourceLocalId: draft.id.slice(`review-draft:${owner}:local:`.length) } : entry;
  });
}
export function validateReview(rating: number, text: string): void {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Elige entre 1 y 5 estrellas.");
  if (text.length > 10000) throw new Error("El comentario puede tener hasta 10000 caracteres.");
}
export const personalReviews = {
  async cached(): Promise<ReviewEntry[]> {
    const owner = auth.state.ownerId;
    if (!owner) return [];
    const cache = await localGet<ReviewCache>("cloud_state", cacheKey(owner));
    return cache?.ownerId === owner ? withLocalSources(owner, cache.entries.filter(entry => entry.review.user_id === owner)) : [];
  },
  async page(offset = 0): Promise<ReviewEntry[]> {
    const owner = auth.requireUser();
    const version = cacheVersions.get(owner) ?? 0;
    const rows = await reviews.page({ userId: owner }, offset);
    const { data, error } = rows.length ? await cloud().from("books").select("*").in("id", rows.map(row => row.book_id)) : { data: [] as Book[], error: null };
    checkError(error);
    const entries = await withLocalSources(owner, rows.flatMap(review => { const book = data?.find(item => item.id === review.book_id); return book ? [{ review, book }] : []; }));
    if (auth.state.ownerId !== owner) return [];
    const old = offset ? await personalReviews.cached() : [];
    const merged = new Map([...old, ...entries].map(entry => [entry.review.id, entry]));
    if (version === (cacheVersions.get(owner) ?? 0)) await localPut<ReviewCache>("cloud_state", { id: cacheKey(owner), ownerId: owner, entries: [...merged.values()] });
    return entries;
  },
  async forBook(book: StoredBook): Promise<ReviewDraft> {
    const owner = auth.state.ownerId;
    if (!owner || (book.ownerId && book.ownerId !== owner)) throw new Error("Libro de otra cuenta.");
    const id = `review-draft:${owner}:local:${book.id}`;
    let old = await localGet<ReviewDraft>("cloud_state", id);
    if (!old) for (const source of book.migrationSources ?? []) {
      const previous: ReviewDraft | undefined = await localGet<ReviewDraft>("cloud_state", `review-draft:${owner}:local:${source}`);
      if (previous?.ownerId === owner) { old = { ...previous, id }; break; }
    }
    const draft: ReviewDraft = old?.ownerId === owner ? old : {
      id, kind: "review-draft", ownerId: owner, bookId: book.cloudId ?? newUuid(),
      title: book.displayTitle?.trim() || book.name.replace(/\.(pdf|epub)$/i, ""), author: book.author ?? "", format: book.format,
      rating: 0, text: "", dirty: false, updatedAt: Date.now(), catalogExists: !!book.cloudId,
    };
    // Save the stable catalog ID before any HTTP request; retry cannot create another catalog entry.
    await personalReviews.saveDraft(draft);
    if (!draft.dirty && (old || book.cloudId) && navigator.onLine && auth.state.status === "authenticated") {
      const own = (await reviews.page({ bookId: draft.bookId, userId: owner }).catch(() => []))[0];
      if (own) { draft.rating = own.rating; draft.text = own.text; draft.catalogExists = true; await personalReviews.saveDraft(draft); }
    }
    return draft;
  },
  async forEntry(entry: ReviewEntry): Promise<ReviewDraft> {
    const owner = auth.state.ownerId;
    if (!owner || entry.review.user_id !== owner) throw new Error(t("reviewOtherAccount"));
    const id = `review-draft:${owner}:catalog:${entry.book.id}`;
    const old = await localGet<ReviewDraft>("cloud_state", id);
    return old?.ownerId === owner && old.dirty ? old : { id, kind: "review-draft", ownerId: owner, bookId: entry.book.id,
      title: entry.book.title, author: entry.book.author, format: entry.book.format,
      rating: entry.review.rating, text: entry.review.text, dirty: false, updatedAt: Date.now(), catalogExists: true };
  },
  async forCatalog(book: Book): Promise<ReviewDraft> {
    const owner = auth.requireUser();
    const id = `review-draft:${owner}:catalog:${book.id}`;
    const old = await localGet<ReviewDraft>("cloud_state", id);
    if (old?.ownerId === owner && old.dirty) return old;
    const own = (await reviews.page({ bookId: book.id, userId: owner }))[0];
    const draft: ReviewDraft = { id, kind: "review-draft", ownerId: owner, bookId: book.id, title: book.title,
      author: book.author, format: book.format, rating: own?.rating ?? 0, text: own?.text ?? "", dirty: false, updatedAt: Date.now(), catalogExists: true };
    await personalReviews.saveDraft(draft); return draft;
  },
  async saveDraft(draft: ReviewDraft): Promise<void> {
    if (draft.ownerId !== auth.state.ownerId) throw new Error(t("reviewAccountChanged"));
    await localPut("cloud_state", { ...draft });
  },
  async drafts(): Promise<ReviewDraft[]> {
    const owner = auth.state.ownerId;
    const rows = await localAll<ReviewDraft>("cloud_state");
    return rows.filter(row => row.kind === "review-draft" && row.ownerId === owner && row.dirty);
  },
  async publish(draft: ReviewDraft): Promise<void> {
    validateReview(draft.rating, draft.text);
    await personalReviews.saveDraft(draft);
    requireOnline();
    const owner = auth.requireUser();
    const { data, error } = await cloud().rpc("publish_book_review", { p_book_id: draft.bookId, p_title: draft.title.trim(), p_author: draft.author,
      p_format: draft.format, p_rating: draft.rating, p_text: draft.text.trim() });
    if (error?.code === "PGRST202" || error?.code === "42883") throw new Error(t("reviewNotConfigured"));
    checkError(error);
    if (auth.state.ownerId !== owner) return;
    if (!data || data.review.user_id !== owner) throw new Error(t("reviewUnconfirmed"));
    cacheVersions.set(owner, (cacheVersions.get(owner) ?? 0) + 1);
    const entries = await personalReviews.cached();
    await localPut<ReviewCache>("cloud_state", { id: cacheKey(owner), ownerId: owner,
      entries: [data, ...entries.filter(entry => entry.review.id !== data.review.id)] });
    // Clear dirty copies of this published draft, retaining their stable book mapping.
    const copies = await localAll<ReviewDraft>("cloud_state");
    for (const copy of copies) if (copy.kind === "review-draft" && copy.ownerId === owner && copy.bookId === draft.bookId && copy.updatedAt <= draft.updatedAt)
      await personalReviews.saveDraft({ ...copy, dirty: false, rating: draft.rating, text: draft.text, title: data.book.title, author: data.book.author, catalogExists: true });
    draft.dirty = false; draft.catalogExists = true; draft.title = data.book.title; draft.author = data.book.author;
    window.dispatchEvent(new Event("autumn-reviews-change"));
  },
  async remove(entry: ReviewEntry): Promise<void> {
    if (entry.review.user_id !== auth.state.ownerId) throw new Error(t("reviewOtherAccount"));
    await reviews.remove(entry.review.id);
    const owner = auth.state.ownerId;
    if (!owner || owner !== entry.review.user_id) return;
    cacheVersions.set(owner, (cacheVersions.get(owner) ?? 0) + 1);
    await localPut<ReviewCache>("cloud_state", { id: cacheKey(owner), ownerId: owner, entries: (await personalReviews.cached()).filter(item => item.review.id !== entry.review.id) });
    const copies = await localAll<ReviewDraft>("cloud_state");
    for (const copy of copies) if (copy.kind === "review-draft" && copy.ownerId === owner && copy.bookId === entry.book.id)
      await personalReviews.saveDraft({ ...copy, dirty: false, rating: 0, text: "" });
    window.dispatchEvent(new Event("autumn-reviews-change"));
  },
  pageSize: SOCIAL_PAGE_SIZE,
};
