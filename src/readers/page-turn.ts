/** Snapshot only the current rendered page. No second book, file download or
 * screenshot library; the live reader renders the adjacent page underneath. */
export function pageSnapshot(source: HTMLElement, parent: HTMLElement): HTMLElement {
  const rect=source.getBoundingClientRect(),bounds=parent.getBoundingClientRect();
  const clone=source.cloneNode(true) as HTMLElement;
  clone.classList.add("page-turn-snapshot");clone.removeAttribute("id");clone.setAttribute("aria-hidden","true");
  clone.style.cssText+=`;position:absolute;left:${rect.left-bounds.left+parent.scrollLeft}px;top:${rect.top-bounds.top+parent.scrollTop}px;width:${rect.width}px;height:${rect.height}px;min-height:0;pointer-events:none;z-index:8`;
  clone.querySelectorAll("[id]").forEach(e=>e.removeAttribute("id"));
  parent.append(clone);
  const originalCanvases=[...source.querySelectorAll("canvas")];
  [...clone.querySelectorAll("canvas")].forEach((canvas,i)=>{const original=originalCanvases[i];canvas.width=original.width;canvas.height=original.height;canvas.getContext("2d")?.drawImage(original,0,0);});
  const originalElements=[source,...source.querySelectorAll<HTMLElement>("*")],elements=[clone,...clone.querySelectorAll<HTMLElement>("*")];
  elements.forEach((el,i)=>{const original=originalElements[i];if(original){el.scrollLeft=original.scrollLeft;el.scrollTop=original.scrollTop;}});
  return clone;
}
/** A small perspective bend at the middle of a turn; both ends lie flat. */
export function pageTurnSheetTransform(x:number,width:number,direction:-1|1):string {
  const progress=Math.min(1,Math.abs(x)/Math.max(1,width));
  const angle=-direction*Math.sin(Math.PI*progress)*2.4;
  return `translate3d(${x}px,0,0) rotateY(${angle.toFixed(2)}deg)`;
}
export async function slide(element: HTMLElement,x:number,duration:number,sheet?:{width:number;direction:-1|1}):Promise<void>{
  if(!duration||typeof element.animate!=="function"){element.style.transform=`translate3d(${x}px,0,0)`;return;}
  const from=element.style.transform||"translate3d(0,0,0)",to=`translate3d(${x}px,0,0)`;
  const startX=Number(from.match(/translate3d\(([-\d.]+)px/)?.[1]??0);
  const frames=sheet?[{transform:from},{transform:pageTurnSheetTransform((startX+x)/2,sheet.width,sheet.direction),offset:.55},{transform:to}]:[{transform:from},{transform:to}];
  // The old curve travelled most of a page in the first few frames, making the
  // turn look instantaneous on a 60 Hz WebView even though WAAPI was running.
  const animation=element.animate(frames,{duration,easing:"cubic-bezier(.42,0,.28,1)",fill:"forwards"});
  await animation.finished.catch(()=>{});element.style.transform=`translate3d(${x}px,0,0)`;animation.cancel();
}
