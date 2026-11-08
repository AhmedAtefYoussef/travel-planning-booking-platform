import { ValidationError, ValidationPipe } from '@nestjs/common';
import { FieldError, ValidationFailedException } from '../errors/app.exception';

/**
 * Flattens class-validator's nested errors into dotted field paths:
 *   passengers[0].dob, rooms[1].adults, address.city
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): FieldError[] {
  const out: FieldError[] = [];
  for (const error of errors) {
    const segment = /^\d+$/.test(error.property)
      ? `[${error.property}]`
      : error.property;
    const path = !parent
      ? segment
      : segment.startsWith('[')
        ? `${parent}${segment}`
        : `${parent}.${segment}`;
    for (const message of Object.values(error.constraints ?? {})) {
      out.push({ field: path, message });
    }
    if (error.children?.length)
      out.push(...flattenValidationErrors(error.children, path));
  }
  return out;
}

/**
 * The single global ValidationPipe (GEN-13): unknown properties are rejected (not silently dropped),
 * payloads are transformed into DTO instances, and failures become 400 + fieldErrors (GEN-02).
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
    stopAtFirstError: false,
    exceptionFactory: (errors) =>
      new ValidationFailedException(flattenValidationErrors(errors)),
  });
}
