import { sniffImageType } from './image-signature';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('sniffImageType (GEN-08)', () => {
  it('sniff detects JPEG FF D8 FF and PNG 89 50 4E 47 0D 0A 1A 0A, rejects text', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(Buffer.from('hello, I am not an image'))).toBeNull();
  });

  it('rejects empty, truncated and look-alike headers', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(PNG.subarray(0, 7))).toBeNull();
    // GIF and a PNG signature with one wrong byte.
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
    const broken = Buffer.from(PNG);
    broken[4] = 0x0a;
    expect(sniffImageType(broken)).toBeNull();
  });
});
