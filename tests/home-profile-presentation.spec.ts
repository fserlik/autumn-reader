import { test, expect } from "@playwright/test";
import { a, bookId, epubFixture, epubWithCoverFixture, login, mockCloud } from "./helpers/cloud";

test("Home keeps the real reading hero and gallery without import or favorites", async ({ page }, testInfo) => {
  const cloud = await mockCloud(page, false, await epubWithCoverFixture());
  cloud.setBookState({ favorite: true, status: "reading" });
  cloud.setProgress(.42);
  await page.addInitScript(() => { localStorage.setItem("autumn-language", "es"); localStorage.setItem("autumn-theme", "light"); });
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="home"]').click();
  await expect(page.locator("#import-button")).toBeHidden();
  await expect(page.locator("#hero-title")).toHaveText(/Cloud EPUB|La hipótesis del amor/);
  await expect(page.locator("#hero-author")).toHaveText(/Author|Ali Hazelwood/);
  await expect(page.locator("#hero-art .book-cover")).toHaveCSS("overflow", "hidden");
  if (testInfo.project.name === "desktop") await expect(page.locator("#hero-art .book-cover")).not.toHaveCSS("transform", "none");
  await expect(page.locator("#hero-art .book-cover > img")).toHaveCSS("transform", "none");
  await expect(page.locator("#hero-art .book-cover > img")).toHaveCSS("object-fit", "cover");
  await expect(page.locator("#recent-shelf")).toBeHidden();
  await expect(page.locator("#recent-list .presentation-card")).toHaveCount(0);
  if (testInfo.project.name === "android") {
    const [viewportWidth, heroBox, coverBox] = await Promise.all([
      page.evaluate(() => innerWidth),
      page.locator("#home-hero").boundingBox(),
      page.locator("#hero-art .book-cover").boundingBox(),
    ]);
    expect(heroBox).not.toBeNull(); expect(coverBox).not.toBeNull();
    expect(heroBox!.x).toBeLessThanOrEqual(1);
    expect(Math.abs(heroBox!.width - viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(coverBox!.width - heroBox!.width)).toBeLessThanOrEqual(1);
    await expect(page.locator("#hero-art .book-cover")).toHaveCSS("border-top-width", "0px");
    await expect(page.locator("#hero-art .book-cover")).toHaveCSS("transform", "none");
  }
  await expect(page.locator("#view-home .favorite-grid, #view-home #favorite-list, #view-home .favorites-heading")).toHaveCount(0);
  await expect(page.locator("#view-home .book-status, #view-home .book-cloud-button, #view-home .book-menu, #view-home .favorite-button")).toHaveCount(0);
  await expect.poll(() => cloud.downloads).toBe(1);
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
  // Wait for cloud reconciliation and the new background metadata render before
  // injecting extra carousel cards; either render would replace this fixture.
  await expect(page.locator("#library-list .cloud-badge.state-cloud")).toHaveCount(1);
  await expect.poll(() => cloud.downloads).toBe(1);
  await expect.poll(() => page.evaluate(() => new Promise<boolean>(resolve => {
    const open = indexedDB.open("autumn-reader");
    open.onsuccess = () => {
      const db = open.result, read = db.transaction("books").objectStore("books").getAll();
      read.onsuccess = () => { resolve(read.result.some(book => book.contentMetadataVersion === 2)); db.close(); };
    };
  }))).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await page.locator('.nav-button[data-view="home"]').click();
  // Extra visual cards exercise overflow without changing the mocked cloud library.
  await page.evaluate(() => {
    const track = document.querySelector<HTMLElement>("#recent-list")!;
    document.querySelector<HTMLElement>("#recent-shelf")!.hidden = false;
    const sample = document.createElement("article");
    sample.className = "presentation-card";
    sample.innerHTML = '<button class="presentation-cover cover-button" type="button"><span class="book-cover book-cover-fallback"></span></button><button class="presentation-title book-title" type="button">Previous book</button><p class="presentation-author">Author</p>';
    for (let index = 0; index < 13; index++) track.append(sample.cloneNode(true));
    window.dispatchEvent(new Event("resize"));
  });
  const track = page.locator("#recent-list");
  const controls = page.locator(".carousel-controls");
  expect(await track.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  // The first resize can precede layout of cloned cards in WebView2.
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
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
  await page.locator("#hero-action").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
});

test("Home features the latest book once and starts its shelf with the previous read", async ({ page }, testInfo) => {
  await mockCloud(page, true);
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles([
    { name: "First.epub", mimeType: "application/epub+zip", buffer: await epubFixture("first-home", "First read") },
    { name: "Second.epub", mimeType: "application/epub+zip", buffer: await epubFixture("second-home", "Second read") },
    { name: "Third.epub", mimeType: "application/epub+zip", buffer: await epubFixture("third-home", "Latest read") },
  ]);
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  const readerBack = page.locator("#desktop-reader-back:visible, #back-button:visible");
  await readerBack.click();

  await page.locator(".library-book-card", { hasText: "Second read" }).click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await readerBack.click();
  await page.locator(".library-book-card", { hasText: "Latest read" }).click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await readerBack.click();
  await page.locator('.nav-button[data-view="home"]').click();

  await expect(page.locator("#hero-title")).toHaveText("Latest read");
  await expect(page.locator("#recent-shelf")).toBeVisible();
  await expect(page.locator("#recent-list .presentation-title")).toHaveText(["Second read", "First read"]);
  await expect(page.locator("#recent-list .presentation-title", { hasText: "Latest read" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("home-reading-order.png"), fullPage: true });
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
  await expect(page.locator("#view-profile .reading-stats-toggle")).toBeHidden();
  await expect(page.locator("#view-profile > .reading-stats")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("profile-dark.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator("#profile-favorites .presentation-cover").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  await page.locator(".profile-view-all").click();
  await expect(page.locator("#library-status-filter")).toHaveValue("favorites");
});

test("Profile offers reading statistics below Edit profile only with an eligible plan", async ({ page }, testInfo) => {
  const cloud = await mockCloud(page);
  cloud.setPlan("plus");
  await page.addInitScript(() => {
    localStorage.setItem("autumn-language", "en");
    localStorage.setItem("autumn-theme", "dark");
  });
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="profile"]').click();

  const edit = page.locator("#profile-edit");
  const statistics = page.locator(".profile-actions .reading-stats-toggle");
  await expect(statistics).toBeVisible();
  const [editBox, statisticsBox] = await Promise.all([edit.boundingBox(), statistics.boundingBox()]);
  expect(editBox).not.toBeNull();
  expect(statisticsBox).not.toBeNull();
  expect(statisticsBox!.y).toBeGreaterThanOrEqual(editBox!.y + editBox!.height);
  if (testInfo.project.name === "android") {
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(statistics).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("profile-plus-actions.png"), fullPage: true });

  await statistics.click();
  await expect(page.locator("#view-statistics")).toBeVisible();
  await expect(page.locator("#view-statistics .reading-stats-summary")).toBeVisible();
});

test("Free plan has no reading statistics entry point", async ({ page }) => {
  await mockCloud(page);
  await page.addInitScript(() => localStorage.setItem("autumn-language", "en"));
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="profile"]').click();

  await expect(page.locator(".profile-actions .reading-stats-toggle")).toBeHidden();
  await expect(page.locator("#view-profile > .reading-stats")).toHaveCount(0);
  await expect(page.locator("#view-statistics")).toBeHidden();
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
