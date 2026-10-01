import { test, expect } from "@playwright/test";
import { mockCloud, login, epubFixture } from "./helpers/cloud";

test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem("autumn-language", "es")); });

test("Library card opens directly while its menu edits display metadata offline without a file upload", async ({page,context}) => {
  const cloud = await mockCloud(page);
  cloud.setBookState({ favorite: true, status: "reading" });
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="library"]').click();
  const card = page.locator(".library-book-card");
  await card.locator(".book-menu summary").click();
  await expect(card.locator(".book-menu-options")).not.toContainText("Abrir");
  await expect(card.locator(".book-menu-options")).toContainText("Editar libro");
  await card.locator(".book-menu-options").getByRole("button",{name:"Editar libro"}).click();
  await expect(page.locator(".edit-book-dialog")).toBeVisible();
  await page.locator(".edit-book-title").fill("Canceled title");
  await page.locator(".edit-book-cancel").click();
  await expect(card.locator(".book-title")).toHaveText("Cloud EPUB");
  await context.setOffline(true);
  await card.locator(".book-menu summary").click();
  await card.locator(".book-menu-options").getByRole("button",{name:"Editar libro"}).click();
  await page.locator(".edit-book-title").fill("Mi edición personal");
  await page.locator(".edit-book-author").fill("Autora nueva");
  await page.locator(".edit-book-save").click();
  await expect(card.locator(".book-title")).toHaveText("Mi edición personal");
  await expect(card.locator(".library-book-author")).toHaveText("Autora nueva");
  await page.locator('.nav-button[data-view="home"]').click();
  await expect(page.locator("#hero-title")).toHaveText("Mi edición personal");
  await expect(page.locator("#hero-author")).toHaveText("Autora nueva");
  expect(cloud.uploads).toBe(0);
  await page.reload(); await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator(".library-book-card .book-title")).toHaveText("Mi edición personal");
  await context.setOffline(false);
  await expect.poll(() => cloud.bookMetadata.display_title).toBe("Mi edición personal");
  expect(cloud.uploads).toBe(0);
  await page.reload(); await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator(".library-book-card .book-title")).toHaveText("Mi edición personal");
  await card.locator(".book-card-info").click({position:{x:4,y:70}});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
});

test("custom cover previews, validates and syncs privately without changing book bytes", async ({page,context}) => {
  const cloud = await mockCloud(page); cloud.setBookState({favorite:false,status:"reading"}); await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="library"]').click();
  await page.locator(".book-menu summary").click();
  await page.locator(".book-menu-options").getByRole("button",{name:"Editar libro"}).click();
  const file = page.locator(".edit-book-file");
  await file.setInputFiles({name:"bad.txt",mimeType:"text/plain",buffer:Buffer.from("bad")});
  await expect(page.locator(".edit-book-error")).toContainText("JPG, PNG o WebP");
  await file.setInputFiles({name:"broken.png",mimeType:"image/png",buffer:Buffer.from("broken")});
  await expect(page.locator(".edit-book-error")).toContainText("JPG, PNG o WebP");
  await file.setInputFiles("src/assets/autumn-leaf.png");
  await expect(page.locator(".edit-book-cover-preview img")).toBeVisible();
  await expect(page.locator(".edit-book-error")).toBeEmpty();
  await context.setOffline(true);
  await page.locator(".edit-book-save").click();
  await expect(page.locator(".edit-book-dialog")).toBeHidden();
  await expect(page.locator(".library-book-card .book-cover > img")).toBeVisible();
  expect(cloud.coverUploads).toHaveLength(0);
  expect(cloud.uploads).toBe(0);
  await context.setOffline(false);
  await expect.poll(() => cloud.coverUploads.length).toBe(1);
  expect(cloud.coverUploads[0].contentType).toContain("image/webp");
  expect(cloud.coverUploads[0].size).toBeLessThan(512*1024);
  expect(cloud.bookMetadata.cover_path).toBe(cloud.coverUploads[0].path);
  expect(cloud.uploads).toBe(0);
  await page.locator('.nav-button[data-view="home"]').click();
  await expect(page.locator("#hero-art .book-cover > img")).toBeVisible();
  await expect(page.locator("#hero-art .book-cover > img")).toHaveCSS("transform", "none");
  await expect(page.locator("#hero-art .book-cover > img")).toHaveCSS("object-fit", "contain");
  // A fresh device sees metadata first and fetches only the private cover in view.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("autumn-reader");
    open.onsuccess = () => { const db = open.result, tx = db.transaction("books","readwrite"); tx.objectStore("books").clear(); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    open.onerror = () => reject(open.error);
  }));
  await page.reload(); await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator(".library-book-card .book-cover > img")).toBeVisible();
  expect(cloud.uploads).toBe(0);
});

test("editing a local title never renames or rewrites the EPUB", async ({page}) => {
  const cloud = await mockCloud(page,true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({name:"Original_file-name.epub",mimeType:"application/epub+zip",buffer:await epubFixture()});
  await expect(page.locator(".epub-frame iframe")).toBeVisible(); await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="library"]').click();
  const stored = () => page.evaluate(() => new Promise<{name:string;hash?:string;bytes:number[]}>(resolve => {
    const open=indexedDB.open("autumn-reader"); open.onsuccess=() => {
      const db=open.result,read=db.transaction("books").objectStore("books").getAll();
      read.onsuccess=async() => { const book=read.result.find(row => row.name==="Original_file-name.epub"); resolve({name:book.name,hash:book.fileHash,bytes:[...new Uint8Array(await book.data.arrayBuffer())]}); db.close(); };
    };
  }));
  const before=await stored();
  await page.locator(".book-menu summary").click(); await page.locator(".book-menu-options").getByRole("button",{name:"Editar libro"}).click();
  await page.locator(".edit-book-title").fill("Título visible"); await page.locator(".edit-book-author").fill("Nueva autora");
  await page.locator(".edit-book-save").click();
  await expect(page.locator(".library-book-card .book-title")).toHaveText("Título visible");
  expect(await stored()).toEqual(before);
  expect(cloud.uploads).toBe(0);
});
