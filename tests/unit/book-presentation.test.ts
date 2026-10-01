import { expect, test } from "vitest";
import type { StoredBook } from "../../src/storage";
import { bookProgress, completedBooks, readingBooks, readingStats, toReadBooks } from "../../src/ui/book-presentation";

const make = (id: string, status: StoredBook["status"], lastOpenedAt: number, percentage: number, favorite = false): StoredBook => ({
  id, name: `${id}.epub`, format: "epub", data: new Blob(), addedAt: 1, lastOpenedAt,
  page: 1, cfi: null, fontSize: 100, status, percentage, favorite,
});

test("Home features the most recently opened reading book and excludes completed books", () => {
  const books = [make("old", "reading", 2, .4), make("done", "finished", 10, 1), make("latest", "reading", 8, .68)];
  expect(readingBooks(books).map(book => book.id)).toEqual(["latest", "old"]);
  expect(bookProgress(readingBooks(books)[0])).toBe(68);
});

test("Profile statistics and shelves use the same stored book state as the reader", () => {
  const books = [make("reading", "reading", 8, .42, true), make("done", "finished", 7, .8), make("unread", "unread", 0, 0)];
  expect(readingStats(books)).toEqual({ total: 3, reading: 1, completed: 1, favorites: 1, toRead: 1 });
  expect(completedBooks(books).map(book => book.id)).toEqual(["done"]);
  expect(toReadBooks(books).map(book => book.id)).toEqual(["unread"]);
  expect(bookProgress(books[1])).toBe(100);
});

test("legacy reading books and malformed progress values remain presentable", () => {
  expect(readingBooks([make("legacy", undefined, 4, 1.4)]).map(book => book.id)).toEqual(["legacy"]);
  expect(bookProgress(make("negative", "reading", 1, -.3))).toBe(0);
  expect(bookProgress(make("large", "reading", 1, 3))).toBe(100);
});
