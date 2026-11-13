import { describe, expect, it } from "vitest";
import {
  bindingFromKeyboardEvent,
  defaultShortcutBindings,
  isReservedShortcut,
  loadShortcutBindings,
  saveShortcutBindings,
  shortcutActionForEvent,
  shortcutConflict,
  shortcutDefinitions,
} from "../../src/services/preferences/shortcuts";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set("autumn-desktop-shortcuts", initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("desktop keyboard shortcuts", () => {
  it("ships unique defaults for global and reader actions", () => {
    const defaults = defaultShortcutBindings();
    expect(Object.keys(defaults)).toHaveLength(shortcutDefinitions.length);
    expect(defaults.search).toMatchObject({ key: "f", ctrl: true });
    expect(defaults.nextPage).toMatchObject({ key: "ArrowRight", ctrl: false });
    expect(new Set(Object.values(defaults).map(value => JSON.stringify(value))).size).toBe(shortcutDefinitions.length);
  });

  it("matches shortcuts only in their valid context", () => {
    const bindings = defaultShortcutBindings();
    const right = { key: "ArrowRight", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    const search = { key: "F", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
    expect(shortcutActionForEvent(right, bindings, "app")).toBeUndefined();
    expect(shortcutActionForEvent(right, bindings, "reader")).toBe("nextPage");
    expect(shortcutActionForEvent(search, bindings, "app")).toBe("search");
    expect(shortcutActionForEvent({ key: "+", ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }, bindings, "reader")).toBe("increaseSize");
  });

  it("normalizes, saves and reloads a customized binding", () => {
    const storage = memoryStorage();
    const bindings = defaultShortcutBindings();
    const custom = bindingFromKeyboardEvent({ key: "P", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })!;
    const saved = saveShortcutBindings({ ...bindings, pageOverview: custom }, storage);
    expect(saved.pageOverview.key).toBe("p");
    expect(loadShortcutBindings(storage).pageOverview.key).toBe("p");
  });

  it("rejects conflicts, reserved combinations and corrupted storage", () => {
    const defaults = defaultShortcutBindings();
    expect(shortcutConflict(defaults, "pageOverview", defaults.search)).toBe("search");
    expect(isReservedShortcut({ key: "F4", ctrl: false, alt: true, shift: false, meta: false })).toBe(true);
    expect(loadShortcutBindings(memoryStorage("not json"))).toEqual(defaults);
    const conflicting = { ...defaults, pageOverview: defaults.search };
    expect(loadShortcutBindings(memoryStorage(JSON.stringify(conflicting)))).toEqual(defaults);
  });
});
