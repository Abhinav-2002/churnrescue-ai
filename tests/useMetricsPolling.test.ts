// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMetricsPolling } from '../src/lib/hooks/useMetricsPolling';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useMetricsPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'ETag': 'tag1' }),
      json: async () => ({ kpis: { total_failed: 5 } }),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('fetches on mount and polls every interval', async () => {
    const { result } = renderHook(() => useMetricsPolling('/test', 3000));
    
    expect(result.current.loading).toBe(true);
    
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(result.current.loading).toBe(false);
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Advance 3 seconds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 304,
      headers: new Headers(),
    });

    const previousCount = mockFetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(mockFetch.mock.calls.length).toBe(previousCount + 1);
    // Should pass ETag
    const req = mockFetch.mock.calls[previousCount][1];
    expect(req.headers['If-None-Match']).toBe('tag1');
  });

  it('backs off on error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    
    const { result } = renderHook(() => useMetricsPolling('/test', 3000));
    
    await act(async () => {
      await vi.runAllTicks();
    });

    expect(result.current.error).toBeTruthy();
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);

    const prevCount = mockFetch.mock.calls.length;
    // Backoff should double (6000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.resolve();
    });
    expect(mockFetch.mock.calls.length).toBe(prevCount); // not called yet

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000); // 6000 total
      await Promise.resolve();
    });
    expect(mockFetch.mock.calls.length).toBe(prevCount + 1);
  });
});
