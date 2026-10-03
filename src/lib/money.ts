/**
 * Money helpers. All amounts are integer cents internally; conversion to dollars uses integer
 * arithmetic only (no floating point multiply/divide), so 1999 -> "19.99" exactly.
 */

export function assertCents(cents: number): void {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Invalid cents value: ${cents}`);
}

/** 1750 -> "17.50" */
export function centsToDollarString(cents: number): string {
  assertCents(cents);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return `${whole}.${String(frac).padStart(2, '0')}`;
}

/** 1750 -> "$17.50" */
export function formatDollars(cents: number): string {
  return `$${centsToDollarString(cents)}`;
}

/** "17.5" | "17.50" | "17" -> 1750. Returns null for anything that is not a plain non-negative decimal. */
export function dollarStringToCents(value: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

/** Every dollar amount mentioned in a text, in cents. Matches "$17.50", "$17", "$1,500.00", "USD 17.50". */
export function extractDollarAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /(?:\$|USD\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const whole = Number(m[1].replace(/,/g, ''));
    out.push(whole * 100 + Number((m[2] ?? '0').padEnd(2, '0')));
  }
  return out;
}
