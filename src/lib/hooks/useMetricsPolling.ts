import { useState, useEffect, useRef, useCallback } from 'react';
import type { MetricsV2Response } from '@/lib/types/metrics';

export type DashboardData = MetricsV2Response;

export function useMetricsPolling(
  url: string = '/api/dashboard/metrics',
  intervalMs: number = 3000,
  enabled: boolean = true
) {
  const [data, setData] = useState<MetricsV2Response | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSuccess, setLastSuccess] = useState<Date | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  
  const etagRef = useRef<string | null>(null);
  const backoffRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isVisibleRef = useRef<boolean>(true);

  const [retryCount, setRetryCount] = useState(0);
  const prevUrlRef = useRef(url);

  useEffect(() => {
    if (prevUrlRef.current !== url) {
      prevUrlRef.current = url;
      etagRef.current = null;
    }
  }, [url]);

  useEffect(() => {
    let active = true;

    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      return () => {
        active = false;
      };
    }

    const doFetch = async () => {
      if (!active) return;
      
      if (!isVisibleRef.current) {
        timerRef.current = setTimeout(doFetch, intervalMs);
        return;
      }

      if (abortControllerRef.current) abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();

      try {
        const headers: HeadersInit = {};
        if (etagRef.current) headers['If-None-Match'] = etagRef.current;

        const res = await fetch(url, { headers, signal: abortControllerRef.current.signal });

        if (!active) return;

        if (res.status === 304 || res.ok) {
          setLastSuccess(new Date());
          setConsecutiveFailures(0);
          backoffRef.current = 0;
          setError(null);
        }

        if (res.status === 304) {
          timerRef.current = setTimeout(doFetch, intervalMs);
          return;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const newEtag = res.headers.get('ETag');
        if (newEtag) etagRef.current = newEtag;

        const json = await res.json();
        if (!active) return;

        setData(json);
        setLoading(false);
        timerRef.current = setTimeout(doFetch, intervalMs);
      } catch (err: any) {
        if (!active || err.name === 'AbortError') return;
        setConsecutiveFailures(c => c + 1);
        setError(err);
        setLoading(false);
        backoffRef.current = Math.min((backoffRef.current || intervalMs) * 2, 30000);
        timerRef.current = setTimeout(doFetch, backoffRef.current);
      }
    };

    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible';
      if (isVisibleRef.current) {
        if (timerRef.current) clearTimeout(timerRef.current);
        doFetch();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    doFetch();

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [url, intervalMs, retryCount, enabled]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    backoffRef.current = 0;
    setRetryCount(c => c + 1);
  }, []);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const isStale = consecutiveFailures >= 3 || (lastSuccess && (now - lastSuccess.getTime() > 15000));

  return { data, error, loading, lastSuccess, consecutiveFailures, isStale, retry };
}
