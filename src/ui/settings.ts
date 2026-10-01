export function mountSettings(parent: HTMLElement): void {
  const tabs = [...parent.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = [...parent.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
  const select = (tab: HTMLButtonElement): void => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.id !== tab.getAttribute("aria-controls");
  };
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
        : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
      if (next === undefined) return;
      event.preventDefault();
      select(tabs[next]);
      tabs[next].focus();
    });
  }
  select(tabs[0]);
}
