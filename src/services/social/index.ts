import { auth } from "../auth";
import { t } from "../../i18n";
import { cloud, checkError } from "../client";
import { requireOnline } from "../errors";
import { SOCIAL_PAGE_SIZE } from "../reviews";
import type { Profile, BookList, Book, BookListItem, FeedItem } from "../types";
export const social = {
  async feed(
    following = false,
    before?: Pick<FeedItem, "created_at" | "id">,
  ): Promise<FeedItem[]> {
    const { data, error } = await cloud().rpc("social_feed", {
      p_following: following,
      p_before: before?.created_at,
      p_cursor: before?.id,
      p_limit: SOCIAL_PAGE_SIZE,
    });
    checkError(error);
    return data ?? [];
  },
  async people(ids: string[]): Promise<Profile[]> {
    if (!ids.length) return [];
    const { data, error } = await cloud()
      .from("profiles")
      .select("*")
      .in("id", [...new Set(ids)]);
    checkError(error);
    return data ?? [];
  },
  async following(id: string): Promise<boolean> {
    const owner = auth.state.ownerId;
    if (!owner) return false;
    const { data, error } = await cloud()
      .from("follows")
      .select("following_id")
      .eq("follower_id", owner)
      .eq("following_id", id)
      .maybeSingle();
    checkError(error);
    return Boolean(data);
  },
  async follow(id: string, follow: boolean): Promise<void> {
    requireOnline();
    const owner = auth.requireUser();
    if (id === owner) throw new Error(t("selfFollow"));
    const { error } = follow
      ? await cloud()
          .from("follows")
          .upsert(
            { follower_id: owner, following_id: id },
            { onConflict: "follower_id,following_id", ignoreDuplicates: true },
          )
      : await cloud()
          .from("follows")
          .delete()
          .eq("follower_id", owner)
          .eq("following_id", id);
    checkError(error);
  },
  async follows(
    id: string,
    direction: "followers" | "following",
    offset = 0,
  ): Promise<Profile[]> {
    const { data, error } = await cloud()
      .from("follows")
      .select("*")
      .eq(direction === "followers" ? "following_id" : "follower_id", id)
      .order("created_at", { ascending: false })
      .order(direction === "followers" ? "follower_id" : "following_id")
      .range(offset, offset + SOCIAL_PAGE_SIZE - 1);
    checkError(error);
    return social.people(
      (data ?? []).map((row) =>
        direction === "followers" ? row.follower_id : row.following_id,
      ),
    );
  },
  async book(id: string): Promise<Book | null> {
    const { data, error } = await cloud()
      .from("books")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    checkError(error);
    return data;
  },
  async books(ids: string[]): Promise<Book[]> {
    if (!ids.length) return [];
    const { data, error } = await cloud()
      .from("books")
      .select("*")
      .in("id", ids);
    checkError(error);
    return data ?? [];
  },
  async lists(owner: string, offset = 0): Promise<BookList[]> {
    const { data, error } = await cloud()
      .from("book_lists")
      .select("*")
      .eq("user_id", owner)
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + SOCIAL_PAGE_SIZE - 1);
    checkError(error);
    return data ?? [];
  },
  async list(id: string): Promise<BookList | null> {
    const { data, error } = await cloud()
      .from("book_lists")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    checkError(error);
    return data;
  },
  async saveList(
    values: Pick<BookList, "title" | "description" | "visibility">,
    id?: string,
  ): Promise<void> {
    requireOnline();
    const owner = auth.requireUser();
    const { error } = id
      ? await cloud()
          .from("book_lists")
          .update(values)
          .eq("id", id)
          .eq("user_id", owner)
      : await cloud()
          .from("book_lists")
          .insert({ ...values, user_id: owner });
    checkError(error);
  },
  async removeList(id: string): Promise<void> {
    requireOnline();
    const { error } = await cloud()
      .from("book_lists")
      .delete()
      .eq("id", id)
      .eq("user_id", auth.requireUser());
    checkError(error);
  },
  async items(id: string, offset = 0): Promise<BookListItem[]> {
    const { data, error } = await cloud()
      .from("book_list_items")
      .select("*")
      .eq("list_id", id)
      .order("added_at", { ascending: false })
      .order("book_id")
      .range(offset, offset + SOCIAL_PAGE_SIZE - 1);
    checkError(error);
    return data ?? [];
  },
  async addBook(list: string, book: string): Promise<void> {
    requireOnline();
    auth.requireUser();
    const { error } = await cloud()
      .from("book_list_items")
      .upsert(
        { list_id: list, book_id: book },
        { onConflict: "list_id,book_id", ignoreDuplicates: true },
      );
    checkError(error);
  },
  async removeBook(list: string, book: string): Promise<void> {
    requireOnline();
    auth.requireUser();
    const { error } = await cloud()
      .from("book_list_items")
      .delete()
      .eq("list_id", list)
      .eq("book_id", book);
    checkError(error);
  },
};
