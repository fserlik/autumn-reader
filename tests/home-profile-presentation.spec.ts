import { test, expect } from "@playwright/test";
import { a, bookId, login, mockCloud } from "./helpers/cloud";

test("Home keeps the real reading hero and gallery without import or favorites", async ({ page }, testInfo) => {
  const cloud = await mockCloud(page);
  cloud.setBookState({ favorite: true, status: "reading" });
  cloud.setProgress(.42);
  await page.addInitScript(() => { localStorage.setItem("autumn-language", "es"); localStorage.setItem("autumn-theme", "light"); });
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="home"]').click();
  await expect(page.locator("#import-button")).toBeHidden();
  await expect(page.locator("#hero-title")).toHaveText("Cloud EPUB");
  await expect(page.locator("#hero-author")).toHaveText("Author");
  await expect(page.locator("#hero-progress-value")).toHaveText("42%");
  await expect(page.locator("#hero-art .book-cover")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("#hero-art .book-cover")).not.toHaveCSS("transform", "none");
  await expect(page.locator("#hero-art .book-cover > img")).toHaveCSS("transform", "none");
  await expect(page.locator("#hero-art .book-cover > img")).toHaveCSS("object-fit", "contain");
  await expect(page.locator("#recent-list .presentation-title")).toHaveText("Cloud EPUB");
  await expect(page.locator("#recent-list .presentation-progress")).toContainText("42%");
  await expect(page.locator("#view-home .favorite-grid, #view-home #favorite-list, #view-home .favorites-heading")).toHaveCount(0);
  await expect(page.locator("#view-home .book-status, #view-home .book-cloud-button, #view-home .book-menu, #view-home .favorite-button")).toHaveCount(0);
  expect(cloud.downloads).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("home-light.png"), fullPage: true });
  await page.setViewportSize({ width: 820, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator("#hero-action").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  expect(cloud.downloads).toBe(1);
  await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#import-button")).toBeVisible();
});

test("Continue reading hides its scrollbar but keeps every book reachable", async ({ page }, testInfo) => {
  const cloud = await mockCloud(page);
  cloud.setBookState({ favorite: false, status: "reading" });
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="home"]').click();
  // Extra visual cards exercise overflow without changing the mocked cloud library.
  await page.evaluate(() => {
    const track = document.querySelector<HTMLElement>("#recent-list")!;
    const first = track.firstElementChild!;
    for (let index = 0; index < 12; index++) track.append(first.cloneNode(true));
    window.dispatchEvent(new Event("resize"));
  });
  const track = page.locator("#recent-list");
  const controls = page.locator(".carousel-controls");
  expect(await track.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await track.evaluate(node => getComputedStyle(node).overflowX)).toBe("auto");
  expect(await track.evaluate(node => getComputedStyle(node).scrollbarWidth)).toBe("none");
  expect(await track.evaluate(node => getComputedStyle(node, "::-webkit-scrollbar").display)).toBe("none");
  if (testInfo.project.name === "desktop") {
    await expect(controls).toBeVisible();
    await expect(page.locator("#recent-previous")).toBeDisabled();
    await page.locator("#recent-next").click();
    await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeGreaterThan(50);
    await expect(page.locator("#recent-previous")).toBeEnabled();
    await track.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeGreaterThan(150);
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(controls).toBeHidden();
  } else {
    await expect(controls).toBeHidden();
    await track.scrollIntoViewIfNeeded();
    const box = await track.boundingBox();
    expect(box).not.toBeNull();
    const touch = await page.context().newCDPSession(page);
    const y = box!.y + Math.min(45, box!.height / 2);
    const startX = box!.x + Math.min(270, box!.width - 20);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y }] });
    for (let distance = 35; distance <= 210; distance += 35)
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: startX - distance, y }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeGreaterThan(50);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await track.locator(".presentation-cover").first().click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
});

test("Profile shows identity, statistics, favorites and real reviews only", async ({ page }, testInfo) => {
  const cloud = await mockCloud(page);
  cloud.setBookState({ favorite: true, status: "reading" });
  const stamp = new Date().toISOString();
  cloud.reviewRows.set("eeeeeeee-eeee-4eee-8eee-000000000001", {
    id: "eeeeeeee-eeee-4eee-8eee-000000000001", user_id: a, book_id: bookId,
    rating: 4, text: "A thoughtful story", created_at: stamp, updated_at: stamp,
  });
  await page.addInitScript(() => { localStorage.setItem("autumn-language", "es"); localStorage.setItem("autumn-theme", "dark"); });
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="profile"]').click();
  await expect(page.locator("#profile-total")).toHaveText("1");
  await expect(page.locator("#profile-reading-count")).toHaveText("1");
  await expect(page.locator("#profile-completed-count")).toHaveText("0");
  await expect(page.locator("#profile-favorites-count")).toHaveText("1");
  await expect(page.locator("#profile-favorites .presentation-title")).toHaveText("Cloud EPUB");
  await expect(page.locator("#profile-reading, #profile-finished, #profile-unread, .profile-quote")).toHaveCount(0);
  await expect(page.locator("#profile-review-section h2")).toHaveText("Reseñas");
  await expect(page.locator("#profile-reviews .profile-review")).toContainText("A thoughtful story");
  await expect(page.locator("#profile-reviews .review-score")).toContainText("4/5");
  await expect(page.locator("#view-profile .book-status, #view-profile .book-cloud-button, #view-profile .book-menu, #view-profile .favorite-button")).toHaveCount(0);
  await expect(page.locator("#profile-edit")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("profile-dark.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator("#profile-favorites .presentation-cover").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await page.locator(".profile-view-all").click();
  await expect(page.locator("#library-status-filter")).toHaveValue("favorites");
});

test("Home and Profile show localized empty states without extra shelves", async ({ page }) => {
  await mockCloud(page, true);
  await page.addInitScript(() => localStorage.setItem("autumn-language", "es"));
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="home"]').click();
  await expect(page.locator("#hero-title")).toHaveText("Tu biblioteca espera su primera historia.");
  await expect(page.locator("#recent-list")).toContainText("Los libros que estés leyendo aparecerán aquí.");
  await expect(page.locator("#import-button")).toBeHidden();
  await expect(page.locator("#favorite-list")).toHaveCount(0);
  await page.locator('.nav-button[data-view="profile"]').click();
  await expect(page.locator("#profile-total")).toHaveText("0");
  await expect(page.locator("#profile-favorites")).toContainText("Aún no tienes libros favoritos.");
  await expect(page.locator("#profile-reviews")).toContainText("Aún no hay reseñas.");
  await expect(page.locator("#profile-reading, #profile-finished, #profile-unread")).toHaveCount(0);
});

test("Unread books do not appear in Home reading gallery or Profile favorites", async ({ page }) => {
  await mockCloud(page);
  await page.addInitScript(() => localStorage.setItem("autumn-language", "en"));
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="home"]').click();
  await expect(page.locator("#hero-title")).toHaveText("Your next story is ready when you are.");
  await expect(page.locator("#recent-list .presentation-card")).toHaveCount(0);
  await page.locator('.nav-button[data-view="profile"]').click();
  await expect(page.locator("#profile-reading-count")).toHaveText("0");
  await expect(page.locator("#profile-favorites .presentation-card")).toHaveCount(0);
});
