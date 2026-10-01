import { test, expect } from "@playwright/test";
import { mockCloud, login, bookId, epubFixture } from "./helpers/cloud";
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem("autumn-language", "es")); });

test("local imports work beyond the cloud count without uploading or enqueueing cloud changes", async ({ page, context }) => {
  const cloud = await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();
  await expect(page.locator("#library-quota")).toContainText("0 de 1 libros");
  await context.setOffline(true);
  const bytes = await epubFixture();
  await page.locator("#file-input").setInputFiles([1, 2, 3].map(i => ({name:`Local ${i}.epub`, mimeType:"application/epub+zip", buffer:bytes})));
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list .book-title")).toHaveCount(3);
  await expect(page.locator("#library-list .cloud-badge.state-local")).toHaveCount(3);
  expect(cloud.uploads).toBe(0);
  expect(cloud.syncCount).toBe(0);
  await context.setOffline(false);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#account-logout").click();
  await login(page,"b@example.org");
  await expect(page.locator("#library-list .book-title")).toHaveCount(0);
});
test("account library is lazy; EPUB opens, reads offline, queues changes and survives reload", async ({
  page,
  context,
}) => {
  const cloud = await mockCloud(page);
  await page.goto("/");
  await login(page);
  await expect(page.locator("#library-list .book-title")).toHaveCount(1);
  expect(cloud.downloads).toBe(0);
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await expect(
    page.frameLocator(".epub-frame iframe").locator("h1"),
  ).toHaveText("Cloud chapter");
  expect(cloud.downloads).toBe(1);
  await context.setOffline(true);
  await page.locator("#next-button").click();
  await page.locator("#back-button").click();
  await page.locator("#view-library .book-menu summary").first().click();
  await page.locator("#view-library .book-menu-options").first().getByRole("button", { name: "Favorito" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const r = indexedDB.open("autumn-reader");
            r.onsuccess = () => {
              const db = r.result;
              const tx = db.transaction("pending_sync_operations", "readonly");
              const all = tx.objectStore("pending_sync_operations").getAll();
              all.onsuccess = () => resolve(all.result.length);
              tx.oncomplete = () => db.close();
            };
            r.onerror = () => reject(r.error);
          }),
      ),
    )
    .toBeGreaterThan(0);
  await page.reload();
  await page.locator('.nav-button[data-view="library"]').click();
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  expect(cloud.downloads).toBe(1);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => cloud.syncCount).toBeGreaterThan(0);
  await page.locator("#back-button").click();
  cloud.stalled = true;
  const start = Date.now();
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  expect(Date.now() - start).toBeLessThan(1400);
  expect(cloud.downloads).toBe(1);
});
test("offline logout and another account hide the first account's cached file and notes", async ({
  page,
  context,
}) => {
  const cloud = await mockCloud(page);
  await page.goto("/");
  await login(page);
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await context.setOffline(true);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#account-logout").click();
  await expect(page.locator("#auth-entry")).toBeVisible();
  await expect(page.locator(".shell")).toBeHidden();
  await context.setOffline(false);
  await login(page, "b@example.org");
  await expect(page.locator("#library-list .book-title")).toHaveCount(0);
  expect(cloud.downloads).toBe(1);
  await page.evaluate((id) => {
    location.hash = `/books/${id}`;
  }, bookId);
  await expect(page.locator("#view-details h2")).toHaveText("Cloud EPUB");
  await expect(page.locator("#view-details")).toContainText(
    "solo se abre desde tu biblioteca autorizada",
  );
  expect(cloud.downloads).toBe(1);
});

test("entry precedes the library, settings only contains logout, and profile editing lives in its own tab", async ({ page }, testInfo) => {
  await mockCloud(page);
  await page.goto("/");
  await expect(page.locator("#auth-entry")).toBeVisible();
  await expect(page.locator(".shell")).toBeHidden();
  await expect(page.locator("#email-token-form")).toBeHidden();
  await expect(page.locator("#auth-local, #auth-verify, .drive-panel")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("entry.png"), fullPage: true });
  await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();
  await expect(page.locator("#account-logout")).toBeVisible();
  await expect(page.locator("#view-settings #account-form, #view-settings #email-token-form, #view-settings #profile-form")).toHaveCount(0);
  await expect(page.locator('.nav-button[data-view="community"]')).toHaveCount(0);
  await page.locator('.nav-button[data-view="profile"]').click();
  await page.locator("#profile-edit").click();
  await expect(page.locator("#view-profile #profile-form")).toBeVisible();
  await page.reload();
  await expect(page.locator("#auth-entry")).toBeHidden();
  await expect(page.locator(".shell")).toBeVisible();
});

test("registration verifies email and recovery requires a new password before entering", async ({ page }, testInfo) => {
  const cloud = await mockCloud(page);
  await page.goto("/");
  await page.locator("#auth-register-tab").click();
  await expect(page.locator("#auth-heading")).toHaveText("Crea tu cuenta");
  await page.screenshot({ path: testInfo.outputPath("registration.png"), fullPage: true });
  await page.locator('#account-form [name="username"]').fill("autumn_user");
  await page.locator('#account-form [name="email"]').fill("a@example.org");
  await page.locator('#account-form [name="password"]').fill("test-password");
  await page.locator("#auth-submit").click();
  await expect(page.locator("#email-token-form")).toBeVisible();
  await expect(page.locator(".shell")).toBeHidden();
  expect(cloud.registeredUsername).toBe("autumn_user");
  await expect(page.locator("#email-token-form select")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#email-token-form")).toBeVisible();
  await expect(page.locator('#email-token-form [name="email"]')).toHaveValue("a@example.org");
  await page.locator('#email-token-form [name="token"]').fill("123456");
  await page.locator('#email-token-form button[type="submit"]').click();
  await expect.poll(() => cloud.verifyRequests[0]).toMatchObject({email:"a@example.org", token:"123456", type:"email"});
  await expect(page.locator("#auth-entry")).toBeHidden();
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#account-logout").click();
  await expect(page.locator("#auth-entry")).toBeVisible();
  await page.locator("#auth-recover").click();
  await page.locator('#account-form [name="email"]').fill("a@example.org");
  await expect(page.locator('#account-form [name="password"]')).toBeDisabled();
  await page.locator("#auth-submit").click();
  await expect(page.locator("#email-token-form")).toBeVisible();
  await page.locator('#email-token-form [name="token"]').fill("654321");
  await page.locator('#email-token-form button[type="submit"]').click();
  await expect.poll(() => cloud.verifyTypes).toEqual(["email", "recovery"]);
  await expect.poll(() => cloud.verifyRequests[1]).toMatchObject({email:"a@example.org", token:"654321", type:"recovery"});
  await expect(page.locator("#password-form")).toBeVisible();
  await expect(page.locator(".shell")).toBeHidden();
  await page.locator('#password-form [name="password"]').fill("new-test-password");
  await page.locator('#password-form button[type="submit"]').click();
  await expect(page.locator("#auth-entry")).toBeHidden();
});

test("an unconfirmed login resumes signup verification without offering an email type choice", async ({page}) => {
  const cloud = await mockCloud(page);
  await page.route("https://autumn-test.supabase.co/auth/v1/token**", route => route.fulfill({ status:400, contentType:"application/json", headers:{"Access-Control-Allow-Origin":"*","Access-Control-Expose-Headers":"X-Supabase-Api-Version","X-Supabase-Api-Version":"2024-01-01"}, body:JSON.stringify({code:"email_not_confirmed",msg:"Email not confirmed"}) }));
  await page.goto("/");
  await page.locator('#account-form [name="email"]').fill("a@example.org");
  await page.locator('#account-form [name="password"]').fill("test-password");
  await page.locator("#auth-submit").click();
  await expect(page.locator("#auth-heading")).toHaveText("Confirma tu registro");
  await expect(page.locator("#email-token-form select, #auth-local, #auth-verify")).toHaveCount(0);
  await page.locator('#email-token-form [name="token"]').fill("signup-token-hash");
  await page.locator('#email-token-form button[type="submit"]').click();
  await expect(page.locator("#auth-entry")).toBeHidden();
  expect(cloud.verifyTypes).toEqual(["signup"]);
  expect(cloud.verifyRequests[0]).toMatchObject({token_hash:"signup-token-hash", type:"signup"});
});

test("a remembered expired account can open its downloaded EPUB after an offline restart", async ({ page, context }) => {
  const cloud = await mockCloud(page);
  await page.goto("/");
  await login(page);
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => { localStorage.removeItem("autumn-auth"); });
  await page.reload();
  await expect(page.locator("#auth-entry")).toBeHidden();
  await page.locator('.nav-button[data-view="library"]').click();
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  expect(cloud.downloads).toBe(1);
});
