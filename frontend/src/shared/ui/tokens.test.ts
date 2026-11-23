// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
  'utf8',
);

type Rgb = [number, number, number];

/** Extracts `--name: oklch(L C H)` declarations (no alpha) from the block starting at `selector`. */
function readBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1)
    throw new Error(`Block ${selector} not found in globals.css`);
  const end = css.indexOf('}', start);
  const block = css.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+):\s*oklch\(([^)]*)\)\s*;/g)) {
    const value = match[2] ?? '';
    if (!value.includes('/')) tokens[match[1] ?? ''] = value;
  }
  return tokens;
}

/** OKLCH -> OKLab -> linear sRGB (Bjorn Ottosson's matrices), clamped to the sRGB gamut. */
function oklchToLinearRgb(value: string): Rgb {
  const [L = 0, C = 0, H = 0] = value.trim().split(/\s+/).map(Number);
  const hue = (H * Math.PI) / 180;
  const a = C * Math.cos(hue);
  const b = C * Math.sin(hue);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const rgb: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.map((c) => Math.min(1, Math.max(0, c))) as Rgb;
}

/** WCAG relative luminance (the channels are already linear). */
function luminance(value: string): number {
  const [r, g, b] = oklchToLinearRgb(value);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [hi, lo] = [luminance(foreground), luminance(background)].sort(
    (x, y) => y - x,
  );
  return (hi! + 0.05) / (lo! + 0.05);
}

const PAIRS: [string, string][] = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['destructive', 'background'],
  ['success', 'background'],
  ['warning', 'background'],
  ['info', 'background'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['info-foreground', 'info'],
];

describe('colour maths', () => {
  it('gives 21:1 for black on white and 1:1 for identical colours', () => {
    expect(contrast('0 0 0', '1 0 0')).toBeCloseTo(21, 1);
    expect(contrast('0.5 0.1 200', '0.5 0.1 200')).toBeCloseTo(1, 5);
  });
});

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
])('%s theme contrast (WCAG AA 4.5:1)', (_theme, selector) => {
  const tokens = readBlock(selector);

  it.each(PAIRS)('%s on %s', (fg, bg) => {
    const fgValue = tokens[fg];
    const bgValue = tokens[bg];
    expect(fgValue, `--${fg} is defined`).toBeDefined();
    expect(bgValue, `--${bg} is defined`).toBeDefined();
    expect(contrast(fgValue!, bgValue!)).toBeGreaterThanOrEqual(4.5);
  });
});
