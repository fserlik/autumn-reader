import ePub, { type Book as EpubBook, type Contents, type Location, type Rendition } from "epubjs";
import type {
  TextLayer,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPdfEngine } from "./readers/pdf-engine";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { pdfTextBlocks, PdfTextView, type PdfTextBlock } from "./pdf-text";
import { countText, language, saveLanguage, t, type Language } from "./i18n";
import leafUrl from "./assets/autumn-leaf.png";
import { assertBookOwner, claimUnownedBooks, deleteBook, listBooks, nativeBookUrl, readBookData, saveBook, setCloudBookLoader, hasLocalFile, unclaimedBookCount, type BookNote, type StoredBook } from "./storage";
import "./style.css";
import { auth } from "./services/auth";
import { mountAccount } from "./ui/account";
import { mountAccountSecurity } from "./ui/account-security";
import { mountAccountStorage } from "./ui/account-storage";
import { mountAccountPlans } from "./ui/account-plans";
import { plans } from "./services/plans";
import { cloudStorage } from "./services/books/cloud-storage";
import { bookStorage, requestPersistentCache } from "./services/storage";
import { ensureBookContentMetadata } from "./services/books/content-metadata";
import { bookDisplayTitle } from "./services/books/display";
import { bookCache } from "./services/storage";
import { downloadPrivateCover } from "./services/storage/book-covers";
import { mountBookEditor, type BookEditor } from "./ui/edit-book";
import { library } from "./services/books";
import { importUniqueBook, reconcileLocalLibrary } from "./services/books/identity";
import { sync } from "./services/sync";
import { mountSync } from "./ui/sync";
import { cancelMigration, migrateLibrary, resumeApprovedMigrations } from "./services/sync/migration";
import { errorMessage } from "./services/errors";
import { mountDetails } from "./ui/social-details";
import { mountProfile, type ProfileUI } from "./ui/profile-page";
import { mountBookCarousel } from "./ui/book-carousel";
import { presentationCard, readingBooks } from "./ui/book-presentation";
import { mountReviewComposer, type ReviewComposer } from "./ui/reviews";
import type { ReviewEntry } from "./services/reviews/personal";
import { mountSettings } from "./ui/settings";
import { mountLayoutFields } from "./ui/layout-controls";
import { platformFilePicker } from "./services/platform/files";
import { mountFolders, type FolderUI } from "./ui/folders";
import { mountLibraryDrag } from "./ui/library-drag";
import { folders } from "./services/folders";
import { localAll } from "./services/local/database";
import type { MigrationState } from "./services/sync/migration";
import { bookColors, colorName, hexColor } from "./book-colors";
import { loadPagePreferences, savePagePreferences, defaultPagePreferences, pageSpacingCss, columnCount, resolvePagePreferences, pagePreferencesEqual, loadBookPageOverrides, saveBookPageOverrides, type BookPageOverrides } from "./services/preferences/page";
import { loadDesktopGeneralPreferences, saveDesktopGeneralPreferences, type DesktopGeneralPreferences } from "./services/preferences/general";
import { availableSystemFonts, fontCss } from "./services/preferences/fonts";
import { dictionaryService, type DictionarySource } from "./services/dictionary";
import { loadTtsPreferences, localDeviceVoices, nativeDeviceVoices, nativePause, nativeResume, nativeSpeak, nativeStop, preferredVoice, refreshDeviceVoices, saveTtsPreferences, usesNativeTts, type TtsPreferences, type TtsVoice } from "./services/tts";
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
  brightness: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6m11 11 1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6m11-11 1.6-1.6"/>',
  textSize: '<path d="M3 6V4h10v2M8 4v16M5 20h6M15 10V8h6v2m-3-2v12m-2.5 0h5"/>',
  speech: '<path d="M5 10v4h3l4 3V7l-4 3H5zM16 9.2a4 4 0 0 1 0 5.6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  play: '<path d="m8 5 11 7-11 7V5z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  previousTrack: '<path d="M6 5v14M18 6l-9 6 9 6V6z"/>',
  nextTrack: '<path d="M18 5v14M6 6l9 6-9 6V6z"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 8A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 11.9-2"/>',
  bookLayout: '<path d="M3 5.5A4.5 4.5 0 0 1 7.5 4H11v16H7.5A4.5 4.5 0 0 0 3 21.5v-16zM21 5.5A4.5 4.5 0 0 0 16.5 4H13v16h3.5a4.5 4.5 0 0 1 4.5 1.5v-16z"/>',
  more: '<circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
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
            <div class="hero-copy"><p class="hero-eyebrow" id="hero-eyebrow">${t("continueReading")}</p><h2 id="hero-title"></h2><p class="hero-author" id="hero-author"></p><p id="hero-description"></p><button id="hero-action" class="hero-button" type="button"><span>${t("firstBook")}</span>${svg("arrow", 18)}</button></div>
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
          <div id="legacy-recovery" class="legacy-recovery" hidden><div><h3>${t("legacyBooksTitle")}</h3><p>${t("legacyBooksHelp")}</p></div><button id="legacy-recovery-button" class="secondary-button" type="button">${t("legacyBooksClaim")}</button></div>
          <div id="library-folders"></div>
          <div id="library-list" class="book-grid library-grid"></div>
        </section>

        <section id="view-settings" class="view settings-view" hidden>
          <div class="settings-tabs" role="tablist" aria-label="${t("settings")}">
            ${isAndroid ? "" : `<button id="settings-general-tab" type="button" role="tab" aria-controls="settings-general-panel" aria-selected="true">${t("generalSettings")}</button>`}
            <button id="settings-account-tab" type="button" role="tab" aria-controls="settings-account-panel" aria-selected="${String(isAndroid)}"${isAndroid ? "" : ' tabindex="-1"'}>${t("accountSettings")}</button>
            <button id="settings-page-tab" type="button" role="tab" aria-controls="settings-page-panel" aria-selected="false" tabindex="-1">${({ en: "Font and Layout", es: "Fuente y diseño", it: "Carattere e layout", fr: "Police et mise en page" } as Record<Language, string>)[language]}</button>
            <button id="settings-tts-tab" type="button" role="tab" aria-controls="settings-tts-panel" aria-selected="false" tabindex="-1">${t("ttsTab")}</button>
            <button id="settings-interface-tab" type="button" role="tab" aria-controls="settings-interface-panel" aria-selected="false" tabindex="-1">${t("interfaceSettings")}</button>
          </div>
          ${isAndroid ? "" : `<section id="settings-general-panel" class="settings-section general-settings" role="tabpanel" aria-labelledby="settings-general-tab" tabindex="0">
            <div class="settings-section-heading"><h2>${t("generalSettings")}</h2><p>${t("generalSettingsHelp")}</p></div>
            <div class="general-settings-sheet">
              <label class="general-setting-row" for="general-disable-trash"><span class="settings-copy"><strong>${t("disableTrashBin")}</strong><small>${t("disableTrashBinHelp")}</small></span><span class="general-switch"><input id="general-disable-trash" type="checkbox" data-general-setting="disableTrashBin" /><span aria-hidden="true"></span></span></label>
              <label class="general-setting-row" for="general-delete-folder-books"><span class="settings-copy"><strong>${t("deleteBooksWithFolder")}</strong><small>${t("deleteBooksWithFolderHelp")}</small></span><span class="general-switch"><input id="general-delete-folder-books" type="checkbox" data-general-setting="deleteBooksWithFolder" /><span aria-hidden="true"></span></span></label>
              <label class="general-setting-row" for="general-screen-awake"><span class="settings-copy"><strong>${t("preventScreenBlanking")}</strong><small>${t("preventScreenBlankingHelp")}</small></span><span class="general-switch"><input id="general-screen-awake" type="checkbox" data-general-setting="preventScreenBlanking" /><span aria-hidden="true"></span></span></label>
              <label class="general-setting-row" for="general-auto-maximize"><span class="settings-copy"><strong>${t("autoMaximize")}</strong><small>${t("autoMaximizeHelp")}</small></span><span class="general-switch"><input id="general-auto-maximize" type="checkbox" data-general-setting="autoMaximize" /><span aria-hidden="true"></span></span></label>
              <label class="general-setting-row" for="general-launch-startup"><span class="settings-copy"><strong>${t("launchOnStartup")}</strong><small>${t("launchOnStartupHelp")}</small></span><span class="general-switch"><input id="general-launch-startup" type="checkbox" data-general-setting="launchOnStartup" /><span aria-hidden="true"></span></span></label>
              <label class="general-setting-row" for="general-minimize-tray"><span class="settings-copy"><strong>${t("minimizeToTrayOnClose")}</strong><small>${t("minimizeToTrayOnCloseHelp")}</small></span><span class="general-switch"><input id="general-minimize-tray" type="checkbox" data-general-setting="minimizeToTrayOnClose" /><span aria-hidden="true"></span></span></label>
              <div class="general-setting-row general-language-row"><label class="settings-copy" for="app-language"><strong>${t("language")}</strong><small>${t("languageHelp")}</small></label><select id="app-language" aria-label="${t("languageLabel")}"><option value="en">English</option><option value="es">Español</option><option value="it">Italiano</option><option value="fr">Français</option></select></div>
            </div>
            <p id="general-settings-status" class="general-settings-status" role="status" aria-live="polite"></p>
          </section>`}
          <section id="settings-account-panel" class="settings-section" role="tabpanel" aria-labelledby="settings-account-tab" tabindex="0"${isAndroid ? "" : " hidden"}>
            <div class="settings-section-heading"><h2>${t("accountSettings")}</h2><p>${t("accountSettingsHelp")}</p></div>
            <div id="settings-account-sheet" class="account-settings-sheet">
              <div id="settings-plan"></div>
              <div id="settings-security"></div>
            </div>
          </section>
          <section id="settings-page-panel" class="settings-section" role="tabpanel" aria-labelledby="settings-page-tab" tabindex="0" hidden>

            <div class="settings-section-heading"><h2>${({ en: "Font and Layout", es: "Fuente y diseño", it: "Carattere e layout", fr: "Police et mise en page" } as Record<Language, string>)[language]}</h2><p>${t("pageSettingsHelp")}</p></div>
            <div class="page-settings-panel">
              <div class="page-setting-row">
                <div class="settings-copy"><h3>${t("bookFont")}</h3><p>${t("bookFontHelp")}</p></div>
                <div class="font-setting-control"><select id="book-font" aria-label="${t("bookFontLabel")}"><option value="original">${t("fontOriginal")}</option><option value="georgia">${t("fontGeorgia")}</option><option value="arial">${t("fontArial")}</option><option value="verdana">${t("fontVerdana")}</option><option value="times">${t("fontTimes")}</option></select><div id="global-font-preview" class="font-preview">${t("fontPreview")}</div></div>
              </div>
              <div class="page-setting-row"><div class="settings-copy"><h3>${t("lineSpacing")}</h3><p>${t("lineSpacingHelp")}</p></div><label class="spacing-control"><span>${t("compact")}</span><input id="line-spacing" type="range" min="1" max="2.5" step="0.1" aria-label="${t("lineSpacing")}" /><span>${t("wide")}</span><output id="line-spacing-value"></output></label></div>
              <div class="page-setting-row"><div class="settings-copy"><h3>${t("paragraphSpacing")}</h3><p>${t("paragraphSpacingHelp")}</p></div><label class="spacing-control"><span>${t("compact")}</span><input id="paragraph-spacing" type="range" min="0" max="2.5" step="0.1" aria-label="${t("paragraphSpacing")}" /><span>${t("wide")}</span><output id="paragraph-spacing-value"></output></label></div>
              <div id="global-layout-extra" class="layout-fields page-layout-fields"></div>
              <div class="page-settings-footer"><button id="spacing-reset" class="secondary-button" type="button">${({ en: "Reset settings", es: "Restaurar configuración", it: "Ripristina impostazioni", fr: "Réinitialiser les paramètres" } as Record<Language, string>)[language]}</button></div>
            </div>

          </section>
          <section id="settings-tts-panel" class="settings-section tts-settings" role="tabpanel" aria-labelledby="settings-tts-tab" tabindex="0" hidden>
            <div class="settings-section-heading"><h2>${t("ttsSettingsTitle")}</h2><p>${t("ttsSettingsHelp")}</p></div>
            <div class="tts-settings-sheet">
              <div class="tts-setting-row tts-voice-row">
                <div class="settings-copy"><h3>${t("ttsDeviceVoices")}</h3><p>${t("ttsDeviceVoicesHelp")}</p></div>
                <div class="tts-setting-control"><label for="tts-voice-select">${t("ttsVoiceLabel")}</label><select id="tts-voice-select"></select><button id="tts-refresh-voices" class="secondary-button" type="button">${svg("refresh", 17)}<span>${t("ttsImportVoices")}</span></button><p id="tts-voice-status" role="status" aria-live="polite"></p></div>
              </div>
              <div class="tts-setting-row">
                <div class="settings-copy"><h3>${t("ttsReadingPace")}</h3><p>${t("ttsReadingPaceHelp")}</p></div>
                <label class="tts-rate-control" for="tts-rate-settings"><span>${t("ttsNormalSpeed")}</span><input id="tts-rate-settings" type="range" min="0.5" max="2" step="0.1" /><output id="tts-rate-settings-value">1×</output></label>
              </div>
              <div class="tts-preview-row"><button id="tts-preview" class="secondary-button" type="button">${svg("play", 17)}<span>${t("ttsPreview")}</span></button><p id="tts-preview-status" role="status" aria-live="polite"></p></div>
            </div>
          </section>
          <section id="settings-interface-panel" class="settings-section" role="tabpanel" aria-labelledby="settings-interface-tab" tabindex="0" hidden>
            <div class="settings-section-heading"><h2>${t("interfaceSettings")}</h2><p>${t("interfaceSettingsHelp")}</p></div>
            <div class="interface-settings-sheet">
              <div class="settings-group"><div class="settings-copy"><h3>${t("appearance")}</h3><p>${t("appearanceHelp")}</p></div><div class="theme-options" role="group" aria-label="${t("appTheme")}"><button type="button" data-theme-choice="light" class="theme-choice"><span class="theme-preview theme-light"></span>${t("light")}</button><button type="button" data-theme-choice="dark" class="theme-choice"><span class="theme-preview theme-dark"></span>${t("dark")}</button></div></div>
              <div class="settings-group"><div class="settings-copy"><h3>${t("noteStyle")}</h3><p>${t("noteStyleHelp")}</p></div><div class="note-style-options" role="group" aria-label="${t("noteStyleLabel")}"><button type="button" class="note-style-choice" data-note-style="highlight" aria-pressed="false"><span class="note-style-preview" aria-hidden="true">Aa</span><span>${t("noteStyleHighlight")}</span></button><button type="button" class="note-style-choice" data-note-style="underline" aria-pressed="false"><span class="note-style-preview" aria-hidden="true">Aa</span><span>${t("noteStyleUnderline")}</span></button><button type="button" class="note-style-choice" data-note-style="strikethrough" aria-pressed="false"><span class="note-style-preview" aria-hidden="true">Aa</span><span>${t("noteStyleStrikethrough")}</span></button><button type="button" class="note-style-choice" data-note-style="wavy" aria-pressed="false"><span class="note-style-preview" aria-hidden="true">Aa</span><span>${t("noteStyleWavy")}</span></button></div></div>
              <div class="settings-group"><div class="settings-copy"><h3>${t("pageTurnAnimation")}</h3><p id="page-turn-animation-help">${t("pageTurnAnimationHelp")}</p></div><label class="settings-switch"><input id="page-turn-animation" type="checkbox" aria-label="${t("pageTurnAnimation")}" aria-describedby="page-turn-animation-help" /><span class="switch-track" aria-hidden="true"><span></span></span><span id="page-turn-animation-status"></span></label></div>
              ${isAndroid ? `<div class="settings-group"><div class="settings-copy"><h3>${t("language")}</h3><p>${t("languageHelp")}</p></div><select id="app-language" aria-label="${t("languageLabel")}"><option value="en">English</option><option value="es">Español</option><option value="it">Italiano</option><option value="fr">Français</option></select></div>` : ""}
            </div>
          </section>
        </section>

        <section id="view-profile" class="view profile-view" hidden></section>
        <section id="view-details" class="view details-view" hidden></section>
        <section id="view-reader" class="view reader-view" hidden>
          <aside id="reader-sidebar" class="reader-sidebar" aria-label="${t("readerSidebar")}">
            <div class="reader-book-summary">
              <button id="desktop-reader-back" class="reader-sidebar-back" type="button" aria-label="${t("readerBackToLibrary")}">${svg("back", 18)}</button>
              <div id="reader-book-cover" class="reader-book-cover" aria-hidden="true"></div>
              <div class="reader-book-copy"><h2 id="reader-book-title"></h2><p id="reader-book-author"></p></div>
            </div>
            <div class="reader-sidebar-tabs" role="tablist" aria-label="${t("readerSidebar")}">
              <button id="reader-contents-tab" class="reader-sidebar-tab" type="button" role="tab" aria-selected="true" aria-controls="reader-sidebar-contents">${svg("bookLayout", 18)}<span>${t("readerContents")}</span></button>
              <button id="reader-notes-tab" class="reader-sidebar-tab" type="button" role="tab" aria-selected="false" aria-controls="reader-sidebar-notes">${svg("notes", 18)}<span>${t("readerNotes")}</span><span id="sidebar-notes-count" class="reader-sidebar-count">0</span></button>
              <button id="reader-tts-tab" class="reader-sidebar-tab" type="button" role="tab" aria-selected="false" aria-controls="reader-sidebar-tts" hidden>${svg("speech", 18)}<span>${t("ttsTab")}</span></button>
            </div>
            <section id="reader-sidebar-contents" class="reader-sidebar-panel" role="tabpanel" aria-labelledby="reader-contents-tab">
              <h3>${t("readerContents")}</h3>
              <nav id="reader-toc-list" class="reader-toc-list" aria-label="${t("tableOfContents")}"></nav>
            </section>
            <section id="reader-sidebar-notes" class="reader-sidebar-panel" role="tabpanel" aria-labelledby="reader-notes-tab" hidden>
              <h3>${t("readerNotes")}</h3>
              <div id="reader-sidebar-notes-list" class="reader-sidebar-notes-list"></div>
            </section>
            <section id="reader-sidebar-tts" class="reader-sidebar-panel reader-sidebar-tts" role="tabpanel" aria-labelledby="reader-tts-tab" hidden>
              <h3>${t("textToSpeech")}</h3>
              <div id="reader-sidebar-tts-body"></div>
            </section>
          </aside>
          <div class="reader-toolbar">
            <button id="back-button" class="back-button" type="button">${svg("back", 18)}<span>${t("back")}</span></button>
            <div class="reader-tool-strip" role="toolbar" aria-label="${t("readingOptions")}">
              <button id="brightness-toggle" class="reader-tool-button reader-mobile-tool" data-reader-options-trigger type="button" title="${t("brightness")}" aria-label="${t("brightness")}" aria-controls="brightness-panel" aria-expanded="false">${svg("brightness", 18)}</button>
              <button id="size-toggle" class="reader-tool-button reader-mobile-tool" data-reader-options-trigger type="button" title="${t("text")}" aria-label="${t("text")}" aria-controls="size-panel" aria-expanded="false">${svg("textSize", 19)}</button>
              <button id="speech-toggle" class="reader-tool-button reader-mobile-tool" data-reader-options-trigger type="button" title="${t("textToSpeech")}" aria-label="${t("textToSpeech")}" aria-controls="speech-panel" aria-expanded="false" hidden>${svg("speech", 19)}</button>
              <button id="layout-toggle" class="reader-tool-button reader-mobile-tool" data-reader-options-trigger type="button" title="${t("layoutOptions")}" aria-label="${t("layoutOptions")}" aria-controls="layout-panel" aria-expanded="false">${svg("bookLayout", 19)}</button>
              <button id="all-notes-button" class="reader-notes-button reader-mobile-tool" type="button" aria-haspopup="dialog" aria-controls="all-notes-dialog">${svg("notes", 17)}<span>${t("notes")}</span><span id="notes-count" class="notes-count">0</span></button>
              <button id="book-search-button" class="reader-tool-button" type="button" title="${t("searchInBook")}" aria-label="${t("searchInBook")}" aria-controls="book-search-panel">${svg("search", 18)}</button>
              <button id="reader-settings-toggle" class="reader-tool-button reader-desktop-tool" type="button" title="${t("readerBookSettings")}" aria-label="${t("readerBookSettings")}" aria-controls="reader-options" aria-expanded="false">${svg("more", 21)}</button>
            </div>
            <div id="reader-options" class="reader-options" role="dialog" aria-label="${t("readerBookSettings")}" hidden>
              <div class="reader-settings-tabs" role="tablist" aria-label="${t("readerBookSettings")}">
                <button id="reader-settings-layout-tab" type="button" role="tab" aria-selected="false">${t("layoutOptions")}</button>
                <button id="reader-settings-appearance-tab" type="button" role="tab" aria-selected="true">${t("readerAppearance")}</button>
              </div>
              <section id="brightness-panel" class="reader-option-panel" data-reader-panel="brightness" hidden>
                <div class="reader-panel-heading"><span>${svg("brightness", 18)}</span><h3>${t("brightness")}</h3><output id="brightness-value">100%</output></div>
                <label class="reader-option-line"><span>${t("brightness")}</span><input id="reader-brightness" type="range" min="55" max="130" value="100" aria-label="${t("brightness")}" /></label>
              </section>
              <section id="size-panel" class="reader-option-panel" data-reader-panel="size" hidden>
                <div class="reader-panel-heading"><span>${svg("textSize", 18)}</span><h3 id="size-label">${t("text")}</h3></div>
                <div class="reader-controls size-controls"><button id="smaller-button" class="tool-button" type="button" aria-label="${t("decreaseSize")}">−</button><span id="size-value" class="size-value">100%</span><button id="larger-button" class="tool-button" type="button" aria-label="${t("increaseSize")}">＋</button></div>
              </section>
              <section id="speech-panel" class="reader-option-panel" data-reader-panel="speech" hidden>
                <div class="reader-panel-heading"><span>${svg("speech", 18)}</span><h3>${t("textToSpeech")}</h3><output id="tts-player-status" aria-live="polite">${t("ttsPlayerReady")}</output></div>
                <div class="tts-current"><span id="tts-page-context">${t("ttsCurrentPage")}</span><p id="tts-passage"></p><small id="tts-active-voice"></small></div>
                <div class="tts-transport" role="group" aria-label="${t("textToSpeech")}"><button id="tts-previous" type="button" aria-label="${t("ttsPreviousPage")}">${svg("previousTrack", 20)}</button><button id="tts-play-pause" class="tts-play" type="button" aria-label="${t("ttsPlay")}">${svg("play", 23)}</button><button id="tts-next" type="button" aria-label="${t("ttsNextPage")}">${svg("nextTrack", 20)}</button></div>
                <label class="reader-option-line tts-player-rate" for="tts-rate-reader"><span>${t("ttsReadingPace")}</span><input id="tts-rate-reader" type="range" min="0.5" max="2" step="0.1" /><output id="tts-rate-reader-value">1×</output></label>
              </section>
              <section id="layout-panel" class="reader-option-panel reader-layout-panel" data-reader-panel="layout" hidden>
                <div class="reader-panel-heading"><span>${svg("bookLayout", 18)}</span><h3>${t("bookLayout")}</h3></div>
                <select id="pdf-reading-mode" class="pdf-reading-mode" aria-label="${t("readingMode")}" hidden><option value="text">${t("adjustableText")}</option><option value="original">${t("originalPage")}</option></select>
                <div id="book-layout-details" class="book-layout-details"><div id="book-layout-fields" class="layout-fields"></div></div>
              </section>
              <section id="book-theme-panel" class="reader-option-panel book-theme-panel" data-reader-panel="theme" hidden>
                <div class="reader-panel-heading"><span>${svg("brightness", 18)}</span><h3>${t("readerTheme")}</h3></div>
                <div class="book-theme-options" role="group" aria-label="${t("readerTheme")}">
                  <button type="button" data-book-theme="system"><span class="book-theme-swatch theme-system"></span>${t("readerThemeSystem")}</button>
                  <button type="button" data-book-theme="light"><span class="book-theme-swatch theme-paper"></span>${t("readerThemeLight")}</button>
                  <button type="button" data-book-theme="sepia"><span class="book-theme-swatch theme-sepia"></span>${t("readerThemeSepia")}</button>
                  <button type="button" data-book-theme="dark"><span class="book-theme-swatch theme-night"></span>${t("readerThemeDark")}</button>
                </div>
              </section>
            </div>
          </div>
          <div id="reader-history" class="reader-history" hidden><button id="history-back" class="text-link" type="button" aria-label="${t("historyBack")}">${t("historyBackShort")}</button><button id="history-forward" class="text-link" type="button" aria-label="${t("historyForward")}">${t("historyForwardShort")}</button><button id="reading-return" class="secondary-button" type="button"></button><button id="reading-adopt" class="text-link" type="button">${t("continueReadingHere")}</button></div>
          <section id="book-search-panel" class="book-search-panel" aria-label="${t("searchInBook")}" hidden></section>
          <section id="translation-panel" class="book-search-panel translation-panel" aria-label="${t("selectedTextTranslation")}" hidden></section>
          <div id="reading-surface" class="reading-surface" tabindex="-1"><div id="reader-content" class="reader-content"></div></div>
          <div class="reader-bottom"><div class="reader-controls page-controls"><button id="previous-button" class="tool-button" type="button" aria-label="${t("previousPage")}">←</button><span id="chapter-label" class="chapter-label"></span><span id="position-label" class="position-label">—</span><select id="reader-toc" aria-label="${t("tableOfContents")}" hidden></select><button id="next-button" class="tool-button" type="button" aria-label="${t("nextPage")}">→</button></div><span id="save-status">${t("progressSaved")}</span></div>
        </section>
      </main>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
      <div id="note-menu" class="note-menu" hidden><button id="note-add" type="button">${t("addNote")}</button><button id="selection-copy" type="button">${t("copy")}</button><button id="selection-dictionary" type="button">${t("dictionary")}</button><button id="selection-translate" type="button">${t("translate")}</button></div>
      <div id="dictionary-panel" class="dictionary-panel" role="dialog" aria-labelledby="dictionary-word" hidden>
        <div class="dictionary-head"><div><span id="dictionary-language" class="dictionary-kicker"></span><strong id="dictionary-word"></strong></div><button id="dictionary-close" type="button" aria-label="${t("close")}">×</button></div>
        <label class="dictionary-source-control" for="dictionary-source"><span>${t("dictionarySourceLabel")}</span><select id="dictionary-source"><option value="automatic">${t("dictionaryAutomatic")}</option><option value="wiktionary">${t("dictionaryWiktionary")}</option><option value="wikipedia">${t("dictionaryWikipedia")}</option></select></label>
        <div id="dictionary-content" class="dictionary-content" role="status" aria-live="polite"></div>
        <div class="dictionary-foot"><p id="dictionary-attribution" hidden></p><a id="dictionary-source-link" target="_blank" rel="noopener noreferrer" hidden></a><nav aria-label="${t("dictionaryOtherSources")}"><span>${t("dictionaryOtherSources")}</span><a id="dictionary-wordreference" target="_blank" rel="noopener noreferrer">WordReference</a><a id="dictionary-native" target="_blank" rel="noopener noreferrer"></a></nav></div>
      </div>
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
const coverCache = new Map<string, { signature: Blob | string; url: string }>();
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
type NoteStyle = "highlight" | "underline" | "strikethrough" | "wavy";
type EpubNoteAnnotation = { color: string; type: "highlight" | "underline"; style: NoteStyle };
const noteStyleKey = "autumn-note-style";
const storedNoteStyle = localStorage.getItem(noteStyleKey);
let noteStyle: NoteStyle = storedNoteStyle === "underline" || storedNoteStyle === "strikethrough" || storedNoteStyle === "wavy" ? storedNoteStyle : "highlight";
const noteHighlights = new Map<string,EpubNoteAnnotation>();
const readerHistory = new ReaderHistory();
let pdfPosition = { page: 1, offset: 0 };
let epubPosition = { cfi: "", label: "" };
let readerJumpBusy = false;
let searchHighlight: string | undefined;
let pagePreviewActive = false;
interface PageTurn { snapshot: HTMLElement; live: HTMLElement; preview?: Rendition; previewChanged?: boolean; preloadOnly?: boolean; origin: ReaderPosition; direction: -1|1; dx: number; width: number; sequence: number; ready: Promise<void>; readySettled: boolean; failed: boolean; ending: boolean }
let pageTurn: PageTurn | undefined;
const pageTurnAnimationKey = "autumn-page-turn-animation";
let pageTurnAnimationEnabled = localStorage.getItem(pageTurnAnimationKey) !== "off";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const animatePageTurn = (): boolean => pageTurnAnimationEnabled && !reducedMotion.matches;
let globalPagePreferences = loadPagePreferences();
let desktopGeneralPreferences = loadDesktopGeneralPreferences();
let ttsPreferences: TtsPreferences = loadTtsPreferences();
let ttsVoices: TtsVoice[] = [];
let ttsState: "idle" | "playing" | "paused" = "idle";
let ttsSequence = 0;
let ttsChunks: string[] = [];
let ttsChunkIndex = 0;
let bookPageOverrides: BookPageOverrides = {};
let pagePreferences = globalPagePreferences;
let view: View = "home";
let lastCollectionView: "home" | "library" | "profile" = "home";
let books: StoredBook[] = [];
let homeCarousel: ReturnType<typeof mountBookCarousel> | undefined;
let currentBook: StoredBook | null = null;
let readerCleanup: Promise<void> = Promise.resolve();
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
let pdfZoom = 100;
let pdfNavigationBusy = false;
let pdfNavigationToken = 0;
const pdfTextCache = new Map<number, PdfTextBlock[]>();
let loadSequence = 0;
let pdfRenderSequence = 0;
let readerPositionRevision = 0;
let restoringRemotePosition = false;
let toastTimer: number | undefined;
let theme: "light" | "dark" = localStorage.getItem("autumn-theme") === "dark" ? "dark" : "light";
type BookReaderTheme = "system" | "light" | "sepia" | "dark";
let bookReaderTheme: BookReaderTheme = "system";
let readerBrightness = 100;
let bookFont = pagePreferences.font;
let layoutRevision = 0;
let layoutBusy = false;
let stableLayoutAnchor: string | null = null;
let stableLayoutPercentage: number | null = null;
let bookLayoutUI: { refresh(): void } | undefined;
let globalLayoutUI: { refresh(): void } | undefined;

const noteColors = bookColors.map(choice => choice.value);
type NoteAnchor = { format: "pdf"; page: number; y: number } | { format: "epub"; cfi: string };
let pendingNote: { quote: string; anchor: NoteAnchor } | null = null;
let editingNoteId: string | null = null;
let selectedNoteColor: string = noteColors[0];
let touchNoteTimer: number | undefined;
let confirmResolve: ((confirmed: boolean) => void) | null = null;
let confirmPreviousFocus: HTMLElement | null = null;

function titleOf(book: StoredBook): string {
  return bookDisplayTitle(book);
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
    closeReaderOptions();
    searchUI?.close(); translationUI?.close();
    hideNoteMenu();
    closeNoteDialog();
    closeAllNotes();
    $<HTMLElement>("#dictionary-panel").hidden = true;
    stopTts();
  }
  view = next;
  const shell = $<HTMLElement>(".shell");
  shell.dataset.view = next;
  if (next === "reader") { resetReaderChrome(); void refreshReaderTtsAccess(); } else window.clearTimeout(chromeTimer);
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
  applyBookReaderTheme();
  applyPageSpacing();
}

async function applyNativeGeneralSetting(key: keyof DesktopGeneralPreferences, enabled: boolean): Promise<void> {
  if (!isTauri() || isAndroid) return;
  if (key === "preventScreenBlanking") await invoke("set_prevent_screen_blanking", { enabled });
  else if (key === "launchOnStartup") await invoke("set_launch_on_startup", { enabled });
  else if (key === "minimizeToTrayOnClose") await invoke("set_tray_enabled", { enabled });
  else if (key === "autoMaximize" && enabled) await getCurrentWindow().maximize();
}

let desktopCloseListenerMounted = false;
async function mountDesktopGeneralSettings(): Promise<void> {
  const panel = document.querySelector<HTMLElement>("#settings-general-panel");
  if (!panel) return;
  const status = $<HTMLElement>("#general-settings-status");
  for (const input of panel.querySelectorAll<HTMLInputElement>("[data-general-setting]")) {
    const key = input.dataset.generalSetting as keyof DesktopGeneralPreferences;
    input.checked = desktopGeneralPreferences[key];
    input.addEventListener("change", () => {
      const previous = desktopGeneralPreferences;
      desktopGeneralPreferences = saveDesktopGeneralPreferences({ ...desktopGeneralPreferences, [key]: input.checked });
      status.textContent = "";
      input.disabled = true;
      void applyNativeGeneralSetting(key, input.checked).catch(error => {
        console.error(error);
        desktopGeneralPreferences = saveDesktopGeneralPreferences(previous);
        input.checked = previous[key];
        status.textContent = t("generalSettingFailed");
      }).finally(() => { input.disabled = false; });
    });
  }
  if (!isTauri() || isAndroid) return;
  await Promise.allSettled([
    applyNativeGeneralSetting("preventScreenBlanking", desktopGeneralPreferences.preventScreenBlanking),
    applyNativeGeneralSetting("launchOnStartup", desktopGeneralPreferences.launchOnStartup),
    applyNativeGeneralSetting("minimizeToTrayOnClose", desktopGeneralPreferences.minimizeToTrayOnClose),
    applyNativeGeneralSetting("autoMaximize", desktopGeneralPreferences.autoMaximize),
  ]);
  if (!desktopCloseListenerMounted) {
    desktopCloseListenerMounted = true;
    await getCurrentWindow().onCloseRequested(async event => {
      event.preventDefault();
      if (desktopGeneralPreferences.minimizeToTrayOnClose) {
        await invoke("set_tray_enabled", { enabled: true }).catch(() => {});
        await getCurrentWindow().hide();
        return;
      }
      await invoke("set_tray_enabled", { enabled: false }).catch(() => {});
      await invoke("exit_app").catch(async () => {
        await getCurrentWindow().destroy().catch(() => {});
      });
    });
  }
}

function readerPreferenceKey(kind: "theme" | "brightness", book = currentBook): string | null {
  if (!book) return null;
  return `autumn-reader-${kind}:${book.ownerId ?? auth.state.ownerId ?? "local"}:${book.id}`;
}

function effectiveBookReaderTheme(): Exclude<BookReaderTheme, "system"> {
  return bookReaderTheme === "system" ? theme : bookReaderTheme;
}

function bookReaderColors(): { color: string; background: string } {
  const effective = effectiveBookReaderTheme();
  return effective === "dark" ? { color: "#f1e8dc", background: "#241f1d" }
    : effective === "sepia" ? { color: "#3c2f27", background: "#f1e1c5" }
      : { color: "#342a26", background: "#fffdf8" };
}

function applyBookReaderTheme(): void {
  const effective = effectiveBookReaderTheme();
  const colors = bookReaderColors();
  $<HTMLElement>("#view-reader").dataset.bookTheme = effective;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-book-theme]")) {
    const selected = button.dataset.bookTheme === bookReaderTheme;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  readingSurface.style.background = colors.background;
  readerContent.style.background = colors.background;
  readerContent.style.color = colors.color;
  rendition?.themes.default({ body: colors });
}

function loadReaderBookAppearance(book: StoredBook): void {
  const themeKey = readerPreferenceKey("theme", book);
  const storedTheme = themeKey ? localStorage.getItem(themeKey) : null;
  bookReaderTheme = storedTheme === "light" || storedTheme === "sepia" || storedTheme === "dark" ? storedTheme : "system";
  const brightnessKey = readerPreferenceKey("brightness", book);
  const storedBrightness = Number(brightnessKey ? localStorage.getItem(brightnessKey) : "");
  readerBrightness = Number.isFinite(storedBrightness) && storedBrightness >= 55 && storedBrightness <= 130 ? storedBrightness : 100;
  const brightness = $<HTMLInputElement>("#reader-brightness");
  brightness.value = String(readerBrightness);
  $<HTMLOutputElement>("#brightness-value").textContent = `${readerBrightness}%`;
  readingSurface.style.filter = `brightness(${readerBrightness}%)`;
  applyBookReaderTheme();
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
  rendition?.themes.font(fontCss(bookFont));
}

function updateEffectivePagePreferences(): void {
  pagePreferences = resolvePagePreferences(globalPagePreferences, bookPageOverrides);
  bookFont = pagePreferences.font;
  const margins = { compact: 8, normal: 20, wide: 36 }[pagePreferences.margins];
  readerContent.style.setProperty("--reader-margin", `${margins}px`);
  applyPageSpacing(); applyBookFont();
}

function epubViewportSize(frame: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(frame);
  const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const verticalPadding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  // EPUB.js' initial 100% stage is sized against the frame's content box.
  // clientWidth/clientHeight include padding, so passing them to resize grows
  // the stage underneath the paper gutter and clips the final lines.
  return {
    width: Math.max(1, frame.clientWidth - horizontalPadding),
    height: Math.max(1, frame.clientHeight - verticalPadding),
  };
}

async function relayoutReader(): Promise<void> {
  if (view !== "reader" || !currentBook || pageTurn) return;
  const revision = ++layoutRevision;
  if (currentBook.format === "epub" && !stableLayoutAnchor) {
    stableLayoutAnchor = currentBook.cfi ?? rendition?.location?.start?.cfi ?? epubPosition.cfi;
    stableLayoutPercentage = currentBook.percentage ?? null;
  }
  const anchor = currentBook.format === "epub" ? stableLayoutAnchor ?? "" : "";
  updateEffectivePagePreferences();
  if (currentBook.format === "pdf") {
    if (pdfTextView) pdfPosition.offset = pdfTextView.visibleOffset();
    await renderPdfPage();
    return;
  }
  if (!rendition || !anchor) return;
  const frame = readerContent.querySelector<HTMLElement>(".epub-frame");
  if (!frame) return;
  const viewport = epubViewportSize(frame);
  layoutBusy = true;
  try {
    rendition.spread(columnCount(pagePreferences.columns, viewport.width, viewport.height) === 2 ? "always" : "none", 0);
    rendition.resize(viewport.width, viewport.height);
    if (revision !== layoutRevision) return;
    await rendition.display(anchor);
    if (revision !== layoutRevision) return;
    if (!readerHistory.temporary && currentBook) { currentBook.cfi = anchor; if (stableLayoutPercentage !== null) currentBook.percentage = stableLayoutPercentage; }
    renderNoteMarkers(); updatePosition();
  } finally { if (revision === layoutRevision) layoutBusy = false; }
  if (revision === layoutRevision) await persistCurrent();
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
  // Android WebView otherwise recalculates font boosting as each EPUB page is laid out.
  // An explicit scale keeps the reader typography stable between page turns.
  if (!contents.document.getElementById("autumn-text-scale")) {
    const textScaleStyle = contents.document.createElement("style");
    textScaleStyle.id = "autumn-text-scale";
    textScaleStyle.textContent = "html, body { -webkit-text-size-adjust: 100% !important; text-size-adjust: 100% !important; }";
    contents.document.head.append(textScaleStyle);
  }
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
    const signature = nativePath ?? book.cover!;
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

function renderReaderBookSummary(book: StoredBook): void {
  $<HTMLElement>("#reader-book-cover").replaceChildren(coverElement(book));
  $<HTMLElement>("#reader-book-title").textContent = titleOf(book);
  $<HTMLElement>("#reader-book-author").textContent = book.author?.trim() || t("authorUnknown");
}

function resetReaderToc(): HTMLSelectElement {
  const select = $<HTMLSelectElement>("#reader-toc");
  select.replaceChildren(new Option(t("tableOfContents"), ""));
  const empty = document.createElement("p");
  empty.className = "reader-sidebar-empty";
  empty.textContent = t("readerContentsEmpty");
  $<HTMLElement>("#reader-toc-list").replaceChildren(empty);
  return select;
}

function addReaderTocEntry(select: HTMLSelectElement, label: string, value: string, depth = 0): void {
  select.add(new Option(`${"– ".repeat(depth)}${label}`, value));
  const list = $<HTMLElement>("#reader-toc-list");
  if (list.querySelector(".reader-sidebar-empty")) list.replaceChildren();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "reader-toc-entry";
  button.style.setProperty("--toc-depth", String(Math.min(depth, 5)));
  button.textContent = label;
  button.addEventListener("click", () => {
    void (currentBook?.format === "pdf" ? jumpToPdfReference(pdfOutlineDestinations.get(value)) : jumpToContents(value))
      .catch(error => showToast(errorMessage(error)));
  });
  list.append(button);
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
  recentList.replaceChildren(...(recent.length ? recent.map((book) => presentationCard(book, coverElement, (item) => void openBook(item), false)) : [emptyState(t("homeReadingEmpty"))]));
  homeCarousel?.update();

  const heroAction = $<HTMLButtonElement>("#hero-action");
  const featured = recent[0];
  $<HTMLElement>("#home-hero").classList.toggle("hero-empty", !featured);
  $<HTMLElement>("#hero-eyebrow").textContent = featured ? t("continueReading") : t("welcome");
  $<HTMLElement>("#hero-title").textContent = featured ? titleOf(featured) : t(books.length ? "homeHeroNoCurrentTitle" : "homeHeroEmptyTitle");
  $<HTMLElement>("#hero-author").textContent = featured ? featured.author?.trim() || t("authorUnknown") : "";
  $<HTMLElement>("#hero-description").textContent = featured ? "" : t(books.length ? "homeHeroNoCurrentDescription" : "homeHeroEmptyDescription");
  const art = $<HTMLElement>("#hero-art");
  art.replaceChildren();
  if (featured) art.append(coverElement(featured));
  else { const leaf = document.createElement("img"); leaf.src = leafUrl; leaf.alt = ""; art.append(leaf); }
  heroAction.querySelector("span")!.textContent = featured ? t("continueReading") : t("exploreLibrary");
  heroAction.onclick = () => featured ? void openBook(featured) : setView("library");

  $<HTMLElement>("#library-count-line").textContent = countText(books.length, "savedBook", "savedBooks");
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
    await deleteBook(book.id, { permanent: desktopGeneralPreferences.disableTrashBin });
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
  $<HTMLSpanElement>("#chapter-label").textContent = currentBook.format === "epub" && rendition?.location?.start
    ? t("section", { number: rendition.location.start.index + 1 }) : "";
  $<HTMLButtonElement>("#previous-button").disabled = Boolean(pageTurn) || pdfNavigationBusy || (currentBook.format === "pdf" && pdfPosition.page <= 1 && (!pdfTextView || pdfTextView.index === 0));
  $<HTMLButtonElement>("#next-button").disabled = Boolean(pageTurn) || pdfNavigationBusy || (currentBook.format === "pdf" && pdfPosition.page >= (pdfDocument?.numPages ?? Infinity) && (!pdfTextView || pdfTextView.index === pdfTextView.count - 1));
  const originalPdf = currentBook.format === "pdf" && !pdfTextView;
  $<HTMLButtonElement>("#smaller-button").disabled = pdfNavigationBusy || (originalPdf ? pdfZoom <= 70 : currentBook.fontSize <= 70);
  $<HTMLButtonElement>("#larger-button").disabled = pdfNavigationBusy || (originalPdf ? pdfZoom >= 200 : currentBook.fontSize >= 180);
  $<HTMLSpanElement>("#size-label").textContent = originalPdf ? t("zoom") : t("text");
  $<HTMLSpanElement>("#size-value").textContent = `${originalPdf ? pdfZoom : currentBook.fontSize}%`;
  $<HTMLElement>(".size-controls").hidden = false;
  $<HTMLElement>("#book-layout-details").hidden = currentBook.format !== "epub";
  const mode = $<HTMLSelectElement>("#pdf-reading-mode");
  mode.hidden = currentBook.format !== "pdf";
  mode.value = pdfTextView ? "text" : "original";
  mode.options[0].disabled = currentBook.format === "pdf" && pdfTextCache.get(pdfPosition.page)?.length === 0;
  mode.title = mode.options[0].disabled ? t("pdfImagePage") : t("readingMode");
  if (!$("#speech-panel").hasAttribute("hidden")) updateTtsPlayer();
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
    : { format: "epub", ...epubPosition, cfi: stableLayoutAnchor ?? epubPosition.cfi };
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
  document.querySelectorAll<HTMLButtonElement>(".reader-toc-entry").forEach(button => { button.disabled = readerJumpBusy; });
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
  stableLayoutAnchor = null; stableLayoutPercentage = null;
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
  const count = String(currentBook?.notes?.length ?? 0);
  $<HTMLSpanElement>("#notes-count").textContent = count;
  $<HTMLSpanElement>("#sidebar-notes-count").textContent = count;
  renderSidebarNotes();
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

function sortedCurrentNotes(): BookNote[] {
  return [...(currentBook?.notes ?? [])].sort((a, b) => {
    if (a.format === "pdf" && b.format === "pdf") return a.page - b.page || a.y - b.y || a.createdAt - b.createdAt;
    if (a.format === "epub" && b.format === "epub") return (epubNoteSection(a) ?? 0) - (epubNoteSection(b) ?? 0) || a.createdAt - b.createdAt;
    return a.createdAt - b.createdAt;
  });
}

function noteEntry(note: BookNote, compact = false): HTMLElement {
  const card = document.createElement("article");
  card.className = compact ? "notes-entry reader-sidebar-note" : "notes-entry";
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
}

function renderNotesList(list: HTMLElement, compact = false): void {
  const notes = sortedCurrentNotes();
  if (!notes.length) {
    const empty = document.createElement("p");
    empty.className = compact ? "reader-sidebar-empty" : "notes-empty";
    empty.textContent = compact ? t("readerNotesEmpty") : t("notesEmpty");
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...notes.map(note => noteEntry(note, compact)));
}

function renderSidebarNotes(): void {
  renderNotesList($<HTMLDivElement>("#reader-sidebar-notes-list"), true);
}

function renderAllNotes(): void {
  renderNotesList($<HTMLDivElement>("#all-notes-list"));
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
    for(const [cfi,annotation]of noteHighlights) if(active.get(cfi)!==annotation.color||annotation.style!==noteStyle){rendition.annotations.remove(cfi,annotation.type);noteHighlights.delete(cfi);}
    for(const [cfi,color]of active)if(!noteHighlights.has(cfi)){
      if(noteStyle==="highlight")rendition.annotations.highlight(cfi,{},undefined,"autumn-note-highlight",{fill:color,"fill-opacity":".22"});
      else rendition.annotations.underline(cfi,{},undefined,`autumn-note-${noteStyle}`,{"stroke-opacity":"1"});
      noteHighlights.set(cfi,{color,type:noteStyle==="highlight"?"highlight":"underline",style:noteStyle});
    }
    for(const annotation of readerContent.querySelectorAll<SVGGElement>("g[ref^='autumn-note-']")){
      const color=hexColor(active.get(annotation.dataset.epubcfi??"")??"")??noteColors[0];
      for(const line of annotation.querySelectorAll<SVGLineElement>("line")){
        line.setAttribute("stroke",color);line.setAttribute("stroke-width","1.6");line.setAttribute("stroke-linecap","round");
        const rect=line.previousElementSibling as SVGRectElement|null;
        if(noteStyle==="strikethrough"&&rect){const y=Number(rect.getAttribute("y"))+Number(rect.getAttribute("height"))*.52;line.setAttribute("y1",String(y));line.setAttribute("y2",String(y));}
        if(noteStyle==="wavy"){
          const x1=Number(line.getAttribute("x1")),x2=Number(line.getAttribute("x2")),y=Number(line.getAttribute("y1"));
          let d=`M ${x1} ${y}`;
          for(let x=x1;x<x2;x+=6){const middle=Math.min(x+3,x2),end=Math.min(x+6,x2);d+=` Q ${x+1.5} ${y-1.7} ${middle} ${y} Q ${middle+1.5} ${y+1.7} ${end} ${y}`;}
          const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",d);path.setAttribute("fill","none");path.setAttribute("stroke",color);path.setAttribute("stroke-width","1.5");path.setAttribute("stroke-linecap","round");line.replaceWith(path);
        }
      }
    }
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
        const highlight=document.createElement("span");highlight.className="note-highlight";highlight.dataset.noteStyle=noteStyle;highlight.style.setProperty("--note-color",hexColor(note.color)??noteColors[0]);highlight.style.left=`${highlightRect.left-contentRect.left}px`;highlight.style.top=`${highlightRect.top-contentRect.top}px`;highlight.style.width=`${highlightRect.width}px`;highlight.style.height=`${highlightRect.height}px`;readerContent.append(highlight);
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
  const compactMarkers = window.matchMedia("(max-width: 600px), (pointer: coarse)").matches;
  let lastY = -100;
  for (const placement of placements) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "note-marker";
    marker.style.setProperty("--note-marker-color", placement.note.color);
    const y = Math.max(8, placement.y - (compactMarkers ? 22 : 10), lastY + (compactMarkers ? 48 : 24));
    marker.style.top = `${y}px`;
    lastY = y;
    marker.title = t("openNote");
    marker.setAttribute("aria-label", t("openNoteQuote", { quote: placement.note.quote }));
    marker.addEventListener("click", () => openNoteDialog(placement.note));
    readerContent.append(marker);
    const rightInset = compactMarkers ? 2 : 8;
    marker.style.left = `${Math.max(0, Math.min(placement.x, readerContent.clientWidth - marker.offsetWidth - rightInset))}px`;
  }
}

async function clearReader(): Promise<void> {
  stopTts();
  translationUI?.close(); selectedTranslationText=""; noteHighlights.clear();
  ++pdfNavigationToken; pdfNavigationBusy = false;
  pageTurn?.snapshot.remove(); pageTurn?.preview?.destroy(); if(pageTurn?.live !== readerContent)pageTurn?.live.remove(); pageTurn = undefined; pagePreviewActive = false; resetPageTransform();
  searchUI?.close(); searchUI?.setSource(); readerHistory.commit(); updateHistory();
  searchHighlight = undefined; $("#reader-toc").hidden = true; resetReaderToc(); pdfOutlineDestinations.clear();
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
  // Measure with the same PDF padding on the first render and every rerender.
  readerContent.classList.add("pdf-content");
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
    readerContent.replaceChildren(sheet);
    pdfTextView = new PdfTextView(sheet, blocks, 18 * currentBook.fontSize / 100, fontCss(bookFont), pagePreferences);
    pdfTextView.show(pdfPosition.offset === 1 ? pdfTextView.count - 1 : pdfTextView.pageForOffset(pdfPosition.offset ?? 0));
    readingSurface.scrollTop = 0;
    readingSurface.scrollLeft = 0;
    bindPdfSelection(pdfTextView.flow, sheet);
    renderNoteMarkers();
    updatePosition();
    return;
  }
  const fitScale = Math.min(availableWidth / natural.width, availableHeight / natural.height) * pdfZoom / 100;
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
  try {
    assertBookOwner(book);
    if (!books.some(item => item.id === book.id && item.ownerId === book.ownerId)) throw new Error(t("bookOtherAccount"));
  } catch (error) { showToast(errorMessage(error)); setView("library"); return; }
  const sequence = ++loadSequence;
  const positionRevision = ++readerPositionRevision;
  const baselinePosition = { page: book.page, cfi: book.cfi, percentage: book.percentage, pdfTextOffset: book.pdfTextOffset, fontSize: book.fontSize };
  await readerCleanup;
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
  stableLayoutAnchor = null; stableLayoutPercentage = null;
  bookPageOverrides = loadBookPageOverrides(book.ownerId ?? auth.state.ownerId ?? "local", book.id);
  updateEffectivePagePreferences();
  loadReaderBookAppearance(book);
  renderReaderBookSummary(book);
  setReaderSidebarTab("contents");
  resetReaderToc();
  bookLayoutUI?.refresh();
  pdfReadingMode = localStorage.getItem(`autumn-pdf-mode-${book.id}`) === "original" ? "original" : "text";
  pdfZoom = Number(localStorage.getItem(`autumn-pdf-zoom-${book.id}`)) || 100;
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
      const outline = await pdfDocument.getOutline(), toc = resetReaderToc();
      const addOutline = (items: NonNullable<typeof outline>, depth = 0): void => {
        if (depth > 8) return;
        for (const item of items) {
          if (pdfOutlineDestinations.size >= 1000) return;
          if (item.dest) { const id = `pdf:${pdfOutlineDestinations.size}`; pdfOutlineDestinations.set(id, item.dest); addReaderTocEntry(toc, item.title, id, depth); }
          if (item.items) addOutline(item.items, depth + 1);
        }
      };
      addOutline(outline ?? []); toc.hidden = toc.options.length <= 1;
    } else {
      const frame = document.createElement("div");
      frame.className = "epub-frame";
      readerContent.replaceChildren(frame);
      epubBook = ePub(buffer);
      const viewport = epubViewportSize(frame);
      rendition = epubBook.renderTo(frame, { width: "100%", height: "100%", flow: "paginated", spread: columnCount(pagePreferences.columns, viewport.width, viewport.height) === 2 ? "always" : "none" });
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
        contents.document.addEventListener("wheel", handleReaderWheel, { passive: false });
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
        if (!readerHistory.temporary && !pagePreviewActive && !readerJumpBusy && !layoutBusy && !stableLayoutAnchor) book.cfi = location.start.cfi;
        if (!readerHistory.temporary && !pagePreviewActive && !readerJumpBusy && !layoutBusy && !stableLayoutAnchor) book.percentage = epubReadingPercentage(location);
        if (!pagePreviewActive && !readerJumpBusy && !layoutBusy) readerHistory.observe(capturePosition()); updateHistory();
        updatePosition();
        if (!layoutBusy) void persistCurrent();
        window.requestAnimationFrame(renderNoteMarkers);
      });
      await rendition.display(book.cfi || undefined);
      searchUI?.setSource(epubSearch(epubBook));
      const navigation = await epubBook.loaded.navigation;
      const toc = resetReaderToc();
      const addToc = (entries: typeof navigation.toc, depth = 0): void => { for (const entry of entries) { addReaderTocEntry(toc, entry.label.trim(), entry.href, depth); if (entry.subitems) addToc(entry.subitems, depth + 1); } };
      addToc(navigation.toc); toc.hidden = toc.options.length <= 1;
      window.requestAnimationFrame(renderNoteMarkers);
    }
    await persistCurrent();
    updatePosition();
    renderSidebarNotes();
    if (book.contentMetadataVersion !== 1) void refreshBookContent(book);
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

async function refreshBookContent(book: StoredBook): Promise<void> {
  const owner = book.ownerId;
  try {
    const updated = await ensureBookContentMetadata(book);
    if (auth.state.ownerId !== owner) return;
    const visible = books.find(item => item.id === book.id);
    if (!visible || updated.contentMetadataVersion !== 1) return;
    Object.assign(visible, updated);
    if (currentBook?.id === visible.id) { Object.assign(currentBook, updated); renderReaderBookSummary(currentBook); }
    const openMenu = view === "library" ? document.querySelector<HTMLDetailsElement>(".book-menu[open]") : null;
    if (openMenu) {
      // Keep an open administration menu attached while background extraction finishes.
      for (const card of document.querySelectorAll<HTMLElement>(".library-book-card[data-book-id]")) {
        if (card.dataset.bookId !== visible.id) continue;
        const title = titleOf(visible);
        const titleButton = card.querySelector<HTMLElement>(".book-title");
        if (titleButton) titleButton.textContent = title;
        const author = card.querySelector<HTMLElement>(".library-book-author");
        if (author) author.textContent = visible.author?.trim() || t("authorUnknown");
        const coverButton = card.querySelector<HTMLElement>(".cover-button");
        if (coverButton) coverButton.replaceChildren(coverElement(visible));
      }
      if (!deferredContentMenus.has(openMenu)) {
        deferredContentMenus.add(openMenu);
        const whenClosed = () => {
          if (openMenu.open) return;
          openMenu.removeEventListener("toggle", whenClosed);
          deferredContentMenus.delete(openMenu);
          if (auth.state.ownerId === owner) renderCollections();
        };
        openMenu.addEventListener("toggle", whenClosed);
      }
    } else renderCollections();
    window.dispatchEvent(new Event("autumn-local-change"));
  } catch (error) {
    if (import.meta.env.DEV) console.info("[BOOK METADATA] repair deferred", error);
  }
}
const deferredContentMenus = new WeakSet<HTMLDetailsElement>();

async function importFiles(files: FileList): Promise<void> {
  let first: StoredBook | null = null;
  const importOwner = auth.state.ownerId;
  if (!importOwner) return;
  const selection = platformFilePicker.selected(files);
  let rejected = selection.rejected;
  let duplicates = 0, imported = 0;
  const importedRefs = new Map<string, StoredBook>();
  for (const file of selection.accepted) {
    const book: StoredBook = {
      id: newId(), name: file.name, format: file.format, data: file.blob,
      addedAt: Date.now(), lastOpenedAt: 0, favorite: false,
      ownerId: importOwner ?? undefined,
      page: 1, cfi: null, fontSize: 100,
    };
    try {
      const result = await importUniqueBook(book);
      if (auth.state.ownerId !== importOwner) return;
      if (!result.imported) { duplicates++; continue; }
      imported++;
      importedRefs.set(book.id, book);
      books.unshift(book);
      first ??= book;
      void refreshBookContent(book);
    } catch { rejected++; }
  }
  if (auth.state.ownerId !== importOwner) return;
  const loaded = await listBooks(importOwner);
  if (auth.state.ownerId !== importOwner) return;
  books = loaded.map(book => importedRefs.get(book.id) ?? book);
  renderCollections();
  if (first) await openBook(first);
  if (duplicates) showToast(imported
    ? t(imported === 1 ? "importSummaryOne" : "importSummary", { imported, duplicates })
    : t("bookAlreadyInLibrary"));
  if (rejected) showToast(countText(rejected, "filesRejectedOne", "filesRejectedMany"));
}

async function navigate(direction: -1 | 1, preview = false): Promise<void> {
  if (!currentBook || view !== "reader" || readerJumpBusy || (pageTurn && !preview)) return;
  clearSearchHighlight();
  ++readerPositionRevision; restoringRemotePosition = false;
  if (currentBook.format === "pdf" && pdfDocument) {
    if (pdfNavigationBusy) return;
    const navigationToken = ++pdfNavigationToken;
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
        if (navigationToken === pdfNavigationToken) await persistCurrent();
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
      if (navigationToken === pdfNavigationToken) await persistCurrent();
    } finally {
      if (navigationToken === pdfNavigationToken) { pdfNavigationBusy = false; updatePosition(); }
    }
  } else if (rendition) {
    stableLayoutAnchor = null; stableLayoutPercentage = null;
    await (direction < 0 ? rendition.prev() : rendition.next());
  }
}

function resetPageTransform(): void {
  readerContent.getAnimations().forEach(animation => animation.cancel());
  readerContent.style.transform = ""; readerContent.style.visibility = ""; readerContent.style.willChange = "";
  readerContent.classList.remove("page-turn-sheet"); delete readerContent.dataset.turnDirection;
  readingSurface.classList.remove("page-turning");
}
function beginPageTurn(direction: -1|1, preloadOnly = false): void {
  if (pageTurn || !currentBook) return;
  const snapshot = epubBook ? document.createElement("div") : pageSnapshot(readerContent, readingSurface);
  if (epubBook) { snapshot.className="page-turn-snapshot"; snapshot.style.visibility="hidden"; snapshot.setAttribute("aria-hidden","true"); readingSurface.append(snapshot); }
  const sheet = epubBook ? readerContent : snapshot;
  if (!preloadOnly) { sheet.classList.add("page-turn-sheet"); sheet.dataset.turnDirection=String(direction); }
  const turn: PageTurn = { snapshot, live: readerContent, preloadOnly, origin: capturePosition(), direction, dx: 0, width: readingSurface.clientWidth, sequence: loadSequence, ready: Promise.resolve(), readySettled: false, failed: false, ending: false };
  pageTurn = turn; pagePreviewActive = true;
  $<HTMLButtonElement>("#previous-button").disabled = true;
  $<HTMLButtonElement>("#next-button").disabled = true;
  if (!preloadOnly) { readingSurface.classList.add("page-turning"); readerContent.style.willChange = "transform"; }
  if (epubBook && rendition && turn.origin.format === "epub") {
    // Keep the touched iframe mounted across chapter boundaries. This temporary
    // rendition shares the opened book/archive, rather than loading another file.
    const adjacent = readerContent.cloneNode(false) as HTMLElement; adjacent.removeAttribute("id"); adjacent.setAttribute("aria-hidden","true"); adjacent.classList.remove("page-turn-sheet"); delete adjacent.dataset.turnDirection;
    adjacent.classList.add("page-turn-preview"); const rect = readerContent.getBoundingClientRect(), bounds = readingSurface.getBoundingClientRect();
    adjacent.style.cssText = `position:absolute;left:${rect.left-bounds.left}px;top:${rect.top-bounds.top}px;width:${rect.width}px;height:${rect.height}px;min-height:0;z-index:4;pointer-events:none;will-change:transform`;
    const frame = document.createElement("div"); frame.className="epub-frame"; adjacent.append(frame); readingSurface.append(adjacent); turn.live=adjacent;
    const viewport = epubViewportSize(frame);
    const preview = epubBook.renderTo(frame,{width:"100%",height:"100%",flow:"paginated",spread:columnCount(pagePreferences.columns,viewport.width,viewport.height)===2?"always":"none"}); epubBook.rendition=rendition; turn.preview=preview;
    preview.hooks.content.register((contents: Contents)=>standardizeEpubPage(contents));
    preview.themes.fontSize(`${currentBook.fontSize}%`); preview.themes.font(fontCss(bookFont));
    const previewColors = bookReaderColors();
    adjacent.style.background = previewColors.background; frame.style.background = previewColors.background;
    preview.themes.default({ body: previewColors });
    adjacent.style.visibility="hidden";adjacent.style.transform=`translate3d(${direction*turn.width}px,0,0)`;
    turn.ready=(async()=>{await preview.display((turn.origin as Extract<ReaderPosition,{format:"epub"}>).cfi);const before=await preview.currentLocation() as unknown as Location;await(direction<0?preview.prev():preview.next());const after=await preview.currentLocation() as unknown as Location;turn.previewChanged=before?.start.cfi!==after?.start.cfi;})();
  } else {
    readerContent.style.visibility = "hidden"; readerContent.style.transform = `translate3d(${direction * turn.width}px,0,0)`;
    turn.ready = navigate(direction, true);
  }
  turn.ready = turn.ready.then(() => {
    turn.readySettled = true;
    if (pageTurn !== turn) return;
    if (!turn.preloadOnly) {
      readerContent.style.visibility = "";
      turn.live.style.visibility="";turn.live.dataset.ready="true";
      dragPageTurn(turn.dx);
    }
  }).catch(error => { turn.readySettled = true; turn.failed = true; if(pageTurn === turn)showToast(errorMessage(error)); });
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
  let completed = false;
  try {
    // A dropped touchend, stalled PDF render or a suspended WebView must never
    // leave the sheet and overflow lock mounted indefinitely.
    if (commit && !turn.readySettled) {
      let timeout: number | undefined;
      const ready = await Promise.race([
        turn.ready.then(() => true),
        new Promise<false>(resolve => { timeout = window.setTimeout(() => resolve(false), 5000); }),
      ]);
      window.clearTimeout(timeout);
      if (!ready) commit = false;
    }
    if (pageTurn !== turn || turn.sequence !== loadSequence) return;
    if (turn.failed || !turn.readySettled) commit = false;
    if (turn.preloadOnly && commit) {
      turn.preloadOnly = false;
      readingSurface.classList.add("page-turning");
      readerContent.classList.add("page-turn-sheet"); readerContent.dataset.turnDirection = String(direction);
      readerContent.style.willChange = "transform";
      turn.live.style.visibility = ""; turn.live.dataset.ready = "true";
    }
    const position = capturePosition();
    const changed = position.format === "pdf" && turn.origin.format === "pdf" ? position.page !== turn.origin.page || Math.abs(position.offset-turn.origin.offset) > .0001 : position.format === "epub" && turn.origin.format === "epub" && position.cfi !== turn.origin.cfi;
    commit &&= direction === turn.direction && (turn.preview ? Boolean(turn.previewChanged) : changed);
    const duration = turn.readySettled && animatePageTurn() && (commit || Math.abs(turn.dx) > 4) ? 360 : 0;
    await Promise.all([slide(turn.snapshot, commit ? -turn.direction * turn.width : 0, duration,turn.preview?undefined:{width:turn.width,direction:turn.direction}), slide(turn.live, commit ? 0 : turn.direction * turn.width, duration), ...(turn.preview ? [slide(readerContent,commit ? -turn.direction * turn.width : 0,duration,{width:turn.width,direction:turn.direction})] : [])]);
    if (pageTurn !== turn) return;
    if (turn.preview && commit) { readerContent.style.transform=""; await navigate(turn.direction,true); }
    completed = commit;
  } catch (error) {
    if (pageTurn === turn) showToast(errorMessage(error));
  } finally {
    if (pageTurn === turn) {
      turn.snapshot.remove();
      try { turn.preview?.destroy(); } catch (error) { console.warn("Page preview cleanup failed", error); }
      if(turn.live!==readerContent)turn.live.remove(); pageTurn = undefined; pagePreviewActive = false; resetPageTransform();
      const origin = turn.origin;
      if (!completed && origin.format === "pdf" && currentBook?.format === "pdf" && turn.sequence === loadSequence) {
        // Starting a fresh render invalidates any PDF.js work still running for
        // the adjacent page. Keep the saved reading position on cancellation.
        ++pdfNavigationToken; pdfNavigationBusy = false;
        pdfPosition = { page: origin.page, offset: origin.offset };
        const restoration = renderPdfPage(), restorationSequence = pdfRenderSequence;
        void restoration.then(() => {
          if (currentBook?.format === "pdf" && !pageTurn && turn.sequence === loadSequence && restorationSequence === pdfRenderSequence) {
            readingSurface.scrollTop = origin.scrollTop;
            readingSurface.scrollLeft = origin.scrollLeft;
          }
        }).catch(error => showToast(errorMessage(error)));
      }
      if (completed) {
        if (currentBook?.format === "epub" && !readerHistory.temporary) {
          stableLayoutAnchor = null; stableLayoutPercentage = null;
          currentBook.cfi = epubPosition.cfi;
          const location = rendition?.location;
          if (location) currentBook.percentage = epubReadingPercentage(location);
        }
      }
      updatePosition(); renderNoteMarkers();
      if (completed) {
        await persistCurrent();
      }
    }
  }
}
async function turnPage(direction: -1|1): Promise<void> {
  if (!animatePageTurn()) { await navigate(direction); return; }
  if (!currentBook || view!=="reader" || pageTurn || readerJumpBusy || pdfNavigationBusy) return;
  beginPageTurn(direction);
  if (pageTurn) await endPageTurn(true,direction);
}
let chromeTimer: number | undefined;
function resetReaderChrome(): void {
  if (!isAndroid && !window.matchMedia("(pointer: coarse)").matches) return;
  const readerView = $<HTMLElement>("#view-reader");
  const wasHidden = readerView.classList.contains("controls-hidden");
  readerView.classList.remove("controls-hidden");
  window.clearTimeout(chromeTimer);
  if (view === "reader") chromeTimer = window.setTimeout(() => {
    if (view !== "reader" || pageTurn || readerJumpBusy || readerOptions.classList.contains("is-open") ||
      !$<HTMLDivElement>("#note-menu").hidden || !$<HTMLDivElement>("#note-dialog").hidden ||
      !$<HTMLDivElement>("#all-notes-dialog").hidden || searchUI?.opened || translationUI?.opened ||
      window.getSelection()?.isCollapsed === false) { resetReaderChrome(); return; }
    $<HTMLElement>("#view-reader").classList.add("controls-hidden");
    void relayoutReader();
  }, 6000);
  if (wasHidden) void relayoutReader();
}
function addTapNavigation(target: Document | HTMLElement, getSelection: () => Selection | null): void {
  const discrete = window.matchMedia("(pointer: coarse)").matches;
  bindPageGestures(target, getSelection, {
    discrete,
    blocked: ownGesture => view !== "reader" || !currentBook || readerJumpBusy || pdfNavigationBusy || Boolean(pageTurn && !ownGesture) || !$("#note-dialog").hidden || !$("#all-notes-dialog").hidden || !$("#note-menu").hidden || Boolean(searchUI?.opened) || Boolean(translationUI?.opened),
    start: direction => { if (animatePageTurn() && (!discrete || currentBook?.format === "epub")) beginPageTurn(direction, discrete); },
    drag: dx => { if (pageTurn) dragPageTurn(dx); },
    end: (commit, direction) => {
      if (discrete) { if (pageTurn) void endPageTurn(commit, direction); else if (commit) void turnPage(direction); return; }
      if (pageTurn) void endPageTurn(commit,direction); else if (commit) void navigate(direction);
    },
    tap: direction => { resetReaderChrome(); void turnPage(direction); },
    neutralTap: () => resetReaderChrome(),
  });
}

addTapNavigation(readingSurface, () => window.getSelection());

// Desktop mouse wheel page navigation. EPUB content is rendered inside an iframe,
// so attach the same handler to the outer surface and each EPUB document.
let readerWheelLocked = false;
let readerWheelUnlockTimer: number | undefined;
function handleReaderWheel(event: WheelEvent): void {
  if (view !== "reader" || !currentBook || readerJumpBusy || pdfNavigationBusy || pageTurn) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  if (Math.abs(event.deltaY) < 4) return;
  event.preventDefault();
  if (readerWheelLocked) return;
  readerWheelLocked = true;
  window.clearTimeout(readerWheelUnlockTimer);
  void turnPage(event.deltaY > 0 ? 1 : -1);
  readerWheelUnlockTimer = window.setTimeout(() => { readerWheelLocked = false; }, 320);
}
readingSurface.addEventListener("wheel", handleReaderWheel, { passive: false });

function changeSize(direction: -1 | 1): void {
  if (!currentBook) return;
  ++readerPositionRevision; restoringRemotePosition = false;
  if (currentBook.format === "pdf" && !pdfTextView) {
    pdfZoom = Math.max(70, Math.min(200, pdfZoom + direction * 10));
    localStorage.setItem(`autumn-pdf-zoom-${currentBook.id}`, String(pdfZoom));
    void renderPdfPage(); updatePosition(); return;
  }
  currentBook.fontSize = Math.max(70, Math.min(180, currentBook.fontSize + direction * 10));
  if (currentBook.format === "pdf") {
    if (!pdfTextView) return;
    pdfPosition.offset = pdfTextView.visibleOffset();
    void renderPdfPage().then(persistCurrent);
  } else if (rendition) {
    rendition.themes.fontSize(`${currentBook.fontSize}%`);
    void relayoutReader().then(persistCurrent);
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
// External file drops share the same import service as the picker/Android SAF.
const libraryView = $("#view-library");
libraryView.addEventListener("dragover", event => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
libraryView.addEventListener("drop", event => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  void importFiles(event.dataTransfer.files);
});
homeCarousel = mountBookCarousel($<HTMLDivElement>("#recent-list"), $<HTMLButtonElement>("#recent-previous"), $<HTMLButtonElement>("#recent-next"));
const readerOptions = $<HTMLDivElement>("#reader-options");
const readerOptionTriggers = [...document.querySelectorAll<HTMLButtonElement>("[data-reader-options-trigger]")];
const desktopReaderMedia = window.matchMedia("(min-width: 901px) and (pointer: fine)");
let activeReaderOptionsTrigger: HTMLButtonElement | null = null;
let readerOptionsHistory = false;
type ReaderSidebarTab = "contents" | "notes" | "tts";
let activeReaderSidebarTab: ReaderSidebarTab = "contents";

function placeSpeechPanel(): void {
  const panel = $<HTMLElement>("#speech-panel");
  const destination = desktopReaderMedia.matches ? $<HTMLElement>("#reader-sidebar-tts-body") : readerOptions;
  if (panel.parentElement !== destination) destination.append(panel);
}

function setReaderSidebarTab(tab: ReaderSidebarTab): void {
  if (tab === "tts" && $<HTMLButtonElement>("#reader-tts-tab").hidden) tab = "contents";
  closeReaderOptions();
  searchUI?.close();
  translationUI?.close();
  activeReaderSidebarTab = tab;
  for (const name of ["contents", "notes", "tts"] as const) {
    const button = $<HTMLButtonElement>(`#reader-${name}-tab`);
    const selected = name === tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $<HTMLElement>(`#reader-sidebar-${name}`).hidden = !selected;
  }
  if (tab === "notes") renderSidebarNotes();
  if (tab === "tts") {
    placeSpeechPanel();
    $<HTMLElement>("#speech-panel").hidden = false;
    updateTtsPlayer();
    void refreshTtsVoices(false);
  } else if (desktopReaderMedia.matches) $<HTMLElement>("#speech-panel").hidden = true;
}

function showDesktopSettingsTab(tab: "layout" | "appearance"): void {
  const layout = tab === "layout";
  $<HTMLButtonElement>("#reader-settings-layout-tab").setAttribute("aria-selected", String(layout));
  $<HTMLButtonElement>("#reader-settings-appearance-tab").setAttribute("aria-selected", String(!layout));
  $<HTMLElement>("#layout-panel").hidden = !layout;
  $<HTMLElement>("#brightness-panel").hidden = layout;
  $<HTMLElement>("#size-panel").hidden = layout;
  $<HTMLElement>("#book-theme-panel").hidden = layout;
}

function openDesktopReaderSettings(tab: "layout" | "appearance" = "appearance"): void {
  if (readerOptions.classList.contains("is-open") && activeReaderOptionsTrigger === $<HTMLButtonElement>("#reader-settings-toggle")) {
    closeReaderOptions();
    return;
  }
  if (!desktopReaderMedia.matches) return;
  searchUI?.close();
  translationUI?.close();
  placeSpeechPanel();
  showDesktopSettingsTab(tab);
  readerOptions.hidden = false;
  readerOptions.classList.add("is-open", "desktop-settings-open");
  const trigger = $<HTMLButtonElement>("#reader-settings-toggle");
  trigger.setAttribute("aria-expanded", "true");
  activeReaderOptionsTrigger = trigger;
  if (!readerOptionsHistory) {
    history.pushState({ ...history.state, autumnReaderOptions: true }, "");
    readerOptionsHistory = true;
  }
}

async function refreshReaderTtsAccess(): Promise<void> {
  const trigger = $<HTMLButtonElement>("#speech-toggle");
  const sidebarTrigger = $<HTMLButtonElement>("#reader-tts-tab");
  let allowed = false;
  try {
    allowed = ttsAvailable() && auth.state.status === "authenticated" && (await plans.current()).premium_tts_tier !== "none";
  } catch { allowed = false; }
  trigger.hidden = !allowed;
  sidebarTrigger.hidden = !allowed;
  if (!allowed && activeReaderSidebarTab === "tts") setReaderSidebarTab("contents");
  if (!allowed && activeReaderOptionsTrigger === trigger) closeReaderOptions();
}
function closeReaderOptions(fromHistory = false): void {
  if (!readerOptions.classList.contains("is-open")) return;
  readerOptions.classList.remove("is-open");
  readerOptions.classList.remove("desktop-settings-open");
  readerOptions.hidden = true;
  for (const trigger of readerOptionTriggers) trigger.setAttribute("aria-expanded", "false");
  $<HTMLButtonElement>("#reader-settings-toggle").setAttribute("aria-expanded", "false");
  readerOptions.querySelectorAll<HTMLElement>(".reader-option-panel").forEach(panel => { panel.hidden = true; });
  activeReaderOptionsTrigger = null;
  if (readerOptionsHistory) {
    readerOptionsHistory = false;
    if (!fromHistory && history.state?.autumnReaderOptions) history.back();
  }
}
function openReaderOptions(trigger: HTMLButtonElement): void {
  placeSpeechPanel();
  const panelId = trigger.getAttribute("aria-controls");
  if (!panelId) return;
  if (activeReaderOptionsTrigger === trigger && readerOptions.classList.contains("is-open")) { closeReaderOptions(); return; }
  const wasOpen = readerOptions.classList.contains("is-open");
  for (const button of readerOptionTriggers) button.setAttribute("aria-expanded", String(button === trigger));
  readerOptions.querySelectorAll<HTMLElement>(".reader-option-panel").forEach(panel => { panel.hidden = panel.id !== panelId; });
  readerOptions.hidden = false;
  readerOptions.classList.remove("desktop-settings-open");
  readerOptions.classList.add("is-open");
  activeReaderOptionsTrigger = trigger;
  if (panelId === "speech-panel") {
    updateTtsPlayer();
    void refreshTtsVoices(false);
  }
  if (!wasOpen) {
    history.pushState({ ...history.state, autumnReaderOptions: true }, "");
    readerOptionsHistory = true;
  }
  resetReaderChrome();
}
for (const trigger of readerOptionTriggers) trigger.addEventListener("click", () => openReaderOptions(trigger));
$<HTMLButtonElement>("#reader-settings-toggle").addEventListener("click", () => openDesktopReaderSettings());
$<HTMLButtonElement>("#reader-settings-layout-tab").addEventListener("click", () => showDesktopSettingsTab("layout"));
$<HTMLButtonElement>("#reader-settings-appearance-tab").addEventListener("click", () => showDesktopSettingsTab("appearance"));
const readerSidebarTabs = (["contents", "notes", "tts"] as const).map(name => $<HTMLButtonElement>(`#reader-${name}-tab`));
readerSidebarTabs.forEach((button, index) => {
  button.addEventListener("click", () => setReaderSidebarTab((["contents", "notes", "tts"] as const)[index]));
  button.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const visible = readerSidebarTabs.filter(tab => !tab.hidden);
    const current = visible.indexOf(button);
    const next = event.key === "Home" ? visible[0] : event.key === "End" ? visible.at(-1)
      : visible[(current + (event.key === "ArrowRight" ? 1 : -1) + visible.length) % visible.length];
    next?.focus(); next?.click();
  });
});
window.addEventListener("popstate", () => closeReaderOptions(true));
document.addEventListener("pointerdown", event => {
  if (readerOptions.classList.contains("is-open") && !readerOptions.contains(event.target as Node) && !(event.target as Element).closest(".reader-tool-button")) closeReaderOptions();
  if (!(event.target as Element).closest(".book-menu")) document.querySelectorAll<HTMLDetailsElement>(".book-menu[open]").forEach(menu => { menu.open = false; });
});
document.addEventListener("toggle", event => {
  const menu = event.target;
  if (menu instanceof HTMLDetailsElement && menu.matches(".book-menu") && menu.open)
    document.querySelectorAll<HTMLDetailsElement>(".book-menu[open]").forEach(other => { if (other !== menu) other.open = false; });
}, true);
$("#back-button").addEventListener("click", () => { closeReaderOptions(); setView(lastCollectionView); });
$("#desktop-reader-back").addEventListener("click", () => { closeReaderOptions(); setView(lastCollectionView); });
$("#previous-button").addEventListener("click", () => void turnPage(-1));
$("#next-button").addEventListener("click", () => void turnPage(1));
$("#smaller-button").addEventListener("click", () => changeSize(-1));
$("#larger-button").addEventListener("click", () => changeSize(1));
$<HTMLInputElement>("#reader-brightness").addEventListener("input", event => {
  const value = Number((event.target as HTMLInputElement).value);
  readerBrightness = value;
  readingSurface.style.filter = `brightness(${value}%)`;
  $<HTMLOutputElement>("#brightness-value").textContent = `${value}%`;
  const key = readerPreferenceKey("brightness");
  if (key) localStorage.setItem(key, String(value));
  resetReaderChrome();
});
function ttsAvailable(): boolean {
  return usesNativeTts() || Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
}

function ttsLanguage(): string {
  return currentBook?.format === "epub" ? epubBook?.packaging?.metadata?.language ?? language : language;
}

function formatTtsRate(value: number): string {
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)}×`;
}

function ttsVoiceLabel(voice: TtsVoice): string {
  let localizedLanguage = voice.lang;
  try { localizedLanguage = new Intl.DisplayNames([language], { type: "language" }).of(voice.lang) ?? voice.lang; }
  catch { /* Keep the engine language tag when it is not a valid BCP 47 code. */ }
  const prefix = `${voice.lang}-`;
  let variant = voice.name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()) ? voice.name.slice(prefix.length) : voice.name;
  if (variant.toLocaleLowerCase() === "default") variant = t("ttsDefaultVoice");
  return variant ? `${localizedLanguage} · ${variant}` : localizedLanguage;
}

function visibleText(root: HTMLElement, bounds: { left: number; right: number; top: number; bottom: number }): string {
  const owner = root.ownerDocument;
  const walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node && parts.length < 1500; node = walker.nextNode()) {
    const text = node.textContent?.replace(/\s+/g, " ").trim();
    const parent = node.parentElement;
    if (!text || !parent || parent.closest("script,style,[hidden],[aria-hidden='true']")) continue;
    const range = owner.createRange(); range.selectNodeContents(node);
    if ([...range.getClientRects()].some(rect => rect.right > bounds.left + 1 && rect.left < bounds.right - 1
      && rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1)) parts.push(text);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function currentTtsText(): string {
  if (currentBook?.format === "pdf") {
    if (pdfTextView) return pdfTextView.visibleText().slice(0, 12_000);
    const layer = readerContent.querySelector<HTMLElement>(".pdf-text-layer");
    const bounds = readerContent.querySelector<HTMLElement>(".pdf-page")?.getBoundingClientRect();
    return layer && bounds ? visibleText(layer, bounds).slice(0, 12_000) : "";
  }
  const contents = rendition?.getContents();
  if (!Array.isArray(contents)) return "";
  return (contents as Contents[]).map(item => visibleText(item.document.body, {
    left: 0, top: 0, right: item.window.innerWidth, bottom: item.window.innerHeight,
  })).join(" ").replace(/\s+/g, " ").trim().slice(0, 12_000);
}

function speechChunks(text: string): string[] {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+|$)/gu) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const value = sentence.trim();
    if (!value) continue;
    if (current && `${current} ${value}`.length > 650) { chunks.push(current); current = value; }
    else current = current ? `${current} ${value}` : value;
  }
  if (current) chunks.push(current);
  return chunks.flatMap(chunk => chunk.length <= 700 ? [chunk] : chunk.match(/.{1,700}(?:\s|$)/gu)?.map(part => part.trim()).filter(Boolean) ?? [chunk]);
}

function updateTtsPlayer(text = currentTtsText()): void {
  const status = $<HTMLOutputElement>("#tts-player-status");
  status.textContent = t(ttsState === "playing" ? "ttsPlayerReading" : ttsState === "paused" ? "ttsPlayerPaused" : "ttsPlayerReady");
  const play = $<HTMLButtonElement>("#tts-play-pause");
  const playing = ttsState === "playing";
  play.innerHTML = svg(playing ? "pause" : "play", 23);
  play.setAttribute("aria-label", t(playing ? "ttsPause" : ttsState === "paused" ? "ttsResume" : "ttsPlay"));
  play.setAttribute("aria-pressed", String(ttsState !== "idle"));
  const epubLocation = currentBook?.format === "epub" ? rendition?.location : undefined;
  $<HTMLButtonElement>("#tts-previous").disabled = $<HTMLButtonElement>("#previous-button").disabled || Boolean(epubLocation?.atStart);
  $<HTMLButtonElement>("#tts-next").disabled = $<HTMLButtonElement>("#next-button").disabled || Boolean(epubLocation?.atEnd);
  const position = $("#position-label").textContent?.trim();
  $("#tts-page-context").textContent = position && position !== "—" ? `${t("ttsCurrentPage")} · ${position}` : t("ttsCurrentPage");
  $("#tts-passage").textContent = text ? `${text.slice(0, 165)}${text.length > 165 ? "…" : ""}` : t("noSelectableText");
  const voice = preferredVoice(ttsVoices, ttsPreferences, ttsLanguage());
  $("#tts-active-voice").textContent = t("ttsVoiceActive", { voice: voice ? ttsVoiceLabel(voice) : t("ttsDefaultVoice") });
  for (const id of ["#tts-rate-reader", "#tts-rate-settings"]) $<HTMLInputElement>(id).value = String(ttsPreferences.rate);
  for (const id of ["#tts-rate-reader-value", "#tts-rate-settings-value"]) $<HTMLOutputElement>(id).textContent = formatTtsRate(ttsPreferences.rate);
}

function stopTts(update = true): void {
  ttsSequence += 1;
  if (usesNativeTts()) void nativeStop().catch(error => console.warn("Native TTS stop failed", error));
  else if (window.speechSynthesis) window.speechSynthesis.cancel();
  ttsState = "idle"; ttsChunks = []; ttsChunkIndex = 0;
  if (update && document.querySelector("#tts-player-status")) updateTtsPlayer();
}

function ttsPageKey(): string {
  const position = capturePosition();
  return position.format === "pdf" ? `${position.page}:${pdfTextView?.index ?? position.offset}` : position.cfi;
}

async function advanceTtsPage(sequence: number): Promise<void> {
  if (sequence !== ttsSequence || view !== "reader" || $<HTMLButtonElement>("#next-button").disabled) { stopTts(); return; }
  const before = ttsPageKey();
  await turnPage(1);
  if (sequence !== ttsSequence || view !== "reader") return;
  if (ttsPageKey() === before) { stopTts(); return; }
  startTtsPage();
}

function speakTtsChunk(sequence: number): void {
  if (sequence !== ttsSequence || ttsState === "idle") return;
  const text = ttsChunks[ttsChunkIndex];
  if (!text) { void advanceTtsPage(sequence); return; }
  const voice = preferredVoice(ttsVoices, ttsPreferences, ttsLanguage());
  if (usesNativeTts()) {
    void nativeSpeak({ text, voiceUri: voice?.voiceURI ?? "", language: voice?.lang ?? ttsLanguage(), rate: ttsPreferences.rate })
      .then(status => {
        if (sequence !== ttsSequence || status !== "done") return;
        ttsChunkIndex += 1;
        speakTtsChunk(sequence);
      })
      .catch(error => {
        console.error("Native TTS playback failed", error);
        if (sequence === ttsSequence) { stopTts(); showToast(t("speechUnavailable")); }
      });
    return;
  }
  const speech = new SpeechSynthesisUtterance(text);
  if (voice) speech.voice = voice;
  speech.lang = voice?.lang ?? ttsLanguage();
  speech.rate = ttsPreferences.rate;
  speech.onend = () => {
    if (sequence !== ttsSequence) return;
    ttsChunkIndex += 1;
    speakTtsChunk(sequence);
  };
  speech.onerror = () => { if (sequence === ttsSequence) stopTts(); };
  window.speechSynthesis.speak(speech);
}

function startTtsPage(): void {
  if (!ttsAvailable()) { showToast(t("speechUnavailable")); return; }
  const text = currentTtsText();
  if (!text) { showToast(t("noSelectableText")); stopTts(); return; }
  const sequence = ++ttsSequence;
  ttsChunks = speechChunks(text); ttsChunkIndex = 0; ttsState = "playing";
  updateTtsPlayer(text);
  if (usesNativeTts()) {
    void nativeStop().catch(() => undefined).then(() => {
      if (sequence === ttsSequence && ttsState === "playing") speakTtsChunk(sequence);
    });
  } else {
    window.speechSynthesis.cancel();
    speakTtsChunk(sequence);
  }
}

async function toggleTtsPlayback(): Promise<void> {
  if (!ttsAvailable()) { showToast(t("speechUnavailable")); return; }
  if (ttsState === "playing") {
    try {
      if (usesNativeTts()) await nativePause(); else window.speechSynthesis.pause();
      ttsState = "paused"; updateTtsPlayer();
    } catch (error) { console.error("TTS pause failed", error); showToast(t("speechUnavailable")); }
    return;
  }
  if (ttsState === "paused") {
    try {
      if (usesNativeTts()) await nativeResume(); else window.speechSynthesis.resume();
      ttsState = "playing"; updateTtsPlayer();
    } catch (error) { console.error("TTS resume failed", error); showToast(t("speechUnavailable")); }
    return;
  }
  startTtsPage();
}

async function navigateTts(direction: -1 | 1): Promise<void> {
  if ($(direction < 0 ? "#tts-previous" : "#tts-next").hasAttribute("disabled")) return;
  stopTts(false);
  await turnPage(direction);
  if (view === "reader") startTtsPage();
}

function renderTtsVoiceOptions(): void {
  const select = $<HTMLSelectElement>("#tts-voice-select");
  select.replaceChildren(new Option(t("ttsDefaultVoice"), ""));
  for (const voice of ttsVoices) select.add(new Option(ttsVoiceLabel(voice), voice.voiceURI));
  select.value = ttsVoices.some(voice => voice.voiceURI === ttsPreferences.voiceUri) ? ttsPreferences.voiceUri : "";
  $("#tts-voice-status").textContent = t(ttsVoices.length === 1 ? "ttsVoiceCountOne" : "ttsVoiceCountMany", { count: ttsVoices.length });
  $<HTMLButtonElement>("#tts-preview").disabled = !ttsAvailable();
  updateTtsPlayer();
}

async function refreshTtsVoices(announce = true): Promise<void> {
  const button = $<HTMLButtonElement>("#tts-refresh-voices");
  if (!ttsAvailable()) { ttsVoices = []; renderTtsVoiceOptions(); $("#tts-voice-status").textContent = t("speechUnavailable"); return; }
  button.disabled = true;
  if (announce) $("#tts-voice-status").textContent = t("ttsVoicesLoading");
  try {
    ttsVoices = usesNativeTts() ? await nativeDeviceVoices() : await refreshDeviceVoices(window.speechSynthesis);
    renderTtsVoiceOptions();
    if (!ttsVoices.length) $("#tts-voice-status").textContent = t("ttsNoVoices");
  } catch (error) {
    console.error("TTS voice discovery failed", error);
    ttsVoices = []; renderTtsVoiceOptions();
    $("#tts-voice-status").textContent = t("speechUnavailable");
  } finally { button.disabled = false; }
}

function setTtsRate(value: number, restart: boolean): void {
  ttsPreferences = saveTtsPreferences({ ...ttsPreferences, rate: value });
  updateTtsPlayer();
  if (restart && ttsState !== "idle") startTtsPage();
}

$<HTMLSelectElement>("#tts-voice-select").addEventListener("change", event => {
  ttsPreferences = saveTtsPreferences({ ...ttsPreferences, voiceUri: (event.target as HTMLSelectElement).value });
  updateTtsPlayer();
});
$("#tts-refresh-voices").addEventListener("click", () => void refreshTtsVoices());
for (const id of ["#tts-rate-settings", "#tts-rate-reader"]) {
  const input = $<HTMLInputElement>(id);
  input.addEventListener("input", () => setTtsRate(Number(input.value), false));
  input.addEventListener("change", () => setTtsRate(Number(input.value), true));
}
$("#tts-preview").addEventListener("click", async () => {
  if (!ttsAvailable()) { showToast(t("speechUnavailable")); return; }
  stopTts(false);
  const voice = preferredVoice(ttsVoices, ttsPreferences, language);
  if (usesNativeTts()) {
    $("#tts-preview-status").textContent = t("ttsPreviewPlaying");
    try {
      await nativeStop();
      await nativeSpeak({ text: t("ttsPreviewText"), voiceUri: voice?.voiceURI ?? "", language: voice?.lang ?? language, rate: ttsPreferences.rate });
    } catch (error) {
      console.error("Native TTS preview failed", error);
      showToast(t("speechUnavailable"));
    } finally { $("#tts-preview-status").textContent = ""; }
    return;
  }
  const speech = new SpeechSynthesisUtterance(t("ttsPreviewText"));
  if (voice) speech.voice = voice;
  speech.lang = voice?.lang ?? language; speech.rate = ttsPreferences.rate;
  $("#tts-preview-status").textContent = t("ttsPreviewPlaying");
  speech.onend = speech.onerror = () => { $("#tts-preview-status").textContent = ""; };
  window.speechSynthesis.speak(speech);
});
$("#tts-play-pause").addEventListener("click", () => void toggleTtsPlayback());
$("#tts-previous").addEventListener("click", () => void navigateTts(-1));
$("#tts-next").addEventListener("click", () => void navigateTts(1));
if (!usesNativeTts() && window.speechSynthesis) window.speechSynthesis.addEventListener("voiceschanged", () => {
  ttsVoices = localDeviceVoices(window.speechSynthesis); renderTtsVoiceOptions();
});
renderTtsVoiceOptions();
void refreshTtsVoices(false);
$<HTMLElement>(".reader-toolbar").addEventListener("pointerdown", resetReaderChrome);
$<HTMLElement>(".reader-bottom").addEventListener("pointerdown", resetReaderChrome);
$<HTMLSelectElement>("#pdf-reading-mode").addEventListener("change", () => {
  closeReaderOptions();
  if (!currentBook || currentBook.format !== "pdf") return;
  if (pdfTextView) pdfPosition.offset = pdfTextView.visibleOffset();
  pdfReadingMode = $<HTMLSelectElement>("#pdf-reading-mode").value === "original" ? "original" : "text";
  localStorage.setItem(`autumn-pdf-mode-${currentBook.id}`, pdfReadingMode);
  void renderPdfPage().then(persistCurrent);
});
$("#note-add").addEventListener("click", () => openNoteDialog());
$("#selection-copy").addEventListener("click", async () => {
  const quote = selectedTranslationText;
  hideNoteMenu();
  if (!quote) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(quote);
    else {
      const input = document.createElement("textarea"); input.value = quote; input.style.position = "fixed"; input.style.opacity = "0";
      document.body.append(input); input.select();
      const copied = document.execCommand("copy"); input.remove();
      if (!copied) throw new Error("clipboard unavailable");
    }
    showToast(t("copied"));
  } catch { showToast(t("copyFailed")); }
});
const dictionaryPanel = $<HTMLElement>("#dictionary-panel");
const dictionarySource = $<HTMLSelectElement>("#dictionary-source");
const storedDictionarySource = localStorage.getItem("autumn-dictionary-source");
dictionarySource.value = storedDictionarySource === "wiktionary" || storedDictionarySource === "wikipedia" ? storedDictionarySource : "automatic";
let dictionaryWord = "";
let dictionaryWordLanguage: Language | undefined;
let dictionaryRequest = 0;

function closeDictionary(): void {
  dictionaryRequest += 1;
  dictionaryPanel.hidden = true;
  $<HTMLElement>("#reading-surface").focus({ preventScroll: true });
}

function definitionLanguageName(): string {
  const name = new Intl.DisplayNames([language], { type: "language" }).of(language) ?? language;
  return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
}

function setDictionaryReferences(word: string, sourceLanguage: Language | undefined): void {
  const encoded = encodeURIComponent(word);
  const wordReference = $<HTMLAnchorElement>("#dictionary-wordreference");
  const referenceLanguage = sourceLanguage ?? (language === "en" ? undefined : "en");
  if (referenceLanguage && referenceLanguage !== language && (referenceLanguage === "en" || language === "en")) {
    wordReference.href = `https://www.wordreference.com/${referenceLanguage}${language}/${encoded}`;
  } else {
    wordReference.href = `https://www.wordreference.com/definition/${encoded}`;
  }
  const nativeSources: Record<Language, { name: string; url: string }> = {
    en: { name: "Merriam-Webster", url: `https://www.merriam-webster.com/dictionary/${encoded}` },
    es: { name: "RAE", url: `https://dle.rae.es/${encoded}` },
    it: { name: "Treccani", url: `https://www.treccani.it/vocabolario/ricerca/${encoded}/` },
    fr: { name: "CNRTL", url: `https://www.cnrtl.fr/definition/${encoded}` },
  };
  const nativeLink = $<HTMLAnchorElement>("#dictionary-native");
  nativeLink.textContent = nativeSources[language].name;
  nativeLink.href = nativeSources[language].url;
  nativeLink.setAttribute("aria-label", `${t("dictionaryNativeSource")}: ${nativeSources[language].name}`);
}

async function renderDictionary(): Promise<void> {
  const request = ++dictionaryRequest;
  const content = $("#dictionary-content");
  const attribution = $("#dictionary-attribution");
  const sourceLink = $<HTMLAnchorElement>("#dictionary-source-link");
  attribution.hidden = true;
  sourceLink.hidden = true;
  content.setAttribute("aria-busy", "true");
  content.textContent = navigator.onLine ? t("dictionaryLoading") : t("dictionaryOffline");
  if (!navigator.onLine || !dictionaryWord) { content.removeAttribute("aria-busy"); return; }
  try {
    const entry = await dictionaryService.lookup(dictionaryWord, {
      definitionLanguage: language,
      wordLanguage: dictionaryWordLanguage,
      source: dictionarySource.value as DictionarySource,
    });
    if (request !== dictionaryRequest || dictionaryPanel.hidden) return;
    content.replaceChildren();
    if (!entry) { content.textContent = t("dictionaryEmpty"); return; }
    const list = document.createElement("ol");
    list.className = "dictionary-senses";
    for (const sense of entry.senses) {
      const row = document.createElement("li");
      if (sense.partOfSpeech) { const type = document.createElement("span"); type.className = "dictionary-part"; type.textContent = sense.partOfSpeech; row.append(type); }
      const definition = document.createElement("span"); definition.textContent = sense.definition; row.append(definition); list.append(row);
    }
    content.append(list);
    attribution.textContent = t(entry.source === "wiktionary" ? "dictionaryAttributionWiktionary" : "dictionaryAttributionWikipedia");
    attribution.hidden = false;
    sourceLink.href = entry.sourceUrl;
    sourceLink.textContent = `${t("dictionaryOpenSource")} · ${entry.source === "wiktionary" ? t("dictionaryWiktionary") : t("dictionaryWikipedia")}`;
    sourceLink.hidden = false;
  } catch (error) {
    if (request !== dictionaryRequest || dictionaryPanel.hidden) return;
    console.warn("Dictionary lookup failed", error); content.textContent = t("dictionaryFailed");
  } finally {
    if (request === dictionaryRequest) content.removeAttribute("aria-busy");
  }
}

$("#dictionary-close").addEventListener("click", closeDictionary);
dictionaryPanel.addEventListener("keydown", event => { if (event.key === "Escape") closeDictionary(); });
dictionarySource.addEventListener("change", () => {
  localStorage.setItem("autumn-dictionary-source", dictionarySource.value);
  void renderDictionary();
});
$("#selection-dictionary").addEventListener("click", () => {
  dictionaryWord = selectedTranslationText.trim().split(/\s+/u)[0] ?? "";
  const metadataLanguage = currentBook?.format === "epub" ? epubBook?.packaging?.metadata?.language?.slice(0, 2).toLocaleLowerCase() : undefined;
  dictionaryWordLanguage = metadataLanguage === "en" || metadataLanguage === "es" || metadataLanguage === "it" || metadataLanguage === "fr" ? metadataLanguage : undefined;
  hideNoteMenu();
  dictionaryPanel.hidden = false;
  $("#dictionary-word").textContent = dictionaryWord;
  $("#dictionary-language").textContent = t("dictionaryInLanguage", { language: definitionLanguageName() });
  setDictionaryReferences(dictionaryWord, dictionaryWordLanguage);
  $<HTMLButtonElement>("#dictionary-close").focus({ preventScroll: true });
  void renderDictionary();
});
$("#note-custom-color").addEventListener("input", () => { selectedNoteColor = hexColor($<HTMLInputElement>("#note-custom-color").value) ?? noteColors[0]; renderNoteColors(); });
$("#note-save").addEventListener("click", () => void saveNote());
$("#note-delete").addEventListener("click", () => void deleteNote());
$("#note-cancel").addEventListener("click", closeNoteDialog);
$("#note-close").addEventListener("click", closeNoteDialog);
$("#all-notes-button").addEventListener("click", () => { closeReaderOptions(); openAllNotes(); });
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
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-book-theme]")) {
  button.addEventListener("click", () => {
    bookReaderTheme = button.dataset.bookTheme as BookReaderTheme;
    const key = readerPreferenceKey("theme");
    if (key) localStorage.setItem(key, bookReaderTheme);
    applyBookReaderTheme();
  });
}
const renderNoteStyleChoices = (): void => {
  for(const button of document.querySelectorAll<HTMLButtonElement>(".note-style-choice")){
    const selected=button.dataset.noteStyle===noteStyle;
    button.classList.toggle("selected",selected);button.setAttribute("aria-pressed",String(selected));
  }
};
renderNoteStyleChoices();
for(const button of document.querySelectorAll<HTMLButtonElement>(".note-style-choice"))button.addEventListener("click",()=>{
  noteStyle=button.dataset.noteStyle as NoteStyle;localStorage.setItem(noteStyleKey,noteStyle);renderNoteStyleChoices();renderNoteMarkers();
});
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
bookFontSelect.value = globalPagePreferences.font;
const globalFontPreview = $<HTMLElement>("#global-font-preview");
const updateGlobalFontPreview = (): void => { globalFontPreview.style.fontFamily = fontCss(globalPagePreferences.font) || "serif"; };
updateGlobalFontPreview();
bookFontSelect.addEventListener("change", () => {
  globalPagePreferences = savePagePreferences({ ...globalPagePreferences, font: bookFontSelect.value });
  localStorage.setItem("autumn-book-font", globalPagePreferences.font);
  updateGlobalFontPreview(); globalLayoutUI?.refresh(); bookLayoutUI?.refresh();
  void relayoutReader(); showToast(t("bookFontSaved"));
});
void availableSystemFonts().then(fonts => {
  if (!fonts.length) return;
  const group = document.createElement("optgroup"); group.label = t("systemFonts");
  for (const name of fonts) group.append(new Option(name, `system:${name}`));
  bookFontSelect.append(group); bookFontSelect.value = globalPagePreferences.font;
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
    if (readerOptions.classList.contains("is-open")) { event.preventDefault(); const trigger = activeReaderOptionsTrigger; closeReaderOptions(); trigger?.focus(); return; }
    document.querySelectorAll<HTMLDetailsElement>(".book-menu[open]").forEach(menu => { menu.open = false; menu.querySelector<HTMLElement>("summary")?.focus(); });
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
  if (view === "reader" && currentBook?.format === "epub" && !stableLayoutAnchor) {
    stableLayoutAnchor = currentBook.cfi ?? rendition?.location?.start?.cfi ?? epubPosition.cfi;
    stableLayoutPercentage = currentBook.percentage ?? null;
  }
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (view !== "reader") return;
    if (pageTurn) {void endPageTurn(false,pageTurn.direction).then(()=>currentBook?.format==="pdf"?renderPdfPage():renderNoteMarkers());return;}
    void relayoutReader();
  }, 150);
});

applyTheme();
setView("home");
mountSettings($("#view-settings"));
void mountDesktopGeneralSettings();
translationUI=mountTranslation($("#translation-panel"),translationService,()=>readingSurface.focus({preventScroll:true}));
$("#selection-translate").addEventListener("click",()=>{hideNoteMenu();searchUI?.close();translationUI?.open(selectedTranslationText);});
searchUI = mountBookSearch($("#book-search-panel"), jumpToSearch, () => { clearSearchHighlight(); $("#book-search-button").focus(); });
$("#book-search-button").addEventListener("click", () => {closeReaderOptions();translationUI?.close();searchUI?.opened ? searchUI.close() : searchUI?.open();});
$("#reader-toc").addEventListener("change", () => { closeReaderOptions(); const toc = $<HTMLSelectElement>("#reader-toc"); void (currentBook?.format === "pdf" ? jumpToPdfReference(pdfOutlineDestinations.get(toc.value)) : jumpToContents(toc.value)).catch(error => showToast(errorMessage(error))); toc.value = ""; });
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
  if (currentBook?.format === "epub") { stableLayoutAnchor = null; stableLayoutPercentage = null; currentBook.cfi = epubPosition.cfi; if (rendition?.location) currentBook.percentage = epubReadingPercentage(rendition.location); }
  void persistCurrent(); updateHistory();
});
folderUI = mountFolders(
  $("#library-folders"),
  renderCollections,
  showToast,
  deleteBooks => confirmAction({ title: t("deleteFolder"), message: t(deleteBooks ? "deleteFolderWithBooksMessage" : "deleteFolderMessage"), confirmLabel: t("deleteFolder"), tone: "remove" }),
  () => { $<HTMLInputElement>("#library-search").value = ""; },
  () => desktopGeneralPreferences.deleteBooksWithFolder,
  async folderBooks => {
    for (const book of folderBooks) await deleteBook(book.id, { permanent: desktopGeneralPreferences.disableTrashBin });
    const removed = new Set(folderBooks.map(book => book.id));
    books = books.filter(book => !removed.has(book.id));
    renderCollections();
  },
);
$("#legacy-recovery-button").addEventListener("click", () => {
  const owner = auth.state.ownerId;
  if (!owner) return;
  void confirmAction({ title: t("legacyBooksTitle"), message: t("legacyBooksConfirm"), confirmLabel: t("legacyBooksClaim"), tone: "import" }).then(async approved => {
    if (!approved || auth.state.ownerId !== owner) return;
    await claimUnownedBooks(owner);
    if (auth.state.ownerId !== owner) return;
    showToast(t("legacyBooksClaimed"));
    await reloadCloudLibrary();
  }).catch(() => showToast(t("legacyBooksFailed")));
});
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
  $<HTMLInputElement>("#line-spacing").value = String(globalPagePreferences.lineHeight);
  $<HTMLInputElement>("#paragraph-spacing").value = String(globalPagePreferences.paragraphSpacing);
  $("#line-spacing-value").textContent = String(globalPagePreferences.lineHeight);
  $("#paragraph-spacing-value").textContent = `${globalPagePreferences.paragraphSpacing} em`;
};
const updateSpacing = (): void => {
  globalPagePreferences = savePagePreferences({ ...globalPagePreferences, lineHeight: Number($<HTMLInputElement>("#line-spacing").value), paragraphSpacing: Number($<HTMLInputElement>("#paragraph-spacing").value) });
  updateSpacingControls(); bookLayoutUI?.refresh(); void relayoutReader();
};
$("#line-spacing").addEventListener("change", updateSpacing);
$("#paragraph-spacing").addEventListener("change", updateSpacing);
$("#spacing-reset").addEventListener("click", () => {
  globalPagePreferences = savePagePreferences({ ...defaultPagePreferences });
  bookFontSelect.value = globalPagePreferences.font; updateGlobalFontPreview(); updateSpacingControls(); globalLayoutUI?.refresh(); bookLayoutUI?.refresh(); void relayoutReader();
});
updateSpacingControls();
globalLayoutUI = mountLayoutFields($("#global-layout-extra"), {
  scope: "global", getGlobal: () => globalPagePreferences, getOverrides: () => ({}),
  changeGlobal: value => { globalPagePreferences = savePagePreferences({ ...globalPagePreferences, ...value }); bookLayoutUI?.refresh(); void relayoutReader(); },
  changeBook: () => {},
});
bookLayoutUI = mountLayoutFields($("#book-layout-fields"), {
  scope: "book", getGlobal: () => globalPagePreferences, getOverrides: () => bookPageOverrides,
  changeGlobal: () => {},
  changeBook: value => {
    if (!currentBook) return;
    const previousEffective = resolvePagePreferences(globalPagePreferences, bookPageOverrides);
    const nextEffective = resolvePagePreferences(globalPagePreferences, value);
    bookPageOverrides = value;
    saveBookPageOverrides(currentBook.ownerId ?? auth.state.ownerId ?? "local", currentBook.id, value);
    // Turning off inheritance initially copies the value already on screen.
    // Do not ask EPUB.js to repaginate until the reader actually changes it:
    // a no-op resize can disturb the publisher's layout in complex EPUBs.
    if (!pagePreferencesEqual(previousEffective, nextEffective)) void relayoutReader();
  },
});
mountAccount(app, $(".shell"), $("#settings-account-sheet"));
mountAccountPlans($("#settings-plan"));
mountAccountSecurity($("#settings-security"));
const cloudDownloads = new Map<string, Promise<StoredBook>>();
setCloudBookLoader((book) => {
  const previous = cloudDownloads.get(book.id);
  if (previous) return previous;
  const download = bookStorage.getBook(book).finally(() => cloudDownloads.delete(book.id));
  cloudDownloads.set(book.id, download);
  return download;
});
void requestPersistentCache();
mountSync($("#settings-plan .plan-feature"), reloadCloudLibrary);
mountAccountStorage($("#settings-plan .plan-actions"), coverElement, reloadCloudLibrary);
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
  scheduleContentRecovery();
}, reviewComposer, () => confirmAction({ title: t("deleteReview"), message: t("deleteReviewMessage"), confirmLabel: t("deleteReview"), tone: "remove" }), () => openLibraryFilter("favorites"));
mountDetails($("#view-details"), () => setView("details"), reviewComposer);
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
// Repair older records and warm cloud covers with at most two decoders/downloads.
const contentQueue: StoredBook[] = [];
const queuedContent = new Set<string>();
let activeContent = 0, contentGeneration = 0;
function drainContentQueue(): void {
  while (activeContent < 2 && contentQueue.length) {
    const book = contentQueue.shift()!;
    const generation = contentGeneration;
    if (book.ownerId !== auth.state.ownerId || (!navigator.onLine && !hasLocalFile(book))) {
      queuedContent.delete(book.id);
      continue;
    }
    activeContent++;
    void refreshBookContent(book).finally(() => {
      if (generation !== contentGeneration) return;
      activeContent--;
      queuedContent.delete(book.id);
      drainContentQueue();
    });
  }
}
function scheduleContentRecovery(): void {
  for (const book of books) {
    if (book.contentMetadataVersion === 1 || !book.ownerId || book.ownerId !== auth.state.ownerId || queuedContent.has(book.id)) continue;
    if (!hasLocalFile(book) && (!book.cloudId || !navigator.onLine)) continue;
    // An edited private cover and edited metadata already have a cheaper cloud path.
    if (!hasLocalFile(book) && book.coverPath && book.displayTitle !== undefined && book.author !== undefined) continue;
    queuedContent.add(book.id);
    contentQueue.push(book);
  }
  drainContentQueue();
}
const loadMoreCloud = document.createElement("button");
loadMoreCloud.className = "secondary-button"; loadMoreCloud.textContent = t("loadMoreCloud"); loadMoreCloud.hidden = true;
$("#view-library").append(loadMoreCloud);
async function refreshFolders(): Promise<void> {
  await folders.refresh(books.flatMap(book => book.cloudId ? [book.cloudId] : []));
  await folderUI?.reload();
}
async function reloadCloudLibrary(): Promise<void> {
  const sequence = ++collectionSequence; const owner = auth.state.ownerId;
  const loaded = await reconcileLocalLibrary(owner);
  if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
  books = loaded;
  const unclaimed = await unclaimedBookCount();
  if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
  $("#legacy-recovery").hidden = !owner || !unclaimed;
  const states = await localAll<MigrationState>("migration_state");
  if (sequence !== collectionSequence || auth.state.ownerId !== owner) return;
  for (const state of states) if (state.ownerId === owner && state.phase === "error" && cloudState.get(state.localId) !== "syncing") cloudState.set(state.localId, "error");
  await folderUI?.reload();
  // Switch a reader opened during import to its account copy after migration commits.
  if (currentBook && !currentBook.cloudId && owner && currentBook.ownerId === owner) {
    const clone = books.find((b) => b.ownerId === owner && b.migrationSources?.includes(currentBook!.id));
    if (clone) { Object.assign(currentBook, clone); books = books.map((b) => b.id === clone.id ? currentBook! : b); }
  }
  renderCollections();
  scheduleContentRecovery();
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
    scheduleContentRecovery();
  } catch (error: unknown) { if (auth.state.ownerId === owner) showToast(errorMessage(error)); }
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
    scheduleContentRecovery();
  }).catch((error: unknown) => showToast(errorMessage(error))).finally(() => { loadMoreCloud.disabled = false; });
});
let collectionOwner: string | null | undefined;
auth.subscribe((state) => {
  if (state.status === "loading") return;
  if (view === "reader") void refreshReaderTtsAccess();
  if (collectionOwner !== state.ownerId) {
    const switchedAccount = Boolean(collectionOwner);
    collectionOwner = state.ownerId; ++loadSequence;
    ++collectionSequence; cancelMigration();
    ++contentGeneration; contentQueue.length = 0; queuedContent.clear(); activeContent = 0;
    cloudDownloads.clear();
    for (const cached of coverCache.values()) URL.revokeObjectURL(cached.url);
    coverCache.clear();
    books = []; cloudState.clear(); folderUI?.reset(); $("#legacy-recovery").hidden = true; renderCollections();
    currentBook = null; readerCleanup = clearReader();
    if (switchedAccount) setView("home");
    loadMoreCloud.hidden = true;
    const owner = state.ownerId;
    void reloadCloudLibrary().catch(() => { if (auth.state.ownerId === owner) showToast(t("libraryOpenFailed")); });
  } else if (state.status === "authenticated") void reloadCloudLibrary();
  if (state.status === "authenticated") void resumeApprovedMigrations().then((resumed) => resumed ? reloadCloudLibrary() : undefined).catch((error: unknown) => showToast(errorMessage(error)));
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && view !== "reader") void reloadCloudLibrary(); });
window.addEventListener("online", () => { void auth.refresh().then(resumeApprovedMigrations).then(reloadCloudLibrary).catch((error: unknown) => showToast(errorMessage(error))); });
window.addEventListener("autumn-device-ready", () => { void reloadCloudLibrary(); void sync.flush(true); });
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
