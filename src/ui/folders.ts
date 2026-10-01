import { folders, type LocalMembership } from "../services/folders";
import { auth } from "../services/auth";
import { bookColors, colorName, folderInk, hexColor } from "../book-colors";
import { language, t } from "../i18n";
import type { LibraryFolder } from "../services/types";
import type { StoredBook } from "../storage";
export interface FolderUI {
  reload(): Promise<void>;
  update(books: StoredBook[], query: string, visibleBookCount: number): { hideEmpty: boolean; emptyMessage?: string };
  includes(book: StoredBook, query: string): boolean;
  control(book: StoredBook): HTMLSelectElement;
  move(book: StoredBook, folderId: string | null): Promise<void>;
  folderId(book: StoredBook): string | null;
}

// Existing folders without an explicit colour keep their stable, ID-derived fill.
const folderColors = ["#327d70", "#ad493e", "#535152", "#876a1b", "#795199", "#657b36", "#a35929", "#3c7197"];
const folderDrawing = `<svg class="folder-drawing" viewBox="0 0 240 190" aria-hidden="true" focusable="false">
  <path class="folder-back" d="M12 53V36Q12 21 28 21H130V20Q130 7 144 7H187Q201 7 201 21H211Q228 21 228 39V163Q228 180 211 180H29Q12 180 12 164Z"/>
  <path class="folder-inner" d="M26 76V56Q26 42 41 42H130Q130 30 143 30H191Q205 30 205 42H211Q224 42 224 58V163H26Z"/>
  <path class="folder-paper" d="M34 65H210Q222 65 220 78L207 165H25L24 80Q23 65 34 65Z"/>
  <path class="folder-front" d="M31 60H218Q237 60 233 80L216 163Q213 180 195 180H25Q6 180 10 160L21 76Q24 60 31 60Z"/>
  <path class="folder-glint" d="M23 55Q20 30 47 27Q29 37 23 55ZM25 85Q27 65 51 65Q33 72 25 85ZM16 148Q12 173 40 175Q21 165 16 148ZM222 146Q219 173 193 175Q212 164 222 146Z"/>
</svg>`;

export function mountFolders(parent: HTMLElement, render: () => void, report: (message: string) => void, confirm: () => Promise<boolean>, clearSearch: () => void): FolderUI {
  parent.innerHTML = `<div class="folder-tools"><button id="folder-new" class="secondary-button" type="button">${t("newFolder")}</button><button id="folder-rename" class="text-link" type="button">${t("editFolder")}</button><button id="folder-delete" class="text-link" type="button">${t("deleteFolder")}</button></div><form id="folder-form" hidden><label for="folder-name">${t("folderName")}</label><input id="folder-name" maxlength="100" required /><fieldset class="folder-color-field"><legend>${t("folderColor")}</legend><div id="folder-color-options" class="book-color-options"><button id="folder-color-auto" class="color-auto" type="button" aria-pressed="true">${t("automaticColor")}</button></div><label class="custom-color-label" for="folder-custom-color">${t("customColor")} <input id="folder-custom-color" type="color" value="#326fca" aria-label="${t("customColor")}" /></label></fieldset><button class="primary-button" type="submit">${t("saveFolder")}</button><button id="folder-cancel" class="secondary-button" type="button">${t("cancel")}</button></form>
    <nav class="folder-breadcrumb" aria-label="${t("libraryLocation")}"><button id="folder-back" class="back-button" type="button" hidden>${t("backToLibrary")}</button><span id="folder-location"></span></nav>
    <section id="folder-section" aria-labelledby="folder-heading" hidden><h3 id="folder-heading" class="library-section-heading">${t("yourFolders")}</h3><div id="folder-grid" class="folder-grid"></div></section>
    <h3 id="folder-books-heading" class="library-section-heading"></h3>`;
  const create = parent.querySelector<HTMLButtonElement>("#folder-new")!;
  const form = parent.querySelector<HTMLFormElement>("#folder-form")!;
  const name = parent.querySelector<HTMLInputElement>("#folder-name")!;
  const colors = parent.querySelector<HTMLElement>("#folder-color-options")!;
  const automatic = parent.querySelector<HTMLButtonElement>("#folder-color-auto")!;
  const custom = parent.querySelector<HTMLInputElement>("#folder-custom-color")!;
  const rename = parent.querySelector<HTMLButtonElement>("#folder-rename")!;
  const remove = parent.querySelector<HTMLButtonElement>("#folder-delete")!;
  const back = parent.querySelector<HTMLButtonElement>("#folder-back")!;
  const breadcrumb = parent.querySelector<HTMLElement>(".folder-breadcrumb")!;
  const section = parent.querySelector<HTMLElement>("#folder-section")!;
  const grid = parent.querySelector<HTMLElement>("#folder-grid")!;
  const heading = parent.querySelector<HTMLElement>("#folder-books-heading")!;
  let items: LibraryFolder[] = [], memberships: LocalMembership[] = [], editing: LibraryFolder | undefined, owner: string | null = null;
  let selectedColor: string | null = null;
  const showColors = (): void => {
    automatic.setAttribute("aria-pressed", String(selectedColor === null));
    colors.querySelectorAll<HTMLButtonElement>(".color-swatch").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.color === selectedColor)));
    custom.closest(".custom-color-label")?.classList.toggle("selected", selectedColor !== null && !bookColors.some(choice => choice.value === selectedColor));
  };
  automatic.addEventListener("click", () => { selectedColor = null; showColors(); });
  for (const choice of bookColors) {
    const button = document.createElement("button"); button.type = "button"; button.className = "color-swatch";
    button.dataset.color = choice.value; button.style.backgroundColor = choice.value;
    button.setAttribute("aria-label", t("chooseColor", { color: colorName(choice.value, language) }));
    button.addEventListener("click", () => { selectedColor = choice.value; custom.value = choice.value; showColors(); });
    colors.append(button);
  }
  custom.addEventListener("input", () => { selectedColor = hexColor(custom.value); showColors(); });
  let assignments = new Map<string, string | null>();
  let currentFolder: string | null = null;
  const selected = (): LibraryFolder | undefined => items.find(f => f.id === currentFolder);
  const updateActions = (): void => { rename.hidden = remove.hidden = !selected(); };
  const activeFolder = (book: StoredBook): string | null => assignments.get(book.id) ?? null;
  const open = (id: string | null): void => {
    currentFolder = id;
    form.hidden = true;
    clearSearch();
    updateActions(); render();
    (id === null ? create : back).focus({ preventScroll: true });
  };
  const ui: FolderUI = {
    async reload() {
      const nextOwner = auth.state.ownerId;
      if (owner !== nextOwner) { owner = nextOwner; currentFolder = null; form.hidden = true; }
      const snapshot = await folders.snapshot(nextOwner);
      if (auth.state.ownerId !== nextOwner) return;
      items = snapshot.folders; memberships = snapshot.memberships;
      const valid = new Set(items.map(folder => folder.id));
      assignments = new Map(memberships.map(member => [member.bookLocalId, member.folderId && valid.has(member.folderId) ? member.folderId : null]));
      if (currentFolder && !valid.has(currentFolder)) currentFolder = null;
      updateActions(); render();
    },
    update(books, query, visibleBookCount) {
      const root = currentFolder === null, folder = selected();
      const counts = new Map<string, number>();
      for (const book of books) {
        const id = activeFolder(book);
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      const visibleFolders = root ? items.filter(item => item.name.toLocaleLowerCase().includes(query)) : [];
      section.hidden = !visibleFolders.length;
      grid.replaceChildren(...visibleFolders.map(item => {
        const tile = document.createElement("button");
        tile.type = "button"; tile.className = "folder-tile"; tile.dataset.folderId = item.id;
        const count = counts.get(item.id) ?? 0;
        const quantity = t(count === 1 ? "folderBookOne" : "folderBookMany", { count });
        tile.setAttribute("aria-label", t("openFolder", { name: item.name, count: quantity }));
        tile.title = item.name;
        const colorIndex = [...item.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % folderColors.length;
        const fill = hexColor(item.color) ?? folderColors[colorIndex];
        tile.style.setProperty("--folder-color", fill);
        tile.style.setProperty("--folder-ink", folderInk(fill));
        tile.innerHTML = folderDrawing;
        const label = document.createElement("span"); label.className = "folder-label";
        const title = document.createElement("span"); title.className = "folder-title"; title.textContent = item.name;
        const total = document.createElement("span"); total.className = "folder-count"; total.textContent = quantity;
        const hint = document.createElement("span"); hint.className = "folder-drop-hint"; hint.textContent = t("dropHere");
        label.append(title, total, hint); tile.append(label);
        tile.addEventListener("click", () => open(item.id));
        return tile;
      }));
      back.hidden = root;
      breadcrumb.hidden = root;
      parent.querySelector<HTMLElement>("#folder-location")!.textContent = root ? "" : t("folderLocation", { name: folder?.name ?? "" });
      heading.textContent = `${query ? t("bookResults") : folder?.name ?? t("unfiledBooks")} (${visibleBookCount})`;
      const hideEmpty = root && visibleFolders.length > 0 && visibleBookCount === 0;
      heading.hidden = hideEmpty;
      return { hideEmpty, emptyMessage: !query && folder ? t("folderEmpty") : undefined };
    },
    includes(book, query) {
      const id = activeFolder(book);
      // Root searches include organized books; clearing the query restores the folder view.
      return currentFolder === null ? !!query || !id : id === currentFolder;
    },
    control(book) {
      const select = document.createElement("select"); select.className = "book-folder";
      select.setAttribute("aria-label", t("folderOfBook", { title: book.displayTitle?.trim() || book.name.replace(/\.(pdf|epub)$/i, "") }));
      select.replaceChildren(new Option(t("noFolder"), ""), ...items.map(f => new Option(f.name, f.id)));
      select.value = activeFolder(book) ?? "";
      select.addEventListener("change", () => {
        select.disabled = true;
        void ui.move(book, select.value || null).catch((error: unknown) => report(error instanceof Error ? error.message : t("moveBookFailed"))).finally(() => { select.disabled = false; });
      }); return select;
    },
    folderId: activeFolder,
    async move(book, folderId) {
      const before = activeFolder(book);
      if (before === folderId) return;
      assignments.set(book.id, folderId);
      render();
      try { await folders.move(book, folderId); await ui.reload(); }
      catch (error) { assignments.set(book.id, before); render(); throw error; }
    },
  };
  back.addEventListener("click", () => open(null));
  create.addEventListener("click", () => { editing = undefined; name.value = ""; selectedColor = null; showColors(); form.hidden = false; name.focus(); });
  rename.addEventListener("click", () => { editing = selected(); name.value = editing?.name ?? ""; selectedColor = hexColor(editing?.color); custom.value = selectedColor ?? "#326fca"; showColors(); form.hidden = false; name.focus(); });
  parent.querySelector("#folder-cancel")!.addEventListener("click", () => { form.hidden = true; });
  form.addEventListener("submit", event => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!; submit.disabled = true;
    void (editing ? folders.save({ ...editing, name: name.value.trim(), color: selectedColor }) : folders.create(name.value, selectedColor)).then(async () => { form.hidden = true; await ui.reload(); }).catch((error: unknown) => report(error instanceof Error ? error.message : t("saveFolderFailed"))).finally(() => { submit.disabled = false; });
  });
  remove.addEventListener("click", () => {
    const folder = selected(); if (!folder) return;
    void confirm().then(async yes => { if (yes) { await folders.save({ ...folder, deleted_at: new Date().toISOString() }); await ui.reload(); } }).catch((error: unknown) => report(error instanceof Error ? error.message : t("deleteFolderFailed")));
  });
  updateActions();
  return ui;
}
