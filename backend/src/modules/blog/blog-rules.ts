import { VISIBLE_CONTENT_FILTER } from '../../common/contracts';
import { PostStatus } from './schemas/post.schema';

/** Characters of the body shown in post lists (BLG-09: "title, author, date and excerpt"). */
export const EXCERPT_LENGTH = 200;

/**
 * BLG-08: tags are trimmed and lowercased, and repeats are dropped keeping the first. Non-strings and
 * empty tags are kept so the DTO validators reject them with a field error instead of hiding them.
 */
export function normalizeTags(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') {
      out.push(item);
      continue;
    }
    const tag = item.trim().toLowerCase();
    if (tag !== '' && seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** The body shortened to EXCERPT_LENGTH characters, cut at a word boundary when possible. */
export function excerptOf(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text.length <= EXCERPT_LENGTH) return text;
  const cut = text.slice(0, EXCERPT_LENGTH);
  const space = cut.lastIndexOf(' ');
  return `${(space > EXCERPT_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/** Posts anyone may read: published and not hidden by an admin (BLG-02, GEN-10). */
export const PUBLIC_POST_FILTER = {
  status: PostStatus.Published,
  ...VISIBLE_CONTENT_FILTER,
} as const;
