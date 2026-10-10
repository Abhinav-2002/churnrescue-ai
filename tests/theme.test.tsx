// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ChatProvider } from '../src/components/ChatContext';
import { DashboardClient, resetThemeForTests } from '../src/components/dashboard/DashboardClient';

describe('Theme Toggle Behavioral Verification', () => {
  let originalMatchMedia: typeof window.matchMedia;
  let prefersDark = false;

  beforeEach(() => {
    resetThemeForTests();
    localStorage.clear();
    document.cookie = '';
    document.documentElement.className = '';
    prefersDark = false;

    originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ ETag: 'test-etag' }),
      json: async () => ({
        range_days: 7,
        range_totals: {
          current: {
            recovered_revenue_cents: 12000,
            recovery_rate: 0.8,
            failed_amount_cents: 15000,
            customers_recovered: 4,
            needs_human: 2,
          },
        },
      }),
    });
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    document.documentElement.className = '';
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('1. system preference is used when no persisted preference exists (system dark)', () => {
    prefersDark = true;
    render(<ChatProvider><DashboardClient /></ChatProvider>);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);

    // When dark, aria-label prompts to switch to light
    const buttons = screen.getAllByRole('button', { name: /switch to light theme/i });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('2. system preference is used when no persisted preference exists (system light)', () => {
    prefersDark = false;
    render(<ChatProvider><DashboardClient /></ChatProvider>);

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // When light, aria-label prompts to switch to dark
    const buttons = screen.getAllByRole('button', { name: /switch to dark theme/i });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('3. theme toggle changes from dark to light upon user click', () => {
    prefersDark = true;
    render(<ChatProvider><DashboardClient /></ChatProvider>);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    const toggleButton = screen.getAllByRole('button', { name: /switch to light theme/i })[0];

    act(() => {
      fireEvent.click(toggleButton);
    });

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
    expect(document.cookie).toContain('theme=light');

    // ARIA label must now reflect the new state
    expect(screen.getAllByRole('button', { name: /switch to dark theme/i }).length).toBeGreaterThan(0);
  });

  it('4. theme toggle changes from light to dark upon user click', () => {
    prefersDark = false;
    render(<ChatProvider><DashboardClient /></ChatProvider>);

    expect(document.documentElement.classList.contains('light')).toBe(true);
    const toggleButton = screen.getAllByRole('button', { name: /switch to dark theme/i })[0];

    act(() => {
      fireEvent.click(toggleButton);
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(document.cookie).toContain('theme=dark');

    // ARIA label must now reflect the new state
    expect(screen.getAllByRole('button', { name: /switch to light theme/i }).length).toBeGreaterThan(0);
  });

  it('5. aria state accurately reflects the current theme across multiple toggles', () => {
    prefersDark = false;
    render(<ChatProvider><DashboardClient /></ChatProvider>);

    // Initial light
    expect(screen.getAllByRole('button', { name: /switch to dark theme/i }).length).toBeGreaterThan(0);

    // Click 1: Light -> Dark
    const btn1 = screen.getAllByRole('button', { name: /switch to dark theme/i })[0];
    act(() => {
      fireEvent.click(btn1);
    });
    expect(screen.getAllByRole('button', { name: /switch to light theme/i }).length).toBeGreaterThan(0);

    // Click 2: Dark -> Light
    const btn2 = screen.getAllByRole('button', { name: /switch to light theme/i })[0];
    act(() => {
      fireEvent.click(btn2);
    });
    expect(screen.getAllByRole('button', { name: /switch to dark theme/i }).length).toBeGreaterThan(0);
  });

  it('6. persisted theme is restored from localStorage', () => {
    localStorage.setItem('theme', 'dark');
    render(<ChatProvider><DashboardClient /></ChatProvider>);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(screen.getAllByRole('button', { name: /switch to light theme/i }).length).toBeGreaterThan(0);
  });

  it('7. localStorage failure does not crash the application and DOM class still toggles', () => {
    prefersDark = false;

    // Simulate quota exceeded or restricted sandbox iframe throwing on storage
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    render(<ChatProvider><DashboardClient /></ChatProvider>);

    const toggleButton = screen.getAllByRole('button', { name: /switch to dark theme/i })[0];

    expect(() => {
      act(() => {
        fireEvent.click(toggleButton);
      });
    }).not.toThrow();

    // DOM should still toggle cleanly despite storage failure
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
