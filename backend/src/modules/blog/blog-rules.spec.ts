import { EXCERPT_LENGTH, excerptOf, normalizeTags } from './blog-rules';

describe('blog rules', () => {
  describe('normalizeTags (BLG-08)', () => {
    it('trims, lowercases and drops repeats keeping the first', () => {
      expect(normalizeTags([' Egypt', 'egypt ', 'NILE', 'nile'])).toEqual([
        'egypt',
        'nile',
      ]);
    });

    it('keeps empty and non-string entries so the validators reject them', () => {
      expect(normalizeTags(['', '  ', 3])).toEqual(['', '', 3]);
    });

    it('leaves a non-array untouched', () => {
      expect(normalizeTags('egypt')).toBe('egypt');
    });
  });

  describe('excerptOf (BLG-09)', () => {
    it('returns a short body unchanged, with whitespace collapsed', () => {
      expect(excerptOf('  Hello\n\nworld  ')).toBe('Hello world');
    });

    it('cuts a long body at a word boundary and adds an ellipsis', () => {
      const body = 'word '.repeat(100);
      const excerpt = excerptOf(body);
      expect(excerpt.endsWith('word...')).toBe(true);
      expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_LENGTH + 3);
    });

    it('cuts a long word-less body at the limit', () => {
      expect(excerptOf('x'.repeat(500))).toBe(
        `${'x'.repeat(EXCERPT_LENGTH)}...`,
      );
    });
  });
});
