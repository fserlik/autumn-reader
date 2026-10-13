import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { ServiceError } from "./diagnostics.ts";
import { validatePdfFragment } from "./pdf-validator.ts";
import * as realPdfJs from "npm:unpdf@1.8.0/pdfjs";

const encryptedPdfBase64 = "JVBERi0xLjcKJYCBgoMKMSAwIG9iago8PC9QYWdlcyA2IDAgUi9UeXBlL0NhdGFsb2c+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL0VuY29kaW5nL0Jhc2VFbmNvZGluZy9XaW5BbnNpRW5jb2Rpbmc+PgplbmRvYmoKMyAwIG9iago8PC9QYXJlbnQgNiAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pi9NZWRpYUJveFswIDAgMjAwIDUwXS9UeXBlL1BhZ2UvQ29udGVudHMgNCAwIFI+PgplbmRvYmoKNCAwIG9iago8PC9GaWx0ZXIvRmxhdGVEZWNvZGUvTGVuZ3RoIDY0Pj4Kc3RyZWFtCoLVBjaQMojW9XxRJGq+lYOvXoJCSEpDPAF337LGTSVYMzN17LC6GTsBvSqhHqwYgmnNu8Te9kv2zzmzpq1JUvEKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L0Jhc2VGb250L1RpbWVzLVJvbWFuL1N1YnR5cGUvVHlwZTEvVHlwZS9Gb250L0VuY29kaW5nIDIgMCBSPj4KZW5kb2JqCjYgMCBvYmoKPDwvTWVkaWFCb3hbMCAwIDIwMCA1MF0vS2lkc1szIDAgUl0vVHlwZS9QYWdlcy9Db3VudCAxPj4KZW5kb2JqCnhyZWYKMCA3IAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2MCAwMDAwMCBuIAowMDAwMDAwMTIzIDAwMDAwIG4gCjAwMDAwMDAyMzQgMDAwMDAgbiAKMDAwMDAwMDM2NSAwMDAwMCBuIAowMDAwMDAwNDQ1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA3L0lEWygXZ1VlPi9qv1+DODqCO9sSKSgXZ1VlPi9qv1+DODqCO9sSKV0vRW5jcnlwdDw8L0ZpbHRlci9TdGFuZGFyZC9WIDUvQ0Y8PC9TdGRDRjw8L0xlbmd0aCAzMi9BdXRoRXZlbnQvRG9jT3Blbi9DRk0vQUVTVjM+Pj4+L0VuY3J5cHRNZXRhZGF0YSB0cnVlL0xlbmd0aCAyNTYvUiA2L08oBBDp9Dbi1lwoq1QjuPODiY8TazZQUemOklxumujjYECUtRok775L/uudEGXA+SBGhOIpL1Uo7+nLIDTJNPWafj5XhW5ULfs6hMb4fXxYU3ZmMiwXON+bXpcs6n13o4czXGbc3f0HkCkvUCAtNC9TdHJGL1N0ZENGL1N0bUYvU3RkQ0YvUGVybXMo1+zA7xGnXHIQMdYP6W8Yi3UpL09FKMU/0U+DnevmnVwoHlG4EzVGC/3pUhNWgsZK0v8sHFZZ9ikvVUUoRWLubHC3S8M1f7FQTK3c+skDAUZxSRX2RDydgD74PPQpPj4vUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgo1MTcKJSVFT0YK";

function pdf(objects: string[]): Uint8Array<ArrayBuffer> {
  let source = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(source.length); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(new TextEncoder().encode(source));
}

const stream = (value: string) => `<< /Length ${value.length} >>\nstream\n${value}\nendstream`;

function multiStructurePdf(): Uint8Array<ArrayBuffer> {
  const first = "BT /F1 12 Tf 72 720 Td (Primera pagina.) Tj ET";
  const secondA = "BT /F1 12 Tf 72 720 Td (Segunda ) Tj ET";
  const secondB = "BT /F1 12 Tf 72 700 Td (estructura distinta.) Tj ET";
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 8 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 8 0 R >> >> /Contents [6 0 R 7 0 R] >>",
    stream(first), stream(secondA), stream(secondB),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}

function emptyTextPdf(): Uint8Array<ArrayBuffer> {
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>",
    stream(""),
  ]);
}

function encryptedPdf(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(encryptedPdfBase64), character => character.charCodeAt(0));
}

async function expectParserError(run: () => Promise<unknown>, safeCode: string, errorType: string, parserStage: string) {
  const error = await assertRejects(run, ServiceError);
  assertEquals(error.safeCode, safeCode);
  assertEquals(error.errorType, errorType);
  assertEquals(error.parserStage, parserStage);
}

Deno.test("serverless PDF.js validates referenced pages and multiple content streams under Deno", async () => {
  assertEquals(typeof Deno.version.deno, "string");
  const bytes = multiStructurePdf();
  assertEquals(await validatePdfFragment(bytes, "pdf-1-0-0", "Primera pagina"), true);
  assertEquals(await validatePdfFragment(bytes, "pdf-2-0-0", "Segunda estructura distinta"), true);
  assertEquals(await validatePdfFragment(bytes, "pdf-2-0-0", "texto enviado arbitrariamente"), false);
});

Deno.test("password-protected PDFs return a controlled encrypted-document error", async () => {
  await expectParserError(() => validatePdfFragment(encryptedPdf(), "pdf-1-0-0", "secret"), "pdf_encrypted", "pdf_password_required", "encryption");
});

Deno.test("damaged and textless PDFs have distinct controlled failures", async () => {
  await expectParserError(
    () => validatePdfFragment(new TextEncoder().encode("not a pdf"), "pdf-1-0-0", "text"),
    "pdf_damaged", "pdf_invalid_document", "document_load",
  );
  await expectParserError(
    () => validatePdfFragment(emptyTextPdf(), "pdf-1-0-0", "text"),
    "pdf_no_extractable_text", "pdf_no_extractable_text", "text_extraction",
  );
});

Deno.test("module loading, initialization, extraction and fragment failures remain distinguishable", async () => {
  const bytes = multiStructurePdf();
  await expectParserError(
    () => validatePdfFragment(bytes, "pdf-1-0-0", "text", () => Promise.reject(new Error("sensitive loader detail"))),
    "pdf_validation_unavailable", "pdf_module_load_error", "module_load",
  );
  await expectParserError(
    () => validatePdfFragment(bytes, "pdf-1-0-0", "text", () => Promise.resolve({} as never)),
    "pdf_validation_unavailable", "pdf_module_initialization_error", "module_initialization",
  );
  const extractionFailure = {
    ...realPdfJs,
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getMetadata: () => Promise.resolve({ info: {} }),
        getPage: () => Promise.resolve({ getTextContent: () => Promise.reject(new Error("sensitive extraction detail")) }),
      }),
      destroy: () => Promise.resolve(),
    }),
  } as unknown as typeof realPdfJs;
  await expectParserError(
    () => validatePdfFragment(bytes, "pdf-1-0-0", "text", () => Promise.resolve(extractionFailure)),
    "pdf_damaged", "pdf_text_extraction_error", "text_extraction",
  );
  await expectParserError(
    () => validatePdfFragment(bytes, "pdf-3-0-0", "text"),
    "book_text_unverified", "pdf_page_out_of_range", "fragment_validation",
  );
});
