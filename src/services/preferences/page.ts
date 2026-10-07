export type Columns = "auto" | "one" | "two";
export type Margins = "compact" | "normal" | "wide";
export type Indent = "default" | "none" | "custom";
export interface PagePreferences {
  lineHeight: number; paragraphSpacing: number; wordSpacing: number; letterSpacing: number;
  textIndent: Indent; indentSize: number; columns: Columns; margins: Margins; font: string;
}
export const defaultPagePreferences: Readonly<PagePreferences> = {
  lineHeight: 1.6, paragraphSpacing: .8, wordSpacing: 0, letterSpacing: 0,
  textIndent: "default", indentSize: 1.5, columns: "auto", margins: "normal", font: "original",
};
const clamp = (value: unknown, minimum: number, maximum: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
const oneOf = <T extends string>(value: unknown, choices: readonly T[], fallback: T): T =>
  choices.includes(value as T) ? value as T : fallback;
export function normalizePagePreferences(value: Partial<PagePreferences>): PagePreferences {
  return {
    lineHeight: clamp(value.lineHeight, 1, 2.5, defaultPagePreferences.lineHeight),
    paragraphSpacing: clamp(value.paragraphSpacing, 0, 2.5, defaultPagePreferences.paragraphSpacing),
    wordSpacing: clamp(value.wordSpacing, -.08, .5, 0), letterSpacing: clamp(value.letterSpacing, -.08, .2, 0),
    textIndent: oneOf(value.textIndent, ["default", "none", "custom"], "default"),
    indentSize: clamp(value.indentSize, 0, 4, defaultPagePreferences.indentSize),
    columns: oneOf(value.columns, ["auto", "one", "two"], "auto"),
    margins: oneOf(value.margins, ["compact", "normal", "wide"], "normal"),
    font: typeof value.font === "string" && /^(original|georgia|arial|verdana|times|system:[\p{L}\p{N} .-]{1,90})$/u.test(value.font) ? value.font : "original",
  };
}
export function loadPagePreferences(): PagePreferences {
  try {
    const stored = JSON.parse(localStorage.getItem("autumn-page-spacing") ?? "{}") as Partial<PagePreferences>;
    return normalizePagePreferences({ ...stored, font: stored.font ?? localStorage.getItem("autumn-book-font") ?? "original" });
  } catch { return { ...defaultPagePreferences }; }
}
export function savePagePreferences(value: PagePreferences): PagePreferences {
  const normalized = normalizePagePreferences(value);
  localStorage.setItem("autumn-page-spacing", JSON.stringify(normalized)); return normalized;
}
export type BookPageOverrides = Partial<PagePreferences>;
export function resolvePagePreferences(global: PagePreferences, overrides: BookPageOverrides = {}): PagePreferences {
  return normalizePagePreferences({ ...global, ...overrides });
}
export function pagePreferencesEqual(left: PagePreferences, right: PagePreferences): boolean {
  return (Object.keys(defaultPagePreferences) as (keyof PagePreferences)[])
    .every(key => left[key] === right[key]);
}
const bookKey = (ownerId: string, bookId: string): string => `autumn-book-page:${ownerId}:${bookId}`;
export function loadBookPageOverrides(ownerId: string, bookId: string): BookPageOverrides {
  try {
    const raw = JSON.parse(localStorage.getItem(bookKey(ownerId, bookId)) ?? "{}") as Record<string, unknown>;
    const normalized = normalizePagePreferences(raw);
    return Object.fromEntries(Object.keys(defaultPagePreferences).filter(key => Object.hasOwn(raw, key))
      .map(key => [key, normalized[key as keyof PagePreferences]])) as BookPageOverrides;
  } catch { return {}; }
}
export function saveBookPageOverrides(ownerId: string, bookId: string, value: BookPageOverrides): void {
  const key = bookKey(ownerId, bookId);
  if (Object.keys(value).length) localStorage.setItem(key, JSON.stringify(value));
  else localStorage.removeItem(key);
}
export const pageSpacingCss = (value: PagePreferences): string => `body, p, li, blockquote { line-height: ${value.lineHeight} !important; word-spacing: ${value.wordSpacing}em !important; letter-spacing: ${value.letterSpacing}em !important; } p { margin-block-start: 0 !important; margin-block-end: ${value.paragraphSpacing}em !important;${value.textIndent === "default" ? "" : ` text-indent: ${value.textIndent === "none" ? 0 : value.indentSize}em !important;`} }`;
export function columnCount(choice: Columns, width: number, height: number): 1 | 2 {
  if (choice === "one") return 1;
  if (choice === "two") return width >= 520 ? 2 : 1;
  return width >= 760 && width > height * 1.15 ? 2 : 1;
}
