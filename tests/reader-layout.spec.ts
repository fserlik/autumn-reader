import { test, expect, type Page } from "@playwright/test";
import { mockCloud, login, epubFixture } from "./helpers/cloud";
import { samplePdf } from "./helpers/pdf";

async function saved(page: Page): Promise<{ cfi: string; percentage: number; page: number }> {
  return page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open("autumn-reader");
    request.onsuccess = () => {
      const db = request.result, all = db.transaction("books").objectStore("books").getAll();
      all.onsuccess = () => resolve(all.result[0]);
    };
  }));
}
async function openEpub(page: Page): Promise<void> {
  await mockCloud(page, true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Layout.epub", mimeType: "application/epub+zip", buffer: await epubFixture() });
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
}

async function showReaderSettings(page: Page, tab: "layout" | "appearance"): Promise<void> {
  const desktopMenu = page.locator("#reader-settings-toggle");
  if (await page.locator("#reader-sidebar").isVisible()) {
    if (!(await page.locator("#reader-options").isVisible())) await desktopMenu.click();
    await page.locator(tab === "layout" ? "#reader-settings-layout-tab" : "#reader-settings-appearance-tab").click();
    return;
  }
  await page.locator(tab === "layout" ? "#layout-toggle" : "#size-toggle").click();
}

test("desktop reader has an immersive sidebar and book settings", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Desktop reader composition");
  await openEpub(page);
  await expect(page.locator(".shell > .sidebar")).toBeHidden();
  await expect(page.locator(".workspace > .topbar")).toBeHidden();
  await expect(page.locator("#reader-sidebar")).toBeVisible();
  await expect(page.locator("#reader-book-title")).toHaveText("Cloud EPUB");
  await expect(page.locator("#reader-contents-tab")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#reader-toc-list .reader-toc-entry")).toHaveCount(1);
  const readingWidth = await page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>("#reading-surface")!.getBoundingClientRect();
    const frame = document.querySelector<HTMLElement>(".epub-frame")!.getBoundingClientRect();
    return { surface: surface.width, frame: frame.width };
  });
  expect(readingWidth.surface - readingWidth.frame).toBeLessThanOrEqual(50);
  await page.locator("#reader-notes-tab").click();
  await expect(page.locator("#reader-sidebar-notes-list")).toContainText(/notes|notas/i);
  await page.locator("#reader-settings-toggle").click();
  await expect(page.locator("#reader-settings-appearance-tab")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#reader-brightness")).toBeVisible();
  await page.locator('[data-book-theme="sepia"]').click();
  await expect(page.locator("#view-reader")).toHaveAttribute("data-book-theme", "sepia");
  await page.screenshot({ path: info.outputPath("desktop-reader-appearance.png") });
  await page.locator("#reader-settings-layout-tab").click();
  await expect(page.locator("#book-layout-details")).toBeVisible();
  const search = (await page.locator("#book-search-button").boundingBox())!;
  const settings = (await page.locator("#reader-settings-toggle").boundingBox())!;
  expect(search.x).toBeLessThan(settings.x);
  await page.screenshot({ path: info.outputPath("desktop-reader-settings.png") });
});

test("disabling global book settings keeps the current reader layout", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Desktop per-book settings regression");
  await page.setViewportSize({ width: 1920, height: 951 });
  await openEpub(page);
  const layout = () => page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>(".epub-frame")!.getBoundingClientRect();
    const body = document.querySelector<HTMLIFrameElement>(".epub-frame iframe")!.contentDocument!.body;
    const style = getComputedStyle(body);
    return {
      frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      margin: getComputedStyle(document.querySelector<HTMLElement>("#reader-content")!).getPropertyValue("--reader-margin").trim(),
      typography: {
        fontFamily: style.fontFamily,
        lineHeight: style.lineHeight,
        paragraphSpacing: getComputedStyle(body.querySelector("p")!).marginBlockEnd,
        wordSpacing: style.wordSpacing,
        letterSpacing: style.letterSpacing,
      },
      pages: document.querySelector("#position-label")!.textContent,
    };
  });
  const before = await layout();
  await showReaderSettings(page, "layout");
  for (const key of ["font", "lineHeight", "paragraphSpacing", "wordSpacing", "letterSpacing", "textIndent", "columns", "margins"]) {
    await page.locator(`#book-layout-fields [data-layout-key="${key}"] input[type="checkbox"]`).uncheck();
  }
  await page.waitForTimeout(800);
  expect(await layout()).toEqual(before);
  await page.screenshot({ path: info.outputPath("reader-after-local-overrides.png") });
});

test("custom book typography repaginates inside the paper content box", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Desktop EPUB geometry regression");
  await page.setViewportSize({ width: 1920, height: 951 });
  await openEpub(page);
  const geometry = () => page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>(".epub-frame")!;
    const stage = frame.querySelector<HTMLElement>(".epub-container")!;
    const style = getComputedStyle(frame);
    return {
      frame: frame.getBoundingClientRect().toJSON(),
      contentWidth: frame.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      contentHeight: frame.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      stage: stage.getBoundingClientRect().toJSON(),
    };
  });
  const before = await geometry();
  expect(Math.abs(before.stage.width - before.contentWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.stage.height - before.contentHeight)).toBeLessThanOrEqual(1);
  await showReaderSettings(page, "appearance");
  await page.locator('[data-book-theme="dark"]').click();
  await page.locator("#reader-settings-layout-tab").click();
  const lineHeight = page.locator('#book-layout-fields [data-layout-key="lineHeight"]');
  await lineHeight.locator('input[type="checkbox"]').uncheck();
  await lineHeight.locator('input[type="range"]').fill("2.1");
  await page.waitForTimeout(800);
  const after = await geometry();
  expect(after.frame).toEqual(before.frame);
  expect(Math.abs(after.stage.width - after.contentWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.stage.height - after.contentHeight)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("reader-after-custom-typography.png") });
});

test("portrait and landscape retain the EPUB anchor and use the reader viewport", async ({ page }, info) => {
  await openEpub(page);
  const start = (await saved(page)).cfi;
  await page.locator("#next-button").click();
  await expect.poll(async () => (await saved(page)).cfi).not.toBe(start);
  const anchor = await saved(page);
  const sizes = info.project.name === "android" ? [[390, 844], [844, 390], [800, 1280], [1280, 800], [390, 844]]
    : [[620, 540], [900, 650], [1200, 800]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => page.locator(".epub-frame iframe").count()).toBeGreaterThan(0);
    const state = await page.evaluate(() => {
      const frame = document.querySelector(".epub-frame")!.getBoundingClientRect();
      const surface = document.querySelector("#reading-surface")!.getBoundingClientRect();
      const footer = document.querySelector(".reader-bottom")!.getBoundingClientRect();
      return { frameWidth: frame.width, frameHeight: frame.height, surfaceHeight: surface.height,
        footerBottom: footer.bottom,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        sidebar: getComputedStyle(document.querySelector(".sidebar")!).display };
    });
    if (info.project.name === "android") expect(state.sidebar).toBe("none");
    expect(state.overflow).toBe(false);
    expect(state.frameWidth).toBeGreaterThan(200); expect(state.frameHeight).toBeGreaterThan(100);
    expect(state.surfaceHeight).toBeGreaterThan(150);
    expect(state.footerBottom).toBeLessThanOrEqual(height + 1);
    await expect.poll(async () => Math.abs((await saved(page)).percentage - anchor.percentage)).toBeLessThan(.08);
    await expect.poll(async () => (await saved(page)).cfi).toBe(anchor.cfi);
    if (width > height && info.project.name === "android") {
      await page.locator("#layout-toggle").click();
      const menu = (await page.locator("#reader-options").boundingBox())!;
      expect(menu.x + menu.width).toBeLessThanOrEqual(width + 1);
      expect(menu.y + menu.height).toBeLessThanOrEqual(height + 1);
      await page.locator("#layout-toggle").click();
    }
    await page.screenshot({ path: info.outputPath(`reader-${width}x${height}.png`) });
  }
});

test("mobile EPUB typography stays fixed between page turns", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Android WebView typography");
  await openEpub(page);
  const typography = () => page.frameLocator(".epub-frame iframe").locator("body").evaluate(element => {
    const body = getComputedStyle(element);
    const root = getComputedStyle(element.ownerDocument.documentElement);
    return { fontSize: body.fontSize, bodyAdjust: body.webkitTextSizeAdjust, rootAdjust: root.webkitTextSizeAdjust };
  });
  const before = await typography();
  expect(before.bodyAdjust).toBe("100%");
  expect(before.rootAdjust).toBe("100%");
  await page.locator("#next-button").click();
  await expect.poll(typography).toEqual(before);
});

test("global typography and per-book overrides repaginate without returning to the start", async ({ page }) => {
  await openEpub(page);
  const start = (await saved(page)).cfi;
  await page.locator("#next-button").click();
  await expect.poll(async () => (await saved(page)).cfi).not.toBe(start);
  const anchor = await saved(page);
  await showReaderSettings(page, "layout");
  const line = page.locator('#book-layout-fields [data-layout-key="lineHeight"]');
  await line.locator('input[type="checkbox"]').uncheck();
  await line.locator('input[type="range"]').fill("2.1");
  await page.locator('#book-layout-fields [data-layout-key="wordSpacing"] input[type="checkbox"]').uncheck();
  await page.locator('#book-layout-fields [data-layout-key="wordSpacing"] input[type="range"]').fill("0.2");
  await page.locator('#book-layout-fields [data-layout-key="letterSpacing"] input[type="checkbox"]').uncheck();
  await page.locator('#book-layout-fields [data-layout-key="letterSpacing"] input[type="range"]').fill("0.05");
  await page.locator('#book-layout-fields [data-layout-key="textIndent"] input[type="checkbox"]').uncheck();
  await page.locator('#book-layout-fields [data-layout-key="textIndent"] select').selectOption("none");
  await page.locator('#book-layout-fields [data-layout-key="columns"] input[type="checkbox"]').uncheck();
  await page.locator('#book-layout-fields [data-layout-key="columns"] select').selectOption("two");
  await page.locator('#book-layout-fields [data-layout-key="margins"] input[type="checkbox"]').uncheck();
  await page.locator('#book-layout-fields [data-layout-key="margins"] select').selectOption("compact");
  await expect.poll(async () => page.frameLocator(".epub-frame iframe").locator("p").first().evaluate(element => {
    const style = getComputedStyle(element); return { word: style.wordSpacing, letter: style.letterSpacing, indent: style.textIndent };
  })).toMatchObject({ indent: "0px" });
  const after = await saved(page);
  expect(Math.abs(after.percentage - anchor.percentage)).toBeLessThan(.08);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>(".epub-frame")!;
    const stage = frame.querySelector<HTMLElement>(".epub-container")!;
    const style = getComputedStyle(frame);
    const width = frame.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = frame.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const bounds = stage.getBoundingClientRect();
    return { width: Math.abs(bounds.width - width) <= 1, height: Math.abs(bounds.height - height) <= 1 };
  })).toEqual({ width: true, height: true });
  const columnWidth = await page.frameLocator(".epub-frame iframe").locator("body").evaluate(element => parseFloat(getComputedStyle(element).columnWidth));
  const viewportWidth = (await page.locator(".epub-frame iframe").boundingBox())!.width;
  expect(columnWidth * 2).toBeLessThanOrEqual(viewportWidth + 2);
  await expect.poll(async () => (await saved(page)).percentage).toBeGreaterThan(0);
  expect(Math.abs((await saved(page)).percentage - anchor.percentage)).toBeLessThan(.08);
  await line.locator('input[type="checkbox"]').check();
  expect(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.startsWith("autumn-book-page:") && value.includes('"columns":"two"')))).toBe(true);
});

test("PDF original exposes zoom but hides typography, with real page progress", async ({ page }) => {
  await mockCloud(page, true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Pages.pdf", mimeType: "application/pdf", buffer: samplePdf() });
  await expect(page.locator(".pdf-reading-text")).toBeVisible();
  await showReaderSettings(page, "layout");
  await page.locator("#pdf-reading-mode").selectOption("original");
  await expect(page.locator(".pdf-page")).toBeVisible();
  await expect(page.locator("#book-layout-details")).toBeHidden();
  await expect(page.locator("#size-label")).toHaveText(/Zoom/i);
  const before = await page.locator(".pdf-page").boundingBox();
  await showReaderSettings(page, "appearance");
  await page.locator("#larger-button").click();
  await expect.poll(async () => (await page.locator(".pdf-page").boundingBox())?.width ?? 0).toBeGreaterThan(before!.width);
  await page.locator("#next-button").click();
  await expect(page.locator("#position-label")).toContainText("2");
});

test("PDF retains its real page across portrait and landscape", async ({ page }, info) => {
  await mockCloud(page, true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Rotate.pdf", mimeType: "application/pdf", buffer: samplePdf() });
  await expect(page.locator(".pdf-reading-text")).toBeVisible();
  await showReaderSettings(page, "layout");
  await page.locator("#pdf-reading-mode").selectOption("original");
  await expect(page.locator(".pdf-page")).toBeVisible();
  await page.locator("#next-button").click();
  await expect.poll(async () => (await saved(page)).page).toBe(2);
  for (const [width, height] of (info.project.name === "android" ? [[390, 844], [844, 390], [800, 1280], [1280, 800]] : [[620, 540], [900, 650], [1200, 800]])) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => (await saved(page)).page).toBe(2);
    await expect(page.locator(".pdf-page")).toBeVisible();
    const state = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      footerBottom: document.querySelector(".reader-bottom")!.getBoundingClientRect().bottom,
    }));
    expect(state.overflow).toBe(false);
    expect(state.footerBottom).toBeLessThanOrEqual(height + 1);
  }
});

test("mobile bars hide when idle and a neutral page tap reveals them", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Touch reader chrome");
  await openEpub(page);
  const anchor = (await saved(page)).cfi;
  const surface = page.locator("#reading-surface");
  const heightBefore = await surface.evaluate(element => element.getBoundingClientRect().height);
  await expect(page.locator(".reader-toolbar")).toBeHidden({ timeout: 10000 });
  await expect(page.locator(".reader-bottom")).toBeHidden();
  expect(await surface.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(heightBefore);
  const rect = (await surface.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator(".reader-toolbar")).toBeVisible();
  await expect(page.locator(".reader-bottom")).toBeVisible();
  await expect.poll(async () => (await saved(page)).cfi).toBe(anchor);
});

test("mobile swipe prepares the page while the finger is moving and commits only on release", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Touch gesture");
  await openEpub(page);
  const before = (await saved(page)).cfi;
  const rect = (await page.locator("#reading-surface").boundingBox())!;
  const x = rect.x + rect.width * .7, y = rect.y + rect.height * .5;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 20, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 120, y }] });
  await expect(page.locator(".page-turn-preview")).toHaveCount(1);
  expect((await saved(page)).cfi).toBe(before);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await saved(page)).cfi).not.toBe(before);
  const turned = (await saved(page)).cfi;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 80, y }] });
  await expect(page.locator(".page-turn-preview")).toHaveCount(1);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(page.locator(".page-turn-preview, .page-turn-snapshot")).toHaveCount(0);
  await expect(page.locator("#next-button")).toBeEnabled();
  expect((await saved(page)).cfi).toBe(turned);
});

for (const format of ["epub", "pdf"] as const) test(`${format} selection can copy and query the dictionary`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("autumn-language", "es"));
  await mockCloud(page, true);
  await page.route("https://es.wiktionary.org/w/api.php**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ parse: { text: { "*": '<div class="mw-parser-output"><div class="mw-heading mw-heading2"><h2><span id="en">Inglés</span></h2></div><div class="mw-heading"><h4>Sustantivo</h4></div><dl><dt>1</dt><dd>Una definición de prueba.</dd><dt>2</dt><dd>Otro significado.</dd></dl></div>' } } }),
  }));
  await page.route("https://es.wikipedia.org/api/rest_v1/page/summary/**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ extract: "Un resumen enciclopédico en español.", content_urls: { desktop: { page: "https://es.wikipedia.org/wiki/Pressure" } } }),
  }));
  await page.goto("/"); await login(page);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (value: string) => { (window as Window & { copied?: string }).copied = value; },
  } }));
  await page.locator("#file-input").setInputFiles(format === "pdf"
    ? { name: "Copy.pdf", mimeType: "application/pdf", buffer: samplePdf() }
    : { name: "Copy.epub", mimeType: "application/epub+zip", buffer: await epubFixture() });
  if (format === "pdf") await expect(page.locator(".pdf-reading-text")).toBeVisible();
  else await expect(page.locator(".epub-frame iframe")).toBeVisible();
  const select = (element: Element) => {
    const node = element.querySelector("span")?.firstChild ?? element.firstChild;
    const range = document.createRange(); range.selectNodeContents(node!);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));
  };
  const target = format === "pdf" ? page.locator(".pdf-reading-text p").first() : page.frameLocator(".epub-frame iframe").locator("p").first();
  await target.evaluate(select);
  await expect(page.locator("#note-menu")).toBeVisible();
  await page.locator("#selection-copy").click();
  await expect.poll(() => page.evaluate(() => (window as Window & { copied?: string }).copied)).toBeTruthy();
  await target.evaluate(select);
  await page.locator("#selection-dictionary").click();
  await expect(page.locator("#dictionary-language")).toHaveText("Definición en Español");
  await expect(page.locator("#dictionary-content")).toContainText("Una definición de prueba.");
  await expect(page.locator("#dictionary-content")).toContainText("Otro significado.");
  await expect(page.locator("#dictionary-content")).toContainText("Sustantivo");
  await expect(page.locator("#dictionary-wordreference")).toHaveAttribute("href", /enes/);
  await page.locator("#dictionary-source").selectOption("wikipedia");
  await expect(page.locator("#dictionary-content")).toContainText("Un resumen enciclopédico en español.");
  await page.context().setOffline(true);
  await target.evaluate(select);
  await page.locator("#selection-dictionary").click();
  await expect(page.locator("#dictionary-content")).toContainText(/internet/i);
});

test("original PDF text layer offers Copy for selectable text", async ({ page }) => {
  await mockCloud(page, true); await page.goto("/"); await login(page);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (value: string) => { (window as Window & { copied?: string }).copied = value; },
  } }));
  await page.locator("#file-input").setInputFiles({ name: "TextLayer.pdf", mimeType: "application/pdf", buffer: samplePdf() });
  await expect(page.locator(".pdf-reading-text")).toBeVisible();
  await showReaderSettings(page, "layout");
  await page.locator("#pdf-reading-mode").selectOption("original");
  const span = page.locator(".pdf-text-layer span").first();
  await expect(span).toBeVisible();
  await span.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));
  });
  await expect(page.locator("#selection-copy")).toBeVisible();
  await page.locator("#selection-copy").click();
  await expect.poll(() => page.evaluate(() => (window as Window & { copied?: string }).copied)).toBeTruthy();
});
