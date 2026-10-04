import { test, expect, type Page } from "@playwright/test";
import { mockCloud, login } from "./helpers/cloud";

import { samplePdf } from "./helpers/pdf";
import { clickReaderOption, selectReaderOption } from "./helpers/reader-options";

async function openPdf(page: Page) {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Adjustable reading.pdf", mimeType: "application/pdf", buffer: samplePdf() });
  await expect(page.locator(".pdf-reading-text")).toBeVisible();
}

async function largeText(page: Page) {
  for (let i = 0; i < 8; i++) { await clickReaderOption(page, "#larger-button"); await expect(page.locator("#size-value")).toHaveText(`${110 + i * 10}%`); }
  await expect(page.locator(".pdf-reading-text")).toHaveCSS("font-size", "32.4px");
}

test("enlarges the letters without enlarging the sheet or losing page navigation", async ({ page }, testInfo) => {
  // At 180% on a phone the fixture reflows into dozens of subpages; each
  // animated turn must complete before the next click becomes enabled.
  test.setTimeout(120_000);
  await openPdf(page);
  const original = await page.locator(".pdf-sheet").boundingBox();
  await largeText(page);
  const enlarged = await page.locator(".pdf-sheet").boundingBox();
  expect(enlarged!.width).toBeCloseTo(original!.width, 0);
  expect(enlarged!.height).toBeCloseTo(original!.height, 0);
  expect(await page.locator("#reading-surface").evaluate((surface) => surface.scrollWidth <= surface.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("large-text.png") });
  await page.locator("#next-button").click();
  await expect(page.locator("#position-label")).toContainText("2/");
  await page.locator("#previous-button").click();
  await expect(page.locator("#position-label")).toContainText("1/");
  for (let i = 0; i < 35 && (await page.locator("#position-label").textContent())!.startsWith("Page 1 "); i++) await page.locator("#next-button").click();
  await expect(page.locator("#position-label")).toContainText("Page 2 of 3");
  await expect(page.locator("#reader-content .pdf-reading-text")).toContainText("Line 62: This is a sentence from original page 2");
  for (let i = 0; i < 35 && (await page.locator("#position-label").textContent())!.startsWith("Page 2 "); i++) await page.locator("#previous-button").click();
  await expect(page.locator("#position-label")).toContainText("Page 1 of 3");
  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 760, height: 540 });
    await expect.poll(() => page.locator("#reading-surface").evaluate((surface) => surface.scrollWidth <= surface.clientWidth + 1)).toBeTruthy();
    expect(await page.locator(".reader-toolbar").evaluate((toolbar) => toolbar.scrollWidth <= toolbar.clientWidth + 1)).toBeTruthy();
  }
});

test("keeps a note on its reading page and jumps back to its selected text", async ({ page }, testInfo) => {
  await openPdf(page);
  await largeText(page);
  await page.locator("#next-button").click();
  await expect(page.locator("#position-label")).toContainText("2/");
  const savedPosition = await page.locator("#position-label").textContent();
  await page.evaluate(() => {
    const viewport = document.querySelector(".pdf-reading-viewport")!.getBoundingClientRect();
    const span = [...document.querySelectorAll(".pdf-reading-text p span")].find((element) => {
      const rect = element.getClientRects()[0];
      return rect && rect.left >= viewport.left - 1 && rect.left < viewport.right && rect.top < viewport.bottom;
    })!;
    const range = document.createRange(); range.selectNodeContents(span);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    span.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: viewport.left + 10, clientY: viewport.top + 20 }));
  });
  await page.locator("#note-add").click();
  await page.locator("#note-text").fill("A note on this reading page");
  await page.locator("#note-save").click();
  await expect(page.locator(".note-marker")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("note.png") });
  await page.locator("#next-button").click();
  await expect(page.locator(".note-marker")).toHaveCount(0);
  await clickReaderOption(page, "#all-notes-button");
  await page.locator(".notes-go-button").click();
  await expect(page.locator("#position-label")).toHaveText(savedPosition!);
  await expect(page.locator(".note-marker")).toHaveCount(1);
});

test("restores the text size and keeps the original view for graphic pages", async ({ page }) => {
  await openPdf(page);
  await largeText(page);
  await page.locator("#next-button").click();
  await expect(page.locator("#position-label")).toContainText("2/");
  const position = await page.locator("#position-label").textContent();
  await page.locator("#back-button").click();
  await page.locator(".book-title:visible").first().click();
  await expect(page.locator("#size-value")).toHaveText("180%");
  await expect(page.locator(".pdf-reading-text")).toHaveCSS("font-size", "32.4px");
  await expect(page.locator("#position-label")).toHaveText(position!);
  await selectReaderOption(page, "#pdf-reading-mode", "original");
  await expect(page.locator(".pdf-page")).toBeVisible();
  await expect(page.locator(".size-controls")).toBeHidden();
  await page.locator("#next-button").click();
  await expect(page.locator("#position-label")).toContainText("Page 2 of 3");
  await page.locator("#next-button").click();
  await expect(page.locator("#position-label")).toContainText("Page 3 of 3");
  await expect(page.locator("#pdf-reading-mode option[value=text]")).toBeDisabled();
  await expect(page.locator(".pdf-page")).toBeVisible();
});
