import ePub from "epubjs";
import type { StoredBook } from "../../storage";
import { cacheBookContentMetadata, readBookData } from "../../storage";
import { auth } from "../auth";
import { loadPdfEngine } from "../../readers/pdf-engine";
import { optimizeCover } from "../storage/covers";

export interface BookContentMetadata { title?: string; author?: string; cover?: Blob }
const pending = new Map<string, Promise<StoredBook>>();
const clean = (value: unknown): string | undefined =>
  typeof value === "string" ? value.trim() || undefined : undefined;
const diagnostic = (message: string, reason?: unknown): void => {
  if (import.meta.env.DEV) console.info(message, reason instanceof Error ? reason.message : reason ?? "");
};

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
        try {
          const url = await epub.coverUrl();
          if (url && (url.startsWith("blob:") || url.startsWith("data:"))) {
            const response = await fetch(url);
            if (response.ok) result.cover = await optimizeCover(await response.blob());
          }
        } catch (error) { diagnostic("[BOOK COVER] EPUB image unavailable", error); }
      }
    } finally { epub.destroy(); }
  }
  return result;
}

/** Idempotent, account-scoped repair; the file is parsed once per local record. */
export function ensureBookContentMetadata(book: StoredBook, data?: Blob): Promise<StoredBook> {
  if (book.contentMetadataVersion === 1) return Promise.resolve(book);
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
      diagnostic("[BOOK COVER] fallback used: extraction failed", error);
      extracted = {};
    }
    if (auth.state.ownerId !== owner) return book;
    const cached = await cacheBookContentMetadata(book.id, extracted, book.fileHash);
    if (cached) diagnostic("[BOOK COVER] cached");
    return cached ?? book;
  })().finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}
