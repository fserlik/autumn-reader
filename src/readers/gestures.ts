export class SwipeGesture {
  private startPoint: { x:number; y:number; time:number; width:number } | undefined;
  private axis: "pending" | "horizontal" | "cancelled" = "pending";
  constructor(private readonly compactTouch = false) {}
  begin(x:number,y:number,time:number,width:number,blocked=false): boolean {
    this.startPoint = blocked ? undefined : {x,y,time,width}; this.axis="pending"; return Boolean(this.startPoint);
  }
  move(x:number,y:number,time:number,selection=false): number | undefined {
    if (!this.startPoint || this.axis === "cancelled") return;
    const dx=x-this.startPoint.x,dy=y-this.startPoint.y;
    if (selection || (this.axis === "pending" && time-this.startPoint.time>350) || (this.axis === "pending" && Math.abs(dy)>10 && Math.abs(dy)>Math.abs(dx)*.85)) { this.axis="cancelled"; return; }
    if (this.axis === "pending" && Math.abs(dx)>12 && Math.abs(dx)>Math.abs(dy)*1.4) this.axis="horizontal";
    return this.axis === "horizontal" ? dx : undefined;
  }
  finish(x:number,y:number,time:number): { kind:"tap"|"swipe"|"cancel"; direction:-1|1; distance:number; commit:boolean } {
    const start=this.startPoint; this.startPoint=undefined;
    if (!start) return {kind:"cancel",direction:1,distance:0,commit:false};
    const dx=x-start.x,dy=y-start.y,elapsed=time-start.time,direction=dx<0?1:-1;
    const distance = Math.abs(dx);
    const threshold = this.compactTouch ? Math.max(32,Math.min(64,start.width*.12)) : Math.max(48,Math.min(120,start.width*.18));
    const flick = this.compactTouch ? distance>28 && distance/Math.max(1,elapsed)>.45
      : distance>36 && distance/Math.max(1,elapsed)>.5;
    const commit=this.axis==="horizontal" && distance>Math.abs(dy)*1.2 && (distance>threshold || flick);
    const kind=this.axis==="horizontal"?"swipe":this.axis==="pending"&&elapsed<350&&Math.abs(dx)<12&&Math.abs(dy)<12?"tap":"cancel";
    return {kind,direction,distance:dx,commit};
  }
  cancel(): void { this.axis="cancelled"; }
}
export interface GestureCallbacks {
  blocked(ownGesture?: boolean): boolean; start(direction:-1|1): void; drag(dx:number): void;
  end(commit:boolean,direction:-1|1): void; tap(direction:-1|1): void;
  neutralTap?(): void;
  /** Mobile recognizes the gesture without moving or replacing the live page. */
  discrete?: boolean;
}
/** Touch listeners also run in EPUB iframes. System edges use screen coordinates,
 * not the book iframe's local edge. Horizontal locking leaves vertical scroll and long press alone. */
export function bindPageGestures(target: Document|HTMLElement,getSelection:()=>Selection|null,callbacks:GestureCallbacks):()=>void {
  const coarse=window.matchMedia("(pointer: coarse)").matches;
  const discrete=callbacks.discrete ?? coarse;
  const controller=new AbortController(),gesture=new SwipeGesture(coarse); let active=false,dragging=false,startX=0;
  let dragDirection: -1|1 = 1, idleTimer: number | undefined, pointerId: number | undefined, lastX=0,lastY=0;
  const touchWindow = "documentElement" in target ? target.defaultView : target.ownerDocument.defaultView;
  const clearIdle = (): void => { if (idleTimer !== undefined) touchWindow?.clearTimeout(idleTimer); idleTimer=undefined; };
  const releasePointer = (): void => {
    if (pointerId !== undefined && "setPointerCapture" in target && target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    pointerId=undefined;
  };
  const cancelDrag = (): void => {
    if (!active) return;
    clearIdle(); releasePointer(); gesture.cancel(); active=false;
    if (dragging) callbacks.end(false,dragDirection);
    dragging=false;
  };
  const finishAt = (x:number,y:number): void => {
    if(!active)return;
    active=false;clearIdle();releasePointer();
    const result=gesture.finish(x,y,performance.now());
    if(dragging){
      if (discrete && (callbacks.blocked(true) || getSelection()?.isCollapsed===false)) callbacks.end(false,result.direction);
      else callbacks.end(result.commit,result.direction);
      dragging=false;return;
    }
    if(result.kind==="tap"&&!callbacks.blocked()&&getSelection()?.isCollapsed!==false){
      const v=viewport(),localX=startX-v.left,edge=Math.min(120,v.width*.25);
      if(localX<edge)callbacks.tap(-1);else if(localX>v.width-edge)callbacks.tap(1);else callbacks.neutralTap?.();
    }
  };
  const armIdle = (): void => {
    clearIdle();
    // If WebView loses both terminal events after replacing a PDF page, finish
    // the last intentional drag instead of always snapping a valid turn back.
    idleTimer=touchWindow?.setTimeout(()=>finishAt(lastX,lastY),1500);
  };
  const viewport=(): {width:number;left:number} => {
    if ("documentElement" in target) {
      const frame=target.defaultView?.frameElement as HTMLElement|null;
      return {width:target.documentElement.clientWidth,left:frame?.getBoundingClientRect().left??0};
    }
    return {width:target.clientWidth,left:target.getBoundingClientRect().left};
  };
  const screenX = (touch: Touch): number => touch.clientX + ("documentElement" in target ? viewport().left : 0);
  const pointerX = (event: PointerEvent): number => event.clientX + ("documentElement" in target ? viewport().left : 0);
  target.addEventListener("touchstart",event=>{
    const e=event as TouchEvent,v=viewport(),touch=e.touches[0];
    if(!touch)return;
    const globalX="documentElement" in target?touch.clientX+v.left:touch.clientX;
    const selected=getSelection()?.isCollapsed===false;
    const interactive=Boolean((event.target as Element|null)?.closest?.("a,button,input,textarea,select,[role='button'],[contenteditable='true']"));
    cancelDrag();
    // EPUB's iframe can lay out wider than the visible WebView. Use the
    // visible width so a short phone swipe keeps the same threshold as PDF.
    active=gesture.begin(globalX,touch.clientY,performance.now(),Math.min(v.width,window.innerWidth),e.touches.length!==1||callbacks.blocked()||selected||interactive||globalX<28||globalX>window.innerWidth-28);
    dragging=false;startX=lastX=globalX;lastY=touch.clientY;
  },{passive:true,signal:controller.signal});
  target.addEventListener("touchmove",event=>{
    if(!active)return;const e=event as TouchEvent,touch=e.touches[0];
    if(e.touches.length!==1||!touch){cancelDrag();return;}
    const dx=gesture.move(screenX(touch),touch.clientY,performance.now(),getSelection()?.isCollapsed===false);
    if(dx===undefined){if(dragging)cancelDrag();return;}
    lastX=screenX(touch);lastY=touch.clientY;
    if(!dragging){
      dragging=true;dragDirection=dx<0?1:-1;
      if(discrete) callbacks.start(dragDirection);
      else {
        if(pointerId!==undefined && "setPointerCapture" in target) try { target.setPointerCapture(pointerId); } catch { /* The touch may already have ended. */ }
        callbacks.start(dragDirection);
      }
    }
    if(!discrete)armIdle();if(e.cancelable)e.preventDefault();if(!discrete)callbacks.drag(dx);
  },{passive:false,signal:controller.signal});
  const finish = (event: Event): void => {
    if(!active)return;const touch=(event as TouchEvent).changedTouches[0];if(!touch){cancelDrag();return;}
    finishAt(screenX(touch),touch.clientY);
  };
  if ("setPointerCapture" in target) {
    target.addEventListener("pointerdown",event=>{if((event as PointerEvent).pointerType==="touch")pointerId=(event as PointerEvent).pointerId;},{passive:true,signal:controller.signal});
    touchWindow?.addEventListener("pointermove",event=>{
      const e=event as PointerEvent;
      if(!active||!dragging||e.pointerId!==pointerId||e.clientX===lastX&&e.clientY===lastY)return;
      const globalX=pointerX(e);
      const dx=gesture.move(globalX,e.clientY,performance.now(),getSelection()?.isCollapsed===false);
      if(dx===undefined){cancelDrag();return;}
      lastX=globalX;lastY=e.clientY;if(!discrete){armIdle();callbacks.drag(dx);}
    },{passive:true,signal:controller.signal});
    touchWindow?.addEventListener("pointerup",event=>{const e=event as PointerEvent;if(e.pointerId===pointerId)finishAt(pointerX(e),e.clientY);},{passive:true,signal:controller.signal});
    touchWindow?.addEventListener("pointercancel",event=>{if((event as PointerEvent).pointerId===pointerId)cancelDrag();},{passive:true,signal:controller.signal});
  }
  target.addEventListener("touchend",finish,{passive:true,signal:controller.signal});
  touchWindow?.addEventListener("touchend",finish,{passive:true,signal:controller.signal});
  target.addEventListener("touchcancel",cancelDrag,{passive:true,signal:controller.signal});
  touchWindow?.addEventListener("touchcancel",cancelDrag,{passive:true,signal:controller.signal});
  touchWindow?.addEventListener("blur",cancelDrag,{signal:controller.signal});
  return ()=>{clearIdle();controller.abort();};
}
