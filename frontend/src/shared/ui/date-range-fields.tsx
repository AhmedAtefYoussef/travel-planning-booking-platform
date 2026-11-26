'use client';

import { addDays, isIsoDate } from '@/shared/lib/dates';
import { cn } from '@/shared/lib/utils';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';

export type DateRangeValue = { start: string; end: string };

type DateRangeFieldsProps = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  /** Field errors, from validateStay() or from the API's fieldErrors. */
  errors?: Partial<Record<'start' | 'end', string>>;
  /** Earliest allowed start (today at the provider); omit to allow past dates. */
  minStart?: string;
  /** Longest range in nights; caps the end picker. */
  maxNights?: number;
  startLabel?: string;
  endLabel?: string;
  startName?: string;
  endName?: string;
  required?: boolean;
  className?: string;
};

/**
 * Two native date inputs whose limits follow each other (GEN-16: prevent common input errors):
 * the end can never be picked on or before the start, nor beyond `maxNights`, and the start never
 * before `minStart`. Moving the start past the end clears the end instead of keeping a bad range.
 * Typed values are still validated by the caller and by the API (GEN-13).
 */
export function DateRangeFields({
  value,
  onChange,
  errors = {},
  minStart,
  maxNights,
  startLabel = 'Check-in',
  endLabel = 'Check-out',
  startName = 'checkIn',
  endName = 'checkOut',
  required = true,
  className,
}: DateRangeFieldsProps) {
  const startOk = isIsoDate(value.start);
  const endMin = startOk ? addDays(value.start, 1) : minStart;
  const endMax =
    startOk && maxNights ? addDays(value.start, maxNights) : undefined;

  function changeStart(start: string) {
    const keepEnd =
      !value.end ||
      !isIsoDate(start) ||
      (value.end > start &&
        (!maxNights || value.end <= addDays(start, maxNights)));
    onChange({ start, end: keepEnd ? value.end : '' });
  }

  return (
    <div className={cn('grid gap-4 sm:grid-cols-2', className)}>
      <FormField label={startLabel} error={errors.start} required={required}>
        {(control) => (
          <Input
            {...control}
            type="date"
            name={startName}
            min={minStart}
            value={value.start}
            onChange={(event) => changeStart(event.target.value)}
          />
        )}
      </FormField>
      <FormField label={endLabel} error={errors.end} required={required}>
        {(control) => (
          <Input
            {...control}
            type="date"
            name={endName}
            min={endMin}
            max={endMax}
            value={value.end}
            onChange={(event) =>
              onChange({ start: value.start, end: event.target.value })
            }
          />
        )}
      </FormField>
    </div>
  );
}
