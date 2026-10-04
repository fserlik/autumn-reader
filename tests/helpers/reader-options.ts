import { expect, type Page } from "@playwright/test";

export async function revealReaderOption(page: Page, selector: string): Promise<void> {
  const option = page.locator(selector);
  if (!(await option.isVisible())) {
    const panelId = await option.evaluate(element => element.closest<HTMLElement>("[data-reader-panel]")?.id ?? "");
    if (panelId) await page.locator(`[aria-controls="${panelId}"]`).click();
  }
  await expect(option).toBeVisible();
}

export async function clickReaderOption(page: Page, selector: string): Promise<void> {
  await revealReaderOption(page, selector);
  await page.locator(selector).click();
}

export async function selectReaderOption(page: Page, selector: string, value: string | { label: string }): Promise<void> {
  await revealReaderOption(page, selector);
  await page.locator(selector).selectOption(value);
}
