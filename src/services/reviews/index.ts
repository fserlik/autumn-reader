import { cloud, checkError } from "../client";
import { t } from "../../i18n";
import { auth } from "../auth";
import { requireOnline } from "../errors";
import type { Review, ReviewComment } from "../types";
export const SOCIAL_PAGE_SIZE = 20;
export const reviews = {
  async page(
    filter: { bookId?: string; userId?: string },
    offset = 0,
  ): Promise<Review[]> {
    let query = cloud()
      .from("reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + SOCIAL_PAGE_SIZE - 1);
    if (filter.bookId) query = query.eq("book_id", filter.bookId);
    if (filter.userId) query = query.eq("user_id", filter.userId);
    const { data, error } = await query;
    checkError(error);
    return data ?? [];
  },
  async save(
    bookId: string,
    rating: number,
    text: string,
    id?: string,
  ): Promise<void> {
    requireOnline();
    const user = auth.requireUser();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      throw new Error(t("reviewRatingInvalid"));
    if (id) {
      const { error } = await cloud()
        .from("reviews")
        .update({ rating, text })
        .eq("id", id)
        .eq("user_id", user);
      checkError(error);
    } else {
      const { error } = await cloud()
        .from("reviews")
        .insert({ book_id: bookId, user_id: user, rating, text });
      checkError(error);
    }
  },
  async remove(id: string): Promise<void> {
    requireOnline();
    const { error } = await cloud()
      .from("reviews")
      .delete()
      .eq("id", id)
      .eq("user_id", auth.requireUser());
    checkError(error);
  },
  async likes(id: string): Promise<{ count: number; liked: boolean }> {
    const { count, error } = await cloud()
      .from("review_likes")
      .select("review_id", { count: "exact", head: true })
      .eq("review_id", id);
    checkError(error);
    const owner = auth.state.ownerId;
    let liked = false;
    if (owner) {
      const { data, error } = await cloud()
        .from("review_likes")
        .select("user_id")
        .eq("review_id", id)
        .eq("user_id", owner)
        .maybeSingle();
      checkError(error);
      liked = Boolean(data);
    }
    return { count: count ?? 0, liked };
  },
  async like(id: string, liked: boolean): Promise<void> {
    requireOnline();
    const user = auth.requireUser();
    const { error } = liked
      ? await cloud()
          .from("review_likes")
          .upsert(
            { review_id: id, user_id: user },
            { onConflict: "review_id,user_id", ignoreDuplicates: true },
          )
      : await cloud()
          .from("review_likes")
          .delete()
          .eq("review_id", id)
          .eq("user_id", user);
    checkError(error);
  },
  async comments(id: string, offset = 0): Promise<ReviewComment[]> {
    const { data, error } = await cloud()
      .from("review_comments")
      .select("*")
      .eq("review_id", id)
      .order("created_at")
      .order("id")
      .range(offset, offset + SOCIAL_PAGE_SIZE - 1);
    checkError(error);
    return data ?? [];
  },
  async comment(reviewId: string, content: string, id?: string): Promise<void> {
    requireOnline();
    const user = auth.requireUser();
    if (!content.trim()) throw new Error(t("writeComment"));
    const { error } = id
      ? await cloud()
          .from("review_comments")
          .update({ content: content.trim() })
          .eq("id", id)
          .eq("user_id", user)
      : await cloud()
          .from("review_comments")
          .insert({
            review_id: reviewId,
            user_id: user,
            content: content.trim(),
          });
    checkError(error);
  },
  async removeComment(id: string): Promise<void> {
    requireOnline();
    const { error } = await cloud()
      .from("review_comments")
      .delete()
      .eq("id", id)
      .eq("user_id", auth.requireUser());
    checkError(error);
  },
};
