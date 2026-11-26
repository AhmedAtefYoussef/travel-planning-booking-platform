'use client';

import { Search } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from 'react';
import { ROUTES } from '@/shared/config/routes';
import { Button } from '@/shared/ui/button';
import { DateRangeFields } from '@/shared/ui/date-range-fields';
import { FormField } from '@/shared/ui/form-field';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import {
  earliestCheckIn,
  MAX_GUESTS,
  MAX_ROOMS,
  MAX_STAY_NIGHTS,
  toQueryString,
  validate,
  type FieldErrors,
  type SearchFormValues,
} from '../model/search-params';
import { NativeSelect } from './native-select';

export type DestinationOption = {
  code: string;
  name: string;
  cities: { cityId: string; name: string }[];
};

type SearchFormProps = {
  destinations: readonly DestinationOption[];
  values: SearchFormValues;
  /** Errors from the URL check or the API, shown until the form is submitted again. */
  errors?: FieldErrors;
};

/**
 * HTL-11 search form. Submitting writes the criteria into the URL, so the server page runs the
 * search, and the result can be refreshed, bookmarked or shared (GEN-15). Price, rating and sort
 * keep their current values and are changed in the results toolbar.
 */
export function SearchForm({
  destinations,
  values,
  errors = {},
}: SearchFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [destination, setDestination] = useState(values.destination);
  const [stay, setStay] = useState({
    start: values.checkIn,
    end: values.checkOut,
  });
  const [guests, setGuests] = useState(String(values.guests));
  const [rooms, setRooms] = useState(String(values.rooms));
  const [shown, setShown] = useState<FieldErrors>(errors);
  const [failedSubmits, setFailedSubmits] = useState(0);

  // Move focus to the first invalid field after a failed submit.
  useEffect(() => {
    if (failedSubmits > 0)
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
  }, [failedSubmits]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const next: SearchFormValues = {
      ...values,
      destination,
      checkIn: stay.start,
      checkOut: stay.end,
      guests: guests.trim() === '' ? Number.NaN : Number(guests),
      rooms: rooms.trim() === '' ? Number.NaN : Number(rooms),
    };
    const problems = validate(next);
    setShown(problems);
    if (Object.keys(problems).length) {
      setFailedSubmits((n) => n + 1);
      return;
    }
    // A new search starts again from the first page of results.
    startTransition(() => {
      router.push(`${ROUTES.hotels}?${toQueryString(next)}` as Route);
    });
  };

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      aria-label="Search hotels"
      className="grid gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-6"
    >
      <FormField label="Destination" required error={shown.destination}>
        {(props) => (
          <NativeSelect
            {...props}
            name="destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="">Choose a city or country</option>
            {destinations.map((country) => (
              <optgroup key={country.code} label={country.name}>
                <option value={`country:${country.code}`}>
                  All of {country.name}
                </option>
                {country.cities.map((city) => (
                  <option key={city.cityId} value={`city:${city.cityId}`}>
                    {city.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        )}
      </FormField>

      <DateRangeFields
        value={stay}
        onChange={setStay}
        errors={{ start: shown.checkIn, end: shown.checkOut }}
        minStart={earliestCheckIn()}
        maxNights={MAX_STAY_NIGHTS}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Guests" required error={shown.guests}>
          {(props) => (
            <Input
              {...props}
              type="number"
              name="guests"
              inputMode="numeric"
              min={1}
              max={MAX_GUESTS}
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="Rooms" required error={shown.rooms}>
          {(props) => (
            <Input
              {...props}
              type="number"
              name="rooms"
              inputMode="numeric"
              min={1}
              max={MAX_ROOMS}
              value={rooms}
              onChange={(e) => setRooms(e.target.value)}
            />
          )}
        </FormField>
      </div>

      <div className="flex justify-end">
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="w-full sm:w-auto"
        >
          {pending ? <Spinner /> : <Search aria-hidden="true" />}
          {pending ? 'Searching…' : 'Search hotels'}
        </Button>
      </div>
    </form>
  );
}
