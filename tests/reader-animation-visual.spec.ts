import { test, expect, type Locator } from "@playwright/test";
import { mockCloud, login, epubFixture, multiChapterFixture } from "./helpers/cloud";
import { samplePdf } from "./helpers/pdf";
import { selectReaderOption } from "./helpers/reader-options";

async function epubDocumentText(frame: Locator): Promise<string> {
  return frame.evaluate((element: HTMLIFrameElement) => {
    const document = element.contentDocument;
    return document?.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
  });
}

// A CSS class alone does not prove that a reader page visibly moves. Sample
// compositor transforms during the turn, including the adjacent rendered page.
for (const mode of ["epub", "pdf-text", "pdf-original"] as const) test(`${mode} page turn has visible intermediate frames`, async ({page}) => {
  const format = mode === "epub" ? "epub" : "pdf";
  await mockCloud(page, true);
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({name:`Frames.${format}`,mimeType:format === "epub" ? "application/epub+zip" : "application/pdf",buffer:format === "epub" ? await epubFixture() : samplePdf()});
  await expect(page.locator(format === "epub" ? ".epub-frame iframe" : ".pdf-reading-text")).toBeVisible();
  if (mode === "pdf-original") await selectReaderOption(page, "#pdf-reading-mode", "original");
  await page.evaluate(() => {
    const samples: { t:number; currentX:number; adjacentX:number; animated:boolean; adjacentVisible:boolean }[] = [];
    (window as Window & { turnSamples?: typeof samples }).turnSamples = samples;
    const started = performance.now();
    const x = (node: HTMLElement) => new DOMMatrix(getComputedStyle(node).transform).m41;
    const sample = () => {
      const current = document.querySelector<HTMLElement>("#reader-content");
      const adjacent = document.querySelector<HTMLElement>(".page-turn-preview") ?? document.querySelector<HTMLElement>(".page-turn-snapshot");
      if (current && adjacent) samples.push({
        t: performance.now() - started, currentX: x(current), adjacentX: x(adjacent),
        animated: current.getAnimations().length > 0 || adjacent.getAnimations().length > 0,
        adjacentVisible: getComputedStyle(adjacent).visibility === "visible",
      });
      if (performance.now() - started < 1200) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.locator("#next-button").click();
  await expect(page.locator(".page-turn-sheet")).toHaveCount(1);
  await expect(page.locator(".page-turn-sheet")).toHaveCount(0);
  const samples = await page.evaluate(() => (window as Window & {turnSamples?: {t:number;currentX:number;adjacentX:number;animated:boolean;adjacentVisible:boolean}[]}).turnSamples ?? []);
  const frames = samples.filter(sample => sample.animated && sample.adjacentVisible);
  expect(frames.length).toBeGreaterThan(8);
  expect(new Set(frames.map(frame => Math.round(frame.adjacentX / 20))).size).toBeGreaterThan(8);
  const first = frames[0], middle = frames[Math.floor(frames.length / 2)], last = frames.at(-1)!;
  const width = await page.locator("#reading-surface").evaluate(node => node.clientWidth);
  expect(Math.abs(middle.adjacentX - first.adjacentX)).toBeGreaterThan(width * .22);
  expect(Math.abs(last.adjacentX - middle.adjacentX)).toBeGreaterThan(width * .22);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(false);
});

test("EPUB turn remains animated when moving into the next chapter", async ({page}) => {
  await mockCloud(page,true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({name:"Chapters.epub",mimeType:"application/epub+zip",buffer:await multiChapterFixture()});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  let crossed = false;
  for (let i=0; i<16; i++) {
    const before = await page.locator("#position-label").textContent();
    await page.locator("#next-button").click();
    await expect(page.locator(".page-turn-sheet")).toHaveCount(1);
    await expect(page.locator(".page-turn-preview")).toHaveAttribute("data-ready","true");
    await expect(page.locator(".page-turn-sheet")).toHaveCount(0);
    const after = await page.locator("#position-label").textContent();
    if (/^Section 1\b/.test(before ?? "") && /^Section 2\b/.test(after ?? "")) { crossed = true; break; }
  }
  expect(crossed).toBe(true);
  await expect(page.frameLocator(".epub-frame iframe").locator("body")).toContainText("Second chapter");
});

test("EPUB turn keeps its current-page cover hidden until typography is stable", async ({page}) => {
  await mockCloud(page,true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({name:"Stable type.epub",mimeType:"application/epub+zip",buffer:await epubFixture()});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.evaluate(() => {
    const testWindow = window as Window & { releasePreviewFonts?: () => void };
    let releaseFonts!: (fonts: FontFaceSet) => void;
    const fontsReady = new Promise<FontFaceSet>(resolve => { releaseFonts = resolve; });
    testWindow.releasePreviewFonts = () => releaseFonts(document.fonts);
    const patchPreviewFrame = (iframe: HTMLIFrameElement) => iframe.addEventListener("load", () => {
      const frameDocument = iframe.contentDocument;
      if (!frameDocument || !iframe.closest(".page-turn-preview")) return;
      Object.defineProperty(frameDocument, "fonts", { configurable: true, value: { ready: fontsReady } });
    });
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (!(node instanceof Element)) return;
      if (node instanceof HTMLIFrameElement) patchPreviewFrame(node);
      node.querySelectorAll<HTMLIFrameElement>("iframe").forEach(patchPreviewFrame);
    }))).observe(document.body, { childList: true, subtree: true });
  });
  await page.locator("#next-button").click();
  const preview = page.locator(".page-turn-preview");
  await expect(preview).toBeAttached();
  await expect(preview).not.toHaveAttribute("data-ready", "true");
  await expect(preview).toHaveCSS("visibility", "hidden");

  await page.evaluate(() => (window as Window & { releasePreviewFonts?: () => void }).releasePreviewFonts?.());
  await expect(preview).toHaveAttribute("data-ready", "true");
  await expect(preview).toHaveCSS("visibility", "visible");
  const typography = await page.locator(".epub-frame iframe").evaluateAll(frames => frames.map(frame => {
    const body = (frame as HTMLIFrameElement).contentDocument!.body;
    const style = getComputedStyle(body);
    return { fontSize: style.fontSize, textSizeAdjust: style.textSizeAdjust };
  }));
  expect(typography).toHaveLength(2);
  expect(new Set(typography.map(value => value.fontSize)).size).toBe(1);
  expect(typography.every(value => value.textSizeAdjust === "100%")).toBe(true);
  await expect(page.locator(".page-turn-sheet")).toHaveCount(0);
});

test("EPUB turn reveals only the settled real destination", async ({page}) => {
  await mockCloud(page,true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({name:"Continuous turn.epub",mimeType:"application/epub+zip",buffer:await multiChapterFixture()});
  const realFrame = page.locator("#reader-content .epub-frame iframe");
  await expect(realFrame).toBeVisible();
  let crossedChapter = false;
  let settledDestination = "";
  for (let turn = 0; turn < 16; turn++) {
    const beforePosition = (await page.locator("#position-label").textContent()) ?? "";
    const beforeDocument = await epubDocumentText(realFrame);
    expect(beforeDocument).not.toBe("");

    await page.locator("#next-button").click();
    const cover = page.locator(".page-turn-preview");
    await expect(cover).toHaveAttribute("data-ready", "true");
    // The animated layer must remain the page/chapter the reader is leaving.
    // A speculative adjacent rendition fails this assertion at a spine edge.
    expect(await epubDocumentText(cover.locator("iframe"))).toBe(beforeDocument);

    await expect(cover).toHaveAttribute("data-destination-ready", "true");
    const hiddenDestinationDocument = await epubDocumentText(realFrame);
    await expect(cover).toHaveClass(/page-turn-sheet/);
    await expect(cover).toHaveCount(0);
    settledDestination = (await page.locator("#position-label").textContent()) ?? "";
    expect(settledDestination).not.toBe(beforePosition);
    if (/^Section 1\b/.test(beforePosition) && /^Section 2\b/.test(settledDestination)) {
      expect(hiddenDestinationDocument).not.toBe(beforeDocument);
      expect(hiddenDestinationDocument).toContain("Second chapter");
      crossedChapter = true;
      break;
    }
  }
  expect(crossedChapter).toBe(true);
  await page.waitForTimeout(900);
  expect(await page.locator("#position-label").textContent()).toBe(settledDestination);
});
