import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { t } from "../i18n";
export interface PdfLink { rect: number[]; destination: unknown }
export async function pdfPageLinks(page: PDFPageProxy): Promise<PdfLink[]> {
  const annotations: unknown[] = await page.getAnnotations({ intent: "display" }); const links: PdfLink[] = [];
  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== "object" || !("subtype" in annotation) || annotation.subtype !== "Link" || !("dest" in annotation) || !("rect" in annotation) || !Array.isArray(annotation.rect) || annotation.rect.length !== 4 || !annotation.rect.every(value => typeof value === "number" && Number.isFinite(value))) continue;
    if (typeof annotation.dest === "string" || Array.isArray(annotation.dest)) links.push({ rect: annotation.rect as number[], destination: annotation.dest });
  }
  return links;
}
export async function pdfDestination(document: PDFDocumentProxy, destination: unknown): Promise<{ page: number; sourceY?: number }> {
  const target: unknown = typeof destination === "string" ? await document.getDestination(destination) : destination;
  if (!Array.isArray(target) || !target.length) throw new Error(t("pdfReferenceInvalid"));
  const ref: unknown = target[0]; let pageIndex: number;
  if (typeof ref === "number" && Number.isInteger(ref)) pageIndex = ref;
  else if (ref && typeof ref === "object" && "num" in ref && "gen" in ref && typeof ref.num === "number" && typeof ref.gen === "number") pageIndex = await document.getPageIndex({ num: ref.num, gen: ref.gen });
  else throw new Error(t("pdfReferenceInvalid"));
  if (pageIndex < 0 || pageIndex >= document.numPages) throw new Error(t("pdfReferencePageMissing"));
  const mode: unknown = target[1]; const name = mode && typeof mode === "object" && "name" in mode ? mode.name : undefined;
  const top: unknown = name === "XYZ" ? target[3] : name === "FitH" || name === "FitBH" ? target[2] : undefined;
  if (typeof top !== "number") return { page: pageIndex + 1 };
  const page = await document.getPage(pageIndex + 1), viewport = page.getViewport({ scale: 1 });
  return { page: pageIndex + 1, sourceY: Math.max(0, Math.min(1, viewport.convertToViewportPoint(0, top)[1] / viewport.height)) };
}
