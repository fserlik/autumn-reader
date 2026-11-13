import { expect, type Page } from "@playwright/test";

export async function revealReaderOption(page: Page, selector: string): Promise<void> {
  const option = page.locator(selector);
  if (!(await option.isVisible())) {
    const inReaderToolbar = await option.evaluate(element => Boolean(element.closest(".reader-toolbar")));
    if (inReaderToolbar) await page.locator("#view-reader").evaluate(element => element.classList.remove("controls-hidden"));
    const panelId = await option.evaluate(element => element.closest<HTMLElement>("[data-reader-panel]")?.id ?? "");
    if (panelId === "speech-panel") await page.locator("#speech-toggle").click();
    else if (panelId) {
      const settings = page.locator("#reader-settings-toggle");
      const settingsOpen = await page.locator("#reader-options").evaluate(element => element.classList.contains("desktop-settings-open"));
      if (!settingsOpen) await settings.click();
      await page.locator(panelId === "layout-panel" ? "#reader-settings-layout-tab" : "#reader-settings-appearance-tab").click();
    }
  }
  await expect(option).toBeVisible();
}

export async function clickReaderOption(page: Page, selector: string): Promise<void> {
  if (selector === "#all-notes-button" && !(await page.locator(selector).isVisible())) {
    await page.locator(selector).evaluate(element => (element as HTMLButtonElement).click());
    return;
  }
  await revealReaderOption(page, selector);
  await page.locator(selector).click();
}

export async function selectReaderOption(page: Page, selector: string, value: string | { label: string }): Promise<void> {
  if (selector === "#reader-toc" && !(await page.locator(selector).isVisible())) {
    await page.locator(selector).selectOption(value, { force: true });
    return;
  }
  await revealReaderOption(page, selector);
  await page.locator(selector).selectOption(value);
}
