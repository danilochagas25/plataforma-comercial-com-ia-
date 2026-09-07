import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          'flex h-11 w-full rounded-lg border border-[rgba(97,193,208,0.45)] bg-[#F7FBFC] px-4 py-2 text-sm',
          'placeholder:text-[var(--color-text-secondary)] placeholder:opacity-60',
          'text-[var(--color-text-primary)]',
          'transition-colors',
          'focus:border-[var(--accent-primary)] focus:bg-[#EEF6F7] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20',
          'disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
