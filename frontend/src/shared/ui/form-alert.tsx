import { CircleAlert } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

type FormAlertProps = {
  /** Nothing is rendered while this is null or empty. */
  message: string | null;
  className?: string;
};

/**
 * A form-level error that belongs to no single field (GEN-02, GEN-16). It is announced to screen
 * readers as soon as it appears. Field errors stay next to their inputs (see FormField).
 */
export function FormAlert({ message, className }: FormAlertProps) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm',
        className,
      )}
    >
      <CircleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <span>{message}</span>
    </p>
  );
}
