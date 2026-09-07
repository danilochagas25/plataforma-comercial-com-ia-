import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Gradiente 135° #0B6E7D→#0A7787 (botão primário do design system) com
        // glow azul no hover (30→48px). Antes era cor chapada, fora do DS.
        default:
          'bg-[linear-gradient(135deg,#0B6E7D,#0A7787)] text-white shadow-[0_4px_14px_rgba(23,40,43,0.08)] hover:shadow-[0_6px_18px_rgba(11,110,125,0.22)] hover:brightness-110',
        secondary:
          'bg-[#EEF6F7] text-[var(--color-text-primary)] border border-[rgba(97,193,208,0.45)] hover:bg-[#E4F5F8] hover:border-[rgba(11,110,125,0.40)]',
        ghost:
          'text-[var(--color-text-secondary)] hover:bg-[#EEF6F7] hover:text-[var(--color-text-primary)]',
        outline:
          'border border-[rgba(97,193,208,0.55)] bg-transparent text-[var(--color-text-primary)] hover:bg-[#EEF6F7] hover:border-[rgba(11,110,125,0.40)]',
        destructive:
          'bg-[var(--color-error)] text-white hover:bg-[var(--color-error)]/90',
        link:
          'text-[var(--accent-primary)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-12 rounded-lg px-7 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
