import { describe, it, expect } from 'vitest';
import { formatCents } from '../src/lib/format';

describe('formatCents', () => {
  it('formats positive cents', () => {
    expect(formatCents(12450)).toBe('$124.50');
    expect(formatCents(100)).toBe('$1.00');
  });
  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00');
  });
  it('handles invalid inputs gracefully', () => {
    expect(formatCents(NaN)).toBe('$0.00');
  });
});
