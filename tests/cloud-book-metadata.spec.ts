import { test, expect } from "@playwright/test";
import { a, bookId, epubWithCoverFixture, login, mockCloud } from "./helpers/cloud";
import { samplePdf } from "./helpers/pdf";
import JSZip from "jszip";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("autumn-language", "es"));
});

async function cachedBook(page: import("@playwright/test").Page) {
  return page.evaluate(async () => new Promise<{
    title?: string; author?: string; displayTitle?: string; coverSize: number; version?: number; fileSize: number; fileHash?: string;
  }>((resolve, reject) => {
    const open = indexedDB.open("autumn-reader");
    open.onsuccess = () => {
      const db = open.result, read = db.transaction("books").objectStore("books").getAll();
      read.onsuccess = () => {
        const book = read.result.find(row => row.ownerId === "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" && !row.deletedAt && !row.duplicateOf);
        resolve({ title: book?.contentTitle, author: book?.author, displayTitle: book?.displayTitle,
          coverSize: book?.cover?.size ?? 0, version: book?.contentMetadataVersion, fileSize: book?.data?.size ?? 0, fileHash: book?.fileHash });
        db.close();
      };
      read.onerror = () => reject(read.error);
    };
    open.onerror = () => reject(open.error);
  }));
}

test("new device extracts real EPUB cover, title and author once, then shows them offline", async ({ page, context }) => {
  const bytes = await epubWithCoverFixture();
  const cloud = await mockCloud(page, false, bytes);
  cloud.setCatalogMetadata("_La_hipotesis_del_amor.epub", "");
  await page.goto("/"); await login(page);
  const card = page.locator(".library-book-card");
  await expect(card.locator(".book-title")).toHaveText("La hipótesis del amor");
  await expect(card.locator(".library-book-author")).toHaveText("Ali Hazelwood");
  await expect(card.locator(".book-cover:not(.book-cover-fallback) > img")).toBeVisible();
  expect(await cachedBook(page)).toMatchObject({ title: "La hipótesis del amor", author: "Ali Hazelwood", version: 1 });
  expect((await cachedBook(page)).coverSize).toBeGreaterThan(0);
  expect(cloud.downloads).toBe(1);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.nav-button[data-view="library"]').click();
  await expect(card.locator(".book-title")).toHaveText("La hipótesis del amor");
  await expect(card.locator(".book-cover:not(.book-cover-fallback) > img")).toBeVisible();
  expect(cloud.downloads).toBe(1);
});

test("manual title, author and private cover win over embedded metadata", async ({ page }) => {
  const cloud = await mockCloud(page, false, await epubWithCoverFixture("personal"));
  const path = `${a}/${bookId}/cover-custom.webp`;
  cloud.setPersonalMetadata("Mi edición", "Mi autora", path);
  cloud.privateCovers.set(path, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64"));
  await page.goto("/"); await login(page);
  const card = page.locator(".library-book-card");
  await expect(card.locator(".book-title")).toHaveText("Mi edición");
  await expect(card.locator(".library-book-author")).toHaveText("Mi autora");
  await expect(card.locator(".book-cover:not(.book-cover-fallback) > img")).toBeVisible();
  await card.locator(".book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await expect(card.locator(".book-title")).toHaveText("Mi edición");
  await expect(card.locator(".library-book-author")).toHaveText("Mi autora");
  expect(cloud.bookMetadata.display_title).toBe("Mi edición");
  expect(cloud.uploads).toBe(0);
});

test("local import shares the parser and uploads embedded metadata without changing file bytes", async ({ page }) => {
  const bytes = await epubWithCoverFixture("upload");
  const cloud = await mockCloud(page, true);
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "_OceanofPDF.com_book.epub", mimeType: "application/epub+zip", buffer: bytes });
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  const card = page.locator(".library-book-card");
  await expect(card.locator(".book-title")).toHaveText("La hipótesis del amor");
  await expect(card.locator(".library-book-author")).toHaveText("Ali Hazelwood");
  await expect(card.locator(".book-cover:not(.book-cover-fallback) > img")).toBeVisible();
  const before = await cachedBook(page);
  await card.locator(".book-menu summary").click();
  await card.locator(".book-menu-options").getByRole("button", { name: /sincronizar/i }).click();
  await expect.poll(() => cloud.preparePayloads.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(cloud.preparePayloads[0]).toMatchObject({ title: "La hipótesis del amor", author: "Ali Hazelwood" });
  expect((await cachedBook(page)).fileSize).toBe(before.fileSize);
  expect((await cachedBook(page)).fileHash).toBe(before.fileHash);
});

test("an already downloaded legacy row repairs its cover offline without a second book or download", async ({ page, context }) => {
  const cloud = await mockCloud(page, false, await epubWithCoverFixture("legacy"));
  await page.goto("/"); await login(page);
  await expect(page.locator(".library-book-card .book-cover:not(.book-cover-fallback) > img")).toBeVisible();
  expect(cloud.downloads).toBe(1);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("autumn-reader");
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("books", "readwrite"), store = tx.objectStore("books"), read = store.get("cloud-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa-cccccccc-cccc-4ccc-cccc-cccccccccccc");
      read.onsuccess = () => {
        const book = read.result;
        delete book.cover; delete book.contentTitle; delete book.contentAuthor; delete book.contentMetadataVersion;
        book.author = "";
        store.put(book);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }));
  await context.setOffline(true);
  await page.reload(); await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator(".library-book-card .book-title")).toHaveText("La hipótesis del amor");
  await expect(page.locator(".library-book-card .book-cover:not(.book-cover-fallback) > img")).toBeVisible();
  await expect(page.locator(".library-book-card")).toHaveCount(1);
  expect(cloud.downloads).toBe(1);
});

test("an EPUB without an embedded cover keeps the generated fallback after one extraction", async ({ page }) => {
  const cloud = await mockCloud(page);
  await page.goto("/"); await login(page);
  await expect(page.locator(".library-book-card .book-cover-fallback")).toBeVisible();
  await expect.poll(async () => (await cachedBook(page)).version).toBe(1);
  expect((await cachedBook(page)).coverSize).toBe(0);
  expect(cloud.downloads).toBe(1);
});

test("a broken embedded image falls back while valid EPUB title and author survive", async ({ page }) => {
  const zip = await JSZip.loadAsync(await epubWithCoverFixture("broken-image"));
  zip.file("OEBPS/cover.png", "not an image");
  const cloud = await mockCloud(page, false, await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }));
  cloud.setCatalogMetadata("broken_filename", "");
  await page.goto("/"); await login(page);
  await expect(page.locator(".library-book-card .book-title")).toHaveText("La hipótesis del amor");
  await expect(page.locator(".library-book-card .library-book-author")).toHaveText("Ali Hazelwood");
  await expect(page.locator(".library-book-card .book-cover-fallback")).toBeVisible();
  await expect.poll(async () => (await cachedBook(page)).version).toBe(1);
  expect((await cachedBook(page)).coverSize).toBe(0);
});

test("PDF import reads document title and author and caches its first-page cover", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "unnamed.pdf", mimeType: "application/pdf",
    buffer: samplePdf(true, false, { title: "Meditations", author: "Marcus Aurelius" }) });
  await expect(page.locator(".pdf-page:visible, .pdf-reading-text:visible").first()).toBeVisible();
  await page.locator("#back-button").click();
  await expect(page.locator(".library-book-card .book-title")).toHaveText("Meditations");
  await expect(page.locator(".library-book-card .library-book-author")).toHaveText("Marcus Aurelius");
  await expect(page.locator(".library-book-card .book-cover:not(.book-cover-fallback) > img")).toBeVisible();
  expect((await cachedBook(page)).coverSize).toBeGreaterThan(0);
});

test("31 cloud books recover covers in bounded background work and remain cached offline", async ({ page, context }) => {
  test.setTimeout(120_000);
  const cloud = await mockCloud(page, false, await epubWithCoverFixture("root", "Book 0"));
  for (let index = 1; index < 31; index++) {
    const id = `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, "0")}`;
    await cloud.addCloudBook(id, `File ${index}`, await epubWithCoverFixture(`book-${index}`, `Book ${index}`));
  }
  await page.goto("/"); await login(page);
  await expect(page.locator(".library-book-card")).toHaveCount(31);
  await expect(page.locator(".library-book-card .book-cover:not(.book-cover-fallback) > img")).toHaveCount(31, { timeout: 90_000 });
  await expect(page.locator(".library-book-card .library-book-author")).toHaveCount(31);
  expect(cloud.downloads).toBe(31);
  await context.setOffline(true);
  await page.reload(); await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator(".library-book-card")).toHaveCount(31);
  await expect(page.locator(".library-book-card .book-cover:not(.book-cover-fallback) > img")).toHaveCount(31);
  expect(cloud.downloads).toBe(31);
});

test("a second account can import the same binary without inheriting the first account's edits", async ({ page }) => {
  const bytes = await epubWithCoverFixture("shared");
  const cloud = await mockCloud(page, false, bytes);
  await page.goto("/"); await login(page);
  await expect(page.locator(".library-book-card .book-cover:not(.book-cover-fallback) > img")).toBeVisible();
  await page.locator('.nav-button[data-view="settings"]').click(); await page.locator("#account-logout").click();
  await login(page, "b@example.org");
  await expect(page.locator(".library-book-card")).toHaveCount(0);
  await page.locator("#file-input").setInputFiles({ name: "shared-copy.epub", mimeType: "", buffer: bytes });
  await expect(page.locator(".epub-frame iframe")).toBeVisible(); await page.locator("#back-button").click();
  await expect(page.locator(".library-book-card .book-title")).toHaveText("La hipótesis del amor");
  await page.locator(".book-menu summary").click();
  await page.locator(".book-menu-options").getByRole("button", { name: "Editar libro" }).click();
  await page.locator(".edit-book-title").fill("Mi copia privada"); await page.locator(".edit-book-save").click();
  await expect(page.locator(".library-book-card .book-title")).toHaveText("Mi copia privada");
  await page.locator('.nav-button[data-view="settings"]').click(); await page.locator("#account-logout").click();
  await login(page);
  await expect(page.locator(".library-book-card")).toHaveCount(1);
  await expect(page.locator(".library-book-card .book-title")).toHaveText("La hipótesis del amor");
  expect(cloud.downloads).toBe(1);
});
