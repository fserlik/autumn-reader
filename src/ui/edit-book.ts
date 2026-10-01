import type { StoredBook } from "../storage";
import { t } from "../i18n";
import { prepareBookCover, privateCoverPath } from "../services/storage/book-covers";

export interface BookEditor { open(book: StoredBook): void; close(): void }
export function mountBookEditor(
  parent: HTMLElement,
  coverElement: (book: StoredBook) => HTMLElement,
  save: (book: StoredBook, changes: Pick<StoredBook, "displayTitle" | "author" | "cover" | "customCover" | "coverPath" | "coverUploadedPath">) => Promise<void>,
): BookEditor {
  const dialog = document.createElement("dialog");
  dialog.className = "edit-book-dialog";
  dialog.setAttribute("aria-labelledby", "edit-book-heading");
  dialog.innerHTML = `<form class="edit-book-form">
    <header><h2 id="edit-book-heading">${t("editBook")}</h2><button class="note-close edit-book-close" type="button" aria-label="${t("cancel")}">×</button></header>
    <div class="edit-book-cover-group"><span>${t("editBookCover")}</span><div class="edit-book-cover-preview"></div>
      <input class="edit-book-file" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden />
      <button class="secondary-button edit-book-choose" type="button">${t("editBookChangeCover")}</button>
      <small>${t("editBookCoverHelp")}</small></div>
    <label>${t("editBookTitle")}<input class="edit-book-title" maxlength="500" required /></label>
    <label>${t("editBookAuthor")}<input class="edit-book-author" maxlength="300" /></label>
    <p class="edit-book-error" role="alert"></p>
    <footer><button class="secondary-button edit-book-cancel" type="button">${t("cancel")}</button><button class="primary-button edit-book-save" type="submit">${t("editBookSave")}</button></footer>
  </form>`;
  parent.append(dialog);
  const find = <T extends HTMLElement>(selector: string): T => dialog.querySelector<T>(selector)!;
  const form = find<HTMLFormElement>("form"), title = find<HTMLInputElement>(".edit-book-title"), author = find<HTMLInputElement>(".edit-book-author"), picker = find<HTMLInputElement>(".edit-book-file"), preview = find<HTMLElement>(".edit-book-cover-preview"), error = find<HTMLElement>(".edit-book-error"), submit = find<HTMLButtonElement>(".edit-book-save");
  let current: StoredBook | undefined, selected: Blob | undefined, revision = 0, busy = false, preparing = false, invalidImage = false;
  const showPreview = (book: StoredBook) => preview.replaceChildren(coverElement(book));
  const ui: BookEditor = {
    open(book) {
      ++revision; current = book; selected = undefined; preparing = invalidImage = false; picker.value = ""; error.textContent = "";
      title.value = book.displayTitle?.trim() || book.name.replace(/\.(epub|pdf)$/i, ""); author.value = book.author ?? "";
      showPreview(book); dialog.showModal(); title.focus(); title.select();
    },
    close() { if (busy) return; ++revision; current = selected = undefined; if (dialog.open) dialog.close(); },
  };
  find(".edit-book-choose").addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    const file = picker.files?.[0]; if (!file) return;
    const token = ++revision; selected = undefined; preparing = true; invalidImage = false; submit.disabled = true; error.textContent = t("editBookPreparing");
    void prepareBookCover(file).then(blob => {
      if (token !== revision || !current) return;
      selected = blob; showPreview({ ...current, cover: blob, nativeCoverPath: undefined, customCover: true }); error.textContent = "";
    }).catch((reason: unknown) => { if (token === revision) { invalidImage = true; error.textContent = reason instanceof Error ? reason.message : t("editBookCoverInvalid"); } })
      .finally(() => { if (token === revision) { preparing = false; submit.disabled = false; } });
  });
  window.addEventListener("autumn-cover-loaded", event => {
    if (current?.id === (event as CustomEvent<{bookId:string}>).detail.bookId && !selected) showPreview(current);
  });
  form.addEventListener("submit", event => {
    event.preventDefault(); if (!current || busy || preparing || invalidImage) return;
    const name = title.value.trim(), by = author.value.trim();
    if (!name) { error.textContent = t("editBookTitleRequired"); title.focus(); return; }
    const book = current, cover = selected;
    const changes = {
      displayTitle: name, author: by, cover: cover ?? book.cover,
      customCover: cover ? true : book.customCover,
      coverPath: cover && book.ownerId && book.cloudId ? privateCoverPath(book.ownerId, book.cloudId) : book.coverPath,
      coverUploadedPath: cover ? undefined : book.coverUploadedPath,
    };
    busy = true; submit.disabled = true; error.textContent = "";
    void save(book, changes).then(() => { busy = false; ui.close(); }).catch(() => { error.textContent = t("editBookSaveFailed"); }).finally(() => { busy = false; submit.disabled = false; });
  });
  find(".edit-book-cancel").addEventListener("click", () => ui.close());
  find(".edit-book-close").addEventListener("click", () => ui.close());
  dialog.addEventListener("cancel", event => { event.preventDefault(); ui.close(); });
  return ui;
}
