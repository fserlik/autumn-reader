import { test, expect } from "@playwright/test";
import { epubFixture, login, mockCloud } from "./helpers/cloud";
import JSZip from "jszip";
import { samplePdf } from "./helpers/pdf";
import { selectReaderOption } from "./helpers/reader-options";

test("a one-page EPUB cannot turn past either book boundary",async({page},info)=>{
  test.skip(info.project.name!=="android");
  const zip=await JSZip.loadAsync(await epubFixture("single","Single"));
  zip.file("OEBPS/chapter.xhtml",'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Only page</title></head><body><p>A single page of text.</p></body></html>');
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:"Single.epub",mimeType:"application/epub+zip",buffer:await zip.generateAsync({type:"nodebuffer"})});
  await expect(page.locator("#reader-content iframe")).toBeVisible();
  const initial=await page.locator("#position-label").innerText();
  const c=await page.context().newCDPSession(page),r=(await page.locator("#reading-surface").boundingBox())!,y=r.y+r.height*.5;
  for(const direction of [1,-1]){
    const x=r.x+r.width*(direction===1?.75:.25);
    await c.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
    for(const dx of [30,70,130])await c.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x-direction*dx,y}]});
    await c.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await expect(page.locator(".page-turn-preview")).toHaveCount(0);
    expect(await page.locator("#position-label").innerText()).toBe(initial);
  }
});

for (const mode of ["text","original"] as const) test(`PDF ${mode}: one gesture matches one button and respects book limits`,async({page},info)=>{
  test.skip(info.project.name!=="android");
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:"Exact.pdf",mimeType:"application/pdf",buffer:samplePdf()});
  await expect(page.locator("#reader-content .pdf-reading-text")).toBeVisible();
  if(mode==="original"){await selectReaderOption(page,"#pdf-reading-mode",mode);await expect(page.locator("#position-label")).not.toContainText("·");}
  const read=()=>page.evaluate(mode=>new Promise<string>(resolve=>{const req=indexedDB.open("autumn-reader");req.onsuccess=()=>{const db=req.result,r=db.transaction("books").objectStore("books").getAll();r.onsuccess=()=>{const b=r.result[0];resolve(JSON.stringify([b.page,mode==="original"?null:b.pdfTextOffset]));db.close()}}}),mode);
  const initial=await read(),positions=[initial];
  for(let i=0;i<2;i++){await page.locator("#next-button").click();await expect(page.locator(".page-turn-snapshot")).toHaveCount(0);positions.push(await read());}
  for(let i=0;i<2;i++){await page.locator("#previous-button").click();await expect(page.locator(".page-turn-snapshot")).toHaveCount(0);}
  await expect.poll(read).toBe(initial);
  const c=await page.context().newCDPSession(page);
  const swipe=async(direction:number)=>{
    const r=(await page.locator("#reading-surface").boundingBox())!,x=r.x+r.width*(direction===1?.75:.25),y=r.y+r.height*.5;
    const before=await read(),label=await page.locator("#position-label").innerText();
    await c.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
    for(const dx of [30,r.width*.3])await c.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x-direction*dx,y}]});
    expect(await read()).toBe(before);expect(await page.locator("#position-label").innerText()).toBe(label);
    await c.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await expect(page.locator(".page-turn-snapshot")).toHaveCount(0);
  };
  // A backwards gesture at the first page has no effect.
  await swipe(-1);expect(await read()).toBe(initial);
  for(const position of positions.slice(1)){await swipe(1);await expect.poll(read).toBe(position);}
  if(mode==="original"){await expect(page.locator("#next-button")).toBeDisabled();await swipe(1);expect(await read()).toBe(positions[2]);}
  for(const position of positions.slice(0,-1).reverse()){await swipe(-1);await expect.poll(read).toBe(position);}
});

test("fresh cached EPUB pages have the same CFI sequence as the real reader", async ({ page, context }, info) => {
  test.skip(info.project.name !== "android");
  await context.addInitScript(()=>localStorage.setItem("autumn-page-spacing",JSON.stringify({margins:"wide",font:"georgia",lineHeight:2,paragraphSpacing:1.2})));
  const zip = await JSZip.loadAsync(await epubFixture("sequence","Sequence"));
  const chapter = await zip.file("OEBPS/chapter.xhtml")!.async("string");
  zip.file("OEBPS/chapter.xhtml",chapter.replace("</head>","<style>body {font-size:1em;line-height:1.8} p {margin:1em 0}</style></head>").replaceAll("offline.", "offline. " + "A longer paragraph with variable words, wrapping naturally across the reading area. ".repeat(9)));
  const buffer = await zip.generateAsync({type:"nodebuffer"});
  const control = await context.newPage();
  for (const p of [control,page]) {
    await p.setViewportSize({width:375,height:844}); await mockCloud(p,true); await p.goto("/");
  }
  await login(control);
  const read = (p: typeof page) => p.evaluate(()=>new Promise<string>(resolve=>{const req=indexedDB.open("autumn-reader"); req.onsuccess=()=>{const db=req.result,read=db.transaction("books").objectStore("books").getAll(); read.onsuccess=()=>{resolve(read.result[0].cfi);db.close()}}}));
  await control.locator("#file-input").setInputFiles({name:"Sequence.epub",mimeType:"application/epub+zip",buffer});
  await expect(control.locator("#reader-content iframe")).toBeVisible();
  const initial = await read(control), expected=[];
  for(let i=0;i<4;i++){await control.locator("#next-button").click();await expect(control.locator(".page-turn-preview")).toHaveCount(0);expected.push(await read(control));}
  await control.close();
  // Same account/storage, explicitly reopen at the initial chapter location.
  await page.evaluate(()=>new Promise<void>(resolve=>{const req=indexedDB.open("autumn-reader");req.onsuccess=()=>{const db=req.result,tx=db.transaction("books","readwrite"),s=tx.objectStore("books"),r=s.getAll();r.onsuccess=()=>{for(const b of r.result){b.cfi=null;b.percentage=0;s.put(b)}};tx.oncomplete=()=>{db.close();resolve()}}}));
  await page.reload();
  await page.locator('.nav-button[data-view="library"]').click();
  await page.locator('.book-card').first().click();
  await expect(page.locator("#reader-content iframe")).toBeVisible();
  const c=await page.context().newCDPSession(page);
  const actual=[];
  for(let i=0;i<4;i++){
    await expect(page.locator('.epub-adjacent-page[data-direction="1"][data-ready="true"]')).toHaveCount(1);
    const r=(await page.locator("#reading-surface").boundingBox())!,x=r.x+r.width*.75,y=r.y+r.height*.5;
    await c.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
    const before = await read(page);
    for(const dx of [30,70,i===2?r.width*.65:140]) { await c.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x-dx,y}]}); if(i===0) await page.waitForTimeout(80); }
    expect(await read(page)).toBe(before);
    await c.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await page.locator("#reading-surface").evaluate(el=>{el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerType:"touch",pointerId:1}));el.dispatchEvent(new TouchEvent("touchend",{bubbles:true}));el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));});
    await expect(page.locator(".page-turn-preview")).toHaveCount(0);await page.waitForTimeout(650);actual.push(await read(page));
  }
  expect(actual).toEqual(expected);
  for(const destination of [...expected.slice(0,-1).reverse(),initial]){
    await expect(page.locator('.epub-adjacent-page[data-direction="-1"][data-ready="true"]')).toHaveCount(1);
    const r=(await page.locator("#reading-surface").boundingBox())!,x=r.x+r.width*.25,y=r.y+r.height*.5;
    await c.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
    for(const dx of [30,70,140]) await c.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+dx,y}]});
    await c.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await expect(page.locator(".page-turn-preview")).toHaveCount(0);
    await expect.poll(()=>read(page)).toBe(destination);
  }
});

test("EPUB drag lands on the exact same page as a single button press", async ({ page }, info) => {
  test.skip(info.project.name !== "android");
  await page.setViewportSize({width:375,height:844});
  await mockCloud(page,true); await page.goto("/"); await login(page);
  await page.locator("#file-input").setInputFiles({name:"Exact.epub",mimeType:"application/epub+zip",buffer:await epubFixture("exact","Exact")});
  await expect(page.locator("#reader-content iframe")).toBeVisible();
  const label = () => page.locator("#position-label").innerText();
  const origin = await label();
  await page.locator("#next-button").click();
  await expect.poll(label).not.toBe(origin);
  await expect(page.locator(".page-turn-preview")).toHaveCount(0);
  const expected = await label();
  await page.locator("#previous-button").click();
  await expect.poll(label).toBe(origin);
  await expect(page.locator(".page-turn-preview")).toHaveCount(0);
  await expect(page.locator('.epub-adjacent-page[data-ready="true"]')).toHaveCount(2);
  const rect=(await page.locator("#reading-surface").boundingBox())!, x=rect.x+rect.width*.75,y=rect.y+rect.height*.5;
  const c=await page.context().newCDPSession(page);
  await c.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
  for(const dx of [30,70,140]) await c.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x-dx,y}]});
  expect(await label()).toBe(origin);
  await c.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await expect(page.locator(".page-turn-preview")).toHaveCount(0);
  await expect.poll(label).toBe(expected);
});
