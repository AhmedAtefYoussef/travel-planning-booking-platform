'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { ROUTES } from '@/shared/config/routes';
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
import {
  SORT_LABELS,
  SORTS,
  toQueryString,
  validate,
  type FieldErrors,
  type SearchFormValues,
  type SortKey,
} from '../model/search-params';

type ResultsToolbarProps = {
  values: SearchFormValues;
  currency: string;
  /** The API's own price errors (e.g. min above max), shown on the matching input. */
  errors?: FieldErrors;
};

/**
 * FLT-15 refinements without re-filling the form (GEN-15): the sort applies at once, the
 * per-passenger price range applies with one button. Both go into the URL and restart at page 1.
 */
export function ResultsToolbar({
  values,
  currency,
  errors = {},
}: ResultsToolbarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [minPrice, setMinPrice] = useState(values.minPrice);
  const [maxPrice, setMaxPrice] = useState(values.maxPrice);
  const [local, setLocal] = useState<FieldErrors>({});
  const shown = { ...errors, ...local };

  const go = (next: SearchFormValues) =>
    startTransition(() =>
      router.push(`${ROUTES.flights}?${toQueryString(next)}` as Route),
    );

  const applyPrice = (event: FormEvent) => {
    event.preventDefault();
    const next = {
      ...values,
      minPrice: minPrice.trim(),
      maxPrice: maxPrice.trim(),
    };
    const problems = validate(next);
    const priceProblems = {
      minPrice: problems.minPrice,
      maxPrice: problems.maxPrice,
    };
    setLocal(priceProblems);
    if (!priceProblems.minPrice && !priceProblems.maxPrice) go(next);
  };

  const clearPrice = () => {
    setMinPrice('');
    setMaxPrice('');
    setLocal({});
    go({ ...values, minPrice: '', maxPrice: '' });
  };

  return (
    <div className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-[1fr_auto] md:items-end">
      <form
        onSubmit={applyPrice}
        noValidate
        aria-label="Price per passenger"
        className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]"
      >
        <FormField
          label={`Min price (${currency})`}
          hint="Per passenger"
          error={shown.minPrice}
        >
          {(props) => (
            <Input
              inputMode="decimal"
              placeholder="No minimum"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              {...props}
            />
          )}
        </FormField>
        <FormField label={`Max price (${currency})`} error={shown.maxPrice}>
          {(props) => (
            <Input
              inputMode="decimal"
              placeholder="No maximum"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              {...props}
            />
          )}
        </FormField>
        <div className="flex gap-2 sm:mt-6">
          <Button type="submit" variant="secondary" disabled={pending}>
            Apply
          </Button>
          {values.minPrice || values.maxPrice ? (
            <Button type="button" variant="ghost" onClick={clearPrice}>
              Clear
            </Button>
          ) : null}
        </div>
      </form>
      <FormField label="Sort by">
        {(props) => (
          <Select
            value={values.sort}
            onValueChange={(sort) => go({ ...values, sort: sort as SortKey })}
            disabled={pending}
          >
            <SelectTrigger {...props} className="w-full md:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {SORT_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
    </div>
  );
}
