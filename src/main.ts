import ePub, { type Book as EpubBook, type Contents, type Location, type Rendition } from "epubjs";
import {
  GlobalWorkerOptions,
  getDocument,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { invoke } from "@tauri-apps/api/core";
import { createBackup, readBackup } from "./backup";
import { countText, language, localizeDriveError, saveLanguage, t, type Language } from "./i18n";
import leafUrl from "./assets/autumn-leaf.png";
import { deleteBook, listBooks, saveBook, saveBooks, type BookNote, type StoredBook } from "./storage";
import "./style.css";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  library: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m17 5 4 14M3 8h5m2 4h5"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6 6-6-6 6-6"/>',
  star: '<path d="m12 2 3.1 6.4 7.1 1-5.1 5 .9 7.1-6-3.3-6 3.3.9-7.1-5.1-5 7.1-1z"/>',
  trash: '<path d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
  notes: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
};

function svg(name: keyof typeof icons, size = 19): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

const isAndroid = /\bAndroid\b/i.test(navigator.userAgent);
const app = document.querySelector<HTMLDivElement>("#app")!;
document.documentElement.lang = language;
if (isAndroid) document.documentElement.classList.add("android-app");
app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <button class="brand" id="brand-home" type="button" aria-label="${t("goHome")}">
        <img src="${leafUrl}" alt="" /><span>Autumn <strong>Reader</strong></span>
      </button>
      <div class="nav-caption">${t("yourSpace")}</div>
      <nav class="sidebar-nav" aria-label="${t("mainNavigation")}">
        <button class="nav-button active" data-view="home" type="button">${svg("home")}<span>${t("home")}</span></button>
        <button class="nav-button" data-view="library" type="button">${svg("library")}<span>${t("library")}</span><span id="nav-book-count" class="nav-count">0</span></button>
        <button class="nav-button" data-view="settings" type="button">${svg("settings")}<span>${t("settings")}</span></button>
      </nav>
      <div class="sidebar-signature"><img src="${leafUrl}" alt="" /><p>${t("storiesSeason")}</p></div>
      <div class="sidebar-foot">${t("booksYourPace")}</div>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <div class="topbar-copy"><h1 id="page-title">${t("home")}</h1><p id="page-subtitle">${t("homeSubtitle")}</p></div>
        <button id="import-button" class="primary-button" type="button">${svg("plus", 18)}<span>${t("addBooks")}</span></button>
        <input id="file-input" type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" multiple hidden />
      </header>

      <main class="content-area">
        <section id="view-home" class="view home-view">
          <div class="hero">
            <div class="hero-copy"><p class="hero-eyebrow">${t("welcome")}</p><h2>${t("heroTitle")}</h2><p id="hero-description">${t("heroDescription")}</p><button id="hero-action" class="hero-button" type="button"><span>${t("firstBook")}</span>${svg("arrow", 18)}</button></div>
            <div class="hero-art" aria-hidden="true"><span class="hero-orbit"></span><img src="${leafUrl}" alt="" /></div>
          </div>

          <div class="shelf-heading"><div><p class="section-kicker">${t("continueWhere")}</p><h2>${t("recentReads")}</h2></div><button class="text-link" id="recent-see-all" type="button">${t("viewLibrary")} ${svg("arrow", 16)}</button></div>
          <div id="recent-list" class="book-grid recent-grid"></div>

          <div class="shelf-heading favorites-heading"><div><p class="section-kicker">${t("yourPicks")}</p><h2>${t("favorites")}</h2></div><button class="text-link" id="favorites-see-all" type="button">${t("viewAll")} ${svg("arrow", 16)}</button></div>
          <div id="favorite-list" class="book-grid favorite-grid"></div>
        </section>

        <section id="view-library" class="view library-view" hidden>
          <div class="section-intro"><div><p class="section-kicker">${t("allBooksOnePlace")}</p><h2>${t("library")}</h2><p id="library-count-line">${countText(0, "savedBook", "savedBooks")}</p></div><img src="${leafUrl}" alt="" /></div>
          <div class="library-tools">
            <label class="search-field">${svg("search", 18)}<input id="library-search" type="search" placeholder="${t("searchTitle")}" aria-label="${t("searchBooks")}" /></label>
          </div>
          <div id="library-list" class="book-grid library-grid"></div>
        </section>

        <section id="view-settings" class="view settings-view" hidden>
          <div class="settings-intro"><p class="section-kicker">${t("yourWay")}</p><h2>${t("settings")}</h2><p>${t("settingsIntro")}</p></div>
          <div class="settings-group"><div class="settings-copy"><h3>${t("appearance")}</h3><p>${t("appearanceHelp")}</p></div><div class="theme-options" role="group" aria-label="${t("appTheme")}"><button type="button" data-theme-choice="light" class="theme-choice"><span class="theme-preview theme-light"></span>${t("light")}</button><button type="button" data-theme-choice="dark" class="theme-choice"><span class="theme-preview theme-dark"></span>${t("dark")}</button></div></div>
          <div class="settings-group"><div class="settings-copy"><h3>${t("bookFont")}</h3><p>${t("bookFontHelp")}</p></div><select id="book-font" aria-label="${t("bookFontLabel")}"><option value="original">${t("fontOriginal")}</option><option value="georgia">${t("fontGeorgia")}</option><option value="arial">${t("fontArial")}</option><option value="verdana">${t("fontVerdana")}</option><option value="times">${t("fontTimes")}</option></select></div>
          <div class="settings-group"><div class="settings-copy"><h3>${t("language")}</h3><p>${t("languageHelp")}</p></div><select id="app-language" aria-label="${t("languageLabel")}"><option value="en">English</option><option value="es">Español</option><option value="it">Italiano</option><option value="fr">Français</option></select></div>
          <div class="drive-panel" ${isAndroid ? "hidden" : ""}>
            <div class="settings-copy"><h3>${t("driveBackup")}</h3><p>${t("driveBackupHelp")}</p></div>
            <div class="drive-actions"><button id="drive-connect" type="button" class="secondary-button">${t("signInGoogle")}</button><span id="drive-connected" class="drive-connected" hidden><span aria-hidden="true">●</span> ${t("driveConnected")}</span><button id="drive-save" type="button" class="primary-button" disabled>${t("saveBackup")}</button></div>
            <div class="drive-restore"><label for="drive-backups">${t("availableBackup")}</label><select id="drive-backups" disabled><option value="">${t("connectToFind")}</option></select><button id="drive-import" type="button" class="secondary-button" disabled>${t("importBackup")}</button></div>
            <p id="drive-status" class="drive-status" role="status" aria-live="polite">${t("driveOptional")}</p>
          </div>
          <div class="settings-note"><img src="${leafUrl}" alt="" /><div><h3>${t("booksYours")}</h3><p>${t("localStorageHelp")}</p><span id="storage-count">${countText(0, "bookInLibrary", "booksInLibrary")}</span></div></div>
        </section>

        <section id="view-reader" class="view reader-view" hidden>
          <div class="reader-toolbar">
            <button id="back-button" class="back-button" type="button">${svg("back", 18)}<span>${t("back")}</span></button>
            <div class="reader-controls page-controls"><button id="previous-button" class="tool-button" type="button" aria-label="${t("previousPage")}">←</button><span id="position-label" class="position-label">—</span><button id="next-button" class="tool-button" type="button" aria-label="${t("nextPage")}">→</button></div>
            <button id="all-notes-button" class="reader-notes-button" type="button" aria-haspopup="dialog" aria-controls="all-notes-dialog">${svg("notes", 17)}<span>${t("notes")}</span><span id="notes-count" class="notes-count">0</span></button>
            <div class="reader-controls size-controls"><span id="size-label" class="size-label">${t("zoom")}</span><button id="smaller-button" class="tool-button" type="button" aria-label="${t("decreaseSize")}">−</button><span id="size-value" class="size-value">100%</span><button id="larger-button" class="tool-button" type="button" aria-label="${t("increaseSize")}">＋</button></div>
          </div>
          <div id="reading-surface" class="reading-surface" tabindex="-1"><div id="reader-content" class="reader-content"></div></div>
          <div class="reader-bottom"><span>${t("noteHint")}</span><span id="save-status">${t("progressSaved")}</span></div>
        </section>
      </main>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
      <div id="note-menu" class="note-menu" hidden><button id="note-add" type="button">${t("addNote")}</button></div>
      <div id="note-dialog" class="note-dialog" hidden>
        <div class="note-card" role="dialog" aria-modal="true" aria-labelledby="note-heading">
          <div class="note-card-head"><h2 id="note-heading">${t("addNote")}</h2><button id="note-close" type="button" class="note-close" aria-label="${t("closeNote")}">×</button></div>
          <p id="note-quote" class="note-quote"></p>
          <fieldset class="note-colors"><legend>${t("markerColor")}</legend><div id="note-color-options" class="note-color-options"></div></fieldset>
          <label class="note-label" for="note-text">${t("yourNote")}</label><textarea id="note-text" maxlength="5000" rows="5" placeholder="${t("notePlaceholder")}"></textarea>
          <div class="note-card-actions"><button id="note-delete" type="button" class="note-delete" hidden>${t("deleteNote")}</button><button id="note-cancel" type="button" class="secondary-button">${t("cancel")}</button><button id="note-save" type="button" class="primary-button">${t("saveNote")}</button></div>
        </div>
      </div>
      <div id="all-notes-dialog" class="notes-dialog" hidden>
        <aside class="notes-panel" role="dialog" aria-modal="true" aria-labelledby="all-notes-title">
          <div class="notes-panel-header"><div><span class="notes-eyebrow">Autumn Reader</span><h2 id="all-notes-title">${t("notes")}</h2></div><button id="all-notes-close" class="note-close" type="button" aria-label="${t("closeNotes")}">×</button></div>
          <div id="all-notes-list" class="notes-list"></div>
        </aside>
      </div>
      <div id="confirm-dialog" class="confirm-dialog" hidden>
        <div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-heading" aria-describedby="confirm-message">
          <div class="confirm-symbol" aria-hidden="true"><img src="${leafUrl}" alt="" /></div>
          <h2 id="confirm-heading"></h2>
          <p id="confirm-message"></p>
          <div class="confirm-actions"><button id="confirm-cancel" type="button" class="secondary-button">${t("cancel")}</button><button id="confirm-accept" type="button" class="primary-button"></button></div>
        </div>
      </div>
    </div>
  </div>
`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const fileInput = $<HTMLInputElement>("#file-input");
const readerContent = $<HTMLDivElement>("#reader-content");
const readingSurface = $<HTMLDivElement>("#reading-surface");
const coverUrls: string[] = [];

type View = "home" | "library" | "settings" | "reader";
let view: View = "home";
let lastCollectionView: "home" | "library" = "home";
let books: StoredBook[] = [];
let currentBook: StoredBook | null = null;
let pdfDocument: PDFDocumentProxy | null = null;
let pdfLoadingTask: PDFDocumentLoadingTask | null = null;
let pdfRenderTask: RenderTask | null = null;
let pdfTextLayer: TextLayer | null = null;
let pdfSelectionListener: AbortController | null = null;
let epubBook: EpubBook | null = null;
let rendition: Rendition | null = null;
let zoom = 1;
let loadSequence = 0;
let pdfRenderSequence = 0;
let toastTimer: number | undefined;
let theme: "light" | "dark" = localStorage.getItem("autumn-theme") === "dark" ? "dark" : "light";
const bookFontFamilies = {
  original: "",
  georgia: 'Georgia, "Times New Roman", serif',
  arial: 'Arial, Helvetica, sans-serif',
  verdana: 'Verdana, Geneva, sans-serif',
  times: '"Times New Roman", Times, serif',
} as const;
type BookFont = keyof typeof bookFontFamilies;
const storedBookFont = localStorage.getItem("autumn-book-font");
let bookFont: BookFont = storedBookFont && Object.hasOwn(bookFontFamilies, storedBookFont) ? storedBookFont as BookFont : "original";
const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem("autumn-google-client-id") || "").trim();
let driveConnected = false;
let driveAccessToken = "";
let driveBusy = false;

const noteColors = ["#cc5500", "#8b0000", "#996515", "#808000", "#b7410e", "#800020"];
type NoteAnchor = { format: "pdf"; page: number; y: number } | { format: "epub"; cfi: string };
let pendingNote: { quote: string; anchor: NoteAnchor } | null = null;
let editingNoteId: string | null = null;
let selectedNoteColor = noteColors[0];
let touchNoteTimer: number | undefined;
let confirmResolve: ((confirmed: boolean) => void) | null = null;
let confirmPreviousFocus: HTMLElement | null = null;

interface DriveBackup {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

function driveMessage(message: string): void {
  $<HTMLElement>("#drive-status").textContent = message;
}

function setDriveBusy(busy: boolean): void {
  driveBusy = busy;
  $<HTMLButtonElement>("#drive-connect").hidden = driveConnected;
  $<HTMLButtonElement>("#drive-connect").disabled = busy || !googleClientId;
  $<HTMLElement>("#drive-connected").hidden = !driveConnected;
  $<HTMLButtonElement>("#drive-save").disabled = busy || !driveConnected;
  $<HTMLButtonElement>("#drive-import").disabled = busy || !driveConnected || !$<HTMLSelectElement>("#drive-backups").value;
  $<HTMLSelectElement>("#drive-backups").disabled = busy || !driveConnected;
}

async function refreshDriveBackups(): Promise<void> {
  const backups = await invoke<DriveBackup[]>("drive_list_backups");
  const select = $<HTMLSelectElement>("#drive-backups");
  select.replaceChildren();
  if (!backups.length) {
    select.add(new Option(t("noBackups"), ""));
  } else {
    for (const backup of backups) {
      const date = new Date(backup.modifiedTime);
      const label = Number.isNaN(date.getTime()) ? t("savedBackup") : date.toLocaleString(language);
      const size = backup.size ? ` · ${(Number(backup.size) / 1024 / 1024).toFixed(1)} MB` : "";
      select.add(new Option(`${label}${size}`, backup.id));
    }
  }
  setDriveBusy(driveBusy);
}

function driveError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const sessionExpired = message.startsWith("DRIVE_ERROR:session_expired") || message.includes("conexión con Drive venció") || message.includes("sesión de Drive venció") || message.includes("401");
  const displayMessage = sessionExpired ? t("driveSessionExpired") : localizeDriveError(message);
  driveMessage(displayMessage);
  showToast(displayMessage);
  if (sessionExpired) {
    driveConnected = false;
    driveAccessToken = "";
    setDriveBusy(false);
  }
}

async function connectDrive(): Promise<void> {
  if (!googleClientId) return;
  setDriveBusy(true);
  driveMessage(t("openingGoogle"));
  try {
    driveAccessToken = await invoke<string>("drive_connect", { clientId: googleClientId, language });
    driveConnected = true;
    await refreshDriveBackups();
    driveMessage(t("driveReady"));
  } catch (error) {
    driveConnected = false;
    driveAccessToken = "";
    driveError(error);
  } finally {
    setDriveBusy(false);
  }
}

async function saveDriveBackup(): Promise<void> {
  if (!driveConnected) return;
  setDriveBusy(true);
  driveMessage(t("preparingBackup"));
  try {
    const archive = await createBackup(books);
    driveMessage(t("uploadingBackup", { size: (archive.byteLength / 1024 / 1024).toFixed(1) }));
    await invoke("drive_save_backup", archive, {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });
    await refreshDriveBackups();
    driveMessage(countText(books.length, "backupSavedOne", "backupSavedCount"));
    showToast(t("backupSaved"));
  } catch (error) {
    driveError(error);
  } finally {
    setDriveBusy(false);
  }
}

async function importDriveBackup(): Promise<void> {
  const fileId = $<HTMLSelectElement>("#drive-backups").value;
  if (!driveConnected || !fileId) return;
  if (!await confirmAction({
    title: t("importBackup"),
    message: t("importBackupMessage"),
    confirmLabel: t("importBooks"),
    tone: "import",
  })) return;
  setDriveBusy(true);
  driveMessage(t("downloadingBackup"));
  try {
    const bytes = await invoke<ArrayBuffer>("drive_download_backup", { fileId });
    const restored = await readBackup(new Uint8Array(bytes));
    for (const book of restored) {
      if (!book.notes) book.notes = books.find((local) => local.id === book.id)?.notes ?? [];
    }
    await saveBooks(restored);
    books = await listBooks();
    if (currentBook) {
      ++loadSequence;
      await clearReader();
      currentBook = null;
    }
    renderCollections();
    driveMessage(countText(restored.length, "importedOne", "importedCount"));
    showToast(t("backupImported"));
  } catch (error) {
    driveError(error);
  } finally {
    setDriveBusy(false);
  }
}

function titleOf(book: StoredBook): string {
  return book.name.replace(/\.(pdf|epub)$/i, "");
}

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function showToast(message: string): void {
  const toast = $<HTMLDivElement>("#toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 4000);
}

function closeConfirmation(confirmed: boolean): void {
  const dialog = $<HTMLDivElement>("#confirm-dialog");
  if (dialog.hidden) return;
  dialog.hidden = true;
  const resolve = confirmResolve;
  confirmResolve = null;
  confirmPreviousFocus?.focus();
  confirmPreviousFocus = null;
  resolve?.(confirmed);
}

function confirmAction(options: { title: string; message: string; confirmLabel: string; cancelLabel?: string; tone: "remove" | "import" }): Promise<boolean> {
  if (confirmResolve) closeConfirmation(false);
  const dialog = $<HTMLDivElement>("#confirm-dialog");
  const card = dialog.querySelector<HTMLElement>(".confirm-card")!;
  card.dataset.tone = options.tone;
  $<HTMLElement>("#confirm-heading").textContent = options.title;
  $<HTMLElement>("#confirm-message").textContent = options.message;
  $<HTMLButtonElement>("#confirm-accept").textContent = options.confirmLabel;
  $<HTMLButtonElement>("#confirm-cancel").textContent = options.cancelLabel ?? t("cancel");
  confirmPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.hidden = false;
  $<HTMLButtonElement>("#confirm-cancel").focus();
  return new Promise((resolve) => { confirmResolve = resolve; });
}

function setView(next: View): void {
  if (next !== "reader") {
    hideNoteMenu();
    closeNoteDialog();
    closeAllNotes();
  }
  view = next;
  $<HTMLElement>(".workspace").dataset.view = next;
  if (next === "home" || next === "library") lastCollectionView = next;
  for (const section of document.querySelectorAll<HTMLElement>(".view")) section.hidden = section.id !== `view-${next}`;
  $<HTMLButtonElement>("#import-button").hidden = next === "reader" || next === "settings";
  for (const button of document.querySelectorAll<HTMLButtonElement>(".nav-button")) {
    const selected = button.dataset.view === next;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const headings: Record<View, [string, string]> = {
    home: [t("home"), t("homeSubtitle")],
    library: [t("library"), countText(books.length, "savedBook", "savedBooks")],
    settings: [t("settings"), t("settingsSubtitle")],
    reader: [currentBook ? titleOf(currentBook) : t("reader"), t("enjoyReading")],
  };
  $<HTMLElement>("#page-title").textContent = headings[next][0];
  $<HTMLElement>("#page-subtitle").textContent = headings[next][1];
}

function applyTheme(): void {
  document.documentElement.dataset.theme = theme;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".theme-choice")) {
    const selected = button.dataset.themeChoice === theme;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  rendition?.themes.default({ body: { color: theme === "light" ? "#342a26" : "#ece4d8", background: theme === "light" ? "#fffdf8" : "#292322" } });
}

function applyBookFont(): void {
  rendition?.themes.font(bookFontFamilies[bookFont]);
}

function standardizeEpubPage(contents: Contents): void {
  if (epubBook?.packaging?.metadata?.layout === "pre-paginated") return;
  contents.addStylesheetCss(`
    html, body { margin-top: 0 !important; padding-top: 0 !important; }
    body > :first-child,
    body > :first-child > :first-child,
    body > :first-child > :first-child > :first-child {
      margin-top: 0 !important;
      padding-top: 0 !important;
    }
    body :is(h1, h2, h3, h4, h5, h6):first-child { margin-top: 0 !important; }
  `, "autumn-page-layout");
}

function coverElement(book: StoredBook): HTMLElement {
  const cover = document.createElement("div");
  cover.className = "book-cover";
  if (book.cover) {
    const url = URL.createObjectURL(book.cover);
    coverUrls.push(url);
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    image.loading = "lazy";
    cover.append(image);
  } else {
    const palette = ["#8B0000", "#996515", "#808000", "#B7410E", "#800020", "#CC5500"];
    const index = [...book.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
    cover.classList.add("book-cover-fallback");
    cover.style.setProperty("--cover-color", palette[index]);
    const ornament = document.createElement("img");
    ornament.src = leafUrl;
    ornament.alt = "";
    const title = document.createElement("span");
    title.textContent = titleOf(book);
    cover.append(ornament, title);
  }
  return cover;
}

function createBookCard(book: StoredBook, context: "home" | "library"): HTMLElement {
  const card = document.createElement("article");
  card.className = "book-card";
  const coverButton = document.createElement("button");
  coverButton.className = "cover-button";
  coverButton.type = "button";
  coverButton.setAttribute("aria-label", t("openBook", { title: titleOf(book) }));
  coverButton.append(coverElement(book));
  coverButton.addEventListener("click", () => void openBook(book));
  const info = document.createElement("div");
  info.className = "book-card-info";
  const titleButton = document.createElement("button");
  titleButton.className = "book-title";
  titleButton.type = "button";
  titleButton.textContent = titleOf(book);
  titleButton.addEventListener("click", () => void openBook(book));
  const meta = document.createElement("span");
  meta.className = "book-meta";
  meta.textContent = book.lastOpenedAt ? t("reading") : t("notStarted");
  const actions = document.createElement("div");
  actions.className = "book-actions";
  const favorite = document.createElement("button");
  favorite.className = `favorite-button${book.favorite ? " is-favorite" : ""}`;
  favorite.type = "button";
  favorite.innerHTML = svg("star", 17);
  favorite.title = book.favorite ? t("removeFavorite") : t("addFavorite");
  favorite.setAttribute("aria-label", t(book.favorite ? "removeFavoriteBook" : "addFavoriteBook", { title: titleOf(book) }));
  favorite.setAttribute("aria-pressed", String(Boolean(book.favorite)));
  favorite.addEventListener("click", () => void toggleFavorite(book));
  actions.append(favorite);
  if (context === "library") {
    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.type = "button";
    remove.innerHTML = svg("trash", 16);
    remove.title = t("removeLibrary");
    remove.setAttribute("aria-label", t("removeLibraryBook", { title: titleOf(book) }));
    remove.addEventListener("click", () => void removeBook(book));
    actions.append(remove);
  }
  info.append(titleButton, meta);
  card.append(coverButton, info, actions);
  return card;
}

function emptyState(message: string, withAction = false): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const leaf = document.createElement("img");
  leaf.src = leafUrl;
  leaf.alt = "";
  const text = document.createElement("p");
  text.textContent = message;
  empty.append(leaf, text);
  if (withAction) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t("addBooks");
    button.addEventListener("click", () => fileInput.click());
    empty.append(button);
  }
  return empty;
}

function renderCollections(): void {
  for (const url of coverUrls) URL.revokeObjectURL(url);
  coverUrls.length = 0;
  $<HTMLElement>("#nav-book-count").textContent = String(books.length);
  const recent = [...books].filter((book) => book.lastOpenedAt > 0).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const favorites = [...books].filter((book) => book.favorite).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const recentList = $<HTMLDivElement>("#recent-list");
  recentList.replaceChildren(...(recent.length ? recent.slice(0, 5).map((book) => createBookCard(book, "home")) : [emptyState(t("recentEmpty"), books.length === 0)]));
  const favoriteList = $<HTMLDivElement>("#favorite-list");
  favoriteList.replaceChildren(...(favorites.length ? favorites.slice(0, 5).map((book) => createBookCard(book, "home")) : [emptyState(t("favoritesEmpty"))]));

  const heroAction = $<HTMLButtonElement>("#hero-action");
  heroAction.querySelector("span")!.textContent = recent.length ? t("continueReading") : books.length ? t("exploreLibrary") : t("firstBook");
  $<HTMLElement>("#hero-description").textContent = recent.length
    ? t("lastRead", { title: titleOf(recent[0]) })
    : t("heroDescription");
  heroAction.onclick = () => recent.length ? void openBook(recent[0]) : books.length ? setView("library") : fileInput.click();

  $<HTMLElement>("#library-count-line").textContent = countText(books.length, "savedBook", "savedBooks");
  $<HTMLElement>("#storage-count").textContent = countText(books.length, "bookInLibrary", "booksInLibrary");
  if (view === "library") setView("library");
  const query = $<HTMLInputElement>("#library-search").value.trim().toLocaleLowerCase();
  const matches = [...books].filter((book) => titleOf(book).toLocaleLowerCase().includes(query)).sort((a, b) => b.addedAt - a.addedAt);
  const libraryList = $<HTMLDivElement>("#library-list");
  libraryList.replaceChildren(...(matches.length ? matches.map((book) => createBookCard(book, "library")) : [emptyState(books.length ? t("noSearchResults") : t("libraryEmpty"), books.length === 0)]));
}

async function toggleFavorite(book: StoredBook): Promise<void> {
  book.favorite = !book.favorite;
  try {
    await saveBook(book);
    renderCollections();
    showToast(book.favorite ? t("addedFavorite") : t("removedFavorite"));
  } catch {
    book.favorite = !book.favorite;
    showToast(t("favoriteSaveFailed"));
  }
}

async function removeBook(book: StoredBook): Promise<void> {
  if (!await confirmAction({
    title: t("removeBook"),
    message: t("removeBookMessage", { title: titleOf(book) }),
    confirmLabel: t("removeBook"),
    tone: "remove",
  })) return;
  try {
    await deleteBook(book.id);
    books = books.filter((item) => item.id !== book.id);
    if (currentBook?.id === book.id) {
      ++loadSequence;
      await clearReader();
      currentBook = null;
      setView("library");
    }
    renderCollections();
    showToast(t("bookRemoved"));
  } catch {
    showToast(t("bookRemoveFailed"));
  }
}

function updatePosition(): void {
  if (!currentBook) return;
  const position = currentBook.format === "pdf"
    ? t("pageOf", { page: currentBook.page, total: pdfDocument?.numPages ?? "…" })
    : rendition?.location?.start ? t("section", { number: rendition.location.start.index + 1 }) : t("book");
  $<HTMLSpanElement>("#position-label").textContent = position;
  $<HTMLButtonElement>("#previous-button").disabled = currentBook.format === "pdf" && currentBook.page <= 1;
  $<HTMLButtonElement>("#next-button").disabled = currentBook.format === "pdf" && currentBook.page >= (pdfDocument?.numPages ?? Infinity);
  $<HTMLSpanElement>("#size-label").textContent = currentBook.format === "pdf" ? t("zoom") : t("text");
  $<HTMLSpanElement>("#size-value").textContent = currentBook.format === "pdf" ? `${Math.round(zoom * 100)}%` : `${currentBook.fontSize}%`;
}

async function persistCurrent(): Promise<void> {
  if (!currentBook) return;
  try {
    await saveBook(currentBook);
    $<HTMLElement>("#save-status").textContent = t("progressSaved");
  } catch {
    $<HTMLElement>("#save-status").textContent = t("progressSaveFailed");
  }
}

function hideNoteMenu(): void {
  $<HTMLDivElement>("#note-menu").hidden = true;
}

function showNoteMenu(quote: string, anchor: NoteAnchor, x: number, y: number): void {
  pendingNote = { quote: quote.slice(0, 500), anchor };
  const menu = $<HTMLDivElement>("#note-menu");
  menu.hidden = false;
  menu.style.left = `${Math.min(x, window.innerWidth - 155)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 52)}px`;
}

function scheduleTouchNote(selection: () => { quote: string; anchor: NoteAnchor; x: number; y: number } | null): void {
  if (!navigator.maxTouchPoints && !window.matchMedia("(pointer: coarse)").matches) return;
  window.clearTimeout(touchNoteTimer);
  touchNoteTimer = window.setTimeout(() => {
    if (view !== "reader" || !$<HTMLDivElement>("#note-dialog").hidden) return;
    const note = selection();
    if (note) showNoteMenu(note.quote, note.anchor, note.x, note.y);
  }, 400);
}

function renderNoteColors(): void {
  const options = $<HTMLDivElement>("#note-color-options");
  options.replaceChildren(...noteColors.map((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `note-color${color === selectedNoteColor ? " selected" : ""}`;
    button.style.backgroundColor = color;
    button.setAttribute("aria-label", t("chooseColor", { color }));
    button.setAttribute("aria-pressed", String(color === selectedNoteColor));
    button.addEventListener("click", () => {
      selectedNoteColor = color;
      renderNoteColors();
    });
    return button;
  }));
}

function openNoteDialog(note?: BookNote): void {
  if (!note && !pendingNote) return;
  hideNoteMenu();
  editingNoteId = note?.id ?? null;
  selectedNoteColor = note?.color ?? noteColors[0];
  $<HTMLElement>("#note-heading").textContent = note ? t("yourNote") : t("addNote");
  $<HTMLElement>("#note-quote").textContent = `“${note?.quote ?? pendingNote?.quote ?? ""}”`;
  $<HTMLTextAreaElement>("#note-text").value = note?.text ?? "";
  $<HTMLButtonElement>("#note-delete").hidden = !note;
  renderNoteColors();
  $<HTMLDivElement>("#note-dialog").hidden = false;
  $<HTMLTextAreaElement>("#note-text").focus();
}

function closeNoteDialog(): void {
  $<HTMLDivElement>("#note-dialog").hidden = true;
  editingNoteId = null;
  pendingNote = null;
}

async function saveNote(): Promise<void> {
  const book = currentBook;
  const text = $<HTMLTextAreaElement>("#note-text").value.trim();
  if (!book || !text) {
    showToast(t("noteEmpty"));
    return;
  }
  const previous = book.notes ?? [];
  if (editingNoteId) {
    book.notes = previous.map((note) => note.id === editingNoteId ? { ...note, text, color: selectedNoteColor } : note);
  } else if (pendingNote) {
    book.notes = [...previous, {
      id: newId(), quote: pendingNote.quote, text, color: selectedNoteColor,
      createdAt: Date.now(), ...pendingNote.anchor,
    }];
  } else return;
  try {
    await saveBook(book);
    closeNoteDialog();
    updateNotesCount();
    renderNoteMarkers();
    showToast(t("noteSaved"));
  } catch {
    book.notes = previous;
    showToast(t("noteSaveFailed"));
  }
}

async function deleteNote(): Promise<void> {
  const book = currentBook;
  if (!book || !editingNoteId) return;
  const previous = book.notes ?? [];
  book.notes = previous.filter((note) => note.id !== editingNoteId);
  try {
    await saveBook(book);
    closeNoteDialog();
    updateNotesCount();
    renderNoteMarkers();
    showToast(t("noteDeleted"));
  } catch {
    book.notes = previous;
    showToast(t("noteDeleteFailed"));
  }
}

function updateNotesCount(): void {
  $<HTMLSpanElement>("#notes-count").textContent = String(currentBook?.notes?.length ?? 0);
}

function epubNoteSection(note: BookNote): number | null {
  if (note.format !== "epub") return null;
  try { return epubBook?.spine.get(note.cfi)?.index ?? null; }
  catch { return null; }
}

function noteLocation(note: BookNote): string {
  if (note.format === "pdf") return t("pageOf", { page: note.page, total: pdfDocument?.numPages ?? "…" });
  const section = epubNoteSection(note);
  return section === null ? t("book") : t("section", { number: section + 1 });
}

function renderAllNotes(): void {
  const list = $<HTMLDivElement>("#all-notes-list");
  const notes = [...(currentBook?.notes ?? [])].sort((a, b) => {
    if (a.format === "pdf" && b.format === "pdf") return a.page - b.page || a.y - b.y || a.createdAt - b.createdAt;
    if (a.format === "epub" && b.format === "epub") return (epubNoteSection(a) ?? 0) - (epubNoteSection(b) ?? 0) || a.createdAt - b.createdAt;
    return a.createdAt - b.createdAt;
  });
  if (!notes.length) {
    const empty = document.createElement("p");
    empty.className = "notes-empty";
    empty.textContent = t("notesEmpty");
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...notes.map((note) => {
    const card = document.createElement("article");
    card.className = "notes-entry";
    const header = document.createElement("div");
    header.className = "notes-entry-header";
    const color = document.createElement("span");
    color.className = "notes-entry-color";
    color.style.backgroundColor = note.color;
    color.setAttribute("aria-hidden", "true");
    const location = document.createElement("span");
    location.textContent = noteLocation(note);
    header.append(color, location);
    const quote = document.createElement("p");
    quote.className = "notes-entry-quote";
    quote.textContent = note.quote;
    const body = document.createElement("p");
    body.className = "notes-entry-text";
    body.textContent = note.text;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "notes-go-button";
    button.textContent = `${t("goToNote")} →`;
    button.addEventListener("click", () => void goToNote(note));
    card.append(header, quote, body, button);
    return card;
  }));
}

function openAllNotes(): void {
  if (!currentBook) return;
  renderAllNotes();
  $<HTMLDivElement>("#all-notes-dialog").hidden = false;
  $<HTMLButtonElement>("#all-notes-close").focus();
}

function closeAllNotes(): void {
  const dialog = $<HTMLDivElement>("#all-notes-dialog");
  if (dialog.hidden) return;
  dialog.hidden = true;
  $<HTMLButtonElement>("#all-notes-button").focus();
}

async function goToNote(note: BookNote): Promise<void> {
  if (!currentBook) return;
  closeAllNotes();
  try {
    if (note.format === "pdf" && currentBook.format === "pdf" && pdfDocument) {
      currentBook.page = note.page;
      readingSurface.scrollLeft = 0;
      await renderPdfPage();
      const sheet = readerContent.querySelector<HTMLElement>(".pdf-sheet");
      if (sheet) {
        const y = sheet.getBoundingClientRect().top - readingSurface.getBoundingClientRect().top
          + readingSurface.scrollTop + Math.max(0, Math.min(1, note.y)) * sheet.clientHeight;
        readingSurface.scrollTop = Math.max(0, y - readingSurface.clientHeight / 3);
      }
      await persistCurrent();
    } else if (note.format === "epub" && currentBook.format === "epub" && rendition) {
      await rendition.display(note.cfi);
      updatePosition();
      window.requestAnimationFrame(renderNoteMarkers);
    } else return;
    readingSurface.focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    showToast(t("noteJumpFailed"));
  }
}

function renderNoteMarkers(): void {
  readerContent.querySelectorAll(".note-marker").forEach((marker) => marker.remove());
  if (!currentBook || !currentBook.notes?.length || view !== "reader") return;
  const contentRect = readerContent.getBoundingClientRect();
  const placements: { note: BookNote; x: number; y: number }[] = [];
  for (const note of currentBook.notes) {
    if (note.format === "pdf") {
      if (currentBook.format !== "pdf" || note.page !== currentBook.page) continue;
      const sheet = readerContent.querySelector<HTMLElement>(".pdf-sheet");
      if (!sheet) continue;
      const rect = sheet.getBoundingClientRect();
      placements.push({ note, x: rect.right - contentRect.left + 8, y: rect.top - contentRect.top + note.y * rect.height });
    } else if (currentBook.format === "epub" && rendition) {
      try {
        const range = rendition.getRange(note.cfi);
        if (!range) continue;
        const frame = range.startContainer.ownerDocument?.defaultView?.frameElement as HTMLElement | null;
        if (!frame) continue;
        const frameRect = frame.getBoundingClientRect();
        const visibleRect = Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0
          && rect.left < frameRect.width && rect.right > 0 && rect.top < frameRect.height && rect.bottom > 0);
        if (!visibleRect) continue;
        placements.push({ note, x: frameRect.right - contentRect.left + 8,
          y: frameRect.top - contentRect.top + visibleRect.top });
      } catch { /* The note belongs to a section that is not displayed. */ }
    }
  }
  placements.sort((a, b) => a.y - b.y);
  let lastY = -100;
  for (const placement of placements) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "note-marker";
    marker.style.backgroundColor = placement.note.color;
    marker.style.left = `${Math.min(placement.x, readerContent.clientWidth - 27)}px`;
    const y = Math.max(8, placement.y - 10, lastY + (navigator.maxTouchPoints ? 36 : 24));
    marker.style.top = `${y}px`;
    lastY = y;
    marker.title = t("openNote");
    marker.setAttribute("aria-label", t("openNoteQuote", { quote: placement.note.quote }));
    marker.addEventListener("click", () => openNoteDialog(placement.note));
    readerContent.append(marker);
  }
}

async function clearReader(): Promise<void> {
  hideNoteMenu();
  closeNoteDialog();
  closeAllNotes();
  window.clearTimeout(touchNoteTimer);
  pdfSelectionListener?.abort();
  pdfSelectionListener = null;
  ++pdfRenderSequence;
  pdfRenderTask?.cancel();
  pdfRenderTask = null;
  pdfTextLayer?.cancel();
  pdfTextLayer = null;
  if (pdfLoadingTask) await pdfLoadingTask.destroy();
  pdfLoadingTask = null;
  pdfDocument = null;
  rendition?.destroy();
  rendition = null;
  epubBook?.destroy();
  epubBook = null;
  readerContent.replaceChildren();
  readerContent.classList.remove("pdf-content");
}

type ScrollCenter = { x: number; y: number };

function readerScrollCenter(): ScrollCenter {
  return {
    x: (readingSurface.scrollLeft + readingSurface.clientWidth / 2) / Math.max(readingSurface.scrollWidth, readingSurface.clientWidth),
    y: (readingSurface.scrollTop + readingSurface.clientHeight / 2) / Math.max(readingSurface.scrollHeight, readingSurface.clientHeight),
  };
}

async function renderPdfPage(scrollCenter?: ScrollCenter): Promise<void> {
  if (!pdfDocument || !currentBook || currentBook.format !== "pdf") return;
  const sequence = ++pdfRenderSequence;
  pdfSelectionListener?.abort();
  pdfSelectionListener = null;
  pdfRenderTask?.cancel();
  pdfTextLayer?.cancel();
  pdfTextLayer = null;
  currentBook.page = Math.max(1, Math.min(currentBook.page, pdfDocument.numPages));
  const page = await pdfDocument.getPage(currentBook.page);
  if (sequence !== pdfRenderSequence) return;
  const natural = page.getViewport({ scale: 1 });
  const contentStyle = getComputedStyle(readerContent);
  const horizontalPadding = parseFloat(contentStyle.paddingLeft) + parseFloat(contentStyle.paddingRight);
  const verticalPadding = parseFloat(contentStyle.paddingTop) + parseFloat(contentStyle.paddingBottom);
  const availableWidth = Math.max(120, readingSurface.clientWidth - horizontalPadding);
  const availableHeight = Math.max(120, readingSurface.clientHeight - verticalPadding);
  const fitScale = Math.min(availableWidth / natural.width, availableHeight / natural.height);
  const viewport = page.getViewport({ scale: fitScale * zoom });
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.className = "pdf-page";
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const sheet = document.createElement("div");
  sheet.className = "pdf-sheet";
  sheet.style.width = `${viewport.width}px`;
  sheet.style.height = `${viewport.height}px`;
  sheet.style.setProperty("--total-scale-factor", String(viewport.scale));
  const textLayerElement = document.createElement("div");
  textLayerElement.className = "pdf-text-layer";
  sheet.append(canvas, textLayerElement);
  readerContent.classList.add("pdf-content");
  readerContent.replaceChildren(sheet);
  if (scrollCenter) {
    readingSurface.scrollLeft = scrollCenter.x * readingSurface.scrollWidth - readingSurface.clientWidth / 2;
    readingSurface.scrollTop = scrollCenter.y * readingSurface.scrollHeight - readingSurface.clientHeight / 2;
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("viewerFailed"));
  const task = page.render({ canvasContext: context, canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
  pdfRenderTask = task;
  try { await task.promise; }
  catch (error) { if (!(error instanceof Error && error.name === "RenderingCancelledException")) throw error; }
  finally { if (pdfRenderTask === task) pdfRenderTask = null; }
  if (sequence !== pdfRenderSequence) return;
  const textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: textLayerElement, viewport });
  pdfTextLayer = textLayer;
  try { await textLayer.render(); }
  catch (error) { if (sequence === pdfRenderSequence) console.info(t("noSelectableText"), error); }
  if (sequence !== pdfRenderSequence) return;
  const selectedText = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!textLayerElement.contains(range.startContainer) || !textLayerElement.contains(range.endContainer)) return null;
    const quote = selection.toString().trim();
    if (!quote || !currentBook || currentBook.format !== "pdf") return null;
    const rect = range.getBoundingClientRect();
    const pageRect = sheet.getBoundingClientRect();
    const y = Math.max(0, Math.min(1, (rect.top - pageRect.top) / pageRect.height));
    return { quote, anchor: { format: "pdf" as const, page: currentBook.page, y }, x: rect.left, y: rect.bottom + 8 };
  };
  textLayerElement.addEventListener("contextmenu", (event) => {
    const note = selectedText();
    if (!note) return;
    event.preventDefault();
    showNoteMenu(note.quote, note.anchor, event.clientX, event.clientY);
  });
  pdfSelectionListener = new AbortController();
  document.addEventListener("selectionchange", () => scheduleTouchNote(selectedText), { signal: pdfSelectionListener.signal });
  renderNoteMarkers();
  updatePosition();
}

async function openBook(book: StoredBook): Promise<void> {
  const sequence = ++loadSequence;
  await clearReader();
  if (sequence !== loadSequence) return;
  currentBook = book;
  book.lastOpenedAt = Date.now();
  zoom = 1;
  updateNotesCount();
  setView("reader");
  renderCollections();
  readerContent.textContent = "";
  const loadingMessage = document.createElement("div");
  loadingMessage.className = "reader-message";
  loadingMessage.textContent = t("openingBook");
  readerContent.append(loadingMessage);
  updatePosition();
  try {
    const buffer = await book.data.arrayBuffer();
    if (sequence !== loadSequence) return;
    if (book.format === "pdf") {
      const task = getDocument({ data: new Uint8Array(buffer) });
      pdfLoadingTask = task;
      pdfDocument = await task.promise;
      if (sequence !== loadSequence) return;
      await renderPdfPage();
    } else {
      const frame = document.createElement("div");
      frame.className = "epub-frame";
      readerContent.replaceChildren(frame);
      epubBook = ePub(buffer);
      rendition = epubBook.renderTo(frame, { width: "100%", height: "100%", flow: "paginated", spread: "none" });
      rendition.hooks.content.register((contents: Contents) => {
        standardizeEpubPage(contents);
        addTapNavigation(contents.document, () => contents.window.getSelection());
        const selectedText = () => {
          const selection = contents.window.getSelection();
          if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
          const quote = selection.toString().trim();
          if (!quote) return null;
          const range = selection.getRangeAt(0);
          let cfi: string;
          try { cfi = contents.cfiFromRange(range); }
          catch { return null; }
          const frameElement = contents.document.defaultView?.frameElement as HTMLElement | null;
          if (!frameElement) return null;
          const frameRect = frameElement.getBoundingClientRect();
          const rect = range.getBoundingClientRect();
          return { quote, anchor: { format: "epub" as const, cfi }, x: frameRect.left + rect.left, y: frameRect.top + rect.bottom + 8 };
        };
        contents.document.addEventListener("contextmenu", (event) => {
          const note = selectedText();
          if (!note) return;
          event.preventDefault();
          const frameElement = contents.document.defaultView?.frameElement as HTMLElement | null;
          if (frameElement) {
            const frameRect = frameElement.getBoundingClientRect();
            showNoteMenu(note.quote, note.anchor, frameRect.left + event.clientX, frameRect.top + event.clientY);
          }
        });
        contents.document.addEventListener("selectionchange", () => scheduleTouchNote(selectedText));
      });
      rendition.themes.fontSize(`${book.fontSize}%`);
      applyTheme();
      applyBookFont();
      rendition.on("relocated", (location: Location) => {
        if (currentBook?.id !== book.id) return;
        book.cfi = location.start.cfi;
        updatePosition();
        void persistCurrent();
        window.requestAnimationFrame(renderNoteMarkers);
      });
      await rendition.display(book.cfi || undefined);
      window.requestAnimationFrame(renderNoteMarkers);
    }
    await persistCurrent();
    updatePosition();
  } catch (error) {
    if (sequence !== loadSequence) return;
    console.error(error);
    readerContent.replaceChildren();
    const errorMessage = document.createElement("div");
    errorMessage.className = "reader-message";
    errorMessage.textContent = t("bookOpenFailedHelp");
    readerContent.append(errorMessage);
    showToast(t("bookOpenFailed"));
  }
}

async function makeCover(book: StoredBook): Promise<void> {
  try {
    const buffer = await book.data.arrayBuffer();
    let cover: Blob | null = null;
    if (book.format === "pdf") {
      const task = getDocument({ data: new Uint8Array(buffer) });
      try {
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 250 / natural.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (context) {
          await page.render({ canvasContext: context, canvas, viewport }).promise;
          cover = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
        }
      } finally { await task.destroy(); }
    } else {
      const epub = ePub(buffer);
      try {
        await epub.ready;
        const url = await epub.coverUrl();
        if (url && (url.startsWith("blob:") || url.startsWith("data:"))) {
          const response = await fetch(url);
          if (response.ok) cover = await response.blob();
        }
      } finally { epub.destroy(); }
    }
    if (cover && books.some((item) => item.id === book.id)) {
      book.cover = cover;
      await saveBook(book);
      renderCollections();
    }
  } catch (error) {
    console.info(t("simpleCover"), error);
  }
}

async function importFiles(files: FileList): Promise<void> {
  let first: StoredBook | null = null;
  let rejected = 0;
  for (const file of Array.from(files)) {
    const format = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : file.name.toLowerCase().endsWith(".epub") ? "epub" : null;
    if (!format) { rejected++; continue; }
    const book: StoredBook = {
      id: newId(), name: file.name, format, data: file,
      addedAt: Date.now(), lastOpenedAt: 0, favorite: false,
      page: 1, cfi: null, fontSize: 100,
    };
    try {
      await saveBook(book);
      books.unshift(book);
      first ??= book;
      void makeCover(book);
    } catch { rejected++; }
  }
  renderCollections();
  if (first) await openBook(first);
  if (rejected) showToast(countText(rejected, "filesRejectedOne", "filesRejectedMany"));
}

async function navigate(direction: -1 | 1): Promise<void> {
  if (!currentBook || view !== "reader") return;
  if (currentBook.format === "pdf" && pdfDocument) {
    const next = currentBook.page + direction;
    if (next < 1 || next > pdfDocument.numPages) return;
    currentBook.page = next;
    readingSurface.scrollTop = 0;
    readingSurface.scrollLeft = 0;
    await renderPdfPage();
    await persistCurrent();
  } else if (rendition) {
    await (direction < 0 ? rendition.prev() : rendition.next());
  }
}

function addTapNavigation(target: Document | HTMLElement, getSelection: () => Selection | null): void {
  let start: { x: number; y: number; time: number } | null = null;
  target.addEventListener("touchstart", (event) => {
    const touches = (event as TouchEvent).touches;
    if (touches.length !== 1 || view !== "reader") { start = null; return; }
    if ((event.target as Element | null)?.closest?.("a, button, input, select, textarea, [role='button'], [contenteditable='true']")) {
      start = null;
      return;
    }
    const touch = touches[0];
    start = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, { passive: true });
  target.addEventListener("touchmove", (event) => {
    if (!start) return;
    const touches = (event as TouchEvent).touches;
    if (touches.length !== 1 || Math.abs(touches[0].clientX - start.x) > 12 || Math.abs(touches[0].clientY - start.y) > 12) {
      start = null;
    }
  }, { passive: true });
  target.addEventListener("touchend", (event) => {
    const touches = (event as TouchEvent).changedTouches;
    if (!start || touches.length !== 1 || view !== "reader") return;
    const touch = touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const elapsed = Date.now() - start.time;
    start = null;
    if (elapsed > 450 || Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    if (getSelection()?.isCollapsed === false || !$<HTMLDivElement>("#note-dialog").hidden || !$<HTMLDivElement>("#all-notes-dialog").hidden || !$<HTMLDivElement>("#note-menu").hidden) return;
    const embedded = "documentElement" in target;
    const width = embedded ? target.documentElement.clientWidth : target.clientWidth;
    const x = embedded ? touch.clientX : touch.clientX - target.getBoundingClientRect().left;
    const edgeWidth = Math.min(width * 0.25, 120);
    if (x < edgeWidth) void navigate(-1);
    else if (x > width - edgeWidth) void navigate(1);
  }, { passive: true });
  target.addEventListener("touchcancel", () => { start = null; }, { passive: true });
}

addTapNavigation(readingSurface, () => window.getSelection());

function changeSize(direction: -1 | 1): void {
  if (!currentBook) return;
  if (currentBook.format === "pdf") {
    const scrollCenter = readerScrollCenter();
    zoom = Math.max(0.5, Math.min(2, Math.round((zoom + direction * 0.1) * 10) / 10));
    void renderPdfPage(scrollCenter);
  } else if (rendition) {
    currentBook.fontSize = Math.max(70, Math.min(180, currentBook.fontSize + direction * 10));
    rendition.themes.fontSize(`${currentBook.fontSize}%`);
    void persistCurrent();
    window.requestAnimationFrame(renderNoteMarkers);
  }
  updatePosition();
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".nav-button")) {
  button.addEventListener("click", () => setView(button.dataset.view as View));
}
$("#brand-home").addEventListener("click", () => setView("home"));
$("#import-button").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files) void importFiles(fileInput.files);
  fileInput.value = "";
});
$("#recent-see-all").addEventListener("click", () => setView("library"));
$("#favorites-see-all").addEventListener("click", () => setView("library"));
$("#back-button").addEventListener("click", () => setView(lastCollectionView));
$("#previous-button").addEventListener("click", () => void navigate(-1));
$("#next-button").addEventListener("click", () => void navigate(1));
$("#smaller-button").addEventListener("click", () => changeSize(-1));
$("#larger-button").addEventListener("click", () => changeSize(1));
$("#note-add").addEventListener("click", () => openNoteDialog());
$("#note-save").addEventListener("click", () => void saveNote());
$("#note-delete").addEventListener("click", () => void deleteNote());
$("#note-cancel").addEventListener("click", closeNoteDialog);
$("#note-close").addEventListener("click", closeNoteDialog);
$("#all-notes-button").addEventListener("click", openAllNotes);
$("#all-notes-close").addEventListener("click", closeAllNotes);
$<HTMLDivElement>("#all-notes-dialog").addEventListener("mousedown", (event) => {
  if (event.target === event.currentTarget) closeAllNotes();
});
$<HTMLDivElement>("#note-dialog").addEventListener("mousedown", (event) => {
  if (event.target === event.currentTarget) closeNoteDialog();
});
$("#confirm-cancel").addEventListener("click", () => closeConfirmation(false));
$("#confirm-accept").addEventListener("click", () => closeConfirmation(true));
$<HTMLDivElement>("#confirm-dialog").addEventListener("mousedown", (event) => {
  if (event.target === event.currentTarget) closeConfirmation(false);
});
document.addEventListener("pointerdown", (event) => {
  if (!$<HTMLDivElement>("#note-menu").contains(event.target as Node)) hideNoteMenu();
});
$<HTMLInputElement>("#library-search").addEventListener("input", renderCollections);
for (const button of document.querySelectorAll<HTMLButtonElement>(".theme-choice")) {
  button.addEventListener("click", () => {
    theme = button.dataset.themeChoice as "light" | "dark";
    localStorage.setItem("autumn-theme", theme);
    applyTheme();
  });
}
const bookFontSelect = $<HTMLSelectElement>("#book-font");
bookFontSelect.value = bookFont;
bookFontSelect.addEventListener("change", () => {
  const choice = bookFontSelect.value;
  if (!Object.hasOwn(bookFontFamilies, choice)) return;
  bookFont = choice as BookFont;
  localStorage.setItem("autumn-book-font", bookFont);
  applyBookFont();
  showToast(t("bookFontSaved"));
});
const languageSelect = $<HTMLSelectElement>("#app-language");
languageSelect.value = (localStorage.getItem("autumn-language") || language) as Language;
if (!languageSelect.selectedOptions.length) languageSelect.value = language;
languageSelect.addEventListener("change", async () => {
  const next = languageSelect.value as Language;
  saveLanguage(next);
  if (next === language) return;
  const restart = await confirmAction({
    title: t("restartTitle"),
    message: t("restartMessage"),
    confirmLabel: t("restartNow"),
    cancelLabel: t("restartLater"),
    tone: "import",
  });
  if (restart) {
    try {
      await invoke("restart_app");
    } catch (error) {
      console.error(error);
      showToast(t("restartLaterStatus"));
    }
  } else showToast(t("restartLaterStatus"));
});
if (!googleClientId) {
  driveMessage(t("driveNotConfigured"));
  $<HTMLButtonElement>("#drive-connect").title = t("driveNotConfiguredTitle");
}
setDriveBusy(false);
$<HTMLButtonElement>("#drive-connect").addEventListener("click", () => void connectDrive());
$<HTMLButtonElement>("#drive-save").addEventListener("click", () => void saveDriveBackup());
$<HTMLButtonElement>("#drive-import").addEventListener("click", () => void importDriveBackup());
$<HTMLSelectElement>("#drive-backups").addEventListener("change", () => setDriveBusy(false));
window.addEventListener("keydown", (event) => {
  if (!$<HTMLDivElement>("#confirm-dialog").hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation(false);
    } else if (event.key === "Tab") {
      const cancel = $<HTMLButtonElement>("#confirm-cancel");
      const accept = $<HTMLButtonElement>("#confirm-accept");
      if (event.shiftKey && document.activeElement === cancel) { event.preventDefault(); accept.focus(); }
      else if (!event.shiftKey && document.activeElement === accept) { event.preventDefault(); cancel.focus(); }
    }
    return;
  }
  if (event.key === "Escape") {
    if (!$<HTMLDivElement>("#note-dialog").hidden) closeNoteDialog();
    if (!$<HTMLDivElement>("#all-notes-dialog").hidden) closeAllNotes();
    hideNoteMenu();
    return;
  }
  if (!$<HTMLDivElement>("#note-dialog").hidden || !$<HTMLDivElement>("#all-notes-dialog").hidden) return;
  if (event.altKey || event.ctrlKey || event.metaKey || view !== "reader") return;
  if (event.key === "ArrowLeft") { event.preventDefault(); void navigate(-1); }
  if (event.key === "ArrowRight") { event.preventDefault(); void navigate(1); }
});
let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (view !== "reader") return;
    if (currentBook?.format === "pdf") void renderPdfPage();
    else renderNoteMarkers();
  }, 150);
});

applyTheme();
setView("home");
listBooks().then((loaded) => {
  books = loaded;
  renderCollections();
}).catch(() => showToast(t("libraryOpenFailed")));
