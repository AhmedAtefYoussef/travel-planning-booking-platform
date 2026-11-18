import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ItineraryBudgetsPort } from './itinerary-budgets.port';
import { BudgetEntry } from './schemas/budget-entry.schema';
import { TransportCost } from './schemas/transport-cost.schema';

const exec = <T>(value: T) => ({ exec: () => Promise.resolve(value) });

/** ITINERARY_BUDGETS (ITN-01, ITN-07, ITN-09, ITN-21) over a mocked collection. */
describe('ItineraryBudgetsPort', () => {
  const itineraryId = new Types.ObjectId().toHexString();
  const d1 = new Types.ObjectId();
  const d2 = new Types.ObjectId();
  const model = () => ({
    aggregate: jest.fn(() =>
      exec([
        { _id: { dayId: d1, currency: 'EUR' }, amountMinor: 300 },
        { _id: { dayId: d1, currency: 'EGP' }, amountMinor: 1500 },
        { _id: { dayId: d2, currency: 'EGP' }, amountMinor: 700 },
      ]),
    ),
    deleteMany: jest.fn(() => exec({ deletedCount: 1 })),
    find: jest.fn(() => ({
      lean: () =>
        exec([
          {
            _id: new Types.ObjectId(),
            itineraryId: new Types.ObjectId(itineraryId),
            dayId: d1,
            amountMinor: 100,
            currency: 'EGP',
            createdAt: new Date(),
          },
          {
            _id: new Types.ObjectId(),
            itineraryId: new Types.ObjectId(itineraryId),
            dayId: d2,
            amountMinor: 200,
            currency: 'EUR',
          },
        ]),
    })),
    insertMany: jest.fn(() => Promise.resolve([])),
  });
  let rows: ReturnType<typeof model>[];
  let port: ItineraryBudgetsPort;

  beforeEach(async () => {
    rows = [model(), model()];
    const moduleRef = await Test.createTestingModule({
      providers: [
        ItineraryBudgetsPort,
        { provide: getModelToken(BudgetEntry.name), useValue: rows[0] },
        { provide: getModelToken(TransportCost.name), useValue: rows[1] },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    port = moduleRef.get(ItineraryBudgetsPort);
  });

  it('dayTotals sums each day per currency across the collections, sorted by currency', async () => {
    const totals = await port.dayTotals(itineraryId);
    // ITN-16 sums transport costs; ITN-14 adds budget entries: count the collections the port read.
    const used = rows.filter((r) => r.aggregate.mock.calls.length > 0).length;
    expect(used).toBeGreaterThan(0);
    const day1 = totals.find((t) => t.dayId === d1.toHexString());
    expect(day1?.amounts).toEqual([
      { currency: 'EGP', amountMinor: 1500 * used },
      { currency: 'EUR', amountMinor: 300 * used },
    ]);
    expect(totals).toHaveLength(2);
  });

  it('ignores malformed ids', async () => {
    expect(await port.dayTotals('nope')).toEqual([]);
    await port.deleteForDays('nope', [d1.toHexString()]);
    await port.deleteForDays(itineraryId, ['nope']);
    await port.deleteForItinerary('nope');
    await port.cloneForItinerary('nope', itineraryId, new Map());
    for (const r of rows) {
      expect(r.deleteMany).not.toHaveBeenCalled();
      expect(r.find).not.toHaveBeenCalled();
    }
  });

  it('deletes the rows of the given days, or of the whole itinerary', async () => {
    await port.deleteForDays(itineraryId, [d1.toHexString()]);
    await port.deleteForItinerary(itineraryId);
    const used = rows.filter((r) => r.deleteMany.mock.calls.length > 0);
    expect(used.length).toBeGreaterThan(0);
    for (const r of used) expect(r.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('clones only rows whose day is mapped, without ids or timestamps', async () => {
    const target = new Types.ObjectId().toHexString();
    const newDay = new Types.ObjectId().toHexString();
    await port.cloneForItinerary(
      itineraryId,
      target,
      new Map([[d1.toHexString(), newDay]]),
    );
    const calls = rows[1].insertMany.mock.calls as unknown as [
      Record<string, unknown>[],
    ][];
    const copies = calls[0][0];
    expect(copies).toHaveLength(1);
    expect(copies[0]).not.toHaveProperty('_id');
    expect(copies[0]).not.toHaveProperty('createdAt');
    expect(String(copies[0].itineraryId)).toBe(target);
    expect(String(copies[0].dayId)).toBe(newDay);
  });
});
