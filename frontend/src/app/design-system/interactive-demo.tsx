'use client';

import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';

/** Client-only demos for the showcase page: confirm dialog and toasts. */
export function InteractiveDemo() {
  return (
    <div className="flex flex-wrap gap-3">
      <ConfirmDialog
        trigger={
          <Button variant="destructive">
            <Trash2 aria-hidden="true" />
            Delete booking
          </Button>
        }
        title="Delete this booking?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await Promise.resolve();
          toast.success('Booking deleted');
        }}
      />
      <Button
        variant="outline"
        onClick={() => toast.info('This is an info toast')}
      >
        Show toast
      </Button>
    </div>
  );
}
