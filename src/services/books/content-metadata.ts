import ePub, { type Book as EpubBook } from "epubjs";
import type { StoredBook } from "../../storage";
import { cacheBookContentMetadata, readBookData } from "../../storage";
import { auth } from "../auth";
import { loadPdfEngine } from "../../readers/pdf-engine";
import { optimizeCover } from "../storage/covers";
import { BOOK_CONTENT_METADATA_VERSION } from "./content-metadata-version";

export interface BookContentMetadata { title?: string; author?: string; cover?: Blob }
const pending = new Map<string, Promise<StoredBook>>();
const clean = (value: unknown): string | undefined =>
  typeof value === "string" ? value.trim() || undefined : undefined;
const diagnostic = (message: string, reason?: unknown): void => {
  if (import.meta.env.DEV) console.info(message, reason instanceof Error ? reason.message : reason ?? "");
};

const elements = (document: Document, name: string): Element[] =>
  Array.from(document.getElementsByTagNameNS("*", name));

function archivePath(baseFile: string, href: string): string | undefined {
  const clean = href.trim().replace(/\\/g, "/").split(/[?#]/, 1)[0];
  if (!clean || /^(?:data|blob|https?):/i.test(clean)) return undefined;
  const parts = clean.startsWith("/") ? [] : baseFile.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  try { return decodeURIComponent(parts.join("/")); }
  catch { return parts.join("/"); }
}

function imageType(path: string, declared?: string): string {
  if (declared?.startsWith("image/")) return declared;
  const extension = path.toLocaleLowerCase().split(".").at(-1);
  return extension === "png" ? "image/png"
    : extension === "svg" ? "image/svg+xml"
      : extension === "gif" ? "image/gif"
        : extension === "webp" ? "image/webp"
          : "image/jpeg";
}

async function coverBlobFromEntry(
  epub: EpubBook,
  baseFile: string,
  href: string,
  declaredType?: string,
  visited = new Set<string>(),
): Promise<Blob | undefined> {
  const path = archivePath(baseFile, href);
  if (!path || visited.has(path)) return undefined;
  visited.add(path);
  const archiveUrl = path.startsWith("/") ? path : `/${path}`;
  const type = declaredType?.toLocaleLowerCase() ?? "";
  const image = type.startsWith("image/") || /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(path);
  if (image) return epub.archive.getBlob(archiveUrl, imageType(path, type));

  if (!/(?:html|xhtml|xml)$/.test(type) && !/\.(?:x?html?)$/i.test(path)) return undefined;
  const pageText = await epub.archive.getText(archiveUrl);
  if (!pageText) return undefined;
  const page = new DOMParser().parseFromString(pageText, "application/xhtml+xml");
  const visual = [...elements(page, "img"), ...elements(page, "image"), ...elements(page, "object")]
    .find(element => element.getAttribute("src") || element.getAttribute("href") ||
      element.getAttributeNS("http://www.w3.org/1999/xlink", "href") || element.getAttribute("data"));
  const source = visual?.getAttribute("src") || visual?.getAttribute("href") ||
    visual?.getAttributeNS("http://www.w3.org/1999/xlink", "href") || visual?.getAttribute("data");
  return source ? coverBlobFromEntry(epub, path, source, undefined, visited) : undefined;
}

/** Resolve EPUB 2 cover pages and less consistent manifests that epubjs cannot expose as an image URL. */
async function extractEpubCover(epub: EpubBook): Promise<Blob | undefined> {
  const manifest = Object.values(epub.packaging.manifest);
  const coverPath = (epub as EpubBook & { cover?: string }).cover ||
    (epub.packaging.coverPath ? epub.resolve(epub.packaging.coverPath) : undefined);
  const declared = manifest.find(item => item.href === epub.packaging.coverPath)?.type;
  if (coverPath) {
    const cover = await coverBlobFromEntry(epub, "/", coverPath, declared);
    if (cover) return cover;
  }
  const packagePath = epub.resolve((epub.container as unknown as { packagePath?: string }).packagePath ?? "");
  if (!packagePath) return undefined;
  const packageText = await epub.archive.getText(packagePath);
  if (!packageText) return undefined;
  const opf = new DOMParser().parseFromString(packageText, "application/xml");
  const guideHref = elements(opf, "reference")
    .find(element => (element.getAttribute("type") ?? "").toLocaleLowerCase().split(/\s+/).includes("cover"))
    ?.getAttribute("href");
  const candidate = Object.entries(epub.packaging.manifest)
    .find(([id, item]) => item.type.startsWith("image/") && /(?:^|[-_.])cover(?:[-_.]|$)/i.test(`${id} ${item.href}`))?.[1];
  if (candidate?.href) {
    const cover = await coverBlobFromEntry(epub, packagePath, candidate.href, candidate.type);
    if (cover) return cover;
  }
  return guideHref ? coverBlobFromEntry(epub, packagePath, guideHref) : undefined;
}

/** The same EPUB/PDF parser is used after a manual import and an R2 download. */
export async function extractBookContentMetadata(
  data: ArrayBuffer,
  format: StoredBook["format"],
  skipCover = false,
): Promise<BookContentMetadata> {
  const result: BookContentMetadata = {};
  if (format === "pdf") {
    const { getDocument } = await loadPdfEngine();
    const task = getDocument({ data: new Uint8Array(data) });
    try {
      const pdf = await task.promise;
      try {
        const metadata = await pdf.getMetadata();
        const info = metadata.info as unknown as Record<string, unknown>;
        result.title = clean(info.Title);
        result.author = clean(info.Author);
      } catch (error) { diagnostic("[BOOK METADATA] PDF metadata unavailable", error); }
      if (!skipCover && pdf.numPages) {
        try {
          const page = await pdf.getPage(1);
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: 250 / Math.max(1, natural.width) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (context) {
            await page.render({ canvasContext: context, canvas, viewport }).promise;
            const cover = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
            if (cover) result.cover = await optimizeCover(cover);
          }
        } catch (error) { diagnostic("[BOOK COVER] PDF first page unavailable", error); }
      }
    } finally { await task.destroy(); }
  } else {
    const epub = ePub(data);
    try {
      await epub.ready;
      result.title = clean(epub.packaging?.metadata?.title);
      result.author = clean(epub.packaging?.metadata?.creator);
      if (!skipCover) {
        let coverResolved = false;
        try {
          const url = await epub.coverUrl();
          if (url && (url.startsWith("blob:") || url.startsWith("data:"))) {
            const response = await fetch(url);
            if (response.ok) {
              result.cover = await optimizeCover(await response.blob());
              coverResolved = true;
            }
          }
        } catch (error) { diagnostic("[BOOK COVER] EPUB image unavailable", error); }
        if (!coverResolved) {
          try {
            const cover = await extractEpubCover(epub);
            if (cover) result.cover = await optimizeCover(cover);
          } catch (error) { diagnostic("[BOOK COVER] EPUB manifest fallback unavailable", error); }
        }
      }
    } finally { epub.destroy(); }
  }
  return result;
}

/** Idempotent, account-scoped repair; the file is parsed once per local record. */
export function ensureBookContentMetadata(book: StoredBook, data?: Blob): Promise<StoredBook> {
  if (book.contentMetadataVersion === BOOK_CONTENT_METADATA_VERSION) return Promise.resolve(book);
  const owner = book.ownerId;
  if (!owner || auth.state.ownerId !== owner) return Promise.resolve(book);
  const key = `${owner}:${book.id}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const work = (async () => {
    const buffer = data ? await data.arrayBuffer() : await readBookData(book);
    if (auth.state.ownerId !== owner) return book;
    let extracted: BookContentMetadata;
    try {
      extracted = await extractBookContentMetadata(buffer, book.format, Boolean(book.customCover || book.coverPath));
      diagnostic("[BOOK METADATA] extracted", book.format);
      diagnostic(extracted.cover ? "[BOOK COVER] extracted" : book.customCover || book.coverPath
        ? "[BOOK COVER] custom preserved" : "[BOOK COVER] fallback used: no usable embedded cover");
    } catch (error) {
      // Do not mark a transient parser/read failure as complete: a later load
      // must be allowed to recover the real metadata and cover.
      diagnostic("[BOOK COVER] extraction deferred after failure", error);
      return book;
    }
    if (auth.state.ownerId !== owner) return book;
    const cached = await cacheBookContentMetadata(
      book.id,
      extracted,
      book.fileHash,
      BOOK_CONTENT_METADATA_VERSION,
    );
    if (cached) diagnostic("[BOOK COVER] cached");
    return cached ?? book;
  })().finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}
