import {test,expect} from "@playwright/test";
import {login,mockCloud,multiChapterFixture} from "./helpers/cloud";

// CFIs alone cannot detect an intermediate page flash. Compare actual visible
// words and their layout in each mounted page before, during and after a drag.
for(const hidden of [false,true])test(`EPUB visual content stays fixed while held and across release (hidden chrome ${hidden})`,async({page},info)=>{
  test.skip(info.project.name!=="android");
  await mockCloud(page,true);await page.goto("/");await login(page);
  await page.locator("#file-input").setInputFiles({name:"Visual.epub",mimeType:"application/epub+zip",buffer:await multiChapterFixture()});
  await expect(page.locator("#reader-content iframe")).toBeVisible();
  if(hidden){
    await expect(page.locator("#view-reader")).toHaveClass(/controls-hidden/,{timeout:10000});
    // Exercise the chapter edge too: the destination then has a different
    // document, which is where speculative previews used to flash other pages.
    for(let n=0;n<20&&!/^Section 2\b/.test(await page.locator("#position-label").innerText());n++){
      await page.locator("#next-button").evaluate(el=>(el as HTMLButtonElement).click());
      await expect(page.locator(".page-turn-preview")).toHaveCount(0);
    }
    await expect(page.locator("#position-label")).toContainText("Section 2");
    await page.locator("#previous-button").evaluate(el=>(el as HTMLButtonElement).click());
    await expect(page.locator(".page-turn-preview")).toHaveCount(0);
    await expect(page.locator("#position-label")).toContainText("Section 1");
  }
  const signature=async(selector:string)=>page.locator(selector).evaluate(el=>{
    const frame=el.querySelector("iframe")!,doc=frame.contentDocument!,clip=el.querySelector(".epub-frame")!.getBoundingClientRect(),bounds=frame.getBoundingClientRect();
    const words:string[]=[];const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode())for(const match of (node.textContent??"").matchAll(/\S+/g)){
      const range=doc.createRange();range.setStart(node,match.index!);range.setEnd(node,match.index!+match[0].length);
      const r=range.getBoundingClientRect(),x=r.left+bounds.left-clip.left,y=r.top+bounds.top-clip.top;
      if(x>=-1&&x<clip.width-1&&y>=-1&&y<clip.height-1)words.push(`${match[0]}:${Math.round(x)}:${Math.round(y)}`);
    }return words;
  });
  const c=await page.context().newCDPSession(page);
  for(const [index,direction] of [1,1,-1,1].entries()){
    const cached=`.epub-adjacent-page[data-direction="${direction}"][data-ready="true"]`;
    await expect(page.locator(cached)).toHaveCount(1);
    if(hidden&&index===0)expect(await page.locator(cached+" iframe").evaluate(el=>(el as HTMLIFrameElement).contentDocument?.body.textContent)).toContain("Second chapter");
    const origin=await signature("#reader-content"),destination=await signature(cached);
    expect(origin.length).toBeGreaterThan(15);expect(destination.length).toBeGreaterThan(15);
    await page.evaluate(selector=>{
      const nodes=[document.querySelector('#reader-content')!,document.querySelector(selector)!];
      const layout=(el:Element)=>{const frame=el.querySelector('iframe')!,doc=frame.contentDocument!,stage=el.querySelector('.epub-container')!;
        return JSON.stringify({text:doc.body.textContent,scroll:stage.scrollLeft,width:stage.clientWidth,height:stage.clientHeight,font:getComputedStyle(doc.body).fontSize});};
      const expected=nodes.map(layout),failures:string[]=[];
      const state={active:true,frames:0,failures};
      (window as unknown as {visualTurn:typeof state}).visualTurn=state;
      const sample=()=>{if(!state.active)return;state.frames++;nodes.forEach((node,i)=>{if(node.isConnected&&getComputedStyle(node).visibility==='visible'&&layout(node)!==expected[i])failures.push(`Page ${i} changed in frame ${state.frames}`);});requestAnimationFrame(sample);};
      requestAnimationFrame(sample);
    },cached);
    const r=(await page.locator("#reading-surface").boundingBox())!,x=r.x+r.width*(direction===1?.75:.25),y=r.y+r.height*.5;
    await c.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
    for(const distance of [.08,.3,.18,.4]){
      await c.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x-direction*r.width*distance,y}]});
      await expect.poll(()=>signature("#reader-content")).toEqual(origin);
      await expect.poll(()=>signature(".page-turn-preview")).toEqual(destination);
    }
    await page.screenshot({path:info.outputPath(`held-${index}.png`)});
    await c.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await expect(page.locator(".page-turn-preview")).toHaveCount(0);
    await expect.poll(()=>signature("#reader-content")).toEqual(destination);
    await page.waitForTimeout(150);
    expect(await signature("#reader-content")).toEqual(destination);
    const samples=await page.evaluate(()=>{const s=(window as unknown as {visualTurn:{active:boolean;frames:number;failures:string[]}}).visualTurn;s.active=false;return {frames:s.frames,failures:s.failures};});
    expect(samples.frames).toBeGreaterThan(5);expect(samples.failures).toEqual([]);
  }
});
