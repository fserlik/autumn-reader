import { test, expect } from "vitest";
import { SwipeGesture } from "../../src/readers/gestures";
test("swipe follows horizontally and commits distance/velocity only at release",()=>{
  const gesture=new SwipeGesture();gesture.begin(300,100,0,390);expect(gesture.move(250,103,100)).toBe(-50);
  expect(gesture.finish(180,104,300)).toMatchObject({kind:"swipe",direction:1,commit:true});
  gesture.begin(100,100,0,390);gesture.move(160,101,80);expect(gesture.finish(160,101,90)).toMatchObject({direction:-1,commit:true});
});
test("short swipe snaps back and vertical scroll, selection, long press and system edge do not navigate",()=>{
  const gesture=new SwipeGesture();gesture.begin(300,100,0,390);gesture.move(275,102,100);expect(gesture.finish(275,102,400).commit).toBe(false);
  gesture.begin(300,100,0,390);expect(gesture.move(285,150,100)).toBeUndefined();expect(gesture.finish(200,180,200).commit).toBe(false);
  gesture.begin(300,100,0,390);expect(gesture.move(220,100,100,true)).toBeUndefined();expect(gesture.finish(150,100,200).commit).toBe(false);
  gesture.begin(300,100,0,390);expect(gesture.move(220,100,500)).toBeUndefined();expect(gesture.finish(150,100,600).commit).toBe(false);
  expect(gesture.begin(10,100,0,390,true)).toBe(false);expect(gesture.finish(150,100,100).commit).toBe(false);
});
test("a rightward page turn stays locked after later vertical finger drift",()=>{
  const gesture=new SwipeGesture();
  gesture.begin(110,200,0,390);
  expect(gesture.move(134,201,30)).toBe(24);
  expect(gesture.move(152,251,80)).toBe(42);
  expect(gesture.move(250,240,180)).toBe(140);
  expect(gesture.finish(250,240,210)).toMatchObject({kind:"swipe",direction:-1,commit:true});
});
test("coarse touch commits a short intentional swipe in either direction while desktop keeps its threshold",()=>{
  const mobile=new SwipeGesture(true), desktop=new SwipeGesture(false);
  mobile.begin(250,100,0,390);expect(mobile.move(199,102,100)).toBe(-51);
  expect(mobile.finish(199,102,180)).toMatchObject({direction:1,commit:true});
  mobile.begin(100,100,0,390);expect(mobile.move(151,102,100)).toBe(51);
  expect(mobile.finish(151,102,180)).toMatchObject({direction:-1,commit:true});
  desktop.begin(250,100,0,390);desktop.move(199,102,100);
  expect(desktop.finish(199,102,180).commit).toBe(false);
});
test("coarse touch does not convert vertical scrolling or selected text into a page turn",()=>{
  const mobile=new SwipeGesture(true);
  mobile.begin(250,100,0,390);expect(mobile.move(244,130,50)).toBeUndefined();
  expect(mobile.finish(180,150,180).commit).toBe(false);
  mobile.begin(250,100,0,390);expect(mobile.move(200,102,50,true)).toBeUndefined();
  expect(mobile.finish(170,102,180).commit).toBe(false);
  mobile.begin(250,100,0,390);mobile.move(224,100,60);
  expect(mobile.finish(224,100,400).commit).toBe(false);
});
