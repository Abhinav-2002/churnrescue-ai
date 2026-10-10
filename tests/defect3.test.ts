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
    // don't use fake timers globally to avoid waitFor hanging
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates lastUpdated on 304 Not Modified to prevent stale banner', async () => {
    let fetchCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      fetchCount++;
      if (fetchCount === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ ETag: 'etag1' }),
          json: () => Promise.resolve({ range_totals: { current: { failed_amount_cents: 1000 } } })
        });
      } else {
        return Promise.resolve({
          ok: true,
          status: 304,
          headers: new Headers({ ETag: 'etag1' })
        });
      }
    });

    const { result } = renderHook(() => useMetricsPolling('/api/dashboard/metrics', 100)); // 100ms interval!

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data).not.toBeNull();
    });

    const firstUpdated = result.current.lastUpdated;
    expect(firstUpdated).not.toBeNull();

    // wait for 200ms to allow a second fetch to occur
    await new Promise(r => setTimeout(r, 200));

    // After 304, lastUpdated should have been updated to the new time, but it wasn't!
    expect(result.current.lastUpdated?.getTime()).toBeGreaterThan(firstUpdated!.getTime());
  });
});
