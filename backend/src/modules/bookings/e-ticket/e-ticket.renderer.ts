import PDFDocument from 'pdfkit';
import {
  eTicketLines,
  type ETicketLineStyle,
  type ETicketView,
} from './e-ticket.view';

/** Built-in PDF fonts only (no font files ship with the app). */
const STYLES: Record<
  Exclude<ETicketLineStyle, 'gap'>,
  { font: string; size: number }
> = {
  title: { font: 'Helvetica-Bold', size: 20 },
  heading: { font: 'Helvetica-Bold', size: 13 },
  strong: { font: 'Helvetica-Bold', size: 11 },
  body: { font: 'Helvetica', size: 11 },
  small: { font: 'Helvetica', size: 9 },
};

/**
 * FLT-23: lays the e-ticket out as an A4 PDF. Pure: the view in, the file out (no I/O). The info
 * Title is "E-ticket <reference>" so the file is recognisable (and testable) without rendering it.
 */
export function renderETicket(view: ETicketView): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `E-ticket ${view.reference}`,
        Subject: 'Flight e-ticket',
        Creator: 'Travel Planning and Booking Platform',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const line of eTicketLines(view)) {
      if (line.style === 'gap') {
        doc.moveDown(0.6);
        continue;
      }
      const { font, size } = STYLES[line.style];
      doc.font(font).fontSize(size).text(line.text);
    }
    doc.end();
  });
}
