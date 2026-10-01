export const MAX_CLOUD_BOOK_BYTES = 32 * 1024 * 1024;
export type FileFormat = "epub" | "pdf";
export function validHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash);
}
export function validBookHeader(
  bytes: Uint8Array,
  format: FileFormat,
): boolean {
  const text = new TextDecoder();
  if (format === "pdf")
    return /^%PDF-\d\.\d/.test(text.decode(bytes.subarray(0, 8)));
  // The first ZIP member is not always `mimetype` in older books that EPUB.js
  // can read. Inspect the central directory before accepting the whole file.
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    bytes[2] === 3 && bytes[3] === 4;
}
function validEpubArchive(bytes: Uint8Array): boolean {
  if (!validBookHeader(bytes, "epub")) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder();
  for (let end = bytes.length - 22; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) continue;
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) return false;
    const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
    if (!count || count > 4096 || start + size > end) return false;
    let cursor = start, hasMime = false, hasContainer = false, hasPackage = false;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) return false;
      const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
      const compressed = view.getUint32(cursor + 20, true), raw = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
      const next = cursor + 46 + nameLength + extra + comment;
      if (!nameLength || next > end || flags & 1) return false;
      const name = text.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (name === "mimetype") {
        const local = view.getUint32(cursor + 42, true);
        if (local + 30 > start || view.getUint32(local, true) !== 0x04034b50 ||
          method !== 0 || compressed !== 20 || raw !== 20 || view.getUint16(local + 8, true) !== 0) return false;
        const content = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (content + 20 > start || text.decode(bytes.subarray(content, content + 20)) !== "application/epub+zip") return false;
        hasMime = true;
      }
      if (name === "META-INF/container.xml") hasContainer = true;
      if (name.toLowerCase().endsWith(".opf")) hasPackage = true;
      cursor = next;
    }
    return cursor === start + size && hasMime && hasContainer && hasPackage;
  }
  return false;
}
export function validateBookFile(
  bytes: Uint8Array,
  format: FileFormat,
): boolean {
  if (
    !bytes.length ||
    bytes.length > MAX_CLOUD_BOOK_BYTES ||
    !validBookHeader(bytes, format)
  )
    return false;
  if (format === "pdf")
    return new TextDecoder()
      .decode(bytes.subarray(Math.max(0, bytes.length - 2048)))
      .includes("%%EOF");
  // Inspect the actual mimetype member and EPUB package structure. A renamed
  // arbitrary ZIP never becomes an EPUB merely because its header is PK.
  return validEpubArchive(bytes);
}
export function identifyBookFile(bytes: Uint8Array): FileFormat | null {
  return validateBookFile(bytes, "pdf") ? "pdf" : validateBookFile(bytes, "epub") ? "epub" : null;
}
