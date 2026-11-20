import { Types } from 'mongoose';
import {
  BOOKING_TRANSITIONS,
  BookingStatus,
  canTransition,
  transitionBooking,
  transitionManyBookings,
  type StatusUpdatableModel,
} from '../../common/contracts';
import { AppException } from '../../common/errors/app.exception';
import { FLIGHT_BOOKINGS_COLLECTION } from './schemas/flight-booking.schema';
import { HOTEL_RESERVATIONS_COLLECTION } from './schemas/hotel-reservation.schema';

const { PendingPayment, Confirmed, Completed, Expired, Cancelled } =
  BookingStatus;

/** The story's lifecycle, spelled out here so a change to BOOKING_TRANSITIONS cannot rewrite its own proof. */
const ALLOWED_EDGES: readonly (readonly [BookingStatus, BookingStatus])[] = [
  [PendingPayment, Confirmed],
  [PendingPayment, Expired],
  [Confirmed, Completed],
  [Confirmed, Cancelled],
];
const TERMINAL = [Completed, Expired, Cancelled] as const;

const ALL = [PendingPayment, Confirmed, Completed, Expired, Cancelled] as const;
const PAIRS = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));
const isAllowed = (from: BookingStatus, to: BookingStatus) =>
  ALLOWED_EDGES.some(([f, t]) => f === from && t === to);
const VALID = PAIRS.filter(([from, to]) => isAllowed(from, to));
const INVALID = PAIRS.filter(([from, to]) => !isAllowed(from, to));

type Doc = { _id: Types.ObjectId; status: BookingStatus; marker: string };

/**
 * A tiny in-memory stand-in for one Mongoose collection. It honours exactly what the transition helpers
 * send ({ _id?, status } filters and $set updates) and throws on anything else, so a helper that starts
 * sending a different filter cannot pass by accident. `writes` counts every write attempt.
 */
class InMemoryBookings implements StatusUpdatableModel {
  readonly docs = new Map<string, Doc>();
  writes = 0;

  constructor(readonly collection: string) {}

  /** One booking per status, the way a busy collection looks. */
  seedOnePerStatus(): Record<BookingStatus, Doc> {
    const byStatus = {} as Record<BookingStatus, Doc>;
    for (const status of ALL) {
      const doc: Doc = {
        _id: new Types.ObjectId(),
        status,
        marker: `${this.collection}/${status}`,
      };
      this.docs.set(doc._id.toHexString(), doc);
      byStatus[status] = doc;
    }
    return byStatus;
  }

  snapshot(): Record<string, Doc> {
    return JSON.parse(JSON.stringify(Object.fromEntries(this.docs))) as Record<
      string,
      Doc
    >;
  }

  private matching(filter: Record<string, unknown>): Doc[] {
    const unknown = Object.keys(filter).filter(
      (k) => k !== '_id' && k !== 'status',
    );
    if (unknown.length)
      throw new Error(`Unexpected filter: ${unknown.join(', ')}`);
    const id = filter._id as string | Types.ObjectId | undefined;
    return [...this.docs.values()].filter(
      (d) =>
        d.status === filter.status &&
        (id === undefined || id.toString() === d._id.toHexString()),
    );
  }

  private run(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    limit: number,
  ) {
    this.writes += 1;
    const set = (update.$set ?? {}) as Partial<Doc>;
    const hit = this.matching(filter).slice(0, limit);
    for (const d of hit) Object.assign(d, set);
    return { exec: () => Promise.resolve({ modifiedCount: hit.length }) };
  }

  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>) {
    return this.run(filter, update, 1);
  }

  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>) {
    return this.run(filter, update, Infinity);
  }
}

/** Confirming must record the payment and the reference (PAY-01, FLT-23, HTL-17). */
const CONFIRM_SET = {
  set: { paymentId: new Types.ObjectId(), reference: 'FL-7K3M9QX2' },
};
const optionsFor = (to: BookingStatus) => (to === Confirmed ? CONFIRM_SET : {});

const COLLECTIONS = [FLIGHT_BOOKINGS_COLLECTION, HOTEL_RESERVATIONS_COLLECTION];

describe('GEN-11 lifecycle matrix: canTransition over all 25 ordered status pairs', () => {
  it('GEN-11 the story edge list is exactly 4 allowed and 21 refused pairs', () => {
    expect(PAIRS).toHaveLength(25);
    expect(VALID).toHaveLength(4);
    expect(INVALID).toHaveLength(21);
  });

  it.each(PAIRS)(
    'GEN-11 canTransition(%s, %s) matches the story',
    (from, to) => {
      expect(canTransition(from, to)).toBe(isAllowed(from, to));
    },
  );

  it('GEN-11 BOOKING_TRANSITIONS lists exactly the story edges and nothing else', () => {
    const listed = Object.entries(BOOKING_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => `${from}->${to}`),
    );
    expect(listed.sort()).toEqual(
      ALLOWED_EDGES.map(([f, t]) => `${f}->${t}`).sort(),
    );
    expect(Object.keys(BOOKING_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it.each(TERMINAL)(
    'GEN-11 %s is terminal: no outgoing edge, not even to itself',
    (status) => {
      expect(BOOKING_TRANSITIONS[status]).toEqual([]);
      for (const to of ALL) expect(canTransition(status, to)).toBe(false);
    },
  );

  it('GEN-11 only PENDING_PAYMENT and CONFIRMED have outgoing edges, and none is a self-pair', () => {
    expect(ALL.filter((s) => BOOKING_TRANSITIONS[s].length > 0).sort()).toEqual(
      [Confirmed, PendingPayment].sort(),
    );
    for (const s of ALL) expect(canTransition(s, s)).toBe(false);
  });
});

describe.each(COLLECTIONS)(
  'GEN-11 lifecycle matrix: transitionBooking on %s',
  (collection) => {
    let model: InMemoryBookings;
    let byStatus: Record<BookingStatus, Doc>;

    beforeEach(() => {
      model = new InMemoryBookings(collection);
      byStatus = model.seedOnePerStatus();
    });

    it.each(VALID)(
      'GEN-11 %s -> %s succeeds, changes only that booking and only its status',
      async (from, to) => {
        const before = model.snapshot();
        const id = byStatus[from]._id.toHexString();
        await expect(
          transitionBooking(model, id, from, to, optionsFor(to)),
        ).resolves.toBe(true);
        expect(model.docs.get(id)?.status).toBe(to);
        // Every other booking is exactly as it was.
        const after = model.snapshot();
        for (const other of Object.keys(before).filter((k) => k !== id)) {
          expect(after[other]).toEqual(before[other]);
        }
        expect(after[id].marker).toBe(before[id].marker);
      },
    );

    it.each(INVALID)(
      'GEN-11 %s -> %s is refused with 409 INVALID_STATE_TRANSITION and leaves every booking unchanged',
      async (from, to) => {
        const before = model.snapshot();
        const id = byStatus[from]._id.toHexString();
        const err = await transitionBooking(
          model,
          id,
          from,
          to,
          optionsFor(to),
        ).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppException);
        expect(err).toMatchObject({
          status: 409,
          code: 'INVALID_STATE_TRANSITION',
        });
        expect(model.snapshot()).toEqual(before);
        expect(model.writes).toBe(0); // refused before any write
      },
    );

    it.each(
      VALID.flatMap(([from, to]) =>
        ALL.filter((actual) => actual !== from).map(
          (actual) => [from, to, actual] as const,
        ),
      ),
    )(
      'GEN-11 %s -> %s on a booking that is really %s changes nothing and reports false',
      async (from, to, actual) => {
        const before = model.snapshot();
        const id = byStatus[actual]._id.toHexString();
        await expect(
          transitionBooking(model, id, from, to, optionsFor(to)),
        ).resolves.toBe(false);
        expect(model.snapshot()).toEqual(before);
      },
    );

    it('GEN-11 walking the whole lifecycle one allowed edge at a time ends in the terminal states', async () => {
      const happy = byStatus[PendingPayment]._id.toHexString();
      await transitionBooking(
        model,
        happy,
        PendingPayment,
        Confirmed,
        CONFIRM_SET,
      );
      await transitionBooking(model, happy, Confirmed, Completed);
      const abandoned = new Types.ObjectId().toHexString();
      model.docs.set(abandoned, {
        _id: new Types.ObjectId(abandoned),
        status: PendingPayment,
        marker: 'hold',
      });
      await transitionBooking(model, abandoned, PendingPayment, Expired);
      const cancelled = byStatus[Confirmed]._id.toHexString();
      await transitionBooking(model, cancelled, Confirmed, Cancelled);
      expect(
        [happy, abandoned, cancelled].map((id) => model.docs.get(id)?.status),
      ).toEqual([Completed, Expired, Cancelled]);
      // Once there, no other status is reachable from any of them.
      for (const id of [happy, abandoned, cancelled]) {
        const current = model.docs.get(id)!.status;
        for (const to of ALL) {
          await expect(
            transitionBooking(model, id, current, to, optionsFor(to)),
          ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
        }
      }
    });
  },
);

describe.each(COLLECTIONS)(
  'GEN-11 lifecycle matrix: transitionManyBookings (lifecycle jobs) on %s',
  (collection) => {
    let model: InMemoryBookings;
    let byStatus: Record<BookingStatus, Doc>;

    beforeEach(() => {
      model = new InMemoryBookings(collection);
      byStatus = model.seedOnePerStatus();
    });

    it.each(
      VALID.filter(([, to]) => to !== Confirmed), // confirming is never done in bulk (PAY-01)
    )(
      'GEN-11 %s -> %s moves only the bookings that are in the source status',
      async (from, to) => {
        const before = model.snapshot();
        await expect(transitionManyBookings(model, from, to)).resolves.toBe(1);
        const after = model.snapshot();
        for (const status of ALL) {
          const id = byStatus[status]._id.toHexString();
          expect(after[id].status).toBe(status === from ? to : status);
          expect(after[id].marker).toBe(before[id].marker);
        }
      },
    );

    it.each(INVALID)(
      'GEN-11 %s -> %s is refused with 409 INVALID_STATE_TRANSITION for the whole batch, before any write',
      async (from, to) => {
        const before = model.snapshot();
        await expect(
          transitionManyBookings(model, from, to),
        ).rejects.toMatchObject({
          status: 409,
          code: 'INVALID_STATE_TRANSITION',
        });
        expect(model.snapshot()).toEqual(before);
        expect(model.writes).toBe(0);
      },
    );

    it('GEN-11 PENDING_PAYMENT -> CONFIRMED is never done in bulk, even though the edge exists', async () => {
      const before = model.snapshot();
      await expect(
        transitionManyBookings(model, PendingPayment, Confirmed),
      ).rejects.toThrow(/one booking at a time/);
      expect(model.snapshot()).toEqual(before);
      expect(model.writes).toBe(0);
    });

    it.each(TERMINAL)(
      'GEN-11 running every lifecycle job never touches the %s booking',
      async (status) => {
        const id = byStatus[status]._id.toHexString();
        const before = { ...model.docs.get(id) };
        await transitionManyBookings(model, PendingPayment, Expired);
        await transitionManyBookings(model, Confirmed, Completed);
        await transitionManyBookings(model, Confirmed, Cancelled);
        expect(model.docs.get(id)).toEqual(before);
      },
    );
  },
);
