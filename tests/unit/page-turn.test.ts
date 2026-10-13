import { expect, test, vi } from "vitest";
import { pageTurnSheetTransform, settledPageMove, waitForStableTypography } from "../../src/readers/page-turn";

test("paper bend is subtle, reverses direction and lies flat at both ends", () => {
  expect(pageTurnSheetTransform(0, 400, 1)).toContain("rotateY(0.00deg)");
  expect(pageTurnSheetTransform(-200, 400, 1)).toContain("rotateY(-2.40deg)");
  expect(pageTurnSheetTransform(200, 400, -1)).toContain("rotateY(2.40deg)");
  expect(pageTurnSheetTransform(-400, 400, 1)).toContain("rotateY(-0.00deg)");
});

test("EPUB typography waits for its fonts and paint frames before settling", async () => {
  let releaseFonts!: () => void;
  const fontsReady = new Promise<void>(resolve => { releaseFonts = resolve; });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  let settled = false;
  const waiting = waitForStableTypography({ fonts: { ready: fontsReady } } as unknown as Document)
    .then(() => { settled = true; });

  await Promise.resolve();
  expect(settled).toBe(false);
  releaseFonts();
  await waiting;
  expect(settled).toBe(true);
  vi.unstubAllGlobals();
});

test("EPUB destination remains unsettled until relocation and final typography paint", async () => {
  let relocate!: () => void;
  let releaseFonts!: () => void;
  let removed = false;
  let destinationReady = false;
  const fontsReady = new Promise<void>(resolve => { releaseFonts = resolve; });
  const frameWindow = {
    requestAnimationFrame(callback: FrameRequestCallback) {
      queueMicrotask(() => callback(0));
      return 1;
    },
  };
  const document = {
    fonts: { ready: fontsReady },
    defaultView: frameWindow,
  } as unknown as Document;
  let settled = false;
  const moving = settledPageMove({
    move: async () => undefined,
    onRelocated: handler => { relocate = handler; },
    offRelocated: () => { removed = true; },
    reportLocation: async () => undefined,
    documents: () => [document],
    destinationReady: () => destinationReady,
  }).then(() => { settled = true; });

  await Promise.resolve();
  expect(settled).toBe(false);
  relocate();
  await Promise.resolve();
  expect(settled).toBe(false);
  destinationReady = true;
  relocate();
  await Promise.resolve();
  expect(settled).toBe(false);
  releaseFonts();
  await moving;
  expect(settled).toBe(true);
  expect(removed).toBe(true);
});
