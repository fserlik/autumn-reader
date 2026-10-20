import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";

async function openAppearance(page: Page, info: TestInfo): Promise<void> {
  await page.locator(info.project.name === "desktop" ? "#reader-settings-toggle" : "#brightness-toggle").click();
  await expect(page.locator("#book-theme-panel")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("autumn-language", "es"));
});

test("Premium themes can be selected without recoloring the reader chrome", async ({ page }, info) => {
  const cloud = await mockCloud(page, true);
  cloud.setPlan("premium");
  await page.goto("/");
  await login(page);
  await page.locator("#file-input").setInputFiles({
    name: "Temas.epub",
    mimeType: "application/epub+zip",
    buffer: await epubFixture("premium-themes", "Temas"),
  });
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await openAppearance(page, info);

  const premiumThemes = page.locator("[data-premium-theme]");
  await expect(premiumThemes).toHaveCount(3);
  await expect(premiumThemes.first()).toHaveAttribute("aria-disabled", "false");
  const chromeBefore = await page.locator(".reader-toolbar, .reader-bottom").evaluateAll(elements =>
    elements.map(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color })),
  );
  await page.locator('[data-book-theme="wine"]').click();
  await expect(page.locator("#view-reader")).toHaveAttribute("data-book-theme", "wine");
  expect(await page.locator(".reader-toolbar, .reader-bottom").evaluateAll(elements =>
    elements.map(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color })),
  )).toEqual(chromeBefore);
  await page.screenshot({ path: info.outputPath("premium-reader-themes.png"), fullPage: true });
  if (info.project.name === "android") {
    await page.setViewportSize({ width: 375, height: 667 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 667, height: 375 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});

test("Free readers keep the standard themes and see Premium choices locked", async ({ page }, info) => {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  await page.locator("#file-input").setInputFiles({
    name: "Gratis.epub",
    mimeType: "application/epub+zip",
    buffer: await epubFixture("free-themes", "Gratis"),
  });
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await openAppearance(page, info);
  await expect(page.locator("[data-premium-theme]").first()).toHaveAttribute("aria-disabled", "true");
  await page.locator('[data-book-theme="sepia"]').click();
  await expect(page.locator("#view-reader")).toHaveAttribute("data-book-theme", "sepia");
  await expect(page.locator('[data-book-theme="wine"]')).toHaveAttribute("aria-pressed", "false");
});
