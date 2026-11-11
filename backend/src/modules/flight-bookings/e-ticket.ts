import PDFDocument from 'pdfkit';
import { formatMinor } from '../../common/utils/money';
import { utcToLocalIso } from '../../common/utils/dates';
import type { FlightBookingDocument } from './schemas/flight-booking.schema';

/** "2026-12-01T09:00:00.000+02:00" -> "2026-12-01 09:00 (UTC+02:00)" */
function readableLocal(instant: Date, zone: string): string {
  const iso = utcToLocalIso(instant, zone);
  const offset = iso.slice(23) || 'Z';
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} (UTC${offset === 'Z' ? '' : offset})`;
}

const typeLabel: Record<string, string> = {
  ADULT: 'Adult',
  CHILD: 'Child',
  INFANT: 'Infant (no seat)',
};

/**
 * FLT-23 e-ticket: one PDF with the booking reference, every flight in each airport's local time
 * (GEN-06), the cabin and baggage allowance, every passenger and the amount paid. Generated on
 * request from the confirmed booking; nothing is stored.
 */
export function renderETicket(booking: FlightBookingDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `E-ticket ${booking.reference ?? ''}`,
        Author: 'Travel Planning & Booking Platform',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('Electronic ticket', { align: 'left' });
    doc.moveDown(0.3);
    doc
      .fontSize(12)
      .text(`Booking reference: ${booking.reference ?? '-'}`)
      .text(`Status: ${booking.status}`)
      .text(
        `Issued: ${(booking.confirmedAt ?? new Date()).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      );

    doc.moveDown();
    doc.fontSize(14).text('Flights');
    booking.segments.forEach((s, i) => {
      doc.moveDown(0.4);
      doc
        .fontSize(12)
        .text(
          `${booking.segments.length === 2 ? (i === 0 ? 'Outbound' : 'Return') + ': ' : ''}${s.airlineName} ${s.flightNumber} - ${s.cabinClass.replace('_', ' ')}`,
        )
        .fontSize(10)
        .text(
          `Departs ${s.from}: ${readableLocal(s.departureUtc, s.fromTimeZone)}`,
        )
        .text(`Arrives ${s.to}: ${readableLocal(s.arrivalUtc, s.toTimeZone)}`)
        .text(
          `Baggage: ${s.freeBags} free checked bag(s) per passenger, up to ${s.maxKgPerBag} kg each`,
        );
    });

    doc.moveDown();
    doc.fontSize(14).text('Passengers');
    booking.passengers.forEach((p, i) => {
      const types = [...new Set(p.types.map((t) => typeLabel[t] ?? t))].join(
        ' / ',
      );
      doc
        .fontSize(10)
        .text(
          `${i + 1}. ${p.fullName} - ${types} - document ${p.documentNumber}${p.extraBags ? ` - ${p.extraBags} extra bag(s) per flight` : ''}`,
        );
    });

    doc.moveDown();
    doc
      .fontSize(12)
      .text(
        `Total paid: ${formatMinor(booking.totalMinor, booking.currency)} ${booking.currency}`,
      );
    doc.moveDown(2);
    doc
      .fontSize(8)
      .fillColor('#555555')
      .text(
        'Times are local to each airport. Present this e-ticket and the travel document listed above at check-in.',
      );
    doc.end();
  });
}
