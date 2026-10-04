import { expect, test } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("autumn-language", "es"));
});

test("two accounts keep separate local libraries across logout, repeated switches and reload", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page, "a@example.org");
  const files = await Promise.all(["A", "B", "C"].map(async name => ({
    name: `${name}.epub`, mimeType: "application/epub+zip", buffer: await epubFixture(name),
  })));
  await page.locator("#file-input").setInputFiles(files);
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(3);

  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#account-logout").click();
  await login(page, "b@example.org");
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(0);
  await page.locator("#file-input").setInputFiles({
    name: "D.epub", mimeType: "application/epub+zip", buffer: await epubFixture("D"),
  });
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(1);

  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#account-logout").click();
  await login(page, "a@example.org");
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(3);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#account-logout").click();
  await login(page, "b@example.org");
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(1);
  await page.reload();
  await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(1);
});

test("unowned legacy books stay hidden until the account explicitly recovers them", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page, "a@example.org");
  const bytes = await epubFixture("legacy-local");
  await page.evaluate(encoded => new Promise<void>((resolve, reject) => {
    const content = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const request = indexedDB.open("autumn-reader");
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("books", "readwrite");
      tx.objectStore("books").put({ id: "legacy-unclaimed", name: "Earlier.epub", format: "epub",
        data: new Blob([content], { type: "application/epub+zip" }), addedAt: 1, lastOpenedAt: 0,
        page: 1, cfi: null, fontSize: 100, favorite: true });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  }), bytes.toString("base64"));
  await page.reload();
  await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(0);
  await expect(page.locator("#legacy-recovery")).toBeVisible();
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#account-logout").click();
  await login(page, "b@example.org");
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(0);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#account-logout").click();
  await login(page, "a@example.org");
  await page.locator("#legacy-recovery-button").click();
  await page.locator("#confirm-accept").click();
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(1);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#account-logout").click();
  await login(page, "b@example.org");
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(0);
});
