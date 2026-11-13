import { expect, test, type Route } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";
import { samplePdf } from "./helpers/pdf";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("autumn-language", "es"));
});

const unavailable = (route: Route) => route.abort("internetdisconnected");

test("cold start uses the last local identity and opens only readable device books", async ({ page }, testInfo) => {
  const cloud = await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  await page.locator("#file-input").setInputFiles({
    name: "Guardado.epub",
    mimeType: "application/epub+zip",
    buffer: await epubFixture("offline-cold", "Guardado en el dispositivo"),
  });
  await expect(page.locator("#reader-content .epub-frame iframe")).toBeVisible();
  await page.locator("#desktop-reader-back:visible, #back-button:visible").click();
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(1);

  await page.route("https://autumn-test.supabase.co/**", unavailable);
  await page.reload();

  await expect(page.locator(".shell")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("#auth-entry")).toBeHidden();
  await expect(page.locator("#view-library")).toBeVisible();
  await expect(page.locator("#connection-status")).toContainText("Sin conexión");
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("Failed to fetch");
  await page.screenshot({ path: testInfo.outputPath("offline-library.png"), fullPage: true });

  await page.locator("#library-list .book-title").click();
  await expect(page.locator("#reader-content .epub-frame iframe")).toBeVisible();
  await page.locator("#next-button").click();
  await expect(page.locator("#view-reader")).toBeVisible();

  await page.unroute("https://autumn-test.supabase.co/**", unavailable);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("#connection-status")).toBeHidden({ timeout: 10_000 });
  await expect(page.locator("#view-reader")).toBeVisible();
  expect(cloud.syncCount).toBeGreaterThanOrEqual(0);
});

test("offline start without a prior identity stays on sign in without a fatal network error", async ({ page }) => {
  await mockCloud(page, true);
  await page.route("https://autumn-test.supabase.co/**", unavailable);
  await page.goto("/");

  await expect(page.locator("#auth-entry")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".shell")).toBeHidden();
  await expect(page.locator("#account-message")).not.toContainText("Failed to fetch");
});

test("cloud metadata without a file is not presented as an offline book", async ({ page }) => {
  const cloud = await mockCloud(page);
  cloud.setPersonalMetadata("Cloud EPUB", "Author", "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-cccc-cccccccccccc/custom.webp");
  await page.goto("/");
  await login(page);
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(1);

  await page.route("https://autumn-test.supabase.co/**", unavailable);
  await page.reload();
  await expect(page.locator("#view-library")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(0);
  await expect(page.locator("#library-list")).toContainText("no hay libros disponibles sin conexión");
});

test("a locally stored PDF opens after a cold offline restart", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  await page.locator("#file-input").setInputFiles({
    name: "PDF local.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf(),
  });
  await expect(page.locator(".pdf-reading-text")).toBeVisible();
  await page.locator("#desktop-reader-back:visible, #back-button:visible").click();

  await page.route("https://autumn-test.supabase.co/**", unavailable);
  await page.reload();
  await expect(page.locator("#view-library")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(1);
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".pdf-reading-text")).toBeVisible();
  await expect(page.locator("#position-label")).toContainText("1");
});

test("a damaged local file is not advertised as available offline", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  await page.locator("#file-input").setInputFiles({
    name: "Dañado.epub",
    mimeType: "application/epub+zip",
    buffer: await epubFixture("damaged-offline", "Dañado"),
  });
  await expect(page.locator("#reader-content .epub-frame iframe")).toBeVisible();
  await page.locator("#desktop-reader-back:visible, #back-button:visible").click();
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("autumn-reader");
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("books", "readwrite");
      const store = transaction.objectStore("books");
      const all = store.getAll();
      all.onsuccess = () => {
        const book = all.result.find(item => item.name === "Dañado.epub");
        if (book) store.put({ ...book, data: new Blob(["broken"], { type: "application/epub+zip" }) });
      };
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }));

  await page.route("https://autumn-test.supabase.co/**", unavailable);
  await page.reload();
  await expect(page.locator("#view-library")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(0);
});

test("explicit logout prevents the local identity from being restored offline", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#settings-account-tab").click();
  await page.locator("#account-logout").click();
  await expect(page.locator("#auth-entry")).toBeVisible();

  await page.route("https://autumn-test.supabase.co/**", unavailable);
  await page.reload();
  await expect(page.locator("#auth-entry")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".shell")).toBeHidden();
});

test("offline progress and notes survive a complete reload", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  await page.locator("#file-input").setInputFiles({
    name: "Notas offline.epub",
    mimeType: "application/epub+zip",
    buffer: await epubFixture("offline-notes", "Notas offline"),
  });
  await expect(page.locator("#reader-content .epub-frame iframe")).toBeVisible();
  await page.locator("#desktop-reader-back:visible, #back-button:visible").click();
  await page.route("https://autumn-test.supabase.co/**", unavailable);
  await page.reload();
  await page.locator("#library-list .book-title").click();
  await expect(page.locator("#reader-content .epub-frame iframe")).toBeVisible();

  await page.frameLocator("#reader-content .epub-frame iframe").locator("p").first().evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));
  });
  await page.locator("#note-add").click();
  await page.locator("#note-text").fill("Esta nota se creó sin conexión");
  await page.locator("#note-save").click();
  await expect(page.locator("#notes-count")).toHaveText("1");
  await page.locator("#next-button").click();
  await page.locator("#bookmark-button").click();
  await expect(page.locator("#bookmark-button")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#notes-count")).toHaveText("2");

  const stored = async () => page.evaluate(() => new Promise<{ cfi: string | null; notes: number }>((resolve, reject) => {
    const request = indexedDB.open("autumn-reader");
    request.onsuccess = () => {
      const db = request.result;
      const all = db.transaction("books").objectStore("books").getAll();
      all.onsuccess = () => {
        const book = all.result.find(item => item.name === "Notas offline.epub");
        db.close();
        resolve({ cfi: book?.cfi ?? null, notes: book?.notes?.length ?? 0 });
      };
      all.onerror = () => reject(all.error);
    };
    request.onerror = () => reject(request.error);
  }));
  await expect.poll(stored).toMatchObject({ notes: 2 });
  const beforeReload = await stored();

  await page.reload();
  await expect(page.locator("#view-library")).toBeVisible();
  await page.locator("#library-list .book-title").click();
  await expect(page.locator("#reader-content .epub-frame iframe")).toBeVisible();
  await expect(page.locator("#notes-count")).toHaveText("2");
  await expect(page.locator("#bookmark-button")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(stored).toMatchObject(beforeReload);
});

test("a reachable network with an unresponsive Supabase cannot block startup", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  const slowService = async (route: Route) => {
    if (new URL(route.request().url()).pathname.endsWith("/auth/v1/health")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 8_000));
    await route.abort("timedout");
  };
  await page.route("https://autumn-test.supabase.co/**", slowService);

  const startedAt = Date.now();
  await page.reload();
  await expect(page.locator(".shell")).toBeVisible({ timeout: 7_000 });
  await expect(page.locator("#connection-status")).toContainText("Sin conexión");
  expect(Date.now() - startedAt).toBeLessThan(7_000);
  await expect(page.locator("body")).not.toContainText("Failed to fetch");
});
