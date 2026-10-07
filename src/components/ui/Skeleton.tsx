import React from 'react';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className = '', width, height, style, ...props }: SkeletonProps) {
  const inlineStyles: React.CSSProperties = {
    ...style,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };

  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-slate-200 dark:bg-slate-800 rounded-md ${className}`}
      style={inlineStyles}
      {...props}
    />
  );
}

export function CardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="p-5 bg-white dark:bg-gray-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3"
    >
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-36" />
      <Skeleton className="h-3 w-44" />
    </div>
  );
}
