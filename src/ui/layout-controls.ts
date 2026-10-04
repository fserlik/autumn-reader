import { t } from "../i18n";
import { availableSystemFonts, fontCss } from "../services/preferences/fonts";
import type { BookPageOverrides, PagePreferences } from "../services/preferences/page";

type Key = keyof PagePreferences;
type Field = { key: Key; label: string; type: "range" | "select"; min?: number; max?: number; step?: number; choices?: [string, string][] };
const fields: Field[] = [
  { key: "font", label: t("font"), type: "select", choices: [
    ["original", t("fontOriginal")], ["georgia", t("fontGeorgia")], ["arial", t("fontArial")],
    ["verdana", t("fontVerdana")], ["times", t("fontTimes")],
  ] },
  { key: "lineHeight", label: t("lineHeight"), type: "range", min: 1, max: 2.5, step: .1 },
  { key: "paragraphSpacing", label: t("paragraphSpacing"), type: "range", min: 0, max: 2.5, step: .1 },
  { key: "wordSpacing", label: t("wordSpacing"), type: "range", min: -.08, max: .5, step: .02 },
  { key: "letterSpacing", label: t("letterSpacing"), type: "range", min: -.08, max: .2, step: .01 },
  { key: "textIndent", label: t("textIndent"), type: "select", choices: [["default", t("defaultSetting")], ["none", t("noIndent")], ["custom", t("customIndent")]] },
  { key: "indentSize", label: t("customIndent"), type: "range", min: 0, max: 4, step: .25 },
  { key: "columns", label: t("columns"), type: "select", choices: [["auto", t("auto")], ["one", t("oneColumn")], ["two", t("twoColumns")]] },
  { key: "margins", label: t("margins"), type: "select", choices: [["compact", t("compactMargins")], ["normal", t("normalMargins")], ["wide", t("wideMargins")]] },
];

interface Options {
  scope: "global" | "book";
  getGlobal(): PagePreferences;
  getOverrides(): BookPageOverrides;
  changeGlobal(value: Partial<PagePreferences>): void;
  changeBook(value: BookPageOverrides): void;
}

export function mountLayoutFields(container: HTMLElement, options: Options): { refresh(): void } {
  const selected = options.scope === "global" ? fields.slice(3) : fields;
  const controls = new Map<Key, { input: HTMLInputElement | HTMLSelectElement; inherit?: HTMLInputElement; output?: HTMLOutputElement }>();
  for (const field of selected) {
    const row = document.createElement("div"); row.className = "layout-field"; row.dataset.layoutKey = field.key;
    const label = document.createElement("label"); label.className = "layout-field-label";
    const labelText = document.createElement("span"); labelText.className = "layout-field-title"; labelText.textContent = field.label;
    label.append(labelText);
    const input = document.createElement(field.type === "range" ? "input" : "select") as HTMLInputElement | HTMLSelectElement;
    input.setAttribute("aria-label", field.label);
    if (field.type === "range") {
      const range = input as HTMLInputElement; range.type = "range"; range.min = String(field.min); range.max = String(field.max); range.step = String(field.step);
    } else for (const [value, text] of field.choices ?? []) (input as HTMLSelectElement).add(new Option(text, value));
    label.append(input); row.append(label);
    let output: HTMLOutputElement | undefined;
    if (field.type === "range") { output = document.createElement("output"); row.append(output); }
    let inherit: HTMLInputElement | undefined;
    if (options.scope === "book") {
      const wrapper = document.createElement("label"); wrapper.className = "layout-inherit";
      inherit = document.createElement("input"); inherit.type = "checkbox";
      wrapper.append(inherit, document.createTextNode(t("useGlobal"))); row.append(wrapper);
      inherit.addEventListener("change", () => {
        const next = { ...options.getOverrides() };
        if (inherit!.checked) delete next[field.key];
        else Object.assign(next, { [field.key]: parseValue(field, input.value) });
        options.changeBook(next); refresh();
      });
    }
    input.addEventListener(field.type === "range" ? "input" : "change", () => {
      const value = parseValue(field, input.value);
      if (options.scope === "global") options.changeGlobal({ [field.key]: value });
      else options.changeBook({ ...options.getOverrides(), [field.key]: value });
      refresh();
    });
    controls.set(field.key, { input, inherit, output }); container.append(row);
  }
  const preview = document.createElement("div"); preview.className = "font-preview"; preview.textContent = t("fontPreview");
  if (controls.has("font")) container.append(preview);

  function refresh(): void {
    const global = options.getGlobal(), overrides = options.getOverrides();
    for (const field of selected) {
      const control = controls.get(field.key)!;
      const inherited = options.scope === "book" && !Object.hasOwn(overrides, field.key);
      const value = inherited ? global[field.key] : options.scope === "book" ? overrides[field.key] : global[field.key];
      control.input.value = String(value ?? global[field.key]);
      control.input.disabled = inherited;
      if (control.inherit) control.inherit.checked = inherited;
      if (control.output) control.output.textContent = String(value ?? global[field.key]);
      if (field.key === "indentSize") control.input.closest<HTMLElement>(".layout-field")!.hidden = (overrides.textIndent ?? global.textIndent) !== "custom";
    }
    const font = options.scope === "book" ? overrides.font ?? global.font : global.font;
    preview.style.fontFamily = fontCss(font) || "serif";
  }
  void availableSystemFonts().then(fonts => {
    const control = controls.get("font")?.input as HTMLSelectElement | undefined;
    if (!control || !fonts.length) return;
    const group = document.createElement("optgroup"); group.label = t("systemFonts");
    for (const name of fonts) group.append(new Option(name, `system:${name}`));
    control.append(group); refresh();
  });
  refresh();
  return { refresh };
}

function parseValue(field: Field, value: string): string | number {
  return field.type === "range" ? Number(value) : value;
}
