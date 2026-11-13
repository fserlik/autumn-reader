import { test, expect } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";
import { samplePdf } from "./helpers/pdf";
import { selectReaderOption } from "./helpers/reader-options";

for (const format of ["epub", "pdf", "pdf-original"] as const) test(`${format}: manual phone drag follows while held and completes on release`, async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Manual touch paging");
  await page.setViewportSize(format === "pdf-original" ? { width: 844, height: 390 } : { width: 375, height: 844 });
  await mockCloud(page, true);
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: `Manual.${format === "epub" ? "epub" : "pdf"}`, mimeType: format === "epub" ? "application/epub+zip" : "application/pdf", buffer: format === "epub" ? await epubFixture("manual", "Manual") : samplePdf() });
  await expect(page.locator(format === "epub" ? "#reader-content .epub-frame iframe" : ".pdf-reading-text")).toBeVisible();
  if (format === "pdf-original") {
    await selectReaderOption(page, "#pdf-reading-mode", "original");
    await expect(page.locator("#position-label")).not.toContainText("·");
  }
  const savedPosition = () => page.evaluate(() => new Promise<string>(resolve => {
    const open = indexedDB.open("autumn-reader");
    open.onsuccess = () => {
      const db = open.result, read = db.transaction("books").objectStore("books").getAll();
      read.onsuccess = () => { const b = read.result[0]; resolve(JSON.stringify([b.cfi, b.page, b.pdfTextOffset])); db.close(); };
    };
  }));
  const origin = await savedPosition();
  const originLabel = await page.locator("#position-label").innerText();
  if (format === "epub") {
    await expect(page.locator('.epub-adjacent-page[data-ready="true"]')).toHaveCount(2);
    await page.locator('.epub-adjacent-page[data-direction="1"] iframe').evaluate(el => el.setAttribute("data-prepared-page", "next"));
  }
  const rect = (await page.locator("#reading-surface").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = rect.y + rect.height * .5, x = rect.x + rect.width * .78;
  const drag = async (distance: number) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const fraction of [.15, .4, .7, 1]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + distance * fraction, y }] });
  };
  const sheet = page.locator("#reader-content");
  const displacement = () => sheet.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41);
  await drag(-100);
  await expect.poll(displacement).toBeCloseTo(-100, 0);
  expect(await savedPosition()).toBe(origin);
  expect(await page.locator("#position-label").innerText()).toBe(originLabel);
  await expect(page.locator(".page-turn-preview[data-ready], .page-turn-snapshot[data-ready]")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("manual-mid-drag.png") });
  await page.waitForTimeout(1800); // Holding still must never trigger the idle turn.
  await expect.poll(displacement).toBeCloseTo(-100, 0);
  // Returning below the distance threshold cancels, even after a long drag.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 20, y }] });
  await expect.poll(displacement).toBeCloseTo(-20, 0);
  expect(await savedPosition()).toBe(origin);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator(".page-turn-preview, .page-turn-snapshot, .manual-page-hit-area")).toHaveCount(0);
  expect(await savedPosition()).toBe(origin);
  if (format === "epub") await expect(page.locator('.epub-adjacent-page[data-direction="1"][data-ready="true"]')).toHaveCount(1);
  await drag(-rect.width*.3);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator(".page-turn-preview, .page-turn-snapshot")).toHaveCount(0);
  await expect(page.locator("#next-button")).toBeEnabled();
  await expect.poll(savedPosition).not.toBe(origin);
  await page.screenshot({ path: info.outputPath("manual-after-release.png") });
  // Reverse direction is also direct, and cancellation restores the committed
  // page rather than saving the partially revealed page behind it.
  const committed = await savedPosition();
  const left = rect.x + rect.width * .25;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: left, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: left + 40, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: left + rect.width*.3, y }] });
  await expect.poll(displacement).toBeCloseTo(rect.width*.3, 0);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(page.locator(".page-turn-preview, .page-turn-snapshot")).toHaveCount(0);
  expect(await savedPosition()).toBe(committed);
  // A normal release in the reverse direction completes the previous page.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: left, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: left + 40, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: left + rect.width*.3, y }] });
  await expect.poll(displacement).toBeCloseTo(rect.width*.3, 0);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator(".page-turn-preview, .page-turn-snapshot")).toHaveCount(0);
  await expect.poll(savedPosition).not.toBe(committed);
  if (format === "epub") {
    // Repeated forward/back turns must reveal real, already-rendered text and
    // preserve that exact iframe through release (no second display/render).
    for (let i = 0; i < 3; i++) for (const direction of [1, -1]) {
      const cached = page.locator(`.epub-adjacent-page[data-direction="${direction}"][data-ready="true"]`);
      await expect(cached).toHaveCount(1);
      const marker = `prepared-${i}-${direction}`;
      await cached.locator("iframe").evaluate((el, id) => el.setAttribute("data-prepared-page", id), marker);
      const from = direction === 1 ? x : left;
      await cdp.send("Input.dispatchTouchEvent", {type:"touchStart",touchPoints:[{x:from,y}]});
      await cdp.send("Input.dispatchTouchEvent", {type:"touchMove",touchPoints:[{x:from-direction*40,y}]});
      await cdp.send("Input.dispatchTouchEvent", {type:"touchMove",touchPoints:[{x:from-direction*rect.width*.3,y}]});
      await expect(page.locator(".page-turn-preview")).toBeVisible();
      expect(await page.locator(".page-turn-preview iframe").evaluate(el => (el as HTMLIFrameElement).contentDocument?.body.textContent?.trim().length)).toBeGreaterThan(20);
      await cdp.send("Input.dispatchTouchEvent", {type:"touchEnd",touchPoints:[]});
      await expect(page.locator(".page-turn-preview")).toHaveCount(0);
      await expect(page.locator("#reader-content iframe")).toHaveAttribute("data-prepared-page", marker);
    }
    const beforeResize = await savedPosition();
    await drag(-rect.width*.3);
    await page.setViewportSize({width:844,height:390});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});
    await expect(page.locator(".page-turn-preview, .page-turn-snapshot")).toHaveCount(0);
    expect(await savedPosition()).toBe(beforeResize);
    await page.locator("#next-button").click();
    await expect.poll(savedPosition).not.toBe(beforeResize);
  }
});
