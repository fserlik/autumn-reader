import type { StoredBook } from "../storage";
import { t } from "../i18n";
import { bookDisplayTitle } from "../services/books/display";

export function isReading(book: StoredBook): boolean {
  return book.status === "reading" || (!book.status && book.lastOpenedAt > 0);
}

export function readingBooks(books: StoredBook[]): StoredBook[] {
  return books.filter(isReading).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function completedBooks(books: StoredBook[]): StoredBook[] {
  return books.filter(book => book.status === "finished").sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function toReadBooks(books: StoredBook[]): StoredBook[] {
  return books.filter(book => book.status === "unread" || (!book.status && !book.lastOpenedAt)).sort((a, b) => b.addedAt - a.addedAt);
}

export function readingStats(books: StoredBook[]) {
  return {
    total: books.length,
    reading: readingBooks(books).length,
    completed: completedBooks(books).length,
    favorites: books.filter(book => book.favorite).length,
    toRead: toReadBooks(books).length,
  };
}

export function bookProgress(book: StoredBook): number {
  return book.status === "finished" ? 100 : Math.round(Math.max(0, Math.min(1, book.percentage ?? 0)) * 100);
}

export function presentationCard(book: StoredBook, cover: (book: StoredBook) => HTMLElement, open: (book: StoredBook) => void, showProgress: boolean): HTMLElement {
  const title = bookDisplayTitle(book);
  const card = document.createElement("article");
  card.className = "presentation-card";
  const coverButton = document.createElement("button");
  coverButton.type = "button";
  coverButton.className = "presentation-cover cover-button";
  coverButton.setAttribute("aria-label", t("openBook", { title }));
  coverButton.append(cover(book));
  coverButton.addEventListener("click", () => open(book));
  const titleButton = document.createElement("button");
  titleButton.type = "button";
  titleButton.className = "presentation-title book-title";
  titleButton.textContent = title;
  titleButton.title = title;
  titleButton.addEventListener("click", () => open(book));
  const author = document.createElement("p");
  author.className = "presentation-author";
  author.textContent = book.author?.trim() || t("authorUnknown");
  card.append(coverButton, titleButton, author);
  if (showProgress) {
    const value = bookProgress(book);
    const progress = document.createElement("div");
    progress.className = "presentation-progress";
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-valuenow", String(value));
    progress.setAttribute("aria-label", t("progressPercent", { value }));
    const track = document.createElement("span");
    track.className = "presentation-progress-track";
    const fill = document.createElement("span");
    fill.style.width = `${value}%`;
    track.append(fill);
    const label = document.createElement("span");
    label.textContent = `${value}%`;
    progress.append(track, label);
    card.append(progress);
  }
  return card;
}
