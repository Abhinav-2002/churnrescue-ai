'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled page error:', error.digest || 'unknown');
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 font-sans">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6 text-center">
        <div className="w-10 h-10 mx-auto mb-4 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 flex items-center justify-center font-bold">
          !
        </div>
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
          Something went wrong
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          An unexpected error occurred while rendering this view. No billing actions or charges were executed.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="px-4 py-2 text-xs font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Try Again
          </button>
          <Link
            href="/dashboard"
            className="px-4 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
