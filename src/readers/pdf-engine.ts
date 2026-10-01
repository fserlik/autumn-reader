import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
let engine:
  Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | undefined;
export function loadPdfEngine(): Promise<
  typeof import("pdfjs-dist/legacy/build/pdf.mjs")
> {
  return (engine ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdf) => {
    pdf.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return pdf;
  }));
}
