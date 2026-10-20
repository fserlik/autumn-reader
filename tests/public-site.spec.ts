import { expect, test } from "@playwright/test";

test("public site presents current features and plans without horizontal overflow", async ({ page }, testInfo) => {
  await page.goto("/docs/");

  await expect(page).toHaveTitle(/Autumn Reader/);
  await expect(page.locator("#planes .plan-entry")).toHaveCount(3);
  await expect(page.locator("#planes")).toContainText("US$5.99");
  await expect(page.locator("#planes")).toContainText("US$119.99");
  const statisticsImage = page.locator('img[src$="reading-statistics.png"]');
  await statisticsImage.scrollIntoViewIfNeeded();
  await expect.poll(() => statisticsImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: testInfo.outputPath("public-site.png"), fullPage: true });
});
