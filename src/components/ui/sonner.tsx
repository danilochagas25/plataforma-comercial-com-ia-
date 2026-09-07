import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      theme="light"
      position="top-right"
      richColors
      toastOptions={{
        classNames: {
          toast:
            'glass-card !border-[rgba(97,193,208,0.55)] !bg-[rgba(255,255,255,0.97)] !text-[var(--color-text-primary)]',
          description: '!text-[var(--color-text-secondary)]',
        },
      }}
    />
  );
}
