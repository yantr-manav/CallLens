'use client';

import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '@/components/theme-provider';

export function Toaster() {
  const { theme } = useTheme();
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      richColors={false}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          title: 'text-sm font-medium',
          description: 'text-sm text-muted-foreground',
        },
      }}
    />
  );
}

export { toast } from 'sonner';