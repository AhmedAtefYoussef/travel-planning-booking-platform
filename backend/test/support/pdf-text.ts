import { inflateSync } from 'node:zlib';

/**
 * The text drawn in a PDF made by pdfkit (FLT-23 tests), one line per TJ operator. Embedded fonts are
 * decoded through their ToUnicode CMap (what a PDF viewer's copy/search uses); the built-in fonts as
 * WinAnsi bytes. Only what pdfkit writes is supported.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const objects = new Map<number, { dict: string; stream: string | null }>();
  const objRe = /(\d+) 0 obj\s*([\s\S]*?)endobj/g;
  for (let m = objRe.exec(raw); m; m = objRe.exec(raw)) {
    const body = m[2];
    const s = /^([\s\S]*?)stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body);
    let stream: string | null = null;
    if (s) {
      try {
        stream = inflateSync(Buffer.from(s[2], 'latin1')).toString('latin1');
      } catch {
        stream = s[2];
      }
    }
    objects.set(Number(m[1]), { dict: s ? s[1] : body, stream });
  }

  // Font object number -> code (hex) -> text, from its ToUnicode CMap.
  const cmaps = new Map<number, Map<string, string>>();
  for (const [num, o] of objects) {
    const ref = /\/ToUnicode (\d+) 0 R/.exec(o.dict);
    const cmap = ref ? objects.get(Number(ref[1]))?.stream : null;
    if (cmap) cmaps.set(num, parseCmap(cmap));
  }
  // Resource name (e.g. F1) -> font object number.
  const names = new Map<string, number>();
  for (const o of objects.values()) {
    const fontDict = /\/Font\s*<<([\s\S]*?)>>/.exec(o.dict);
    if (!fontDict) continue;
    for (const f of fontDict[1].matchAll(/\/(\S+?) (\d+) 0 R/g)) {
      names.set(f[1], Number(f[2]));
    }
  }

  const lines: string[] = [];
  for (const o of objects.values()) {
    if (!o.stream || !/TJ/.test(o.stream)) continue;
    let cmap: Map<string, string> | undefined;
    const ops = /\/(\S+) [\d.]+ Tf|\[([^\]]*)\]\s*TJ/g;
    for (let m = ops.exec(o.stream); m; m = ops.exec(o.stream)) {
      if (m[1] !== undefined) {
        const num = names.get(m[1]);
        cmap = num === undefined ? undefined : cmaps.get(num);
        continue;
      }
      const hex = [...m[2].matchAll(/<([0-9a-fA-F]*)>/g)]
        .map((h) => h[1])
        .join('');
      if (cmap) {
        let text = '';
        for (let i = 0; i < hex.length; i += 4) {
          text += cmap.get(hex.slice(i, i + 4).toLowerCase()) ?? '�';
        }
        lines.push(text);
      } else {
        lines.push(Buffer.from(hex, 'hex').toString('latin1'));
      }
    }
  }
  return lines.join('\n');
}

/** A CMap target: UTF-16BE hex, possibly several code units separated by spaces (e.g. a ligature). */
function utf16(hex: string): string {
  return Buffer.from(hex.replace(/\s+/g, ''), 'hex')
    .swap16()
    .toString('utf16le');
}

/** Hex strings of a CMap target list. A ligature such as "ff" maps to `<0066 0066>`, with a space. */
const CMAP_TARGET = /<([0-9a-fA-F\s]*)>/g;

function parseCmap(cmap: string): Map<string, string> {
  const map = new Map<string, string>();
  const width = 4;
  const key = (n: number) => n.toString(16).padStart(width, '0');
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const entry =
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:\[([^\]]*)\]|<([0-9a-fA-F]+)>)/g;
    for (let e = entry.exec(block[1]); e; e = entry.exec(block[1])) {
      const lo = parseInt(e[1], 16);
      const hi = parseInt(e[2], 16);
      if (e[3] !== undefined) {
        const targets = [...e[3].matchAll(CMAP_TARGET)].map((t) => t[1]);
        targets.forEach((t, i) => map.set(key(lo + i), utf16(t)));
      } else {
        const start = parseInt(e[4], 16);
        for (let c = lo; c <= hi; c++) {
          map.set(key(c), String.fromCharCode(start + c - lo));
        }
      }
    }
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const e of block[1].matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F][0-9a-fA-F\s]*)>/g,
    )) {
      map.set(e[1].toLowerCase().padStart(width, '0'), utf16(e[2]));
    }
  }
  return map;
}
