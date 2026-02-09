import * as React from 'react';
import { cn } from '@/lib/utils';

export function Alert({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'destructive' }) {
  const variants = {
    default: 'border-border bg-card',
    destructive: 'border-destructive/40 bg-destructive/10 text-foreground',
  };
  return (
    <div
      role="alert"
      className={cn('rounded-lg border px-4 py-3 text-sm', variants[variant], className)}
      {...props}
    />
  );
}