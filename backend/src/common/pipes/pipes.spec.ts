import { ValidationError } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  AppException,
  ValidationFailedException,
} from '../errors/app.exception';
import {
  PAGE_SIZE,
  paginate,
  PaginationQueryDto,
  skipFor,
  toPage,
} from '../pagination/pagination';
import { ParseObjectIdPipe } from './parse-object-id.pipe';
import {
  createValidationPipe,
  flattenValidationErrors,
} from './validation.pipe';

const err = (
  property: string,
  constraints?: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError => ({
  property,
  constraints,
  children,
});

describe('flattenValidationErrors (GEN-02)', () => {
  it('builds dotted and indexed paths', () => {
    const errors = [
      err('email', { isEmail: 'email must be an email' }),
      err('passengers', undefined, [
        err('0', undefined, [err('dob', { isIso8601: 'dob must be a date' })]),
      ]),
      err('address', undefined, [
        err('city', {
          isString: 'city must be a string',
          isNotEmpty: 'city should not be empty',
        }),
      ]),
    ];
    expect(flattenValidationErrors(errors)).toEqual([
      { field: 'email', message: 'email must be an email' },
      { field: 'passengers[0].dob', message: 'dob must be a date' },
      { field: 'address.city', message: 'city must be a string' },
      { field: 'address.city', message: 'city should not be empty' },
    ]);
  });

  it('is wired into the global pipe', async () => {
    const pipe = createValidationPipe();
    await expect(
      pipe.transform(
        { page: 'x' },
        { type: 'query', metatype: PaginationQueryDto },
      ),
    ).rejects.toBeInstanceOf(ValidationFailedException);
  });
});

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();
  it('accepts canonical ObjectIds', () => {
    expect(
      pipe.transform('0123456789abcdef01234567', { type: 'param', data: 'id' }),
    ).toBe('0123456789abcdef01234567');
  });
  it.each(['xyz', '123456789012', '0123456789abcdef0123456g', 42, undefined])(
    'rejects %p',
    (value) => {
      expect(() =>
        pipe.transform(value, { type: 'param', data: 'hotelId' }),
      ).toThrow(AppException);
    },
  );
});

describe('pagination (GEN-05)', () => {
  it.each(['0', '1.5', 'abc', '100001', '-3', '0x10'])(
    'reports exactly one accurate message for page=%s',
    (page) => {
      const errors = validateSync(
        plainToInstance(PaginationQueryDto, { page }),
      );
      expect(errors).toHaveLength(1);
      expect(Object.values(errors[0].constraints ?? {})).toEqual([
        'page must be a whole number between 1 and 100000',
      ]);
    },
  );

  const validate = (query: Record<string, unknown>) => {
    const dto = plainToInstance(PaginationQueryDto, query);
    return { dto, errors: validateSync(dto) };
  };

  it('defaults to page 1 and parses numeric strings', () => {
    expect(validate({}).dto.page).toBe(1);
    expect(validate({ page: '' }).dto.page).toBe(1);
    expect(validate({ page: '3' }).dto.page).toBe(3);
    expect(validate({ page: '3' }).errors).toHaveLength(0);
  });

  it.each(['0', '-2', '1.5', 'abc', '100001', '0x10', '1e1', ' 2'])(
    'rejects page=%s',
    (page) => {
      expect(validate({ page }).errors.length).toBeGreaterThan(0);
    },
  );

  it('computes skip and the envelope with a fixed page size of 10', () => {
    expect(PAGE_SIZE).toBe(10);
    expect(skipFor(1)).toBe(0);
    expect(skipFor(3)).toBe(20);
    expect(skipFor(0)).toBe(0);
    expect(toPage(['a'], 21, 3)).toEqual({
      items: ['a'],
      page: 3,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
    expect(toPage([], 0, 1)).toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });
});

describe('paginate()', () => {
  it('queries one page with a stable sort and counts in parallel', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ name: 'a' }]),
    };
    const model = {
      find: jest.fn(() => chain),
      countDocuments: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(11),
      })),
    };
    const page = await paginate(model as never, { status: 'PUBLISHED' }, 2, {
      sort: { createdAt: -1 },
    });
    expect(model.find).toHaveBeenCalledWith({ status: 'PUBLISHED' }, undefined);
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(chain.skip).toHaveBeenCalledWith(10);
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(page).toEqual({
      items: [{ name: 'a' }],
      page: 2,
      limit: 10,
      total: 11,
      totalPages: 2,
    });

    await paginate(model as never, {}, 1);
    expect(chain.sort).toHaveBeenLastCalledWith({ _id: 1 });
  });
});
