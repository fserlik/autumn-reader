import { test, expect } from "@playwright/test";
import { mockCloud, login, epubFixture, multiChapterFixture } from "./helpers/cloud";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("autumn-language", "es");
    localStorage.setItem("autumn-theme", "dark");
  });
});

test("auth shares Android top inset and theme tokens across its modes", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Android-sized edge-to-edge viewport");
  await mockCloud(page, true);
  await page.goto("/");
  const brand = page.locator(".auth-brand");
  const heading = page.locator("#auth-heading");
  await expect(brand).toBeVisible();
  const check = async () => {
    const styles = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const auth = document.querySelector<HTMLElement>(".auth-entry")!;
      const label = document.querySelector<HTMLElement>("#account-form label:not([hidden])")!;
      return { top: document.querySelector(".auth-brand")!.getBoundingClientRect().top,
        ink: root.getPropertyValue("--ink").trim(), heading: getComputedStyle(document.querySelector("#auth-heading")!).color,
        label: getComputedStyle(label).color, background: getComputedStyle(auth).backgroundColor };
    });
    expect(styles.top).toBeGreaterThanOrEqual(50);
    expect(styles.heading).toBe(styles.label);
    expect(styles.background).not.toBe(styles.heading);
  };
  await check();
  await page.locator("#auth-register-tab").click(); await expect(heading).toContainText("cuenta"); await check();
  await page.locator("#auth-login-tab").click(); await page.locator("#auth-recover").click(); await expect(heading).toContainText("contraseña"); await check();
  await page.locator("#auth-back").click();
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await expect(heading).toBeVisible();
  expect(await page.locator(".auth-brand").evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(50);
});

test("mobile reader dedicates the top bar to tools and the bottom bar to navigation", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Mobile toolbar");
  const cloud = await mockCloud(page, true); cloud.setPlan("plus"); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Mobile.epub", mimeType: "application/epub+zip", buffer: await multiChapterFixture() });
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  const toolbar = page.locator(".reader-toolbar");
  expect(await toolbar.evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(60);
  await expect(page.locator("#next-button")).toBeVisible();
  await expect(page.locator("#brightness-toggle")).toBeVisible();
  await expect(page.locator("#size-toggle")).toBeVisible();
  await expect(page.locator("#layout-toggle")).toBeVisible();
  await expect(page.locator("#speech-toggle")).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator("#all-notes-button")).toBeVisible();
  await expect(page.locator("#book-search-button")).toBeVisible();
  await expect(page.locator("#reader-toc")).toBeVisible();
  expect(await page.locator(".reader-bottom").evaluate(element => innerHeight - element.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(23);
  await page.locator("#size-toggle").click();
  await expect(page.locator("#smaller-button")).toBeVisible();
  await page.locator("#brightness-toggle").click();
  await expect(page.locator("#reader-brightness")).toBeVisible();
  await page.locator("#speech-toggle").click();
  await expect(page.locator("#tts-play-pause")).toBeVisible();
  await expect(page.locator("#tts-rate-reader")).toBeVisible();
  await page.locator("#layout-toggle").click();
  await expect(page.locator("#book-layout-details")).toBeVisible();
  await page.screenshot({ path: info.outputPath("reader-layout-panel.png") });
  await page.goBack();
  await expect(page.locator("#view-reader")).toBeVisible();
  await expect(page.locator("#reader-options")).toBeHidden();
  await page.locator("#brightness-toggle").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#reader-options")).toBeHidden();
  await page.locator("#book-search-button").click();
  await expect(page.locator("#reader-options")).toBeHidden();
  await expect(page.locator("#book-search-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("#next-button").click();
  await expect(page.locator("#view-reader")).toBeVisible();
});

test("mobile note tabs stay outside the reading page while preserving their touch target", async ({ page }, info) => {
  test.skip(info.project.name !== "android", "Mobile note marker geometry");
  await mockCloud(page, true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({ name: "Notes.epub", mimeType: "application/epub+zip", buffer: await epubFixture() });
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.frameLocator(".epub-frame iframe").locator("p").first().evaluate((paragraph) => {
    const range = document.createRange(); range.selectNodeContents(paragraph);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    paragraph.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 120 }));
  });
  await page.locator("#note-add").click();
  await page.locator("#note-text").fill("Nota al margen");
  await page.locator("#note-save").click();
  const markerGeometry = () => page.locator(".note-marker").evaluate((marker) => {
    const tab = getComputedStyle(marker, "::before"), markerRect = marker.getBoundingClientRect();
    const paperRect = document.querySelector(".epub-frame")!.getBoundingClientRect(), visibleWidth = Number.parseFloat(tab.width);
    return { width: markerRect.width, height: markerRect.height, rightGap: innerWidth - markerRect.right,
      paperOverlap: paperRect.right - (markerRect.right - visibleWidth) };
  });
  for (const [width, height] of [[375, 812], [844, 390]] as const) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => (await markerGeometry()).rightGap).toBeLessThanOrEqual(3);
    const geometry = await markerGeometry();
    expect(geometry.width).toBeGreaterThanOrEqual(24);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.paperOverlap).toBeLessThanOrEqual(0);
    await page.screenshot({ path: info.outputPath(`reader-note-tab-${width}x${height}.png`) });
  }
  await page.locator(".note-marker").click();
  await expect(page.locator("#note-text")).toHaveValue("Nota al margen");
});

test("library menus are exclusive and close on outside press or Escape", async ({ page }, info) => {
  await mockCloud(page, true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles([
    { name: "One.epub", mimeType: "application/epub+zip", buffer: await epubFixture() },
    { name: "Two.epub", mimeType: "application/epub+zip", buffer: await multiChapterFixture() },
  ]);
  await expect(page.locator("#view-reader")).toBeVisible();
  await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="library"]').click();
  await page.locator("#library-list-button").click();
  await page.screenshot({ path: info.outputPath("library-list-responsive.png"), fullPage: true });
  if (info.project.name === "android") {
    for (const [width, height] of [[375, 812], [844, 390]]) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      await page.screenshot({ path: info.outputPath(`library-list-${width}x${height}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  const menus = page.locator("#library-list .book-menu");
  await expect(menus).toHaveCount(2);
  await menus.nth(0).locator("summary").click();
  await expect(menus.nth(0)).toHaveAttribute("open", "");
  await menus.nth(1).locator("summary").click();
  await expect(menus.nth(0)).not.toHaveAttribute("open", "");
  await expect(menus.nth(1)).toHaveAttribute("open", "");
  await expect(menus.nth(1).locator(".book-menu-options")).toContainText("Editar libro");
  await expect(menus.nth(1).locator(".book-menu-options")).toContainText("Reseñar");
  await expect(menus.nth(1).locator(".book-menu-options")).not.toContainText("Reseñas y listas");
  await page.keyboard.press("Escape");
  await expect(menus.nth(1)).not.toHaveAttribute("open", "");
  await menus.nth(0).locator("summary").click();
  await page.locator("#library-search").click();
  await expect(menus.nth(0)).not.toHaveAttribute("open", "");
});

test("settings sections use themed surfaces and logout ends the account panel", async ({ page }, info) => {
  await mockCloud(page, true); await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#settings-page-tab").click();
  await expect(page.locator("#settings-page-panel > .page-settings-panel")).toBeVisible();
  const surfaces = await page.locator("#settings-page-panel > .page-settings-panel").evaluate(el => ({
    card: getComputedStyle(el).backgroundColor,
    page: getComputedStyle(document.querySelector(".settings-view")!).backgroundColor,
  }));
  expect(surfaces.card).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator("#settings-account-panel #account-logout")).toBeHidden();
  await page.locator("#settings-account-tab").click();
  await expect(page.locator("#settings-account-panel #account-logout")).toBeVisible();
  expect(await page.locator("#settings-account-sheet").evaluate(el => el.lastElementChild?.classList.contains("account-settings"))).toBe(true);
  const alignment = await page.locator("#settings-account-panel .account-settings").evaluate(el => getComputedStyle(el).justifyContent);
  expect(alignment).toBe(info.project.name === "desktop" ? "flex-end" : "flex-start");
});
