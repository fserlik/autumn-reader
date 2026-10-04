import { test, expect } from "@playwright/test";
import { mockCloud, login, epubFixture, multiChapterFixture } from "./helpers/cloud";
import { samplePdf } from "./helpers/pdf";
import { selectReaderOption } from "./helpers/reader-options";

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
        animated: current.getAnimations().length > 0,
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
