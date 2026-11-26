import type { ComponentProps } from 'react';
import { cn } from '@/shared/lib/utils';

/** A native <select> styled like the shared Input, so it works on every device and with a keyboard. */
export function NativeSelect({
  className,
  ...props
}: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  );
}
