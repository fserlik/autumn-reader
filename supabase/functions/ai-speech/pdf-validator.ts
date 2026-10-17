import { ServiceError } from "./diagnostics.ts";
import { speechTextValidationKey } from "../../../shared/ai-speech.ts";
import "./pdf-runtime.ts";
import * as serverlessPdfJs from "npm:unpdf@1.8.0/pdfjs";

type PdfJsModule = typeof serverlessPdfJs;
type PdfModuleLoader = () => Promise<PdfJsModule>;
type PdfTextItem = {
  str: string;
  hasEOL?: boolean;
  transform?: ArrayLike<number>;
  width?: number;
};
type PdfTextContent = { items: unknown[] };
type PdfPage = { getTextContent: (options?: Record<string, unknown>) => Promise<PdfTextContent> };
type PdfDocument = {
  numPages: number;
  getMetadata: () => Promise<{ info?: { EncryptFilterName?: unknown } }>;
  getPage: (page: number) => Promise<PdfPage>;
};
type PdfLoadingTask = { promise: Promise<PdfDocument>; destroy: () => Promise<void> };

const PDF_OPERATION_TIMEOUT_MS = 15_000;
const PDF_MAX_PAGES = 10_000;

const parserError = (safeCode: string, errorType: string, parserStage: string) =>
  new ServiceError(safeCode, errorType, "book_parser", undefined, parserStage);

function comparable(value: string): string {
  return value.normalize("NFKC").replace(/\u00ad/gu, "").replace(/\s+/gu, " ").trim();
}

function isTextItem(value: unknown): value is PdfTextItem {
  return typeof value === "object" && value !== null && "str" in value && typeof (value as { str?: unknown }).str === "string";
}

/** Reconstruct the same readable line flow used by the PDF reader without rendering fonts or canvases. */
function extractedPageText(content: PdfTextContent): string {
  const lines: string[] = [];
  let line = "", lineX = 0, lineY = 0, lineSize = 0, endX = 0;
  const flush = () => { if (line.trim()) lines.push(line.trim()); line = ""; };
  for (const raw of content.items) {
    if (!isTextItem(raw)) continue;
    const item = raw;
    const transform = item.transform;
    const hasGeometry = Boolean(transform && transform.length >= 6 && Array.from(transform).slice(0, 6).every(Number.isFinite));
    const x = hasGeometry ? Number(transform![4]) : endX;
    const y = hasGeometry ? Number(transform![5]) : lineY;
    const size = hasGeometry ? Math.max(1, Math.hypot(Number(transform![0]), Number(transform![1]))) : Math.max(1, lineSize);
    const text = item.str.replace(/\s+/gu, " ");
    if (!text.trim()) {
      if (item.hasEOL) flush();
      else if (line && text) line += " ";
      continue;
    }
    if (line && hasGeometry && (Math.abs(lineY - y) > Math.max(lineSize, size) * .5 || x - endX > size * 3 || x < lineX - size)) flush();
    if (!line) { lineX = x; lineY = y; lineSize = size; endX = x; }
    if (line && !/\s$/u.test(line) && !/^\s/u.test(text) && (!hasGeometry || x - endX > size * .12)) line += " ";
    line += text;
    endX = x + (Number.isFinite(item.width) ? Number(item.width) : 0);
    lineSize = Math.max(lineSize, size);
    if (item.hasEOL) flush();
  }
  flush();
  return lines.reduce((result, current) => {
    if (!result) return current;
    return /[-\u00ad]$/u.test(result) ? result + current : `${result} ${current}`;
  }, "");
}

function passwordFailure(reason: unknown, pdfjs: PdfJsModule): boolean {
  const value = reason as { name?: unknown; code?: unknown } | null;
  return value?.name === "PasswordException" ||
    value?.code === pdfjs.PasswordResponses.NEED_PASSWORD || value?.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
}

function damagedDocumentFailure(reason: unknown): boolean {
  const name = (reason as { name?: unknown } | null)?.name;
  return name === "InvalidPDFException" || name === "MissingPDFException" || name === "UnexpectedResponseException";
}

async function withTimeout<T>(promise: Promise<T>, errorType: string, parserStage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(parserError("pdf_damaged", errorType, parserStage)), PDF_OPERATION_TIMEOUT_MS);
  });
  try { return await Promise.race([promise, timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function validatePdfFragment(
  bytes: Uint8Array<ArrayBuffer>,
  fragmentId: string,
  requestedText: string,
  // Keep this static dependency in the Edge bundle. Supabase's hosted runtime does not
  // reliably resolve a lazy bare/npm specifier after the eszip has started executing.
  loadPdfModule: PdfModuleLoader = () => Promise.resolve(serverlessPdfJs),
): Promise<boolean> {
  const match = /^pdf-(\d+)-/.exec(fragmentId);
  const pageNumber = Number(match?.[1]);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1)
    throw parserError("book_text_unverified", "invalid_pdf_fragment", "fragment_validation");

  const needle = comparable(requestedText);
  if (!needle) return false;

  let pdfjs: PdfJsModule;
  try { pdfjs = await loadPdfModule(); }
  catch { throw parserError("pdf_validation_unavailable", "pdf_module_load_error", "module_load"); }
  if (!pdfjs || typeof pdfjs.getDocument !== "function" || !pdfjs.PasswordResponses || !pdfjs.VerbosityLevel)
    throw parserError("pdf_validation_unavailable", "pdf_module_initialization_error", "module_initialization");

  let task: PdfLoadingTask | undefined;
  let document: PdfDocument | undefined;
  try {
    try {
      // unpdf/pdfjs is a serverless PDF.js bundle: its worker is inlined, and text extraction
      // does not need browser font, canvas, worker URL, CMap, standard-font, or WASM assets.
      const documentOptions = {
        data: bytes.slice(),
        disableAutoFetch: true,
        disableFontFace: true,
        disableRange: true,
        disableStream: true,
        isEvalSupported: false,
        maxImageSize: 1,
        stopAtErrors: true,
        useSystemFonts: false,
        useWasm: false,
        useWorkerFetch: false,
        verbosity: pdfjs.VerbosityLevel.ERRORS,
      } as unknown as Parameters<typeof pdfjs.getDocument>[0];
      task = pdfjs.getDocument(documentOptions) as unknown as PdfLoadingTask;
    } catch {
      throw parserError("pdf_validation_unavailable", "pdf_module_initialization_error", "module_initialization");
    }

    try { document = await withTimeout(task.promise, "pdf_document_timeout", "document_load"); }
    catch (reason) {
      if (reason instanceof ServiceError) throw reason;
      if (passwordFailure(reason, pdfjs)) throw parserError("pdf_encrypted", "pdf_password_required", "encryption");
      if (damagedDocumentFailure(reason)) throw parserError("pdf_damaged", "pdf_invalid_document", "document_load");
      throw parserError("pdf_damaged", "pdf_document_read_error", "document_load");
    }

    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1 || document.numPages > PDF_MAX_PAGES)
      throw parserError("pdf_damaged", "pdf_invalid_page_count", "document_load");
    try {
      const metadata = await withTimeout(document.getMetadata(), "pdf_metadata_timeout", "encryption");
      if (typeof metadata.info?.EncryptFilterName === "string")
        throw parserError("pdf_encrypted", "pdf_encrypted_document", "encryption");
    } catch (reason) {
      if (reason instanceof ServiceError) throw reason;
      throw parserError("pdf_damaged", "pdf_metadata_read_error", "document_load");
    }
    if (pageNumber > document.numPages)
      throw parserError("book_text_unverified", "pdf_page_out_of_range", "fragment_validation");

    let content: PdfTextContent;
    try {
      const page = await withTimeout(document.getPage(pageNumber), "pdf_page_read_timeout", "text_extraction");
      content = await withTimeout(page.getTextContent({ disableNormalization: false, includeMarkedContent: false }), "pdf_text_extraction_timeout", "text_extraction");
    } catch (reason) {
      if (reason instanceof ServiceError) throw reason;
      if (passwordFailure(reason, pdfjs)) throw parserError("pdf_encrypted", "pdf_password_required", "encryption");
      throw parserError("pdf_damaged", "pdf_text_extraction_error", "text_extraction");
    }

    const pageText = comparable(extractedPageText(content));
    if (!pageText) throw parserError("pdf_no_extractable_text", "pdf_no_extractable_text", "text_extraction");
    return pageText.includes(needle) || speechTextValidationKey(pageText).includes(speechTextValidationKey(needle));
  } finally {
    try { await task?.destroy(); } catch { /* Cleanup must not mask the classified parser result. */ }
  }
}
