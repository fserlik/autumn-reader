import { auth } from "../services/auth";
import { library } from "../services/books";
import { cloudStorage } from "../services/books/cloud-storage";
import { bookCache } from "../services/storage";
import { migrationIsRunning } from "../services/sync/migration";
import { errorMessage } from "../services/errors";
import { cloudLocalId } from "../services/books/models";
import { hasLocalFile, type StoredBook } from "../storage";
import type { CloudStorageBook, CloudUsage } from "../services/types";
import { language, t } from "../i18n";

const formatBytes = (bytes: number): string => {
  const mib = bytes / 1048576;
  return mib >= 1024
    ? `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(mib / 1024)} GB`
    : `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(mib)} MB`;
};

export function mountAccountStorage(
  parent: HTMLElement,
  cover: (book: StoredBook) => HTMLElement,
  onLibraryChanged: () => Promise<void>,
): void {
  const section = document.createElement("section");
  section.className = "account-feature cloud-storage-feature";
  section.innerHTML = `<div class="settings-copy"><h3>${t("accountCloudStorage")}</h3><p>${t("accountCloudStorageHelp")}</p></div>
    <div class="cloud-storage-summary"><p class="cloud-storage-bytes" role="status"></p><p class="cloud-storage-books"></p>
      <progress class="cloud-storage-meter" max="100" value="0" aria-label="${t("accountCloudStorage")}"></progress></div>
    <button class="secondary-button cloud-storage-manage" type="button">${t("manageCloudStorage")}</button>`;
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog cloud-storage-dialog";
  dialog.setAttribute("aria-labelledby", "cloud-storage-heading");
  dialog.innerHTML = `<header><h2 id="cloud-storage-heading">${t("manageCloudStorage")}</h2><button class="note-close cloud-storage-close" type="button" aria-label="${t("close")}">×</button></header>
    <p class="cloud-storage-dialog-usage"></p>
    <label class="cloud-storage-sort-label">${t("cloudStorageSort")}<select class="cloud-storage-sort"><option value="recent">${t("cloudStorageRecentSort")}</option><option value="size">${t("cloudStorageSizeSort")}</option><option value="title">${t("cloudStorageTitleSort")}</option></select></label>
    <div class="cloud-storage-rows"></div><button class="secondary-button cloud-storage-more" type="button" hidden>${t("cloudStorageMore")}</button>
    <p class="cloud-storage-message" role="status" aria-live="polite"></p>`;
  const confirm = document.createElement("dialog");
  confirm.className = "account-dialog cloud-remove-dialog";
  confirm.setAttribute("aria-labelledby", "cloud-remove-heading");
  confirm.innerHTML = `<h2 id="cloud-remove-heading">${t("removeCloudTitle")}</h2><p class="cloud-remove-book"></p><p class="cloud-remove-warning"></p>
    <p class="cloud-remove-error" role="alert"></p><footer><button type="button" class="secondary-button cloud-remove-cancel">${t("cancel")}</button><button type="button" class="secondary-button cloud-remove-submit">${t("removeFromCloud")}</button></footer>`;
  parent.append(section, dialog, confirm);
  const find = <T extends HTMLElement>(node: HTMLElement, selector: string): T => node.querySelector<T>(selector)!;
  const bytesLabel = find<HTMLElement>(section, ".cloud-storage-bytes");
  const booksLabel = find<HTMLElement>(section, ".cloud-storage-books");
  const meter = find<HTMLProgressElement>(section, ".cloud-storage-meter");
  const usageLabel = find<HTMLElement>(dialog, ".cloud-storage-dialog-usage");
  const rows = find<HTMLElement>(dialog, ".cloud-storage-rows");
  const message = find<HTMLElement>(dialog, ".cloud-storage-message");
  const more = find<HTMLButtonElement>(dialog, ".cloud-storage-more");
  const sort = find<HTMLSelectElement>(dialog, ".cloud-storage-sort");
  const removeButton = find<HTMLButtonElement>(confirm, ".cloud-remove-submit");
  const removeError = find<HTMLElement>(confirm, ".cloud-remove-error");
  let usage: CloudUsage | undefined;
  let items: CloudStorageBook[] = [];
  let offset = 0;
  let hasMore = false;
  let loading = false;
  let removing = false;
  let selected: CloudStorageBook | undefined;
  let generation = 0;
  let owner: string | null = null;
  const summary = (value: CloudUsage) => {
    usage = value;
    bytesLabel.textContent = t("cloudStorageUsage", { used: formatBytes(value.used_bytes), limit: formatBytes(value.max_bytes) });
    booksLabel.textContent = t("cloudStorageBooksUsage", { used: value.used_books, limit: value.max_books });
    usageLabel.textContent = `${bytesLabel.textContent} · ${booksLabel.textContent}`;
    meter.value = value.max_bytes ? Math.min(100, value.used_bytes / value.max_bytes * 100) : 0;
  };
  const refreshUsage = async () => {
    const current = auth.state.ownerId;
    if (auth.state.status !== "authenticated" || !navigator.onLine) {
      if (!usage) bytesLabel.textContent = t("quotaOffline");
      return;
    }
    try {
      const value = await library.quota();
      if (auth.state.ownerId === current) summary(value);
    } catch (reason: unknown) {
      if (auth.state.ownerId === current && !usage) bytesLabel.textContent = errorMessage(reason);
    }
  };
  const render = async () => {
    rows.replaceChildren();
    if (!items.length && !loading) {
      const empty = document.createElement("p"); empty.className = "cloud-storage-empty";
      empty.textContent = t("cloudStorageEmpty"); rows.append(empty);
    }
    for (const entry of items) {
      const row = document.createElement("article"); row.className = "cloud-storage-row";
      const local = await bookCache.get(cloudLocalId(owner!, entry.book_id));
      if (owner !== auth.state.ownerId || !dialog.open) return;
      const visual = local ?? { id: cloudLocalId(owner!, entry.book_id), name: entry.title,
        displayTitle: entry.title, author: entry.author, format: "epub", data: new Blob(),
        addedAt: Date.parse(entry.added_at), lastOpenedAt: 0, page: 1, cfi: null, fontSize: 100,
        coverPath: entry.cover_path, ownerId: owner!, cloudId: entry.book_id } satisfies StoredBook;
      const coverBox = document.createElement("div"); coverBox.className = "cloud-storage-cover"; coverBox.append(cover(visual));
      const detail = document.createElement("div"); detail.className = "cloud-storage-detail";
      const title = document.createElement("strong"); title.textContent = entry.title; title.title = entry.title;
      const author = document.createElement("span"); author.textContent = entry.author;
      const size = document.createElement("span"); size.textContent = t("cloudStorageFileSize", { size: formatBytes(entry.file_size) });
      const cloudState = document.createElement("span"); cloudState.textContent = t("cloudStorageState");
      const state = document.createElement("span"); state.textContent = t(hasLocalFile(visual) ? "cloudStorageLocalCopy" : "cloudStorageNoLocalCopy");
      detail.append(title, author, size, cloudState, state);
      const action = document.createElement("button"); action.type = "button"; action.className = "secondary-button cloud-storage-remove";
      action.textContent = migrationIsRunning() ? t("synchronizing") : t("removeFromCloud");
      action.disabled = migrationIsRunning() || removing;
      action.addEventListener("click", () => {
        if (migrationIsRunning() || removing) return;
        selected = entry;
        find<HTMLElement>(confirm, ".cloud-remove-book").textContent = entry.title;
        find<HTMLElement>(confirm, ".cloud-remove-warning").textContent =
          t(hasLocalFile(visual) ? "removeCloudWithCopy" : "removeCloudWithoutCopy");
        removeError.textContent = "";
        confirm.showModal();
      });
      row.append(coverBox, detail, action); rows.append(row);
    }
    more.hidden = !hasMore;
  };
  const load = async (reset: boolean) => {
    if (loading) return;
    if (!navigator.onLine) { message.textContent = t("removeCloudOffline"); return; }
    const current = auth.state.ownerId;
    if (!current || auth.state.status !== "authenticated") return;
    const token = ++generation;
    loading = true; more.disabled = true; message.textContent = t("cloudStorageLoading");
    try {
      const page = await library.cloudStoragePage(reset ? 0 : offset, sort.value as "recent"|"size"|"title");
      if (token !== generation || auth.state.ownerId !== current) return;
      items = reset ? page.books : [...items, ...page.books];
      offset = items.length; hasMore = page.hasMore;
      message.textContent = "";
    } catch (reason: unknown) { if (token === generation) message.textContent = errorMessage(reason); }
    finally { loading = false; more.disabled = false; if (token === generation) await render(); }
  };
  find<HTMLButtonElement>(section, ".cloud-storage-manage").addEventListener("click", () => {
    dialog.showModal(); void refreshUsage(); void load(true);
  });
  find<HTMLButtonElement>(dialog, ".cloud-storage-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { ++generation; items = []; offset = 0; hasMore = false; rows.replaceChildren(); });
  sort.addEventListener("change", () => void load(true));
  more.addEventListener("click", () => void load(false));
  find<HTMLButtonElement>(confirm, ".cloud-remove-cancel").addEventListener("click", () => { if (!removing) confirm.close(); });
  confirm.addEventListener("cancel", event => { if (removing) event.preventDefault(); });
  removeButton.addEventListener("click", () => {
    if (!selected || removing) return;
    if (!navigator.onLine) { removeError.textContent = t("removeCloudOffline"); return; }
    const entry = selected;
    removing = true; removeButton.disabled = true;
    void cloudStorage.remove(entry.book_id).then(async value => {
      summary(value);
      confirm.close();
      items = items.filter(item => item.book_id !== entry.book_id);
      await render();
      message.textContent = t("removeCloudSuccess");
      await onLibraryChanged();
      void load(true);
    }).catch((reason: unknown) => {
      removeError.textContent = errorMessage(reason);
      void refreshUsage();
    }).finally(() => { removing = false; removeButton.disabled = false; });
  });
  auth.subscribe(state => {
    if (state.ownerId !== owner) {
      owner = state.ownerId; usage = undefined; items = []; ++generation;
      if (dialog.open) dialog.close(); if (confirm.open && !removing) confirm.close();
    }
    if (state.status === "authenticated") void refreshUsage();
  });
  window.addEventListener("online", () => void refreshUsage());
  window.addEventListener("autumn-cloud-storage-changed", () => void refreshUsage());
  window.addEventListener("autumn-migration-finished", () => {
    void refreshUsage();
    if (dialog.open) void load(true);
  });
  window.addEventListener("autumn-upload-progress", () => { if (dialog.open) void render(); });
}
