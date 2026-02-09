import * as React from 'react';
import { cn } from '@/lib/utils';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost';
  size?: 'sm' | 'md' | 'lg' | 'icon';
};

export function Button({
  className,
  variant = 'default',
  size = 'md',
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none';
  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    default: 'bg-primary text-primary-foreground hover:opacity-90',
    secondary: 'bg-muted text-foreground hover:bg-muted/80',
    outline: 'border border-border bg-transparent hover:bg-muted',
    destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
    ghost: 'hover:bg-muted',
  };
  const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
    sm: 'h-8 px-3',
    md: 'h-9 px-4',
    lg: 'h-10 px-6',
    icon: 'h-9 w-9',
  };

  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props} />
  );
}