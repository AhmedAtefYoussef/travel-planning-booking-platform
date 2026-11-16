import { inflateSync } from 'node:zlib';

/**
 * The text drawn in a PDF made by pdfkit with the built-in fonts (FLT-23 tests): inflates each
 * FlateDecode stream and decodes every TJ array's hex strings (WinAnsi), one line per TJ.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const lines: string[] = [];
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = streams.exec(raw); m; m = streams.exec(raw)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      content = m[1];
    }
    const arrays = /\[([^\]]*)\]\s*TJ/g;
    for (let a = arrays.exec(content); a; a = arrays.exec(content)) {
      const hex = [...a[1].matchAll(/<([0-9a-fA-F]*)>/g)]
        .map((h) => h[1])
        .join('');
      lines.push(Buffer.from(hex, 'hex').toString('latin1'));
    }
  }
  return lines.join('\n');
}
