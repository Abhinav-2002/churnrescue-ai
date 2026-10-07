import React from 'react';

export type CustomerStatus = 'recovered' | 'at_risk' | 'failed' | 'offered' | 'paused' | 'needs_human' | string;

interface StatusPillProps {
  status: CustomerStatus;
  label?: string;
  className?: string;
}

export function StatusPill({ status, label, className = '' }: StatusPillProps) {
  let text = label;
  let bgFg = '';
  let icon: React.ReactNode = null;

  switch (status) {
    case 'recovered':
      text = text || 'Recovered';
      bgFg = 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800';
      icon = (
        <svg className="w-3 h-3 mr-1.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      );
      break;

    case 'at_risk':
    case 'failed':
      text = text || (status === 'at_risk' ? 'At Risk' : 'Failed');
      bgFg = 'bg-red-50 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-800';
      icon = (
        <svg className="w-3 h-3 mr-1.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
      break;

    case 'offered':
      text = text || 'Offered';
      bgFg = 'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800';
      icon = (
        <svg className="w-3 h-3 mr-1.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      );
      break;

    case 'paused':
      text = text || 'Paused';
      bgFg = 'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800';
      icon = (
        <svg className="w-3 h-3 mr-1.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
      break;

    case 'needs_human':
    case 'escalate':
      text = text || 'Needs Human';
      bgFg = 'bg-orange-50 text-orange-900 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800';
      icon = (
        <svg className="w-3 h-3 mr-1.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
      break;

    default:
      text = text || status;
      bgFg = 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
      icon = (
        <span className="w-1.5 h-1.5 mr-1.5 rounded-full bg-current shrink-0" aria-hidden="true" />
      );
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${bgFg} ${className}`}
    >
      {icon}
      <span>{text}</span>
    </span>
  );
}
