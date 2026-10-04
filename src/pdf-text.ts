import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { defaultPagePreferences, type PagePreferences } from "./services/preferences/page";

type TextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;
type Viewport = ReturnType<PDFPageProxy["getViewport"]>;
type TextLine = { text: string; x: number; y: number; size: number; sourceY: number; endX: number };
export type PdfTextBlock = { heading: boolean; lines: TextLine[] };

/** Keep source positions so annotations still refer to the original PDF page. */
export function pdfTextBlocks(content: TextContent, viewport: Viewport): PdfTextBlock[] {
  const lines: TextLine[] = [];
  let line: TextLine | undefined;
  const flush = () => { if (line?.text.trim()) lines.push(line); line = undefined; };
  for (const item of content.items) {
    if (!("str" in item)) continue;
    if (!item.str.trim()) { if (item.hasEOL) flush(); else if (line && item.str) line.text += " "; continue; }
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const size = Math.max(1, Math.hypot(item.transform[0], item.transform[1]));
    if (line && (Math.abs(line.y - y) > Math.max(line.size, size) * .5 || x - line.endX > size * 3 || x < line.x - size)) flush();
    if (!line) {
      const ascent = content.styles[item.fontName]?.ascent ?? .8;
      line = { text: "", x, y, size, sourceY: Math.max(0, Math.min(1, (y - size * ascent) / viewport.height)), endX: x };
    }
    if (line.text && !/\s$/.test(line.text) && !/^\s/.test(item.str) && x - line.endX > size * .12) line.text += " ";
    line.text += item.str.replace(/\s+/g, " ");
    line.endX = x + item.width;
    line.size = Math.max(line.size, size);
    if (item.hasEOL) flush();
  }
  flush();
  if (!lines.length) return [];
  const bySize = [...lines].sort((a, b) => a.size - b.size);
  const totalWeight = bySize.reduce((sum, item) => sum + item.text.length, 0);
  let weight = 0;
  const bodySize = bySize.find((item) => (weight += item.text.length) >= totalWeight / 2)!.size;
  const blocks: PdfTextBlock[] = [];
  let previous: TextLine | undefined;
  for (const current of lines) {
    current.text = current.text.trim();
    const heading = current.size > bodySize * 1.15;
    const last = blocks.at(-1);
    const newParagraph = !previous || !last || heading || last.heading
      || current.y < previous.y - bodySize
      || current.y - previous.y > bodySize * 1.9
      || current.x - previous.x > bodySize * .9;
    if (newParagraph) blocks.push({ heading, lines: [current] });
    else last.lines.push(current);
    previous = current;
  }
  return blocks;
}

export class PdfTextView {
  readonly viewport = document.createElement("div");
  readonly flow = document.createElement("div");
  readonly count: number;
  index = 0;
  private readonly step: number;

  constructor(readonly sheet: HTMLElement, blocks: PdfTextBlock[], fontSize: number, fontFamily: string, spacing: PagePreferences = defaultPagePreferences) {
    this.viewport.className = "pdf-reading-viewport";
    this.flow.className = "pdf-reading-text";
    this.flow.style.fontSize = `${fontSize}px`;
    this.flow.style.lineHeight = String(spacing.lineHeight);
    this.flow.style.fontFamily = fontFamily || 'Georgia, "Times New Roman", serif';
    this.flow.style.wordSpacing = `${spacing.wordSpacing}em`;
    this.flow.style.letterSpacing = `${spacing.letterSpacing}em`;
    for (const block of blocks) {
      const paragraph = document.createElement(block.heading ? "h2" : "p");
      if (!block.heading) paragraph.style.marginBlockEnd = `${spacing.paragraphSpacing}em`;
      if (!block.heading && spacing.textIndent !== "default") paragraph.style.textIndent = `${spacing.textIndent === "none" ? 0 : spacing.indentSize}em`;
      for (let i = 0; i < block.lines.length; i++) {
        const line = block.lines[i];
        const span = document.createElement("span");
        span.dataset.sourceY = String(line.sourceY);
        // Spaces replace physical line breaks; the browser wraps to the available width.
        span.textContent = line.text + (i < block.lines.length - 1 && !/[-\u00ad]$/.test(line.text) ? " " : "");
        paragraph.append(span);
      }
      this.flow.append(paragraph);
    }
    this.viewport.append(this.flow);
    sheet.append(this.viewport);
    const width = this.viewport.clientWidth;
    const gap = 40;
    this.step = width + gap;
    this.flow.style.columnWidth = `${width}px`;
    this.flow.style.columnGap = `${gap}px`;
    this.count = Math.max(1, Math.ceil((this.flow.scrollWidth + gap - 1) / this.step));
  }

  show(index: number): void {
    this.index = Math.max(0, Math.min(this.count - 1, index));
    this.flow.style.transform = `translateX(${-this.index * this.step}px)`;
  }

  private sourceSpan(y: number): HTMLElement | undefined {
    return [...this.flow.querySelectorAll<HTMLElement>("[data-source-y]")]
      .sort((a, b) => Math.abs(Number(a.dataset.sourceY) - y) - Math.abs(Number(b.dataset.sourceY) - y))[0];
  }

  private characterRect(node: Node, offset: number): DOMRect | undefined {
    const range = document.createRange();
    range.setStart(node, offset); range.setEnd(node, offset + 1);
    return range.getClientRects()[0];
  }

  private textOffsetRect(offset: number): DOMRect | undefined {
    const spans = [...this.flow.querySelectorAll<HTMLElement>("[data-source-y]")];
    const total = spans.reduce((sum, span) => sum + (span.textContent?.length ?? 0), 0);
    let target = Math.max(0, Math.min(total - 1, Math.floor(offset * total)));
    for (const span of spans) {
      const length = span.textContent?.length ?? 0;
      if (target < length && span.firstChild) return this.characterRect(span.firstChild, target);
      target -= length;
    }
    return undefined;
  }

  private anchorRange(y: number, quote?: string): Range | undefined {
    const spans = [...this.flow.querySelectorAll<HTMLElement>("[data-source-y]")];
    const text = spans.map((span) => span.textContent ?? "").join("");
    const query = quote?.replace(/\s+/g, " ").trim();
    let match = query ? text.indexOf(query) : -1;
    if (match >= 0 && query) {
      let start = 0;
      let first: { node: Node; offset: number } | undefined;
      let last: { node: Node; offset: number } | undefined;
      // Choose the matching passage nearest to the saved source position when text repeats.
      let distance = Infinity;
      let offset = 0;
      const positions = spans.map((span) => { const value = offset; offset += span.textContent?.length ?? 0; return value; });
      for (let occurrence = match; occurrence >= 0; occurrence = text.indexOf(query, occurrence + 1)) {
        const next = positions.findIndex((position) => position > occurrence);
        const i = next < 0 ? positions.length - 1 : Math.max(0, next - 1);
        const delta = Math.abs(Number(spans[i]?.dataset.sourceY ?? 0) - y);
        if (delta < distance) { distance = delta; match = occurrence; }
      }
      for (const span of spans) {
        const length = span.textContent?.length ?? 0;
        if (!first && match >= start && match < start + length && span.firstChild) first = { node: span.firstChild, offset: match - start };
        if (match + query.length > start && match + query.length <= start + length && span.firstChild) {
          last = { node: span.firstChild, offset: match + query.length - start }; break;
        }
        start += length;
      }
      if (first && last) {
        const range = document.createRange();
        range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset);
        return range;
      }
    }
    const span=this.sourceSpan(y);if(!span)return;const range=document.createRange();range.selectNodeContents(span);return range;
  }
  private anchorRect(y:number,quote?:string):DOMRect|undefined{return this.anchorRange(y,quote)?.getClientRects()[0];}
  highlightRects(y:number,quote:string):DOMRect[]{const bounds=this.viewport.getBoundingClientRect();return [...this.anchorRange(y,quote)?.getClientRects()??[]].filter(rect=>rect.right>bounds.left&&rect.left<bounds.right&&rect.bottom>bounds.top&&rect.top<bounds.bottom);}

  pageForOffset(y: number, quote?: string): number {
    const rect = quote ? this.anchorRect(y, quote) : this.textOffsetRect(y);
    if (!rect) return 0;
    return Math.max(0, Math.min(this.count - 1, Math.floor((rect.left - this.viewport.getBoundingClientRect().left + this.index * this.step + 1) / this.step)));
  }

  pageForSourceY(y: number): number {
    const rect = this.anchorRect(y);
    return rect ? Math.max(0, Math.min(this.count - 1, Math.floor((rect.left - this.viewport.getBoundingClientRect().left + this.index * this.step + 1) / this.step))) : 0;
  }
  visibleOffset(): number {
    const rect = this.viewport.getBoundingClientRect();
    const spans = [...this.flow.querySelectorAll<HTMLElement>("[data-source-y]")];
    const total = spans.reduce((sum, span) => sum + (span.textContent?.length ?? 0), 0);
    const document = this.flow.ownerDocument as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    // Use a character near the visual center as the semantic position. Anchoring
    // the first visible character can move backward after a small height change.
    for (const fraction of [.5, .35, .65, .2, .8]) {
      const x = rect.left + rect.width / 2, y = rect.top + rect.height * fraction;
      const range = document.caretRangeFromPoint?.(x, y);
      const caret = range ? { node: range.startContainer, offset: range.startOffset }
        : document.caretPositionFromPoint?.(x, y) ? { node: document.caretPositionFromPoint!(x, y)!.offsetNode, offset: document.caretPositionFromPoint!(x, y)!.offset } : undefined;
      const element = caret?.node.nodeType === Node.ELEMENT_NODE ? caret.node as Element : caret?.node.parentElement;
      const activeSpan = element?.closest<HTMLElement>("[data-source-y]");
      if (activeSpan && this.flow.contains(activeSpan)) {
        let preceding = 0;
        for (const span of spans) { if (span === activeSpan) break; preceding += span.textContent?.length ?? 0; }
        return (preceding + Math.max(0, Math.min(activeSpan.textContent?.length ?? 0, caret!.offset)) + .25) / Math.max(1, total);
      }
    }
    let prefix = 0;
    for (const span of spans) {
      const length = span.textContent?.length ?? 0;
      if (span.firstChild && [...span.getClientRects()].some((line) => line.right > rect.left + 1 && line.left < rect.right - 1)) {
        // A source line can wrap across reading pages. Save its first visible character.
        let low = 0, high = length - 1;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          const charRect = this.characterRect(span.firstChild, middle);
          const column = charRect ? Math.floor((charRect.left - rect.left + this.index * this.step + 1) / this.step) : 0;
          if (column < this.index) low = middle + 1;
          else high = middle;
        }
        return (prefix + low + .25) / Math.max(1, total);
      }
      prefix += length;
    }
    return 0;
  }

  visibleText(): string {
    const bounds = this.viewport.getBoundingClientRect();
    return [...this.flow.querySelectorAll<HTMLElement>("[data-source-y]")]
      .filter(span => [...span.getClientRects()].some(rect => rect.right > bounds.left + 1 && rect.left < bounds.right - 1
        && rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1))
      .map(span => span.textContent ?? "")
      .join(" ").replace(/\s+/g, " ").trim();
  }

  markerRect(y: number, quote?: string): DOMRect | undefined {
    const bounds = this.viewport.getBoundingClientRect();
    const rect = this.anchorRect(y, quote);
    return rect && rect.right > bounds.left + 1 && rect.left < bounds.right - 1 && rect.bottom > bounds.top && rect.top < bounds.bottom ? rect : undefined;
  }

  selectionY(range: Range): number {
    const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
    return Number(node?.closest<HTMLElement>("[data-source-y]")?.dataset.sourceY ?? this.visibleOffset());
  }
}
