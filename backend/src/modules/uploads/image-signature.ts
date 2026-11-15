/** The image types GEN-08 accepts, as detected from the file's first bytes. */
export type SniffedImageType = 'image/jpeg' | 'image/png';

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (buf: Buffer, signature: number[]) =>
  buf.length >= signature.length && signature.every((b, i) => buf[i] === b);

/**
 * GEN-08: the real type of an upload, from its magic bytes (JPEG FF D8 FF, PNG 89 50 4E 47 0D 0A 1A 0A),
 * or null for anything else. The extension and the declared Content-Type are chosen by the client, so
 * they are never trusted on their own.
 */
export function sniffImageType(buf: Buffer): SniffedImageType | null {
  if (startsWith(buf, PNG)) return 'image/png';
  if (startsWith(buf, JPEG)) return 'image/jpeg';
  return null;
}
