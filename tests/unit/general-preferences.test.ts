import { afterEach, expect, test, vi } from "vitest";
import {
  defaultDesktopGeneralPreferences,
  loadDesktopGeneralPreferences,
  saveDesktopGeneralPreferences,
} from "../../src/services/preferences/general";

afterEach(() => vi.unstubAllGlobals());

test("desktop general preferences default, persist, and reject malformed values", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });

  expect(loadDesktopGeneralPreferences()).toEqual(defaultDesktopGeneralPreferences);
  saveDesktopGeneralPreferences({
    ...defaultDesktopGeneralPreferences,
    preventScreenBlanking: true,
    autoMaximize: true,
  });
  expect(loadDesktopGeneralPreferences()).toEqual({
    ...defaultDesktopGeneralPreferences,
    preventScreenBlanking: true,
    autoMaximize: true,
  });

  values.set("autumn-desktop-general", JSON.stringify({
    disableTrashBin: "yes",
    deleteBooksWithFolder: true,
    autoMaximize: 1,
  }));
  expect(loadDesktopGeneralPreferences()).toEqual({
    ...defaultDesktopGeneralPreferences,
    deleteBooksWithFolder: true,
  });

  values.set("autumn-desktop-general", "not json");
  expect(loadDesktopGeneralPreferences()).toEqual(defaultDesktopGeneralPreferences);
});
