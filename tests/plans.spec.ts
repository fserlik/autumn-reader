import { expect, test } from "@playwright/test";
import { epubFixture, login, mockCloud, mockDeviceRegistry } from "./helpers/cloud";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("autumn-language", "es"));
});

test("Account shows server plan, byte quota, devices, and a read-only localized comparison", async ({ page }) => {
  const cloud = await mockCloud(page, true);
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();
  await expect(page.locator(".plan-name")).toHaveText("Gratis");
  await expect(page.locator(".plan-storage")).toContainText("1 GB");
  await expect(page.locator(".plan-devices")).toContainText("1 de 2");
  await expect(page.locator("#settings-sync")).toHaveCount(0);
  await expect(page.locator("#settings-account-panel .plan-feature")).toHaveCount(1);
  await expect(page.locator(".plan-feature #migrate-library")).toBeVisible();
  await expect(page.locator(".plan-feature .cloud-storage-manage")).toBeVisible();
  await expect(page.locator(".plan-feature .plan-manage-devices")).toBeVisible();
  await expect(page.locator(".plan-feature .plan-percent")).toHaveText(/\d+\s*%/);
  if (page.viewportSize()!.width < 800) {
    const card = await page.locator(".plan-feature").boundingBox();
    expect(card).not.toBeNull();
    expect(card!.x + card!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    const positions = await page.locator(".plan-identity, .plan-usage, .plan-actions")
      .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
  }
  await page.locator(".plan-compare").click();
  await expect(page.locator(".plan-card")).toHaveCount(3);
  await expect(page.locator("#settings-plan .cloud-storage-manage")).toBeVisible();
  await expect(page.locator("#settings-cloud-storage")).toHaveCount(0);
  if (page.viewportSize()!.width >= 800) {
    const boxes = await page.locator(".plan-card").evaluateAll(cards => cards.map(card => card.getBoundingClientRect().left));
    expect(boxes[0]).toBeLessThan(boxes[1]);
    expect(boxes[1]).toBeLessThan(boxes[2]);
  } else {
    const boxes = await page.locator(".plan-card").evaluateAll(cards => cards.map(card => card.getBoundingClientRect()));
    expect(Math.max(...boxes.map(box => box.right))).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(boxes[0].top).toBeLessThan(boxes[1].top);
    expect(boxes[1].top).toBeLessThan(boxes[2].top);
  }
  await expect(page.locator(".plan-card-featured")).toContainText("Autumn+");
  await expect(page.locator(".plan-card-featured")).toContainText("4.99");
  await expect(page.locator(".plan-card-featured")).toContainText("25 GB");
  await expect(page.locator(".plan-card button").first()).toBeDisabled();
  await page.locator(".plan-dialog .note-close").click();
  cloud.setPlan("plus");
  await page.reload();
  await page.locator('.nav-button[data-view="settings"]').click();
  await expect(page.locator(".plan-name")).toHaveText("Autumn+");
  await expect(page.locator(".plan-storage")).toContainText("25 GB");
  await expect(page.locator(".plan-devices")).toContainText("Ilimitados");
  await expect(page.locator("#account-logout")).toHaveCount(1);
  await expect(page.locator("#settings-account-panel #account-logout")).toBeVisible();
  await page.locator("#settings-interface-tab").click();
  await page.locator('[data-theme-choice="dark"]').click();
  await page.locator("#settings-account-tab").click();
  await page.locator(".plan-compare").click();
  const dark = await page.locator(".plan-card").first().evaluate(el => getComputedStyle(el).backgroundColor);
  await page.locator(".plan-dialog .note-close").click();
  await page.locator("#settings-interface-tab").click();
  await page.locator('[data-theme-choice="light"]').click();
  await page.locator("#settings-account-tab").click();
  await page.locator(".plan-compare").click();
  const light = await page.locator(".plan-card").first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(light).not.toBe(dark);
  await page.locator(".plan-dialog .note-close").click();
  cloud.setPlan("pro");
  await page.reload();
  await page.locator('.nav-button[data-view="settings"]').click();
  await expect(page.locator(".plan-name")).toHaveText("Autumn Pro");
  await expect(page.locator(".plan-storage")).toContainText("100 GB");
});

test("Microsoft Store choices appear only in the native Windows app", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as {isTauri:boolean}).isTauri = true;
    (window as unknown as {__TAURI_INTERNALS__:{invoke:(command:string)=>Promise<unknown>}}).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => command === "microsoft_store_products" ? [
        {productId:"autumn_plus_monthly",storeId:"9AAAAAAAAAAA",title:"Autumn+ mensual",formattedPrice:"ARS 4.999",formattedRecurrencePrice:"ARS 4.999",owned:false},
        {productId:"autumn_plus_yearly",storeId:"9BBBBBBBBBBB",title:"Autumn+ anual",formattedPrice:"ARS 39.999",formattedRecurrencePrice:"ARS 39.999",owned:false},
        {productId:"autumn_pro_monthly",storeId:"9CCCCCCCCCCC",title:"Autumn Pro mensual",formattedPrice:"ARS 9.999",formattedRecurrencePrice:"ARS 9.999",owned:false},
        {productId:"autumn_pro_yearly",storeId:"9DDDDDDDDDDD",title:"Autumn Pro anual",formattedPrice:"ARS 79.999",formattedRecurrencePrice:"ARS 79.999",owned:false},
      ] : [],
    };
  });
  await mockCloud(page, true); await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="settings"]').click(); await page.locator(".plan-compare").click();
  await expect(page.locator(".plan-store-toolbar")).toBeVisible();
  await expect(page.locator(".plan-card-featured .plan-store-choice")).toHaveCount(2);
  await expect(page.locator(".plan-card-featured .plan-store-choice").first()).toContainText("Mensual");
  await expect(page.locator(".plan-card-featured .plan-store-choice").first()).toContainText("ARS 4.999");
  await expect(page.locator(".plan-card-featured .plan-store-choice").first()).toBeEnabled();
});

test("a third Free installation can revoke an old device and then register", async ({ page }) => {
  await mockCloud(page, true);
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();
  await expect(page.locator(".plan-devices")).toContainText("1 de 2");
  await page.evaluate(() => localStorage.setItem("autumn-installation-id", crypto.randomUUID()));
  await page.locator("#account-logout").click();
  await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();
  await expect(page.locator(".plan-devices")).toContainText("2 de 2");
  await page.evaluate(() => localStorage.setItem("autumn-installation-id", crypto.randomUUID()));
  await page.locator("#account-logout").click();
  await login(page,"a@example.org",false);
  await expect(page.locator(".devices-dialog")).toBeVisible();
  await expect(page.locator(".device-row")).toHaveCount(2);
  page.once("dialog", dialog => dialog.accept());
  await page.locator(".device-row button").first().click();
  await expect(page.locator(".device-limit-message")).toBeEmpty();
  await expect(page.locator(".device-row")).toHaveCount(2);
});

test("revoking a PC session blocks cloud access, signs it out, and cannot restore it after restart", async ({ page, browser }) => {
  const registry = mockDeviceRegistry();
  await mockCloud(page, true, undefined, registry);
  await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({name:"Kept.epub",mimeType:"application/epub+zip",buffer:await epubFixture("kept","Kept locally")});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator("#back-button").click();
  const phoneContext = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try {
    const phone = await phoneContext.newPage();
    await mockCloud(phone, true, undefined, registry);
    await phone.goto("/"); await login(phone);
    const revokePc = async () => {
      await phone.locator('.nav-button[data-view="settings"]').click();
      await phone.locator(".plan-manage-devices").click();
      await expect(phone.locator(".device-row")).toHaveCount(2);
      phone.once("dialog", dialog => dialog.accept());
      await phone.locator(".device-row button").first().click();
      await expect(phone.locator(".device-row")).toHaveCount(1);
      await phone.locator(".devices-dialog .note-close").click();
    };
    await revokePc();
    const status = await page.evaluate(async () => {
      const token = JSON.parse(localStorage.getItem("autumn-auth")!).access_token as string;
      const response = await fetch("https://autumn-test.supabase.co/rest/v1/rpc/cloud_book_identities",{
        method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:"{}",
      });
      return response.status;
    });
    expect(status).toBe(403);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("#auth-entry")).toBeVisible();
    await page.reload();
    await expect(page.locator("#auth-entry")).toBeVisible();
    await login(page);
    await expect(page.locator("#library-list")).toContainText("Kept locally");
    await revokePc();
    await page.reload();
    await expect(page.locator("#auth-entry")).toBeVisible();
    await login(page);
    await expect(page.locator("#library-list")).toContainText("Kept locally");
  } finally { await phoneContext.close(); }
});

test("a downgraded account shows over-quota without removing its existing cloud books", async ({ page }) => {
  const cloud = await mockCloud(page, true);
  cloud.setQuota({used_books:68,used_bytes:2*1073741824,max_bytes:1073741824,active_pending_uploads:0,reserved_bytes:0});
  await page.goto("/"); await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();
  await expect(page.locator(".plan-warning")).toContainText("Superaste el límite de almacenamiento");
  await page.locator(".cloud-storage-manage").click();
  await expect(page.locator(".cloud-storage-dialog-usage")).toContainText("68 libros en la nube");
  await expect(page.locator(".plan-storage")).toContainText("2 GB de 1 GB");
});

test("the unified account card keeps its actions in all four languages", async ({ browser }) => {
  const labels = {
    en: ["Your plan", "Sync all local books", "Manage cloud storage"],
    es: ["Tu plan", "Sincronizar todos los libros locales", "Administrar libros en la nube"],
    it: ["Il tuo piano", "Sincronizza tutti i libri locali", "Gestisci i libri nel cloud"],
    fr: ["Votre offre", "Synchroniser tous les livres locaux", "Gérer les livres dans le cloud"],
  };
  for (const [locale, [heading, sync, manage]] of Object.entries(labels)) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      await context.addInitScript(value => localStorage.setItem("autumn-language", value), locale);
      const localized = await context.newPage();
      await mockCloud(localized, true);
      await localized.goto("/"); await login(localized);
      await localized.locator('.nav-button[data-view="settings"]').click();
      await expect(localized.locator(".plan-identity h3")).toHaveText(heading);
      await expect(localized.locator(".plan-feature #migrate-library")).toContainText(sync);
      await expect(localized.locator(".plan-feature .cloud-storage-manage")).toContainText(manage);
      await expect(localized.locator("#settings-sync")).toHaveCount(0);
      const card = await localized.locator(".plan-feature").boundingBox();
      expect(card).not.toBeNull();
      expect(card!.x).toBeGreaterThanOrEqual(0);
      expect(card!.x + card!.width).toBeLessThanOrEqual(390);
    } finally { await context.close(); }
  }
});
