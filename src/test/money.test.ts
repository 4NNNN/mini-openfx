import { describe, test, expect } from "bun:test";
import { toScaled, fromScaled, scaledMultiply, scaledDivide, parsePrice, SCALE } from "../money";

describe("Money utilities", () => {
  test("toScaled converts decimal to scaled integer", () => {
    expect(toScaled(1.0)).toBe(100_000_000);
    expect(toScaled(1.1792)).toBe(117_920_000);
    expect(toScaled(0.5)).toBe(50_000_000);
    expect(toScaled(10_000)).toBe(1_000_000_000_000);
  });

  test("fromScaled converts scaled integer to decimal string", () => {
    expect(fromScaled(100_000_000)).toBe("1.00000000");
    expect(fromScaled(117_920_000)).toBe("1.17920000");
    expect(fromScaled(50_000_000)).toBe("0.50000000");
    expect(fromScaled(0)).toBe("0.00000000");
  });

  test("toScaled → fromScaled roundtrip preserves value", () => {
    const values = [1.0, 0.001, 100.12345678, 99999.99];
    for (const v of values) {
      const scaled = toScaled(v);
      const back = parseFloat(fromScaled(scaled));
      expect(Math.abs(back - v)).toBeLessThan(0.000001);
    }
  });

  test("scaledMultiply computes (a * b) / SCALE correctly", () => {
    const amount = toScaled(100);     // 100 EUR
    const price = toScaled(1.1792);   // 1.1792 USDT/EUR
    const result = scaledMultiply(amount, price);
    // 100 * 1.1792 = 117.92
    expect(fromScaled(result)).toBe("117.92000000");
  });

  test("scaledMultiply handles large values without overflow", () => {
    const amount = toScaled(50_000);   // 50,000 units
    const price = toScaled(67_000);    // BTC price
    const result = scaledMultiply(amount, price);
    // 50,000 * 67,000 = 3,350,000,000
    expect(fromScaled(result)).toBe("3350000000.00000000");
  });

  test("scaledDivide computes (a * SCALE) / b correctly", () => {
    const quoteAmount = toScaled(117.92);
    const baseAmount = toScaled(100);
    const price = scaledDivide(quoteAmount, baseAmount);
    expect(fromScaled(price)).toBe("1.17920000");
  });

  test("scaledDivide throws on division by zero", () => {
    expect(() => scaledDivide(toScaled(100), 0)).toThrow("Division by zero");
  });

  test("parsePrice converts string to scaled integer", () => {
    expect(parsePrice("1.17920000")).toBe(117_920_000);
    expect(parsePrice("67045.01000000")).toBe(6_704_501_000_000);
  });

  test("no floating point precision loss in financial calculations", () => {
    // Classic: 0.1 + 0.2 !== 0.3 in floating point
    // With scaled integers: toScaled(0.1) + toScaled(0.2) === toScaled(0.3)
    expect(toScaled(0.1) + toScaled(0.2)).toBe(toScaled(0.3));
  });
});
