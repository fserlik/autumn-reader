import { expect, test } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";

test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem("autumn-language","es")); });

test("Settings distinguishes three pending states and retries failed local uploads without duplication", async ({page}) => {
  const cloud=await mockCloud(page,true);
  cloud.setQuota({used_books:14,max_books:50,used_bytes:Math.round(19.3*1_048_576),max_bytes:1_073_741_824,active_pending_uploads:0,reserved_bytes:0});
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({name:"Libro local.epub",mimeType:"application/epub+zip",buffer:await epubFixture()});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="settings"]').click();
  await expect(page.locator("#library-quota")).toContainText("14 de 50 libros");
  await expect(page.locator("#library-quota")).toContainText("19.3 de 1024 MB");
  await expect(page.locator("#server-pending")).toContainText("0 reservas de subida activas");
  await expect(page.locator("#migration-count")).toContainText("1 libros");
  await expect(page.locator("#cloud-sync-status")).toContainText("0 cambios de datos en cola");
  cloud.prepareFailures=1;
  await page.locator("#migrate-library").click();
  await expect(page.locator("#migration-status")).toContainText("1 pendientes de reintento");
  await expect(page.locator("#migration-status")).toContainText("demasiadas subidas pendientes");
  expect(cloud.uploads).toBe(1);
  await page.locator("#sync-now").click();
  await expect(page.locator("#migration-status")).toContainText("1 libros migrados; 0 pendientes de reintento");
  await expect(page.locator("#migration-count")).toContainText("0 libros");
  expect(cloud.uploads).toBe(2);
  for(let i=0;i<10;i++) await page.locator("#sync-now").click();
  await expect(page.locator("#sync-now")).toBeEnabled();
  expect(cloud.uploads).toBe(2);
});

test("double-clicking Sync all starts only one migration for a local book", async ({page}) => {
  const cloud=await mockCloud(page,true);
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({name:"Solo una vez.epub",mimeType:"application/epub+zip",buffer:await epubFixture()});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#migrate-library").evaluate((button:HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator("#migration-status")).toContainText("1 libros migrados; 0 pendientes de reintento");
  await expect(page.locator("#migration-count")).toContainText("0 libros");
  expect(cloud.uploads).toBe(1);
  await page.locator("#migrate-library").evaluate((button:HTMLButtonElement) => button.click());
  expect(cloud.uploads).toBe(1);
});
