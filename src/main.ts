import ePub, { type Book as EpubBook, type Contents, type Location, type Rendition } from "epubjs";
import type {
  TextLayer,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPdfEngine } from "./readers/pdf-engine";
import { invoke } from "@tauri-apps/api/core";
import { pdfTextBlocks, PdfTextView, type PdfTextBlock } from "./pdf-text";
import { countText, language, saveLanguage, t, type Language } from "./i18n";
import leafUrl from "./assets/autumn-leaf.png";
import { deleteBook, listBooks, nativeBookUrl, readBookData, saveBook, cacheBookCover, setCloudBookLoader, hasLocalFile, type BookNote, type StoredBook } from "./storage";
import "./style.css";
import { auth } from "./services/auth";
import { mountAccount } from "./ui/account";
import { mountAccountSecurity } from "./ui/account-security";
import { mountAccountStorage } from "./ui/account-storage";
import { cloudStorage } from "./services/books/cloud-storage";
import { bookStorage, requestPersistentCache } from "./services/storage";
import { optimizeCover } from "./services/storage/covers";
import { bookCache } from "./services/storage";
import { downloadPrivateCover } from "./services/storage/book-covers";
import { mountBookEditor, type BookEditor } from "./ui/edit-book";
import { library } from "./services/books";
import { sync } from "./services/sync";
import { mountSync } from "./ui/sync";
import { migrateLibrary, resumeApprovedMigrations } from "./services/sync/migration";
import { errorMessage } from "./services/errors";
import { mountDetails } from "./ui/social-details";
import { mountProfile, type ProfileUI } from "./ui/profile-page";
import { mountBookCarousel } from "./ui/book-carousel";
import { bookProgress, presentationCard, readingBooks } from "./ui/book-presentation";
import { mountReviewComposer, type ReviewComposer } from "./ui/reviews";
import type { ReviewEntry } from "./services/reviews/personal";
import { mountSettings } from "./ui/settings";
import { platformFilePicker } from "./services/platform/files";
import { mountFolders, type FolderUI } from "./ui/folders";
import { mountLibraryDrag } from "./ui/library-drag";
import { folders } from "./services/folders";
import { localAll } from "./services/local/database";
import type { MigrationState } from "./services/sync/migration";
import { bookColors, colorName, hexColor } from "./book-colors";
import { loadPagePreferences, savePagePreferences, defaultPagePreferences, pageSpacingCss } from "./services/preferences/page";
import { ReaderHistory, type ReaderPosition } from "./readers/history";
import { epubSearch, pdfSearch, quoteRects, type BookSearch, type SearchResult } from "./readers/search";
import { mountBookSearch, type SearchUI } from "./ui/book-search";
import { bindPageGestures } from "./readers/gestures";
import { pageSnapshot, pageTurnSheetTransform, slide } from "./readers/page-turn";
import { translationService } from "./services/translation";
import { mountTranslation, type TranslationUI } from "./ui/translation";
import { pdfDestination, pdfPageLinks } from "./readers/pdf-navigation";

const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  library: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m17 5 4 14M3 8h5m2 4h5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6 6-6-6 6-6"/>',
  star: '<path d="m12 2 3.1 6.4 7.1 1-5.1 5 .9 7.1-6-3.3-6 3.3.9-7.1-5.1-5 7.1-1z"/>',
  trash: '<path d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
  notes: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  cloud: '<path d="M7 19h11a4 4 0 0 0 .4-8A6.5 6.5 0 0 0 6 9a5 5 0 0 0 1 10z"/>',
};

function svg(name: keyof typeof icons, size = 19): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

const isAndroid = /\bAndroid\b/i.test(navigator.userAgent);
const app = document.querySelector<HTMLDivElement>("#app")!;
document.documentElement.lang = language;
if (isAndroid) document.documentElement.classList.add("android-app");
app.innerHTML = `
  <div class="shell" hidden>
    <aside class="sidebar">
      <button class="brand" id="brand-home" type="button" aria-label="${t("goHome")}">
        <img src="${leafUrl}" alt="" /><span>Autumn <strong>Reader</strong></span>
      </button>
      <div class="nav-caption">${t("yourSpace")}</div>
      <nav class="sidebar-nav" aria-label="${t("mainNavigation")}">
        <button class="nav-button active" data-view="home" type="button">${svg("home")}<span>${t("home")}</span></button>
        <button class="nav-button" data-view="library" type="button">${svg("library")}<span>${t("library")}</span><span id="nav-book-count" class="nav-count">0</span></button>
        <button class="nav-button" data-view="settings" type="button">${svg("settings")}<span>${t("settings")}</span></button>
        <button class="nav-button" data-view="profile" type="button">${svg("profile")}<span>${t("profile")}</span></button>
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
          <div class="hero" id="home-hero">
            <div class="hero-copy"><p class="hero-eyebrow" id="hero-eyebrow">${t("continueReading")}</p><h2 id="hero-title"></h2><p class="hero-author" id="hero-author"></p><p id="hero-description"></p><div id="hero-progress" class="hero-progress" role="progressbar" hidden><span class="hero-progress-track"><span id="hero-progress-fill"></span></span><span id="hero-progress-value"></span></div><button id="hero-action" class="hero-button" type="button"><span>${t("firstBook")}</span>${svg("arrow", 18)}</button></div>
            <div class="hero-art" id="hero-art" aria-hidden="true"></div>
          </div>

          <div class="shelf-heading"><div><p class="section-kicker">${t("continueWhere")}</p><h2>${t("continueReading")}</h2></div><div class="carousel-controls" role="group" aria-label="${t("continueReading")}" hidden><button id="recent-previous" type="button" aria-label="${t("previousBooks")}">‹</button><button id="recent-next" type="button" aria-label="${t("nextBooks")}">›</button></div></div>
          <div id="recent-list" class="book-grid recent-grid" role="region" aria-label="${t("continueReading")}" tabindex="0"></div>
        </section>

        <section id="view-library" class="view library-view" hidden>
          <div class="section-intro"><div><p class="section-kicker">${t("allBooksOnePlace")}</p><h2>${t("library")}</h2><p id="library-count-line">${countText(0, "savedBook", "savedBooks")}</p></div><img src="${leafUrl}" alt="" /></div>
          <div class="library-tools">
            <label class="search-field">${svg("search", 18)}<input id="library-search" type="search" placeholder="${t("searchTitle")}" aria-label="${t("searchBooks")}" /></label>
            <div class="library-display-tools"><label class="library-sort-label" for="library-sort">${t("sortLibrary")}</label><select id="library-sort" aria-label="${t("sortLibrary")}"><option value="recent">${t("sortRecent")}</option><option value="title-asc">${t("sortTitleAsc")}</option><option value="title-desc">${t("sortTitleDesc")}</option><option value="author">${t("sortAuthor")}</option><option value="progress">${t("sortProgress")}</option><option value="added">${t("sortAdded")}</option></select><div class="library-layout-toggle" role="group" aria-label="${t("library")}"><button id="library-grid-button" type="button" aria-label="${t("libraryGrid")}" aria-pressed="true">▦</button><button id="library-list-button" type="button" aria-label="${t("libraryList")}" aria-pressed="false">☰</button></div></div>
          </div>
          <div id="library-folders"></div>
          <div id="library-list" class="book-grid library-grid"></div>
        </section>

        <section id="view-settings" class="view settings-view" hidden>
          <div class="settings-tabs" role="tablist" aria-label="${t("settings")}">
            <button id="settings-account-tab" type="button" role="tab" aria-controls="settings-account-panel" aria-selected="true">${t("accountSettings")}</button>
            <button id="settings-page-tab" type="button" role="tab" aria-controls="settings-page-panel" aria-selected="false" tabindex="-1">${t("pageSettings")}</button>
            <button id="settings-interface-tab" type="button" role="tab" aria-controls="settings-interface-panel" aria-selected="false" tabindex="-1">${t("interfaceSettings")}</button>
          </div>
          <section id="settings-account-panel" class="settings-section" role="tabpanel" aria-labelledby="settings-account-tab" tabindex="0">
            <div class="settings-section-heading"><h2>${t("accountSettings")}</h2><p>${t("accountSettingsHelp")}</p></div>
            <div id="settings-session"></div>
            <div id="settings-security"></div>
            <div id="settings-cloud-storage"></div>
            <div id="settings-sync"></div>
          <div class="settings-note"><img src="${leafUrl}" alt="" /><div><h3>${t("booksYours")}</h3><p>${t("localStorageHelp")}</p><span id="storage-count">${countText(0, "bookInLibrary", "booksInLibrary")}</span></div></div>
          </section>
          <section id="settings-page-panel" class="settings-section" role="tabpanel" aria-labelledby="settings-page-tab" tabindex="0" hidden>
            <div class="settings-section-heading"><h2>${t("pageSettings")}</h2><p>${t("pageSettingsHelp")}</p></div>
          <div class="settings-group"><div class="settings-copy"><h3>${t("bookFont")}</h3><p>${t("bookFontHelp")}</p></div><select id="book-font" aria-label="${t("bookFontLabel")}"><option value="original">${t("fontOriginal")}</option><option value="georgia">${t("fontGeorgia")}</option><option value="arial">${t("fontArial")}</option><option value="verdana">${t("fontVerdana")}</option><option value="times">${t("fontTimes")}</option></select></div>
          <div class="settings-group"><div class="settings-copy"><h3>${t("lineSpacing")}</h3><p>${t("lineSpacingHelp")}</p></div><label class="spacing-control"><span>${t("compact")}</span><input id="line-spacing" type="range" min="1.2" max="2.4" step="0.1" aria-label="${t("lineSpacing")}" /><span>${t("wide")}</span><output id="line-spacing-value"></output></label></div>
          <div class="settings-group"><div class="settings-copy"><h3>${t("paragraphSpacing")}</h3><p>${t("paragraphSpacingHelp")}</p></div><label class="spacing-control"><span>${t("compact")}</span><input id="paragraph-spacing" type="range" min="0" max="2.5" step="0.1" aria-label="${t("paragraphSpacing")}" /><span>${t("wide")}</span><output id="paragraph-spacing-value"></output></label></div>
          <button id="spacing-reset" class="secondary-button" type="button">${t("resetSpacing")}</button>
          </section>
          <section id="settings-interface-panel" class="settings-section" role="tabpanel" aria-labelledby="settings-interface-tab" tabindex="0" hidden>
            <div class="settings-section-heading"><h2>${t("interfaceSettings")}</h2><p>${t("interfaceSettingsHelp")}</p></div>
          <div class="settings-group"><div class="settings-copy"><h3>${t("appearance")}</h3><p>${t("appearanceHelp")}</p></div><div class="theme-options" role="group" aria-label="${t("appTheme")}"><button type="button" data-theme-choice="light" class="theme-choice"><span class="theme-preview theme-light"></span>${t("light")}</button><button type="button" data-theme-choice="dark" class="theme-choice"><span class="theme-preview theme-dark"></span>${t("dark")}</button></div></div>
          <div class="settings-group"><div class="settings-copy"><h3>${t("pageTurnAnimation")}</h3><p id="page-turn-animation-help">${t("pageTurnAnimationHelp")}</p></div><label class="settings-switch"><input id="page-turn-animation" type="checkbox" aria-label="${t("pageTurnAnimation")}" aria-describedby="page-turn-animation-help" /><span class="switch-track" aria-hidden="true"><span></span></span><span id="page-turn-animation-status"></span></label></div>
          <div class="settings-group"><div class="settings-copy"><h3>${t("language")}</h3><p>${t("languageHelp")}</p></div><select id="app-language" aria-label="${t("languageLabel")}"><option value="en">English</option><option value="es">Español</option><option value="it">Italiano</option><option value="fr">Français</option></select></div>
          </section>
        </section>

        <section id="view-profile" class="view profile-view" hidden></section>
        <section id="view-details" class="view details-view" hidden></section>
        <section id="view-reader" class="view reader-view" hidden>
          <div class="reader-toolbar">
            <button id="back-button" class="back-button" type="button">${svg("back", 18)}<span>${t("back")}</span></button>
            <div class="reader-controls page-controls"><button id="previous-button" class="tool-button" type="button" aria-label="${t("previousPage")}">←</button><span id="position-label" class="position-label">—</span><button id="next-button" class="tool-button" type="button" aria-label="${t("nextPage")}">→</button></div>
            <button id="all-notes-button" class="reader-notes-button" type="button" aria-haspopup="dialog" aria-controls="all-notes-dialog">${svg("notes", 17)}<span>${t("notes")}</span><span id="notes-count" class="notes-count">0</span></button>
            <button id="book-search-button" class="tool-button" type="button" aria-label="${t("searchInBook")}" aria-controls="book-search-panel">${svg("search", 18)}</button>
            <select id="reader-toc" aria-label="${t("tableOfContents")}" hidden></select>
            <select id="pdf-reading-mode" class="pdf-reading-mode" aria-label="${t("readingMode")}" hidden><option value="text">${t("adjustableText")}</option><option value="original">${t("originalPage")}</option></select>
            <div class="reader-controls size-controls"><span id="size-label" class="size-label">${t("text")}</span><button id="smaller-button" class="tool-button" type="button" aria-label="${t("decreaseSize")}">−</button><span id="size-value" class="size-value">100%</span><button id="larger-button" class="tool-button" type="button" aria-label="${t("increaseSize")}">＋</button></div>
          </div>
          <div id="reader-history" class="reader-history" hidden><button id="history-back" class="text-link" type="button" aria-label="${t("historyBack")}">${t("historyBackShort")}</button><button id="history-forward" class="text-link" type="button" aria-label="${t("historyForward")}">${t("historyForwardShort")}</button><button id="reading-return" class="secondary-button" type="button"></button><button id="reading-adopt" class="text-link" type="button">${t("continueReadingHere")}</button></div>
          <section id="book-search-panel" class="book-search-panel" aria-label="${t("searchInBook")}" hidden></section>
          <section id="translation-panel" class="book-search-panel translation-panel" aria-label="${t("selectedTextTranslation")}" hidden></section>
          <div id="reading-surface" class="reading-surface" tabindex="-1"><div id="reader-content" class="reader-content"></div></div>
          <div class="reader-bottom"><span>${t("noteHint")}</span><span id="save-status">${t("progressSaved")}</span></div>
        </section>
      </main>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
      <div id="note-menu" class="note-menu" hidden><button id="note-add" type="button">${t("addNote")}</button><button id="selection-translate" type="button">${t("translate")}</button></div>
      <div id="note-dialog" class="note-dialog" hidden>
        <div class="note-card" role="dialog" aria-modal="true" aria-labelledby="note-heading">
          <div class="note-card-head"><h2 id="note-heading">${t("addNote")}</h2><button id="note-close" type="button" class="note-close" aria-label="${t("closeNote")}">×</button></div>
          <p id="note-quote" class="note-quote"></p>
          <fieldset class="note-colors"><legend>${t("markerColor")}</legend><div id="note-color-options" class="note-color-options"></div><label class="custom-color-label" for="note-custom-color">${t("customColor")} <input id="note-custom-color" type="color" value="#326fca" aria-label="${t("customColor")}" /></label></fieldset>
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
const coverCache = new Map<string, { signature: string; url: string }>();
type LibraryLayout = "grid" | "list";
type LibrarySort = "recent" | "title-asc" | "title-desc" | "author" | "progress" | "added";
let libraryLayout: LibraryLayout = localStorage.getItem("autumn-library-layout") === "list" ? "list" : "grid";
let librarySort: LibrarySort = (["recent", "title-asc", "title-desc", "author", "progress", "added"] as const).find(value => value === localStorage.getItem("autumn-library-sort")) ?? "recent";
type LibraryStatusFilter = "all" | "reading" | "finished" | "unread" | "favorites";
let libraryStatusFilter: LibraryStatusFilter = "all";
const cloudState = new Map<string, "syncing" | "error">();

type View = "home" | "library" | "settings" | "reader" | "profile" | "details";
let profilePage: ProfileUI | undefined;
let reviewComposer: ReviewComposer | undefined;
let bookEditor: BookEditor | undefined;
let folderUI: FolderUI | undefined;
let searchUI: SearchUI | undefined;
let translationUI: TranslationUI | undefined;
let selectedTranslationText = "";
const noteHighlights = new Map<string,string>();
const readerHistory = new ReaderHistory();
let pdfPosition = { page: 1, offset: 0 };
let epubPosition = { cfi: "", label: "" };
let readerJumpBusy = false;
let searchHighlight: string | undefined;
let pagePreviewActive = false;
interface PageTurn { snapshot: HTMLElement; live: HTMLElement; preview?: Rendition; previewChanged?: boolean; origin: ReaderPosition; direction: -1|1; dx: number; width: number; sequence: number; ready: Promise<void>; ending: boolean }
let pageTurn: PageTurn | undefined;
const pageTurnAnimationKey = "autumn-page-turn-animation";
let pageTurnAnimationEnabled = localStorage.getItem(pageTurnAnimationKey) !== "off";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const animatePageTurn = (): boolean => pageTurnAnimationEnabled && !reducedMotion.matches;
let pagePreferences = loadPagePreferences();
let view: View = "home";
let lastCollectionView: "home" | "library" | "profile" = "home";
let books: StoredBook[] = [];
let homeCarousel: ReturnType<typeof mountBookCarousel> | undefined;
let currentBook: StoredBook | null = null;
let pdfDocument: PDFDocumentProxy | null = null;
let pdfLoadingTask: PDFDocumentLoadingTask | null = null;
let pdfRenderTask: RenderTask | null = null;
let pdfTextLayer: TextLayer | null = null;
const pdfOutlineDestinations = new Map<string, unknown>();
let pdfSelectionListener: AbortController | null = null;
let epubBook: EpubBook | null = null;
let rendition: Rendition | null = null;
let pdfTextView: PdfTextView | null = null;
let pdfReadingMode: "text" | "original" = "text";
let pdfNavigationBusy = false;
const pdfTextCache = new Map<number, PdfTextBlock[]>();
let loadSequence = 0;
let pdfRenderSequence = 0;
let readerPositionRevision = 0;
let restoringRemotePosition = false;
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

const noteColors = bookColors.map(choice => choice.value);
type NoteAnchor = { format: "pdf"; page: number; y: number } | { format: "epub"; cfi: string };
let pendingNote: { quote: string; anchor: NoteAnchor } | null = null;
let editingNoteId: string | null = null;
let selectedNoteColor: string = noteColors[0];
let touchNoteTimer: number | undefined;
let confirmResolve: ((confirmed: boolean) => void) | null = null;
let confirmPreviousFocus: HTMLElement | null = null;

function titleOf(book: StoredBook): string {
  return book.displayTitle?.trim() || book.name.replace(/\.(pdf|epub)$/i, "");
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
  if (next !== view) reviewComposer?.close();
  const enteringLibrary = next === "library" && view !== "library";
  if (next !== "reader") {
    searchUI?.close(); translationUI?.close();
    hideNoteMenu();
    closeNoteDialog();
    closeAllNotes();
  }
  view = next;
  if (next === "profile") void profilePage?.activate();
  else profilePage?.deactivate();
  $<HTMLElement>(".workspace").dataset.view = next;
  if (next === "home" || next === "library" || next === "profile") lastCollectionView = next;
  for (const section of document.querySelectorAll<HTMLElement>(".view")) section.hidden = section.id !== `view-${next}`;
  $<HTMLButtonElement>("#import-button").hidden = next !== "library";
  if (next === "home") homeCarousel?.update();
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
    profile: [t("profile"), t("profileSubtitle")],
    details: [t("profile"), ""],
  };
  $<HTMLElement>("#page-title").textContent = headings[next][0];
  $<HTMLElement>("#page-subtitle").textContent = headings[next][1];
  if (enteringLibrary) void refreshFolders().catch(() => {});
}

function openLibraryFilter(filter: LibraryStatusFilter): void {
  libraryStatusFilter = filter;
  const select = document.querySelector<HTMLSelectElement>("#library-status-filter");
  if (select) select.value = filter;
  setView("library");
  renderCollections();
}

function applyTheme(): void {
  document.documentElement.dataset.theme = theme;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".theme-choice")) {
    const selected = button.dataset.themeChoice === theme;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  rendition?.themes.default({ body: { color: theme === "light" ? "#342a26" : "#ece4d8", background: theme === "light" ? "#fffdf8" : "#292322" } });
  applyPageSpacing();
}
function applyPageSpacing(): void {
  if (epubBook?.packaging?.metadata?.layout === "pre-paginated") return;
  const contentList: unknown = rendition?.getContents();
  for (const contents of (Array.isArray(contentList) ? contentList : []) as Contents[]) {
    let style = contents.document.getElementById("autumn-spacing");
    if (!style) { style = contents.document.createElement("style"); style.id = "autumn-spacing"; contents.document.head.append(style); }
    style.textContent = pageSpacingCss(pagePreferences);
  }
  rendition?.themes.override("line-height", String(pagePreferences.lineHeight), true);
}

function applyBookFont(): void {
  rendition?.themes.font(bookFontFamilies[bookFont]);
  if (currentBook?.format === "pdf" && pdfTextView && view === "reader") void renderPdfPage();
}

function standardizeEpubPage(contents: Contents): void {
  // EPUB chapters are separate documents; app-level CSS cannot reach their scroll containers.
  if (!contents.document.getElementById("autumn-scrollbars")) {
    const style = contents.document.createElement("style");
    style.id = "autumn-scrollbars";
    style.textContent = "html, body, * { scrollbar-width: none !important; } html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }";
    contents.document.head.append(style);
  }
  if (epubBook?.packaging?.metadata?.layout === "pre-paginated") return;
  const spacingStyle = contents.document.createElement("style"); spacingStyle.id = "autumn-spacing";
  spacingStyle.textContent = pageSpacingCss(pagePreferences); contents.document.head.append(spacingStyle);
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
  const nativePath = book.customCover ? undefined : book.nativeCoverPath;
  if (book.cover || nativePath) {
    const signature = nativePath ?? `${book.cover!.size}:${book.cover!.type}`;
    const cached = coverCache.get(book.id);
    if (cached && cached.signature !== signature) { URL.revokeObjectURL(cached.url); coverCache.delete(book.id); }
    const url = nativePath ? nativeBookUrl(nativePath) : coverCache.get(book.id)?.url ?? URL.createObjectURL(book.cover!);
    if (!nativePath && !coverCache.has(book.id)) coverCache.set(book.id, { signature, url });
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
  if (!book.cover && book.coverPath && navigator.onLine) {
    cover.dataset.coverBookId = book.id;
    coverObserver.observe(cover);
  }
  return cover;
}
const coverLoading = new Set<string>();
const coverObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    coverObserver.unobserve(entry.target);
    const id = (entry.target as HTMLElement).dataset.coverBookId;
    const book = books.find(item => item.id === id);
    if (!book?.coverPath || book.cover || coverLoading.has(book.id)) continue;
    coverLoading.add(book.id);
    const path = book.coverPath;
    void downloadPrivateCover(book).then(async blob => {
      const latest = await bookCache.get(book.id);
      if (!latest || latest.coverPath !== path || auth.state.ownerId !== book.ownerId) return;
      await bookCache.put({ ...latest, cover: blob });
      const visible = books.find(item => item.id === book.id);
      if (visible?.coverPath === path) {
        visible.cover = blob;
        for (const node of document.querySelectorAll<HTMLElement>(".book-cover[data-cover-book-id]"))
          if (node.dataset.coverBookId === visible.id) node.replaceWith(coverElement(visible));
        window.dispatchEvent(new CustomEvent("autumn-cover-loaded", { detail: { bookId: visible.id } }));
      }
    }).catch(() => {}).finally(() => coverLoading.delete(book.id));
  }
});

async function syncOneBook(book: StoredBook): Promise<void> {
  if (cloudState.get(book.id) === "syncing") return;
  cloudState.set(book.id, "syncing"); renderCollections();
  try {
    const result = await migrateLibrary([book], new AbortController().signal, () => {});
    if (result.failed) { cloudState.set(book.id, "error"); showToast(t("cloudSyncFailed")); }
    else cloudState.delete(book.id);
    await reloadCloudLibrary();
  } catch (error: unknown) {
    cloudState.set(book.id, "error"); renderCollections(); showToast(errorMessage(error));
  }
}

function sortedLibraryBooks(items: StoredBook[]): StoredBook[] {
  const compareTitle = (a: StoredBook, b: StoredBook) => titleOf(a).localeCompare(titleOf(b), language, { sensitivity: "base" });
  const recent = (book: StoredBook) => book.lastOpenedAt || book.addedAt;
  return items.sort((a, b) => {
    switch (librarySort) {
      case "title-asc": return compareTitle(a, b);
      case "title-desc": return compareTitle(b, a);
      case "author": return (a.author ?? "").localeCompare(b.author ?? "", language, { sensitivity: "base" }) || compareTitle(a, b);
      case "progress": return (b.percentage ?? 0) - (a.percentage ?? 0) || recent(b) - recent(a);
      case "added": return b.addedAt - a.addedAt;
      default: return recent(b) - recent(a);
    }
  });
}

function createBookCard(book: StoredBook): HTMLElement {
  const card = document.createElement("article");
  card.className = "book-card library-book-card";
  card.dataset.bookId = book.id;
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
  const titleRow = document.createElement("div"); titleRow.className = "library-book-title-row";
  titleRow.append(titleButton);
  const menu = document.createElement("details"); menu.className = "book-menu";
  const trigger = document.createElement("summary"); trigger.textContent = "⋮";
  trigger.setAttribute("aria-label", t("bookMenu", { title: titleOf(book) })); menu.append(trigger);
  const options = document.createElement("div"); options.className = "book-menu-options";
  const action = (label: string, run: () => void): void => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.addEventListener("click", () => { menu.open = false; run(); }); options.append(button);
  };
  action(t("editBook"), () => bookEditor?.open(book));
  if (!book.cloudId && cloudState.get(book.id) !== "syncing") action(t(cloudState.get(book.id) === "error" ? "retrySync" : "syncAction"), () => void syncOneBook(book));
  action(t("reviewAction"), () => void reviewComposer?.openBook(book));
  action(t(book.favorite ? "removeFavoriteAction" : "favoriteAction"), () => void toggleFavorite(book));
  if (book.cloudId) action(t("detailsAction"), () => details.openBook(book.cloudId!));
  action(t("removeLibrary"), () => void removeBook(book));
  menu.append(options); titleRow.append(menu); info.append(titleRow);
  const author = document.createElement("span"); author.className = "library-book-author";
  author.textContent = book.author?.trim() || t("authorUnknown"); info.append(author);
  const badges = document.createElement("div"); badges.className = "library-book-badges";
  const state = book.status ?? (book.lastOpenedAt ? "reading" : "unread");
  const badge = document.createElement("span"); badge.className = `reading-badge status-${state}`;
  badge.textContent = t(state === "finished" ? "statusFinished" : state === "reading" ? "statusReading" : "statusUnread");
  const cloudBadge = document.createElement("span"); cloudBadge.className = `cloud-badge state-${book.cloudId ? "cloud" : cloudState.get(book.id) ?? "local"}`;
  const cloudLabel = book.cloudId ? t("inCloud") : cloudState.get(book.id) === "syncing" ? t("synchronizing") : cloudState.get(book.id) === "error" ? t("syncError") : t("localOnly");
  cloudBadge.innerHTML = book.cloudId ? svg("cloud", 13) : '<span class="cloud-state-dot" aria-hidden="true"></span>';
  cloudBadge.append(document.createTextNode(cloudLabel)); badges.append(badge, cloudBadge); info.append(badges);
  const percent = state === "finished" ? 100 : Math.round(Math.max(0, Math.min(1, book.percentage ?? 0)) * 100);
  const progress = document.createElement("div"); progress.className = "library-book-progress";
  const track = document.createElement("span"); track.className = "library-progress-track";
  const fill = document.createElement("span"); fill.style.width = `${percent}%`; track.append(fill);
  const value = document.createElement("span"); value.textContent = t("progressPercent", { value: percent });
  progress.setAttribute("aria-label", value.textContent); progress.append(track, value); info.append(progress);
  const controls = document.createElement("div"); controls.className = "library-book-controls";
  const status = document.createElement("select"); status.className = "book-status"; status.setAttribute("aria-label", t("statusOfBook", { title: titleOf(book) }));
  status.add(new Option(t("statusUnread"), "unread")); status.add(new Option(t("statusReading"), "reading")); status.add(new Option(t("statusFinished"), "finished")); status.value = book.status ?? "unread";
  status.addEventListener("change", () => {
    const previous = book.status; book.status = status.value as "unread" | "reading" | "finished";
    void saveBook(book).then(() => { books = books.map(existing => existing.id === book.id ? book : existing); renderCollections(); })
      .catch(() => { book.status = previous; status.value = previous ?? "unread"; showToast(t("progressSaveFailed")); });
  });
  controls.append(status);
  if (folderUI) controls.append(folderUI.control(book));
  info.append(controls); card.append(coverButton, info);
  card.addEventListener("click", event => {
    if (!(event.target as Element).closest("button,select,details,input,a")) void openBook(book);
  });
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
  $<HTMLElement>("#nav-book-count").textContent = String(books.length);
  const recent = readingBooks(books);
  const recentList = $<HTMLDivElement>("#recent-list");
  recentList.replaceChildren(...(recent.length ? recent.map((book) => presentationCard(book, coverElement, (item) => void openBook(item), true)) : [emptyState(t("homeReadingEmpty"))]));
  homeCarousel?.update();

  const heroAction = $<HTMLButtonElement>("#hero-action");
  const featured = recent[0];
  $<HTMLElement>("#home-hero").classList.toggle("hero-empty", !featured);
  $<HTMLElement>("#hero-eyebrow").textContent = featured ? t("continueReading") : t("welcome");
  $<HTMLElement>("#hero-title").textContent = featured ? titleOf(featured) : t(books.length ? "homeHeroNoCurrentTitle" : "homeHeroEmptyTitle");
  $<HTMLElement>("#hero-author").textContent = featured ? featured.author?.trim() || t("authorUnknown") : "";
  $<HTMLElement>("#hero-description").textContent = featured ? "" : t(books.length ? "homeHeroNoCurrentDescription" : "homeHeroEmptyDescription");
  const heroProgress = $<HTMLElement>("#hero-progress");
  heroProgress.hidden = !featured;
  if (featured) {
    const value = bookProgress(featured);
    $<HTMLElement>("#hero-progress-fill").style.width = `${value}%`;
    $<HTMLElement>("#hero-progress-value").textContent = `${value}%`;
    heroProgress.setAttribute("aria-valuenow", String(value));
    heroProgress.setAttribute("aria-label", t("progressPercent", { value }));
  }
  const art = $<HTMLElement>("#hero-art");
  art.replaceChildren();
  if (featured) art.append(coverElement(featured));
  else { const leaf = document.createElement("img"); leaf.src = leafUrl; leaf.alt = ""; art.append(leaf); }
  heroAction.querySelector("span")!.textContent = featured ? t("continueReading") : t("exploreLibrary");
  heroAction.onclick = () => featured ? void openBook(featured) : setView("library");

  $<HTMLElement>("#library-count-line").textContent = countText(books.length, "savedBook", "savedBooks");
  $<HTMLElement>("#storage-count").textContent = countText(books.length, "bookInLibrary", "booksInLibrary");
  if (view === "library") setView("library");
  const query = $<HTMLInputElement>("#library-search").value.trim().toLocaleLowerCase();
  const matches = sortedLibraryBooks([...books].filter((book) => {
    const status = book.status ?? (book.lastOpenedAt ? "reading" : "unread");
    const visibleByStatus = libraryStatusFilter === "all" || (libraryStatusFilter === "favorites" ? Boolean(book.favorite) : status === libraryStatusFilter);
    return visibleByStatus && titleOf(book).toLocaleLowerCase().includes(query) && (!folderUI || folderUI.includes(book, query));
  }));
  const folderView = folderUI?.update(books, query, matches.length);
  const libraryList = $<HTMLDivElement>("#library-list");
  libraryList.dataset.layout = libraryLayout;
  libraryList.hidden = !matches.length && !!folderView?.hideEmpty;
  libraryList.replaceChildren(...(matches.length ? matches.map((book) => createBookCard(book)) : [emptyState(folderView?.emptyMessage ?? (books.length ? t("noSearchResults") : t("libraryEmpty")), books.length === 0)]));
}

async function toggleFavorite(book: StoredBook): Promise<void> {
  book.favorite = !book.favorite;
  try {
    await saveBook(book);
    books = books.map(existing => existing.id === book.id ? book : existing);
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
  if (pagePreviewActive) return;
  if (!currentBook) return;
  const position = currentBook.format === "pdf"
    ? t("pageOf", { page: pdfPosition.page, total: pdfDocument?.numPages ?? "…" })
    : rendition?.location?.start ? `${t("section", { number: rendition.location.start.index + 1 })} · ${rendition.location.start.displayed.page}/${rendition.location.start.displayed.total}` : t("book");
  $<HTMLSpanElement>("#position-label").textContent = pdfTextView && pdfTextView.count > 1
    ? `${position} · ${pdfTextView.index + 1}/${pdfTextView.count}` : position;
  $<HTMLButtonElement>("#previous-button").disabled = pdfNavigationBusy || (currentBook.format === "pdf" && pdfPosition.page <= 1 && (!pdfTextView || pdfTextView.index === 0));
  $<HTMLButtonElement>("#next-button").disabled = pdfNavigationBusy || (currentBook.format === "pdf" && pdfPosition.page >= (pdfDocument?.numPages ?? Infinity) && (!pdfTextView || pdfTextView.index === pdfTextView.count - 1));
  $<HTMLButtonElement>("#smaller-button").disabled = pdfNavigationBusy || currentBook.fontSize <= 70;
  $<HTMLButtonElement>("#larger-button").disabled = pdfNavigationBusy || currentBook.fontSize >= 180;
  $<HTMLSpanElement>("#size-label").textContent = t("text");
  $<HTMLSpanElement>("#size-value").textContent = `${currentBook.fontSize}%`;
  $<HTMLElement>(".size-controls").hidden = currentBook.format === "pdf" && !pdfTextView;
  const mode = $<HTMLSelectElement>("#pdf-reading-mode");
  mode.hidden = currentBook.format !== "pdf";
  mode.value = pdfTextView ? "text" : "original";
  mode.options[0].disabled = currentBook.format === "pdf" && pdfTextCache.get(pdfPosition.page)?.length === 0;
  mode.title = mode.options[0].disabled ? t("pdfImagePage") : t("readingMode");
}

async function persistCurrent(): Promise<void> {
  if (!currentBook || restoringRemotePosition || pagePreviewActive || readerJumpBusy) return;
  if (currentBook.format === "pdf" && pdfDocument && !readerHistory.temporary) {
    currentBook.page = pdfPosition.page; currentBook.pdfTextOffset = pdfTextView?.visibleOffset() ?? pdfPosition.offset;
    currentBook.percentage = Math.min(1, Math.max(0, (currentBook.page - 1 + currentBook.pdfTextOffset) / pdfDocument.numPages));
  }
  readerHistory.observe(capturePosition()); updateHistory();
  if (readerHistory.temporary) return;
  if (currentBook.status !== "finished") currentBook.status = "reading";
  try {
    await saveBook(currentBook);
    $<HTMLElement>("#save-status").textContent = t("progressSaved");
  } catch {
    $<HTMLElement>("#save-status").textContent = t("progressSaveFailed");
  }
}

function capturePosition(): ReaderPosition {
  return currentBook?.format === "pdf"
    ? { format: "pdf", page: pdfPosition.page, offset: pdfTextView?.visibleOffset() ?? pdfPosition.offset, scrollTop: readingSurface.scrollTop, scrollLeft: readingSurface.scrollLeft }
    : { format: "epub", ...epubPosition };
}
function epubReadingPercentage(location: Location): number {
  const sections = (epubBook?.spine.last()?.index ?? 0) + 1;
  const approximate = (location.start.index + Math.max(0, location.start.displayed.page - 1) / Math.max(1, location.start.displayed.total)) / Math.max(1, sections);
  return location.atEnd ? 1 : Math.max(0, Math.min(1, epubBook?.locations.length() ? location.start.percentage : approximate));
}
function updateHistory(): void {
  $("#reader-history").hidden = !readerHistory.canBack && !readerHistory.canForward;
  $<HTMLButtonElement>("#history-back").disabled = !readerHistory.canBack || readerJumpBusy;
  $<HTMLButtonElement>("#history-forward").disabled = !readerHistory.canForward || readerJumpBusy;
  const origin = readerHistory.readingOrigin;
  $("#reading-return").hidden = $("#reading-adopt").hidden = !readerHistory.temporary;
  $<HTMLButtonElement>("#reading-return").disabled = $<HTMLButtonElement>("#reading-adopt").disabled = readerJumpBusy;
  $<HTMLSelectElement>("#reader-toc").disabled = readerJumpBusy;
  $("#reading-return").textContent = origin?.format === "pdf" ? t("returnToPage", { page: origin.page }) : `${t("returnToReading")}${origin?.label ? ` · ${origin.label}` : ""}`;
  if (searchUI?.opened) { const toolbar = $(".reader-toolbar"); $("#book-search-panel").style.top = `${toolbar.offsetTop + toolbar.offsetHeight + 8}px`; }
}
function clearSearchHighlight(): void {
  if (searchHighlight) {rendition?.annotations.remove(searchHighlight, "highlight");noteHighlights.delete(searchHighlight);}
  searchHighlight = undefined; readerContent.querySelectorAll(".search-match").forEach(element => element.remove());
}
/** EPUB.js resolves display before its animation-frame relocation notification.
 * Keep temporary navigation protected until the displayed location is reported. */
async function displayEpub(target: string): Promise<void> {
  const active = rendition;
  if (!active) return;
  await active.display(target);
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error(t("positionNotConfirmed"))), 3000);
    const finish = (error?: unknown): void => { window.clearTimeout(timeout); active.off("relocated", located); error ? reject(error) : resolve(); };
    const located = (): void => finish();
    active.on("relocated", located);
    void active.reportLocation().catch(finish);
  });
}
async function displayPosition(position: ReaderPosition): Promise<void> {
  if (!currentBook) return;
  ++readerPositionRevision; restoringRemotePosition = false; hideNoteMenu(); clearSearchHighlight();
  readerJumpBusy = true; updateHistory();
  try {
    if (position.format === "pdf" && currentBook.format === "pdf") {
      pdfPosition = { page: position.page, offset: position.offset }; await renderPdfPage();
      readingSurface.scrollTop = position.scrollTop; readingSurface.scrollLeft = position.scrollLeft;
    } else if (position.format === "epub" && rendition) await displayEpub(position.cfi);
    readerHistory.observe(capturePosition()); updatePosition(); renderNoteMarkers();
  } finally { readerJumpBusy = false; updateHistory(); }
}
async function jumpToSearch(result: SearchResult, source: BookSearch,signal?:AbortSignal): Promise<void> {
  const sequence = loadSequence, position = await source.position(result,signal);
  if (sequence !== loadSequence || !currentBook || signal?.aborted) return;
  readerHistory.jump(capturePosition(), position); await displayPosition(position);
  if (position.format === "epub" && rendition) {
    searchHighlight = position.cfi;
    rendition.annotations.highlight(position.cfi, {}, undefined, "autumn-search-match", { fill: "#f5b83d", "fill-opacity": ".4", "mix-blend-mode": "multiply" });
  } else if (position.format === "pdf") {
    if (pdfTextView) {
      pdfTextView.show(pdfTextView.pageForOffset(result.y ?? 0, result.quote)); pdfPosition.offset = pdfTextView.visibleOffset();
      const rect = pdfTextView.markerRect(result.y ?? 0, result.quote), bounds = readerContent.getBoundingClientRect();
      if (rect) { const mark = document.createElement("span"); mark.className = "search-match"; mark.style.cssText = `left:${rect.left-bounds.left}px;top:${rect.top-bounds.top}px;width:${rect.width}px;height:${rect.height}px`; readerContent.append(mark); }
    } else {
      const sheet = readerContent.querySelector<HTMLElement>(".pdf-sheet");
      if (sheet) {
        const mark = document.createElement("span"); mark.className = "search-match pdf-search-line";
        mark.style.top = `${(result.y ?? 0) * sheet.clientHeight}px`; sheet.append(mark);
        readingSurface.scrollTop = Math.max(0, sheet.offsetTop + (result.y ?? 0) * sheet.clientHeight - readingSurface.clientHeight / 3);
      }
    }
    readerHistory.observe(capturePosition()); renderNoteMarkers(); updatePosition(); updateHistory();
  }
}
async function jumpToContents(href: string): Promise<void> {
  if (!rendition || !href || readerJumpBusy) return;
  const from = capturePosition(); readerHistory.jump(from, from); readerJumpBusy = true; updateHistory();
  try { ++readerPositionRevision; restoringRemotePosition = false; await displayEpub(href); readerHistory.observe(capturePosition()); }
  finally { readerJumpBusy = false; updateHistory(); }
}
async function jumpToPdfReference(destination: unknown): Promise<void> {
  if (!pdfDocument || readerJumpBusy) return;
  const sequence = loadSequence, target = await pdfDestination(pdfDocument, destination);
  if (sequence !== loadSequence) return;
  const position: ReaderPosition = { format: "pdf", page: target.page, offset: 0, scrollTop: 0, scrollLeft: 0 };
  readerHistory.jump(capturePosition(), position); await displayPosition(position);
  if (target.sourceY !== undefined) {
    if (pdfTextView) { pdfTextView.show(pdfTextView.pageForSourceY(target.sourceY)); pdfPosition.offset = pdfTextView.visibleOffset(); }
    else { const sheet = readerContent.querySelector<HTMLElement>(".pdf-sheet"); if (sheet) readingSurface.scrollTop = Math.max(0, sheet.offsetTop + target.sourceY * sheet.clientHeight - readingSurface.clientHeight / 3); }
    readerHistory.observe(capturePosition()); renderNoteMarkers(); updatePosition(); updateHistory();
  }
}
function hideNoteMenu(): void {
  window.clearTimeout(touchNoteTimer);
  $<HTMLDivElement>("#note-menu").hidden = true;
}

function showNoteMenu(quote: string, anchor: NoteAnchor, x: number, y: number): void {
  selectedTranslationText = quote;
  pendingNote = { quote: quote.slice(0, 500), anchor };
  const menu = $<HTMLDivElement>("#note-menu");
  menu.hidden = false;
  menu.style.left = `${Math.max(8,Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8,Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
}

function scheduleTouchNote(selection: () => { quote: string; anchor: NoteAnchor; x: number; y: number } | null): void {
  if (!navigator.maxTouchPoints && !window.matchMedia("(pointer: coarse)").matches) return;
  window.clearTimeout(touchNoteTimer);
  touchNoteTimer = window.setTimeout(() => {
    if (view !== "reader" || !$<HTMLDivElement>("#note-dialog").hidden || searchUI?.opened || translationUI?.opened) return;
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
    button.setAttribute("aria-label", t("chooseColor", { color: colorName(color, language) }));
    button.setAttribute("aria-pressed", String(color === selectedNoteColor));
    button.addEventListener("click", () => {
      selectedNoteColor = color;
      $<HTMLInputElement>("#note-custom-color").value = color;
      renderNoteColors();
    });
    return button;
  }));
  $<HTMLInputElement>("#note-custom-color").closest(".custom-color-label")?.classList.toggle("selected", !bookColors.some(choice => choice.value === selectedNoteColor));
}

function openNoteDialog(note?: BookNote): void {
  if (!note && !pendingNote) return;
  hideNoteMenu();
  editingNoteId = note?.id ?? null;
  selectedNoteColor = hexColor(note?.color) ?? noteColors[0];
  $<HTMLInputElement>("#note-custom-color").value = selectedNoteColor;
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
  ++readerPositionRevision; restoringRemotePosition = false;
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
  ++readerPositionRevision; restoringRemotePosition = false;
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

function epubNoteOnVisiblePage(note: BookNote): boolean {
  if (note.format !== "epub" || !rendition?.location) return false;
  const { start, end, atEnd } = rendition.location;
  if (!start?.cfi || !end?.cfi) return false;
  try {
    const compare = rendition.epubcfi.compare.bind(rendition.epubcfi);
    const endComparison = compare(note.cfi, end.cfi);
    return compare(note.cfi, start.cfi) >= 0 && (endComparison < 0 || (atEnd && endComparison === 0));
  } catch { return false; }
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
  ++readerPositionRevision; restoringRemotePosition = false;
  if (!currentBook || readerJumpBusy) return;
  closeAllNotes();
  const from = capturePosition();
  readerHistory.jump(from, note.format === "pdf" ? { format: "pdf", page: note.page, offset: 0, scrollTop: 0, scrollLeft: 0 } : { format: "epub", cfi: note.cfi, label: t("noteLocationLabel") });
  readerJumpBusy = true; updateHistory();
  try {
    if (note.format === "pdf" && currentBook.format === "pdf" && pdfDocument) {
      pdfPosition.page = note.page;
      pdfPosition.offset = 0;
      readingSurface.scrollLeft = 0;
      await renderPdfPage();
      if (pdfTextView) {
        pdfTextView.show(pdfTextView.pageForOffset(note.y, note.quote));
        pdfPosition.offset = pdfTextView.visibleOffset();
        renderNoteMarkers();
        updatePosition();
      }
      const sheet = readerContent.querySelector<HTMLElement>(".pdf-sheet");
      if (sheet && !pdfTextView) {
        const y = sheet.getBoundingClientRect().top - readingSurface.getBoundingClientRect().top
          + readingSurface.scrollTop + Math.max(0, Math.min(1, note.y)) * sheet.clientHeight;
        readingSurface.scrollTop = Math.max(0, y - readingSurface.clientHeight / 3);
      }
      readerHistory.observe(capturePosition()); updateHistory();
    } else if (note.format === "epub" && currentBook.format === "epub" && rendition) {
      await displayEpub(note.cfi);
      updatePosition();
      window.requestAnimationFrame(renderNoteMarkers);
    } else return;
    readingSurface.focus({ preventScroll: true });
  } catch (error) {
    console.error(error);
    showToast(t("noteJumpFailed"));
  } finally { readerJumpBusy = false; updateHistory(); }
}

function renderNoteMarkers(): void {
  readerContent.querySelectorAll(".note-highlight").forEach(e=>e.remove());
  if (rendition) {
    const active = new Map((currentBook?.notes??[]).filter((n):n is BookNote & {format:"epub";cfi:string}=>n.format==="epub").map(n=>[n.cfi,n.color]));
    for(const [cfi,color]of noteHighlights) if(active.get(cfi)!==color){rendition.annotations.remove(cfi,"highlight");noteHighlights.delete(cfi);}
    for(const [cfi,color]of active)if(!noteHighlights.has(cfi)){rendition.annotations.highlight(cfi,{},undefined,"autumn-note-highlight",{fill:color,"fill-opacity":".22"});noteHighlights.set(cfi,color);}
  }
  readerContent.querySelectorAll(".note-marker").forEach((marker) => marker.remove());
  if (!currentBook || !currentBook.notes?.length || view !== "reader") return;
  const contentRect = readerContent.getBoundingClientRect();
  const placements: { note: BookNote; x: number; y: number }[] = [];
  for (const note of currentBook.notes) {
    if (note.format === "pdf") {
      if (currentBook.format !== "pdf" || note.page !== pdfPosition.page) continue;
      const sheet = readerContent.querySelector<HTMLElement>(".pdf-sheet");
      if (!sheet) continue;
      const rect = sheet.getBoundingClientRect();
      const textRect = pdfTextView?.markerRect(note.y, note.quote);
      const originalLayer=sheet.querySelector<HTMLElement>(".pdf-text-layer");
      for(const highlightRect of pdfTextView ? pdfTextView.highlightRects(note.y,note.quote) : originalLayer ? quoteRects(originalLayer,note.quote,note.y) : []) {
        const highlight=document.createElement("span");highlight.className="note-highlight";highlight.style.left=`${highlightRect.left-contentRect.left}px`;highlight.style.top=`${highlightRect.top-contentRect.top}px`;highlight.style.width=`${highlightRect.width}px`;highlight.style.height=`${highlightRect.height}px`;highlight.style.backgroundColor=`${hexColor(note.color) ?? noteColors[0]}38`;readerContent.append(highlight);
      }
      if (pdfTextView && !textRect) continue;
      placements.push({ note, x: rect.right - contentRect.left + 8,
        y: textRect ? textRect.top - contentRect.top : rect.top - contentRect.top + note.y * rect.height });
    } else if (currentBook.format === "epub" && rendition) {
      try {
        if (!epubNoteOnVisiblePage(note)) continue;
        const range = rendition.getRange(note.cfi);
        if (!range) continue;
        const frame = range.startContainer.ownerDocument?.defaultView?.frameElement as HTMLElement | null;
        if (!frame) continue;
        const frameRect = frame.getBoundingClientRect();
        const paper = readerContent.querySelector<HTMLElement>(".epub-frame");
        if (!paper) continue;
        const visibleRect = Array.from(range.getClientRects()).find((rect) => rect.width > 0 && rect.height > 0
          && rect.left < frameRect.width && rect.right > 0 && rect.top < frameRect.height && rect.bottom > 0);
        if (!visibleRect) continue;
        placements.push({ note, x: paper.getBoundingClientRect().right - contentRect.left + 8,
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
    const y = Math.max(8, placement.y - 10, lastY + (navigator.maxTouchPoints ? 36 : 24));
    marker.style.top = `${y}px`;
    lastY = y;
    marker.title = t("openNote");
    marker.setAttribute("aria-label", t("openNoteQuote", { quote: placement.note.quote }));
    marker.addEventListener("click", () => openNoteDialog(placement.note));
    readerContent.append(marker);
    marker.style.left = `${Math.max(0, Math.min(placement.x, readerContent.clientWidth - marker.offsetWidth - 8))}px`;
  }
}

async function clearReader(): Promise<void> {
  translationUI?.close(); selectedTranslationText=""; noteHighlights.clear();
  pageTurn?.snapshot.remove(); pageTurn?.preview?.destroy(); if(pageTurn?.live !== readerContent)pageTurn?.live.remove(); pageTurn = undefined; pagePreviewActive = false; resetPageTransform();
  searchUI?.close(); searchUI?.setSource(); readerHistory.commit(); updateHistory();
  searchHighlight = undefined; $("#reader-toc").hidden = true; pdfOutlineDestinations.clear();
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
  pdfTextView = null;
  pdfTextCache.clear();
  rendition?.destroy();
  rendition = null;
  epubBook?.destroy();
  epubBook = null;
  readerContent.replaceChildren();
  readerContent.classList.remove("pdf-content", "pdf-reflow-content");
}

async function renderPdfPage(): Promise<void> {
  if (!pdfDocument || !currentBook || currentBook.format !== "pdf") return;
  const sequence = ++pdfRenderSequence;
  pdfSelectionListener?.abort();
  pdfSelectionListener = null;
  pdfRenderTask?.cancel();
  pdfTextLayer?.cancel();
  pdfTextLayer = null;
  pdfPosition.page = Math.max(1, Math.min(pdfPosition.page, pdfDocument.numPages));
  const page = await pdfDocument.getPage(pdfPosition.page);
  if (sequence !== pdfRenderSequence) return;
  const natural = page.getViewport({ scale: 1 });
  let blocks = pdfTextCache.get(pdfPosition.page);
  if (!blocks) {
    blocks = pdfTextBlocks(await page.getTextContent(), natural);
    if (sequence !== pdfRenderSequence) return;
    pdfTextCache.set(pdfPosition.page, blocks);
    // Keep extraction bounded even when reading a long book.
    if (pdfTextCache.size > 6) pdfTextCache.delete(pdfTextCache.keys().next().value!);
  }
  pdfTextView = null;
  readerContent.classList.toggle("pdf-reflow-content", pdfReadingMode === "text" && blocks.length > 0);
  const contentStyle = getComputedStyle(readerContent);
  const horizontalPadding = parseFloat(contentStyle.paddingLeft) + parseFloat(contentStyle.paddingRight);
  const verticalPadding = parseFloat(contentStyle.paddingTop) + parseFloat(contentStyle.paddingBottom);
  const availableWidth = Math.max(120, readingSurface.clientWidth - horizontalPadding);
  const availableHeight = Math.max(120, readingSurface.clientHeight - verticalPadding);
  if (pdfReadingMode === "text" && blocks.length) {
    const sheet = document.createElement("div");
    sheet.className = "pdf-sheet pdf-reading-sheet";
    sheet.style.width = `${Math.min(820, availableWidth)}px`;
    sheet.style.height = `${availableHeight}px`;
    readerContent.classList.add("pdf-content");
    readerContent.replaceChildren(sheet);
    pdfTextView = new PdfTextView(sheet, blocks, 18 * currentBook.fontSize / 100, bookFontFamilies[bookFont], pagePreferences);
    pdfTextView.show(pdfPosition.offset === 1 ? pdfTextView.count - 1 : pdfTextView.pageForOffset(pdfPosition.offset ?? 0));
    readingSurface.scrollTop = 0;
    readingSurface.scrollLeft = 0;
    bindPdfSelection(pdfTextView.flow, sheet);
    renderNoteMarkers();
    updatePosition();
    return;
  }
  const fitScale = Math.min(availableWidth / natural.width, availableHeight / natural.height);
  const viewport = page.getViewport({ scale: fitScale });
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
  readingSurface.scrollLeft = 0;
  readingSurface.scrollTop = 0;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("viewerFailed"));
  const task = page.render({ canvasContext: context, canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
  pdfRenderTask = task;
  try { await task.promise; }
  catch (error) { if (!(error instanceof Error && error.name === "RenderingCancelledException")) throw error; }
  finally { if (pdfRenderTask === task) pdfRenderTask = null; }
  if (sequence !== pdfRenderSequence) return;
  const { TextLayer } = await loadPdfEngine();
  const textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: textLayerElement, viewport });
  pdfTextLayer = textLayer;
  try { await textLayer.render(); }
  catch (error) { if (sequence === pdfRenderSequence) console.info(t("noSelectableText"), error); }
  if (sequence !== pdfRenderSequence) return;
  bindPdfSelection(textLayerElement, sheet);
  for (const link of await pdfPageLinks(page)) {
    if (sequence !== pdfRenderSequence) return;
    const rect = [...viewport.convertToViewportPoint(link.rect[0],link.rect[1]),...viewport.convertToViewportPoint(link.rect[2],link.rect[3])], left = Math.min(rect[0], rect[2]), top = Math.min(rect[1], rect[3]);
    const button = document.createElement("button"); button.type = "button"; button.className = "pdf-internal-link"; button.setAttribute("aria-label", t("openPdfReference"));
    button.style.cssText = `left:${left}px;top:${top}px;width:${Math.abs(rect[2] - rect[0])}px;height:${Math.abs(rect[3] - rect[1])}px`;
    button.addEventListener("click", () => void jumpToPdfReference(link.destination).catch(error => showToast(errorMessage(error)))); sheet.append(button);
  }
  renderNoteMarkers();
  updatePosition();
}

function bindPdfSelection(textLayerElement: HTMLElement, sheet: HTMLElement): void {
  const selectedText = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!textLayerElement.contains(range.startContainer) || !textLayerElement.contains(range.endContainer)) return null;
    const quote = selection.toString().trim();
    if (!quote || !currentBook || currentBook.format !== "pdf") return null;
    const rect = range.getBoundingClientRect();
    const pageRect = sheet.getBoundingClientRect();
    const y = pdfTextView ? pdfTextView.selectionY(range) : Math.max(0, Math.min(1, (rect.top - pageRect.top) / pageRect.height));
    return { quote, anchor: { format: "pdf" as const, page: pdfPosition.page, y }, x: rect.left, y: rect.bottom + 8 };
  };
  textLayerElement.addEventListener("contextmenu", (event) => {
    const note = selectedText();
    if (!note) return;
    event.preventDefault();
    showNoteMenu(note.quote, note.anchor, event.clientX, event.clientY);
  });
  pdfSelectionListener = new AbortController();
  document.addEventListener("selectionchange", () => scheduleTouchNote(selectedText), { signal: pdfSelectionListener.signal });
}

async function openBook(book: StoredBook): Promise<void> {
  const sequence = ++loadSequence;
  const positionRevision = ++readerPositionRevision;
  const baselinePosition = { page: book.page, cfi: book.cfi, percentage: book.percentage, pdfTextOffset: book.pdfTextOffset, fontSize: book.fontSize };
  await clearReader();
  if (sequence !== loadSequence) return;
  currentBook = book;
  pdfPosition = { page: book.page, offset: book.pdfTextOffset ?? 0 };
  epubPosition = { cfi: book.cfi ?? "", label: "" };
  const cached = hasLocalFile(book);
  const needsRemote = Boolean(book.cloudId && navigator.onLine && auth.state.status === "authenticated");
  restoringRemotePosition = cached && needsRemote;
  // Cached files open immediately. Refresh the position concurrently, without queuing stale startup positions.
  const remotePosition = needsRemote ? sync.flush().then(() => library.refreshBook(book)).catch((error: unknown) => { if (sequence === loadSequence) showToast(errorMessage(error)); return undefined; }) : undefined;
  book.lastOpenedAt = Date.now();
  pdfReadingMode = localStorage.getItem(`autumn-pdf-mode-${book.id}`) === "original" ? "original" : "text";
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
    if (book.ownerId && auth.state.ownerId !== book.ownerId) throw new Error(t("errorForbidden"));
    if (!cached && remotePosition) {
      const remote = await remotePosition;
      if (remote) Object.assign(book, remote);
      pdfPosition = { page: book.page, offset: book.pdfTextOffset ?? 0 };
      if (book.deletedAt) throw new Error(t("bookRemoved"));
    }
    const buffer = await readBookData(book);
    if (sequence !== loadSequence) return;
    book.lastOpenedAt = Date.now();
    if (book.format === "pdf") {
      const { getDocument } = await loadPdfEngine();
      const task = getDocument({ data: new Uint8Array(buffer) });
      pdfLoadingTask = task;
      pdfDocument = await task.promise;
      if (sequence !== loadSequence) return;
      await renderPdfPage();
      searchUI?.setSource(pdfSearch(pdfDocument));
      const outline = await pdfDocument.getOutline(), toc = $<HTMLSelectElement>("#reader-toc"); toc.replaceChildren(new Option("Tabla de contenidos", ""));
      const addOutline = (items: NonNullable<typeof outline>, depth = 0): void => {
        if (depth > 8) return;
        for (const item of items) {
          if (pdfOutlineDestinations.size >= 1000) return;
          if (item.dest) { const id = `pdf:${pdfOutlineDestinations.size}`; pdfOutlineDestinations.set(id, item.dest); toc.add(new Option(`${"– ".repeat(depth)}${item.title}`, id)); }
          if (item.items) addOutline(item.items, depth + 1);
        }
      };
      addOutline(outline ?? []); toc.hidden = toc.options.length <= 1;
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
        contents.document.addEventListener("keydown", handleReaderKeydown);
        contents.document.addEventListener("click", event => {
          const link = (event.target as Element | null)?.closest("a[href]");
          const href = link?.getAttribute("href");
          if (href && !/^(?:[a-z]+:|\/\/)/i.test(href)) { const from = capturePosition(); readerHistory.jump(from, from); updateHistory(); }
        }, { capture: true });
      });
      rendition.themes.fontSize(`${book.fontSize}%`);
      applyTheme();
      applyBookFont();
      rendition.on("relocated", (location: Location) => {
        if (currentBook?.id !== book.id) return;
        epubPosition = { cfi: location.start.cfi, label: t("sectionPage", { section: location.start.index + 1, page: location.start.displayed.page }) };
        if (!readerHistory.temporary && !pagePreviewActive && !readerJumpBusy) book.cfi = location.start.cfi;
        if (!readerHistory.temporary && !pagePreviewActive && !readerJumpBusy) book.percentage = epubReadingPercentage(location);
        if (!pagePreviewActive && !readerJumpBusy) readerHistory.observe(capturePosition()); updateHistory();
        updatePosition();
        void persistCurrent();
        window.requestAnimationFrame(renderNoteMarkers);
      });
      await rendition.display(book.cfi || undefined);
      searchUI?.setSource(epubSearch(epubBook));
      const navigation = await epubBook.loaded.navigation;
      const toc = $<HTMLSelectElement>("#reader-toc"); toc.replaceChildren(new Option("Tabla de contenidos", ""));
      const addToc = (entries: typeof navigation.toc): void => { for (const entry of entries) { toc.add(new Option(entry.label.trim(), entry.href)); if (entry.subitems) addToc(entry.subitems); } };
      addToc(navigation.toc); toc.hidden = toc.options.length <= 1;
      window.requestAnimationFrame(renderNoteMarkers);
    }
    await persistCurrent();
    updatePosition();
    if (book.cloudId && !book.cover && !book.nativeCoverPath) void makeCover(book);
    if (cached && remotePosition) void remotePosition.then(async (remote) => {
      if (sequence !== loadSequence || currentBook !== book) return;
      restoringRemotePosition = false;
      if (readerPositionRevision !== positionRevision) return;
      if (remote?.deletedAt) { ++loadSequence; await clearReader(); currentBook = null; setView("library"); await reloadCloudLibrary(); return; }
      const openedAt = book.lastOpenedAt;
      if (remote) {
        Object.assign(book, remote); book.lastOpenedAt = openedAt;
        pdfPosition = { page: book.page, offset: book.pdfTextOffset ?? 0 }; readerHistory.commit();
        if (book.format === "pdf") await renderPdfPage();
        else if (rendition && book.cfi) await rendition.display(book.cfi);
      } else Object.assign(book, baselinePosition);
      await persistCurrent(); updateNotesCount(); renderNoteMarkers(); updatePosition();
    }).catch((error: unknown) => { restoringRemotePosition = false; showToast(errorMessage(error)); });
  } catch (error) {
    if (sequence !== loadSequence) return;
    console.error(error);
    readerContent.replaceChildren();
    const displayError = document.createElement("div");
    displayError.className = "reader-message";
    displayError.textContent = t("bookOpenFailedHelp");
    readerContent.append(displayError);
    showToast(errorMessage(error));
  }
}

async function makeCover(book: StoredBook): Promise<void> {
  if (book.customCover) return;
  try {
    const buffer = await readBookData(book);
    let cover: Blob | null = null;
    if (book.format === "pdf") {
      const { getDocument } = await loadPdfEngine();
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
    if (cover && !book.customCover && (!book.ownerId || book.ownerId === auth.state.ownerId) && books.some((item) => item.id === book.id)) {
      book.cover = await optimizeCover(cover);
      if (book.cover) await cacheBookCover(book.id, book.cover);
      renderCollections();
    }
  } catch (error) {
    console.info(t("simpleCover"), error);
  }
}

async function importFiles(files: FileList): Promise<void> {
  let first: StoredBook | null = null;
  const selection = platformFilePicker.selected(files);
  let rejected = selection.rejected;
  for (const file of selection.accepted) {
    const book: StoredBook = {
      id: newId(), name: file.name, format: file.format, data: file.blob,
      addedAt: Date.now(), lastOpenedAt: 0, favorite: false,
      ownerId: auth.state.ownerId ?? undefined,
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

async function navigate(direction: -1 | 1, preview = false): Promise<void> {
  if (!currentBook || view !== "reader" || readerJumpBusy || (pageTurn && !preview)) return;
  clearSearchHighlight();
  ++readerPositionRevision; restoringRemotePosition = false;
  if (currentBook.format === "pdf" && pdfDocument) {
    if (pdfNavigationBusy) return;
    pdfNavigationBusy = true;
    updatePosition();
    try {
      if (pdfTextView && pdfTextView.index + direction >= 0 && pdfTextView.index + direction < pdfTextView.count) {
        pdfTextView.show(pdfTextView.index + direction);
        pdfPosition.offset = pdfTextView.visibleOffset();
        hideNoteMenu();
        window.getSelection()?.removeAllRanges();
        renderNoteMarkers();
        updatePosition();
        await persistCurrent();
        return;
      }
      const next = pdfPosition.page + direction;
      if (next < 1 || next > pdfDocument.numPages) return;
      pdfPosition.page = next;
      pdfPosition.offset = direction < 0 ? 1 : 0;
      pdfTextView = null;
      updatePosition();
      readingSurface.scrollTop = 0;
      readingSurface.scrollLeft = 0;
      await renderPdfPage();
      await persistCurrent();
    } finally {
      pdfNavigationBusy = false;
      updatePosition();
    }
  } else if (rendition) {
    await (direction < 0 ? rendition.prev() : rendition.next());
  }
}

function resetPageTransform(): void {
  readerContent.getAnimations().forEach(animation => animation.cancel());
  readerContent.style.transform = ""; readerContent.style.visibility = ""; readerContent.style.willChange = "";
  readerContent.classList.remove("page-turn-sheet"); delete readerContent.dataset.turnDirection;
  readingSurface.classList.remove("page-turning");
}
function beginPageTurn(direction: -1|1): void {
  if (pageTurn || !currentBook) return;
  const snapshot = epubBook ? document.createElement("div") : pageSnapshot(readerContent, readingSurface);
  if (epubBook) { snapshot.className="page-turn-snapshot"; snapshot.style.visibility="hidden"; snapshot.setAttribute("aria-hidden","true"); readingSurface.append(snapshot); }
  const sheet = epubBook ? readerContent : snapshot;
  sheet.classList.add("page-turn-sheet"); sheet.dataset.turnDirection=String(direction);
  const turn: PageTurn = { snapshot, live: readerContent, origin: capturePosition(), direction, dx: 0, width: readingSurface.clientWidth, sequence: loadSequence, ready: Promise.resolve(), ending: false };
  pageTurn = turn; pagePreviewActive = true;
  $<HTMLButtonElement>("#previous-button").disabled = true;
  $<HTMLButtonElement>("#next-button").disabled = true;
  readingSurface.classList.add("page-turning"); readerContent.style.willChange = "transform";
  if (epubBook && rendition && turn.origin.format === "epub") {
    // Keep the touched iframe mounted across chapter boundaries. This temporary
    // rendition shares the opened book/archive, rather than loading another file.
    const adjacent = readerContent.cloneNode(false) as HTMLElement; adjacent.removeAttribute("id"); adjacent.setAttribute("aria-hidden","true"); adjacent.classList.remove("page-turn-sheet"); delete adjacent.dataset.turnDirection;
    adjacent.classList.add("page-turn-preview"); const rect = readerContent.getBoundingClientRect(), bounds = readingSurface.getBoundingClientRect();
    adjacent.style.cssText = `position:absolute;left:${rect.left-bounds.left}px;top:${rect.top-bounds.top}px;width:${rect.width}px;height:${rect.height}px;min-height:0;z-index:4;pointer-events:none;will-change:transform`;
    const frame = document.createElement("div"); frame.className="epub-frame"; adjacent.append(frame); readingSurface.append(adjacent); turn.live=adjacent;
    const preview = epubBook.renderTo(frame,{width:"100%",height:"100%",flow:"paginated",spread:"none"}); epubBook.rendition=rendition; turn.preview=preview;
    preview.hooks.content.register((contents: Contents)=>standardizeEpubPage(contents));
    preview.themes.fontSize(`${currentBook.fontSize}%`); preview.themes.font(bookFontFamilies[bookFont]);
    preview.themes.default({body:{color:theme==="light"?"#342a26":"#ece4d8",background:theme==="light"?"#fffdf8":"#292322"}});
    adjacent.style.visibility="hidden";adjacent.style.transform=`translate3d(${direction*turn.width}px,0,0)`;
    turn.ready=(async()=>{await preview.display((turn.origin as Extract<ReaderPosition,{format:"epub"}>).cfi);const before=await preview.currentLocation() as unknown as Location;await(direction<0?preview.prev():preview.next());const after=await preview.currentLocation() as unknown as Location;turn.previewChanged=before?.start.cfi!==after?.start.cfi;})();
  } else {
    readerContent.style.visibility = "hidden"; readerContent.style.transform = `translate3d(${direction * turn.width}px,0,0)`;
    turn.ready = navigate(direction, true);
  }
  turn.ready = turn.ready.then(() => {
    if (pageTurn !== turn) return;
    readerContent.style.visibility = "";
    turn.live.style.visibility="";turn.live.dataset.ready="true";
    dragPageTurn(turn.dx);
  }).catch(error => { showToast(errorMessage(error)); });
}
function dragPageTurn(dx: number): void {
  const turn = pageTurn; if (!turn || turn.ending) return;
  turn.dx = Math.max(-turn.width, Math.min(turn.width, turn.direction === 1 ? Math.min(0, dx) : Math.max(0, dx)));
  turn.snapshot.style.transform = turn.preview ? `translate3d(${turn.dx}px,0,0)` : pageTurnSheetTransform(turn.dx,turn.width,turn.direction);
  turn.live.style.transform = `translate3d(${turn.direction * turn.width + turn.dx}px,0,0)`;
  if (turn.preview) readerContent.style.transform = pageTurnSheetTransform(turn.dx,turn.width,turn.direction);
}
async function endPageTurn(commit: boolean, direction: -1|1): Promise<void> {
  const turn = pageTurn; if (!turn || turn.ending) return; turn.ending = true;
  await turn.ready; if (pageTurn !== turn || turn.sequence !== loadSequence) return;
  const position = capturePosition();
  const changed = position.format === "pdf" && turn.origin.format === "pdf" ? position.page !== turn.origin.page || Math.abs(position.offset-turn.origin.offset) > .0001 : position.format === "epub" && turn.origin.format === "epub" && position.cfi !== turn.origin.cfi;
  commit &&= direction === turn.direction && (turn.preview ? Boolean(turn.previewChanged) : changed);
  const duration = animatePageTurn() ? 360 : 0;
  try {
    await Promise.all([slide(turn.snapshot, commit ? -turn.direction * turn.width : 0, duration,turn.preview?undefined:{width:turn.width,direction:turn.direction}), slide(turn.live, commit ? 0 : turn.direction * turn.width, duration), ...(turn.preview ? [slide(readerContent,commit ? -turn.direction * turn.width : 0,duration,{width:turn.width,direction:turn.direction})] : [])]);
    if (pageTurn !== turn) return;
    if (turn.preview && commit) { readerContent.style.transform=""; await navigate(turn.direction,true); }
    else if (!commit && !turn.preview) {
      readerContent.style.visibility = "hidden";
      if (turn.origin.format === "pdf") { pdfPosition = { page: turn.origin.page, offset: turn.origin.offset }; await renderPdfPage(); readingSurface.scrollTop = turn.origin.scrollTop; readingSurface.scrollLeft = turn.origin.scrollLeft; }
      else if (rendition) await rendition.display(turn.origin.cfi);
    }
  } finally {
    if (pageTurn === turn) {
      turn.snapshot.remove(); turn.preview?.destroy(); if(turn.live!==readerContent)turn.live.remove(); pageTurn = undefined; pagePreviewActive = false; resetPageTransform();
      if (commit) {
        if (currentBook?.format === "epub" && !readerHistory.temporary) {
          currentBook.cfi = epubPosition.cfi;
          const location = rendition?.location;
          if (location) currentBook.percentage = epubReadingPercentage(location);
        }
        await persistCurrent();
      }
      updatePosition(); renderNoteMarkers();
    }
  }
}
async function turnPage(direction: -1|1): Promise<void> {
  if (!animatePageTurn()) { await navigate(direction); return; }
  if (!currentBook || view!=="reader" || pageTurn || readerJumpBusy || pdfNavigationBusy) return;
  beginPageTurn(direction);
  if (pageTurn) await endPageTurn(true,direction);
}
function addTapNavigation(target: Document | HTMLElement, getSelection: () => Selection | null): void {
  bindPageGestures(target, getSelection, {
    blocked: () => view !== "reader" || !currentBook || readerJumpBusy || pdfNavigationBusy || Boolean(pageTurn) || !$("#note-dialog").hidden || !$("#all-notes-dialog").hidden || !$("#note-menu").hidden || Boolean(searchUI?.opened) || Boolean(translationUI?.opened),
    start: direction => { if (animatePageTurn()) beginPageTurn(direction); },
    drag: dx => { if (pageTurn) dragPageTurn(dx); },
    end: (commit, direction) => { if (pageTurn) void endPageTurn(commit,direction); else if (commit) void navigate(direction); },
    tap: direction => void turnPage(direction),
  });
}

addTapNavigation(readingSurface, () => window.getSelection());

function changeSize(direction: -1 | 1): void {
  if (!currentBook) return;
  ++readerPositionRevision; restoringRemotePosition = false;
  currentBook.fontSize = Math.max(70, Math.min(180, currentBook.fontSize + direction * 10));
  if (currentBook.format === "pdf") {
    if (!pdfTextView) return;
    pdfPosition.offset = pdfTextView.visibleOffset();
    void renderPdfPage().then(persistCurrent);
  } else if (rendition) {
    rendition.themes.fontSize(`${currentBook.fontSize}%`);
    void persistCurrent();
    window.requestAnimationFrame(renderNoteMarkers);
  }
  updatePosition();
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".nav-button")) {
  button.addEventListener("click", () => { setView(button.dataset.view as View); if (button.dataset.view === "profile") location.hash = "/profile"; });
}
$("#brand-home").addEventListener("click", () => setView("home"));
$("#import-button").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files) void importFiles(fileInput.files);
  fileInput.value = "";
});
homeCarousel = mountBookCarousel($<HTMLDivElement>("#recent-list"), $<HTMLButtonElement>("#recent-previous"), $<HTMLButtonElement>("#recent-next"));
$("#back-button").addEventListener("click", () => setView(lastCollectionView));
$("#previous-button").addEventListener("click", () => void turnPage(-1));
$("#next-button").addEventListener("click", () => void turnPage(1));
$("#smaller-button").addEventListener("click", () => changeSize(-1));
$("#larger-button").addEventListener("click", () => changeSize(1));
$<HTMLSelectElement>("#pdf-reading-mode").addEventListener("change", () => {
  if (!currentBook || currentBook.format !== "pdf") return;
  if (pdfTextView) pdfPosition.offset = pdfTextView.visibleOffset();
  pdfReadingMode = $<HTMLSelectElement>("#pdf-reading-mode").value === "original" ? "original" : "text";
  localStorage.setItem(`autumn-pdf-mode-${currentBook.id}`, pdfReadingMode);
  void renderPdfPage().then(persistCurrent);
});
$("#note-add").addEventListener("click", () => openNoteDialog());
$("#note-custom-color").addEventListener("input", () => { selectedNoteColor = hexColor($<HTMLInputElement>("#note-custom-color").value) ?? noteColors[0]; renderNoteColors(); });
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
const libraryStatusSelect = document.createElement("select");
libraryStatusSelect.id = "library-status-filter";
libraryStatusSelect.setAttribute("aria-label", t("filterLibrary"));
for (const [value, label] of [["all", "filterAllBooks"], ["reading", "statusReading"], ["finished", "statusFinished"], ["unread", "statusUnread"], ["favorites", "favorites"]] as const)
  libraryStatusSelect.add(new Option(t(label), value));
libraryStatusSelect.addEventListener("change", () => { libraryStatusFilter = libraryStatusSelect.value as LibraryStatusFilter; renderCollections(); });
$(".library-display-tools").prepend(libraryStatusSelect);
for (const button of document.querySelectorAll<HTMLButtonElement>(".theme-choice")) {
  button.addEventListener("click", () => {
    theme = button.dataset.themeChoice as "light" | "dark";
    localStorage.setItem("autumn-theme", theme);
    applyTheme();
  });
}
const pageTurnAnimationInput = $<HTMLInputElement>("#page-turn-animation");
const pageTurnAnimationStatus = $<HTMLElement>("#page-turn-animation-status");
pageTurnAnimationInput.checked = pageTurnAnimationEnabled;
const renderPageTurnAnimation = (): void => { pageTurnAnimationStatus.textContent = t(!pageTurnAnimationEnabled ? "animationOff" : reducedMotion.matches ? "animationReducedBySystem" : "animationOn"); };
renderPageTurnAnimation();
reducedMotion.addEventListener("change", renderPageTurnAnimation);
pageTurnAnimationInput.addEventListener("change", () => {
  pageTurnAnimationEnabled = pageTurnAnimationInput.checked;
  localStorage.setItem(pageTurnAnimationKey,pageTurnAnimationEnabled ? "on" : "off");
  renderPageTurnAnimation();
});
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
function handleReaderKeydown(event: KeyboardEvent): void {
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
    if (translationUI?.opened) translationUI.close();
    if (searchUI?.opened) searchUI.close();
    if (!$<HTMLDivElement>("#note-dialog").hidden) closeNoteDialog();
    if (!$<HTMLDivElement>("#all-notes-dialog").hidden) closeAllNotes();
    hideNoteMenu();
    return;
  }
  if (!$<HTMLDivElement>("#note-dialog").hidden || !$<HTMLDivElement>("#all-notes-dialog").hidden) return;
  if (view === "reader" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); translationUI?.close(); searchUI?.open(); return; }
  if ((event.target as Element | null)?.closest("input,textarea,select,[contenteditable='true']")) return;
  if (event.altKey || event.ctrlKey || event.metaKey || view !== "reader") return;
  if (event.key === "ArrowLeft") { event.preventDefault(); void turnPage(-1); }
  if (event.key === "ArrowRight") { event.preventDefault(); void turnPage(1); }
}
window.addEventListener("keydown", handleReaderKeydown);
let resizeTimer: number | undefined;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (view !== "reader") return;
    if (pageTurn) {void endPageTurn(false,pageTurn.direction).then(()=>currentBook?.format==="pdf"?renderPdfPage():renderNoteMarkers());return;}
    if (currentBook?.format === "pdf") void renderPdfPage();
    else renderNoteMarkers();
  }, 150);
});

applyTheme();
setView("home");
mountSettings($("#view-settings"));
translationUI=mountTranslation($("#translation-panel"),translationService,()=>readingSurface.focus({preventScroll:true}));
$("#selection-translate").addEventListener("click",()=>{hideNoteMenu();searchUI?.close();translationUI?.open(selectedTranslationText);});
searchUI = mountBookSearch($("#book-search-panel"), jumpToSearch, () => { clearSearchHighlight(); $("#book-search-button").focus(); });
$("#book-search-button").addEventListener("click", () => {translationUI?.close();searchUI?.opened ? searchUI.close() : searchUI?.open();});
$("#reader-toc").addEventListener("change", () => { const toc = $<HTMLSelectElement>("#reader-toc"); void (currentBook?.format === "pdf" ? jumpToPdfReference(pdfOutlineDestinations.get(toc.value)) : jumpToContents(toc.value)).catch(error => showToast(errorMessage(error))); toc.value = ""; });
const historyAction = (direction: "back" | "forward" | "return"): void => {
  if (readerJumpBusy) return;
  const position = direction === "return" ? readerHistory.returnToReading() : direction === "back" ? readerHistory.back() : readerHistory.forward();
  if (position) void displayPosition(position).catch(error => showToast(errorMessage(error)));
};
$("#history-back").addEventListener("click", () => historyAction("back"));
$("#history-forward").addEventListener("click", () => historyAction("forward"));
$("#reading-return").addEventListener("click", () => historyAction("return"));
$("#reading-adopt").addEventListener("click", () => {
  if (readerJumpBusy) return;
  readerHistory.commit(capturePosition());
  if (currentBook?.format === "epub") { currentBook.cfi = epubPosition.cfi; if (rendition?.location) currentBook.percentage = epubReadingPercentage(rendition.location); }
  void persistCurrent(); updateHistory();
});
folderUI = mountFolders($("#library-folders"), renderCollections, showToast, () => confirmAction({ title: t("deleteFolder"), message: t("deleteFolderMessage"), confirmLabel: t("deleteFolder"), tone: "remove" }), () => { $<HTMLInputElement>("#library-search").value = ""; });
mountLibraryDrag($("#library-list"), id => books.find(book => book.id === id), (book, folderId) => folderUI!.move(book, folderId), showToast);
const sortSelect = $<HTMLSelectElement>("#library-sort"); sortSelect.value = librarySort;
sortSelect.addEventListener("change", () => { librarySort = sortSelect.value as LibrarySort; localStorage.setItem("autumn-library-sort", librarySort); renderCollections(); });
const updateLibraryLayout = (): void => {
  $<HTMLButtonElement>("#library-grid-button").setAttribute("aria-pressed", String(libraryLayout === "grid"));
  $<HTMLButtonElement>("#library-list-button").setAttribute("aria-pressed", String(libraryLayout === "list"));
  $("#library-list").dataset.layout = libraryLayout;
};
for (const layout of ["grid", "list"] as const) $(layout === "grid" ? "#library-grid-button" : "#library-list-button").addEventListener("click", () => {
  libraryLayout = layout; localStorage.setItem("autumn-library-layout", layout); updateLibraryLayout();
});
updateLibraryLayout();
const updateSpacingControls = (): void => {
  $<HTMLInputElement>("#line-spacing").value = String(pagePreferences.lineHeight);
  $<HTMLInputElement>("#paragraph-spacing").value = String(pagePreferences.paragraphSpacing);
  $("#line-spacing-value").textContent = String(pagePreferences.lineHeight);
  $("#paragraph-spacing-value").textContent = `${pagePreferences.paragraphSpacing} em`;
};
const updateSpacing = (): void => {
  pagePreferences = savePagePreferences({ lineHeight: Number($<HTMLInputElement>("#line-spacing").value), paragraphSpacing: Number($<HTMLInputElement>("#paragraph-spacing").value) });
  updateSpacingControls(); applyPageSpacing();
  if (currentBook?.format === "pdf" && pdfTextView) void renderPdfPage();
};
$("#line-spacing").addEventListener("change", updateSpacing);
$("#paragraph-spacing").addEventListener("change", updateSpacing);
$("#spacing-reset").addEventListener("click", () => { pagePreferences = { ...defaultPagePreferences }; updateSpacingControls(); updateSpacing(); });
updateSpacingControls();
mountAccount(app, $(".shell"), $("#settings-session"));
mountAccountSecurity($("#settings-security"));
mountAccountStorage($("#settings-cloud-storage"), coverElement, reloadCloudLibrary);
setCloudBookLoader((book) => bookStorage.getBook(book));
void requestPersistentCache();
mountSync($("#settings-sync"), reloadCloudLibrary);
reviewComposer = mountReviewComposer(app, showToast);
bookEditor = mountBookEditor(app, coverElement, async (book, changes) => {
  const next = { ...book, ...changes, nativeCoverPath: changes.customCover ? undefined : book.nativeCoverPath };
  await saveBook(next);
  Object.assign(book, next);
  if (currentBook?.id === book.id) Object.assign(currentBook, next);
  const cached = coverCache.get(book.id);
  if (cached) { URL.revokeObjectURL(cached.url); coverCache.delete(book.id); }
  books = books.map(item => item.id === book.id ? book : item);
  renderCollections();
  window.dispatchEvent(new Event("autumn-book-metadata-change"));
  showToast(t("editBookSaved"));
});
const reviewBookVisual = (entry: ReviewEntry): { cover: HTMLElement; title: string; author: string } => {
  const local = books.find(book => book.cloudId === entry.book.id || book.id === entry.sourceLocalId || book.migrationSources?.includes(entry.sourceLocalId ?? "") ||
    (titleOf(book) === entry.book.title && (book.author ?? "") === entry.book.author && book.format === entry.book.format));
  if (local) return { cover: coverElement(local), title: titleOf(local), author: local.author ?? "" };
  const fallback: StoredBook = { id: entry.book.id, name: `${entry.book.title}.${entry.book.format}`,
    format: entry.book.format, author: entry.book.author, data: new Blob(), addedAt: 0,
    lastOpenedAt: 0, page: 1, cfi: null, fontSize: 100 };
  const cover = coverElement(fallback);
  if (entry.book.cover_url?.startsWith("https://")) {
    const img = document.createElement("img"); img.src = entry.book.cover_url; img.alt = "";
    img.loading = "lazy"; img.referrerPolicy = "no-referrer"; cover.replaceChildren(img);
    cover.classList.remove("book-cover-fallback");
  }
  return { cover, title: entry.book.title, author: entry.book.author };
};
profilePage = mountProfile($("#view-profile"), (book) => presentationCard(book, coverElement, (item) => void openBook(item), false), reviewBookVisual, (cached) => {
  books = cached;
  renderCollections();
}, reviewComposer, () => confirmAction({ title: t("deleteReview"), message: t("deleteReviewMessage"), confirmLabel: t("deleteReview"), tone: "remove" }), () => openLibraryFilter("favorites"));
const details = mountDetails($("#view-details"), () => setView("details"), reviewComposer);
const profileRoute = (): void => {
  if (["/profile", "/community"].includes(location.hash.slice(1))) {
    if (view !== "profile") setView("profile");
  }
};
window.addEventListener("hashchange", profileRoute);
profileRoute();
sync.initialize();
void auth.initialize().catch(() => showToast(t("authLoadFailed")));
let collectionSequence = 0;
let cloudPageOffset = 0;
const loadMoreCloud = document.createElement("button");
loadMoreCloud.className = "secondary-button"; loadMoreCloud.textContent = t("loadMoreCloud"); loadMoreCloud.hidden = true;
$("#view-library").append(loadMoreCloud);
async function refreshFolders(): Promise<void> {
  await folders.refresh(books.flatMap(book => book.cloudId ? [book.cloudId] : []));
  await folderUI?.reload();
}
async function reloadCloudLibrary(): Promise<void> {
  const sequence = ++collectionSequence; const owner = auth.state.ownerId;
  const loaded = await listBooks(owner);
  if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
  books = loaded;
  const states = await localAll<MigrationState>("migration_state");
  if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
  for (const state of states) if (state.ownerId === owner && state.phase === "error" && cloudState.get(state.localId) !== "syncing") cloudState.set(state.localId, "error");
  await folderUI?.reload();
  // Switch a reader opened during import to its account copy after migration commits.
  if (currentBook && !currentBook.cloudId && owner && (!currentBook.ownerId || currentBook.ownerId === owner)) {
    const clone = books.find((b) => b.ownerId === owner && b.migrationSources?.includes(currentBook!.id));
    if (clone) { Object.assign(currentBook, clone); books = books.map((b) => b.id === clone.id ? currentBook! : b); }
  }
  renderCollections();
  if (auth.state.status !== "authenticated" || !navigator.onLine) return;
  try {
    const result = await library.page(0);
    if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
    await cloudStorage.reconcile(loaded);
    if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
    cloudPageOffset = result.books.length; loadMoreCloud.hidden = !result.hasMore;
    const refreshed = await listBooks(owner);
    if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
    books = refreshed; await refreshFolders();
    if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
    renderCollections();
  } catch (error: unknown) { showToast(errorMessage(error)); }
}
loadMoreCloud.addEventListener("click", () => {
  const owner = auth.state.ownerId; const sequence = collectionSequence;
  loadMoreCloud.disabled = true;
  void library.page(cloudPageOffset).then(async (result) => {
    if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
    const refreshed = await listBooks(owner);
    if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
    cloudPageOffset += result.books.length; loadMoreCloud.hidden = !result.hasMore;
    books = refreshed; await refreshFolders();
    if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
    renderCollections();
  }).catch((error: unknown) => showToast(errorMessage(error))).finally(() => { loadMoreCloud.disabled = false; });
});
let collectionOwner: string | null | undefined;
auth.subscribe((state) => {
  if (state.status === "loading") return;
  if (collectionOwner !== state.ownerId) {
    collectionOwner = state.ownerId; ++loadSequence;
    for (const cached of coverCache.values()) URL.revokeObjectURL(cached.url);
    coverCache.clear();
    books = []; cloudState.clear(); renderCollections();
    currentBook = null; void clearReader(); if (view === "reader") setView("home");
    loadMoreCloud.hidden = true; void reloadCloudLibrary().catch(() => showToast(t("libraryOpenFailed")));
  } else if (state.status === "authenticated") void reloadCloudLibrary();
  if (state.status === "authenticated") void resumeApprovedMigrations().then((resumed) => resumed ? reloadCloudLibrary() : undefined).catch((error: unknown) => showToast(errorMessage(error)));
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && view !== "reader") void reloadCloudLibrary(); });
window.addEventListener("online", () => { void auth.refresh().then(resumeApprovedMigrations).then(reloadCloudLibrary).catch((error: unknown) => showToast(errorMessage(error))); });
window.addEventListener("autumn-synced", () => { if (view !== "reader") void refreshFolders().catch(() => {}); });
window.addEventListener("autumn-upload-progress", event => {
  const id = (event as CustomEvent<{ bookId?: string; stage: string }>).detail.bookId;
  if (id && cloudState.get(id) !== "syncing" && books.some(book => book.id === id)) { cloudState.set(id, "syncing"); renderCollections(); }
});
window.addEventListener("autumn-migration-error", event => {
  const id = (event as CustomEvent<{ bookId?: string }>).detail.bookId;
  if (id) { cloudState.set(id, "error"); renderCollections(); }
});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&pageTurn)void endPageTurn(false,pageTurn.direction);});
