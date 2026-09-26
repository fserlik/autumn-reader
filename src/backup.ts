import JSZip from "jszip";
import { t } from "./i18n";
import type { BookNote, StoredBook } from "./storage";

export const MAX_BACKUP_BYTES = 250 * 1024 * 1024;

interface BookRecord {
  id: string;
  name: string;
  format: "pdf" | "epub";
  addedAt: number;
  lastOpenedAt: number;
  favorite: boolean;
  page: number;
  cfi: string | null;
  fontSize: number;
  hasCover: boolean;
  notes?: BookNote[];
}

interface Manifest {
  app: "autumn-reader";
  version: 1;
  createdAt: string;
  books: BookRecord[];
}

function recordOf(book: StoredBook): BookRecord {
  return {
    id: book.id,
    name: book.name,
    format: book.format,
    addedAt: book.addedAt,
    lastOpenedAt: book.lastOpenedAt,
    favorite: Boolean(book.favorite),
    page: book.page,
    cfi: book.cfi,
    fontSize: book.fontSize,
    hasCover: Boolean(book.cover),
    notes: book.notes ?? [],
  };
}

const NOTE_COLORS = new Set(["#cc5500", "#8b0000", "#996515", "#808000", "#b7410e", "#800020"]);

function validNote(value: unknown, format: "pdf" | "epub"): value is BookNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Record<string, unknown>;
  return typeof note.id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(note.id)
    && typeof note.quote === "string" && note.quote.length > 0 && note.quote.length <= 500
    && typeof note.text === "string" && note.text.length > 0 && note.text.length <= 5000
    && typeof note.color === "string" && NOTE_COLORS.has(note.color)
    && typeof note.createdAt === "number" && Number.isFinite(note.createdAt)
    && note.format === format
    && (format === "pdf"
      ? typeof note.page === "number" && Number.isInteger(note.page) && note.page >= 1
        && typeof note.y === "number" && note.y >= 0 && note.y <= 1
      : typeof note.cfi === "string" && note.cfi.startsWith("epubcfi(") && note.cfi.length <= 2000);
}

function validRecord(value: unknown): value is BookRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(item.id)
    && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 500
    && (item.format === "pdf" || item.format === "epub")
    && typeof item.addedAt === "number" && Number.isFinite(item.addedAt)
    && typeof item.lastOpenedAt === "number" && Number.isFinite(item.lastOpenedAt)
    && typeof item.favorite === "boolean"
    && typeof item.page === "number" && Number.isInteger(item.page) && item.page >= 1
    && (item.cfi === null || typeof item.cfi === "string")
    && typeof item.fontSize === "number" && item.fontSize >= 70 && item.fontSize <= 180
    && typeof item.hasCover === "boolean";
}

export async function createBackup(books: StoredBook[]): Promise<Uint8Array> {
  const estimatedSize = books.reduce((total, book) => total + book.data.size + (book.cover?.size ?? 0), 0);
  if (estimatedSize > MAX_BACKUP_BYTES - 1024 * 1024) throw new Error(t("backupTooLargeLibrary"));
  const zip = new JSZip();
  const manifest: Manifest = {
    app: "autumn-reader",
    version: 1,
    createdAt: new Date().toISOString(),
    books: books.map(recordOf),
  };
  zip.file("manifest.json", JSON.stringify(manifest));
  for (const book of books) {
    zip.file(`books/${book.id}.bin`, book.data);
    if (book.cover) zip.file(`covers/${book.id}.bin`, book.cover);
  }
  const archive = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  if (archive.byteLength > MAX_BACKUP_BYTES) throw new Error(t("backupTooLarge"));
  return archive;
}

export async function readBackup(bytes: Uint8Array): Promise<StoredBook[]> {
  if (!bytes.byteLength || bytes.byteLength > MAX_BACKUP_BYTES) throw new Error(t("backupInvalidSize"));
  const zip = await JSZip.loadAsync(bytes);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error(t("backupNoManifest"));
  const manifest = JSON.parse(await manifestFile.async("string")) as Partial<Manifest>;
  if (manifest.app !== "autumn-reader" || manifest.version !== 1 || !Array.isArray(manifest.books) || manifest.books.length > 1000) {
    throw new Error(t("backupIncompatible"));
  }
  const ids = new Set<string>();
  const restored: StoredBook[] = [];
  let total = 0;
  for (const record of manifest.books) {
    if (!validRecord(record) || ids.has(record.id)) throw new Error(t("backupInvalidBooks"));
    if (record.notes !== undefined && (!Array.isArray(record.notes) || record.notes.length > 1000 || !record.notes.every((note) => validNote(note, record.format)))) {
      throw new Error(t("backupInvalidNotes"));
    }
    ids.add(record.id);
    const dataFile = zip.file(`books/${record.id}.bin`);
    if (!dataFile) throw new Error(t("backupMissingFile", { title: record.name }));
    const data = await dataFile.async("uint8array");
    total += data.byteLength;
    if (!data.byteLength || total > MAX_BACKUP_BYTES) throw new Error(t("backupFilesTooLarge"));
    const coverFile = record.hasCover ? zip.file(`covers/${record.id}.bin`) : null;
    if (record.hasCover && !coverFile) throw new Error(t("backupMissingCover", { title: record.name }));
    const cover = coverFile ? await coverFile.async("uint8array") : null;
    total += cover?.byteLength ?? 0;
    if (total > MAX_BACKUP_BYTES) throw new Error(t("backupFilesTooLarge"));
    restored.push({
      id: record.id,
      name: record.name,
      format: record.format,
      data: new Blob([new Uint8Array(data).buffer], { type: record.format === "pdf" ? "application/pdf" : "application/epub+zip" }),
      cover: cover ? new Blob([new Uint8Array(cover).buffer]) : undefined,
      addedAt: record.addedAt,
      lastOpenedAt: record.lastOpenedAt,
      favorite: record.favorite,
      page: record.page,
      cfi: record.cfi,
      fontSize: record.fontSize,
      notes: record.notes,
    });
  }
  return restored;
}
