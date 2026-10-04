import { test, expect } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem("autumn-language", "es")); });

test("picker rejects identical bytes despite renamed files, but accepts the same name with different bytes", async ({ page }) => {
  const cloud = await mockCloud(page, true);
  await page.goto("/"); await login(page);
  const original = await epubFixture("original");
  await page.locator("#file-input").setInputFiles({ name: "Dune.epub", mimeType: "", buffer: original });
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await page.locator("#file-input").setInputFiles({ name: "Dune-copia.epub", mimeType: "application/octet-stream", buffer: original });
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(1);
  await expect(page.locator("#toast")).toContainText("Este libro ya está en tu biblioteca");
  await page.evaluate(encoded => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "android-content-uri-renamed.epub", {type:"application/octet-stream"}));
    document.querySelector("#view-library")!.dispatchEvent(new DragEvent("drop", {bubbles:true,cancelable:true,dataTransfer:transfer}));
  }, original.toString("base64"));
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(1);
  await page.locator("#file-input").setInputFiles({ name: "Dune.epub", mimeType: "application/epub+zip", buffer: await epubFixture("different-edition") });
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(2);
  expect(cloud.uploads).toBe(0);
});

test("a downloaded cloud book rejects the same manually selected bytes", async ({ page }) => {
  const cloud = await mockCloud(page); await page.goto("/"); await login(page);
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  expect(cloud.downloads).toBe(1);
  await page.locator("#file-input").setInputFiles({name:"another-name.epub",mimeType:"",buffer:cloud.fixtureBytes});
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(1);
  expect(cloud.downloads).toBe(1);
  expect(cloud.uploads).toBe(0);
});

test("batch import keeps seven new books and omits three repeated binary files", async ({ page }) => {
  await mockCloud(page, true); await page.goto("/"); await login(page);
  const repeated = await epubFixture("repeat");
  await page.locator("#file-input").setInputFiles({name:"Already.epub",mimeType:"",buffer:repeated});
  await expect(page.locator(".epub-frame iframe")).toBeVisible(); await page.locator("#back-button").click();
  const files = [1, 2, 3].map(i => ({ name: `Repeat-${i}.epub`, mimeType: "", buffer: repeated }));
  files.push(...await Promise.all(Array.from({ length: 7 }, async (_, i) => ({ name: `Unique-${i}.epub`, mimeType: "", buffer: await epubFixture(`unique-${i}`) }))));
  await page.locator("#file-input").setInputFiles(files);
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(8);
  await expect(page.locator("#toast")).toContainText("7 libros importados. 3 ya estaban");
});

test("four local plus five cloud with two matching hashes reconcile to seven without downloading A or B", async ({ page }) => {
  const cloud = await mockCloud(page);
  cloud.setCloudVisible(false);
  await page.goto("/"); await login(page);
  const names = ["A", "B", "C", "D"];
  const data = await Promise.all(names.map((name, i) => i === 0 ? cloud.fixtureBytes : epubFixture(name)));
  await page.locator("#file-input").setInputFiles(names.map((name, i) => ({ name: `${name}.epub`, mimeType: "", buffer: data[i] })));
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await cloud.addCloudBook("11111111-1111-4111-8111-111111111111", "B", data[1]);
  for (const [i, name] of ["E", "F", "G"].entries())
    await cloud.addCloudBook(`22222222-2222-4222-8222-22222222222${i}`, name, await epubFixture(name));
  cloud.setCloudVisible(true);
  await page.reload(); await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list .library-book-card")).toHaveCount(7);
  await expect.poll(() => cloud.downloads).toBe(3);
  expect(cloud.downloadedBookIds).toEqual(expect.arrayContaining([
    "22222222-2222-4222-8222-222222222220",
    "22222222-2222-4222-8222-222222222221",
    "22222222-2222-4222-8222-222222222222",
  ]));
  expect(cloud.downloadedBookIds).not.toContain("cccccccc-cccc-4ccc-cccc-cccccccccccc");
  expect(cloud.downloadedBookIds).not.toContain("11111111-1111-4111-8111-111111111111");
  expect(cloud.uploads).toBe(0);
  await expect(page.locator("#library-list .cloud-badge.state-cloud")).toHaveCount(5);
  await expect(page.locator("#library-list .cloud-badge.state-local")).toHaveCount(2);
  const records = await page.evaluate(() => new Promise<Array<{name:string;cloudId?:string;fileHash?:string}>>((resolve,reject) => {
    const open = indexedDB.open("autumn-reader");
    open.onsuccess = () => { const db = open.result, tx = db.transaction("books", "readonly"), read = tx.objectStore("books").getAll();
      read.onsuccess = () => resolve(read.result.map(({name,cloudId,fileHash}) => ({name,cloudId,fileHash})));
      tx.oncomplete = () => db.close(); };
    open.onerror = () => reject(open.error);
  }));
  expect(records.some(record => record.cloudId && record.fileHash && record.name.startsWith("Cloud EPUB"))).toBe(true);
});
