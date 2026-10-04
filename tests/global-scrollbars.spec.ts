import { expect, test, type Page } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";
import { samplePdf } from "./helpers/pdf";
import { selectReaderOption } from "./helpers/reader-options";

async function hiddenScrollbar(page: Page, selector: string): Promise<void> {
  const node = page.locator(selector);
  await expect(node).toHaveCSS("scrollbar-width", "none");
  expect(await node.evaluate(element => getComputedStyle(element, "::-webkit-scrollbar").display)).toBe("none");
}

test("all pages keep vertical scrolling while native scrollbars stay invisible", async ({ page }, testInfo) => {
  await mockCloud(page, true);
  await page.goto("/"); await login(page);
  for (const width of [320, 390, 700, 768, 1200]) {
    await page.setViewportSize({ width, height: 700 });
    for (const view of ["home", "library", "settings", "profile"] as const) {
      await page.locator(`.nav-button[data-view="${view}"]`).click();
      await expect(page.locator(`#view-${view}`)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} at ${width}px`).toBe(true);
      expect(await page.locator(".content-area").evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${view} main area at ${width}px`).toBe(true);
    }
  }
  await page.locator('.nav-button[data-view="home"]').click();
  await hiddenScrollbar(page, ".content-area");
  await page.locator("#view-home").evaluate(element => {
    const spacer = document.createElement("div"); spacer.style.height = "1200px"; spacer.setAttribute("aria-hidden", "true"); element.append(spacer);
  });
  const area = page.locator(".content-area");
  expect(await area.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  if (testInfo.project.name === "desktop") {
    const box = await area.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 420);
    await expect.poll(() => area.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    await page.locator("#hero-action").focus();
    const before = await area.evaluate(element => element.scrollTop);
    await page.keyboard.press("PageDown");
    await expect.poll(() => area.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
  } else {
    const box = await area.boundingBox();
    const touch = await page.context().newCDPSession(page);
    const x = box!.x + box!.width / 2, startY = box!.y + Math.min(box!.height - 30, 380);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
    for (let distance = 40; distance <= 240; distance += 40)
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY - distance }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => area.evaluate(element => element.scrollTop)).toBeGreaterThan(50);
  }
});

test("EPUB iframe, PDF surface and long dialogs retain scroll without native bars", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Scroll fixture.epub", mimeType: "application/epub+zip", buffer: await epubFixture() });
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await hiddenScrollbar(page, "#reading-surface");
  const iframe = page.frameLocator(".epub-frame iframe");
  await expect(iframe.locator("#autumn-scrollbars")).toBeAttached();
  await expect(iframe.locator("html")).toHaveCSS("scrollbar-width", "none");
  await page.locator("#back-button").click();

  await page.locator("#file-input").setInputFiles({ name: "Scroll fixture.pdf", mimeType: "application/pdf", buffer: samplePdf() });
  await expect(page.locator(".pdf-reading-text")).toBeVisible();
  await hiddenScrollbar(page, "#reading-surface");
  await selectReaderOption(page, "#pdf-reading-mode", "original");
  await expect(page.locator(".pdf-page")).toBeVisible();
  expect(await page.locator("#reading-surface").evaluate(element => getComputedStyle(element).overflowY)).toBe("auto");

  await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="library"]').click();
  for (const width of [390, 1200]) {
    await page.setViewportSize({ width, height: 700 });
    for (const layout of ["list", "grid"] as const) {
      await page.locator(`#library-${layout}-button`).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${layout} at ${width}px`).toBe(true);
      expect(await page.locator(".content-area").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
  }
  await page.locator("#library-list .book-menu summary").first().click();
  await page.locator("#library-list .book-menu-options").first().getByRole("button", { name: /review|reseñ/i }).click();
  await expect(page.locator("#review-dialog")).toBeVisible();
  await hiddenScrollbar(page, "#review-dialog");
  await page.locator("#review-dialog").evaluate(element => { element.style.maxHeight = "170px"; });
  const dialog = page.locator("#review-dialog");
  expect(await dialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await dialog.evaluate(element => element.scrollTo(0, element.scrollHeight));
  expect(await dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});
