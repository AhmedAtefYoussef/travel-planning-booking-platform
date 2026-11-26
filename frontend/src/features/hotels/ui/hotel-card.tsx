import { Bed, Hotel, Star } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { formatMoney } from '@/shared/lib/format';
import { buttonVariants } from '@/shared/ui/button';
import type { HotelResult } from '../api/search.server';
import type { SearchFormValues } from '../model/search-params';

type HotelCardProps = {
  hotel: HotelResult;
  currency: string;
  /** The searched stay, carried to the hotel page so it shows the same dates and guests. */
  stay: Pick<SearchFormValues, 'checkIn' | 'checkOut' | 'guests' | 'rooms'>;
};

/**
 * One search result (HTL-11): photo, name, star class, average rating, price per night and for the
 * whole stay, and how many rooms are free. Server-safe: no hooks.
 */
export function HotelCard({ hotel, currency, stay }: HotelCardProps) {
  const query = new URLSearchParams({
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    guests: String(stay.guests),
    rooms: String(stay.rooms),
  });
  return (
    <article
      aria-label={hotel.name}
      className="grid gap-4 rounded-xl border bg-card p-4 text-card-foreground md:grid-cols-[12rem_1fr_auto]"
    >
      {hotel.photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by the API through the /uploads rewrite
        <img
          src={hotel.photo}
          alt={`Photo of ${hotel.name}`}
          loading="lazy"
          className="aspect-4/3 w-full rounded-lg object-cover md:w-48"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex aspect-4/3 w-full items-center justify-center rounded-lg bg-muted text-muted-foreground md:w-48"
        >
          <Hotel className="size-8" />
        </div>
      )}
      <div className="grid content-start gap-2">
        <h3 className="text-lg font-semibold">{hotel.name}</h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {hotel.starClass ? (
            <span aria-label={`${hotel.starClass} star hotel`}>
              {'★'.repeat(hotel.starClass)}
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            <Star aria-hidden="true" className="size-3.5" />
            {hotel.averageRating === null
              ? 'No reviews yet'
              : `${hotel.averageRating.toFixed(1)} / 5`}
          </span>
        </div>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Bed aria-hidden="true" className="size-3.5" />
          {hotel.freeRooms} free room{hotel.freeRooms === 1 ? '' : 's'} for
          these dates
        </p>
      </div>
      <div className="flex flex-col justify-between gap-3 border-t pt-3 md:items-end md:border-t-0 md:border-l md:pt-0 md:pl-4">
        <div className="md:text-right">
          <p className="text-xl font-semibold">
            <span className="text-sm font-normal text-muted-foreground">
              from{' '}
            </span>
            {formatMoney(hotel.fromPricePerNightMinor, currency)}
            <span className="text-sm font-normal text-muted-foreground">
              /night
            </span>
          </p>
          <p className="text-sm">
            {formatMoney(hotel.fromPriceMinor, currency)} for the stay
          </p>
        </div>
        <Link
          href={`/hotels/${hotel.hotelId}?${query.toString()}` as Route}
          aria-label={`View rooms at ${hotel.name}`}
          className={buttonVariants()}
        >
          View rooms
        </Link>
      </div>
    </article>
  );
}
