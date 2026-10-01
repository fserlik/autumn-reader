import { expect, test } from "vitest";
import { pageTurnSheetTransform } from "../../src/readers/page-turn";

test("paper bend is subtle, reverses direction and lies flat at both ends", () => {
  expect(pageTurnSheetTransform(0, 400, 1)).toContain("rotateY(0.00deg)");
  expect(pageTurnSheetTransform(-200, 400, 1)).toContain("rotateY(-2.40deg)");
  expect(pageTurnSheetTransform(200, 400, -1)).toContain("rotateY(2.40deg)");
  expect(pageTurnSheetTransform(-400, 400, 1)).toContain("rotateY(-0.00deg)");
});
