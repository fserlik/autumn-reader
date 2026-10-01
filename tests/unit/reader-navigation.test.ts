import { test, expect } from "vitest";
import { ReaderHistory, type ReaderPosition } from "../../src/readers/history";
import { textMatches } from "../../src/readers/search";
const position = (page: number): ReaderPosition => ({ format: "pdf", page, offset: .42, scrollTop: 120, scrollLeft: 0 });
test("reading A → search/note B → C, back/forward and return preserve the reading anchor", () => {
  const history = new ReaderHistory(); history.commit(position(187));
  history.jump(position(187), position(42)); history.jump(position(42), position(30));
  expect(history.temporary).toBe(true); expect(history.readingOrigin).toEqual(position(187));
  expect(history.back()).toEqual(position(42)); expect(history.back()).toEqual(position(187));
  expect(history.temporary).toBe(false); expect(history.canForward).toBe(true);
  expect(history.forward()).toEqual(position(42)); history.observe(position(43));
  expect(history.readingOrigin).toEqual(position(187)); expect(history.returnToReading()).toEqual(position(187));
  expect(history.temporary).toBe(false); expect(history.canForward).toBe(false);
});
test("EPUB CFI is precise and adopting a location explicitly replaces the reading anchor", () => {
  const history = new ReaderHistory(); const a:ReaderPosition = {format:"epub",cfi:"epubcfi(/6/2!/4/2:10)",label:"Chapter"};
  const b = {...a,cfi:"epubcfi(/6/8!/4/2:30)"}; history.jump(a,b);
  expect(history.back()).toEqual(a); expect(history.forward()).toEqual(b);
  history.commit(b); expect(history.readingOrigin).toEqual(b); expect(history.temporary).toBe(false);
});

test("reading after Back updates the return anchor while retaining Forward", () => {
  const history=new ReaderHistory();history.jump(position(187),position(42));history.back();
  history.observe(position(188));expect(history.canForward).toBe(true);
  expect(history.forward()).toEqual(position(42));expect(history.returnToReading()).toEqual(position(188));
});
test("text search finds case-insensitive words, literal phrases, metacharacters, Unicode and exact offsets", () => {
  const text = "Freedom and freedom. To be or NOT to be. [1] ¡Libertad!";
  expect(textMatches(text,"FREEDOM").map(m=>m.start)).toEqual([0,12]);
  expect(textMatches(text,"not TO be")[0].quote).toBe("NOT to be");
  expect(textMatches(text,"[1]")).toHaveLength(1); expect(textMatches(text,"LIBERTAD")).toHaveLength(1);
  expect(textMatches("","words")).toHaveLength(0); expect(textMatches(text,"")).toHaveLength(0);
});
