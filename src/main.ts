import ePub, { type Book as EpubBook, type Contents, type Location, type Rendition } from "epubjs";
import {
  GlobalWorkerOptions,
  getDocument,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { invoke } from "@tauri-apps/api/core";
import { createBackup, readBackup } from "./backup";
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
  chevron: '<path d="m9 18 6-6-6-6"/>',
};

function svg(name: keyof typeof icons, size = 19): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <button class="brand" id="brand-home" type="button" aria-label="Ir al inicio">
        <img src="${leafUrl}" alt="" /><span>Autumn <strong>Reader</strong></span>
      </button>
      <div class="nav-caption">Tu espacio</div>
      <nav class="sidebar-nav" aria-label="Navegación principal">
        <button class="nav-button active" data-view="home" type="button">${svg("home")}<span>Inicio</span></button>
        <button class="nav-button" data-view="library" type="button">${svg("library")}<span>Biblioteca</span><span id="nav-book-count" class="nav-count">0</span></button>
        <button class="nav-button" data-view="settings" type="button">${svg("settings")}<span>Configuración</span></button>
      </nav>
      <div class="sidebar-signature"><img src="${leafUrl}" alt="" /><p>Historias para cada estación.</p></div>
      <div class="sidebar-foot">Tus libros, a tu ritmo</div>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <div class="topbar-copy"><h1 id="page-title">Inicio</h1><p id="page-subtitle">Un lugar para volver a tus historias</p></div>
        <button id="import-button" class="primary-button" type="button">${svg("plus", 18)}<span>Agregar libros</span></button>
        <input id="file-input" type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" multiple hidden />
      </header>

      <main class="content-area">
        <section id="view-home" class="view home-view">
          <div class="hero">
            <div class="hero-copy"><p class="hero-eyebrow">Bienvenido a tu rincón de lectura</p><h2>Cada historia tiene<br />su estación.</h2><p id="hero-description">Añade tus libros y empieza a leer a tu ritmo. Tus historias se quedan contigo.</p><button id="hero-action" class="hero-button" type="button"><span>Agregar mi primer libro</span>${svg("arrow", 18)}</button></div>
            <div class="hero-art" aria-hidden="true"><span class="hero-orbit"></span><img src="${leafUrl}" alt="" /></div>
          </div>

          <div class="shelf-heading"><div><p class="section-kicker">Continúa donde lo dejaste</p><h2>Lecturas recientes</h2></div><button class="text-link" id="recent-see-all" type="button">Ver biblioteca ${svg("arrow", 16)}</button></div>
          <div id="recent-list" class="book-grid recent-grid"></div>

          <div class="shelf-heading favorites-heading"><div><p class="section-kicker">Tus elegidos</p><h2>Favoritos</h2></div><button class="text-link" id="favorites-see-all" type="button">Ver todos ${svg("arrow", 16)}</button></div>
          <div id="favorite-list" class="book-grid favorite-grid"></div>
        </section>

        <section id="view-library" class="view library-view" hidden>
          <div class="section-intro"><div><p class="section-kicker">Todos tus libros en un lugar</p><h2>Biblioteca</h2><p id="library-count-line">0 libros guardados</p></div><img src="${leafUrl}" alt="" /></div>
          <div class="library-tools">
            <label class="search-field">${svg("search", 18)}<input id="library-search" type="search" placeholder="Buscar por título" aria-label="Buscar libros por título" /></label>
          </div>
          <div id="library-list" class="book-grid library-grid"></div>
        </section>

        <section id="view-settings" class="view settings-view" hidden>
          <div class="settings-intro"><p class="section-kicker">Tu manera de leer</p><h2>Configuración</h2><p>Ajustes sencillos para hacer este espacio más cómodo.</p></div>
          <div class="settings-group"><div class="settings-copy"><h3>Apariencia</h3><p>Elige los colores de la aplicación. Puedes cambiarlos cuando quieras.</p></div><div class="theme-options" role="group" aria-label="Tema de la aplicación"><button type="button" data-theme-choice="light" class="theme-choice"><span class="theme-preview theme-light"></span>Claro</button><button type="button" data-theme-choice="dark" class="theme-choice"><span class="theme-preview theme-dark"></span>Oscuro</button></div></div>
          <div class="settings-group"><div class="settings-copy"><h3>Tamaño inicial del texto</h3><p>Se aplicará a los libros con texto adaptable que agregues a partir de ahora. Puedes ajustarlo mientras lees.</p></div><select id="default-font-size" aria-label="Tamaño de texto predeterminado"><option value="90">Pequeño · 90%</option><option value="100">Normal · 100%</option><option value="110">Cómodo · 110%</option><option value="120">Grande · 120%</option><option value="130">Muy grande · 130%</option></select></div>
          <div class="drive-panel">
            <div class="settings-copy"><h3>Copia en Google Drive</h3><p>Guarda una copia cuando quieras e impórtala después. Incluye tus libros, cubiertas, favoritos, notas y progreso de lectura. La copia solo está disponible para Autumn Reader dentro de tu Drive.</p></div>
            <div class="drive-actions"><button id="drive-connect" type="button" class="secondary-button">Iniciar sesión con Google</button><span id="drive-connected" class="drive-connected" hidden><span aria-hidden="true">●</span> Conectado a Google Drive</span><button id="drive-save" type="button" class="primary-button" disabled>Guardar copia</button></div>
            <div class="drive-restore"><label for="drive-backups">Copia disponible</label><select id="drive-backups" disabled><option value="">Conecta Drive para buscar copias</option></select><button id="drive-import" type="button" class="secondary-button" disabled>Importar copia</button></div>
            <p id="drive-status" class="drive-status" role="status" aria-live="polite">La copia de Drive es opcional. La lectura sigue funcionando sin conexión.</p>
          </div>
          <div class="settings-note"><img src="${leafUrl}" alt="" /><div><h3>Tus libros son tuyos</h3><p>Autumn Reader guarda libros, favoritos y progreso en este dispositivo. No necesitas una cuenta ni conexión para leer.</p><span id="storage-count">0 libros en tu biblioteca</span></div></div>
        </section>

        <section id="view-reader" class="view reader-view" hidden>
          <div class="reader-toolbar"><button id="back-button" class="back-button" type="button">${svg("back", 18)}<span>Volver</span></button><div class="reader-controls"><button id="previous-button" class="tool-button" type="button" aria-label="Página anterior">←</button><span id="position-label" class="position-label">—</span><button id="next-button" class="tool-button" type="button" aria-label="Página siguiente">→</button></div><div class="reader-controls"><span id="size-label" class="size-label">Zoom</span><button id="smaller-button" class="tool-button" type="button" aria-label="Reducir tamaño">−</button><span id="size-value" class="size-value">100%</span><button id="larger-button" class="tool-button" type="button" aria-label="Aumentar tamaño">＋</button></div></div>
          <div id="reading-surface" class="reading-surface"><div id="reader-content" class="reader-content"></div></div>
          <div class="reader-bottom"><span>Selecciona texto y haz clic derecho para agregar una nota</span><span id="save-status">Progreso guardado</span></div>
        </section>
      </main>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
      <div id="note-menu" class="note-menu" hidden><button id="note-add" type="button">Agregar nota</button></div>
      <div id="note-dialog" class="note-dialog" hidden>
        <div class="note-card" role="dialog" aria-modal="true" aria-labelledby="note-heading">
          <div class="note-card-head"><h2 id="note-heading">Agregar nota</h2><button id="note-close" type="button" class="note-close" aria-label="Cerrar nota">×</button></div>
          <p id="note-quote" class="note-quote"></p>
          <fieldset class="note-colors"><legend>Color de la marca</legend><div id="note-color-options" class="note-color-options"></div></fieldset>
          <label class="note-label" for="note-text">Tu nota</label><textarea id="note-text" maxlength="5000" rows="5" placeholder="Escribe lo que quieres recordar…"></textarea>
          <div class="note-card-actions"><button id="note-delete" type="button" class="note-delete" hidden>Eliminar nota</button><button id="note-cancel" type="button" class="secondary-button">Cancelar</button><button id="note-save" type="button" class="primary-button">Guardar nota</button></div>
        </div>
      </div>
      <div id="confirm-dialog" class="confirm-dialog" hidden>
        <div class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-heading" aria-describedby="confirm-message">
          <div class="confirm-symbol" aria-hidden="true"><img src="${leafUrl}" alt="" /></div>
          <h2 id="confirm-heading"></h2>
          <p id="confirm-message"></p>
          <div class="confirm-actions"><button id="confirm-cancel" type="button" class="secondary-button">Cancelar</button><button id="confirm-accept" type="button" class="primary-button"></button></div>
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
let epubBook: EpubBook | null = null;
let rendition: Rendition | null = null;
let zoom = 1;
let loadSequence = 0;
let pdfRenderSequence = 0;
let toastTimer: number | undefined;
let theme: "light" | "dark" = localStorage.getItem("autumn-theme") === "dark" ? "dark" : "light";
let defaultFontSize = Number(localStorage.getItem("autumn-default-font-size")) || 100;
const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem("autumn-google-client-id") || "").trim();
let driveConnected = false;
let driveAccessToken = "";
let driveBusy = false;

const noteColors = ["#cc5500", "#8b0000", "#996515", "#808000", "#b7410e", "#800020"];
type NoteAnchor = { format: "pdf"; page: number; y: number } | { format: "epub"; cfi: string };
let pendingNote: { quote: string; anchor: NoteAnchor } | null = null;
let editingNoteId: string | null = null;
let selectedNoteColor = noteColors[0];
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
    select.add(new Option("Todavía no hay copias guardadas", ""));
  } else {
    for (const backup of backups) {
      const date = new Date(backup.modifiedTime);
      const label = Number.isNaN(date.getTime()) ? "Copia guardada" : date.toLocaleString("es");
      const size = backup.size ? ` · ${(Number(backup.size) / 1024 / 1024).toFixed(1)} MB` : "";
      select.add(new Option(`${label}${size}`, backup.id));
    }
  }
  setDriveBusy(driveBusy);
}

function driveError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  driveMessage(message);
  showToast(message);
  if (message.includes("conexión con Drive venció") || message.includes("sesión de Drive venció") || message.includes("(401")) {
    driveConnected = false;
    driveAccessToken = "";
    setDriveBusy(false);
  }
}

async function connectDrive(): Promise<void> {
  if (!googleClientId) return;
  setDriveBusy(true);
  driveMessage("Abriendo Google en tu navegador para autorizar Autumn Reader…");
  try {
    driveAccessToken = await invoke<string>("drive_connect", { clientId: googleClientId });
    driveConnected = true;
    await refreshDriveBackups();
    driveMessage("Drive conectado. Puedes guardar o importar una copia.");
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
  driveMessage("Preparando copia de la biblioteca…");
  try {
    const archive = await createBackup(books);
    driveMessage(`Subiendo ${(archive.byteLength / 1024 / 1024).toFixed(1)} MB a Drive…`);
    await invoke("drive_save_backup", archive, {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });
    await refreshDriveBackups();
    driveMessage(`Copia guardada en Drive con ${books.length} ${books.length === 1 ? "libro" : "libros"}.`);
    showToast("Copia guardada en Drive");
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
    title: "Importar copia",
    message: "Se añadirán los libros de esta copia. Si alguno ya está en tu biblioteca, se actualizará; los demás permanecerán como están.",
    confirmLabel: "Importar libros",
    tone: "import",
  })) return;
  setDriveBusy(true);
  driveMessage("Descargando y verificando la copia…");
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
    driveMessage(`Se importaron ${restored.length} ${restored.length === 1 ? "libro" : "libros"}. Tu biblioteca local está lista.`);
    showToast("Copia importada");
  } catch (error) {
    driveError(error);
  } finally {
    setDriveBusy(false);
  }
}

function titleOf(book: StoredBook): string {
  return book.name.replace(/\.(pdf|epub)$/i, "");
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

function confirmAction(options: { title: string; message: string; confirmLabel: string; tone: "remove" | "import" }): Promise<boolean> {
  if (confirmResolve) closeConfirmation(false);
  const dialog = $<HTMLDivElement>("#confirm-dialog");
  const card = dialog.querySelector<HTMLElement>(".confirm-card")!;
  card.dataset.tone = options.tone;
  $<HTMLElement>("#confirm-heading").textContent = options.title;
  $<HTMLElement>("#confirm-message").textContent = options.message;
  $<HTMLButtonElement>("#confirm-accept").textContent = options.confirmLabel;
  confirmPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.hidden = false;
  $<HTMLButtonElement>("#confirm-cancel").focus();
  return new Promise((resolve) => { confirmResolve = resolve; });
}

function setView(next: View): void {
  if (next !== "reader") {
    hideNoteMenu();
    closeNoteDialog();
  }
  view = next;
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
    home: ["Inicio", "Un lugar para volver a tus historias"],
    library: ["Biblioteca", `${books.length} ${books.length === 1 ? "libro guardado" : "libros guardados"}`],
    settings: ["Configuración", "Haz de este espacio uno tuyo"],
    reader: [currentBook ? titleOf(currentBook) : "Lector", "Disfruta tu lectura"],
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
  coverButton.setAttribute("aria-label", `Abrir ${titleOf(book)}`);
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
  meta.textContent = book.lastOpenedAt ? "En lectura" : "Sin empezar";
  const actions = document.createElement("div");
  actions.className = "book-actions";
  const favorite = document.createElement("button");
  favorite.className = `favorite-button${book.favorite ? " is-favorite" : ""}`;
  favorite.type = "button";
  favorite.innerHTML = svg("star", 17);
  favorite.title = book.favorite ? "Quitar de favoritos" : "Agregar a favoritos";
  favorite.setAttribute("aria-label", `${book.favorite ? "Quitar" : "Agregar"} ${titleOf(book)} ${book.favorite ? "de" : "a"} favoritos`);
  favorite.setAttribute("aria-pressed", String(Boolean(book.favorite)));
  favorite.addEventListener("click", () => void toggleFavorite(book));
  actions.append(favorite);
  if (context === "library") {
    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.type = "button";
    remove.innerHTML = svg("trash", 16);
    remove.title = "Quitar de la biblioteca";
    remove.setAttribute("aria-label", `Quitar ${titleOf(book)} de la biblioteca`);
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
    button.textContent = "Agregar libros";
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
  recentList.replaceChildren(...(recent.length ? recent.slice(0, 5).map((book) => createBookCard(book, "home")) : [emptyState("Aquí aparecerán los libros que abras.", books.length === 0)]));
  const favoriteList = $<HTMLDivElement>("#favorite-list");
  favoriteList.replaceChildren(...(favorites.length ? favorites.slice(0, 5).map((book) => createBookCard(book, "home")) : [emptyState("Marca un libro con la estrella para verlo aquí.")]));

  const heroAction = $<HTMLButtonElement>("#hero-action");
  heroAction.querySelector("span")!.textContent = recent.length ? "Continuar leyendo" : books.length ? "Explorar biblioteca" : "Agregar mi primer libro";
  $<HTMLElement>("#hero-description").textContent = recent.length
    ? `Tu última lectura fue «${titleOf(recent[0])}». Retómala cuando quieras.`
    : "Añade tus libros y empieza a leer a tu ritmo. Tus historias se quedan contigo.";
  heroAction.onclick = () => recent.length ? void openBook(recent[0]) : books.length ? setView("library") : fileInput.click();

  $<HTMLElement>("#library-count-line").textContent = `${books.length} ${books.length === 1 ? "libro guardado" : "libros guardados"}`;
  $<HTMLElement>("#storage-count").textContent = `${books.length} ${books.length === 1 ? "libro en tu biblioteca" : "libros en tu biblioteca"}`;
  if (view === "library") setView("library");
  const query = $<HTMLInputElement>("#library-search").value.trim().toLocaleLowerCase();
  const matches = [...books].filter((book) => titleOf(book).toLocaleLowerCase().includes(query)).sort((a, b) => b.addedAt - a.addedAt);
  const libraryList = $<HTMLDivElement>("#library-list");
  libraryList.replaceChildren(...(matches.length ? matches.map((book) => createBookCard(book, "library")) : [emptyState(books.length ? "No hay libros que coincidan con la búsqueda." : "Tu biblioteca está vacía. Agrega un libro para empezar.", books.length === 0)]));
}

async function toggleFavorite(book: StoredBook): Promise<void> {
  book.favorite = !book.favorite;
  try {
    await saveBook(book);
    renderCollections();
    showToast(book.favorite ? "Agregado a favoritos" : "Quitado de favoritos");
  } catch {
    book.favorite = !book.favorite;
    showToast("No se pudo guardar el favorito");
  }
}

async function removeBook(book: StoredBook): Promise<void> {
  if (!await confirmAction({
    title: "Quitar libro",
    message: `«${titleOf(book)}» se quitará de tu biblioteca junto con sus notas y progreso de lectura en este dispositivo.`,
    confirmLabel: "Quitar libro",
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
    showToast("Libro quitado de la biblioteca");
  } catch {
    showToast("No se pudo quitar el libro");
  }
}

function updatePosition(): void {
  if (!currentBook) return;
  const position = currentBook.format === "pdf"
    ? `Página ${currentBook.page} de ${pdfDocument?.numPages ?? "…"}`
    : rendition?.location?.start ? `Sección ${rendition.location.start.index + 1}` : "Libro";
  $<HTMLSpanElement>("#position-label").textContent = position;
  $<HTMLButtonElement>("#previous-button").disabled = currentBook.format === "pdf" && currentBook.page <= 1;
  $<HTMLButtonElement>("#next-button").disabled = currentBook.format === "pdf" && currentBook.page >= (pdfDocument?.numPages ?? Infinity);
  $<HTMLSpanElement>("#size-label").textContent = currentBook.format === "pdf" ? "Zoom" : "Texto";
  $<HTMLSpanElement>("#size-value").textContent = currentBook.format === "pdf" ? `${Math.round(zoom * 100)}%` : `${currentBook.fontSize}%`;
}

async function persistCurrent(): Promise<void> {
  if (!currentBook) return;
  try {
    await saveBook(currentBook);
    $<HTMLElement>("#save-status").textContent = "Progreso guardado";
  } catch {
    $<HTMLElement>("#save-status").textContent = "No se pudo guardar el progreso";
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

function renderNoteColors(): void {
  const options = $<HTMLDivElement>("#note-color-options");
  options.replaceChildren(...noteColors.map((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `note-color${color === selectedNoteColor ? " selected" : ""}`;
    button.style.backgroundColor = color;
    button.setAttribute("aria-label", `Elegir color ${color}`);
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
  $<HTMLElement>("#note-heading").textContent = note ? "Tu nota" : "Agregar nota";
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
    showToast("Escribe algo en la nota antes de guardarla");
    return;
  }
  const previous = book.notes ?? [];
  if (editingNoteId) {
    book.notes = previous.map((note) => note.id === editingNoteId ? { ...note, text, color: selectedNoteColor } : note);
  } else if (pendingNote) {
    book.notes = [...previous, {
      id: crypto.randomUUID(), quote: pendingNote.quote, text, color: selectedNoteColor,
      createdAt: Date.now(), ...pendingNote.anchor,
    }];
  } else return;
  try {
    await saveBook(book);
    closeNoteDialog();
    renderNoteMarkers();
    showToast("Nota guardada");
  } catch {
    book.notes = previous;
    showToast("No se pudo guardar la nota");
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
    renderNoteMarkers();
    showToast("Nota eliminada");
  } catch {
    book.notes = previous;
    showToast("No se pudo eliminar la nota");
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
    const y = Math.max(8, placement.y - 10, lastY + 24);
    marker.style.top = `${y}px`;
    lastY = y;
    marker.title = "Abrir nota";
    marker.setAttribute("aria-label", `Abrir nota sobre ${placement.note.quote}`);
    marker.addEventListener("click", () => openNoteDialog(placement.note));
    readerContent.append(marker);
  }
}

async function clearReader(): Promise<void> {
  hideNoteMenu();
  closeNoteDialog();
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
}

async function renderPdfPage(): Promise<void> {
  if (!pdfDocument || !currentBook || currentBook.format !== "pdf") return;
  const sequence = ++pdfRenderSequence;
  pdfRenderTask?.cancel();
  pdfTextLayer?.cancel();
  pdfTextLayer = null;
  currentBook.page = Math.max(1, Math.min(currentBook.page, pdfDocument.numPages));
  const page = await pdfDocument.getPage(currentBook.page);
  if (sequence !== pdfRenderSequence) return;
  const natural = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(200, readingSurface.clientWidth - 76);
  const availableHeight = Math.max(200, readingSurface.clientHeight - 68);
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
  readerContent.replaceChildren(sheet);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo iniciar el visor PDF");
  const task = page.render({ canvasContext: context, canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
  pdfRenderTask = task;
  try { await task.promise; }
  catch (error) { if (!(error instanceof Error && error.name === "RenderingCancelledException")) throw error; }
  finally { if (pdfRenderTask === task) pdfRenderTask = null; }
  if (sequence !== pdfRenderSequence) return;
  const textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: textLayerElement, viewport });
  pdfTextLayer = textLayer;
  try { await textLayer.render(); }
  catch (error) { if (sequence === pdfRenderSequence) console.info("Esta página no tiene texto seleccionable", error); }
  if (sequence !== pdfRenderSequence) return;
  textLayerElement.addEventListener("contextmenu", (event) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!textLayerElement.contains(range.startContainer) || !textLayerElement.contains(range.endContainer)) return;
    const quote = selection.toString().trim();
    if (!quote || !currentBook || currentBook.format !== "pdf") return;
    event.preventDefault();
    const rect = range.getBoundingClientRect();
    const pageRect = sheet.getBoundingClientRect();
    const y = Math.max(0, Math.min(1, (rect.top - pageRect.top) / pageRect.height));
    showNoteMenu(quote, { format: "pdf", page: currentBook.page, y }, event.clientX, event.clientY);
  });
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
  setView("reader");
  renderCollections();
  readerContent.innerHTML = '<div class="reader-message">Abriendo libro…</div>';
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
        contents.document.addEventListener("contextmenu", (event) => {
          const selection = contents.window.getSelection();
          if (!selection || selection.isCollapsed || !selection.rangeCount) return;
          const quote = selection.toString().trim();
          if (!quote) return;
          const range = selection.getRangeAt(0);
          const cfi = contents.cfiFromRange(range);
          const frameElement = contents.document.defaultView?.frameElement as HTMLElement | null;
          if (!frameElement) return;
          event.preventDefault();
          const frameRect = frameElement.getBoundingClientRect();
          showNoteMenu(quote, { format: "epub", cfi }, frameRect.left + event.clientX, frameRect.top + event.clientY);
        });
      });
      rendition.themes.fontSize(`${book.fontSize}%`);
      applyTheme();
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
    readerContent.innerHTML = '<div class="reader-message">No se pudo abrir este libro. Comprueba que el archivo sea compatible.</div>';
    showToast("No se pudo abrir el libro");
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
    console.info("Este libro se mostrará con una cubierta sencilla", error);
  }
}

async function importFiles(files: FileList): Promise<void> {
  let first: StoredBook | null = null;
  let rejected = 0;
  for (const file of Array.from(files)) {
    const format = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : file.name.toLowerCase().endsWith(".epub") ? "epub" : null;
    if (!format) { rejected++; continue; }
    const book: StoredBook = {
      id: crypto.randomUUID(), name: file.name, format, data: file,
      addedAt: Date.now(), lastOpenedAt: 0, favorite: false,
      page: 1, cfi: null, fontSize: defaultFontSize,
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
  if (rejected) showToast(`${rejected} archivo${rejected === 1 ? " no se pudo agregar" : "s no se pudieron agregar"}`);
}

async function navigate(direction: -1 | 1): Promise<void> {
  if (!currentBook || view !== "reader") return;
  if (currentBook.format === "pdf" && pdfDocument) {
    const next = currentBook.page + direction;
    if (next < 1 || next > pdfDocument.numPages) return;
    currentBook.page = next;
    readingSurface.scrollTop = 0;
    await renderPdfPage();
    await persistCurrent();
  } else if (rendition) {
    await (direction < 0 ? rendition.prev() : rendition.next());
  }
}

function changeSize(direction: -1 | 1): void {
  if (!currentBook) return;
  if (currentBook.format === "pdf") {
    zoom = Math.max(0.5, Math.min(2, Math.round((zoom + direction * 0.1) * 10) / 10));
    void renderPdfPage();
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
const fontSelect = $<HTMLSelectElement>("#default-font-size");
fontSelect.value = String(defaultFontSize);
fontSelect.addEventListener("change", () => {
  defaultFontSize = Number(fontSelect.value);
  localStorage.setItem("autumn-default-font-size", String(defaultFontSize));
  showToast("Tamaño predeterminado guardado");
});
if (!googleClientId) {
  driveMessage("La conexión con Google Drive estará disponible cuando se configure para esta versión.");
  $<HTMLButtonElement>("#drive-connect").title = "Conexión con Google Drive pendiente de configurar";
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
    hideNoteMenu();
    return;
  }
  if (!$<HTMLDivElement>("#note-dialog").hidden) return;
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
}).catch(() => showToast("No se pudo abrir la biblioteca local"));
