import { test, expect } from "@playwright/test";
import { mockCloud, login } from "./helpers/cloud";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("autumn-language", "es"));
});

test("authenticated password change checks current password, confirmation, policy and offline state", async ({ page, context }) => {
  const cloud = await mockCloud(page);
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator(".account-change-password").click();
  const dialog = page.locator(".account-password-form");
  await expect(dialog.locator('input[type="password"]')).toHaveCount(3);
  await dialog.locator('[name="current"]').fill("example-current-password");
  await dialog.locator('[name="next"]').fill("example-next-password");
  await dialog.locator('[name="confirm"]').fill("different-password");
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator(".account-password-error")).toContainText("no coinciden");
  expect(cloud.passwordUpdates).toHaveLength(0);
  await dialog.locator('[name="confirm"]').fill("example-next-password");
  await context.setOffline(true);
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator(".account-password-error")).toContainText("conexión");
  expect(cloud.passwordUpdates).toHaveLength(0);
  await context.setOffline(false);
  cloud.passwordFailure = "current";
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator(".account-password-error")).toContainText("actual no es correcta");
  expect(cloud.passwordUpdates).toHaveLength(0);
  cloud.passwordFailure = "weak";
  await dialog.locator('[name="current"]').fill("example-current-password");
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator(".account-password-error")).toContainText("requisitos");
  expect(cloud.passwordUpdates).toEqual([{hasCurrent:true,hasNew:true}]);
  cloud.passwordFailure = null;
  await dialog.locator('[name="current"]').fill("example-current-password");
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator(".account-security-status")).toHaveText("Contraseña actualizada.");
  await expect(page.locator("#auth-entry")).toBeHidden();
  await page.locator(".account-change-password").click();
  await dialog.locator(".password-visibility").first().click();
  await expect(dialog.locator('input[type="text"]')).toHaveCount(1);
  await dialog.locator(".account-password-cancel").click();
  await page.locator(".account-change-password").click();
  await expect(dialog.locator('input[type="password"]')).toHaveCount(3);
});

test("removing a downloaded book frees cloud quota while its offline file remains readable", async ({ page, context }) => {
  const cloud = await mockCloud(page);
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="library"]').click();
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="settings"]').click();
  await expect(page.locator("#settings-cloud-storage")).toHaveCount(0);
  await expect(page.locator("#settings-plan .cloud-storage-manage")).toBeVisible();
  await page.locator(".cloud-storage-manage").click();
  await expect(page.locator(".cloud-storage-dialog-usage")).toContainText("1 libro en la nube");
  await expect(page.locator(".cloud-storage-row")).toHaveCount(1);
  await expect(page.locator(".cloud-storage-detail")).toContainText("Descargado");
  await page.locator(".cloud-storage-remove").click();
  await expect(page.locator(".cloud-remove-warning")).toContainText("se conservará");
  await page.locator(".cloud-remove-submit").click();
  await expect(page.locator(".cloud-storage-dialog-usage")).toContainText("0 libros en la nube");
  await expect(page.locator(".cloud-storage-row")).toHaveCount(0);
  expect(cloud.removeRequests).toBe(1);
  await page.locator(".cloud-storage-close").click();
  await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list .cloud-badge.state-local")).toHaveCount(1);
  await context.setOffline(true);
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
});

test("cloud-only removal warns clearly and does not download the file", async ({ page }) => {
  const cloud = await mockCloud(page);
  // Edited metadata and a private cover can render without fetching the EPUB.
  cloud.setPersonalMetadata("Cloud EPUB", "Author", "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-cccc-cccccccccccc/custom.webp");
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator(".cloud-storage-manage").click();
  await page.locator(".cloud-storage-remove").click();
  await expect(page.locator(".cloud-remove-warning")).toContainText("no tiene una copia descargada");
  expect(cloud.downloads).toBe(0);
  await page.locator(".cloud-remove-submit").click();
  await expect(page.locator(".cloud-storage-dialog-usage")).toContainText("0 libros en la nube");
  expect(cloud.downloads).toBe(0);
  await page.locator(".cloud-storage-close").click();
  await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list .book-title")).toHaveCount(0);
});

test("a removed local book can be synchronized again without losing its cached EPUB", async ({ page }) => {
  const cloud = await mockCloud(page);
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="library"]').click();
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator(".cloud-storage-manage").click();
  await page.locator(".cloud-storage-remove").click();
  await page.locator(".cloud-remove-submit").click();
  await expect(page.locator(".cloud-storage-dialog-usage")).toContainText("0 libros en la nube");
  await page.locator(".cloud-storage-close").click();
  await page.locator('.nav-button[data-view="library"]').click();
  await page.locator("#view-library .book-menu summary").first().click();
  await page.locator("#view-library .book-menu-options").first().getByRole("button", {name:"Sincronizar"}).click();
  await expect(page.locator("#library-list .cloud-badge.state-cloud")).toHaveCount(1);
  expect(cloud.removeRequests).toBe(1);
  expect(cloud.uploads).toBeGreaterThan(0);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator(".cloud-storage-manage").click();
  await expect(page.locator(".cloud-storage-dialog-usage")).toContainText("1 libro en la nube");
});

test("offline cloud removal does not mutate the server or local authorization", async ({ page, context }) => {
  const cloud = await mockCloud(page);
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator(".cloud-storage-manage").click();
  await page.locator(".cloud-storage-remove").click();
  await context.setOffline(true);
  await page.locator(".cloud-remove-submit").click();
  await expect(page.locator(".cloud-remove-error")).toContainText("sin conexión");
  expect(cloud.removeRequests).toBe(0);
  await context.setOffline(false);
  await page.locator(".cloud-remove-cancel").click();
  await page.locator(".cloud-storage-close").click();
  await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list .cloud-badge.state-cloud")).toHaveCount(1);
});
