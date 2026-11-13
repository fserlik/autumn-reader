import { test, expect } from "@playwright/test";
import { login, mockCloud } from "./helpers/cloud";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("autumn-language", "es"));
});

test("a cloud-only book can be prepared once and opened without a connection", async ({ page, context }) => {
  const cloud = await mockCloud(page);
  // Complete cloud metadata prevents the legacy metadata warmer from downloading the file for us.
  cloud.setPersonalMetadata("Cloud EPUB", "Author", "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-cccc-cccccccccccc/custom.webp");
  await page.goto("/");
  await login(page);
  await page.locator('.nav-button[data-view="library"]').click();

  await expect(page.locator("#library-offline-title")).toHaveText("Prepara tu biblioteca para leer sin conexión");
  await expect(page.locator(".cloud-badge.state-cloud-only")).toHaveText(/Solo en la nube/);
  expect(cloud.downloads).toBe(0);

  await page.locator("#prepare-offline-library").click();
  await expect.poll(() => cloud.downloads).toBe(1);
  await expect(page.locator("#library-offline-status")).toBeHidden();
  await expect(page.locator(".cloud-badge.state-offline")).toHaveText(/Disponible sin conexión/);

  await context.setOffline(true);
  await expect(page.locator("#library-offline-title")).toHaveText("Tu biblioteca está lista sin conexión");
  await page.locator("#library-list .book-title").click();
  await expect(page.locator("#reader-content .epub-frame iframe")).toBeVisible();
  expect(cloud.downloads).toBe(1);

  await page.locator("#desktop-reader-back:visible, #back-button:visible").click();
  await page.locator("#view-library .book-menu summary").click();
  await page.locator("#view-library .book-menu-options").getByRole("button", { name: "Favorito" }).click();
  await expect(page.locator("#library-sync-state")).toContainText("sincronizarán");
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => cloud.syncCount).toBeGreaterThan(0);
});

test("a cloud-only book disappears from the device library when connectivity is lost", async ({ page, context }) => {
  const cloud = await mockCloud(page);
  cloud.setPersonalMetadata("Cloud EPUB", "Author", "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-cccc-cccccccccccc/custom.webp");
  await page.goto("/");
  await login(page);
  await page.locator('.nav-button[data-view="library"]').click();
  expect(cloud.downloads).toBe(0);

  await context.setOffline(true);
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(0);
  await expect(page.locator("#library-list")).toContainText("no hay libros disponibles sin conexión");
  expect(cloud.downloads).toBe(0);
});
