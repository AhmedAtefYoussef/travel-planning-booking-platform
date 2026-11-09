import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEmail, IsString, MinLength, ValidateNested } from 'class-validator';
import { createValidationPipe } from './validation.pipe';

class AddressDto {
  @IsString()
  @MinLength(2)
  city!: string;
}

class SignupDto {
  @IsEmail()
  email!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

async function run(value: unknown): Promise<BadRequestException> {
  const pipe = createValidationPipe();
  try {
    await pipe.transform(value, { type: 'body', metatype: SignupDto });
  } catch (e) {
    return e as BadRequestException;
  }
  throw new Error('expected rejection');
}

describe('createValidationPipe', () => {
  it('reports dotted-path fieldErrors for nested properties', async () => {
    const err = await run({ email: 'nope', address: { city: 'x' } });
    expect(err).toBeInstanceOf(BadRequestException);
    const body = err.getResponse() as {
      fieldErrors: { field: string; message: string }[];
    };
    const fields = body.fieldErrors.map((f) => f.field).sort();
    expect(fields).toEqual(['address.city', 'email']);
    expect(body.fieldErrors.every((f) => f.message.length > 0)).toBe(true);
  });

  it('rejects unknown properties (forbidNonWhitelisted)', async () => {
    const err = await run({
      email: 'a@b.co',
      address: { city: 'Cairo' },
      admin: true,
    });
    const body = err.getResponse() as { fieldErrors: { field: string }[] };
    expect(body.fieldErrors.map((f) => f.field)).toContain('admin');
  });

  it('transforms valid input into the DTO class', async () => {
    const pipe = createValidationPipe();
    const out: unknown = await pipe.transform(
      { email: 'a@b.co', address: { city: 'Cairo' } },
      { type: 'body', metatype: SignupDto },
    );
    expect(out).toBeInstanceOf(SignupDto);
  });
});
