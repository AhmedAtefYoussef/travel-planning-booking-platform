import { readFileSync } from 'node:fs';
import { create, type Font } from 'fontkit';
import PDFDocument from 'pdfkit';
import {
  eTicketLines,
  type ETicketLineStyle,
  type ETicketView,
} from './e-ticket.view';

/**
 * DejaVu Sans (Bitstream Vera licence, published as OFL-1.1 by @fontsource), loaded from node_modules,
 * never committed. It covers Latin, Latin Extended, Greek and Cyrillic, so names such as "Łukasz Żółć"
 * print correctly; the built-in Helvetica only covers WinAnsi.
 */
const FONT_FILES = {
  regular: '@fontsource/dejavu-sans/files/dejavu-sans-latin-400-normal.woff',
  bold: '@fontsource/dejavu-sans/files/dejavu-sans-latin-700-normal.woff',
} as const;

interface LoadedFont {
  data: Buffer;
  font: Font;
}
let fonts: Record<keyof typeof FONT_FILES, LoadedFont> | undefined;

function loadFonts(): Record<keyof typeof FONT_FILES, LoadedFont> {
  if (!fonts) {
    const load = (file: string): LoadedFont => {
      const data = readFileSync(require.resolve(file));
      return { data, font: create(data) as Font };
    };
    fonts = { regular: load(FONT_FILES.regular), bold: load(FONT_FILES.bold) };
  }
  return fonts;
}

/**
 * Scripts printed left to right without shaping. Arabic, Hebrew, Indic and similar scripts need
 * shaping and bidi that pdfkit does not do, so even where the font has glyphs they would print
 * scrambled; such text is reported unprintable and the view uses a fallback.
 */
const SIMPLE_SCRIPT =
  /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]*$/u;

/** True when both ticket fonts have a glyph for every character and no shaping is needed. */
export function canPrint(text: string): boolean {
  if (!SIMPLE_SCRIPT.test(text)) return false;
  const { regular, bold } = loadFonts();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20) return false;
    if (
      !regular.font.hasGlyphForCodePoint(cp) ||
      !bold.font.hasGlyphForCodePoint(cp)
    ) {
      return false;
    }
  }
  return true;
}

const STYLES: Record<
  Exclude<ETicketLineStyle, 'gap'>,
  { font: 'regular' | 'bold'; size: number }
> = {
  title: { font: 'bold', size: 20 },
  heading: { font: 'bold', size: 13 },
  strong: { font: 'bold', size: 11 },
  body: { font: 'regular', size: 11 },
  small: { font: 'regular', size: 9 },
};

/**
 * FLT-23: lays the e-ticket out as an A4 PDF. Pure apart from reading the bundled font once: the view
 * in, the file out. Build the view with `canPrint` so unprintable names already have their fallback.
 * The info Title is the ASCII "E-ticket <reference>" (references are FL- plus [0-9A-Z]).
 */
export function renderETicket(view: ETicketView): Promise<Buffer> {
  const { regular, bold } = loadFonts();
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
    doc.registerFont('regular', regular.data);
    doc.registerFont('bold', bold.data);
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
