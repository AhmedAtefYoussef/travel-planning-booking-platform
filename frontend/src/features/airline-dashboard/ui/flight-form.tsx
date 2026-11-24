'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  Controller,
  useForm,
  type Control,
  type FieldValues,
  type Path,
} from 'react-hook-form';
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
import { Spinner } from '@/shared/ui/spinner';
import { createFlight, updateFlight } from '../api/mutations';
import {
  createFlightSchema,
  editFlightSchema,
  flightChanges,
  type CreateFlightInput,
  type EditFlightInput,
} from '../model/forms';
import { FormAlert } from './form-alert';
import { useSave } from './use-save';

export type AirportChoice = {
  iataCode: string;
  name: string;
  timeZone: string;
};

const FIELDS = ['flightNumber', 'from', 'to', 'departureLocal', 'arrivalLocal'];

/** FLT-03: a new flight in airport-local times; then straight to adding its cabins (GEN-15). */
export function CreateFlightForm({
  airports,
}: {
  airports: readonly AirportChoice[];
}) {
  const router = useRouter();
  const form = useForm<CreateFlightInput, unknown, CreateFlightInput>({
    defaultValues: {
      flightNumber: '',
      from: '',
      to: '',
      departureLocal: '',
      arrivalLocal: '',
    },
    resolver: zodResolver(createFlightSchema),
  });
  const { register, handleSubmit, setError, formState, control } = form;
  const { save, formError } = useSave(setError, FIELDS);

  const onSubmit = handleSubmit((v) =>
    save(
      () => createFlight(v),
      'Flight created. Now add its cabins.',
      (flight) =>
        router.push(
          `${ROUTES.airlineDashboard}/flights/${flight.id}#cabins` as Route,
        ),
    ),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormAlert message={formError} />
      <FormField
        label="Flight number"
        required
        hint="2 to 8 letters or digits, e.g. MS777"
        error={formState.errors.flightNumber?.message}
        className="max-w-xs"
      >
        {(props) => (
          <Input
            className="uppercase"
            {...props}
            {...register('flightNumber')}
          />
        )}
      </FormField>
      <RouteAndTimes
        control={control}
        airports={airports}
        errors={formState.errors}
        register={register}
      />
      <div>
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <Spinner /> : null}
          Create flight
        </Button>
      </div>
    </form>
  );
}

/**
 * FLT-05: change airports (only while nothing is booked) and times. Only changed fields are sent;
 * passengers with confirmed bookings are notified of a time change by the API.
 */
export function EditFlightForm({
  flightId,
  airports,
  current,
  hasBookings,
}: {
  flightId: string;
  airports: readonly AirportChoice[];
  current: EditFlightInput;
  hasBookings: boolean;
}) {
  const form = useForm<EditFlightInput, unknown, EditFlightInput>({
    defaultValues: current,
    resolver: zodResolver(editFlightSchema),
  });
  const { register, handleSubmit, setError, formState, control, reset } = form;
  const { save, formError } = useSave(setError, FIELDS);

  const onSubmit = handleSubmit(async (v) => {
    const changes = flightChanges(current, v);
    const saved = await save(
      () => updateFlight({ id: flightId }, changes),
      'Flight updated',
    );
    if (saved) reset(v);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormAlert message={formError} />
      <RouteAndTimes
        control={control}
        airports={airports}
        errors={formState.errors}
        register={register}
        airportsLocked={hasBookings}
      />
      {hasBookings ? (
        <p className="text-xs text-muted-foreground">
          Seats are booked or held, so the airports can no longer change.
          Passengers with confirmed bookings are notified when you change the
          times.
        </p>
      ) : null}
      <div>
        <Button
          type="submit"
          disabled={formState.isSubmitting || !formState.isDirty}
        >
          {formState.isSubmitting ? <Spinner /> : null}
          Save changes
        </Button>
      </div>
    </form>
  );
}

function RouteAndTimes<T extends FieldValues>({
  control,
  airports,
  errors,
  register,
  airportsLocked = false,
}: {
  control: Control<T>;
  airports: readonly AirportChoice[];
  errors: Partial<Record<string, { message?: string }>>;
  register: (name: Path<T>) => object;
  airportsLocked?: boolean;
}) {
  const airportSelect = (name: 'from' | 'to', label: string) => (
    <FormField label={label} required error={errors[name]?.message}>
      {(props) => (
        <Controller
          control={control}
          name={name as Path<T>}
          render={({ field }) => (
            <Select
              value={(field.value as string) || undefined}
              onValueChange={field.onChange}
              disabled={airportsLocked}
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
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {airportSelect('from', 'From')}
      {airportSelect('to', 'To')}
      <FormField
        label="Departure"
        required
        hint="Local time at the departure airport"
        error={errors.departureLocal?.message}
      >
        {(props) => (
          <Input
            type="datetime-local"
            {...props}
            {...register('departureLocal' as Path<T>)}
          />
        )}
      </FormField>
      <FormField
        label="Arrival"
        required
        hint="Local time at the arrival airport"
        error={errors.arrivalLocal?.message}
      >
        {(props) => (
          <Input
            type="datetime-local"
            {...props}
            {...register('arrivalLocal' as Path<T>)}
          />
        )}
      </FormField>
    </div>
  );
}
