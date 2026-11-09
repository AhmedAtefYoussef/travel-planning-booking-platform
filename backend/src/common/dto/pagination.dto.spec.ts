import { createValidationPipe } from '../pipes/validation.pipe';
import {
  DEFAULT_PAGE_SIZE,
  PaginationQueryDto,
  pageOffset,
  paginate,
} from './pagination.dto';

describe('pagination', () => {
  const pipe = createValidationPipe();
  const parse = (q: object): Promise<PaginationQueryDto> =>
    pipe.transform(q, { type: 'query', metatype: PaginationQueryDto });

  it('defaults to page 1 and a fixed size of 10', async () => {
    const dto = await parse({});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
    expect(DEFAULT_PAGE_SIZE).toBe(10);
  });

  it('coerces page from a query string', async () => {
    expect((await parse({ page: '3' })).page).toBe(3);
  });

  it.each([{ page: '0' }, { page: 'x' }, { page: '-1' }, { page: '1.5' }])(
    'rejects %p',
    async (q) => {
      await expect(parse(q)).rejects.toThrow();
    },
  );

  it('does not let clients change the page size', async () => {
    await expect(parse({ limit: '50' })).rejects.toThrow();
  });

  it('builds the envelope', () => {
    expect(pageOffset(3)).toBe(20);
    expect(paginate(['a'], 25, 2)).toEqual({
      items: ['a'],
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });
});
