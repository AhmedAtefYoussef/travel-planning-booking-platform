'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { ROUTES } from '@/shared/config/routes';
import { Button } from '@/shared/ui/button';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import {
  HOTEL_SORTS,
  RATING_OPTIONS,
  SORT_LABELS,
  toQueryString,
  validate,
  type FieldErrors,
  type HotelSort,
  type SearchFormValues,
} from '../model/search-params';
import { NativeSelect } from './native-select';

type ResultsToolbarProps = {
  values: SearchFormValues;
  currency: string;
  /** The API's own refinement errors (e.g. min above max), shown on the matching input. */
  errors?: FieldErrors;
};

/**
 * HTL-12 refinements without re-filling the form (GEN-15): price per night, minimum rating and
 * sort apply with one button. They go into the URL and restart at page 1.
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
  const [minRating, setMinRating] = useState(values.minRating);
  const [sort, setSort] = useState<HotelSort>(values.sort);
  const [local, setLocal] = useState<FieldErrors>({});
  const shown = { ...errors, ...local };

  const go = (next: SearchFormValues) =>
    startTransition(() =>
      router.push(`${ROUTES.hotels}?${toQueryString(next)}` as Route),
    );

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const next = {
      ...values,
      minPrice: minPrice.trim(),
      maxPrice: maxPrice.trim(),
      minRating,
      sort,
    };
    const problems = validate(next);
    const refinement = {
      minPrice: problems.minPrice,
      maxPrice: problems.maxPrice,
      minRating: problems.minRating,
    };
    setLocal(refinement);
    if (!refinement.minPrice && !refinement.maxPrice && !refinement.minRating)
      go(next);
  };

  const clear = () => {
    setMinPrice('');
    setMaxPrice('');
    setMinRating('');
    setLocal({});
    go({ ...values, minPrice: '', maxPrice: '', minRating: '' });
  };

  const active = values.minPrice || values.maxPrice || values.minRating;

  return (
    <form
      onSubmit={apply}
      noValidate
      aria-label="Refine results"
      className="grid items-start gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
    >
      <FormField
        label={`Min price (${currency})`}
        hint="Per night"
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
      <FormField label="Minimum rating" error={shown.minRating}>
        {(props) => (
          <NativeSelect
            {...props}
            value={minRating}
            onChange={(e) => setMinRating(e.target.value)}
          >
            {RATING_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r === '' ? 'Any rating' : `${r}+`}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField label="Sort by" error={shown.sort}>
        {(props) => (
          <NativeSelect
            {...props}
            value={sort}
            onChange={(e) => setSort(e.target.value as HotelSort)}
          >
            {HOTEL_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="flex gap-2 md:mt-6">
        <Button type="submit" variant="secondary" disabled={pending}>
          Apply
        </Button>
        {active ? (
          <Button type="button" variant="ghost" onClick={clear}>
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  );
}
