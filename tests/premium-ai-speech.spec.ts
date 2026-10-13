import { expect, test } from "@playwright/test";
import { login, mockCloud } from "./helpers/cloud";

test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem("autumn-language","es"));});

test("Premium AI Speech quota is compact, localized and reachable on desktop and Android",async({page},info)=>{
  const cloud=await mockCloud(page,true);cloud.setPlan("plus");
  await page.goto("/");await login(page);
  await expect(page.locator("#sidebar-plans, #view-plans")).toHaveCount(0);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#settings-tts-tab").click();
  const usage=page.locator("#settings-tts-panel .plan-ai-speech-usage");
  await expect(usage).toBeVisible();
  await expect(usage).toContainText("Voz IA premium");
  await expect(usage).toContainText("60 minutos al mes");
  await expect(usage).toContainText("18 min");
  await expect(usage).toContainText("42 min");
  await expect(usage).toContainText("Escuchar audio ya generado no consume minutos adicionales");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("premium-ai-usage.png"),fullPage:true});
});
