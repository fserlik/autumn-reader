/* PDF.js 6 uses Math.sumPrecise, while Supabase Edge Runtime 1.77 ships
 * Deno 2.1.4/V8 13.0 where the proposal is not available yet. */
const edgeMath = Math as unknown as { sumPrecise?: (values: Iterable<number>) => number };
if (typeof edgeMath.sumPrecise !== "function") {
  Object.defineProperty(edgeMath, "sumPrecise", {
    configurable: true,
    writable: true,
    value(values: Iterable<number>): number {
      let sum = 0, correction = 0, positiveInfinity = false, negativeInfinity = false;
      for (const value of values) {
        if (typeof value !== "number") throw new TypeError("Math.sumPrecise accepts only numbers");
        if (Number.isNaN(value)) return Number.NaN;
        if (value === Number.POSITIVE_INFINITY) { positiveInfinity = true; continue; }
        if (value === Number.NEGATIVE_INFINITY) { negativeInfinity = true; continue; }
        const next = sum + value;
        correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
        sum = next;
      }
      if (positiveInfinity && negativeInfinity) return Number.NaN;
      if (positiveInfinity) return Number.POSITIVE_INFINITY;
      if (negativeInfinity) return Number.NEGATIVE_INFINITY;
      return sum + correction;
    },
  });
}
