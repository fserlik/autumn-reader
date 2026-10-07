import { test, expect } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem("autumn-language", "es")); });

test("desktop library uses a larger readable type scale without changing mobile typography", async ({ page }, info) => {
  if (info.project.name === "desktop") await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => localStorage.setItem("autumn-theme", "dark"));
  await mockCloud(page, true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Readable.epub", mimeType: "application/epub+zip", buffer: await epubFixture() });
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator(info.project.name === "desktop" ? "#desktop-reader-back" : "#back-button").click();
  await page.locator('.nav-button[data-view="library"]').click();
  const card = page.locator("#library-list .library-book-card").first();
  const sizes = await card.evaluate((element) => ({
    title: getComputedStyle(element.querySelector(".book-title")!).fontSize,
    author: getComputedStyle(element.querySelector(".library-book-author")!).fontSize,
    badge: getComputedStyle(element.querySelector(".reading-badge")!).fontSize,
    progress: getComputedStyle(element.querySelector(".library-book-progress")!).fontSize,
    select: getComputedStyle(element.querySelector("select")!).fontSize,
  }));
  expect(sizes).toEqual(info.project.name === "desktop"
    ? { title: "17px", author: "13px", badge: "13px", progress: "13px", select: "14px" }
    : { title: "16px", author: "11px", badge: "10px", progress: "10px", select: "11px" });
  await page.screenshot({ path: info.outputPath(`library-readable-${info.project.name}.png`), fullPage: true });
});

test("desktop library grid/list, sorting, cloud state and folder drag persist offline", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "Desktop pointer drag");
  const cloud = await mockCloud(page, true);
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles(await Promise.all(["Zeta.epub", "Alpha.epub"].map(async name => ({ name, mimeType: "", buffer: await epubFixture(name, name.replace(/\.epub$/, "")) }))));
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#desktop-reader-back").click();
  await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(2);
  await expect(page.locator("#library-list .cloud-badge.state-local")).toHaveCount(2);
  await expect(page.locator("#folder-books-heading")).toContainText("(2)");
  await page.locator("#library-list-button").click();
  await expect(page.locator("#library-list")).toHaveAttribute("data-layout", "list");
  await page.screenshot({ path: info.outputPath("library-list.png"), fullPage: true });
  await page.locator("#library-grid-button").click();
  await page.locator("#library-sort").selectOption("title-asc");
  await expect(page.locator("#library-list .book-title").first()).toHaveText("Alpha");
  await page.screenshot({ path: info.outputPath("library-compact.png"), fullPage: true });
  await page.locator("#folder-new").click(); await page.locator("#folder-name").fill("Filosofía");
  await page.locator('#folder-form [type="submit"]').click();
  const tile = page.locator(".folder-tile"); await expect(tile).toHaveCount(1);
  await context.setOffline(true);
  const cover = page.locator("#library-list .library-book-card").first().locator(".book-cover");
  const source = await cover.boundingBox(), target = await tile.boundingBox();
  expect(source).toBeTruthy(); expect(target).toBeTruthy();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(source!.x + source!.width / 2 + 22, source!.y + source!.height / 2 + 20, { steps: 3 });
  await expect(page.locator(".book-drag-preview")).toBeVisible();
  await expect(page.locator(".library-book-card.is-dragging")).toHaveCount(1);
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 6 });
  await expect(tile).toHaveClass(/drop-target/);
  await expect(tile.locator(".folder-drop-hint")).toBeVisible();
  await page.mouse.up();
  await expect(tile.locator(".folder-count")).toHaveText("1 libro");
  await expect(page.locator("#library-list .book-title")).toHaveCount(1);
  await expect(page.locator("#folder-books-heading")).toContainText("(1)");
  expect(cloud.syncCount).toBe(0);
  await page.reload(); await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list")).toHaveAttribute("data-layout", "grid");
  await expect(page.locator("#library-sort")).toHaveValue("title-asc");
  await expect(page.locator(".folder-count")).toHaveText("1 libro");
  await tile.click(); await expect(page.locator("#library-list .book-title")).toHaveText("Alpha");
  await context.setOffline(false);
});

test("desktop General can delete a folder together with its books", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Desktop-only preference");
  await mockCloud(page, true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Ephemeral.epub", mimeType: "application/epub+zip", buffer: await epubFixture("ephemeral", "Ephemeral") });
  await expect(page.locator(".epub-frame iframe")).toBeVisible(); await page.locator("#desktop-reader-back").click();
  await page.locator('.nav-button[data-view="library"]').click();
  await page.locator("#folder-new").click(); await page.locator("#folder-name").fill("Temporal");
  await page.locator('#folder-form [type="submit"]').click();
  const tile = page.locator(".folder-tile");
  const folderId = await tile.getAttribute("data-folder-id");
  await page.locator(".book-folder").selectOption(folderId!);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#general-delete-folder-books").check();
  await page.locator('.nav-button[data-view="library"]').click();
  await tile.click();
  await page.locator("#folder-delete").click();
  await expect(page.locator("#confirm-message")).toContainText("todos los libros");
  await page.locator("#confirm-accept").click();
  await expect(tile).toHaveCount(0);
  await expect(page.locator("#library-list .book-title")).toHaveCount(0);
});

test("touch library keeps its folder selector and does not start desktop preview", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Touch viewport");
  await mockCloud(page, true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Touch.epub", mimeType: "application/octet-stream", buffer: await epubFixture() });
  await expect(page.locator(".epub-frame iframe")).toBeVisible(); await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list .book-folder")).toBeVisible();
  await expect(page.locator(".book-drag-preview")).toHaveCount(0);
});

test("a legacy IndexedDB EPUB with empty MIME and missing format can still sync", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Cloud regression is covered on desktop");
  const cloud = await mockCloud(page, true);
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "A_buen_fin-Shakespeare.epub", mimeType: "application/epub+zip", buffer: await epubFixture() });
  await expect(page.locator(".epub-frame iframe")).toBeVisible(); await page.locator("#back-button").click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("autumn-reader"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const old = await new Promise<Record<string, unknown>>((resolve, reject) => { const tx = db.transaction("books"); const r = tx.objectStore("books").getAll(); r.onsuccess = () => resolve(r.result.find((row: { cloudId?: string }) => !row.cloudId)); r.onerror = () => reject(r.error); });
    const bytes = await (old.data as Blob).arrayBuffer();
    old.data = new Blob([bytes]); delete old.format;
    await new Promise<void>((resolve, reject) => { const tx = db.transaction("books", "readwrite"); tx.objectStore("books").put(old); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await page.reload(); await page.locator('.nav-button[data-view="library"]').click();
  await page.locator("#library-list .book-menu summary").click();
  await page.locator("#library-list .book-menu-options").getByRole("button", { name: "Sincronizar" }).click();
  await expect.poll(() => cloud.uploads).toBeGreaterThan(0);
  await expect(page.locator("#library-list .cloud-badge.state-cloud")).toHaveCount(1);
  const rows = await page.evaluate(() => new Promise<Array<{ format?: string; size: number }>>((resolve, reject) => { const r = indexedDB.open("autumn-reader"); r.onsuccess = () => { const db = r.result, tx = db.transaction("books"); const all = tx.objectStore("books").getAll(); all.onsuccess = () => resolve(all.result.map((row: { format?: string; data: Blob }) => ({ format: row.format, size: row.data.size }))); tx.oncomplete = () => db.close(); }; r.onerror = () => reject(r.error); }));
  expect(rows.some(row => row.format === "epub" && row.size > 0)).toBeTruthy();
});

test("a corrupt historical EPUB reports a specific error and retains its local record", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Cloud regression is covered on desktop");
  const cloud = await mockCloud(page, true);
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Damaged.epub", mimeType: "application/epub+zip", buffer: await epubFixture("damaged", "Damaged") });
  await expect(page.locator(".epub-frame iframe")).toBeVisible(); await page.locator("#back-button").click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("autumn-reader"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const row = await new Promise<Record<string, unknown>>((resolve, reject) => { const tx = db.transaction("books"); const r = tx.objectStore("books").getAll(); r.onsuccess = () => resolve(r.result.find((book: { cloudId?: string }) => !book.cloudId)); r.onerror = () => reject(r.error); });
    row.data = new Blob(["broken ZIP"]);
    await new Promise<void>((resolve, reject) => { const tx = db.transaction("books", "readwrite"); tx.objectStore("books").put(row); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await page.reload(); await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#migrate-library").click();
  await expect(page.locator("#migration-status")).toContainText("El archivo EPUB está dañado o incompleto");
  expect(cloud.uploads).toBe(0);
  await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list .cloud-badge.state-error")).toBeVisible();
  await expect(page.locator("#library-list .book-title")).toHaveText("Damaged");
});

test("desktop drop outside a folder cancels, while a cloud book drop queues and syncs once online", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "Desktop pointer drag");
  const cloud = await mockCloud(page);
  await page.goto("/"); await login(page);
  await expect(page.locator("#library-list .book-title")).toHaveCount(1);
  await page.locator("#folder-new").click(); await page.locator("#folder-name").fill("To read");
  await page.locator('#folder-form [type="submit"]').click();
  const tile = page.locator(".folder-tile"); await expect(tile).toHaveCount(1);
  const source = await page.locator("#library-list .book-cover").boundingBox(), target = await tile.boundingBox();
  expect(source).toBeTruthy(); expect(target).toBeTruthy();
  const x = source!.x + source!.width / 2, y = source!.y + source!.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 25, y + 25);
  await expect(page.locator(".book-drag-preview")).toBeVisible();
  await page.mouse.move(500, 60); await page.mouse.up();
  await expect(tile.locator(".folder-count")).toHaveText("0 libros");
  await expect(page.locator(".book-drag-preview")).toHaveCount(0);
  await context.setOffline(true);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 25, y + 25);
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 5 });
  await expect(tile).toHaveClass(/drop-target/); await page.mouse.up();
  await expect(tile.locator(".folder-count")).toHaveText("1 libro");
  expect(cloud.folderMembers.size).toBe(0);
  await context.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => cloud.folderMembers.size).toBe(1);
});
