'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function ReturnContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || searchParams.get('orderId');
  const [status, setStatus] = useState<'loading' | 'success' | 'already_captured' | 'error'>(
    token ? 'loading' : 'error'
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(
    token ? null : 'No payment token provided.'
  );

  useEffect(() => {
    if (!token) return;

    let isMounted = true;

    async function completeCapture() {
      try {
        const res = await fetch(`/api/offers/${token}/capture`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json().catch(() => ({}));

        if (!isMounted) return;

        if (res.ok && (data.success || data.status === 'captured')) {
          setStatus('success');
        } else if (data.status === 'captured') {
          setStatus('already_captured');
        } else {
          setStatus('error');
          setErrorMsg(data.error || 'Payment capture could not be completed.');
        }
      } catch (err: any) {
        if (!isMounted) return;
        setStatus('error');
        setErrorMsg(err.message || 'Network error completing capture.');
      }
    }

    completeCapture();

    return () => {
      isMounted = false;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-8 text-center">
        {status === 'loading' && (
          <div className="py-8 space-y-4">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent" />
            <h2 className="text-xl font-bold">Verifying Payment</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Please wait while we confirm your PayPal approval and recover your account...
            </p>
          </div>
        )}

        {(status === 'success' || status === 'already_captured') && (
          <div className="py-4 space-y-4">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/60 rounded-full flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              Payment Completed!
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Your subscription payment has been processed and your account is now fully recovered.
            </p>
            <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/dashboard"
                className="inline-flex justify-center items-center px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
              >
                Go to Dashboard &rarr;
              </Link>
              <Link
                href="/"
                className="inline-flex justify-center items-center px-4 py-2.5 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Return to Home
              </Link>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="py-4 space-y-4">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-950/60 rounded-full flex items-center justify-center mx-auto text-red-600 dark:text-red-400">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Unable to Complete Payment
            </h2>
            <p className="text-sm text-red-600 dark:text-red-400">
              {errorMsg}
            </p>
            <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex justify-center items-center px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
              >
                Retry Capture
              </button>
              <Link
                href="/dashboard"
                className="inline-flex justify-center items-center px-4 py-2.5 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 dark:bg-black flex items-center justify-center p-4">
          <div className="text-center space-y-2">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Loading payment return...</p>
          </div>
        </div>
      }
    >
      <ReturnContent />
    </Suspense>
  );
}
