'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useMetricsPolling } from '@/lib/hooks/useMetricsPolling';
import { formatCents } from '@/lib/format';
import {
  Card,
  Badge,
  Button,
  Toggle,
  Skeleton,
  ErrorState,
} from '@/components/ui';
import { KpiCards } from './KpiCards';
import { PerformanceChart } from './PerformanceChart';
import { DonutChart } from './DonutChart';
import { FunnelChart } from './FunnelChart';
import { GuardrailsPanel } from './GuardrailsPanel';
import { HumanQueuePanel } from './HumanQueuePanel';
import { CustomersTable } from './CustomersTable';
import { CustomerDrawer } from './CustomerDrawer';
import { useChat } from '@/components/ChatContext';

const THEME_CHANGE_EVENT = 'churnrescue-theme-change';
const themeListeners = new Set<() => void>();

function notifyThemeListeners() {
  themeListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

function subscribeTheme(callback: () => void) {
  themeListeners.add(callback);
  const onStorage = () => callback();
  window.addEventListener('storage', onStorage);
  window.addEventListener(THEME_CHANGE_EVENT, onStorage);
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', onStorage);
  return () => {
    themeListeners.delete(callback);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onStorage);
    mql.removeEventListener('change', onStorage);
  };
}

let inMemoryThemeOverride: 'light' | 'dark' | null = null;

export function resetThemeForTests() {
  inMemoryThemeOverride = null;
}

function getThemeSnapshot(): 'light' | 'dark' {
  if (inMemoryThemeOverride) return inMemoryThemeOverride;
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function getServerThemeSnapshot(): 'light' | 'dark' {
  return 'light';
}

export function DashboardClient() {
  const { setCustomerId } = useChat();
  const [isLive, setIsLive] = useState(true);
  const theme = React.useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [secondsAgo, setSecondsAgo] = useState(0);

  // Synchronize document.documentElement class with current theme
  useEffect(() => {
    try {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      }
    } catch {
      // Fallback gracefully
    }
  }, [theme]);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    inMemoryThemeOverride = nextTheme;
    try {
      if (nextTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      }
      localStorage.setItem('theme', nextTheme);
      document.cookie = `theme=${nextTheme}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // Fallback gracefully - inMemoryThemeOverride preserves session choice
    }
    notifyThemeListeners();
    try {
      window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
    } catch {}
  };


  const [rangeDays, setRangeDays] = useState<7 | 14 | 30>(7);
  const [filterAction, setFilterAction] = useState<string | null>(null);
  const [filterStage, setFilterStage] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);

  const metricsUrl = useMemo(() => `/api/dashboard/metrics?days=${rangeDays}`, [rangeDays]);

  // Polling with v2 API
  const { data, error, loading, lastSuccess, isStale, retry } = useMetricsPolling(
    metricsUrl,
    3000,
    isLive
  );

  // Reactive "Updated Ns ago" ticker
  useEffect(() => {
    const tick = () => {
      if (!lastSuccess) return;
      const diff = Math.floor((Date.now() - lastSuccess.getTime()) / 1000);
      setSecondsAgo(Math.max(0, diff));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lastSuccess]);

  // isStale comes from the hook now
  const formattedTime = useMemo(() => {
    if (!lastSuccess) return '--:--:-- UTC';
    return lastSuccess.toISOString().substring(11, 19) + ' UTC';
  }, [lastSuccess]);

  const updatedText = useMemo(() => {
    if (!lastSuccess) return 'Connecting...';
    if (!isLive) return 'Polling paused';
    if (secondsAgo < 5) return 'Updated just now';
    return `Updated ${secondsAgo}s ago`;
  }, [lastSuccess, isLive, secondsAgo]);

  const handleOpenDrawer = (customerId: string, elRef?: React.RefObject<HTMLElement | null>) => {
    setSelectedCustomerId(customerId);
    setCustomerId(customerId);
    if (elRef?.current) {
      triggerRef.current = elRef.current;
    } else if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      triggerRef.current = document.activeElement;
    }
  };

  const handleCloseDrawer = () => {
    setSelectedCustomerId(null);
  };

  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId || !data?.customers) return null;
    return data.customers.find((c) => c.id === selectedCustomerId) ?? null;
  }, [data, selectedCustomerId]);

  const needsHumanCount = data?.range_totals?.current?.needs_human ?? 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-slate-100 flex flex-col xl:flex-row antialiased">
      {/* 1. Desktop Sidebar (>= 1280px) */}
      <aside
        aria-label="Sidebar navigation"
        className="hidden xl:flex xl:w-64 xl:flex-col fixed inset-y-0 z-40 bg-white dark:bg-gray-950 border-r border-slate-200 dark:border-slate-800"
      >
        <div className="flex flex-col flex-1 p-6 justify-between">
          <div className="space-y-6">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-base shadow-sm">
                  CR
                </div>
                <div>
                  <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                    ChurnRescue AI
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Billing Operations
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <Badge variant="sandbox" className="w-full justify-center text-center">
                  Sandbox demo, no real money
                </Badge>
              </div>
            </div>

            {/* Navigation Links — Strictly adhering to Contract A9 Anchors */}
            <nav className="space-y-1">
              <a
                href="#overview"
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                <span>Overview</span>
              </a>

              <a
                href="#customers"
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-900 transition-colors"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span>Customers</span>
              </a>

              <a
                href="#human-queue"
                className="flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-900 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>Needs a Human</span>
                </div>
                {needsHumanCount > 0 && (
                  <span className="px-1.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    {needsHumanCount}
                  </span>
                )}
              </a>

              <a
                href="#guardrails"
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-900 transition-colors"
              >
                <svg className="w-4 h-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>Guardrails</span>
              </a>
            </nav>
          </div>

          {/* Sidebar Footer info */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>Environment</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">Sandbox</span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>Model</span>
              <span className="font-mono">Gemini 2.5</span>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. Sticky Top Bar (< 1280px) */}
      <header
        aria-label="Mobile header"
        className="xl:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-b border-slate-200 dark:border-slate-800"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center text-white font-bold text-xs">
            CR
          </div>
          <span className="font-bold text-sm tracking-tight text-slate-900 dark:text-white">
            ChurnRescue AI
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="sandbox" className="text-[10px] px-2 py-0.5 hidden sm:inline-flex">
            Sandbox
          </Badge>

          

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            {theme === 'light' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* 3. Main Content Container */}
      <main className="flex-1 xl:pl-64 min-w-0 flex flex-col overflow-x-hidden">
        <div className="max-w-[1440px] w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
          {/* Header row: Product Title, Badges, Live Status, Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Billing Operations
                </h2>
                <Badge variant="sandbox" className="hidden lg:inline-flex">
                  Sandbox demo, no real money
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Autonomous recovery agent telemetry and guardrail compliance
              </p>
            </div>

            {/* Live Indicator, Poll Controls, Theme Toggle, Link */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              {/* Live Status indicator */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-slate-800 text-xs">
                {isStale ? (
                  <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                  </span>
                ) : isLive ? (
                  <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                ) : (
                  <span className="inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" aria-hidden="true" />
                )}
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {isStale ? 'STALE' : isLive ? 'LIVE' : 'PAUSED'}
                </span>
                <span className="text-slate-400 dark:text-slate-600">|</span>
                <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  {formattedTime}
                </span>
                <span className="text-slate-400 dark:text-slate-600 hidden sm:inline">|</span>
                <span className="tabular-nums text-slate-500 dark:text-slate-400 hidden sm:inline">
                  {updatedText}
                </span>
              </div>

              {/* Live Toggle */}
              <Toggle
                size="sm"
                checked={isLive}
                onChange={setIsLive}
                label={isLive ? 'Polling ON' : 'Paused'}
                aria-label="Toggle live metrics polling"
              />

              {/* Theme Toggle Button (Always interactive & visible) */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
                className="inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors cursor-pointer"
              >
                {theme === 'light' ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                )}
              </button>

              {/* Link to Chat Demo */}
              
            </div>
          </div>


          {/* Stale Connection Warning Banner */}
          {isStale && !error && (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span>Telemetry connection stale — last data received {secondsAgo}s ago. Reconnecting...</span>
              </div>
              <button
                type="button"
                onClick={retry}
                className="px-2.5 py-1 rounded bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100 font-semibold hover:bg-amber-300 dark:hover:bg-amber-800 cursor-pointer transition-colors"
              >
                Retry Now
              </button>
            </div>
          )}

          {/* Error Banner if API error */}
          {error && (
            <ErrorState
              title="Connection Error"
              message={`Failed to fetch live metrics: ${error.message}. Polling will automatically retry.`}
              onRetry={retry}
            />
          )}

          {/* 4. Responsive KPI Row Grid (5 Cards) */}
          <KpiCards
            rangeTotals={data?.range_totals}
            sparklines={data?.sparklines}
            days={rangeDays}
            loading={loading && !data}
          />

          {/* 5. Performance Chart & Intervention Mix Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <PerformanceChart
                data={data?.daily_series}
                rangeDays={rangeDays}
                onRangeChange={setRangeDays}
                loading={loading && !data}
              />
            </div>
            <div>
              <DonutChart
                mix={data?.intervention_mix}
                activeFilter={filterAction}
                onSelectAction={setFilterAction}
                loading={loading && !data}
              />
            </div>
          </div>

          {/* 6. Funnel & Guardrails Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FunnelChart
              funnel={data?.funnel}
              activeStage={filterStage}
              onSelectStage={setFilterStage}
              loading={loading && !data}
            />
            <GuardrailsPanel
              summary={data?.guardrail_summary}
              audit={data?.policy_audit}
              loading={loading && !data}
            />
          </div>

          {/* 7. Needs a Human Queue */}
          <HumanQueuePanel
            queue={data?.human_queue}
            onOpenDrawer={(id) => handleOpenDrawer(id)}
            loading={loading && !data}
          />

          {/* 8. Customer Accounts Table (25 per page) */}
          <CustomersTable
            customers={data?.customers}
            filterAction={filterAction}
            filterStage={filterStage}
            onClearActionFilter={() => setFilterAction(null)}
            onClearStageFilter={() => setFilterStage(null)}
            onOpenDrawer={(id, ref) => handleOpenDrawer(id, ref)}
            loading={loading && !data}
          />

          {/* 9. Customer Slide-Over Drawer */}
          <CustomerDrawer
            isOpen={Boolean(selectedCustomerId)}
            customerId={selectedCustomerId}
            customer={selectedCustomer}
            decisions={data?.decisions}
            offers={data?.offers}
            onClose={handleCloseDrawer}
            triggerRef={triggerRef}
          />
        </div>
      </main>
    </div>
  );
}

