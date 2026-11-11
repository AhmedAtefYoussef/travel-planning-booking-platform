import { IsString } from 'class-validator';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  calendarDate,
  IsWholeNumber,
  LOCAL_TIME_HH_MM,
  Omittable,
  safeInteger,
} from '.';

class EditDto {
  @Omittable()
  @IsString({ message: 'name must be text' })
  name?: string;

  @Omittable()
  @IsWholeNumber('seats must be a whole number')
  seats?: number;
}

const errorsFor = (body: object) =>
  validateSync(plainToInstance(EditDto, body)).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

describe('common/validation', () => {
  describe('Omittable', () => {
    it('allows a field that is left out', () => {
      expect(errorsFor({})).toEqual([]);
    });

    it('rejects null instead of skipping the validators', () => {
      expect(errorsFor({ name: null })).toEqual(['name must be text']);
    });
  });

  describe('IsWholeNumber', () => {
    it.each([0, -3, 42, Number.MAX_SAFE_INTEGER])('accepts %p', (seats) => {
      expect(errorsFor({ seats })).toEqual([]);
    });

    it.each([1.5, 1e20, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '3', null])(
      'rejects %p with the given message',
      (seats) => {
        expect(errorsFor({ seats })).toEqual(['seats must be a whole number']);
      },
    );
  });

  describe('safeInteger', () => {
    const rule = safeInteger('totalSeats');

    it('names the field in its message', () => {
      expect(rule.message).toBe('totalSeats must be a whole number');
    });

    it('accepts safe integers and rejects unsafe or fractional numbers', () => {
      expect(rule.validator(200)).toBe(true);
      expect(rule.validator(1e20)).toBe(false);
      expect(rule.validator(2.5)).toBe(false);
    });
  });

  describe('calendarDate', () => {
    const rule = calendarDate('date');

    it('names the field in its message', () => {
      expect(rule.message).toBe('date must be a calendar date YYYY-MM-DD');
    });

    it('accepts real dates only', () => {
      expect(rule.validator('2027-02-28')).toBe(true);
      expect(rule.validator('2028-02-29')).toBe(true);
      expect(rule.validator('2027-02-30')).toBe(false);
      expect(rule.validator('2027-2-3')).toBe(false);
      expect(rule.validator(null)).toBe(false);
    });
  });

  describe('LOCAL_TIME_HH_MM', () => {
    it('matches 00:00 to 23:59 only', () => {
      expect(
        ['00:00', '14:30', '23:59'].every((t) => LOCAL_TIME_HH_MM.test(t)),
      ).toBe(true);
      expect(
        ['24:00', '9:30', '12:60', '12:30:00'].some((t) =>
          LOCAL_TIME_HH_MM.test(t),
        ),
      ).toBe(false);
    });
  });
});
