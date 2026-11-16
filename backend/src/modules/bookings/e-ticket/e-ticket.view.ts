import { DateTime } from 'luxon';
import type {
  Airport,
  AirlinePolicySnapshot,
  PolicySnapshot,
} from '../../../common/contracts';
import { isValidTimeZone } from '../../../common/utils/dates';
import { formatMinor } from '../../../common/utils/money';

/**
 * FLT-23 e-ticket view model: everything the PDF shows, already formatted, so the renderer only lays
 * text out. Built from the booking snapshot plus reference data (airport names and IANA zones, GEN-06).
 */
export interface ETicketStop {
  iataCode: string;
  airportName: string;
  /** Wall time at this airport, e.g. "Tue 1 Dec 2026, 10:00 (UTC+02:00, Africa/Cairo)" (GEN-06). */
  localTime: string;
}

export interface ETicketSegment {
  airline: string;
  flightNumber: string;
  cabinClass: string;
  departure: ETicketStop;
  arrival: ETicketStop;
}

export interface ETicketPassenger {
  name: string;
  type: string;
  /** Passport or ID number masked to its last 4 characters. */
  document: string;
  freeBags: number;
  extraBags: number;
  extraBagsWeightKg: number | null;
}

export interface ETicketView {
  reference: string;
  booker: string;
  issuedAt: string;
  segments: ETicketSegment[];
  passengers: ETicketPassenger[];
  /** e.g. "1200.00 EGP" */
  totalPaid: string;
  policyNotes: string[];
}

/** The booking fields the e-ticket reads (a structural subset of FlightBooking). */
export interface ETicketBooking {
  reference: string;
  totalMinor: number;
  currency: string;
  confirmedAt: Date | null;
  policySnapshot: PolicySnapshot | null;
  segments: {
    flightNumber: string;
    cabinClass: string;
    from: string;
    to: string;
    departureUtc: Date;
    arrivalUtc: Date;
  }[];
  passengers: {
    type: string;
    firstName: string;
    lastName: string;
    documentNumber: string;
    extraBags: number;
    extraBagsWeightKg?: number | null;
  }[];
}

export interface ETicketInput {
  booking: ETicketBooking;
  booker: string;
  /** Reference data by IATA code; a missing airport falls back to its code and UTC. */
  airports: ReadonlyMap<string, Airport>;
  /** Airline terms per segment (same order), from the accepted snapshot or the live airline. */
  airlines: readonly (AirlinePolicySnapshot | null)[];
  now: Date;
}

const MASK = '****';

/** "A1234567" -> "****4567": the length is hidden too (documents are 5 to 30 characters). */
export function maskDocument(documentNumber: string): string {
  return `${MASK}${documentNumber.slice(-4)}`;
}

/**
 * GEN-06: an instant as wall time in an IANA zone, with the offset and zone named so it is never
 * mistaken for the reader's own time. An unknown zone falls back to UTC (labelled as such).
 */
export function formatLocal(instant: Date, zone: string): string {
  const z = isValidTimeZone(zone) ? zone : 'UTC';
  const dt = DateTime.fromJSDate(instant, { zone: z });
  return `${dt.toFormat("ccc d LLL yyyy, HH:mm '(UTC'ZZ")}, ${z})`;
}

function stop(
  iataCode: string,
  instant: Date,
  airports: ReadonlyMap<string, Airport>,
): ETicketStop {
  const airport = airports.get(iataCode);
  return {
    iataCode,
    airportName: airport?.name ?? iataCode,
    localTime: formatLocal(instant, airport?.timeZone ?? 'UTC'),
  };
}

function tiersNote(airline: AirlinePolicySnapshot): string {
  const tiers = [...airline.cancellationTiers].sort(
    (a, b) => b.daysBefore - a.daysBefore,
  );
  const rules = tiers.length
    ? tiers
        .map(
          (t) =>
            `${t.refundPercent}% refund if cancelled at least ${t.daysBefore} day(s) before departure`,
        )
        .join('; ')
    : 'no refund on cancellation';
  return `${airline.airlineName} (${airline.flightNumber}): ${rules}.`;
}

/** Builds the e-ticket view (pure: no I/O, `now` given). */
export function toETicketView(input: ETicketInput): ETicketView {
  const { booking, airports, airlines } = input;
  const segments = booking.segments.map((s, i) => ({
    airline:
      airlines[i]?.airlineName ?? `Airline ${s.flightNumber.slice(0, 2)}`,
    flightNumber: s.flightNumber,
    cabinClass: s.cabinClass,
    departure: stop(s.from, s.departureUtc, airports),
    arrival: stop(s.to, s.arrivalUtc, airports),
  }));
  // FLT-04: free bags are the same for every passenger of a cabin; take the first leg's allowance.
  const freeBags = airlines[0]?.freeBags ?? 0;
  const known = airlines.filter((a): a is AirlinePolicySnapshot => !!a);
  const policyNotes = [
    ...known.map(tiersNote),
    ...(booking.policySnapshot
      ? [
          `Terms version ${booking.policySnapshot.version} were accepted before payment (PAY-02).`,
        ]
      : []),
    'Times are local to each airport. Bring the passport or ID whose number ends as shown.',
  ];
  return {
    reference: booking.reference,
    booker: input.booker,
    issuedAt: DateTime.fromJSDate(booking.confirmedAt ?? input.now, {
      zone: 'utc',
    }).toFormat("d LLL yyyy, HH:mm 'UTC'"),
    segments,
    passengers: booking.passengers.map((p) => ({
      name: `${p.firstName} ${p.lastName}`,
      type: p.type,
      document: maskDocument(p.documentNumber),
      freeBags,
      extraBags: p.extraBags ?? 0,
      extraBagsWeightKg: p.extraBagsWeightKg ?? null,
    })),
    totalPaid: `${formatMinor(booking.totalMinor, booking.currency)} ${booking.currency}`,
    policyNotes,
  };
}

export type ETicketLineStyle =
  'title' | 'heading' | 'strong' | 'body' | 'small' | 'gap';

export interface ETicketLine {
  text: string;
  style: ETicketLineStyle;
}

/** The ticket as styled text lines, in print order: the renderer lays them out, tests read them. */
export function eTicketLines(view: ETicketView): ETicketLine[] {
  const gap: ETicketLine = { text: '', style: 'gap' };
  const body = (text: string): ETicketLine => ({ text, style: 'body' });
  const lines: ETicketLine[] = [
    { text: `E-ticket ${view.reference}`, style: 'title' },
    body(`Booking reference: ${view.reference}`),
    body(`Booked by: ${view.booker}`),
    body(`Issued: ${view.issuedAt}`),
    gap,
    { text: 'Flights', style: 'heading' },
  ];
  view.segments.forEach((s, i) => {
    lines.push(
      {
        text: `${i + 1}. ${s.airline} ${s.flightNumber} - ${s.cabinClass}`,
        style: 'strong',
      },
      body(
        `   Depart ${s.departure.airportName} (${s.departure.iataCode}): ${s.departure.localTime}`,
      ),
      body(
        `   Arrive ${s.arrival.airportName} (${s.arrival.iataCode}): ${s.arrival.localTime}`,
      ),
    );
  });
  lines.push(gap, { text: 'Passengers', style: 'heading' });
  view.passengers.forEach((p, i) => {
    const extra = p.extraBags
      ? `, ${p.extraBags} extra bag(s)${p.extraBagsWeightKg ? ` (${p.extraBagsWeightKg} kg)` : ''}`
      : ', no extra bags';
    lines.push(
      body(
        `${i + 1}. ${p.name} (${p.type}) - document ${p.document} - ${p.freeBags} free bag(s)${extra}`,
      ),
    );
  });
  lines.push(
    gap,
    { text: `Total paid: ${view.totalPaid}`, style: 'strong' },
    gap,
    { text: 'Policies', style: 'heading' },
    ...view.policyNotes.map((text): ETicketLine => ({ text, style: 'small' })),
  );
  return lines;
}
