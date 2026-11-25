import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type PipelineStage, Types } from 'mongoose';
import { ProviderType } from '../../common/auth/auth.types';
import {
  AIRLINE_STATUS,
  BookingStatus,
  BookingType,
  HOTEL_STATUS,
  REFUNDS_SERVICE,
  type ProviderStatus,
  type RefundsService,
} from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { parseIsoDate } from '../../common/utils/dates';
import { bookingRowsPipeline, travelRangeMatch } from './admin-booking-rows';
import type {
  AdminAnalyticsDto,
  AdminAnalyticsFiguresDto,
  AdminAnalyticsProviderDto,
  AdminAnalyticsQueryDto,
} from './dto/admin-analytics.dto';
import { FlightBooking } from './schemas/flight-booking.schema';
import { HotelReservation } from './schemas/hotel-reservation.schema';

/** The longest period the analytics answers for, both ends included. */
export const MAX_PERIOD_DAYS = 366;

/** Bookings that were made for real: PENDING_PAYMENT holds and EXPIRED ones never count. */
const COUNTED = [
  BookingStatus.Confirmed,
  BookingStatus.Completed,
  BookingStatus.Cancelled,
];

/** One provider and currency, as the aggregation returns it. */
interface Group {
  _id: { type: BookingType; providerId: Types.ObjectId; currency: string };
  bookings: number;
  cancelledBookings: number;
  grossRevenueMinor: number;
  /** Ids of the paid, cancelled bookings: the only ones that can have a refund. */
  refundableIds: Types.ObjectId[];
}

/** to on or after from, and at most MAX_PERIOD_DAYS days in all; otherwise 400 with fieldErrors. */
export function assertPeriod(from: string, to: string): void {
  const days = parseIsoDate(to).diff(parseIsoDate(from), 'days').days + 1;
  if (days < 1) {
    throw new ValidationFailedException([
      { field: 'to', message: 'to must be on or after from' },
    ]);
  }
  if (days > MAX_PERIOD_DAYS) {
    throw new ValidationFailedException([
      {
        field: 'to',
        message: `the period must not be longer than ${MAX_PERIOD_DAYS} days`,
      },
    ]);
  }
}

const figures = (
  g: Pick<Group, 'bookings' | 'cancelledBookings' | 'grossRevenueMinor'>,
  refundedMinor: number,
  currency: string,
): AdminAnalyticsFiguresDto => ({
  bookings: g.bookings,
  confirmedBookings: g.bookings - g.cancelledBookings,
  cancelledBookings: g.cancelledBookings,
  grossRevenueMinor: g.grossRevenueMinor,
  refundedMinor,
  netRevenueMinor: g.grossRevenueMinor - refundedMinor,
  currency,
});

/** Provider rows -> the sum per currency, in the order the currencies first appear. */
export function totalsOf(
  providers: readonly AdminAnalyticsFiguresDto[],
): AdminAnalyticsFiguresDto[] {
  const byCurrency = new Map<string, AdminAnalyticsFiguresDto>();
  for (const p of providers) {
    const t = byCurrency.get(p.currency);
    if (!t) {
      byCurrency.set(p.currency, {
        bookings: p.bookings,
        confirmedBookings: p.confirmedBookings,
        cancelledBookings: p.cancelledBookings,
        grossRevenueMinor: p.grossRevenueMinor,
        refundedMinor: p.refundedMinor,
        netRevenueMinor: p.netRevenueMinor,
        currency: p.currency,
      });
      continue;
    }
    t.bookings += p.bookings;
    t.confirmedBookings += p.confirmedBookings;
    t.cancelledBookings += p.cancelledBookings;
    t.grossRevenueMinor += p.grossRevenueMinor;
    t.refundedMinor += p.refundedMinor;
    t.netRevenueMinor += p.netRevenueMinor;
  }
  return [...byCurrency.values()];
}

/**
 * BON-01: bookings and revenue per provider over a period. One aggregation per booking collection (the
 * same flight + hotel stream as the ACC-17 list, so the period means the same thing: the trip overlaps
 * it), grouped by provider and currency. Refunds are read through REFUNDS_SERVICE for the paid, cancelled
 * bookings only. Read-only.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBooking>,
    @InjectModel(HotelReservation.name)
    private readonly hotels: Model<HotelReservation>,
    @Inject(AIRLINE_STATUS) private readonly airlines: ProviderStatus,
    @Inject(HOTEL_STATUS) private readonly hotelDirectory: ProviderStatus,
    @Inject(REFUNDS_SERVICE) private readonly refunds: RefundsService,
  ) {}

  async analytics(query: AdminAnalyticsQueryDto): Promise<AdminAnalyticsDto> {
    assertPeriod(query.from, query.to);
    const match = {
      ...travelRangeMatch(query.from, query.to),
      status: { $in: COUNTED },
    };
    const { onHotels, pipeline } = bookingRowsPipeline(query.type, match, [
      groupStage(),
    ]);
    const groups = onHotels
      ? await this.hotels.aggregate<Group>(pipeline).exec()
      : await this.flights.aggregate<Group>(pipeline).exec();

    const [refunded, names] = await Promise.all([
      this.refundedOf(groups),
      this.namesOf(groups),
    ]);
    const providers: AdminAnalyticsProviderDto[] = groups
      .map((g) => {
        const { type, providerId, currency } = g._id;
        const id = providerId.toHexString();
        const refundedMinor = g.refundableIds.reduce(
          (sum, b) => sum + (refunded[type].get(b.toHexString()) ?? 0),
          0,
        );
        return {
          providerType:
            type === BookingType.Flight
              ? ProviderType.Airline
              : ProviderType.Hotel,
          providerId: id,
          providerName: names[type].get(id) ?? UNKNOWN[type],
          ...figures(g, refundedMinor, currency),
        };
      })
      .sort(
        (a, b) =>
          b.netRevenueMinor - a.netRevenueMinor ||
          a.providerName.localeCompare(b.providerName) ||
          a.providerId.localeCompare(b.providerId),
      );
    return {
      period: { from: query.from, to: query.to, type: query.type ?? null },
      providers,
      totals: totalsOf(providers),
    };
  }

  /** Refunded amounts of the cancelled bookings, per booking type, in one query each. */
  private async refundedOf(
    groups: Group[],
  ): Promise<Record<BookingType, Map<string, number>>> {
    const idsOf = (type: BookingType) =>
      groups
        .filter((g) => g._id.type === type)
        .flatMap((g) => g.refundableIds.map((id) => id.toHexString()));
    const [flights, hotels] = await Promise.all([
      this.refunds.refundedMinorFor(
        BookingType.Flight,
        idsOf(BookingType.Flight),
      ),
      this.refunds.refundedMinorFor(
        BookingType.Hotel,
        idsOf(BookingType.Hotel),
      ),
    ]);
    return { [BookingType.Flight]: flights, [BookingType.Hotel]: hotels };
  }

  /** Provider id -> name, from the airline and hotel directories, one query each. */
  private async namesOf(
    groups: Group[],
  ): Promise<Record<BookingType, Map<string, string>>> {
    const idsOf = (type: BookingType) => [
      ...new Set(
        groups
          .filter((g) => g._id.type === type)
          .map((g) => g._id.providerId.toHexString()),
      ),
    ];
    const lookup = async (directory: ProviderStatus, ids: string[]) =>
      new Map(
        ids.length === 0
          ? []
          : (await directory.findMany(ids)).map((p) => [p.id, p.name]),
      );
    const [flights, hotels] = await Promise.all([
      lookup(this.airlines, idsOf(BookingType.Flight)),
      lookup(this.hotelDirectory, idsOf(BookingType.Hotel)),
    ]);
    return { [BookingType.Flight]: flights, [BookingType.Hotel]: hotels };
  }
}

const UNKNOWN: Record<BookingType, string> = {
  [BookingType.Flight]: 'Unknown airline',
  [BookingType.Hotel]: 'Unknown hotel',
};

/** Paid = the booking carries the payment that confirmed it. */
const PAID = { $eq: [{ $type: '$paymentId' }, 'objectId'] };
const CANCELLED = { $eq: ['$status', BookingStatus.Cancelled] };

function groupStage(): PipelineStage {
  return {
    $group: {
      _id: { type: '$type', providerId: '$providerId', currency: '$currency' },
      bookings: { $sum: 1 },
      cancelledBookings: { $sum: { $cond: [CANCELLED, 1, 0] } },
      grossRevenueMinor: { $sum: { $cond: [PAID, '$totalMinor', 0] } },
      refundableIds: {
        $push: { $cond: [{ $and: [CANCELLED, PAID] }, '$_id', '$$REMOVE'] },
      },
    },
  };
}
