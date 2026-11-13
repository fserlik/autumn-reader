import { t } from "../i18n";
import {
  bindingFromKeyboardEvent,
  defaultShortcutBindings,
  isReservedShortcut,
  saveShortcutBindings,
  shortcutConflict,
  shortcutDefinitions,
  shortcutTokens,
  type ShortcutAction,
  type ShortcutBindings,
  type ShortcutScope,
} from "../services/preferences/shortcuts";

const copy = (): Record<ShortcutAction, { title: string; help: string }> => ({
  openLibrary: { title: t("shortcutOpenLibrary"), help: t("shortcutOpenLibraryHelp") },
  openSettings: { title: t("shortcutOpenSettings"), help: t("shortcutOpenSettingsHelp") },
  importBooks: { title: t("shortcutImportBooks"), help: t("shortcutImportBooksHelp") },
  search: { title: t("shortcutSearch"), help: t("shortcutSearchHelp") },
  readerBack: { title: t("shortcutReaderBack"), help: t("shortcutReaderBackHelp") },
  previousPage: { title: t("shortcutPreviousPage"), help: t("shortcutPreviousPageHelp") },
  nextPage: { title: t("shortcutNextPage"), help: t("shortcutNextPageHelp") },
  pageOverview: { title: t("shortcutPageOverview"), help: t("shortcutPageOverviewHelp") },
  decreaseSize: { title: t("shortcutDecreaseSize"), help: t("shortcutDecreaseSizeHelp") },
  increaseSize: { title: t("shortcutIncreaseSize"), help: t("shortcutIncreaseSizeHelp") },
});

function keycaps(tokens: string[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  tokens.forEach((token, index) => {
    if (index) {
      const plus = document.createElement("span");
      plus.className = "shortcut-plus";
      plus.textContent = "+";
      plus.setAttribute("aria-hidden", "true");
      fragment.append(plus);
    }
    const key = document.createElement("kbd");
    key.textContent = token;
    fragment.append(key);
  });
  return fragment;
}

export function mountShortcutSettings(
  parent: HTMLElement,
  initial: ShortcutBindings,
  onChange: (bindings: ShortcutBindings) => void,
): void {
  const labels = copy();
  const groups = parent.querySelector<HTMLElement>(".shortcut-settings-groups")!;
  const reset = parent.querySelector<HTMLButtonElement>("#shortcut-reset")!;
  const status = parent.querySelector<HTMLElement>("#shortcut-status")!;
  let bindings = initial;
  let capturing: ShortcutAction | undefined;
  let error: { action: ShortcutAction; message: string } | undefined;

  const groupCopy: Record<ShortcutScope, { title: string; help: string }> = {
    global: { title: t("shortcutGlobalGroup"), help: t("shortcutGlobalGroupHelp") },
    reader: { title: t("shortcutReaderGroup"), help: t("shortcutReaderGroupHelp") },
  };

  const render = (): void => {
    groups.replaceChildren();
    for (const scope of ["global", "reader"] as const) {
      const section = document.createElement("section");
      section.className = "shortcut-group";
      const heading = document.createElement("header");
      const title = document.createElement("h3");
      const help = document.createElement("p");
      title.textContent = groupCopy[scope].title;
      help.textContent = groupCopy[scope].help;
      heading.append(title, help);
      const list = document.createElement("div");
      list.className = "shortcut-list";

      for (const definition of shortcutDefinitions.filter(item => item.scope === scope)) {
        const actionCopy = labels[definition.action];
        const row = document.createElement("div");
        row.className = "shortcut-row";
        row.dataset.shortcutAction = definition.action;
        const description = document.createElement("div");
        description.className = "shortcut-copy";
        const rowTitle = document.createElement("strong");
        const rowHelp = document.createElement("small");
        rowTitle.textContent = actionCopy.title;
        rowHelp.textContent = actionCopy.help;
        description.append(rowTitle, rowHelp);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "shortcut-capture";
        const tokens = shortcutTokens(bindings[definition.action]);
        button.setAttribute("aria-label", `${t("shortcutEditLabel", { action: actionCopy.title })}. ${capturing === definition.action ? t("shortcutPressKeys") : tokens.join(" + ")}`);
        button.setAttribute("aria-pressed", String(capturing === definition.action));
        if (capturing === definition.action) {
          const prompt = document.createElement("span");
          prompt.className = "shortcut-recording-copy";
          prompt.textContent = t("shortcutPressKeys");
          const hint = document.createElement("small");
          hint.textContent = t("shortcutCancelHint");
          button.append(prompt, hint);
        } else {
          const keys = document.createElement("span");
          keys.className = "shortcut-keycaps";
          keys.append(keycaps(tokens));
          button.append(keys);
        }

        const message = document.createElement("p");
        message.className = "shortcut-error";
        message.id = `shortcut-error-${definition.action}`;
        message.setAttribute("role", "alert");
        if (error?.action === definition.action) message.textContent = error.message;
        button.setAttribute("aria-describedby", message.id);

        button.addEventListener("click", () => {
          capturing = definition.action;
          error = undefined;
          status.textContent = "";
          render();
          groups.querySelector<HTMLButtonElement>(`[data-shortcut-action="${definition.action}"] .shortcut-capture`)?.focus();
        });
        button.addEventListener("keydown", event => {
          if (capturing !== definition.action) return;
          if (event.key === "Tab") {
            capturing = undefined;
            error = undefined;
            button.setAttribute("aria-pressed", "false");
            button.setAttribute("aria-label", `${t("shortcutEditLabel", { action: actionCopy.title })}. ${tokens.join(" + ")}`);
            const keys = document.createElement("span");
            keys.className = "shortcut-keycaps";
            keys.append(keycaps(tokens));
            button.replaceChildren(keys);
            message.textContent = "";
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            capturing = undefined;
            error = undefined;
            render();
            groups.querySelector<HTMLButtonElement>(`[data-shortcut-action="${definition.action}"] .shortcut-capture`)?.focus();
            return;
          }
          const candidate = bindingFromKeyboardEvent(event);
          if (!candidate) return;
          if (isReservedShortcut(candidate)) {
            error = { action: definition.action, message: t("shortcutReserved") };
            render();
            groups.querySelector<HTMLButtonElement>(`[data-shortcut-action="${definition.action}"] .shortcut-capture`)?.focus();
            return;
          }
          const conflict = shortcutConflict(bindings, definition.action, candidate);
          if (conflict) {
            error = { action: definition.action, message: t("shortcutConflict", { action: labels[conflict].title }) };
            render();
            groups.querySelector<HTMLButtonElement>(`[data-shortcut-action="${definition.action}"] .shortcut-capture`)?.focus();
            return;
          }
          bindings = saveShortcutBindings({ ...bindings, [definition.action]: candidate });
          capturing = undefined;
          error = undefined;
          status.textContent = t("shortcutSaved");
          onChange(bindings);
          render();
          groups.querySelector<HTMLButtonElement>(`[data-shortcut-action="${definition.action}"] .shortcut-capture`)?.focus();
        });
        button.addEventListener("blur", () => window.queueMicrotask(() => {
          if (capturing !== definition.action || document.activeElement?.closest(".shortcut-capture")) return;
          capturing = undefined;
          error = undefined;
          render();
        }));
        row.append(description, button, message);
        list.append(row);
      }
      section.append(heading, list);
      groups.append(section);
    }
  };

  reset.addEventListener("click", () => {
    bindings = saveShortcutBindings(defaultShortcutBindings());
    capturing = undefined;
    error = undefined;
    status.textContent = t("shortcutResetDone");
    onChange(bindings);
    render();
  });
  render();
}
