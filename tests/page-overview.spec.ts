import { expect, test } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";
import { samplePdf } from "./helpers/pdf";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("autumn-language", "es"));
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test("page overview shows PDF thumbnails and returns to the selected page", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Overview.pdf", mimeType: "application/pdf", buffer: samplePdf() });
  await expect(page.locator(".pdf-page, .pdf-reading-text")).toBeVisible();

  const overview = page.locator("#page-overview-button");
  const search = page.locator("#book-search-button");
  const [overviewBox, searchBox] = await Promise.all([overview.boundingBox(), search.boundingBox()]);
  expect(overviewBox!.x).toBeLessThan(searchBox!.x);

  if (test.info().project.name === "android") {
    for (const selector of ["#brightness-toggle", "#size-toggle", "#layout-toggle"]) await expect(page.locator(selector)).toBeHidden();
    for (const selector of ["#all-notes-button", "#page-overview-button", "#book-search-button", "#reader-settings-toggle"]) await expect(page.locator(selector)).toBeVisible();
    await expect(page.locator(".reader-toolbar")).toHaveCSS("position", "absolute");
    await expect(page.locator(".reader-bottom")).toHaveCSS("position", "absolute");
    const before = await page.locator(".reading-surface").boundingBox();
    await page.locator("#reader-settings-toggle").click();
    await expect(page.locator("#reader-options")).toBeVisible();
    await expect(page.locator(".reader-settings-tabs")).toBeVisible();
    const whileOpen = await page.locator(".reading-surface").boundingBox();
    expect(whileOpen).toEqual(before);
    await page.screenshot({ path: test.info().outputPath("mobile-reader-settings-overlay.png") });
    await page.locator("#reader-settings-toggle").click();
    await page.locator("#view-reader").evaluate(reader => reader.classList.add("controls-hidden"));
    const hidden = await page.locator(".reading-surface").boundingBox();
    expect(hidden).toEqual(before);
    await page.locator("#view-reader").evaluate(reader => reader.classList.remove("controls-hidden"));
    await page.screenshot({ path: test.info().outputPath("mobile-reader-chrome-overlay.png") });
  }

  await overview.click();
  await expect(overview).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#page-overview")).toBeVisible();
  await expect(page.locator(".page-overview-item")).toHaveCount(3);
  await expect(page.locator('.page-overview-item[data-page="1"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator('.page-overview-item[data-page="1"] canvas')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("pdf-page-overview.png") });
  if (test.info().project.name === "desktop") {
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
      const reader = document.querySelector<HTMLElement>("#view-reader")!;
      reader.dataset.bookTheme = "dark";
      reader.style.setProperty("--book-canvas", "#181514");
      reader.style.setProperty("--book-paper", "#241f1d");
      reader.style.setProperty("--book-ink", "#f1e8dc");
    });
    await page.screenshot({ path: test.info().outputPath("pdf-page-overview-dark.png") });
  }

  await page.locator('.page-overview-item[data-page="2"]').click();
  await expect(page.locator("#page-overview")).toBeHidden();
  await expect(overview).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#position-label")).toContainText("2");

  if (test.info().project.name === "android") {
    const box = await overview.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("page overview maps an EPUB and closes after choosing a page", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Overview.epub", mimeType: "application/epub+zip", buffer: await epubFixture() });
  await expect(page.locator("#reader-content .epub-frame iframe")).toBeVisible();

  await page.locator("#page-overview-button").click();
  await expect(page.locator(".page-overview-item").first()).toBeVisible({ timeout: 15_000 });
  const pages = page.locator(".page-overview-item");
  expect(await pages.count()).toBeGreaterThan(1);
  await expect(pages.first().locator(".page-overview-prose")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("epub-page-overview.png") });
  await pages.nth(1).click();
  await expect(page.locator("#page-overview")).toBeHidden();
  await expect(page.locator("#reader-content .epub-frame iframe")).toBeVisible();
});
