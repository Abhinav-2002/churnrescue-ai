// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMetricsPolling } from '../src/lib/hooks/useMetricsPolling';
import { act } from '@testing-library/react';

vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return actual;
});

describe('Defect 3: Stale banner on 304 Not Modified', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('updates lastSuccess on 2xx and 304, and tracks failures for staleness', async () => {
    let statusCode = 200;
    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: statusCode < 400,
        status: statusCode,
        headers: new Headers({ ETag: 'etag1' }),
        json: async () => ({ range_totals: { current: { failed_amount_cents: 1000 } } })
      };
    });

    const { result, unmount } = renderHook(() => useMetricsPolling('/api/dashboard/metrics', 1000));
    
    // Initial fetch (200)
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.loading).toBe(false);
    
    const firstUpdate = result.current.lastSuccess?.getTime() || 0;
    expect(firstUpdate).toBeGreaterThan(0);
    expect(result.current.isStale).toBe(false);

    // Second fetch (304)
    statusCode = 304;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    
    const secondUpdate = result.current.lastSuccess?.getTime() || 0;
    expect(secondUpdate).toBeGreaterThan(firstUpdate);
    expect(result.current.isStale).toBe(false);
    expect(result.current.consecutiveFailures).toBe(0);

    // 1st failure (500) -> backoff to 2000ms
    statusCode = 500;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.consecutiveFailures).toBe(1);
    expect(result.current.isStale).toBe(false);

    // 2nd failure (500) -> backoff to 4000ms
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current.consecutiveFailures).toBe(2);
    expect(result.current.isStale).toBe(false);

    // 3rd failure (500) - becomes stale due to consecutiveFailures = 3 (time elapsed: ~7s total)
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(result.current.consecutiveFailures).toBe(3);
    expect(result.current.isStale).toBe(true);

    // Recovery (200)
    statusCode = 200;
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(result.current.consecutiveFailures).toBe(0);
    expect(result.current.isStale).toBe(false);
    
    unmount();
  });
});
