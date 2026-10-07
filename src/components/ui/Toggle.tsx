import React from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  id,
  size = 'md',
  className = '',
  'aria-label': ariaLabel,
}: ToggleProps) {
  const generatedId = React.useId();
  const toggleId = id || generatedId;

  const trackDimensions = size === 'sm' ? 'w-8 h-4' : 'w-11 h-6';
  const thumbDimensions = size === 'sm' ? 'w-3 h-3' : 'w-5 h-5';
  const thumbTranslate = size === 'sm' ? (checked ? 'translate-x-4' : 'translate-x-0.5') : (checked ? 'translate-x-5' : 'translate-x-0.5');

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <button
        id={toggleId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel || label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${trackDimensions} ${
          checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
        }`}
      >
        <span
          className={`inline-block rounded-full bg-white shadow-sm transform transition-transform duration-200 ease-in-out pointer-events-none ${thumbDimensions} ${thumbTranslate}`}
          aria-hidden="true"
        />
      </button>
      {label && (
        <label
          htmlFor={toggleId}
          className={`text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none ${
            disabled ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {label}
        </label>
      )}
    </div>
  );
}
