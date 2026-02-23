// Scaled integer arithmetic for monetary values
// All money is stored as integers scaled by 10^8 to avoid floating-point
// precision errors. e.g. 1.17920000 EUR → 117_920_000

// Scale factor: 10^8 (8 decimal places of precision)
export const SCALE = 100_000_000;

// Convert a human-readable decimal number to a scaled integer.
// e.g. toScaled(1.1792) → 117_920_000
export function toScaled(value: number): number {
  return Math.round(value * SCALE);
}

// Convert a scaled integer back to a human-readable decimal string.
// e.g. fromScaled(117920000) → "1.17920000"
export function fromScaled(scaled: number): string {
  const integer = Math.floor(scaled / SCALE);
  const fraction = Math.abs(scaled % SCALE);
  return `${integer}.${fraction.toString().padStart(8, "0")}`;
}

// Multiply two scaled values: (a * b) / SCALE
// Used for: quoteAmount = baseAmount * price / SCALE
export function scaledMultiply(a: number, b: number): number {
  // Use BigInt internally to avoid overflow on large intermediate products
  const result = (BigInt(a) * BigInt(b)) / BigInt(SCALE);
  return Number(result);
}

// Divide two scaled values: (a * SCALE) / b
// Used for: price = quoteAmount * SCALE / baseAmount
export function scaledDivide(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero");
  const result = (BigInt(a) * BigInt(SCALE)) / BigInt(b);
  return Number(result);
}

// Parse a string price from Binance into a scaled integer.
// e.g. parsePrice("1.17920000") → 117_920_000
export function parsePrice(priceStr: string): number {
  return toScaled(parseFloat(priceStr));
}
