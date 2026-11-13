export interface SelectMenuOptions {
  className?: string;
  prefixHtml?: string;
}

const chevron = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m7 9 5 5 5-5"/></svg>';
let outsideCloseBound = false;

function bindOutsideClose(): void {
  if (outsideCloseBound) return;
  outsideCloseBound = true;
  document.addEventListener("pointerdown", event => {
    document.querySelectorAll<HTMLDetailsElement>(".select-menu-details[open]").forEach(details => {
      if (!details.contains(event.target as Node)) details.open = false;
    });
  });
}

export function mountSelectMenu(select: HTMLSelectElement, options: SelectMenuOptions = {}): HTMLElement {
  bindOutsideClose();
  const control = document.createElement("span");
  control.className = `select-menu${options.className ? ` ${options.className}` : ""}`;
  const details = document.createElement("details"); details.className = "select-menu-details";
  const trigger = document.createElement("summary"); trigger.className = "select-menu-trigger";
  trigger.setAttribute("aria-label", select.getAttribute("aria-label") ?? "");
  trigger.setAttribute("aria-expanded", "false");
  if (options.prefixHtml) {
    const prefix = document.createElement("span"); prefix.className = "select-menu-prefix"; prefix.setAttribute("aria-hidden", "true"); prefix.innerHTML = options.prefixHtml;
    trigger.append(prefix);
  }
  const label = document.createElement("span"); label.className = "select-menu-label";
  const arrow = document.createElement("span"); arrow.className = "select-menu-chevron"; arrow.setAttribute("aria-hidden", "true"); arrow.innerHTML = chevron;
  trigger.append(label, arrow);
  const menu = document.createElement("div"); menu.className = "select-menu-options"; menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", select.getAttribute("aria-label") ?? "");

  for (const item of [...select.options]) {
    const option = document.createElement("button"); option.type = "button"; option.className = "select-menu-option";
    option.dataset.value = item.value; option.setAttribute("role", "option"); option.textContent = item.textContent;
    option.addEventListener("click", () => {
      details.open = false;
      if (select.value === item.value) { trigger.focus(); return; }
      select.value = item.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    menu.append(option);
  }

  const sync = (): void => {
    const selected = select.selectedOptions[0];
    label.textContent = selected?.textContent ?? "";
    control.dataset.value = select.value;
    menu.querySelectorAll<HTMLButtonElement>(".select-menu-option").forEach(option => option.setAttribute("aria-selected", String(option.dataset.value === select.value)));
  };
  sync();
  select.setAttribute("aria-hidden", "true"); select.tabIndex = -1;
  select.addEventListener("change", sync);
  details.append(trigger, menu); control.append(select, details);
  details.addEventListener("toggle", () => {
    control.classList.toggle("is-open", details.open);
    trigger.setAttribute("aria-expanded", String(details.open));
    if (!details.open) return;
    document.querySelectorAll<HTMLDetailsElement>(".select-menu-details[open]").forEach(other => { if (other !== details) other.open = false; });
  });
  control.addEventListener("keydown", event => {
    const optionButtons = [...menu.querySelectorAll<HTMLButtonElement>(".select-menu-option")];
    if (event.key === "Escape" && details.open) { event.preventDefault(); details.open = false; trigger.focus(); return; }
    if (event.target === trigger && event.key === "ArrowDown" && !details.open) {
      event.preventDefault(); details.open = true;
      requestAnimationFrame(() => (optionButtons.find(option => option.getAttribute("aria-selected") === "true") ?? optionButtons[0])?.focus());
      return;
    }
    const index = optionButtons.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? optionButtons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + optionButtons.length) % optionButtons.length;
    optionButtons[next]?.focus();
  });
  return control;
}
