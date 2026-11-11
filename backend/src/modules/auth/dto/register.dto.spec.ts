import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisterDto } from './register.dto';

const valid = {
  name: 'Mona Hassan',
  email: 'mona@example.com',
  password: 'Travel2026',
  acceptTerms: true,
};
const toDto = (body: object) => plainToInstance(RegisterDto, body);
const failing = (body: object) =>
  validateSync(toDto(body)).map((e) => e.property);

describe('RegisterDto (ACC-01)', () => {
  it('accepts a valid registration and normalises name and email', () => {
    expect(failing(valid)).toEqual([]);
    const dto = toDto({
      ...valid,
      name: '  Mona Hassan ',
      email: ' Mona@Example.COM ',
    });
    expect(dto.name).toBe('Mona Hassan');
    expect(dto.email).toBe('mona@example.com');
  });

  it.each([
    ['7 characters', 'Trave12'],
    ['no digit', 'onlyletters'],
    ['no letter', '1234567890'],
    ['empty', ''],
    ['not a string', 12345678],
    ['over 72 bytes', 'a1'.repeat(37)],
  ])('rejects a password with %s', (_label, password) => {
    expect(failing({ ...valid, password })).toEqual(['password']);
  });

  it('accepts exactly 8 characters with one letter and one digit', () => {
    expect(failing({ ...valid, password: 'abcdefg1' })).toEqual([]);
    expect(failing({ ...valid, password: '1234567a' })).toEqual([]);
  });

  it.each(['not-an-email', 'mona@', '@example.com', '', 42])(
    'rejects the email %p',
    (email) => {
      expect(failing({ ...valid, email })).toEqual(['email']);
    },
  );

  it.each([false, 'true', 1, null, undefined])(
    'requires the consent to be exactly true, not %p',
    (acceptTerms) => {
      expect(failing({ ...valid, acceptTerms })).toEqual(['acceptTerms']);
    },
  );

  it('rejects a blank or missing name and a name over 100 characters', () => {
    expect(failing({ ...valid, name: '   ' })).toEqual(['name']);
    expect(failing({ ...valid, name: undefined })).toEqual(['name']);
    expect(failing({ ...valid, name: 'a'.repeat(101) })).toEqual(['name']);
  });

  it('reports every broken rule at once', () => {
    expect(
      failing({ name: '', email: 'x', password: 'short', acceptTerms: false }),
    ).toEqual(['name', 'email', 'password', 'acceptTerms']);
  });
});
