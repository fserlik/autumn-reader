import JSZip from "jszip";
import { expect, test } from "vitest";
import { hashBlob } from "../../src/services/storage/hash";
import { identifyBookFile, validateBookFile } from "../../shared/book-file";
import type { StoredBook } from "../../src/storage";

async function epub(mimetype = "application/epub+zip"): Promise<Uint8Array> {
  const zip = new JSZip();
  // A valid legacy EPUB may store container.xml before mimetype.
  zip.file("META-INF/container.xml", '<container><rootfile full-path="OPS/book.opf"/></container>');
  zip.file("mimetype", mimetype, { compression: "STORE" });
  zip.file("OPS/book.opf", '<package version="3.0"><metadata/><manifest/><spine/></package>');
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}

test("recognizes a historical EPUB from its bytes with empty or generic MIME and any filename", async () => {
  const bytes = await epub();
  for (const name of ["Libro.epub", "A buen fin.epub", "A_buen_fin-Shakespeare.epub", "Crónica.epub"]) {
    for (const mime of ["application/epub+zip", "", "application/octet-stream"]) {
      const legacy = { id: name, name, data: new Blob([bytes], { type: mime }) } as StoredBook;
      const recovered = new Uint8Array(await legacy.data.arrayBuffer());
      expect(identifyBookFile(recovered)).toBe("epub");
      expect(validateBookFile(recovered, "epub")).toBe(true);
    }
  }
  expect(await hashBlob(new Blob([bytes], { type: "" }))).toBe(await hashBlob(new Blob([bytes], { type: "application/octet-stream" })));
});

test("recognizes PDF without MIME and rejects renamed or incomplete archives", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\nbody\n%%EOF");
  for (const mime of ["application/pdf", ""]) {
    const blob = new Blob([pdf], { type: mime });
    expect(identifyBookFile(new Uint8Array(await blob.arrayBuffer()))).toBe("pdf");
  }
  expect(identifyBookFile(new TextEncoder().encode("not a PDF"))).toBeNull();
  expect(identifyBookFile(await epub("application/not-an-epub"))).toBeNull();
  const arbitraryZip = new JSZip(); arbitraryZip.file("content.txt", "hello");
  expect(identifyBookFile(await arbitraryZip.generateAsync({ type: "uint8array" }))).toBeNull();
});
