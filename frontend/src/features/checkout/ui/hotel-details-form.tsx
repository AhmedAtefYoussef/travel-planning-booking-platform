'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MinusIcon, PlusIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { isApiError } from '@/shared/api/errors';
import { publicEnv } from '@/shared/config/env';
import { ROUTES } from '@/shared/config/routes';
import { applyApiErrors } from '@/shared/forms/api-errors';
import { formatCalendarDate, formatMoney } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { FormField } from '@/shared/ui/form-field';
import { Separator } from '@/shared/ui/separator';
import { Spinner } from '@/shared/ui/spinner';
import { holdHotel } from '../api/checkout-api';
import type { HotelStay } from '../api/hotel-stay.server';
import { payPath } from '../model/kinds';
import {
  MAX_ADULTS_PER_ROOM,
  MAX_CHILD_AGE,
  roomGuestsError,
  roomsFormSchema,
  stayTotal,
  toHotelBody,
  type HotelSelection,
  type RoomsFormValues,
} from '../model/rooms';

const HOLD_BLOCKERS = new Set([
  'INSUFFICIENT_INVENTORY',
  'PROVIDER_INACTIVE',
  'CONFLICT',
  'NOT_FOUND',
  'SERVICE_UNAVAILABLE',
]);
const CURRENCY = publicEnv.NEXT_PUBLIC_PLATFORM_CURRENCY;

type Schema = ReturnType<typeof roomsFormSchema>;
type FormIn = z.input<Schema>;
type Form = UseFormReturn<FormIn, unknown, RoomsFormValues>;
type StayRoom = HotelStay['rooms'][number];

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs aria-invalid:border-destructive';

/** Message set on a room's own path (`rooms.0`): occupancy rules and API errors. */
function roomMessage(errs: unknown): string | undefined {
  const e = errs as
    { message?: string; root?: { message?: string } } | undefined;
  return e?.root?.message ?? e?.message;
}

/**
 * Guests per room for a hotel booking (HTL-16, HTL-17) and the hold of the rooms. Rooms that are no
 * longer free must be removed before the hold.
 */
export function HotelDetailsForm({
  selection,
  stay,
}: {
  selection: HotelSelection;
  stay: HotelStay;
}) {
  const router = useRouter();
  const [rooms, setRooms] = useState<StayRoom[]>(stay.rooms);
  const schema = useMemo(
    () => roomsFormSchema(rooms.map((r) => r.maxOccupancy)),
    [rooms],
  );
  const schemaRef = useRef(schema);
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);

  const form = useForm<FormIn, unknown, RoomsFormValues>({
    resolver: ((v, c, o) =>
      zodResolver(schemaRef.current)(v, c, o)) as Resolver<
      FormIn,
      unknown,
      RoomsFormValues
    >,
    mode: 'onBlur',
    defaultValues: {
      rooms: stay.rooms.map((r) => {
        const chosen = selection.rooms.find((s) => s.roomId === r.roomId);
        return {
          adults: chosen?.adults ?? 1,
          childrenAges: [...(chosen?.childrenAges ?? [])],
        };
      }),
    },
  });
  const { fields, remove } = useFieldArray({
    control: form.control,
    name: 'rooms',
  });
  const { errors, isSubmitting } = form.formState;

  const [rootError, setRootError] = useState<string | null>(null);
  const [soldOut, setSoldOut] = useState(false);

  const removeRoom = (i: number) => {
    setRooms((prev) => prev.filter((_, k) => k !== i));
    remove(i);
  };

  const hasUnavailable = rooms.some((r) => !r.available);
  const onSubmit = form.handleSubmit(async (data) => {
    setRootError(null);
    setSoldOut(false);
    try {
      const reservation = await holdHotel(
        toHotelBody(
          selection,
          rooms.map((r) => r.roomId),
          data,
        ),
      );
      router.replace(payPath('hotel', reservation.id) as Route);
    } catch (e) {
      if (isApiError(e) && HOLD_BLOCKERS.has(e.code)) {
        toast.error(e.message);
        setRootError(e.message);
        setSoldOut(true);
        return;
      }
      setRootError(applyApiErrors(e, form.setError, ['rooms']));
    }
  });

  const free = rooms.filter((r) => r.available);
  const total = stayTotal(free);
  const listError = errors.rooms?.root?.message ?? errors.rooms?.message;

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="grid gap-6 lg:grid-cols-[1fr_22rem]"
    >
      <div className="grid content-start gap-6">
        <StayCard stay={stay} />
        {fields.map((field, i) =>
          rooms[i] ? (
            <RoomCard
              key={field.id}
              index={i}
              room={rooms[i]}
              nights={stay.nights}
              form={form}
              canRemove={rooms.length > 1}
              onRemove={() => removeRoom(i)}
            />
          ) : null,
        )}
      </div>

      <Card className="h-fit lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle>Price summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 text-sm">
            {free.map((r) => (
              <div key={r.roomId} className="flex justify-between gap-2">
                <span>
                  Room {r.number} · {stay.nights} night
                  {stay.nights === 1 ? '' : 's'}
                </span>
                <span>
                  {r.stayTotalMinor === null
                    ? '—'
                    : formatMoney(r.stayTotalMinor, CURRENCY)}
                </span>
              </div>
            ))}
            <Separator />
            <div
              aria-live="polite"
              className="flex justify-between gap-2 text-base font-semibold"
            >
              <span>Total</span>
              <span>{total === null ? '—' : formatMoney(total, CURRENCY)}</span>
            </div>
          </div>
          {hasUnavailable ? (
            <p role="alert" className="text-sm text-destructive">
              Some rooms are no longer free for these dates. Remove them to
              continue.
            </p>
          ) : null}
          {listError ? (
            <p role="alert" className="text-sm text-destructive">
              {listError}
            </p>
          ) : null}
          {rootError ? (
            <div role="alert" className="grid gap-2 text-sm text-destructive">
              <p>{rootError}</p>
              {soldOut ? (
                <Link href={ROUTES.hotels as Route} className="underline">
                  Back to hotel search
                </Link>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" disabled={isSubmitting || hasUnavailable}>
            {isSubmitting ? <Spinner label="Holding rooms" /> : null}
            Hold rooms and continue
          </Button>
          <p className="text-sm text-muted-foreground">
            Your rooms are held for 10 minutes while you review the policies and
            pay.
          </p>
        </CardContent>
      </Card>
    </form>
  );
}

function StayCard({ stay }: { stay: HotelStay }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{stay.hotelName}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm sm:grid-cols-[1fr_auto]">
        <div className="grid content-start gap-1">
          <p className="text-muted-foreground">{stay.address}</p>
          <p className="font-medium">
            {formatCalendarDate(stay.checkIn)} →{' '}
            {formatCalendarDate(stay.checkOut)}
          </p>
          <p>
            {stay.nights} night{stay.nights === 1 ? '' : 's'}
          </p>
          {stay.checkInTime || stay.checkOutTime ? (
            <p className="text-muted-foreground">
              {stay.checkInTime ? `Check-in from ${stay.checkInTime}` : null}
              {stay.checkInTime && stay.checkOutTime ? ' · ' : null}
              {stay.checkOutTime ? `Check-out by ${stay.checkOutTime}` : null}
            </p>
          ) : null}
        </div>
        {stay.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stay.photo}
            alt={stay.hotelName}
            loading="lazy"
            className="h-24 w-full rounded-md object-cover sm:w-40"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function RoomCard({
  index,
  room,
  nights,
  form,
  canRemove,
  onRemove,
}: {
  index: number;
  room: StayRoom;
  nights: number;
  form: Form;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const { control } = form;
  const own = useWatch({ control, name: `rooms.${index}` });
  const errs = form.formState.errors.rooms?.[index];
  const adults = Number(own?.adults) || 0;
  const ages = own?.childrenAges ?? [];
  const guests = adults + ages.length;
  const maxAdults = Math.min(MAX_ADULTS_PER_ROOM, room.maxOccupancy);
  const shownError = roomMessage(errs);
  const message =
    shownError ??
    (own
      ? roomGuestsError({ adults, childrenAges: ages }, room.maxOccupancy)
      : null);

  return (
    <Card>
      <fieldset className="grid gap-4">
        <CardHeader>
          <legend className="contents">
            <CardTitle className="flex flex-wrap items-center gap-2">
              Room {room.number}
              <Badge variant="outline">{room.type}</Badge>
            </CardTitle>
          </legend>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1 text-sm">
            <p className="text-muted-foreground">
              {room.beds} bed{room.beds === 1 ? '' : 's'} · sleeps up to{' '}
              {room.maxOccupancy}
            </p>
            <p>
              {formatMoney(room.priceMinor, CURRENCY)} per night
              {room.stayTotalMinor !== null
                ? ` · ${formatMoney(room.stayTotalMinor, CURRENCY)} for ${nights} night${nights === 1 ? '' : 's'}`
                : ''}
            </p>
          </div>

          {!room.available ? (
            <p role="alert" className="text-sm text-destructive">
              No longer free for these dates. Remove it to continue.
            </p>
          ) : null}

          <FormField label="Adults">
            {(c) => (
              <Controller
                control={control}
                name={`rooms.${index}.adults`}
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Fewer adults"
                      disabled={adults <= 0}
                      onClick={() => field.onChange(Math.max(0, adults - 1))}
                    >
                      <MinusIcon aria-hidden="true" />
                    </Button>
                    <output
                      id={c.id}
                      aria-live="polite"
                      className="w-8 text-center font-medium"
                    >
                      {adults}
                    </output>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="More adults"
                      disabled={adults >= maxAdults}
                      onClick={() =>
                        field.onChange(Math.min(maxAdults, adults + 1))
                      }
                    >
                      <PlusIcon aria-hidden="true" />
                    </Button>
                  </div>
                )}
              />
            )}
          </FormField>

          <Controller
            control={control}
            name={`rooms.${index}.childrenAges`}
            render={({ field }) => {
              const list = (field.value ?? []) as number[];
              const childErrs = (
                errs as
                  | { childrenAges?: ({ message?: string } | undefined)[] }
                  | undefined
              )?.childrenAges;
              return (
                <div className="grid gap-3">
                  {list.map((age, j) => (
                    <div key={j} className="flex items-end gap-2">
                      <FormField
                        label={`Child ${j + 1} age`}
                        error={childErrs?.[j]?.message}
                        className="flex-1"
                      >
                        {(c) => (
                          <select
                            {...c}
                            className={SELECT_CLASS}
                            value={Number.isNaN(age) ? '' : String(age)}
                            onChange={(e) => {
                              const next = [...list];
                              next[j] =
                                e.target.value === ''
                                  ? Number.NaN
                                  : Number(e.target.value);
                              field.onChange(next);
                            }}
                            onBlur={field.onBlur}
                          >
                            <option value="">Select age</option>
                            <option value="0">Under 1</option>
                            {Array.from({ length: MAX_CHILD_AGE }, (_, k) => (
                              <option key={k + 1} value={k + 1}>
                                {k + 1} {k === 0 ? 'year' : 'years'}
                              </option>
                            ))}
                          </select>
                        )}
                      </FormField>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          field.onChange(list.filter((_, k) => k !== j))
                        }
                      >
                        Remove child {j + 1}
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={guests >= room.maxOccupancy}
                      onClick={() => field.onChange([...list, Number.NaN])}
                    >
                      Add a child
                    </Button>
                  </div>
                </div>
              );
            }}
          />

          {message ? (
            <p
              role={shownError ? 'alert' : undefined}
              className={
                shownError
                  ? 'text-sm text-destructive'
                  : 'text-sm text-muted-foreground'
              }
            >
              {message}
            </p>
          ) : null}

          <div>
            <Button
              type="button"
              variant="ghost"
              disabled={!canRemove}
              onClick={onRemove}
            >
              Remove room {room.number}
            </Button>
          </div>
        </CardContent>
      </fieldset>
    </Card>
  );
}
