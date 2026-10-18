import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 font-sans">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6 text-center">
        <div className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">
          404 Not Found
        </div>
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
          Page not found
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          The page you requested does not exist in ChurnRescue AI. Use the links below to navigate to the analytics dashboard or chat demo.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="px-4 py-2 text-xs font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Analytics Dashboard
          </Link>
          <Link
            href="/admin"
            className="px-4 py-2 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Admin &amp; Chat Demo
          </Link>
        </div>
      </div>
    </main>
  );
}
