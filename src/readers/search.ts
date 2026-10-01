import type { Book as EpubBook } from "epubjs";
import { t } from "../i18n";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pdfTextBlocks } from "../pdf-text";
import type { ReaderPosition } from "./history";
export const MAX_SEARCH_RESULTS = 10000;
export interface SearchResult { unit: number; start: number; length: number; excerpt: string; quote: string; y?: number }
export interface SearchResponse { results: SearchResult[]; hasText: boolean; limited: boolean }
export interface BookSearch {
  search(query: string, signal: AbortSignal, progress?: (processed: number, total: number) => void): Promise<SearchResponse>;
  position(result: SearchResult,signal?:AbortSignal): Promise<ReaderPosition>;
  dispose(): void;
}
type TextUnit = { text: string; anchors?: { start: number; y: number }[] };
const pause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
const normalized = (text: string): string => text.replace(/\s+/gu, " ");
export function textMatches(text: string, query: string, unit = 0, limit = MAX_SEARCH_RESULTS): SearchResult[] {
  const value = normalized(query).trim(); if (!value) return [];
  const pattern = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const results: SearchResult[] = [];
  for (let match = pattern.exec(text); match && results.length < limit; match = pattern.exec(text)) {
    const start = match.index, length = match[0].length;
    results.push({ unit, start, length, quote: text.slice(start, start + length), excerpt: `${start > 50 ? "…" : ""}${text.slice(Math.max(0, start - 50), start + length + 80)}${start + length + 80 < text.length ? "…" : ""}` });
  }
  return results;
}
type Segment = { node: Text; start: number; text: string };
function* epubTextChunks(document: Document,root:Element = document.body ?? document.documentElement): Generator<void,{ text: string; segments: Segment[] }> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: Segment[] = []; let text = "", previousBlock: Element | null = null, processed = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++processed % 256 === 0) yield;
    if (node.parentElement?.closest("script,style,noscript,head")) continue;
    const value = normalized(node.textContent ?? ""); if (!value) continue;
    const block = node.parentElement?.closest("p,div,li,h1,h2,h3,h4,h5,h6,blockquote,section") ?? null;
    if (text && block !== previousBlock && !text.endsWith(" ") && !value.startsWith(" ")) text += " ";
    segments.push({ node: node as Text, start: text.length, text: value }); text += value; previousBlock = block;
  }
  return { text, segments };
}
function epubText(document: Document,root?: Element): { text: string; segments: Segment[] } {
  const chunks = epubTextChunks(document, root); let part = chunks.next();
  while (!part.done) part = chunks.next();
  return part.value;
}
async function indexedEpubText(document: Document): Promise<{ text: string; segments: Segment[] }> {
  const chunks = epubTextChunks(document); let part = chunks.next();
  while (!part.done) { await pause(); part = chunks.next(); }
  return part.value;
}
function rawOffset(raw: string, offset: number): number {
  let normalizedOffset = 0;
  for (let i = 0; i < raw.length;) {
    if (normalizedOffset >= offset) return i;
    if (/\s/u.test(raw[i])) { while (i < raw.length && /\s/u.test(raw[i])) i++; }
    else i++;
    normalizedOffset++;
  }
  return raw.length;
}
function rangeForMatch(document: Document, segments: Segment[], match: SearchResult): Range {
  const first = segments.find(s => match.start >= s.start && match.start < s.start + s.text.length);
  const end = match.start + match.length;
  const last = segments.find(s => end > s.start && end <= s.start + s.text.length);
  if (!first || !last) throw new Error(t("searchPositionUnavailable"));
  const range = document.createRange();
  range.setStart(first.node, rawOffset(first.node.data, match.start - first.start));
  range.setEnd(last.node, rawOffset(last.node.data, end - last.start)); return range;
}
class TextSearch implements BookSearch {
  private readonly cache = new Map<number, TextUnit>();
  private readonly loading = new Map<number, Promise<TextUnit>>();
  private cacheBytes = 0;
  private disposed = false;
  constructor(private count: number, private load: (unit: number) => Promise<TextUnit>, private resolve: (result: SearchResult) => Promise<ReaderPosition>) {}
  async position(result:SearchResult,signal?:AbortSignal):Promise<ReaderPosition>{signal?.throwIfAborted();if(this.disposed)throw new DOMException("Closed","AbortError");const position=await this.resolve(result);signal?.throwIfAborted();if(this.disposed)throw new DOMException("Closed","AbortError");return position;}
  async search(query: string, signal: AbortSignal, progress?: (processed: number, total: number) => void): Promise<SearchResponse> {
    const results: SearchResult[] = []; let hasText = false, limited = false;
    for (let i = 0; i < this.count; i++) {
      signal.throwIfAborted(); if (this.disposed) throw new DOMException("Closed", "AbortError");
      let unit = this.cache.get(i);
      if (!unit) {
        let pending = this.loading.get(i);
        if (!pending) { pending = this.load(i); this.loading.set(i, pending); }
        try { unit = await pending; } finally { this.loading.delete(i); }
        // Bounded session index. Very large documents re-extract evicted units, never their files.
        if(this.disposed)throw new DOMException("Closed","AbortError");
        if(!this.cache.has(i)){this.cache.set(i, unit); this.cacheBytes += unit.text.length * 2;}
        while (this.cacheBytes > 20 * 1024 * 1024 && this.cache.size > 1) {
          const oldest = this.cache.keys().next().value!; this.cacheBytes -= this.cache.get(oldest)!.text.length * 2; this.cache.delete(oldest);
        }
      }
      signal.throwIfAborted(); hasText ||= Boolean(unit.text.trim());
      const matches = textMatches(unit.text, query, i, MAX_SEARCH_RESULTS - results.length);
      let anchorIndex=0;
      for (const match of matches) {
        if (unit.anchors){while(anchorIndex+1<unit.anchors.length&&unit.anchors[anchorIndex+1].start<=match.start)anchorIndex++;match.y=unit.anchors[anchorIndex]?.y??0;}
        results.push(match);
      }
      progress?.(i + 1, this.count); await pause();
      if (results.length >= MAX_SEARCH_RESULTS) { limited = true; break; }
    }
    return { results, hasText, limited };
  }
  dispose(): void { this.disposed = true; this.cache.clear(); this.loading.clear(); }
}
/** Rectangles in the original PDF text layer: no changes to glyph layout or
 * selection. Pick the occurrence nearest the note's original page coordinate. */
export function quoteRects(root:HTMLElement,quote:string,y:number):DOMRect[]{
  const doc=root.ownerDocument,{text,segments}=epubText(doc,root),bounds=root.getBoundingClientRect();
  let nearest:DOMRect[]=[];let distance=Infinity;
  for(const match of textMatches(text,quote,0,1000)){
    try{const rects=[...rangeForMatch(doc,segments,match).getClientRects()];const delta=Math.abs((rects[0]?.top??bounds.top)-bounds.top-y*bounds.height);
      if(delta<distance){distance=delta;nearest=rects;}}
    catch{/* PDF text marked as non-selectable can have no usable range. */}
  }
  return nearest;
}
export function epubSearch(book: EpubBook): BookSearch {
  const count = book.spine.last().index + 1;
  return new TextSearch(count, async i => {
    const section = book.spine.get(i); await section.load(book.load.bind(book));
    try { return { text: (await indexedEpubText(section.document)).text }; }
    finally { section.unload(); }
  }, async result => {
    const section = book.spine.get(result.unit); await section.load(book.load.bind(book));
    try {
      const range = rangeForMatch(section.document, (await indexedEpubText(section.document)).segments, result);
      return { format: "epub", cfi: section.cfiFromRange(range), label: t("section", { number: result.unit + 1 }) };
    } finally { section.unload(); }
  });
}
export function pdfSearch(document: PDFDocumentProxy): BookSearch {
  return new TextSearch(document.numPages, async i => {
    const page = await document.getPage(i + 1), blocks = pdfTextBlocks(await page.getTextContent(), page.getViewport({ scale: 1 }));
    let text = ""; const anchors: { start: number; y: number }[] = [];
    for (const block of blocks) for (const line of block.lines) { anchors.push({ start: text.length, y: line.sourceY }); text += line.text + " "; }
    return { text, anchors };
  }, async result => ({ format: "pdf", page: result.unit + 1, offset: 0, scrollTop: 0, scrollLeft: 0 }));
}
