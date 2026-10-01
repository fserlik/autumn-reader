export interface PagePreferences { lineHeight: number; paragraphSpacing: number }
export const defaultPagePreferences: Readonly<PagePreferences> = { lineHeight: 1.6, paragraphSpacing: .8 };
export function normalizePagePreferences(value: Partial<PagePreferences>): PagePreferences {
  return {
    lineHeight: Number.isFinite(value.lineHeight) ? Math.max(1.2, Math.min(2.4, value.lineHeight!)) : defaultPagePreferences.lineHeight,
    paragraphSpacing: Number.isFinite(value.paragraphSpacing) ? Math.max(0, Math.min(2.5, value.paragraphSpacing!)) : defaultPagePreferences.paragraphSpacing,
  };
}
export function loadPagePreferences(): PagePreferences {
  try { return normalizePagePreferences(JSON.parse(localStorage.getItem("autumn-page-spacing") ?? "{}") as PagePreferences); }
  catch { return { ...defaultPagePreferences }; }
}
export function savePagePreferences(value: PagePreferences): PagePreferences {
  const normalized = normalizePagePreferences(value);
  localStorage.setItem("autumn-page-spacing", JSON.stringify(normalized)); return normalized;
}
export const pageSpacingCss = (value: PagePreferences): string => `body, p, li, blockquote { line-height: ${value.lineHeight} !important; } p { margin-block-start: 0 !important; margin-block-end: ${value.paragraphSpacing}em !important; }`;
