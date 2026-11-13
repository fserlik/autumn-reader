export type ShortcutAction =
  | "openLibrary"
  | "openSettings"
  | "importBooks"
  | "search"
  | "readerBack"
  | "previousPage"
  | "nextPage"
  | "pageOverview"
  | "decreaseSize"
  | "increaseSize";

export type ShortcutScope = "global" | "reader";

export interface ShortcutBinding {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface ShortcutDefinition {
  action: ShortcutAction;
  scope: ShortcutScope;
  defaultBinding: ShortcutBinding;
}

export type ShortcutBindings = Record<ShortcutAction, ShortcutBinding>;

export interface ShortcutKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const binding = (key: string, modifiers: Partial<Omit<ShortcutBinding, "key">> = {}): ShortcutBinding => ({
  key,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...modifiers,
});

export const shortcutDefinitions: readonly ShortcutDefinition[] = [
  { action: "openLibrary", scope: "global", defaultBinding: binding("l", { ctrl: true, shift: true }) },
  { action: "openSettings", scope: "global", defaultBinding: binding(",", { ctrl: true }) },
  { action: "importBooks", scope: "global", defaultBinding: binding("o", { ctrl: true }) },
  { action: "search", scope: "global", defaultBinding: binding("f", { ctrl: true }) },
  { action: "readerBack", scope: "reader", defaultBinding: binding("ArrowLeft", { alt: true }) },
  { action: "previousPage", scope: "reader", defaultBinding: binding("ArrowLeft") },
  { action: "nextPage", scope: "reader", defaultBinding: binding("ArrowRight") },
  { action: "pageOverview", scope: "reader", defaultBinding: binding("g") },
  { action: "decreaseSize", scope: "reader", defaultBinding: binding("-", { ctrl: true }) },
  { action: "increaseSize", scope: "reader", defaultBinding: binding("+", { ctrl: true }) },
] as const;

const storageKey = "autumn-desktop-shortcuts";

function normalizeKey(key: string): string {
  const aliases: Record<string, string> = { " ": "Space", Spacebar: "Space", Esc: "Escape", Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown" };
  const normalized = aliases[key] ?? key;
  return normalized.length === 1 ? normalized.toLowerCase() : normalized;
}

function validBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ShortcutBinding>;
  return typeof item.key === "string" && item.key.length > 0
    && typeof item.ctrl === "boolean" && typeof item.alt === "boolean"
    && typeof item.shift === "boolean" && typeof item.meta === "boolean";
}

export function defaultShortcutBindings(): ShortcutBindings {
  return Object.fromEntries(shortcutDefinitions.map(definition => [definition.action, { ...definition.defaultBinding }])) as ShortcutBindings;
}

export function shortcutId(value: ShortcutBinding): string {
  return `${value.ctrl ? 1 : 0}${value.alt ? 1 : 0}${value.shift ? 1 : 0}${value.meta ? 1 : 0}:${normalizeKey(value.key)}`;
}

export function bindingFromKeyboardEvent(event: ShortcutKeyboardEvent): ShortcutBinding | null {
  const key = normalizeKey(event.key);
  if (["Control", "Alt", "Shift", "Meta", "AltGraph", "Dead", "Unidentified", "Process"].includes(key)) return null;
  const impliedShift = key === "+" && (event.ctrlKey || event.metaKey);
  return { key, ctrl: event.ctrlKey, alt: event.altKey, shift: impliedShift ? false : event.shiftKey, meta: event.metaKey };
}

export function shortcutTokens(value: ShortcutBinding): string[] {
  const tokens: string[] = [];
  if (value.ctrl) tokens.push("Ctrl");
  if (value.alt) tokens.push("Alt");
  if (value.shift) tokens.push("Shift");
  if (value.meta) tokens.push("Win");
  const labels: Record<string, string> = {
    ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
    Space: "Space", Enter: "Enter", Backspace: "Backspace", Delete: "Delete",
    PageUp: "Page Up", PageDown: "Page Down", Home: "Home", End: "End",
  };
  const key = labels[value.key] ?? (value.key.length === 1 ? value.key.toUpperCase() : value.key);
  tokens.push(key);
  return tokens;
}

export function isReservedShortcut(value: ShortcutBinding): boolean {
  const key = normalizeKey(value.key).toLowerCase();
  if (key === "escape" || key === "tab") return true;
  if (value.alt && key === "f4") return true;
  if ((value.ctrl || value.meta) && (key === "r" || key === "w" || key === "q")) return true;
  return key === "f5" && !value.ctrl && !value.alt && !value.shift && !value.meta;
}

function normalizeBindings(stored: unknown): ShortcutBindings {
  const defaults = defaultShortcutBindings();
  if (!stored || typeof stored !== "object") return defaults;
  const result = { ...defaults };
  for (const definition of shortcutDefinitions) {
    const candidate = (stored as Partial<Record<ShortcutAction, unknown>>)[definition.action];
    if (validBinding(candidate)) result[definition.action] = { ...candidate, key: normalizeKey(candidate.key) };
  }
  const values = Object.values(result);
  const ids = values.map(shortcutId);
  if (values.some(isReservedShortcut) || new Set(ids).size !== ids.length) return defaults;
  return result;
}

export function loadShortcutBindings(storage: Pick<Storage, "getItem"> = localStorage): ShortcutBindings {
  try { return normalizeBindings(JSON.parse(storage.getItem(storageKey) ?? "null")); }
  catch { return defaultShortcutBindings(); }
}

export function saveShortcutBindings(value: ShortcutBindings, storage: Pick<Storage, "setItem"> = localStorage): ShortcutBindings {
  const normalized = normalizeBindings(value);
  storage.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
}

export function shortcutConflict(bindings: ShortcutBindings, action: ShortcutAction, value: ShortcutBinding): ShortcutAction | undefined {
  const id = shortcutId(value);
  return shortcutDefinitions.find(definition => definition.action !== action && shortcutId(bindings[definition.action]) === id)?.action;
}

export function shortcutActionForEvent(event: ShortcutKeyboardEvent, bindings: ShortcutBindings, context: "app" | "reader"): ShortcutAction | undefined {
  const pressed = bindingFromKeyboardEvent(event);
  if (!pressed) return undefined;
  const id = shortcutId(pressed);
  return shortcutDefinitions.find(definition => (definition.scope === "global" || context === "reader") && shortcutId(bindings[definition.action]) === id)?.action;
}
