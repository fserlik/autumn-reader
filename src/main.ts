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
import { cloudStorage } from "./services/books/cloud-storage";
import { bookStorage, requestPersistentCache } from "./services/storage";
import { ensureBookContentMetadata } from "./services/books/content-metadata";
import { BOOK_CONTENT_METADATA_VERSION } from "./services/books/content-metadata-version";
import { bookDisplayTitle } from "./services/books/display";
import { bookCache } from "./services/storage";
import { downloadPrivateCover } from "./services/storage/book-covers";
import { mountBookEditor, type BookEditor } from "./ui/edit-book";
import { library } from "./services/books";
import { importUniqueBook, reconcileLocalLibrary } from "./services/books/identity";
import { sync } from "./services/sync";
import { cancelMigration, migrateLibrary, resumeApprovedMigrations } from "./services/sync/migration";
import { errorMessage } from "./services/errors";
import { mountDetails } from "./ui/social-details";
import { mountProfile, type ProfileUI } from "./ui/profile-page";
import { mountReadingStats } from "./ui/reading-stats";
import { mountBookCarousel } from "./ui/book-carousel";
import { homeReadingSelection, presentationCard } from "./ui/book-presentation";
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
import { cancelLocalSynthesis, chooseVoiceFile, discardPreparedVoiceImport, formatModelBytes, importedVoices, installPreparedVoice, installedPackages, knownVoices, loadBookTtsPreferences, loadTtsPreferences, localDeviceVoices, LocalTtsPlayer, nativeDeviceVoices, nativePause, nativeResume, nativeSpeak, nativeStop, prepareVoiceImport, preferredVoice, refreshDeviceVoices, removeImportedVoice, runtimeStatus, saveBookTtsPreferences, saveTtsPreferences, supportsLocalNeuralTts, synthesizeLocal, ttsEngines, usesNativeSystemTts, type BookTtsPreferences, type CatalogVoice, type InstalledPackage, type PreparedVoiceImport, type TtsEngineId, type TtsGlobalPreferences, type TtsRuntimeStatus, type TtsVoice } from "./services/tts";
import { clearSpeechHighlight, collectVisibleSpeechSource, locateSpeechChunks, setSpeechHighlight, type SpeechSource, type SpeechSourceRegion } from "./services/tts/highlight";
import { ReaderHistory, type ReaderPosition } from "./readers/history";
import { epubSearch, pdfSearch, quoteRects, type BookSearch, type SearchResult } from "./readers/search";
import { mountBookSearch, type SearchUI } from "./ui/book-search";
import { bindPageGestures } from "./readers/gestures";
import { pageSnapshot, pageTurnSheetTransform, settledPageMove, slide, waitForStableTypography } from "./readers/page-turn";
import { translationService } from "./services/translation";
import { mountTranslation, type TranslationUI } from "./ui/translation";
import { pdfDestination, pdfPageLinks } from "./readers/pdf-navigation";
import { readingActivity } from "./services/reading/activity";
import { splitSpeechText } from "../shared/ai-speech";

const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  library: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m17 5 4 14M3 8h5m2 4h5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  plans: '<path d="M4 7h16v13H4z"/><path d="M7 4h10v3M8 11h8M8 15h5"/>',
  collapse: '<path d="m15 18-6-6 6-6"/>',
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
  stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
  previousTrack: '<path d="M6 5v14M18 6l-9 6 9 6V6z"/>',
  nextTrack: '<path d="M18 5v14M6 6l9 6-9 6V6z"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 8A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 11.9-2"/>',
  bookLayout: '<path d="M3 5.5A4.5 4.5 0 0 1 7.5 4H11v16H7.5A4.5 4.5 0 0 0 3 21.5v-16zM21 5.5A4.5 4.5 0 0 0 16.5 4H13v16h3.5a4.5 4.5 0 0 1 4.5 1.5v-16z"/>',
  more: '<circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  cloud: '<path d="M7 19h11a4 4 0 0 0 .4-8A6.5 6.5 0 0 0 6 9a5 5 0 0 0 1 10z"/>',
  windowMinimize: '<path d="M6 12h12"/>',
  windowMaximize: '<rect x="6.5" y="6.5" width="11" height="11" rx=".5"/>',
  windowRestore: '<path d="M8 9V6.5h9.5V16H15M6.5 9.5H15V18H6.5z"/>',
  windowClose: '<path d="m7 7 10 10M17 7 7 17"/>',
};

function svg(name: keyof typeof icons, size = 19): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

const isAndroid = /\bAndroid\b/i.test(navigator.userAgent);
const isWindowsDesktop = isTauri() && !isAndroid && /\bWindows\b/i.test(navigator.userAgent);
const windowLabels = {
  en: { minimize: "Minimize", maximize: "Maximize", restore: "Restore", close: "Close" },
  es: { minimize: "Minimizar", maximize: "Maximizar", restore: "Restaurar", close: "Cerrar" },
  it: { minimize: "Riduci a icona", maximize: "Ingrandisci", restore: "Ripristina", close: "Chiudi" },
  fr: { minimize: "Réduire", maximize: "Agrandir", restore: "Restaurer", close: "Fermer" },
}[language];
const app = document.querySelector<HTMLDivElement>("#app")!;
document.documentElement.lang = language;
if (isAndroid) document.documentElement.classList.add("android-app");
if (isWindowsDesktop) document.documentElement.classList.add("windows-desktop");
app.innerHTML = `
  <header id="app-titlebar" class="app-titlebar" data-tauri-drag-region="deep">
    <div class="app-titlebar-brand" data-tauri-drag-region="deep"><img src="${leafUrl}" alt="" /><span data-tauri-drag-region="deep">Autumn Reader</span></div>
    <div class="app-window-controls" data-tauri-drag-region="false">
      <button id="window-minimize" class="app-window-control" type="button" aria-label="${windowLabels.minimize}" title="${windowLabels.minimize}" data-tauri-drag-region="false">${svg("windowMinimize", 16)}</button>
      <button id="window-maximize" class="app-window-control" type="button" aria-label="${windowLabels.maximize}" title="${windowLabels.maximize}" data-tauri-drag-region="false"><span class="window-maximize-icon">${svg("windowMaximize", 15)}</span><span class="window-restore-icon">${svg("windowRestore", 15)}</span></button>
      <button id="window-close" class="app-window-control app-window-close" type="button" aria-label="${windowLabels.close}" title="${windowLabels.close}" data-tauri-drag-region="false">${svg("windowClose", 16)}</button>
    </div>
  </header>
  <div class="shell" hidden>
    <aside class="sidebar">
      <button class="brand" id="brand-home" type="button" aria-label="${t("goHome")}">
        <img src="${leafUrl}" alt="" /><span>Autumn <strong>Reader</strong></span>
      </button>
      <div class="nav-caption">${t("yourSpace")}</div>
      <nav class="sidebar-nav" aria-label="${t("mainNavigation")}">
        <button class="nav-button active" data-view="home" type="button">${svg("home")}<span>${t("home")}</span></button>
        <button class="nav-button" data-view="library" type="button">${svg("library")}<span>${t("library")}</span><span id="nav-book-count" class="nav-count">0</span></button>
        <button class="nav-button" data-view="profile" type="button">${svg("profile")}<span>${t("profile")}</span></button>
      </nav>
      <div class="sidebar-bottom">
        <button class="nav-button" data-view="settings" type="button">${svg("settings")}<span>${t("settings")}</span></button>
        <button id="sidebar-collapse" class="nav-button sidebar-collapse" type="button" aria-label="Collapse sidebar" aria-pressed="false">${svg("collapse")}<span>Collapse</span></button>
      </div>
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

          <section id="recent-shelf" class="home-reading-shelf">
            <div class="shelf-heading"><div><p class="section-kicker">${t("continueWhere")}</p><h2>${t("continueReading")}</h2></div><div class="carousel-controls" role="group" aria-label="${t("continueReading")}" hidden><button id="recent-previous" type="button" aria-label="${t("previousBooks")}">‹</button><button id="recent-next" type="button" aria-label="${t("nextBooks")}">›</button></div></div>
            <div id="recent-list" class="book-grid recent-grid" role="region" aria-label="${t("continueReading")}" tabindex="0"></div>
          </section>
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
              <div id="settings-security"></div>
            </div>
            <div id="settings-account-footer" class="account-settings-footer"></div>
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
            <div class="settings-section-heading"><h2>${t("ttsSettingsTitle")}</h2><p>${t("ttsVoiceLibraryHelp")}</p></div>
            <div class="tts-settings-sheet">
              <div class="tts-engine-ledger">
                <div class="settings-copy"><h3>${t("ttsEngine")}</h3><p id="tts-engine-help"></p></div>
                <div class="tts-engine-options" role="radiogroup" aria-label="${t("ttsEngine")}">
                  <button type="button" data-tts-engine="system" role="radio">${t("ttsEngineSystem")}</button>
                  <button type="button" data-tts-engine="piper" role="radio">${t("ttsEnginePiper")}</button>
                  <button type="button" data-tts-engine="kokoro" role="radio">${t("ttsEngineKokoro")}</button>
                </div>
              </div>
              <div class="tts-catalog-heading"><div><h3>${t("ttsVoiceLibrary")}</h3><p>${t("ttsInstalledLibraryHelp")}</p></div><div class="tts-library-actions"><button id="tts-refresh-voices" class="text-link" type="button">${svg("refresh", 16)}<span>${t("ttsFindDeviceVoices")}</span></button><button id="tts-import-voice" class="text-link" type="button">${svg("plus", 16)}<span>${t("ttsImportVoice")}</span></button></div></div>
              <div class="tts-catalog-filters">
                <label><span>${t("ttsFilterLanguage")}</span><select id="tts-language-filter"></select></label>
                <label><span>${t("ttsFilterRegion")}</span><select id="tts-region-filter"></select></label>
                <label><span>${t("ttsFilterEngine")}</span><select id="tts-engine-filter"><option value="all">${t("ttsFilterAll")}</option><option value="system">${t("ttsEngineSystem")}</option><option value="piper">${t("ttsEnginePiper")}</option><option value="kokoro">${t("ttsEngineKokoro")}</option></select></label>
              </div>
              <div id="tts-voice-library" class="tts-voice-catalog"></div>
              <p id="tts-voice-status" class="tts-catalog-status" role="status" aria-live="polite"></p>
            </div>
            <dialog id="tts-import-dialog" class="account-dialog tts-import-dialog" aria-labelledby="tts-import-title">
              <form id="tts-import-form">
                <header><div><h2 id="tts-import-title">${t("ttsImportVoice")}</h2><p>${t("ttsImportHelp")}</p></div><button id="tts-import-close" class="note-close" type="button" aria-label="${t("close")}">×</button></header>
                <div class="tts-import-body">
                  <div class="tts-import-file-row"><button id="tts-import-pick" class="secondary-button" type="button">${t("ttsChooseFile")}</button><output id="tts-import-file">${t("ttsNoModelSelected")}</output></div>
                  <div id="tts-import-detected" class="tts-import-detected" hidden></div>
                  <div id="tts-import-base" class="tts-import-base" hidden><div><strong>${t("ttsKokoroBaseRequired")}</strong><p>${t("ttsKokoroBaseHelp")}</p></div><button id="tts-import-base-pick" class="secondary-button" type="button">${t("ttsImportBaseModel")}</button></div>
                  <div id="tts-import-fields" class="tts-import-fields" hidden>
                    <label data-import-field="name"><span>${t("ttsImportName")}</span><input id="tts-import-name" maxlength="80" /></label>
                    <label data-import-field="locale"><span>${t("ttsImportLocale")}</span><input id="tts-import-locale" value="${language === "en" ? "en-US" : `${language}-${language.toUpperCase()}`}" maxlength="35" pattern="[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*" /></label>
                  </div>
                  <p class="tts-import-note">${t("ttsImportFormatHelp")}</p>
                  <p id="tts-import-error" class="tts-import-error" role="alert" tabindex="-1"></p>
                </div>
                <footer><button id="tts-import-cancel" class="secondary-button" type="button">${t("cancel")}</button><button id="tts-import-submit" class="primary-button" type="submit">${t("ttsImportAction")}</button></footer>
              </form>
            </dialog>
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
        <section id="view-statistics" class="view statistics-view" hidden></section>
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
                <label class="tts-reader-voice"><span>${t("ttsReaderVoice")}</span><select id="tts-reader-voice"></select></label>
                <div class="tts-current"><span id="tts-page-context">${t("ttsCurrentPage")}</span><p id="tts-passage"></p><small id="tts-active-voice"></small></div>
                <div class="tts-transport" role="group" aria-label="${t("textToSpeech")}"><button id="tts-previous" type="button" aria-label="${t("ttsPreviousPage")}">${svg("previousTrack", 20)}</button><button id="tts-play-pause" class="tts-play" type="button" aria-label="${t("ttsPlay")}">${svg("play", 23)}</button><button id="tts-stop" type="button" aria-label="${t("speechStop")}">${svg("stop", 18)}</button><button id="tts-next" type="button" aria-label="${t("ttsNextPage")}">${svg("nextTrack", 20)}</button></div>
                <label class="reader-option-line tts-player-rate" for="tts-rate-reader"><span>${t("ttsReadingPace")}</span><input id="tts-rate-reader" type="range" min="0.5" max="2" step="0.1" /><output id="tts-rate-reader-value">1×</output></label>
                <label class="reader-option-line tts-player-rate" for="tts-pitch-reader"><span>${t("ttsPitch")}</span><input id="tts-pitch-reader" type="range" min="0.5" max="2" step="0.1" aria-describedby="tts-pitch-help" /><output id="tts-pitch-reader-value">1×</output></label>
                <small id="tts-pitch-help" class="tts-control-help"></small>
                <button id="tts-system-fallback" class="text-link" type="button" hidden>${t("ttsFallbackSystem")}</button>
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
              <section id="note-visibility-panel" class="reader-option-panel reader-note-visibility-panel" data-reader-panel="notes" hidden>
                <div class="reader-panel-heading"><span>${svg("notes", 18)}</span><h3>${t("readerNotes")}</h3></div>
                <label class="reader-note-visibility-control" for="reader-show-notes">
                  <span class="reader-note-visibility-copy"><strong>${t("readerShowNotes")}</strong><small>${t("readerShowNotesHelp")}</small></span>
                  <span class="reader-switch"><input id="reader-show-notes" type="checkbox" checked /><span aria-hidden="true"></span></span>
                </label>
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

function mountNativeTitlebar(): void {
  if (!isWindowsDesktop) return;
  const appWindow = getCurrentWindow();
  const maximizeButton = $<HTMLButtonElement>("#window-maximize");
  const updateMaximizeButton = async (): Promise<void> => {
    const maximized = await appWindow.isMaximized();
    maximizeButton.classList.toggle("is-maximized", maximized);
    const label = maximized ? windowLabels.restore : windowLabels.maximize;
    maximizeButton.setAttribute("aria-label", label);
    maximizeButton.title = label;
  };
  $<HTMLButtonElement>("#window-minimize").addEventListener("click", () => void appWindow.minimize());
  maximizeButton.addEventListener("click", () => void appWindow.toggleMaximize().then(updateMaximizeButton));
  $<HTMLButtonElement>("#window-close").addEventListener("click", () => void appWindow.close());
  void updateMaximizeButton();
  void appWindow.onResized(() => void updateMaximizeButton());
}

mountNativeTitlebar();
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

type View = "home" | "library" | "settings" | "reader" | "profile" | "statistics" | "details";
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
let temporaryNavigationSource: "note" | "other" | null = null;
let pdfPosition = { page: 1, offset: 0 };
let epubPosition = { cfi: "", label: "" };
let readerJumpBusy = false;
let searchHighlight: string | undefined;
let pagePreviewActive = false;
interface PageTurn { snapshot: HTMLElement; live: HTMLElement; preview?: Rendition; preloadOnly?: boolean; origin: ReaderPosition; direction: -1|1; dx: number; width: number; sequence: number; ready: Promise<void>; readySettled: boolean; failed: boolean; ending: boolean }
let pageTurn: PageTurn | undefined;
const pageTurnAnimationKey = "autumn-page-turn-animation";
let pageTurnAnimationEnabled = localStorage.getItem(pageTurnAnimationKey) !== "off";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const animatePageTurn = (): boolean => pageTurnAnimationEnabled && !reducedMotion.matches;
let globalPagePreferences = loadPagePreferences();
let desktopGeneralPreferences = loadDesktopGeneralPreferences();
let ttsPreferences: TtsGlobalPreferences = loadTtsPreferences();
let bookTtsPreferences: BookTtsPreferences = { rate: 1, pitch: 1, voiceId: "" };
let ttsVoices: TtsVoice[] = [];
let ttsInstalled: InstalledPackage[] = [];
let ttsImportedVoices: CatalogVoice[] = [];
let ttsRuntime: TtsRuntimeStatus = { available: false, version: "", platform: "web", architecture: "", supportsPiper: false, supportsKokoro: false, memoryMb: undefined };
let ttsState: "idle" | "playing" | "paused" = "idle";
let ttsSequence = 0;
let ttsChunks: string[] = [];
let ttsChunkIndex = 0;
let ttsSource: SpeechSource | undefined;
let ttsChunkOffsets: { start: number; end: number }[] = [];
const localTtsPlayer = new LocalTtsPlayer();
const ttsPreviewPlayer = new LocalTtsPlayer();
let localTtsPrefetch: { index: number; request: ReturnType<typeof synthesizeLocal> } | undefined;
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
let readerNotesVisible = true;
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
  if (view === "reader" && next !== "reader") readingActivity.stop();
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
    statistics: [({ es: "Estadísticas de lectura", en: "Reading statistics", it: "Statistiche di lettura", fr: "Statistiques de lecture" } as Record<Language, string>)[language], ({ es: "Tu actividad y hábitos de lectura", en: "Your reading activity and habits", it: "La tua attività e le tue abitudini di lettura", fr: "Votre activité et vos habitudes de lecture" } as Record<Language, string>)[language]],
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

function readerPreferenceKey(kind: "theme" | "brightness" | "notes", book = currentBook): string | null {
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
  const notesKey = readerPreferenceKey("notes", book);
  readerNotesVisible = (notesKey ? localStorage.getItem(notesKey) : null) !== "hidden";
  $<HTMLInputElement>("#reader-show-notes").checked = readerNotesVisible;
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

function standardizeEpubPage(contents: Contents): Promise<void> {
  // EPUB chapters are separate documents; app-level CSS cannot reach their scroll containers.
  if (!contents.document.getElementById("autumn-scrollbars")) {
    const style = contents.document.createElement("style");
    style.id = "autumn-scrollbars";
    style.textContent = "html, body, * { scrollbar-width: none !important; } html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }";
    contents.document.head.append(style);
  }
  if (epubBook?.packaging?.metadata?.layout === "pre-paginated") return waitForStableTypography(contents.document);
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
  return waitForStableTypography(contents.document);
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
  const { featured, shelf } = homeReadingSelection(books);
  const recentList = $<HTMLDivElement>("#recent-list");
  recentList.replaceChildren(...(shelf.length
    ? shelf.map((book) => presentationCard(book, coverElement, (item) => void openBook(item), false))
    : featured ? [] : [emptyState(t("homeReadingEmpty"))]));
  $<HTMLElement>("#recent-shelf").hidden = Boolean(featured && !shelf.length);
  homeCarousel?.update();

  const heroAction = $<HTMLButtonElement>("#hero-action");
  const hero = $<HTMLElement>("#home-hero");
  hero.classList.toggle("hero-empty", !featured);
  $<HTMLElement>("#hero-eyebrow").textContent = featured ? t("continueReading") : t("welcome");
  $<HTMLElement>("#hero-title").textContent = featured ? titleOf(featured) : t(books.length ? "homeHeroNoCurrentTitle" : "homeHeroEmptyTitle");
  $<HTMLElement>("#hero-author").textContent = featured ? featured.author?.trim() || t("authorUnknown") : "";
  $<HTMLElement>("#hero-description").textContent = featured ? "" : t(books.length ? "homeHeroNoCurrentDescription" : "homeHeroEmptyDescription");
  const art = $<HTMLElement>("#hero-art");
  art.replaceChildren();
  if (featured) {
    const featuredCover = coverElement(featured);
    hero.classList.toggle("hero-cover-image", !featuredCover.classList.contains("book-cover-fallback"));
    art.append(featuredCover);
  } else {
    hero.classList.remove("hero-cover-image");
    const leaf = document.createElement("img"); leaf.src = leafUrl; leaf.alt = ""; art.append(leaf);
  }
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
  if (view === "reader" && !pagePreviewActive && !readerJumpBusy && !layoutBusy) {
    const marker = currentBook.format === "pdf" ? `pdf:${pdfPosition.page}:${pdfTextView?.index ?? 0}` : (rendition?.location?.start?.cfi ?? "");
    readingActivity.position(marker);
  }
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
  // Reflowable PDFs use the same typography and page-layout preferences as EPUBs.
  // Original PDF pages preserve their authored layout and therefore expose only zoom.
  $<HTMLElement>("#book-layout-details").hidden = currentBook.format !== "epub" && !pdfTextView;
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
  const visitingNote = readerHistory.temporary && temporaryNavigationSource === "note";
  const historyBack = $<HTMLButtonElement>("#history-back");
  const historyForward = $<HTMLButtonElement>("#history-forward");
  historyBack.hidden = historyForward.hidden = visitingNote;
  historyBack.disabled = !readerHistory.canBack || readerJumpBusy;
  historyForward.disabled = !readerHistory.canForward || readerJumpBusy;
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
  temporaryNavigationSource = "other";
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
  temporaryNavigationSource = "other";
  const from = capturePosition(); readerHistory.jump(from, from); readerJumpBusy = true; updateHistory();
  try { ++readerPositionRevision; restoringRemotePosition = false; await displayEpub(href); readerHistory.observe(capturePosition()); }
  finally { readerJumpBusy = false; updateHistory(); }
}
async function jumpToPdfReference(destination: unknown): Promise<void> {
  if (!pdfDocument || readerJumpBusy) return;
  const sequence = loadSequence, target = await pdfDestination(pdfDocument, destination);
  if (sequence !== loadSequence) return;
  const position: ReaderPosition = { format: "pdf", page: target.page, offset: 0, scrollTop: 0, scrollLeft: 0 };
  temporaryNavigationSource = "other";
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
  temporaryNavigationSource = "note";
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
    const visibleNotes = readerNotesVisible ? currentBook?.notes ?? [] : [];
    const active = new Map(visibleNotes.filter((n):n is BookNote & {format:"epub";cfi:string}=>n.format==="epub").map(n=>[n.cfi,n.color]));
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
  if (!readerNotesVisible || !currentBook || !currentBook.notes?.length || view !== "reader") return;
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
  readingActivity.stop();
  stopTts();
  translationUI?.close(); selectedTranslationText=""; noteHighlights.clear();
  ++pdfNavigationToken; pdfNavigationBusy = false;
  pageTurn?.snapshot.remove(); pageTurn?.preview?.destroy(); if(pageTurn?.live !== readerContent)pageTurn?.live.remove(); pageTurn = undefined; pagePreviewActive = false; resetPageTransform();
  searchUI?.close(); searchUI?.setSource(); readerHistory.commit(); temporaryNavigationSource = null; updateHistory();
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
    sheet.style.width = `${availableWidth}px`;
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
  bookTtsPreferences = loadBookTtsPreferences(book.ownerId ?? auth.state.ownerId ?? "local", book.id);
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
        const typographyReady = standardizeEpubPage(contents);
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
        // El contenido EPUB está en un iframe: sus clics no llegan al documento principal.
        contents.document.addEventListener("pointerdown", () => {
          if (!$<HTMLDivElement>("#note-menu").hidden) hideNoteMenu();
        }, { capture: true });
        contents.document.addEventListener("selectionchange", () => scheduleTouchNote(selectedText));
        contents.document.addEventListener("keydown", handleReaderKeydown);
        contents.document.addEventListener("wheel", handleReaderWheel, { passive: false });
        contents.document.addEventListener("click", event => {
          const link = (event.target as Element | null)?.closest("a[href]");
          const href = link?.getAttribute("href");
          if (href && !/^(?:[a-z]+:|\/\/)/i.test(href)) { temporaryNavigationSource = "other"; const from = capturePosition(); readerHistory.jump(from, from); updateHistory(); }
        }, { capture: true });
        return typographyReady;
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
    readingActivity.start(book.ownerId ?? auth.state.ownerId ?? "local", book.id, book.format);
    await persistCurrent();
    updatePosition();
    renderSidebarNotes();
    if (book.contentMetadataVersion !== BOOK_CONTENT_METADATA_VERSION) void refreshBookContent(book);
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
    if (!visible || updated.contentMetadataVersion !== BOOK_CONTENT_METADATA_VERSION) return;
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
    const active = rendition;
    if (preview) {
      await settledPageMove({
        move: () => direction < 0 ? active.prev() : active.next(),
        onRelocated: handler => active.on("relocated", handler),
        offRelocated: handler => active.off("relocated", handler),
        reportLocation: () => active.reportLocation(),
        documents: () => {
          const contents: unknown = active.getContents();
          return Array.isArray(contents)
            ? (contents as Contents[]).map(item => item.document)
            : [];
        },
      });
    } else await (direction < 0 ? active.prev() : active.next());
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
  const sheet = snapshot;
  if (!preloadOnly) { sheet.classList.add("page-turn-sheet"); sheet.dataset.turnDirection=String(direction); }
  const turn: PageTurn = { snapshot, live: readerContent, preloadOnly, origin: capturePosition(), direction, dx: 0, width: readingSurface.clientWidth, sequence: loadSequence, ready: Promise.resolve(), readySettled: false, failed: false, ending: false };
  pageTurn = turn; pagePreviewActive = true;
  $<HTMLButtonElement>("#previous-button").disabled = true;
  $<HTMLButtonElement>("#next-button").disabled = true;
  if (!preloadOnly) { readingSurface.classList.add("page-turning"); readerContent.style.willChange = "transform"; }
  if (epubBook && rendition && turn.origin.format === "epub") {
    // The auxiliary rendition is deliberately a cover of the current page,
    // never a speculative rendition of the destination. Independent EPUB.js
    // renditions can paginate the same spine differently by one page while an
    // iframe or font is settling. The real rendition advances underneath this
    // cover and only its confirmed destination is revealed by the animation.
    const cover = readerContent.cloneNode(false) as HTMLElement; cover.removeAttribute("id"); cover.setAttribute("aria-hidden","true"); cover.classList.remove("page-turn-sheet"); delete cover.dataset.turnDirection;
    cover.classList.add("page-turn-preview"); const rect = readerContent.getBoundingClientRect(), bounds = readingSurface.getBoundingClientRect();
    cover.style.cssText = `position:absolute;left:${rect.left-bounds.left}px;top:${rect.top-bounds.top}px;width:${rect.width}px;height:${rect.height}px;min-height:0;z-index:8;pointer-events:none;will-change:transform;contain:layout paint;backface-visibility:hidden;transform-style:flat`;
    const frame = document.createElement("div"); frame.className="epub-frame"; cover.append(frame); readingSurface.append(cover);
    snapshot.remove(); turn.snapshot=cover; turn.live=readerContent;
    if (!preloadOnly) { cover.classList.add("page-turn-sheet"); cover.dataset.turnDirection=String(direction); }
    const viewport = epubViewportSize(frame);
    const preview = epubBook.renderTo(frame,{width:"100%",height:"100%",flow:"paginated",spread:columnCount(pagePreferences.columns,viewport.width,viewport.height)===2?"always":"none"}); epubBook.rendition=rendition; turn.preview=preview;
    preview.hooks.content.register((contents: Contents)=>standardizeEpubPage(contents));
    preview.themes.fontSize(`${currentBook.fontSize}%`); preview.themes.font(fontCss(bookFont));
    const previewColors = bookReaderColors();
    cover.style.background = previewColors.background; frame.style.background = previewColors.background;
    preview.themes.default({ body: previewColors });
    cover.style.visibility="hidden"; cover.style.transform="translate3d(0,0,0)";
    turn.ready=(async()=>{
      await preview.display((turn.origin as Extract<ReaderPosition,{format:"epub"}>).cfi);
      const contents: unknown = preview.getContents();
      if (Array.isArray(contents)) await Promise.all((contents as Contents[]).map(item => waitForStableTypography(item.document)));

      // Freeze the current-page cover into a stable compositor layer before it
      // is placed over the real reader. The destination is never rendered here.
      cover.style.opacity = "0.999";
      void cover.getBoundingClientRect();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      cover.style.opacity = "1";
    })();
  } else {
    readerContent.style.visibility = "hidden"; readerContent.style.transform = `translate3d(${direction * turn.width}px,0,0)`;
    turn.ready = navigate(direction, true);
  }
  turn.ready = turn.ready.then(() => {
    turn.readySettled = true;
    if (pageTurn !== turn) return;
    if (!turn.preloadOnly) {
      readerContent.style.visibility = "";
      turn.snapshot.style.visibility="";turn.snapshot.dataset.ready="true";
      dragPageTurn(turn.dx);
    }
  }).catch(error => { turn.readySettled = true; turn.failed = true; if(pageTurn === turn)showToast(errorMessage(error)); });
}
function dragPageTurn(dx: number): void {
  const turn = pageTurn; if (!turn || turn.ending) return;
  turn.dx = Math.max(-turn.width, Math.min(turn.width, turn.direction === 1 ? Math.min(0, dx) : Math.max(0, dx)));
  turn.snapshot.style.transform = pageTurnSheetTransform(turn.dx,turn.width,turn.direction);
  if (!turn.preview) turn.live.style.transform = `translate3d(${turn.direction * turn.width + turn.dx}px,0,0)`;
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
      turn.snapshot.classList.add("page-turn-sheet"); turn.snapshot.dataset.turnDirection = String(direction);
      turn.snapshot.style.willChange = "transform";
      turn.snapshot.style.visibility = ""; turn.snapshot.dataset.ready = "true";
    }
    if (turn.preview && commit && direction === turn.direction) {
      // Fully cover the live iframe while EPUB.js moves it. This is the key
      // ordering guarantee: only a settled real destination can be revealed.
      turn.snapshot.style.transform = "translate3d(0,0,0)";
      readerContent.style.transform = "";
      await navigate(turn.direction,true);
      if (pageTurn !== turn || turn.sequence !== loadSequence) return;
      turn.snapshot.dataset.destinationReady = "true";
    }
    const position = capturePosition();
    const changed = position.format === "pdf" && turn.origin.format === "pdf" ? position.page !== turn.origin.page || Math.abs(position.offset-turn.origin.offset) > .0001 : position.format === "epub" && turn.origin.format === "epub" && position.cfi !== turn.origin.cfi;
    commit &&= direction === turn.direction && changed;
    const duration = turn.readySettled && animatePageTurn() && (commit || Math.abs(turn.dx) > 4) ? 360 : 0;
    await Promise.all([
      slide(turn.snapshot, commit ? -turn.direction * turn.width : 0, duration,{width:turn.width,direction:turn.direction}),
      ...(turn.preview ? [] : [slide(turn.live, commit ? 0 : turn.direction * turn.width, duration)]),
    ]);
    if (pageTurn !== turn) return;
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

for (const button of document.querySelectorAll<HTMLButtonElement>(".nav-button[data-view]")) {
  button.addEventListener("click", () => {
    const next = button.dataset.view as View;
    setView(next);
    if (next === "profile") location.hash = "/profile";
  });
}
$("#brand-home").addEventListener("click", () => setView("home"));
const shellElement = $<HTMLElement>(".shell");
const collapseButton = $<HTMLButtonElement>("#sidebar-collapse");
const sidebarCollapsedKey = "autumn-sidebar-collapsed";
const applySidebarCollapsed = (collapsed: boolean): void => {
  shellElement.classList.toggle("sidebar-collapsed", collapsed);
  collapseButton.setAttribute("aria-pressed", String(collapsed));
  collapseButton.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
};
applySidebarCollapsed(localStorage.getItem(sidebarCollapsedKey) !== "false");
collapseButton.addEventListener("click", () => {
  const collapsed = !shellElement.classList.contains("sidebar-collapsed");
  localStorage.setItem(sidebarCollapsedKey, String(collapsed));
  applySidebarCollapsed(collapsed);
});
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
  $<HTMLElement>("#note-visibility-panel").hidden = layout;
  readerOptions.scrollTop = 0;
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
  const allowed = ttsAvailable() || installedCatalogVoices().length > 0;
  trigger.hidden = !allowed;
  sidebarTrigger.hidden = !allowed;
  if (!allowed && activeReaderSidebarTab === "tts") setReaderSidebarTab("contents");
  if (!allowed && activeReaderOptionsTrigger === trigger) closeReaderOptions();
  renderReaderVoiceOptions();
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
const leaveReader = async (): Promise<void> => {
  closeReaderOptions();
  await persistCurrent();
  setView(lastCollectionView);
};
$("#back-button").addEventListener("click", () => void leaveReader());
$("#desktop-reader-back").addEventListener("click", () => void leaveReader());
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
  return usesNativeSystemTts() || Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
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

function engineAvailable(engine: TtsEngineId): boolean {
  if (engine === "system") return ttsAvailable();
  return ttsRuntime.available && (engine === "piper" ? ttsRuntime.supportsPiper : ttsRuntime.supportsKokoro);
}

function installedCatalogVoices(engine?: TtsEngineId): CatalogVoice[] {
  const installed = new Set(ttsInstalled.filter(item => item.installed).map(item => item.packageId));
  return [...knownVoices, ...ttsImportedVoices].filter(voice => installed.has(voice.packageId) && (!engine || voice.engine === engine));
}

function activeCatalogVoice(): CatalogVoice | undefined {
  if (ttsPreferences.engine === "system") return undefined;
  const available = installedCatalogVoices(ttsPreferences.engine);
  const local = available.find(voice => voice.id === bookTtsPreferences.voiceId);
  const global = available.find(voice => voice.id === ttsPreferences.voices[ttsPreferences.engine]);
  const code = ttsLanguage().slice(0, 2).toLowerCase();
  return local ?? global ?? available.find(voice => voice.locale.toLowerCase().startsWith(code)) ?? available[0];
}

function activeSystemVoice(): TtsVoice | undefined {
  const override = bookTtsPreferences.voiceId.startsWith("system:") ? bookTtsPreferences.voiceId.slice(7) : "";
  return preferredVoice(ttsVoices, override || ttsPreferences.voices.system, ttsLanguage());
}

function saveCurrentBookTts(): void {
  if (!currentBook) return;
  bookTtsPreferences = saveBookTtsPreferences(currentBook.ownerId ?? auth.state.ownerId ?? "local", currentBook.id, bookTtsPreferences);
}

function currentTtsSource(): SpeechSource {
  const regions: SpeechSourceRegion[] = [];
  if (currentBook?.format === "pdf") {
    if (pdfTextView) regions.push({ root: pdfTextView.flow, bounds: pdfTextView.viewport.getBoundingClientRect() });
    const layer = readerContent.querySelector<HTMLElement>(".pdf-text-layer");
    const bounds = readerContent.querySelector<HTMLElement>(".pdf-page")?.getBoundingClientRect();
    if (!pdfTextView && layer && bounds) regions.push({ root: layer, bounds });
    return collectVisibleSpeechSource(regions);
  }
  const contents = rendition?.getContents();
  if (!Array.isArray(contents)) return { text: "", segments: [] };
  for (const item of contents as Contents[]) {
    const frame = item.document.defaultView?.frameElement as HTMLElement | null;
    const frameRect = frame?.getBoundingClientRect();
    const clipRect = frame?.closest<HTMLElement>(".epub-frame")?.getBoundingClientRect();
    if (!frameRect || !clipRect || frameRect.width <= 0 || frameRect.height <= 0) {
      regions.push({ root: item.document.body, bounds: { left: 0, top: 0, right: item.window.innerWidth, bottom: item.window.innerHeight } });
      continue;
    }
    // EPUB.js paginates a section in one wide iframe and slides that iframe
    // behind the reader frame. Convert the clipped host rectangle back into
    // iframe coordinates so speech starts at the displayed spread, not x=0.
    const scaleX = item.window.innerWidth / frameRect.width;
    const scaleY = item.window.innerHeight / frameRect.height;
    regions.push({ root: item.document.body, bounds: {
      left: Math.max(0, clipRect.left - frameRect.left) * scaleX,
      top: Math.max(0, clipRect.top - frameRect.top) * scaleY,
      right: Math.min(frameRect.width, clipRect.right - frameRect.left) * scaleX,
      bottom: Math.min(frameRect.height, clipRect.bottom - frameRect.top) * scaleY,
    } });
  }
  return collectVisibleSpeechSource(regions);
}

function currentTtsText(): string { return currentTtsSource().text; }

function speechChunks(text: string): string[] {
  return splitSpeechText(text, 650, 700);
}

function nativeSpeechChunks(text: string): string[] {
  return splitSpeechText(text, 220, 280);
}

function updateTtsPlayer(text = currentTtsText()): void {
  const status = $<HTMLOutputElement>("#tts-player-status");
  status.textContent = t(ttsState === "playing" ? "ttsPlayerReading" : ttsState === "paused" ? "ttsPlayerPaused" : "ttsPlayerReady");
  const play = $<HTMLButtonElement>("#tts-play-pause");
  const playing = ttsState === "playing";
  play.innerHTML = svg(playing ? "pause" : "play", 23);
  play.setAttribute("aria-label", t(playing ? "ttsPause" : ttsState === "paused" ? "ttsResume" : "ttsPlay"));
  play.setAttribute("aria-pressed", String(ttsState !== "idle"));
  $<HTMLButtonElement>("#tts-stop").disabled = ttsState === "idle";
  const epubLocation = currentBook?.format === "epub" ? rendition?.location : undefined;
  const pagePreviousDisabled = $<HTMLButtonElement>("#previous-button").disabled || Boolean(epubLocation?.atStart);
  const pageNextDisabled = $<HTMLButtonElement>("#next-button").disabled || Boolean(epubLocation?.atEnd);
  $<HTMLButtonElement>("#tts-previous").disabled = ttsState === "idle" ? pagePreviousDisabled : ttsChunkIndex <= 0 && pagePreviousDisabled;
  $<HTMLButtonElement>("#tts-next").disabled = ttsState === "idle" ? pageNextDisabled : ttsChunkIndex >= ttsChunks.length - 1 && pageNextDisabled;
  const position = $("#position-label").textContent?.trim();
  $("#tts-page-context").textContent = position && position !== "—" ? `${t("ttsCurrentPage")} · ${position}` : t("ttsCurrentPage");
  $("#tts-passage").textContent = text ? `${text.slice(0, 165)}${text.length > 165 ? "…" : ""}` : t("noSelectableText");
  const systemVoice = activeSystemVoice();
  const catalogVoice = activeCatalogVoice();
  $("#tts-active-voice").textContent = t("ttsVoiceActive", { voice: catalogVoice?.name ?? (systemVoice ? ttsVoiceLabel(systemVoice) : t("ttsDefaultVoice")) });
  $<HTMLInputElement>("#tts-rate-reader").value = String(bookTtsPreferences.rate);
  $<HTMLOutputElement>("#tts-rate-reader-value").textContent = formatTtsRate(bookTtsPreferences.rate);
  const pitch = $<HTMLInputElement>("#tts-pitch-reader");
  pitch.value = String(bookTtsPreferences.pitch);
  pitch.disabled = !ttsEngines[ttsPreferences.engine].capabilities.pitch;
  $<HTMLOutputElement>("#tts-pitch-reader-value").textContent = formatTtsRate(bookTtsPreferences.pitch);
  $("#tts-pitch-help").textContent = pitch.disabled ? t("ttsPitchUnavailable") : "";
  renderReaderVoiceOptions();
}

function cancelTtsWork(): number {
  ttsSequence += 1;
  if (usesNativeSystemTts()) void nativeStop().catch(error => console.warn("Native TTS stop failed", error));
  void cancelLocalSynthesis().catch(error => console.warn("Local TTS cancellation failed", error));
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  localTtsPlayer.stop();
  localTtsPrefetch = undefined;
  const speechPanel = document.querySelector<HTMLElement>("#speech-panel");
  speechPanel?.removeAttribute("aria-busy");
  return ttsSequence;
}

function stopTts(update = true): void {
  cancelTtsWork();
  clearSpeechHighlight();
  ttsState = "idle"; ttsChunks = []; ttsChunkIndex = 0; ttsSource = undefined; ttsChunkOffsets = [];
  if (update && document.querySelector("#tts-player-status")) updateTtsPlayer();
}

function ttsPageKey(): string {
  const position = capturePosition();
  return position.format === "pdf" ? `${position.page}:${pdfTextView?.index ?? position.offset}` : position.cfi;
}

function highlightTtsInterval(start: number, end: number): void {
  setSpeechHighlight(ttsSource, start, end);
}

function highlightTtsChunk(index = ttsChunkIndex): void {
  const offset = ttsChunkOffsets[index];
  if (offset) highlightTtsInterval(offset.start, offset.end);
}

function highlightTtsWord(index: number, characterIndex: number, characterLength = 0): void {
  const text = ttsChunks[index];
  const chunk = ttsChunkOffsets[index];
  if (!text || !chunk) return;
  let wordStart = Math.max(0, Math.min(text.length - 1, characterIndex));
  while (wordStart < text.length && /\s/u.test(text[wordStart])) wordStart += 1;
  if (!characterLength) while (wordStart > 0 && !/\s/u.test(text[wordStart - 1])) wordStart -= 1;
  let wordEnd = characterLength ? Math.min(text.length, wordStart + characterLength) : wordStart;
  while (!characterLength && wordEnd < text.length && !/\s/u.test(text[wordEnd])) wordEnd += 1;
  highlightTtsInterval(chunk.start + wordStart, Math.min(chunk.end, chunk.start + Math.max(wordStart + 1, wordEnd)));
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
  const voice = activeSystemVoice();
  if (usesNativeSystemTts()) {
    highlightTtsChunk();
    void nativeSpeak({ text, voiceUri: voice?.voiceURI ?? "", language: voice?.lang ?? ttsLanguage(), rate: bookTtsPreferences.rate, pitch: bookTtsPreferences.pitch })
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
  highlightTtsWord(ttsChunkIndex, 0);
  if (voice) speech.voice = voice;
  speech.lang = voice?.lang ?? ttsLanguage();
  speech.rate = bookTtsPreferences.rate;
  speech.pitch = bookTtsPreferences.pitch;
  speech.onboundary = event => {
    if (sequence !== ttsSequence || (ttsState as string) === "idle") return;
    const chunk = ttsChunkOffsets[ttsChunkIndex];
    if (!chunk || event.charIndex < 0 || event.charIndex >= text.length) return;
    highlightTtsWord(ttsChunkIndex, event.charIndex, event.charLength);
  };
  speech.onend = () => {
    if (sequence !== ttsSequence) return;
    ttsChunkIndex += 1;
    speakTtsChunk(sequence);
  };
  speech.onerror = () => { if (sequence === ttsSequence) stopTts(); };
  window.speechSynthesis.speak(speech);
}

function localTtsError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  if (code.includes("TTS_VOICE_NOT_INSTALLED")) return t("ttsVoiceRequired");
  if (code.includes("TTS_MODEL_CORRUPT")) return t("ttsModelCorrupt");
  if (code.includes("TTS_INSUFFICIENT") || code.includes("TTS_STORAGE_FAILED")) return t("ttsNoStorage");
  if (code.includes("TTS_ENGINE_UNAVAILABLE")) return t("ttsUnavailableDevice");
  if (code.includes("TTS_IMPORT_ARCHIVE_INVALID") || code.includes("TTS_IMPORT_MODEL_INVALID")) return t("ttsImportInvalidModel");
  if (code.includes("TTS_IMPORT_VOICE_INVALID")) return t("ttsImportInvalidVoice");
  if (code.includes("TTS_IMPORT_VOICE_LIMIT")) return t("ttsImportVoiceLimit");
  if (code.includes("TTS_KOKORO_BASE_REQUIRED")) return t("ttsKokoroBaseRequired");
  if (code.includes("TTS_KOKORO_BASE_INCOMPATIBLE")) return t("ttsKokoroBaseIncompatible");
  if (code.includes("TTS_IMPORT_SYNTHESIS_FAILED")) return t("ttsImportSynthesisFailed");
  if (code.includes("TTS_IMPORT_LOCALE_INVALID")) return t("ttsImportInvalidLocale");
  if (code.includes("TTS_IMPORT_NAME_INVALID") || code.includes("TTS_IMPORT_SPEAKER_INVALID")) return t("ttsImportInvalidMetadata");
  if (code.includes("TTS_IMPORT_READ_FAILED") || code.includes("TTS_IMPORT_PATH_INVALID")) return t("ttsImportReadFailed");
  return t("ttsInitializeFailed");
}

function localChunkRequest(index: number): ReturnType<typeof synthesizeLocal> {
  const voice = activeCatalogVoice();
  if (!voice) return Promise.reject(new Error("TTS_VOICE_NOT_INSTALLED"));
  return synthesizeLocal(voice.id, ttsChunks[index], bookTtsPreferences.rate);
}

async function playLocalChunk(sequence: number): Promise<void> {
  if (sequence !== ttsSequence || ttsState === "idle") return;
  const text = ttsChunks[ttsChunkIndex];
  if (!text) { void advanceTtsPage(sequence); return; }
  highlightTtsWord(ttsChunkIndex, 0);
  const panel = $<HTMLElement>("#speech-panel");
  panel.setAttribute("aria-busy", "true");
  try {
    const request = localTtsPrefetch?.index === ttsChunkIndex ? localTtsPrefetch.request : localChunkRequest(ttsChunkIndex);
    localTtsPrefetch = undefined;
    const result = await request;
    if (sequence !== ttsSequence || (ttsState as string) === "idle") return;
    if (ttsChunks[ttsChunkIndex + 1]) {
      const nextRequest = localChunkRequest(ttsChunkIndex + 1);
      nextRequest.catch(() => undefined);
      localTtsPrefetch = { index: ttsChunkIndex + 1, request: nextRequest };
    }
    panel.removeAttribute("aria-busy");
    await localTtsPlayer.load(result, {
      ended: () => {
        if (sequence !== ttsSequence || ttsState === "idle") return;
        ttsChunkIndex += 1;
        void playLocalChunk(sequence);
      },
      error: () => {
        if (sequence !== ttsSequence) return;
        stopTts();
        $<HTMLButtonElement>("#tts-system-fallback").hidden = false;
        showToast(t("ttsInitializeFailed"));
      },
      progress: ratio => highlightTtsWord(ttsChunkIndex, Math.floor(text.length * ratio)),
    }, ttsState === "playing");
  } catch (error) {
    if (sequence !== ttsSequence) return;
    console.error("Local neural TTS failed", error);
    stopTts();
    $<HTMLButtonElement>("#tts-system-fallback").hidden = false;
    showToast(localTtsError(error));
  }
}

function startTtsPage(): void {
  if (!engineAvailable(ttsPreferences.engine)) { showToast(t("speechUnavailable")); return; }
  if (ttsPreferences.engine !== "system" && !activeCatalogVoice()) { showToast(t("ttsVoiceRequired")); return; }
  const source = currentTtsSource();
  const text = source.text;
  if (!text) { showToast(t("noSelectableText")); stopTts(); return; }
  const sequence = ++ttsSequence;
  ttsSource = source;
  ttsChunks = ttsPreferences.engine === "system" && usesNativeSystemTts() ? nativeSpeechChunks(text) : speechChunks(text);
  ttsChunkOffsets = locateSpeechChunks(text, ttsChunks);
  ttsChunkIndex = 0; ttsState = "playing";
  updateTtsPlayer(text);
  if (ttsPreferences.engine !== "system") { void playLocalChunk(sequence); return; }
  if (usesNativeSystemTts()) {
    void nativeStop().catch(() => undefined).then(() => {
      if (sequence === ttsSequence && ttsState === "playing") speakTtsChunk(sequence);
    });
  } else {
    window.speechSynthesis.cancel();
    speakTtsChunk(sequence);
  }
}

function restartCurrentTtsChunk(): void {
  if (ttsState === "idle" || !ttsChunks[ttsChunkIndex]) return;
  const sequence = cancelTtsWork();
  ttsState = "playing";
  updateTtsPlayer();
  if (ttsPreferences.engine === "system") speakTtsChunk(sequence);
  else void playLocalChunk(sequence);
}

async function toggleTtsPlayback(): Promise<void> {
  if (!engineAvailable(ttsPreferences.engine)) { showToast(t("speechUnavailable")); return; }
  if (ttsState === "playing") {
    try {
      if (ttsPreferences.engine !== "system") localTtsPlayer.pause();
      else if (usesNativeSystemTts()) await nativePause(); else window.speechSynthesis.pause();
      ttsState = "paused"; updateTtsPlayer();
    } catch (error) { console.error("TTS pause failed", error); showToast(t("speechUnavailable")); }
    return;
  }
  if (ttsState === "paused") {
    try {
      if (ttsPreferences.engine !== "system") {
        if (localTtsPlayer.loaded) await localTtsPlayer.resume(); else void playLocalChunk(ttsSequence);
      } else if (usesNativeSystemTts()) await nativeResume(); else window.speechSynthesis.resume();
      ttsState = "playing"; updateTtsPlayer();
    } catch (error) { console.error("TTS resume failed", error); showToast(t("speechUnavailable")); }
    return;
  }
  startTtsPage();
}

async function navigateTts(direction: -1 | 1): Promise<void> {
  if ($(direction < 0 ? "#tts-previous" : "#tts-next").hasAttribute("disabled")) return;
  if (ttsState !== "idle") {
    const target = ttsChunkIndex + direction;
    if (target >= 0 && target < ttsChunks.length) {
      const sequence = cancelTtsWork();
      ttsChunkIndex = target;
      ttsState = "playing";
      updateTtsPlayer();
      if (ttsPreferences.engine === "system") speakTtsChunk(sequence); else await playLocalChunk(sequence);
      return;
    }
  }
  stopTts(false);
  await turnPage(direction);
  if (view === "reader") startTtsPage();
}

function localeName(locale: string): string {
  try { return new Intl.DisplayNames([language], { type: "language" }).of(locale) ?? locale; }
  catch { return locale; }
}

function renderReaderVoiceOptions(): void {
  const select = document.querySelector<HTMLSelectElement>("#tts-reader-voice");
  if (!select) return;
  select.replaceChildren();
  if (ttsPreferences.engine === "system") {
    for (const voice of ttsVoices) select.add(new Option(ttsVoiceLabel(voice), `system:${voice.voiceURI}`));
    const active = activeSystemVoice();
    select.value = bookTtsPreferences.voiceId.startsWith("system:") ? bookTtsPreferences.voiceId : active ? `system:${active.voiceURI}` : "";
  } else {
    for (const voice of installedCatalogVoices(ttsPreferences.engine)) select.add(new Option(`${localeName(voice.locale)} · ${voice.name}`, voice.id));
    select.value = activeCatalogVoice()?.id ?? "";
  }
  if (!select.options.length) select.add(new Option(t("ttsNoVoices"), ""));
  select.disabled = select.options.length === 1 && !select.options[0].value;
}

function engineHelp(engine: TtsEngineId): string {
  return t(engine === "system" ? "ttsEngineSystemHelp" : engine === "piper" ? "ttsEnginePiperHelp" : "ttsEngineKokoroHelp");
}

function renderTtsEngineControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-tts-engine]").forEach(button => {
    const engine = button.dataset.ttsEngine as TtsEngineId;
    const selected = engine === ttsPreferences.engine;
    button.setAttribute("aria-checked", String(selected));
    button.disabled = !engineAvailable(engine);
  });
  $<HTMLButtonElement>("#tts-import-voice").disabled = !ttsRuntime.available;
  $("#tts-engine-help").textContent = engineHelp(ttsPreferences.engine);
}

type CatalogRow = { id: string; engine: TtsEngineId; name: string; locale: string; region: string; installed: boolean; corrupt: boolean; compatible: boolean; imported: boolean; packageId?: string; size: number; modelVersion?: string };

function catalogRows(): CatalogRow[] {
  const packages = new Map(ttsInstalled.map(item => [item.packageId, item]));
  const system = ttsVoices.map(voice => ({ id: voice.voiceURI, engine: "system" as const, name: voice.name, locale: voice.lang, region: voice.lang.split("-")[1] ?? "", installed: true, corrupt: false, compatible: true, imported: false, size: 0 }));
  const local = [...knownVoices, ...ttsImportedVoices].map(voice => {
    const state = packages.get(voice.packageId);
    return { id: voice.id, engine: voice.engine, name: voice.name, locale: voice.locale, region: voice.region, installed: Boolean(state?.installed), corrupt: Boolean(state?.corrupt), compatible: engineAvailable(voice.engine), imported: Boolean(voice.imported), packageId: voice.packageId, size: voice.storageBytes ?? state?.bytes ?? 0, modelVersion: voice.modelVersion };
  });
  return [...system, ...local].filter(row => row.installed || row.corrupt);
}

function updateCatalogFilters(rows: CatalogRow[]): void {
  const lang = $<HTMLSelectElement>("#tts-language-filter"), region = $<HTMLSelectElement>("#tts-region-filter");
  const previousLang = lang.value, previousRegion = region.value;
  const languages = [...new Set(rows.map(row => row.locale.split("-")[0]))].sort();
  const regions = [...new Set(rows.map(row => row.region).filter(Boolean))].sort();
  lang.replaceChildren(new Option(t("ttsFilterAll"), "all"), ...languages.map(code => new Option(localeName(code), code)));
  region.replaceChildren(new Option(t("ttsFilterAll"), "all"), ...regions.map(value => new Option(value, value)));
  lang.value = languages.includes(previousLang) ? previousLang : "all";
  region.value = regions.includes(previousRegion) ? previousRegion : "all";
}

function filteredCatalogRows(rows: CatalogRow[]): CatalogRow[] {
  const languageFilter = $<HTMLSelectElement>("#tts-language-filter").value || "all";
  const regionFilter = $<HTMLSelectElement>("#tts-region-filter").value || "all";
  const engineFilter = $<HTMLSelectElement>("#tts-engine-filter").value || "all";
  return rows.filter(row => (languageFilter === "all" || row.locale.startsWith(languageFilter)) && (regionFilter === "all" || row.region === regionFilter) && (engineFilter === "all" || row.engine === engineFilter));
}

function renderVoiceRows(root: HTMLElement, rows: CatalogRow[]): void {
  root.replaceChildren();
  for (const engine of ["system", "piper", "kokoro"] as const) {
    const engineRows = rows.filter(row => row.engine === engine);
    if (!engineRows.length) continue;
    const group = document.createElement("h4"); group.className = "tts-voice-group";
    group.textContent = engine === "system" ? t("ttsEngineSystem") : engine === "piper" ? "Piper" : "Kokoro";
    root.append(group);
    for (const row of engineRows) {
      const article = document.createElement("article"); article.className = "tts-voice-entry"; article.dataset.engine = row.engine;
      const title = document.createElement("div"); title.className = "tts-voice-identity";
      const heading = document.createElement("h4"); heading.textContent = row.name;
      const meta = document.createElement("p"); meta.textContent = `${localeName(row.locale)} · ${row.region} · ${group.textContent}`;
      title.append(heading, meta);
      const details = document.createElement("div"); details.className = "tts-voice-details";
      const status = document.createElement("span"); status.className = `tts-voice-state ${row.installed ? "is-installed" : ""}`;
      status.textContent = row.corrupt ? t("ttsModelCorrupt") : row.installed ? t(row.imported ? "ttsImported" : "ttsInstalled") : t("ttsUnavailableDevice");
      const size = document.createElement("small");
      size.textContent = row.engine === "system" ? t("ttsSystemManaged") : [formatModelBytes(row.size, language), row.modelVersion].filter(Boolean).join(" · ");
      details.append(status, size);
      const actions = document.createElement("div"); actions.className = "tts-voice-actions";
      const preview = document.createElement("button"); preview.type = "button"; preview.className = "text-link"; preview.dataset.ttsAction = "preview"; preview.dataset.voiceId = row.id; preview.dataset.engine = row.engine; preview.disabled = !row.installed || !row.compatible; preview.textContent = t("ttsPreview"); actions.append(preview);
      const isDefault = ttsPreferences.voices[row.engine] === row.id;
      const choose = document.createElement("button"); choose.type = "button"; choose.className = "text-link"; choose.dataset.ttsAction = "default"; choose.dataset.voiceId = row.id; choose.dataset.engine = row.engine; choose.disabled = !row.installed || !row.compatible || isDefault; choose.textContent = t(isDefault ? "ttsDefault" : "ttsSetDefault"); actions.append(choose);
      if (row.imported) { const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-link is-danger"; remove.dataset.ttsAction = "remove"; remove.dataset.voiceId = row.id; remove.textContent = t("ttsRemove"); actions.append(remove); }
      article.append(title, details, actions); root.append(article);
    }
  }
  if (!rows.length) { const empty = document.createElement("p"); empty.className = "tts-catalog-empty"; empty.textContent = t("ttsNoInstalledVoices"); root.append(empty); }
}

function renderTtsCatalog(resetFilters = false): void {
  const rows = catalogRows();
  if (resetFilters) updateCatalogFilters(rows);
  const visible = filteredCatalogRows(rows);
  renderVoiceRows($("#tts-voice-library"), visible);
  renderTtsEngineControls(); renderReaderVoiceOptions();
}

async function refreshTtsVoices(announce = true): Promise<void> {
  const button = $<HTMLButtonElement>("#tts-refresh-voices");
  button.disabled = true;
  if (announce) $("#tts-voice-status").textContent = t("ttsVoicesLoading");
  try {
    const [voices, installed, runtime, imported] = await Promise.all([
      ttsAvailable() ? (usesNativeSystemTts() ? nativeDeviceVoices() : refreshDeviceVoices(window.speechSynthesis)) : Promise.resolve([]),
      installedPackages(), runtimeStatus(), importedVoices(),
    ]);
    ttsVoices = voices; ttsInstalled = installed; ttsRuntime = runtime; ttsImportedVoices = imported;
    renderTtsCatalog(true);
    $("#tts-voice-status").textContent = !runtime.available && supportsLocalNeuralTts() ? t("ttsRuntimeUnavailable") : "";
  } catch (error) {
    console.error("TTS voice discovery failed", error);
    renderTtsCatalog(true); $("#tts-voice-status").textContent = t("speechUnavailable");
  } finally { button.disabled = false; }
}

function setTtsRate(value: number, restart: boolean): void {
  bookTtsPreferences = { ...bookTtsPreferences, rate: value }; saveCurrentBookTts();
  updateTtsPlayer();
  if (restart) restartCurrentTtsChunk();
}
$("#tts-refresh-voices").addEventListener("click", () => void refreshTtsVoices());
const ttsRateInput = $<HTMLInputElement>("#tts-rate-reader");
ttsRateInput.addEventListener("input", () => setTtsRate(Number(ttsRateInput.value), false));
ttsRateInput.addEventListener("change", () => setTtsRate(Number(ttsRateInput.value), true));
const ttsPitchInput = $<HTMLInputElement>("#tts-pitch-reader");
ttsPitchInput.addEventListener("input", () => {
  bookTtsPreferences = { ...bookTtsPreferences, pitch: Number(ttsPitchInput.value) }; saveCurrentBookTts(); updateTtsPlayer();
});
ttsPitchInput.addEventListener("change", restartCurrentTtsChunk);

const ttsImportDialog = $<HTMLDialogElement>("#tts-import-dialog");
const ttsImportForm = $<HTMLFormElement>("#tts-import-form");
let preparedVoiceImport: PreparedVoiceImport | null = null;

function setVoiceImportBusy(busy: boolean, status = ""): void {
  ttsImportDialog.setAttribute("aria-busy", String(busy));
  for (const control of ttsImportForm.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) control.disabled = busy;
  if (!busy) $<HTMLButtonElement>("#tts-import-submit").disabled = !preparedVoiceImport
    || (preparedVoiceImport.inspection.kind === "kokoro-voice" && !preparedVoiceImport.inspection.baseModelInstalled);
  $("#tts-import-error").textContent = status;
}

function resetVoiceImport(): void {
  void discardPreparedVoiceImport(preparedVoiceImport);
  preparedVoiceImport = null;
  ttsImportForm.reset();
  $("#tts-import-file").textContent = t("ttsNoModelSelected");
  $("#tts-import-error").textContent = "";
  $("#tts-import-detected").hidden = true;
  $("#tts-import-base").hidden = true;
  $("#tts-import-fields").hidden = true;
  $<HTMLButtonElement>("#tts-import-submit").disabled = true;
}

function renderImportInspection(prepared: PreparedVoiceImport): void {
  const inspection = prepared.inspection;
  $("#tts-import-file").textContent = prepared.label;
  const summary = $("#tts-import-detected");
  summary.textContent = t("ttsImportDetected", {
    engine: inspection.engine === "piper" ? "Piper" : "Kokoro",
    format: inspection.format,
    size: formatModelBytes(inspection.size, language),
  });
  summary.hidden = false;
  const name = $<HTMLInputElement>("#tts-import-name"), locale = $<HTMLInputElement>("#tts-import-locale");
  name.value = inspection.name ?? ""; locale.value = inspection.locale ?? locale.value;
  const nameField = $<HTMLElement>('[data-import-field="name"]'), localeField = $<HTMLElement>('[data-import-field="locale"]');
  nameField.hidden = !inspection.requiresName; localeField.hidden = !inspection.requiresLocale;
  name.required = inspection.requiresName; locale.required = inspection.requiresLocale;
  $("#tts-import-fields").hidden = !inspection.requiresName && !inspection.requiresLocale;
  const needsBase = inspection.kind === "kokoro-voice" && !inspection.baseModelInstalled;
  $("#tts-import-base").hidden = !needsBase;
  $<HTMLButtonElement>("#tts-import-submit").disabled = needsBase;
  $("#tts-import-error").textContent = "";
}

function closeVoiceImport(): void {
  if (ttsImportDialog.getAttribute("aria-busy") === "true") return;
  void discardPreparedVoiceImport(preparedVoiceImport); preparedVoiceImport = null;
  ttsImportDialog.close();
}

$("#tts-import-voice").addEventListener("click", () => {
  if (!ttsRuntime.available) { showToast(t("ttsRuntimeUnavailable")); return; }
  resetVoiceImport(); ttsImportDialog.showModal(); $<HTMLButtonElement>("#tts-import-pick").focus();
});
$("#tts-import-close").addEventListener("click", closeVoiceImport);
$("#tts-import-cancel").addEventListener("click", closeVoiceImport);
ttsImportDialog.addEventListener("cancel", event => { if (ttsImportDialog.getAttribute("aria-busy") === "true") event.preventDefault(); });
$("#tts-import-pick").addEventListener("click", () => {
  void chooseVoiceFile(t("ttsChooseFile")).then(async selected => {
    if (!selected) return;
    setVoiceImportBusy(true, t("ttsImportInspecting"));
    await discardPreparedVoiceImport(preparedVoiceImport);
    preparedVoiceImport = await prepareVoiceImport(selected);
    setVoiceImportBusy(false); renderImportInspection(preparedVoiceImport);
  }).catch(error => { setVoiceImportBusy(false, localTtsError(error)); $("#tts-import-error").focus(); });
});
$("#tts-import-base-pick").addEventListener("click", () => {
  let preparedBase: PreparedVoiceImport | null = null;
  void chooseVoiceFile(t("ttsImportBaseModel")).then(async selected => {
    if (!selected || !preparedVoiceImport) return;
    setVoiceImportBusy(true, t("ttsImportValidating"));
    preparedBase = await prepareVoiceImport(selected);
    if (preparedBase.inspection.kind !== "model-package" || preparedBase.inspection.engine !== "kokoro" || preparedBase.inspection.modelVersion !== preparedVoiceImport.inspection.modelVersion) {
      throw new Error("TTS_KOKORO_BASE_INCOMPATIBLE");
    }
    await installPreparedVoice(preparedBase, { name: preparedBase.inspection.name ?? "Kokoro", locale: preparedBase.inspection.locale ?? "en-US" });
    preparedBase = null;
    await refreshTtsVoices(false);
    preparedVoiceImport.inspection.baseModelInstalled = true;
    setVoiceImportBusy(false); renderImportInspection(preparedVoiceImport);
  }).catch(error => { void discardPreparedVoiceImport(preparedBase); setVoiceImportBusy(false, localTtsError(error)); $("#tts-import-error").focus(); });
});
ttsImportForm.addEventListener("submit", event => {
  event.preventDefault();
  if (!preparedVoiceImport) { $("#tts-import-error").textContent = t("ttsImportSelectModel"); $("#tts-import-error").focus(); return; }
  setVoiceImportBusy(true, t("ttsImportValidating"));
  void installPreparedVoice(preparedVoiceImport, {
    name: $<HTMLInputElement>("#tts-import-name").value || preparedVoiceImport.inspection.name,
    locale: $<HTMLInputElement>("#tts-import-locale").value || preparedVoiceImport.inspection.locale,
  }).then(async voice => {
    preparedVoiceImport = null;
    setVoiceImportBusy(false); ttsImportDialog.close();
    showToast(t("ttsImportComplete", { voice: voice.name }));
    await refreshTtsVoices(false);
  }).catch(error => {
    setVoiceImportBusy(false, localTtsError(error));
    $("#tts-import-error").focus();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-tts-engine]").forEach(button => button.addEventListener("click", () => {
  const engine = button.dataset.ttsEngine as TtsEngineId;
  if (!engineAvailable(engine)) return;
  stopTts(false); ttsPreferences = saveTtsPreferences({ ...ttsPreferences, engine }); renderTtsCatalog(); updateTtsPlayer();
}));
for (const id of ["#tts-language-filter", "#tts-region-filter", "#tts-engine-filter"]) $(id).addEventListener("change", () => renderTtsCatalog());
async function previewInstalledVoice(engine: TtsEngineId, voiceId: string): Promise<void> {
  ttsPreviewPlayer.stop();
  if (usesNativeSystemTts()) await nativeStop().catch(() => undefined);
  else window.speechSynthesis?.cancel();
  $("#tts-voice-status").textContent = t("ttsPreviewPlaying");
  if (engine === "system") {
    const voice = ttsVoices.find(item => item.voiceURI === voiceId);
    if (!voice) throw new Error("TTS_VOICE_UNKNOWN");
    if (usesNativeSystemTts()) {
      await nativeSpeak({ text: t("ttsPreviewText"), voiceUri: voice.voiceURI, language: voice.lang, rate: 1, pitch: 1 });
      $("#tts-voice-status").textContent = "";
    } else {
      const utterance = new SpeechSynthesisUtterance(t("ttsPreviewText"));
      utterance.voice = window.speechSynthesis.getVoices().find(item => item.voiceURI === voiceId) ?? null;
      utterance.lang = voice.lang;
      utterance.onend = () => { $("#tts-voice-status").textContent = ""; };
      utterance.onerror = () => { $("#tts-voice-status").textContent = t("ttsInitializeFailed"); };
      window.speechSynthesis.speak(utterance);
    }
    return;
  }
  const audio = await synthesizeLocal(voiceId, t("ttsPreviewText"), 1);
  await ttsPreviewPlayer.load(audio, {
    ended: () => { $("#tts-voice-status").textContent = ""; },
    error: () => { $("#tts-voice-status").textContent = t("ttsInitializeFailed"); },
  });
}
$<HTMLElement>(".tts-settings-sheet").addEventListener("click", event => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-tts-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.ttsAction, voiceId = button.dataset.voiceId ?? "";
  if (action === "default") {
    const engine = button.dataset.engine as TtsEngineId;
    ttsPreferences = saveTtsPreferences({ engine, voices: { ...ttsPreferences.voices, [engine]: voiceId } });
    renderTtsCatalog(); updateTtsPlayer(); return;
  }
  if (action === "preview") {
    void previewInstalledVoice(button.dataset.engine as TtsEngineId, voiceId).catch(error => { $("#tts-voice-status").textContent = localTtsError(error); }); return;
  }
  if (action === "remove") {
    void removeImportedVoice(voiceId).then(async () => { showToast(t("ttsVoiceRemoved")); await refreshTtsVoices(false); }).catch(error => showToast(localTtsError(error))); return;
  }
});
$<HTMLSelectElement>("#tts-reader-voice").addEventListener("change", event => {
  bookTtsPreferences = { ...bookTtsPreferences, voiceId: (event.target as HTMLSelectElement).value }; saveCurrentBookTts();
  if (ttsState !== "idle") restartCurrentTtsChunk(); else updateTtsPlayer();
});
$<HTMLButtonElement>("#tts-system-fallback").addEventListener("click", () => {
  ttsPreferences = saveTtsPreferences({ ...ttsPreferences, engine: "system" });
  $<HTMLButtonElement>("#tts-system-fallback").hidden = true; renderTtsCatalog(); updateTtsPlayer();
});
$("#tts-play-pause").addEventListener("click", () => void toggleTtsPlayback());
$("#tts-stop").addEventListener("click", () => stopTts());
$("#tts-previous").addEventListener("click", () => void navigateTts(-1));
$("#tts-next").addEventListener("click", () => void navigateTts(1));
if (!usesNativeSystemTts() && window.speechSynthesis) window.speechSynthesis.addEventListener("voiceschanged", () => {
  ttsVoices = localDeviceVoices(window.speechSynthesis); renderTtsCatalog(true);
});
renderTtsCatalog(true);
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
const readerShowNotes = $<HTMLInputElement>("#reader-show-notes");
readerShowNotes.addEventListener("change", () => {
  readerNotesVisible = readerShowNotes.checked;
  const key = readerPreferenceKey("notes");
  if (key) localStorage.setItem(key, readerNotesVisible ? "visible" : "hidden");
  renderNoteMarkers();
});
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
  if (direction === "return") temporaryNavigationSource = null;
  if (position) void displayPosition(position).catch(error => showToast(errorMessage(error)));
};
$("#history-back").addEventListener("click", () => historyAction("back"));
$("#history-forward").addEventListener("click", () => historyAction("forward"));
$("#reading-return").addEventListener("click", () => historyAction("return"));
$("#reading-adopt").addEventListener("click", () => {
  if (readerJumpBusy) return;
  readerHistory.commit(capturePosition());
  temporaryNavigationSource = null;
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
mountAccountSecurity($("#settings-security"));
const accountPlans = mountAccountPlans($("#settings-account-sheet"));
mountAccountStorage(accountPlans.actions, coverElement, reloadCloudLibrary);
mountAccount(app, $(".shell"), $("#settings-account-footer"));
const cloudDownloads = new Map<string, Promise<StoredBook>>();
setCloudBookLoader((book) => {
  const previous = cloudDownloads.get(book.id);
  if (previous) return previous;
  const download = bookStorage.getBook(book).finally(() => cloudDownloads.delete(book.id));
  cloudDownloads.set(book.id, download);
  return download;
});
void requestPersistentCache();
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
mountReadingStats($("#view-profile"), $("#view-statistics"), () => setView("statistics"), () => setView("profile"), () => books.map(book => ({ id: book.id, name: titleOf(book), author: book.author ?? "", cover: () => coverElement(book) })));
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
    if (book.contentMetadataVersion === BOOK_CONTENT_METADATA_VERSION || !book.ownerId || book.ownerId !== auth.state.ownerId || queuedContent.has(book.id)) continue;
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
readingSurface.addEventListener("pointerdown", () => { if (view === "reader") readingActivity.interact(); }, { passive: true });
readingSurface.addEventListener("keydown", () => { if (view === "reader") readingActivity.interact(); });
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
