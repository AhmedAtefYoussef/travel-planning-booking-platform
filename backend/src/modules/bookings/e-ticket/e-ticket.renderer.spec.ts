import type { Airport, AirlinePolicySnapshot } from '../../../common/contracts';
import { pdfText } from '../../../../test/support/pdf-text';
import { Settings } from 'luxon';
import { canPrint, renderETicket } from './e-ticket.renderer';
import {
  eTicketLines,
  formatLocal,
  maskDocument,
  toETicketView,
  type ETicketBooking,
} from './e-ticket.view';

const airports = new Map<string, Airport>([
  [
    'CAI',
    {
      iataCode: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    },
  ],
  [
    'LHR',
    {
      iataCode: 'LHR',
      name: 'London Heathrow Airport',
      cityId: 'london',
      countryCode: 'GB',
      timeZone: 'Europe/London',
    },
  ],
]);

const airline: AirlinePolicySnapshot = {
  airlineId: 'a1',
  airlineName: 'Nile Air',
  airlineCode: 'NA',
  flightNumber: 'NA777',
  cabinClass: 'ECONOMY',
  freeBags: 2,
  maxKgPerBag: 23,
  cancellationTiers: [
    { daysBefore: 7, refundPercent: 100 },
    { daysBefore: 1, refundPercent: 50 },
  ],
  extraBaggage: { pricePerBagMinor: 5_000, maxExtraBagsPerPassenger: 2 },
};

const booking = (over: Partial<ETicketBooking> = {}): ETicketBooking => ({
  reference: 'FL-AB12CD34',
  totalMinor: 120_050,
  currency: 'EGP',
  confirmedAt: new Date('2026-11-16T09:30:00Z'),
  policySnapshot: { version: 'v123', airlines: [airline] },
  // Winter: Cairo is UTC+2, London UTC+0.
  segments: [
    {
      flightNumber: 'NA777',
      cabinClass: 'ECONOMY',
      from: 'CAI',
      to: 'LHR',
      departureUtc: new Date('2026-12-01T08:00:00Z'),
      arrivalUtc: new Date('2026-12-01T12:30:00Z'),
    },
  ],
  passengers: [
    {
      type: 'ADULT',
      firstName: 'Mona',
      lastName: 'Adel',
      documentNumber: 'A1234567',
      extraBags: 1,
      extraBagsWeightKg: 20,
    },
    {
      type: 'INFANT',
      firstName: 'Lina',
      lastName: 'Adel',
      documentNumber: 'B7654321',
      extraBags: 0,
      extraBagsWeightKg: null,
    },
  ],
  ...over,
});

const view = (over: Partial<ETicketBooking> = {}) =>
  toETicketView({
    booking: booking(over),
    booker: 'Mona Adel',
    airports,
    airlines: [airline],
    now: new Date('2026-11-16T10:00:00Z'),
  });

describe('FLT-23 e-ticket (GEN-06 local times, passport masking)', () => {
  it("renders local times in each airport's zone", async () => {
    const v = view();
    expect(v.segments[0].departure).toEqual({
      iataCode: 'CAI',
      airportName: 'Cairo International Airport',
      localTime: 'Tue 1 Dec 2026, 10:00 (UTC+02:00, Africa/Cairo)',
    });
    expect(v.segments[0].arrival.localTime).toBe(
      'Tue 1 Dec 2026, 12:30 (UTC+00:00, Europe/London)',
    );
    const text = pdfText(await renderETicket(v));
    expect(text).toContain(
      'Depart Cairo International Airport (CAI)\n      Tue 1 Dec 2026, 10:00 (UTC+02:00, Africa/Cairo)',
    );
    expect(text).toContain(
      'Arrive London Heathrow Airport (LHR)\n      Tue 1 Dec 2026, 12:30 (UTC+00:00, Europe/London)',
    );
  });

  it('follows daylight saving: London in July is UTC+01:00', () => {
    expect(formatLocal(new Date('2027-07-01T12:00:00Z'), 'Europe/London')).toBe(
      'Thu 1 Jul 2027, 13:00 (UTC+01:00, Europe/London)',
    );
    // An unknown zone is shown as UTC, labelled, never silently as local.
    expect(formatLocal(new Date('2027-07-01T12:00:00Z'), 'Nowhere/X')).toBe(
      'Thu 1 Jul 2027, 12:00 (UTC+00:00, UTC)',
    );
  });

  it('masks each passport or ID to its last 4 characters; the full number never reaches the PDF', async () => {
    expect(maskDocument('A1234567')).toBe('****4567');
    expect(maskDocument('AB123')).toBe('****B123');
    const pdf = await renderETicket(view());
    const text = pdfText(pdf);
    expect(text).toContain('****4567');
    expect(text).toContain('****4321');
    expect(text).not.toContain('A1234567');
    expect(text).not.toContain('B7654321');
    expect(pdf.toString('latin1')).not.toContain('A1234567');
  });

  it('shows the reference, booker, airline, cabin, bags, total and policies; Title is "E-ticket <reference>"', async () => {
    const pdf = await renderETicket(view());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('E-ticket FL-AB12CD34');
    const text = pdfText(pdf);
    for (const expected of [
      'Booking reference: FL-AB12CD34',
      'Booked by: Mona Adel',
      'Issued: 16 Nov 2026, 09:30 UTC',
      '1. Nile Air NA777 - ECONOMY',
      'Mona Adel (ADULT) - document ****4567 - 2 free bag(s), 1 extra bag(s) (20 kg)',
      'Lina Adel (INFANT) - document ****4321 - 2 free bag(s), no extra bags',
      'Total paid: 1200.50 EGP',
      'Nile Air (NA777): 100% refund if cancelled at least 7 day(s) before departure; 50% refund if cancelled at least 1 day(s) before departure.',
    ]) {
      // Long lines wrap; compare with the wrapping undone.
      expect(text.replace(/\s+/g, ' ')).toContain(expected);
    }
  });

  it('falls back to the IATA code and UTC for an airport missing from reference data, and to the code for the airline', () => {
    const v = toETicketView({
      booking: booking({
        policySnapshot: null,
        confirmedAt: null,
        segments: [{ ...booking().segments[0], to: 'XXX' }],
      }),
      booker: 'Mona Adel',
      airports,
      airlines: [null],
      now: new Date('2026-11-16T10:00:00Z'),
    });
    expect(v.segments[0].arrival).toEqual({
      iataCode: 'XXX',
      airportName: 'XXX',
      localTime: 'Tue 1 Dec 2026, 12:30 (UTC+00:00, UTC)',
    });
    expect(v.segments[0].airline).toBe('Airline NA');
    expect(v.issuedAt).toBe('16 Nov 2026, 10:00 UTC');
    expect(v.passengers[0].freeBags).toBe(0);
    expect(eTicketLines(v).map((l) => l.text)).not.toContain(
      expect.stringContaining('Terms version'),
    );
  });

  it('a round trip lists both flights and an airline with no tiers refunds nothing', () => {
    const back = {
      ...booking().segments[0],
      flightNumber: 'NA778',
      from: 'LHR',
      to: 'CAI',
      departureUtc: new Date('2026-12-10T08:00:00Z'),
      arrivalUtc: new Date('2026-12-10T13:00:00Z'),
    };
    const v = toETicketView({
      booking: booking({ segments: [booking().segments[0], back] }),
      booker: 'Mona Adel',
      airports,
      airlines: [
        airline,
        { ...airline, flightNumber: 'NA778', cancellationTiers: [] },
      ],
      now: new Date(),
    });
    const lines = eTicketLines(v).map((l) => l.text);
    expect(lines).toContain('2. Nile Air NA778 - ECONOMY');
    const depart = lines.indexOf('   Depart London Heathrow Airport (LHR)');
    expect(depart).toBeGreaterThan(0);
    expect(lines[depart + 1]).toBe(
      '      Thu 10 Dec 2026, 08:00 (UTC+00:00, Europe/London)',
    );
    expect(lines).toContain('Nile Air (NA778): no refund on cancellation.');
  });

  it('prints Latin Extended, Greek and Cyrillic names with the embedded font; Arabic gets the fallback', async () => {
    expect(canPrint('Łukasz Żółć')).toBe(true);
    expect(canPrint('Νίκος Παπαδόπουλος')).toBe(true);
    expect(canPrint('Иван Петров')).toBe(true);
    expect(canPrint('Mona Adel')).toBe(true);
    expect(canPrint('منى عادل')).toBe(false);
    expect(canPrint('Mona\u0000')).toBe(false);

    const base = booking();
    const v = toETicketView({
      booking: {
        ...base,
        passengers: [
          { ...base.passengers[0], firstName: 'Łukasz', lastName: 'Żółć' },
          { ...base.passengers[1], firstName: 'منى', lastName: 'عادل' },
          {
            ...base.passengers[0],
            firstName: 'Mona',
            lastName: 'Adel',
            documentNumber: 'C1112222',
          },
        ],
      },
      booker: 'منى عادل',
      airports,
      airlines: [{ ...airline, airlineName: 'طيران النيل' }],
      now: new Date('2026-11-16T10:00:00Z'),
      canPrint,
    });
    expect(v.passengers.map((p) => p.name)).toEqual([
      'Łukasz Żółć',
      'Passenger 2 (name as booked)',
      'Mona Adel',
    ]);
    expect(v.booker).toBe('Account holder');
    expect(v.segments[0].airline).toBe('Airline NA');
    expect(v.policyNotes[0]).toMatch(/^Airline NA \(NA777\)/);

    const pdf = await renderETicket(v);
    const text = pdfText(pdf);
    expect(text).toContain('1. Łukasz Żółć (ADULT)');
    expect(text).toContain('2. Passenger 2 (name as booked) (INFANT)');
    expect(text).toContain('Booked by: Account holder');
    expect(text).not.toContain('\uFFFD');
    // The Title stays ASCII: "E-ticket <reference>" as a plain (non-UTF-16) literal string.
    expect(pdf.toString('latin1')).toContain('(E-ticket FL-AB12CD34)');
  });

  it('formats dates in English whatever the host locale is', () => {
    const before = Settings.defaultLocale;
    Settings.defaultLocale = 'ar-EG';
    try {
      expect(
        formatLocal(new Date('2026-12-01T08:00:00Z'), 'Africa/Cairo'),
      ).toBe('Tue 1 Dec 2026, 10:00 (UTC+02:00, Africa/Cairo)');
      expect(view().issuedAt).toBe('16 Nov 2026, 09:30 UTC');
    } finally {
      Settings.defaultLocale = before;
    }
  });
});
