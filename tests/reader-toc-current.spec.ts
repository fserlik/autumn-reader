import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";
import { login, mockCloud, multiChapterFixture } from "./helpers/cloud";

async function openEpub(page: Page, fixture?: Buffer): Promise<void> {
  await mockCloud(page, true);
  await page.goto("/");
  await login(page);
  await page.locator("#file-input").setInputFiles({
    name: "Two chapters.epub",
    mimeType: "application/epub+zip",
    buffer: fixture ?? await multiChapterFixture(),
  });
  await expect(page.locator("#reader-content .epub-frame iframe")).toBeVisible();
}

async function fragmentedChapterFixture(): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await multiChapterFixture());
  const chapter = await zip.file("OEBPS/chapter2.xhtml")!.async("string");
  zip.file("OEBPS/chapter2.xhtml", chapter.replace("<p>Second paragraph 20", '<p id="late-section">Second paragraph 20'));
  zip.file("OEBPS/nav.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Navigation</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">First chapter</a></li><li><a href="chapter2.xhtml">Second chapter</a></li><li><a href="chapter2.xhtml#late-section">Late section</a></li></ol></nav></body></html>');
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

async function chooseEntry(page: Page, project: string, index: number, value: string): Promise<void> {
  if (project === "desktop") await page.locator("#reader-toc-list .reader-toc-entry").nth(index).click();
  else await page.locator("#reader-toc").selectOption(value);
}

test("table of contents follows the current EPUB chapter", async ({ page }, info) => {
  await openEpub(page);
  const entries = page.locator("#reader-toc-list .reader-toc-entry");
  await expect(entries).toHaveCount(2);

  await expect(entries.nth(0)).toHaveAttribute("aria-current", "location");
  await expect(entries.nth(1)).not.toHaveAttribute("aria-current", "location");
  await expect(page.locator("#reader-toc")).toHaveValue("chapter.xhtml");

  await chooseEntry(page, info.project.name, 1, "chapter2.xhtml");

  await expect(entries.nth(1)).toHaveAttribute("aria-current", "location");
  await expect(entries.nth(0)).not.toHaveAttribute("aria-current", "location");
  await expect(page.locator("#reader-toc")).toHaveValue("chapter2.xhtml");

  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: info.outputPath(`current-chapter-toc-${info.project.name}-dark.png`) });

  if (info.project.name === "desktop") {
    await entries.nth(0).click();
    await expect(entries.nth(0)).toHaveAttribute("aria-current", "location");
  }
});

test("table of contents follows anchors within the same EPUB chapter", async ({ page }, info) => {
  await openEpub(page, await fragmentedChapterFixture());
  const entries = page.locator("#reader-toc-list .reader-toc-entry");
  await expect(entries).toHaveCount(3);

  await chooseEntry(page, info.project.name, 1, "chapter2.xhtml");
  await expect(entries.nth(1)).toHaveAttribute("aria-current", "location");

  await chooseEntry(page, info.project.name, 2, "chapter2.xhtml#late-section");
  await expect(entries.nth(2)).toHaveAttribute("aria-current", "location");
  await expect(entries.nth(1)).not.toHaveAttribute("aria-current", "location");
  await expect(page.locator("#reader-toc")).toHaveValue("chapter2.xhtml#late-section");
});
