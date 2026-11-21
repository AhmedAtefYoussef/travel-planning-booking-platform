import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

const toDto = (body: object) => plainToInstance(UpdateProfileDto, body);
const failing = (body: object) =>
  validateSync(toDto(body)).map((e) => e.property);

describe('UpdateProfileDto (ACC-09)', () => {
  it('lets every field be left out', () => {
    expect(failing({})).toEqual([]);
    expect(failing({ name: 'Mona' })).toEqual([]);
  });

  it('normalises name, phone and currency', () => {
    const dto = toDto({
      name: '  Mona H. ',
      phone: '+20 (100) 123-4567',
      preferredCurrency: ' eur ',
    });
    expect(dto).toEqual({
      name: 'Mona H.',
      phone: '+201001234567',
      preferredCurrency: 'EUR',
    });
    expect(failing(dto)).toEqual([]);
  });

  it('rejects null for every field (GEN-13)', () => {
    expect(
      failing({ name: null, phone: null, preferredCurrency: null }).sort(),
    ).toEqual(['name', 'phone', 'preferredCurrency']);
  });

  it.each(['', '   ', 'a'.repeat(101), 42])('rejects the name %p', (name) => {
    expect(failing({ name })).toEqual(['name']);
  });

  it.each([
    '01001234567',
    '+0123456789',
    '+20',
    '+20abc1234567',
    '+1234567890123456',
  ])('rejects the phone %p', (phone) => {
    expect(failing({ phone })).toEqual(['phone']);
  });

  it.each(['+201001234567', '+4420712345', '+12025550123'])(
    'accepts the phone %p',
    (phone) => {
      expect(failing({ phone })).toEqual([]);
    },
  );

  it.each(['EU', 'EURO', '123', ''])(
    'rejects the currency %p',
    (preferredCurrency) => {
      expect(failing({ preferredCurrency })).toEqual(['preferredCurrency']);
    },
  );
});
