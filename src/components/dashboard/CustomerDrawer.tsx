import React, { useEffect, useRef } from 'react';
import { StatusPill } from '@/components/ui';
import type { CustomerMetricRow, DecisionMetricRow, OfferMetricRow } from '@/lib/types/metrics';

interface CustomerDrawerProps {
  isOpen: boolean;
  customerId: string | null;
  customer?: CustomerMetricRow | null;
  decisions?: DecisionMetricRow[];
  offers?: OfferMetricRow[];
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export function CustomerDrawer({
  isOpen,
  customerId,
  customer,
  decisions = [],
  offers = [],
  onClose,
  triggerRef,
}: CustomerDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Esc key closes drawer
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus Trap & Focus Return
  useEffect(() => {
    if (isOpen) {
      const triggerEl = triggerRef?.current;

      // Focus initial element in drawer
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);

      // Trap Tab key within drawer
      const handleTab = (e: KeyboardEvent) => {
        if (e.key !== 'Tab' || !drawerRef.current) return;

        const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement?.focus();
          }
        }
      };

      window.addEventListener('keydown', handleTab);
      return () => {
        window.removeEventListener('keydown', handleTab);
        // Focus return to triggering element
        triggerEl?.focus();
      };
    }
  }, [isOpen, triggerRef]);

  if (!isOpen || !customerId) return null;

  // Filter decisions and offers for this customer
  const customerDecisions = decisions.filter((d) => d.customer_id === customerId);
  const customerOffers = offers.filter((o) => o.customer_id === customerId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-customer-title"
      className="fixed inset-0 z-50 overflow-hidden"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div
          ref={drawerRef}
          className="w-screen max-w-md bg-white dark:bg-gray-950 border-l border-slate-200 dark:border-slate-800 shadow-xl flex flex-col justify-between"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 id="drawer-customer-title" className="text-lg font-bold text-slate-900 dark:text-white">
                {customer?.name || 'Customer Account'}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <StatusPill status={customer?.status || 'at_risk'} />
                <span className="text-xs text-slate-500 font-mono">
                  {customer?.plan} ({customer?.usage_percent}% usage)
                </span>
              </div>
            </div>

            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close customer drawer"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Decision Timeline Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                Autonomous Decision Timeline
              </h3>

              {customerDecisions.length === 0 ? (
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 text-center">
                  No decisions recorded yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {customerDecisions.map((d, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                          {d.action.replace('_', ' ')}
                        </span>
                        <span className="font-mono text-slate-400">
                          {new Date(d.created_at).toLocaleTimeString()}
                        </span>
                      </div>

                      {/* Enumerated Guardrail Clamp Fields Only */}
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/80">
                        <div>
                          <span className="text-slate-400 block text-[10px]">Proposed Discount:</span>
                          <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                            {d.proposed_discount_percent !== null ? `${d.proposed_discount_percent}%` : 'N/A'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Approved Discount:</span>
                          <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                            {d.approved_discount_percent !== null ? `${d.approved_discount_percent}%` : 'N/A'}
                          </span>
                        </div>
                      </div>

                      {d.guardrail_category && (
                        <div className="pt-1">
                          <span className="text-slate-400 block text-[10px]">Guardrail Rule:</span>
                          <span className="inline-block mt-0.5 px-2 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 font-mono text-[10px]">
                            {d.guardrail_category}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recorded Offers Section */}
            {customerOffers.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                  Recorded Offers
                </h3>
                <div className="space-y-2">
                  {customerOffers.map((o) => (
                    <div
                      key={o.id}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 capitalize">
                          {o.kind.replace('_', ' ')}
                        </span>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          ID: {o.id}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {o.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Close Drawer (Esc)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
