import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MAX_COMMENT_LENGTH } from '../schemas/comment.schema';
import { CommentBodyDto } from './comment.dto';

const TEXT = 'body must be text';
const LENGTH = `body must be 1-${MAX_COMMENT_LENGTH} characters`;

/** Every message the validators report for body. */
const bodyErrors = (input: object) =>
  validateSync(plainToInstance(CommentBodyDto, input))
    .filter((e) => e.property === 'body')
    .flatMap((e) => Object.values(e.constraints ?? {}));

/** BLG-05 (GEN-02): one clear message per invalid comment body, never two. */
describe('CommentBodyDto (BLG-05)', () => {
  it.each([
    ['missing', {}, TEXT],
    ['null', { body: null }, TEXT],
    ['a number', { body: 5 }, TEXT],
    ['an array', { body: ['hi'] }, TEXT],
    ['empty', { body: '' }, LENGTH],
    ['blank after trimming', { body: '   ' }, LENGTH],
    [
      `${MAX_COMMENT_LENGTH + 1} characters`,
      { body: 'x'.repeat(MAX_COMMENT_LENGTH + 1) },
      LENGTH,
    ],
  ])('%s gives exactly one message', (_, input, message) => {
    expect(bodyErrors(input)).toEqual([message]);
  });

  it.each([
    ['one character', 'x'],
    [`${MAX_COMMENT_LENGTH} characters`, 'x'.repeat(MAX_COMMENT_LENGTH)],
    ['padded text (trimmed)', '  Great tips!  '],
  ])('accepts %s', (_, body) => {
    expect(bodyErrors({ body })).toEqual([]);
  });
});
