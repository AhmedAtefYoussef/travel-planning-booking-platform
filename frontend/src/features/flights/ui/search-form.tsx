'use client';

import { ArrowLeftRight, Minus, Plus, Search } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import {
  Controller,
  useForm,
  useWatch,
  type FieldErrors as RhfErrors,
  type Resolver,
} from 'react-hook-form';
import { ROUTES } from '@/shared/config/routes';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';
import {
  CABIN_CLASSES,
  CABIN_LABELS,
  toQueryString,
  validate,
  type FieldErrors,
  type SearchFormValues,
} from '../model/search-params';

export type AirportOption = { iataCode: string; name: string };

type SearchFormProps = {
  airports: readonly AirportOption[];
  values: SearchFormValues;
  /** Errors from the URL check or the API, shown until the user changes that field. */
  errors?: FieldErrors;
};

const ANY_CABIN = 'ANY';
const MAX_EACH = 9;

/** The same rules the page uses for the URL (model/search-params.ts), as a form resolver. */
const resolver: Resolver<SearchFormValues> = (values) => {
  const problems = validate(values);
  const errors = Object.fromEntries(
    Object.entries(problems).map(([field, message]) => [
      field,
      { type: 'validate', message },
    ]),
  ) as RhfErrors<SearchFormValues>;
  return Object.keys(problems).length
    ? { values: {}, errors }
    : { values, errors: {} };
};

/**
 * FLT-11 / FLT-12 search form. Submitting writes the criteria into the URL, so the server page runs
 * the search, and the result can be refreshed, bookmarked or shared (GEN-15). Price range and sort
 * stay as they were and live in the results toolbar.
 */
export function SearchForm({ airports, values, errors = {} }: SearchFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Built once: useForm re-applies `errors` whenever the object changes, so a fresh object on every
  // render would loop. A new search remounts the form (the page keys it by the URL).
  const [initialErrors] = useState(
    () =>
      Object.fromEntries(
        Object.entries(errors).map(([field, message]) => [
          field,
          { type: 'server', message },
        ]),
      ) as RhfErrors<SearchFormValues>,
  );
  const form = useForm<SearchFormValues>({
    defaultValues: values,
    errors: initialErrors,
    resolver,
  });
  const { control, register, handleSubmit, setValue, getValues, formState } =
    form;
  const [trip, depart, adults, children, infants] = useWatch({
    control,
    name: ['trip', 'depart', 'adults', 'children', 'infants'],
  });

  const onSubmit = handleSubmit((next) => {
    // A new search starts again from the first page of results.
    startTransition(() => {
      router.push(`${ROUTES.flights}?${toQueryString(next)}` as Route);
    });
  });

  const swap = () => {
    const { from, to } = getValues();
    setValue('from', to, { shouldDirty: true });
    setValue('to', from, { shouldDirty: true });
  };

  const fieldError = (name: keyof SearchFormValues) =>
    formState.errors[name]?.message;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Search flights"
      className="grid gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-6"
    >
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Trip type</legend>
        {(
          [
            ['oneway', 'One way'],
            ['round', 'Round trip'],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={cn(
              'cursor-pointer rounded-full border px-3 py-1 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring',
              trip === value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'hover:bg-muted',
            )}
          >
            <input
              type="radio"
              value={value}
              className="sr-only"
              {...register('trip')}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="grid items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
        <AirportField
          name="from"
          label="From"
          control={control}
          airports={airports}
          error={fieldError('from')}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={swap}
          aria-label="Swap departure and arrival airports"
          className="justify-self-center md:mt-6"
        >
          <ArrowLeftRight aria-hidden="true" />
        </Button>
        <AirportField
          name="to"
          label="To"
          control={control}
          airports={airports}
          error={fieldError('to')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField
          label="Departure date"
          required
          hint="Local date at the departure airport"
          error={fieldError('depart')}
        >
          {(props) => <Input type="date" {...props} {...register('depart')} />}
        </FormField>
        {trip === 'round' ? (
          <FormField label="Return date" required error={fieldError('return')}>
            {(props) => (
              <Input
                type="date"
                min={depart}
                {...props}
                {...register('return')}
              />
            )}
          </FormField>
        ) : null}
        <FormField label="Cabin" hint="Optional" error={fieldError('cabin')}>
          {(props) => (
            <Controller
              control={control}
              name="cabin"
              render={({ field }) => (
                <Select
                  value={field.value || ANY_CABIN}
                  onValueChange={(v) =>
                    field.onChange(v === ANY_CABIN ? '' : v)
                  }
                >
                  <SelectTrigger {...props} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_CABIN}>Any cabin</SelectItem>
                    {CABIN_CLASSES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CABIN_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
        </FormField>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-medium">Passengers</legend>
        <Stepper
          label="Adults"
          hint="12 or older"
          value={adults}
          min={1}
          onChange={(n) => setValue('adults', n, { shouldDirty: true })}
          error={fieldError('adults')}
        />
        <Stepper
          label="Children"
          hint="2 to 11"
          value={children}
          min={0}
          onChange={(n) => setValue('children', n, { shouldDirty: true })}
          error={fieldError('children')}
        />
        <Stepper
          label="Infants"
          hint="Under 2, on a lap, 10% of the fare"
          value={infants}
          min={0}
          onChange={(n) => setValue('infants', n, { shouldDirty: true })}
          error={fieldError('infants')}
        />
      </fieldset>

      <div className="flex justify-end">
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="w-full sm:w-auto"
        >
          {pending ? <Spinner /> : <Search aria-hidden="true" />}
          {pending ? 'Searching…' : 'Search flights'}
        </Button>
      </div>
    </form>
  );
}

function AirportField({
  name,
  label,
  control,
  airports,
  error,
}: {
  name: 'from' | 'to';
  label: string;
  control: ReturnType<typeof useForm<SearchFormValues>>['control'];
  airports: readonly AirportOption[];
  error?: string;
}) {
  return (
    <FormField label={label} required error={error}>
      {(props) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <Select
              value={field.value || undefined}
              onValueChange={field.onChange}
            >
              <SelectTrigger {...props} className="w-full">
                <SelectValue placeholder="Choose an airport" />
              </SelectTrigger>
              <SelectContent>
                {airports.map((a) => (
                  <SelectItem key={a.iataCode} value={a.iataCode}>
                    {a.name} ({a.iataCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      )}
    </FormField>
  );
}

/** A count with − and + buttons; the number is announced to screen readers as it changes. */
function Stepper({
  label,
  hint,
  value,
  min,
  onChange,
  error,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  onChange: (n: number) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <span className="text-sm font-medium" id={`${id}-label`}>
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className="flex items-center gap-2"
      >
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          <Minus aria-hidden="true" />
        </Button>
        <output aria-live="polite" className="w-6 text-center tabular-nums">
          {value}
        </output>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= MAX_EACH}
          onClick={() => onChange(value + 1)}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
