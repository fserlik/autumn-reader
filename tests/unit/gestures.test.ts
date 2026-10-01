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
