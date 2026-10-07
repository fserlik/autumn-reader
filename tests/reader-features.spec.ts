import { test, expect, type Page } from "@playwright/test";
import { mockCloud, login, epubFixture, multiChapterFixture } from "./helpers/cloud";
import { samplePdf } from "./helpers/pdf";
import { clickReaderOption, selectReaderOption } from "./helpers/reader-options";
test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem("autumn-language", "es")); });
test.afterEach(async ({page}) => { await page.unrouteAll({behavior:"wait"}); });

test("TTS discovers local voices, persists voice and speed, and controls book playback", async ({page}, info) => {
  await page.addInitScript(() => {
    class MockUtterance {
      text: string; lang = ""; rate = 1; voice: SpeechSynthesisVoice | null = null;
      onend: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    const voices = [
      { voiceURI: "local-es", name: "Lucía local", lang: "es-ES", localService: true, default: true },
      { voiceURI: "local-en", name: "Autumn English", lang: "en-US", localService: true, default: false },
    ] as SpeechSynthesisVoice[];
    const state = { speaking: false, paused: false, calls: [] as {text:string;rate:number;voice:string|null}[] };
    const synthesis = new EventTarget();
    Object.defineProperties(synthesis, {
      speaking: { get: () => state.speaking }, paused: { get: () => state.paused },
      getVoices: { value: () => voices },
      speak: { value: (utterance: MockUtterance) => {
        state.speaking = true; state.paused = false;
        state.calls.push({ text: utterance.text, rate: utterance.rate, voice: utterance.voice?.voiceURI ?? null });
      } },
      cancel: { value: () => { state.speaking = false; state.paused = false; } },
      pause: { value: () => { state.paused = true; } },
      resume: { value: () => { state.paused = false; } },
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: MockUtterance });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synthesis });
    Object.defineProperty(window, "__ttsMock", { value: state });
  });
  const cloud = await mockCloud(page, true); cloud.setPlan("plus");
  await page.goto("/"); await login(page);
  if (info.project.name === "android") await page.setViewportSize({ width: 375, height: 667 });
  await page.locator('.nav-button[data-view="settings"]').click();
  await page.locator("#settings-tts-tab").click();
  await expect(page.locator("#tts-voice-select option")).toHaveCount(3);
  await expect(page.locator("#tts-voice-status")).toHaveText("2 voces disponibles");
  await page.locator("#tts-voice-select").selectOption("local-es");
  await page.locator("#tts-rate-settings").fill("1.3");
  await page.locator("#tts-rate-settings").dispatchEvent("change");
  await page.locator("#tts-preview").click();
  await page.screenshot({ path: info.outputPath("tts-settings.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: info.outputPath("tts-settings-dark.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  expect(await page.evaluate(() => {
    const value = localStorage.getItem("autumn-tts-preferences");
    const mock = (window as unknown as {__ttsMock:{calls:{rate:number;voice:string|null}[]}}).__ttsMock;
    return { saved: value && JSON.parse(value), preview: mock.calls.at(-1) };
  })).toMatchObject({ saved: { voiceUri: "local-es", rate: 1.3 }, preview: { rate: 1.3, voice: "local-es" } });

  await page.locator("#file-input").setInputFiles({name:"Narración.epub",mimeType:"application/epub+zip",buffer:await epubFixture("narration", "Narración")});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  const speechEntry = page.locator(info.project.name === "desktop" ? "#reader-tts-tab" : "#speech-toggle");
  await expect(speechEntry).toBeVisible();
  await speechEntry.click();
  await expect(page.locator("#tts-active-voice")).toContainText("Lucía local");
  if (info.project.name === "desktop") {
    const sidebar = (await page.locator("#reader-sidebar").boundingBox())!;
    const rate = (await page.locator("#tts-rate-reader-value").boundingBox())!;
    expect(rate.x + rate.width).toBeLessThanOrEqual(sidebar.x + sidebar.width + 1);
  }
  await page.screenshot({ path: info.outputPath("tts-player.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: info.outputPath("tts-player-dark.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.locator("#tts-play-pause").click();
  await expect(page.locator("#tts-player-status")).toHaveText("Leyendo esta página");
  await expect.poll(() => page.evaluate(() => (window as unknown as {__ttsMock:{calls:unknown[]}}).__ttsMock.calls.length)).toBeGreaterThan(1);
  await page.locator("#tts-play-pause").click();
  await expect(page.locator("#tts-player-status")).toHaveText("Lectura en pausa");
  expect(await page.evaluate(() => (window as unknown as {__ttsMock:{paused:boolean}}).__ttsMock.paused)).toBe(true);
  await page.locator("#tts-play-pause").click();
  await expect(page.locator("#tts-player-status")).toHaveText("Leyendo esta página");
  expect(await page.evaluate(() => (window as unknown as {__ttsMock:{paused:boolean}}).__ttsMock.paused)).toBe(false);
  await expect(page.locator("#tts-next")).toBeEnabled();
  const beforeNext = await page.evaluate(() => (window as unknown as {__ttsMock:{calls:unknown[]}}).__ttsMock.calls.length);
  await page.locator("#tts-next").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {__ttsMock:{calls:unknown[]}}).__ttsMock.calls.length)).toBeGreaterThan(beforeNext);
  if (info.project.name === "android") {
    await page.setViewportSize({ width: 667, height: 375 });
    await expect(page.locator("#speech-panel")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("tts-player-landscape.png") });
  }
});
async function saved(page: Page) {
  return page.evaluate(() => new Promise<{page:number;cfi:string|null;pdfTextOffset:number;percentage:number}>(resolve => {
    const request = indexedDB.open("autumn-reader"); request.onsuccess = () => {
      const db=request.result,tx=db.transaction("books"),all=tx.objectStore("books").getAll();
      all.onsuccess=()=>resolve(all.result.find((b:{deletedAt?:number})=>!b.deletedAt));tx.oncomplete=()=>db.close();
    };
  }));
}
test("folder tiles contain books offline, support moving out, survive reload, and deleting one preserves its library",async({page,context},info)=>{
  await mockCloud(page,true);await page.goto("/");await login(page);
  await context.setOffline(true);
  await page.locator("#file-input").setInputFiles({name:"Philosophy.epub",mimeType:"application/epub+zip",buffer:await epubFixture("philosophy", "Philosophy")});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="library"]').click();
  await page.locator("#folder-new").click();await page.locator("#folder-name").fill("Filosofía");await page.locator('#folder-form [type="submit"]').click();
  const tile=page.locator(".folder-tile");
  await expect(tile).toHaveCount(1);await expect(page.locator("#folder-filter")).toHaveCount(0);
  const id=await tile.getAttribute("data-folder-id");
  await expect(tile.locator(".folder-title")).toHaveText("Filosofía");
  await expect(tile.locator(".folder-count")).toHaveText("0 libros");
  await page.locator(".book-folder").selectOption(id!);
  await expect(page.locator("#library-list .book-title")).toHaveCount(0);
  await expect(tile.locator(".folder-count")).toHaveText("1 libro");
  await page.locator("#library-search").fill("Philosophy");await expect(page.locator("#library-list .book-title")).toHaveCount(1);
  await page.locator("#library-search").fill("");await expect(page.locator("#library-list .book-title")).toHaveCount(0);
  await tile.click();await expect(page.locator("#library-list .book-title")).toHaveCount(1);
  await expect(page.locator("#folder-location")).toHaveText("Biblioteca / Filosofía");
  await page.locator(".book-folder").selectOption("");await expect(page.locator("#library-list .book-title")).toHaveCount(0);
  await expect(page.locator("#library-list")).toContainText("Esta carpeta está vacía");
  await page.locator("#folder-back").click();await expect(page.locator("#library-list .book-title")).toHaveCount(1);
  await page.locator(".book-folder").selectOption(id!);await expect(tile.locator(".folder-count")).toHaveText("1 libro");await tile.click();
  await page.locator("#folder-rename").click();await page.locator("#folder-name").fill("Universidad");await page.locator('#folder-form [type="submit"]').click();
  await expect(page.locator("#folder-location")).toContainText("Universidad");
  await page.reload();await page.locator('.nav-button[data-view="library"]').click();
  await expect(page.locator("#library-list .book-title")).toHaveCount(0);
  await expect(tile.locator(".folder-title")).toHaveText("Universidad");
  await page.screenshot({path:info.outputPath("folder-root.png")});await tile.click();
  await expect(page.locator("#library-list .book-title")).toHaveCount(1);
  await page.locator("#folder-delete").click();await page.locator("#confirm-accept").click();
  await expect(tile).toHaveCount(0);await expect(page.locator("#library-list .book-title")).toHaveCount(1);
  await page.locator("#library-list .book-title").click();await expect(page.locator(".epub-frame iframe")).toBeVisible();
});
test("EPUB search supports a phrase and history without overwriting offline reading CFI",async({page,context})=>{
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:"Search.epub",mimeType:"application/epub+zip",buffer:await epubFixture()});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();await context.setOffline(true);
  const start=await saved(page);await page.locator("#next-button").click();await expect.poll(async()=>(await saved(page)).cfi).not.toBe(start.cfi);
  const first=await saved(page);await page.locator("#next-button").click();await expect.poll(async()=>(await saved(page)).cfi).not.toBe(first.cfi);
  const anchor=await saved(page);await clickReaderOption(page, "#book-search-button");await page.locator("#book-search-input").fill("PARAGRAPH 0: autumn reading");
  await expect(page.locator("#book-search-status")).toHaveText("1 resultados");await expect(page.locator("#reading-return")).toBeVisible();
  expect((await saved(page)).cfi).toBe(anchor.cfi);
  await page.locator("#book-search-input").fill("AUTUMN reading");await expect(page.locator("#book-search-status")).toHaveText("60 resultados");
  await page.locator("#search-next").click();await expect(page.locator("#search-index")).toHaveText("2 de 60");
  await page.locator("#search-previous").click();await expect(page.locator("#search-index")).toHaveText("1 de 60");
  await page.locator("#book-search-close").click();await page.locator("#reading-return").click();await expect(page.locator("#reader-history")).toBeHidden();
  expect((await saved(page)).cfi).toBe(anchor.cfi);
});
test("PDF search navigates real pages, back/forward restores offsets, and keeps reading progress",async({page})=>{
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:"Search.pdf",mimeType:"application/pdf",buffer:samplePdf()});
  await expect(page.locator(".pdf-reading-text")).toBeVisible();await selectReaderOption(page, "#pdf-reading-mode", "original");
  await page.locator("#next-button").click();await expect(page.locator("#position-label")).toContainText("2");
  await expect.poll(async()=>(await saved(page)).page).toBe(2);
  await clickReaderOption(page, "#book-search-button");await page.locator("#book-search-input").fill("CHAPTER 1");
  await expect(page.locator("#book-search-status")).toHaveText("1 resultados");await expect(page.locator("#reading-return")).toHaveText("← Volver a página 2");
  expect((await saved(page)).page).toBe(2);await page.locator("#history-back").click();await expect(page.locator("#position-label")).toContainText("2");
  await page.locator("#history-forward").click();await expect(page.locator("#position-label")).toContainText("1");
  await page.locator("#book-search-close").click();await page.locator("#reading-return").click();await expect(page.locator("#position-label")).toContainText("2");
  await page.locator("#back-button").click();await page.locator("#library-list .book-title").click();await expect(page.locator("#position-label")).toContainText("2");
});
test("spacing persists in PDF reflow and EPUB, while the original PDF canvas stays unchanged",async({page})=>{
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();await page.locator("#settings-page-tab").click();
  await page.locator("#line-spacing").fill("2");await page.locator("#line-spacing").dispatchEvent("change");
  await page.locator("#paragraph-spacing").fill("1.3");await page.locator("#paragraph-spacing").dispatchEvent("change");
  await page.locator("#file-input").setInputFiles({name:"SpacingPDF.pdf",mimeType:"application/pdf",buffer:samplePdf()});
  await expect(page.locator(".pdf-reading-text")).toHaveCSS("line-height","36px");
  await expect(page.locator(".pdf-reading-text p").first()).toHaveCSS("margin-bottom","23.4px");
  await selectReaderOption(page, "#pdf-reading-mode", "original");const before=await page.locator(".pdf-page").boundingBox();
  await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="settings"]').click();await page.locator("#spacing-reset").click();
  await page.locator("#file-input").setInputFiles({name:"SpacingEPUB.epub",mimeType:"application/epub+zip",buffer:await epubFixture()});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();
  expect(await page.frameLocator(".epub-frame iframe").locator("#autumn-spacing").textContent()).toContain("1.6");
  await page.locator("#back-button").click();await page.locator('.nav-button[data-view="library"]').click();await page.locator("#library-list").getByRole("button",{name:"SpacingPDF",exact:true}).click();
  await expect(page.locator(".pdf-page")).toBeVisible();expect(Math.abs((await page.locator(".pdf-page").boundingBox())!.width-before!.width)).toBeLessThan(8);
  await page.reload();await page.locator('.nav-button[data-view="settings"]').click();await page.locator("#settings-page-tab").click();await expect(page.locator("#line-spacing")).toHaveValue("1.6");
});
for (const format of ["pdf","epub"] as const) test(`${format} mobile swipe waits for release, turns once, and preserves selection and vertical scroll`,async({page},info)=>{
  test.skip(info.project.name!=="android","Touch WebView viewport");
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:`Swipe.${format}`,mimeType:format==="pdf"?"application/pdf":"application/epub+zip",buffer:format==="pdf"?samplePdf():await epubFixture()});
  await expect(page.locator(format==="pdf"?".pdf-reading-text":".epub-frame iframe")).toBeVisible();
  const cdp=await page.context().newCDPSession(page),rect=(await page.locator("#reading-surface").boundingBox())!;
  const x=rect.x+rect.width*.7,y=rect.y+rect.height*.5;
  const touch=async(type:"touchStart"|"touchMove"|"touchEnd",tx=x,ty=y)=>cdp.send("Input.dispatchTouchEvent",{type,touchPoints:type==="touchEnd"?[]:[{x:tx,y:ty}]});
  const position=await page.locator("#position-label").textContent(),anchor=await saved(page);
  await touch("touchStart");await touch("touchMove",x-17);
  await touch("touchMove",x-20);await expect(page.locator("#position-label")).toHaveText(position!);
  if(format==="epub")await expect(page.locator(".page-turn-preview")).toHaveCount(1);
  else await expect(page.locator(".page-turn-snapshot, .page-turn-preview")).toHaveCount(0);
  expect((await saved(page)).page).toBe(anchor.page);expect((await saved(page)).cfi).toBe(anchor.cfi);
  await touch("touchEnd");await expect(page.locator(".page-turn-snapshot")).toHaveCount(0);await expect(page.locator("#position-label")).toHaveText(position!);
  await touch("touchStart");await touch("touchMove",x-20);await touch("touchMove",x-55);
  if(format==="epub")await expect(page.locator(".page-turn-preview")).toHaveCount(1);
  else await expect(page.locator(".page-turn-snapshot, .page-turn-preview")).toHaveCount(0);
  await expect(page.locator("#reader-content")).toHaveCSS("transform","none");
  await page.screenshot({path:info.outputPath(`${format}-gesture-detected.png`)});
  await touch("touchEnd");
  await touch("touchStart");await touch("touchMove",x-55);await touch("touchEnd");
  await expect(page.locator(".page-turn-snapshot")).toHaveCount(0);await expect(page.locator("#position-label")).not.toHaveText(position!);
  const after=await page.locator("#position-label").textContent();
  expect(Number(after!.match(/(\d+)\/\d+$/)?.[1])).toBe(Number(position!.match(/(\d+)\/\d+$/)?.[1])+1);
  await page.waitForTimeout(450);await expect(page.locator("#position-label")).toHaveText(after!);
  await touch("touchStart");await touch("touchMove",x-10,y+80);await touch("touchEnd");await expect(page.locator("#position-label")).toHaveText(after!);
  const select=()=>{const node=document.querySelector(".pdf-reading-text p span")?.firstChild??document.querySelector("p")?.firstChild;if(node){const range=document.createRange();range.selectNodeContents(node);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);}};
  if(format==="pdf")await page.evaluate(select);else await page.frameLocator(".epub-frame iframe").locator("body").evaluate(select);
  await touch("touchStart");await touch("touchMove",x-130);await touch("touchEnd");await expect(page.locator("#position-label")).toHaveText(after!);
});
test("Android PDF never replaces a page during drag, so a lost touchend leaves it usable",async({page},info)=>{
  test.skip(info.project.name!=="android","Touch WebView viewport");
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:"Interrupted.pdf",mimeType:"application/pdf",buffer:samplePdf()});
  await expect(page.locator(".pdf-reading-text")).toBeVisible();
  // Reach the last reflow sheet, the boundary that previously detached the
  // touched PDF.js target while the finger was still down.
  let lastSheet=false;
  for(let i=0;i<20;i++){
    const label=await page.locator("#position-label").textContent()??"";
    const sheets=label.match(/(\d+)\/(\d+)$/);
    if(sheets&&sheets[1]===sheets[2]){lastSheet=true;break;}
    await page.locator("#next-button").click();
    await expect(page.locator(".page-turn-sheet")).toHaveCount(0);
  }
  expect(lastSheet).toBe(true);
  const before=await page.locator("#position-label").textContent();
  const cdp=await page.context().newCDPSession(page),rect=(await page.locator("#reading-surface").boundingBox())!;
  const x=rect.x+rect.width*.7,y=rect.y+rect.height*.5;
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x-40,y}]});
  await expect(page.locator("#reading-surface")).not.toHaveClass(/page-turning/);
  await expect(page.locator(".page-turn-snapshot, .page-turn-sheet")).toHaveCount(0);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});
  await expect(page.locator("#position-label")).toHaveText(before!);
  await expect(page.locator("#next-button")).toBeEnabled();
  await page.locator("#next-button").click();
  await expect(page.locator("#position-label")).not.toHaveText(before!);
});
test("Android right swipe crosses a PDF boundary only on release and a lost touchend cannot leave a half page",async({page},info)=>{
  test.skip(info.project.name!=="android","Touch WebView viewport");
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:"Backwards.pdf",mimeType:"application/pdf",buffer:samplePdf()});
  await expect(page.locator(".pdf-reading-text")).toBeVisible();
  for(let i=0;i<20 && (await saved(page)).page===1;i++){
    await page.locator("#next-button").click();
    await expect(page.locator(".page-turn-sheet")).toHaveCount(0);
  }
  await expect.poll(async()=>(await saved(page)).page).toBe(2);
  await expect(page.locator("#reader-content")).toHaveCSS("touch-action","pan-y");
  const cdp=await page.context().newCDPSession(page),rect=(await page.locator("#reading-surface").boundingBox())!;
  const x=rect.x+rect.width*.3,y=rect.y+rect.height*.5;
  const touch=async(type:"touchStart"|"touchMove"|"touchEnd"|"touchCancel",tx=x,ty=y)=>cdp.send("Input.dispatchTouchEvent",{type,touchPoints:type==="touchEnd"||type==="touchCancel"?[]:[{x:tx,y:ty}]});
  await touch("touchStart");await touch("touchMove",x+24);await touch("touchMove",x+145,y+28);
  await expect(page.locator(".page-turn-snapshot")).toHaveCount(0);
  await touch("touchEnd");
  await expect(page.locator(".page-turn-snapshot")).toHaveCount(0);
  await expect.poll(async()=>(await saved(page)).page).toBe(1);
  // Return to page 2, then omit touchend to reproduce a detached WebView target.
  await page.locator("#next-button").click();
  await expect(page.locator(".page-turn-sheet")).toHaveCount(0);
  await expect.poll(async()=>(await saved(page)).page).toBe(2);
  await touch("touchStart");await touch("touchMove",x+25);await touch("touchMove",x+145);
  await expect(page.locator(".page-turn-snapshot")).toHaveCount(0);
  await expect(page.locator("#reading-surface")).not.toHaveClass(/page-turning/);
  await touch("touchCancel");
  await expect.poll(async()=>(await saved(page)).page).toBe(2);
  await expect(page.locator("#previous-button")).toBeEnabled();
});
test("Android right swipe also returns to the previous original-layout PDF page",async({page},info)=>{
  test.skip(info.project.name!=="android","Touch WebView viewport");
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:"OriginalBack.pdf",mimeType:"application/pdf",buffer:samplePdf()});
  await selectReaderOption(page,"#pdf-reading-mode","original");
  await expect(page.locator(".pdf-page")).toBeVisible();
  await page.locator("#next-button").click();
  await expect(page.locator(".page-turn-sheet")).toHaveCount(0);
  await expect.poll(async()=>(await saved(page)).page).toBe(2);
  const cdp=await page.context().newCDPSession(page),rect=(await page.locator("#reading-surface").boundingBox())!;
  const x=rect.x+rect.width*.3,y=rect.y+rect.height*.5;
  const touch=async(type:"touchStart"|"touchMove"|"touchEnd",tx=x)=>cdp.send("Input.dispatchTouchEvent",{type,touchPoints:type==="touchEnd"?[]:[{x:tx,y}]});
  await touch("touchStart");await touch("touchMove",x+25);await touch("touchMove",x+145);await touch("touchEnd");
  await expect(page.locator(".page-turn-snapshot")).toHaveCount(0);
  await expect.poll(async()=>(await saved(page)).page).toBe(1);
  await expect(page.locator(".pdf-page")).toBeVisible();
});
test("PDF turn releases the reader if WebView never resolves its animation",async({page})=>{
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:"Suspended.pdf",mimeType:"application/pdf",buffer:samplePdf()});
  await expect(page.locator(".pdf-reading-text")).toBeVisible();
  await page.evaluate(()=>{Element.prototype.animate=function(){return {finished:new Promise<void>(()=>{}),cancel(){}} as Animation;};});
  await page.locator("#next-button").click();
  await expect(page.locator(".page-turn-sheet")).toHaveCount(0,{timeout:5000});
  await expect(page.locator("#reading-surface")).not.toHaveClass(/page-turning/);
  await expect(page.locator("#next-button")).toBeEnabled();
});
for(const format of ["pdf","epub"] as const)test(`${format} page turn animates buttons and keyboard, can be disabled and respects reduced motion`,async({page},info)=>{
  await mockCloud(page,true);await page.addInitScript(()=>localStorage.setItem("autumn-language","es"));await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:`Turn.${format}`,mimeType:format==="pdf"?"application/pdf":"application/epub+zip",buffer:format==="pdf"?samplePdf():await epubFixture()});
  await expect(page.locator(format==="pdf"?".pdf-reading-text":".epub-frame iframe")).toBeVisible();
  const initial=await saved(page);
  await page.locator("#next-button").click();
  await expect(page.locator(".page-turn-sheet")).toHaveCount(1);
  await expect(page.locator(".page-turn-sheet")).toHaveAttribute("data-turn-direction","1");
  await page.screenshot({path:info.outputPath(`${format}-page-turn.png`)});
  await expect(page.locator(".page-turn-sheet")).toHaveCount(0);
  await expect.poll(async()=>{const position=await saved(page);return format==="pdf"?position.pdfTextOffset:position.cfi;}).not.toBe(format==="pdf"?initial.pdfTextOffset:initial.cfi);
  await page.keyboard.press("ArrowLeft");await expect(page.locator(".page-turn-sheet")).toHaveCount(1);await expect(page.locator(".page-turn-sheet")).toHaveCount(0);
  await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="settings"]').click();await page.locator("#settings-interface-tab").click();
  await expect(page.locator("#page-turn-animation")).toBeChecked();await page.locator("#page-turn-animation").uncheck();
  await expect(page.locator("#page-turn-animation-status")).toHaveText("Desactivada");
  expect(await page.evaluate(()=>localStorage.getItem("autumn-page-turn-animation"))).toBe("off");
  await page.locator('.nav-button[data-view="library"]').click();await page.locator("#library-list .book-title").click();
  await expect(page.locator(format==="pdf"?".pdf-reading-text":".epub-frame iframe")).toBeVisible();
  const beforeInstant=await saved(page);await page.locator("#next-button").click();
  await expect(page.locator(".page-turn-sheet")).toHaveCount(0);
  await expect.poll(async()=>{const position=await saved(page);return format==="pdf"?position.pdfTextOffset:position.cfi;}).not.toBe(format==="pdf"?beforeInstant.pdfTextOffset:beforeInstant.cfi);
  await page.reload();await page.locator('.nav-button[data-view="settings"]').click();await page.locator("#settings-interface-tab").click();
  await expect(page.locator("#page-turn-animation")).not.toBeChecked();
  await page.locator("#page-turn-animation").check();await page.emulateMedia({reducedMotion:"reduce"});
  await expect(page.locator("#page-turn-animation-status")).toHaveText("Reducida por el sistema");
  await page.locator('.nav-button[data-view="library"]').click();await page.locator("#library-list .book-title").click();
  await expect(page.locator(format==="pdf"?".pdf-reading-text":".epub-frame iframe")).toBeVisible();
  const beforeReduced=await saved(page);await page.locator(format==="epub"?"#next-button":"#previous-button").click();
  await expect(page.locator(".page-turn-sheet")).toHaveCount(0);
  await expect.poll(async()=>{const position=await saved(page);return format==="pdf"?position.pdfTextOffset:position.cfi;}).not.toBe(format==="pdf"?beforeReduced.pdfTextOffset:beforeReduced.cfi);
});
test("Android swipe still changes the reading page when animation is disabled",async({page},info)=>{
  test.skip(info.project.name!=="android","Touch WebView viewport");
  await mockCloud(page,true);await page.addInitScript(()=>localStorage.setItem("autumn-page-turn-animation","off"));await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:"InstantSwipe.pdf",mimeType:"application/pdf",buffer:samplePdf()});
  await expect(page.locator(".pdf-reading-text")).toBeVisible();const before=await saved(page);
  const cdp=await page.context().newCDPSession(page),rect=(await page.locator("#reading-surface").boundingBox())!;
  const x=rect.x+rect.width*.7,y=rect.y+rect.height*.5;
  const touch=async(type:"touchStart"|"touchMove"|"touchEnd",tx=x)=>cdp.send("Input.dispatchTouchEvent",{type,touchPoints:type==="touchEnd"?[]:[{x:tx,y}]});
  await touch("touchStart");await touch("touchMove",x-20);await touch("touchMove",x-140);
  await expect(page.locator(".page-turn-sheet, .page-turn-snapshot")).toHaveCount(0);
  await touch("touchEnd");
  await expect.poll(async()=>(await saved(page)).pdfTextOffset).not.toBe(before.pdfTextOffset);
});
test("cloud folder organization survives a fresh device without a second book download",async({page})=>{
  const cloud=await mockCloud(page);await page.goto("/");await login(page);await expect(page.locator("#library-list .book-title")).toHaveCount(1);
  await page.locator("#folder-new").click();await page.locator("#folder-name").fill("Sincronizada");await page.locator('[data-color="#326fca"]').click();await page.locator('#folder-form [type="submit"]').click();
  await expect(page.locator(".folder-tile")).toHaveCount(1);const id=await page.locator(".folder-tile").getAttribute("data-folder-id");
  await expect(page.locator(".folder-tile")).toHaveCSS("--folder-color","#326fca");
  await page.locator(".book-folder").selectOption(id!);await expect.poll(()=>cloud.folderMembers.size).toBe(1);
  await expect.poll(()=>cloud.folderRows.get(id!)?.color).toBe("#326fca");
  await page.evaluate(()=>new Promise<void>(resolve=>{const request=indexedDB.open("autumn-reader");request.onsuccess=()=>{const db=request.result,tx=db.transaction(["library_folders","folder_memberships"],"readwrite");tx.objectStore("library_folders").clear();tx.objectStore("folder_memberships").clear();tx.oncomplete=()=>{db.close();resolve();};};}));
  await page.reload();await page.locator('.nav-button[data-view="library"]').click();await expect(page.locator(".folder-title")).toHaveText("Sincronizada");
  await expect(page.locator(".folder-tile")).toHaveCSS("--folder-color","#326fca");
  await expect(page.locator("#library-list .book-title")).toHaveCount(0);await page.getByRole("button",{name:"Abrir carpeta Sincronizada, 1 libro",exact:true}).click();
  await expect(page.locator(".book-folder")).toHaveValue(id!);
  await expect.poll(() => cloud.downloads).toBe(1);
  await page.locator('.nav-button[data-view="settings"]').click();await page.locator("#account-logout").click();await login(page,"b@example.org");
  await expect(page.locator("#folder-filter")).toHaveCount(0);await expect(page.locator(".folder-tile")).toHaveCount(0);
});
test("folder colour can be customised offline, remains legible, and can return to automatic",async({page,context},info)=>{
  await mockCloud(page,true);await page.goto("/");await login(page);await context.setOffline(true);
  await page.locator("#folder-new").click();await page.locator("#folder-name").fill("Lecturas azules");await page.locator('#folder-form [type="submit"]').click();
  const tile=page.locator(".folder-tile"),automatic=await tile.evaluate(element=>(element as HTMLElement).style.getPropertyValue("--folder-color"));
  await tile.click();await page.locator("#folder-rename").click();await page.locator("#folder-custom-color").fill("#e6eafb");
  await page.locator('#folder-form [type="submit"]').click();await page.locator("#folder-back").click();
  await expect(tile).toHaveCSS("--folder-color","#e6eafb");await expect(tile.locator(".folder-label")).toHaveCSS("color","rgb(0, 0, 0)");
  await page.screenshot({path:info.outputPath("custom-folder-colour.png")});
  await page.reload();await page.locator('.nav-button[data-view="library"]').click();await expect(tile).toHaveCSS("--folder-color","#e6eafb");
  await tile.click();await page.locator("#folder-rename").click();await expect(page.locator("#folder-custom-color")).toHaveValue("#e6eafb");
  await page.locator("#folder-color-auto").click();await page.locator('#folder-form [type="submit"]').click();await page.locator("#folder-back").click();
  await expect(tile).toHaveCSS("--folder-color",automatic);
});
test("named folder tiles support keyboard access, long names, safe text and both themes",async({page},info)=>{
  await mockCloud(page,true);await page.goto("/");await login(page);
  const names=["Filosofía","Ciencia ficción","Universidad","Lecturas pendientes","Historia","Poesía","Arte <img src=x>","Una carpeta con un nombre muy largo para organizar mis próximos libros de literatura y filosofía"];
  for(const [index,name] of names.entries()){
    await page.locator("#folder-new").click();await page.locator("#folder-name").fill(name);await page.locator('#folder-form [type="submit"]').click();
    await expect(page.locator(".folder-tile")).toHaveCount(index+1);
  }
  await expect(page.locator(".folder-title")).toHaveText([...names].sort((a,b)=>a.localeCompare(b)));
  await expect(page.locator(".folder-tile img")).toHaveCount(0);
  const colors=await page.locator(".folder-tile").evaluateAll(tiles=>tiles.map(tile=>(tile as HTMLElement).style.getPropertyValue("--folder-color")));
  const contrasts=await page.locator(".folder-tile").evaluateAll(tiles=>{
    const luminance=(color:string)=>{const rgb=color.match(/\d+/g)!.slice(0,3).map(Number).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
    return tiles.map(tile=>{const text=luminance(getComputedStyle(tile.querySelector(".folder-label")!).color),fill=luminance(getComputedStyle(tile.querySelector(".folder-front")!).fill);return (Math.max(text,fill)+.05)/(Math.min(text,fill)+.05);});
  });
  for(const contrast of contrasts)expect(contrast).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator("#library-list")).toBeHidden();
  await page.screenshot({path:info.outputPath("folders-light.png"),fullPage:true});
  await page.locator("#library-search").fill("CIENCIA");await expect(page.locator(".folder-title")).toHaveText("Ciencia ficción");
  await page.locator(".folder-tile").press("Enter");await expect(page.locator("#folder-location")).toHaveText("Biblioteca / Ciencia ficción");
  await expect(page.locator("#library-list")).toContainText("Esta carpeta está vacía");
  await page.locator("#folder-back").click();await page.locator("#library-search").fill("");
  await page.reload();await page.locator('.nav-button[data-view="library"]').click();await expect(page.locator(".folder-tile")).toHaveCount(8);
  expect(await page.locator(".folder-tile").evaluateAll(tiles=>tiles.map(tile=>(tile as HTMLElement).style.getPropertyValue("--folder-color")))).toEqual(colors);
  await page.locator('.nav-button[data-view="settings"]').click();await page.locator("#settings-interface-tab").click();await page.locator('[data-theme-choice="dark"]').click();
  await page.locator('.nav-button[data-view="library"]').click();await page.screenshot({path:info.outputPath("folders-dark.png"),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  if(info.project.name==="android"){
    await page.setViewportSize({width:320,height:640});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    expect(await page.locator(".folder-count").evaluateAll(counts=>counts.every(count=>{
      const label=count.getBoundingClientRect(),tile=count.closest(".folder-tile")!.getBoundingClientRect();
      return label.bottom<=tile.bottom&&label.right<=tile.right;
    }))).toBe(true);
    await page.screenshot({path:info.outputPath("folders-narrow.png")});
  }
});
test("scanned PDF search explains that there is no text layer",async({page})=>{
  await mockCloud(page,true);await page.goto("/");await login(page);await page.locator("#file-input").setInputFiles({name:"Scanned.pdf",mimeType:"application/pdf",buffer:samplePdf(false)});
  await expect(page.locator(".pdf-page")).toBeVisible();await clickReaderOption(page, "#book-search-button");await page.locator("#book-search-input").fill("freedom");
  await expect(page.locator("#book-search-status")).toHaveText("No se encontró texto buscable en este documento.");await expect(page.locator("#search-next")).toBeDisabled();
});
for(const format of ["pdf","epub"] as const)test(`${format} selection translates only the fragment, changes target, and handles offline/provider errors`,async({page,context},info)=>{
  await mockCloud(page,true);const calls:{text:string;targetLanguage:string}[]=[];let failed=false;
  await page.route("**/functions/v1/translate-text",async route=>{const body=route.request().postDataJSON() as {text:string;targetLanguage:string};calls.push(body);
    await route.fulfill({status:failed?503:200,contentType:"application/json",body:JSON.stringify(failed?{code:"provider_unavailable"}:{text:body.targetLanguage==="FR"?"Bonjour":"Ser o no ser",detectedSourceLanguage:"EN",targetLanguage:body.targetLanguage})});});
  await page.goto("/");await login(page);await page.locator("#file-input").setInputFiles({name:`Translate.${format}`,mimeType:format==="pdf"?"application/pdf":"application/epub+zip",buffer:format==="pdf"?samplePdf():await epubFixture()});
  const selectText=(element:Element)=>{const node=element.querySelector("span")?.firstChild??element.firstChild;const range=document.createRange();range.selectNodeContents(node!);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);element.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:80,clientY:80}));};
  if(format==="pdf"){await expect(page.locator(".pdf-reading-text")).toBeVisible();await page.locator(".pdf-reading-text p").first().evaluate(selectText);}
  else{await expect(page.locator(".epub-frame iframe")).toBeVisible();await page.frameLocator(".epub-frame iframe").locator("p").first().evaluate(selectText);}
  await expect(page.locator("#selection-highlight")).toHaveCount(0);await expect(page.locator("#note-add")).toBeVisible();await page.locator("#selection-translate").click();
  // Let the mobile selection debounce elapse: it must not reopen a menu over translation.
  if(info.project.name==="android")await page.waitForTimeout(450);
  await expect(page.locator("#note-menu")).toBeHidden();
  const selected=await page.locator("#translation-original").textContent();await page.locator("#translation-submit").click();await expect(page.locator("#translation-result")).toHaveText("Ser o no ser");
  expect(calls[0]).toEqual({text:selected!.trim(),targetLanguage:"ES"});
  await page.locator("#translation-target").selectOption("FR");await expect(page.locator("#translation-result")).toHaveText("Bonjour");await expect(page.locator("#translation-language")).toContainText("inglés");
  await context.setOffline(true);await page.locator("#translation-submit").click();await expect(page.locator("#translation-status")).toHaveText("Necesitas conexión para traducir.");
  expect(calls).toHaveLength(2);await context.setOffline(false);failed=true;await page.locator("#translation-submit").click();await expect(page.locator("#translation-status")).toContainText("proveedor no está disponible");
  await page.locator("#translation-close").click();await expect(page.locator("#translation-panel")).toBeHidden();
});
test("PDF internal link and outline use temporary history and restore the true reading page",async({page})=>{
  await mockCloud(page,true);await page.goto("/");await login(page);await page.locator("#file-input").setInputFiles({name:"References.pdf",mimeType:"application/pdf",buffer:samplePdf(true,true)});
  await expect(page.locator(".pdf-reading-text")).toBeVisible();await selectReaderOption(page, "#pdf-reading-mode", "original");await page.locator("#next-button").click();
  await expect.poll(async()=>(await saved(page)).page).toBe(2);await page.locator(".pdf-internal-link").click();await expect(page.locator("#reading-return")).toHaveText("← Volver a página 2");
  expect((await saved(page)).page).toBe(2);await page.locator("#reading-return").click();await expect(page.locator("#position-label")).toContainText("2");
  await selectReaderOption(page, "#reader-toc", {label:"Chapter One"});await expect(page.locator("#reading-return")).toBeVisible();expect((await saved(page)).page).toBe(2);await page.locator("#reading-return").click();
});
test("EPUB searches across inline markup and chapters; internal links/TOC and iframe keyboard preserve the reading anchor",async({page})=>{
  await mockCloud(page,true);await page.goto("/");await login(page);await page.locator("#file-input").setInputFiles({name:"Chapters.epub",mimeType:"application/epub+zip",buffer:await multiChapterFixture()});
  await expect(page.locator(".epub-frame iframe")).toBeVisible();await expect.poll(async()=>(await saved(page)).cfi).toBeTruthy();const anchor=await saved(page);
  await page.frameLocator(".epub-frame iframe").getByText("Consultar segundo capítulo").click();await expect(page.locator("#reading-return")).toBeVisible();expect((await saved(page)).cfi).toBe(anchor.cfi);
  await page.locator("#reading-return").click();await selectReaderOption(page, "#reader-toc", {label:"Second chapter"});await expect(page.locator("#reading-return")).toBeVisible();
  await page.locator("#reading-return").click();await page.frameLocator(".epub-frame iframe").locator("body").press("Control+f");await expect(page.locator("#book-search-panel")).toBeVisible();
  await page.locator("#book-search-input").fill("FREEDOM ACROSS CHAPTERS");await expect(page.locator("#book-search-status")).toHaveText("2 resultados");
  await page.locator("#search-next").click();await expect(page.locator("#position-label")).toContainText("2");expect((await saved(page)).cfi).toBe(anchor.cfi);
  await page.locator("#book-search-close").click();await page.locator("#reading-return").click();
  await expect(page.locator("#reader-toc")).toBeEnabled();await clickReaderOption(page, "#book-search-button");await page.locator("#book-search-input").fill("Second chapter with freedom");
  await expect(page.locator("#book-search-status")).toHaveText("1 resultados");await expect(page.locator("#reading-adopt")).toBeVisible();await page.locator("#reading-adopt").click();
  await expect.poll(async()=>(await saved(page)).cfi).not.toBe(anchor.cfi);expect((await saved(page)).percentage).toBeGreaterThanOrEqual(.5);
});

test("EPUB spacing survives a new chapter, theme/font changes and reopening",async({page})=>{
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();await page.locator("#settings-page-tab").click();
  await page.locator("#line-spacing").fill("2.2");await page.locator("#line-spacing").dispatchEvent("change");
  await page.locator("#paragraph-spacing").fill("1.5");await page.locator("#paragraph-spacing").dispatchEvent("change");
  await page.locator("#file-input").setInputFiles({name:"Chapter spacing.epub",mimeType:"application/epub+zip",buffer:await multiChapterFixture()});
  const spacing=async()=>page.frameLocator(".epub-frame iframe").locator("p").first().evaluate(element=>{
    const style=getComputedStyle(element),ratio=(value:string)=>Math.round(parseFloat(value)/parseFloat(style.fontSize)*1000)/1000;return {line:ratio(style.lineHeight),paragraph:ratio(style.marginBottom)};
  });
  await expect.poll(spacing).toEqual({line:2.2,paragraph:1.5});
  await selectReaderOption(page, "#reader-toc", {label:"Second chapter"});await expect(page.locator("#reading-return")).toBeEnabled();await expect.poll(spacing).toEqual({line:2.2,paragraph:1.5});
  await clickReaderOption(page, "#larger-button");await expect.poll(spacing).toEqual({line:2.2,paragraph:1.5});
  await page.locator("#back-button").click();
  await page.locator('.nav-button[data-view="settings"]').click();await page.locator("#settings-interface-tab").click();await page.locator('[data-theme-choice="dark"]').click();
  await page.locator('.nav-button[data-view="library"]').click();await page.locator("#library-list .book-title").click();await expect.poll(spacing).toEqual({line:2.2,paragraph:1.5});
  await expect(page.frameLocator(".epub-frame iframe").locator("body")).toHaveCSS("background-color","rgb(41, 35, 34)");
});

for(const format of ["pdf","epub"] as const)test(`${format} adding a note preserves its highlight, progress and return navigation`,async({page})=>{
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:`Highlight.${format}`,mimeType:format==="pdf"?"application/pdf":"application/epub+zip",buffer:format==="pdf"?samplePdf():await epubFixture()});
  const select=(element:Element)=>{const node=element.querySelector("span")?.firstChild??element.firstChild;const range=document.createRange();range.selectNodeContents(node!);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);element.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:80,clientY:80}));};
  if(format==="pdf"){await expect(page.locator(".pdf-reading-text")).toBeVisible();await page.locator(".pdf-reading-text p").first().evaluate(select);}
  else{await expect(page.locator(".epub-frame iframe")).toBeVisible();await page.frameLocator(".epub-frame iframe").locator("p").first().evaluate(select);}
  await expect(page.locator("#selection-highlight")).toHaveCount(0);await page.locator("#note-add").click();
  await page.locator("#note-text").fill("Mi nota sobre este fragmento");await page.locator("#note-save").click();await expect(page.locator("#notes-count")).toHaveText("1");
  for(let i=0;i<2;i++){const before=await saved(page);await page.locator("#next-button").click();await expect.poll(async()=>{const after=await saved(page);return format==="epub"?after.cfi!==before.cfi:after.pdfTextOffset!==before.pdfTextOffset;}).toBe(true);}
  const anchor=await saved(page);await clickReaderOption(page, "#all-notes-button");await page.locator(".notes-go-button").click();await expect(page.locator("#reading-return")).toBeEnabled();
  const readingAnchor={page:anchor.page,cfi:anchor.cfi,percentage:anchor.percentage,...(format==="pdf"?{pdfTextOffset:anchor.pdfTextOffset}:{})};
  expect(await saved(page)).toMatchObject(readingAnchor);await expect(page.locator(".note-marker")).toHaveCount(1);await page.locator("#reading-return").click();await expect(page.locator("#reader-history")).toBeHidden();
  expect(await saved(page)).toMatchObject(readingAnchor);await page.locator("#back-button").click();await page.locator('.nav-button[data-view="library"]').click();await page.locator("#library-list .book-title").click();await expect(page.locator("#notes-count")).toHaveText("1");
  // Existing standalone highlights used the same note schema. Removing their menu action must not delete them.
  await page.locator("#back-button").click();
  // Unload the app before restoring legacy data so pending in-memory reader writes cannot replace the fixture.
  await page.route("**/__legacy-highlight-fixture",route=>route.fulfill({contentType:"text/html",body:"<html><body>Legacy fixture</body></html>"}));
  await page.goto("/__legacy-highlight-fixture");
  await page.evaluate(()=>new Promise<void>(resolve=>{const request=indexedDB.open("autumn-reader");request.onsuccess=()=>{
    const db=request.result,tx=db.transaction("books","readwrite"),store=tx.objectStore("books"),read=store.getAll();
    read.onsuccess=()=>{for(const book of read.result)if(book.notes?.length){book.notes[0].text="Resaltado";store.put(book);}};
    tx.oncomplete=()=>{db.close();resolve();};
  };}));
  await page.goto("/");await page.locator('.nav-button[data-view="library"]').click();await page.locator("#library-list .book-title").click();
  await expect(page.locator("#notes-count")).toHaveText("1");await clickReaderOption(page, "#all-notes-button");
  await expect(page.locator("#all-notes-list")).toContainText("Resaltado");
});
for(const format of ["pdf","epub"] as const)test(`saved note appearance is selected in settings and applied to ${format.toUpperCase()} notes`,async({page})=>{
  await mockCloud(page,true);await page.addInitScript(()=>{localStorage.setItem("autumn-language","es");localStorage.setItem("autumn-note-style","strikethrough");});await page.goto("/");await login(page);
  await page.locator('.nav-button[data-view="settings"]').click();await page.locator("#settings-interface-tab").click();
  await expect(page.locator('[data-note-style="strikethrough"]')).toHaveAttribute("aria-pressed","true");
  await page.locator("#file-input").setInputFiles({name:`Note style.${format}`,mimeType:format==="pdf"?"application/pdf":"application/epub+zip",buffer:format==="pdf"?samplePdf():await epubFixture()});
  const select=(element:Element)=>{const node=element.querySelector("span")?.firstChild??element.firstChild;const range=document.createRange();range.selectNodeContents(node!);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);element.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:80,clientY:80}));};
  if(format==="pdf"){await expect(page.locator(".pdf-reading-text")).toBeVisible();await page.locator(".pdf-reading-text p").first().evaluate(select);}
  else{await expect(page.locator(".epub-frame iframe")).toBeVisible();await page.frameLocator(".epub-frame iframe").locator("p").first().evaluate(select);}
  await page.locator("#note-add").click();await page.locator("#note-text").fill("Nota con estilo");await page.locator("#note-save").click();
  await expect(page.locator(format==="pdf"?'.note-highlight[data-note-style="strikethrough"]':'g[ref="autumn-note-strikethrough"]')).toHaveCount(1);
});
for(const format of ["pdf","epub"] as const)test(`${format} note accepts blue and custom colours, edits and reopens with its saved colour`,async({page},info)=>{
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:`Colour.${format}`,mimeType:format==="pdf"?"application/pdf":"application/epub+zip",buffer:format==="pdf"?samplePdf():await epubFixture()});
  const select=(element:Element)=>{const node=element.querySelector("span")?.firstChild??element.firstChild;const range=document.createRange();range.selectNodeContents(node!);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);element.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:80,clientY:80}));};
  if(format==="pdf"){await expect(page.locator(".pdf-reading-text")).toBeVisible();await page.locator(".pdf-reading-text p").first().evaluate(select);}
  else{await expect(page.locator(".epub-frame iframe")).toBeVisible();await page.frameLocator(".epub-frame iframe").locator("p").first().evaluate(select);}
  await page.locator("#note-add").click();await page.locator(".note-color").nth(7).click();
  await expect(page.locator(".note-color").nth(7)).toHaveAttribute("aria-pressed","true");
  await page.locator("#note-custom-color").fill("#61b7f3");await page.locator("#note-text").fill("Color propio");
  await page.screenshot({path:info.outputPath(`${format}-note-colours.png`)});
  await page.locator("#note-save").click();await expect(page.locator("#notes-count")).toHaveText("1");
  const colour=()=>page.evaluate(()=>new Promise<string>(resolve=>{const request=indexedDB.open("autumn-reader");request.onsuccess=()=>{const db=request.result,tx=db.transaction("books"),all=tx.objectStore("books").getAll();all.onsuccess=()=>resolve(all.result.find((book:{notes?:{color:string}[]})=>book.notes?.length)?.notes[0].color??"");tx.oncomplete=()=>db.close();};}));
  const markerColour=()=>page.locator(".note-marker").evaluate(element=>getComputedStyle(element).getPropertyValue("--note-marker-color").trim());
  await expect.poll(colour).toBe("#61b7f3");await expect.poll(markerColour).toBe("#61b7f3");
  await page.locator(".note-marker").click();await expect(page.locator("#note-custom-color")).toHaveValue("#61b7f3");
  await page.locator(".note-color").nth(9).click();await page.locator("#note-save").click();await expect.poll(colour).toBe("#8854ba");
  await page.locator("#back-button").click();await page.locator('.nav-button[data-view="library"]').click();await page.locator("#library-list .book-title").click();
  await expect.poll(markerColour,{timeout:10_000}).toBe("#8854ba");
});
