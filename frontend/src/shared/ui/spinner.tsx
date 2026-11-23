import { Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

type SpinnerProps = { label?: string; className?: string };

/** Inline loading indicator with an accessible label (GEN-04 loading states). */
export function Spinner({ label = 'Loading', className }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2
        aria-hidden="true"
        className={cn('size-4 animate-spin', className)}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
