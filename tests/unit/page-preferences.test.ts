import { test, expect, vi } from "vitest";
import { loadPagePreferences, savePagePreferences, defaultPagePreferences, pageSpacingCss } from "../../src/services/preferences/page";
test("page spacing persists, resets, validates, and produces EPUB typography rules", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  expect(loadPagePreferences()).toEqual(defaultPagePreferences);
  savePagePreferences({ lineHeight: 2, paragraphSpacing: 1.3 });
  expect(loadPagePreferences()).toEqual({ lineHeight: 2, paragraphSpacing: 1.3 });
  expect(pageSpacingCss(loadPagePreferences())).toContain("line-height: 2 !important");
  expect(pageSpacingCss(loadPagePreferences())).toContain("margin-block-end: 1.3em");
  savePagePreferences({ lineHeight: Infinity, paragraphSpacing: -4 });
  expect(loadPagePreferences()).toEqual({ lineHeight: 1.6, paragraphSpacing: 0 });
  savePagePreferences({ ...defaultPagePreferences }); expect(loadPagePreferences()).toEqual(defaultPagePreferences);
  vi.unstubAllGlobals();
});
