/**
 * Design Tokens for ChurnRescue AI Dashboard.
 * Strictly centralized colors, typography, spacing, and semantic roles.
 * Supports light and dark modes.
 */

export interface ColorTokenPair {
  name: string;
  fg: string;
  bg: string;
  border?: string;
  role: 'text' | 'badge' | 'card' | 'border';
  minRatio: number; // 4.5 for text, 3.0 for large text / borders
}

export const TOKENS = {
  light: {
    surfaces: {
      base: '#ffffff',
      card: '#ffffff',
      muted: '#f8fafc',
    },
    text: {
      primary: '#0f172a',
      secondary: '#475569',
      inverse: '#ffffff',
    },
    borders: {
      neutral: '#64748b', // >= 3:1 against white
      subtle: '#94a3b8',
    },
    semantics: {
      recovered: {
        bg: '#ecfdf5',
        fg: '#065f46',
        border: '#047857',
      },
      failed: {
        bg: '#fef2f2',
        fg: '#991b1b',
        border: '#b91c1c',
      },
      offered: {
        bg: '#eff6ff',
        fg: '#1e40af',
        border: '#1d4ed8',
      },
      paused: {
        bg: '#fffbeb',
        fg: '#78350f',
        border: '#b45309',
      },
      agent: {
        bg: '#f5f3ff',
        fg: '#5b21b6',
        border: '#6d28d9',
      },
    },
  },
  dark: {
    surfaces: {
      base: '#0a0a0a',
      card: '#111827',
      muted: '#1e293b',
    },
    text: {
      primary: '#f8fafc',
      secondary: '#cbd5e1',
      inverse: '#0a0a0a',
    },
    borders: {
      neutral: '#64748b', // >= 3:1 against #111827
      subtle: '#475569',
    },
    semantics: {
      recovered: {
        bg: '#064e3b',
        fg: '#6ee7b7',
        border: '#34d399',
      },
      failed: {
        bg: '#450a0a',
        fg: '#fca5a5',
        border: '#f87171',
      },
      offered: {
        bg: '#172554',
        fg: '#93c5fd',
        border: '#60a5fa',
      },
      paused: {
        bg: '#451a03',
        fg: '#fcd34d',
        border: '#fbbf24',
      },
      agent: {
        bg: '#2e1065',
        fg: '#c4b5fd',
        border: '#a78bfa',
      },
    },
  },
} as const;

export function getContrastPairs(theme: 'light' | 'dark'): ColorTokenPair[] {
  const t = TOKENS[theme];
  return [
    // Neutral Text on Surfaces
    { name: 'Primary Text on Base Surface', fg: t.text.primary, bg: t.surfaces.base, role: 'text', minRatio: 4.5 },
    { name: 'Primary Text on Card Surface', fg: t.text.primary, bg: t.surfaces.card, role: 'text', minRatio: 4.5 },
    { name: 'Secondary Text on Base Surface', fg: t.text.secondary, bg: t.surfaces.base, role: 'text', minRatio: 4.5 },
    { name: 'Secondary Text on Card Surface', fg: t.text.secondary, bg: t.surfaces.card, role: 'text', minRatio: 4.5 },

    // Semantic Status Pairs (Text on semantic background tint)
    { name: 'Recovered Text on Recovered BG', fg: t.semantics.recovered.fg, bg: t.semantics.recovered.bg, role: 'text', minRatio: 4.5 },
    { name: 'Failed Text on Failed BG', fg: t.semantics.failed.fg, bg: t.semantics.failed.bg, role: 'text', minRatio: 4.5 },
    { name: 'Offered Text on Offered BG', fg: t.semantics.offered.fg, bg: t.semantics.offered.bg, role: 'text', minRatio: 4.5 },
    { name: 'Paused Text on Paused BG', fg: t.semantics.paused.fg, bg: t.semantics.paused.bg, role: 'text', minRatio: 4.5 },
    { name: 'Agent Text on Agent BG', fg: t.semantics.agent.fg, bg: t.semantics.agent.bg, role: 'text', minRatio: 4.5 },

    // UI Borders on Surfaces (>= 3.0:1)
    { name: 'Neutral Border on Card Surface', fg: t.borders.neutral, bg: t.surfaces.card, role: 'border', minRatio: 3.0 },
    { name: 'Recovered Border on Recovered BG', fg: t.semantics.recovered.border, bg: t.semantics.recovered.bg, role: 'border', minRatio: 3.0 },
    { name: 'Failed Border on Failed BG', fg: t.semantics.failed.border, bg: t.semantics.failed.bg, role: 'border', minRatio: 3.0 },
    { name: 'Offered Border on Offered BG', fg: t.semantics.offered.border, bg: t.semantics.offered.bg, role: 'border', minRatio: 3.0 },
    { name: 'Paused Border on Paused BG', fg: t.semantics.paused.border, bg: t.semantics.paused.bg, role: 'border', minRatio: 3.0 },
    { name: 'Agent Border on Agent BG', fg: t.semantics.agent.border, bg: t.semantics.agent.bg, role: 'border', minRatio: 3.0 },
  ];
}

export const TYPOGRAPHY = {
  scale: {
    xs: { fontSize: '0.75rem', lineHeight: '1rem' },     // 12px
    sm: { fontSize: '0.875rem', lineHeight: '1.25rem' }, // 14px
    base: { fontSize: '1rem', lineHeight: '1.5rem' },    // 16px
    lg: { fontSize: '1.125rem', lineHeight: '1.75rem' },  // 18px
    xl: { fontSize: '1.25rem', lineHeight: '1.75rem' },  // 20px
    '2xl': { fontSize: '1.5rem', lineHeight: '2rem' },    // 24px
    '3xl': { fontSize: '1.875rem', lineHeight: '2.25rem' }, // 30px
  },
  tabularNums: 'tabular-nums',
} as const;

export const SPACING = {
  xs: '0.25rem',  // 4px
  sm: '0.5rem',   // 8px
  md: '1rem',     // 16px
  lg: '1.5rem',   // 24px
  xl: '2rem',     // 32px
  '2xl': '3rem',  // 48px
} as const;

