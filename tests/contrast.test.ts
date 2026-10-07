import { describe, it, expect } from 'vitest';
import { getContrastPairs } from '../src/lib/tokens';

function sRgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * sRgbToLinear(r) + 0.7152 * sRgbToLinear(g) + 0.0722 * sRgbToLinear(b);
}

function computeContrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Design Tokens Contrast Verification (WCAG 2.1)', () => {
  const themes: ('light' | 'dark')[] = ['light', 'dark'];

  themes.forEach((theme) => {
    describe(`${theme.toUpperCase()} Theme Contrast`, () => {
      const pairs = getContrastPairs(theme);

      pairs.forEach((pair) => {
        it(`${pair.name} meets contrast >= ${pair.minRatio}:1`, () => {
          const ratio = computeContrastRatio(pair.fg, pair.bg);
          expect(ratio).toBeGreaterThanOrEqual(pair.minRatio);
        });
      });
    });
  });
});
