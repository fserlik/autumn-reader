export const speechHighlightName = "autumn-tts-current";

type SourceCharacter = { start: number; end: number };

export type SpeechSourceSegment = {
  node: Text;
  textStart: number;
  textEnd: number;
  characters: SourceCharacter[];
};

export type SpeechSource = {
  text: string;
  segments: SpeechSourceSegment[];
};

export type SpeechSourceRegion = {
  root: HTMLElement;
  bounds: { left: number; right: number; top: number; bottom: number };
};

type HighlightLike = { readonly size: number };
type HighlightConstructor = new (...ranges: Range[]) => HighlightLike;
type HighlightRegistry = { set(name: string, highlight: HighlightLike): void; delete(name: string): boolean };
type HighlightWindow = Window & typeof globalThis & {
  Highlight?: HighlightConstructor;
  CSS: typeof CSS & { highlights?: HighlightRegistry };
};

const highlightedDocuments = new Set<Document>();
const whitespace = /\s/u;

function normalizedNodeText(node: Text): { text: string; characters: SourceCharacter[] } {
  const source = node.data;
  let first = 0;
  while (first < source.length && whitespace.test(source[first])) first += 1;
  let last = source.length;
  while (last > first && whitespace.test(source[last - 1])) last -= 1;
  let text = "";
  const characters: SourceCharacter[] = [];
  for (let index = first; index < last;) {
    if (whitespace.test(source[index])) {
      const start = index;
      while (index < last && whitespace.test(source[index])) index += 1;
      text += " "; characters.push({ start, end: index });
      continue;
    }
    text += source[index]; characters.push({ start: index, end: index + 1 }); index += 1;
  }
  return { text, characters };
}

function intersectsBounds(rect: DOMRect, bounds: SpeechSourceRegion["bounds"]): boolean {
  return rect.right > bounds.left + 1 && rect.left < bounds.right - 1
    && rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1;
}

/**
 * EPUB pagination can leave one text node spread across several off-screen
 * columns. Keep only the character interval painted inside the current page;
 * otherwise TTS starts at the beginning of that node (often the section).
 */
function visibleNodeText(node: Text, bounds: SpeechSourceRegion["bounds"]): { text: string; characters: SourceCharacter[] } | null {
  const normalized = normalizedNodeText(node);
  if (!normalized.text) return null;
  const range = node.ownerDocument.createRange();
  range.selectNodeContents(node);
  if (![...range.getClientRects()].some(rect => intersectsBounds(rect, bounds))) return null;

  let first = -1;
  let last = -1;
  for (let index = 0; index < normalized.characters.length; index += 1) {
    const character = normalized.characters[index];
    range.setStart(node, character.start);
    range.setEnd(node, character.end);
    if (![...range.getClientRects()].some(rect => intersectsBounds(rect, bounds))) continue;
    if (first < 0) first = index;
    last = index;
  }
  if (first < 0 || last < first) return null;
  while (first <= last && whitespace.test(normalized.text[first])) first += 1;
  while (last >= first && whitespace.test(normalized.text[last])) last -= 1;
  if (last < first) return null;
  return {
    text: normalized.text.slice(first, last + 1),
    characters: normalized.characters.slice(first, last + 1),
  };
}

/** Extract the same normalized visible text sent to TTS while retaining DOM offsets. */
export function collectVisibleSpeechSource(regions: SpeechSourceRegion[], maximumCharacters = 12_000): SpeechSource {
  let text = "";
  const segments: SpeechSourceSegment[] = [];
  for (const { root, bounds } of regions) {
    const owner = root.ownerDocument;
    const walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let current = walker.nextNode(); current && text.length < maximumCharacters; current = walker.nextNode()) {
      const node = current as Text;
      const parent = node.parentElement;
      if (!parent || parent.closest("script,style,noscript,head,[hidden],[aria-hidden='true']")) continue;
      const normalized = visibleNodeText(node, bounds);
      if (!normalized) continue;
      if (text) text += " ";
      const remaining = maximumCharacters - text.length;
      if (remaining <= 0) break;
      const value = normalized.text.slice(0, remaining);
      const textStart = text.length;
      text += value;
      segments.push({ node, textStart, textEnd: text.length, characters: normalized.characters.slice(0, value.length) });
    }
    if (text.length >= maximumCharacters) break;
  }
  return { text: text.replace(/\s+$/u, ""), segments };
}

function highlightWindow(document: Document): HighlightWindow | null {
  return document.defaultView as HighlightWindow | null;
}

function ensureHighlightStyle(document: Document): void {
  if (document.getElementById("autumn-tts-highlight-style")) return;
  const style = document.createElement("style");
  style.id = "autumn-tts-highlight-style";
  style.textContent = `::highlight(${speechHighlightName}) {
    background-color: rgba(232, 128, 50, .34);
    text-decoration-line: underline;
    text-decoration-color: rgba(183, 65, 14, .9);
    text-decoration-thickness: 1px;
    text-underline-offset: .16em;
  }`;
  (document.head ?? document.documentElement).append(style);
}

export function clearSpeechHighlight(): void {
  for (const document of highlightedDocuments) highlightWindow(document)?.CSS.highlights?.delete(speechHighlightName);
  highlightedDocuments.clear();
}

/** Highlight a normalized character interval without mutating the book DOM. */
export function setSpeechHighlight(source: SpeechSource | undefined, start: number, end: number): void {
  clearSpeechHighlight();
  if (!source || !source.text || end <= start) return;
  const first = Math.max(0, Math.min(source.text.length, start));
  const last = Math.max(first, Math.min(source.text.length, end));
  const ranges = new Map<Document, Range[]>();
  for (const segment of source.segments) {
    const overlapStart = Math.max(first, segment.textStart);
    const overlapEnd = Math.min(last, segment.textEnd);
    if (overlapEnd <= overlapStart || !segment.characters.length) continue;
    const localStart = overlapStart - segment.textStart;
    const localEnd = overlapEnd - segment.textStart;
    const startCharacter = segment.characters[Math.min(localStart, segment.characters.length - 1)];
    const endCharacter = segment.characters[Math.min(Math.max(0, localEnd - 1), segment.characters.length - 1)];
    const range = segment.node.ownerDocument.createRange();
    range.setStart(segment.node, startCharacter.start);
    range.setEnd(segment.node, endCharacter.end);
    const documentRanges = ranges.get(segment.node.ownerDocument) ?? [];
    documentRanges.push(range); ranges.set(segment.node.ownerDocument, documentRanges);
  }
  for (const [document, documentRanges] of ranges) {
    const view = highlightWindow(document);
    const registry = view?.CSS.highlights;
    const Highlight = view?.Highlight;
    if (!registry || !Highlight || !documentRanges.length) continue;
    ensureHighlightStyle(document);
    registry.set(speechHighlightName, new Highlight(...documentRanges));
    highlightedDocuments.add(document);
  }
}

export function locateSpeechChunks(text: string, chunks: string[]): { start: number; end: number }[] {
  let cursor = 0;
  return chunks.map(chunk => {
    const found = text.indexOf(chunk, cursor);
    const start = found >= 0 ? found : cursor;
    const end = Math.min(text.length, start + chunk.length);
    cursor = end;
    return { start, end };
  });
}
