import { expect, test } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";

test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem("autumn-language","es"));});

test("Premium cloud voices and their quota live in TTS settings, not in the reader chrome",async({page},info)=>{
  const cloud=await mockCloud(page,true);cloud.setPlan("premium");
  await page.goto("/");await login(page);
  await expect(page.locator("#sidebar-plans, #view-plans")).toHaveCount(0);
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#settings-account-tab").click();
  await expect(page.locator("#settings-account-panel .tts-ai-speech-usage")).toHaveCount(0);
  await page.locator("#settings-tts-tab").click();
  const usage=page.locator("#tts-cloud-settings");
  await expect(usage).toBeVisible();
  expect(await page.locator("#settings-tts-panel").evaluate(panel => {
    const cloud = panel.querySelector("#tts-cloud-settings")!;
    const local = panel.querySelector(".tts-engine-ledger")!;
    return Boolean(cloud.compareDocumentPosition(local) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await expect(usage).toContainText("Voz en la nube");
  await expect(usage).toContainText("25.000");
  await expect(usage).toContainText("1080");
  await expect(usage).toContainText("23.920");
  await expect(usage).toContainText("Escuchar audio ya generado no consume caracteres adicionales");
  await expect(page.locator("#tts-cloud-preferred-voice option")).toHaveCount(5);
  await expect(page.locator('.tts-engine-options [data-tts-engine="piper"]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("premium-ai-usage.png"),fullPage:true});

  await page.locator("#file-input").setInputFiles({name:"Voz.epub",mimeType:"application/epub+zip",buffer:await epubFixture("premium-voice","Voz")});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator(info.project.name === "desktop" ? "#reader-tts-tab" : "#speech-toggle").click();
  await expect(page.locator('#tts-reader-voice option[value^="cloud:"]')).toHaveCount(5);
  await expect(page.locator("#speech-panel")).not.toContainText(/premium|cuota|mensual/i);
  await page.locator("#tts-reader-voice").selectOption("cloud:Lucia:es-ES");
  await expect(page.locator("#tts-active-voice")).toContainText("Lucía");
  await page.screenshot({path:info.outputPath("premium-voice-reader.png"),fullPage:true});
});

test("a cloud voice selected in the ordinary reader list requests Polly for a synced book",async({page},info)=>{
  await page.addInitScript(()=>{
    HTMLMediaElement.prototype.play=function(){return Promise.resolve();};
    HTMLMediaElement.prototype.pause=function(){};
    HTMLMediaElement.prototype.load=function(){};
  });
  const cloud=await mockCloud(page);cloud.setPlan("premium");
  await page.goto("/");await login(page);
  await expect(page.locator("#library-list .book-title")).toHaveCount(1);
  await page.locator("#library-list .book-title").click();
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  await page.locator(info.project.name === "desktop" ? "#reader-tts-tab" : "#speech-toggle").click();
  await page.locator("#tts-reader-voice").selectOption("cloud:Lucia:es-ES");
  await page.locator("#tts-play-pause").click();
  await expect.poll(()=>cloud.aiSpeechRequests.filter(request=>request.action==="synthesize").length).toBeGreaterThan(0);
  expect(cloud.aiSpeechRequests.find(request=>request.action==="synthesize")).toMatchObject({voiceId:"Lucia",language:"es-ES"});
  await expect(page.locator("#speech-panel")).not.toContainText(/premium|cuota|mensual/i);
});
