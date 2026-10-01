export class SwipeGesture {
  private startPoint: { x:number; y:number; time:number; width:number } | undefined;
  private axis: "pending" | "horizontal" | "cancelled" = "pending";
  begin(x:number,y:number,time:number,width:number,blocked=false): boolean {
    this.startPoint = blocked ? undefined : {x,y,time,width}; this.axis="pending"; return Boolean(this.startPoint);
  }
  move(x:number,y:number,time:number,selection=false): number | undefined {
    if (!this.startPoint || this.axis === "cancelled") return;
    const dx=x-this.startPoint.x,dy=y-this.startPoint.y;
    if (selection || (this.axis === "pending" && time-this.startPoint.time>350) || (Math.abs(dy)>10 && Math.abs(dy)>Math.abs(dx)*.85)) { this.axis="cancelled"; return; }
    if (this.axis === "pending" && Math.abs(dx)>12 && Math.abs(dx)>Math.abs(dy)*1.4) this.axis="horizontal";
    return this.axis === "horizontal" ? dx : undefined;
  }
  finish(x:number,y:number,time:number): { kind:"tap"|"swipe"|"cancel"; direction:-1|1; distance:number; commit:boolean } {
    const start=this.startPoint; this.startPoint=undefined;
    if (!start) return {kind:"cancel",direction:1,distance:0,commit:false};
    const dx=x-start.x,dy=y-start.y,elapsed=time-start.time,direction=dx<0?1:-1;
    const commit=this.axis==="horizontal" && Math.abs(dx)>Math.max(48,Math.min(120,start.width*.18)) || this.axis==="horizontal" && Math.abs(dx)>36 && Math.abs(dx)/Math.max(1,elapsed)>.5;
    const kind=this.axis==="horizontal"?"swipe":this.axis==="pending"&&elapsed<350&&Math.abs(dx)<12&&Math.abs(dy)<12?"tap":"cancel";
    return {kind,direction,distance:dx,commit};
  }
  cancel(): void { this.axis="cancelled"; }
}
export interface GestureCallbacks {
  blocked(): boolean; start(direction:-1|1): void; drag(dx:number): void;
  end(commit:boolean,direction:-1|1): void; tap(direction:-1|1): void;
}
/** Touch listeners also run in EPUB iframes. System edges use screen coordinates,
 * not the book iframe's local edge. Horizontal locking leaves vertical scroll and long press alone. */
export function bindPageGestures(target: Document|HTMLElement,getSelection:()=>Selection|null,callbacks:GestureCallbacks):()=>void {
  const controller=new AbortController(),gesture=new SwipeGesture(); let active=false,dragging=false,startX=0;
  const viewport=(): {width:number;left:number} => {
    if ("documentElement" in target) {
      const frame=target.defaultView?.frameElement as HTMLElement|null;
      return {width:target.documentElement.clientWidth,left:frame?.getBoundingClientRect().left??0};
    }
    return {width:target.clientWidth,left:target.getBoundingClientRect().left};
  };
  const screenX = (touch: Touch): number => touch.clientX + ("documentElement" in target ? viewport().left : 0);
  target.addEventListener("touchstart",event=>{
    const e=event as TouchEvent,v=viewport(),touch=e.touches[0];
    if(!touch)return;
    const globalX="documentElement" in target?touch.clientX+v.left:touch.clientX;
    const selected=getSelection()?.isCollapsed===false;
    const interactive=Boolean((event.target as Element|null)?.closest?.("a,button,input,textarea,select,[role='button'],[contenteditable='true']"));
    active=gesture.begin(globalX,touch.clientY,performance.now(),v.width,e.touches.length!==1||callbacks.blocked()||selected||interactive||globalX<28||globalX>window.innerWidth-28);
    dragging=false;startX=globalX;
  },{passive:true,signal:controller.signal});
  target.addEventListener("touchmove",event=>{
    if(!active)return;const e=event as TouchEvent,touch=e.touches[0];
    if(e.touches.length!==1||!touch){gesture.cancel();if(dragging)callbacks.end(false,1);active=false;return;}
    const dx=gesture.move(screenX(touch),touch.clientY,performance.now(),getSelection()?.isCollapsed===false);
    if(dx===undefined){if(dragging){callbacks.end(false,1);active=false;}return;}
    if(!dragging){dragging=true;callbacks.start(dx<0?1:-1);}
    if(e.cancelable)e.preventDefault();callbacks.drag(dx);
  },{passive:false,signal:controller.signal});
  target.addEventListener("touchend",event=>{
    if(!active)return;active=false;const touch=(event as TouchEvent).changedTouches[0];if(!touch)return;
    const result=gesture.finish(screenX(touch),touch.clientY,performance.now());
    if(dragging){callbacks.end(result.commit,result.direction);dragging=false;return;}
    if(result.kind==="tap"&&!callbacks.blocked()&&getSelection()?.isCollapsed!==false){
      const v=viewport(),x=startX-v.left,edge=Math.min(120,v.width*.25);
      if(x<edge)callbacks.tap(-1);else if(x>v.width-edge)callbacks.tap(1);
    }
  },{passive:true,signal:controller.signal});
  target.addEventListener("touchcancel",()=>{gesture.cancel();if(dragging)callbacks.end(false,1);active=dragging=false;},{passive:true,signal:controller.signal});
  return ()=>controller.abort();
}
