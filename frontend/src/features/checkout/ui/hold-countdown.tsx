'use client';

import { TimerReset } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/shared/lib/utils';
import {
  countdownAnnouncement,
  formatCountdown,
  secondsLeft,
} from '../model/flow';

/**
 * The 10-minute hold on seats or rooms (FLT-22, HTL-18). Calls `onExpire` once when it reaches zero;
 * the API is still the authority and rejects payment after the hold with HOLD_EXPIRED.
 */
export function HoldCountdown({
  holdExpiresAt,
  onExpire,
}: {
  holdExpiresAt: string;
  onExpire: () => void;
}) {
  const [left, setLeft] = useState(() =>
    secondsLeft(holdExpiresAt, Date.now()),
  );

  useEffect(() => {
    const tick = () => {
      const next = secondsLeft(holdExpiresAt, Date.now());
      setLeft(next);
      if (next === 0) onExpire();
      return next;
    };
    if (tick() === 0) return;
    const timer = setInterval(() => {
      if (tick() === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [holdExpiresAt, onExpire]);

  const announcement = countdownAnnouncement(left);
  const urgent = left <= 120;
  return (
    <p
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
        urgent
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'bg-muted text-muted-foreground',
      )}
    >
      <TimerReset className="size-4 shrink-0" aria-hidden="true" />
      <span>
        We are holding this for you for{' '}
        <strong className="font-semibold tabular-nums">
          {formatCountdown(left)}
        </strong>
        . Pay before the timer ends to keep it.
      </span>
      {/* Announced only at a few thresholds, not every second. */}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </p>
  );
}
