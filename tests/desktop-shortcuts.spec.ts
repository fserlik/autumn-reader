import { test, expect } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("autumn-language", "es"));
  await mockCloud(page, true);
  await page.goto("/");
  await login(page);
});

test("desktop shortcuts can be reviewed, changed and used", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Desktop-only shortcuts");

  await page.keyboard.press("Control+,");
  await expect(page.locator("#view-settings")).toBeVisible();
  await page.locator("#settings-shortcuts-tab").click();
  await expect(page.locator("#settings-shortcuts-panel")).toBeVisible();
  await expect(page.locator(".shortcut-row")).toHaveCount(10);
  await page.screenshot({ path: info.outputPath("desktop-shortcuts-light.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: info.outputPath("desktop-shortcuts-dark.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.locator(".content-area").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: info.outputPath("desktop-shortcuts-bottom.png") });

  const overview = page.locator('[data-shortcut-action="pageOverview"]');
  await overview.locator(".shortcut-capture").click();
  await expect(overview.locator(".shortcut-capture")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("p");
  await expect(overview.locator("kbd")).toHaveText("P");
  await expect(page.locator("#shortcut-status")).toContainText("guardado");

  const importBooks = page.locator('[data-shortcut-action="importBooks"]');
  await importBooks.locator(".shortcut-capture").click();
  await page.keyboard.press("Control+f");
  await expect(importBooks.locator(".shortcut-error")).toContainText("ya se usa");
  await page.keyboard.press("Escape");

  await page.locator("#shortcut-reset").click();
  await expect(overview.locator("kbd")).toHaveText("G");
  await expect(page.locator("#shortcut-status")).toContainText("restauraron");
  await overview.locator(".shortcut-capture").click();
  await page.keyboard.press("p");

  await page.locator("#file-input").setInputFiles({ name: "Shortcuts.epub", mimeType: "application/epub+zip", buffer: await epubFixture() });
  await expect(page.locator("#reader-content .epub-frame iframe")).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.locator("#page-overview")).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.locator("#page-overview")).toBeHidden();

  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator("#view-library")).toBeVisible();
  await page.keyboard.press("Control+f");
  await expect(page.locator("#library-search")).toBeFocused();
});

test("keyboard shortcut settings stay out of the Android app", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Android-only visibility check");
  await page.locator('.nav-button[data-view="settings"]').click();
  await expect(page.locator("#settings-shortcuts-tab")).toHaveCount(0);
  await expect(page.locator("#settings-shortcuts-panel")).toHaveCount(0);
});
