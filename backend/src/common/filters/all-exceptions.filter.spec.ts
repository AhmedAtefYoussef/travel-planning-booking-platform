import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import {
  AppException,
  ValidationFailedException,
} from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        originalUrl: '/api/x',
        url: '/api/x',
      }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return {
    status: (status.mock.calls[0] as unknown[])[0],
    body: (json.mock.calls[0] as unknown[])[0] as Record<string, unknown>,
  };
}

describe('AllExceptionsFilter (GEN-02)', () => {
  beforeAll(() =>
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  );

  it('keeps AppException code and fieldErrors', () => {
    const { status, body } = run(
      new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INSUFFICIENT_INVENTORY,
        'Only 2 seats left',
      ),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      code: 'INSUFFICIENT_INVENTORY',
      message: 'Only 2 seats left',
      path: '/api/x',
    });
    expect(body).not.toHaveProperty('fieldErrors');
  });

  it('returns fieldErrors for validation failures', () => {
    const { body } = run(
      new ValidationFailedException([
        { field: 'email', message: 'email must be an email' },
      ]),
    );
    expect(body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'email', message: 'email must be an email' }],
    });
  });

  it('maps standard HttpExceptions to default codes and messages', () => {
    expect(run(new ForbiddenException('Not your booking')).body).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not your booking',
    });
    expect(run(new ConflictException()).body).toMatchObject({
      code: 'CONFLICT',
      message: 'Conflict',
    });
    expect(
      run(new BadRequestException(['a is bad', 'b is bad'])).body,
    ).toMatchObject({ code: 'BAD_REQUEST', message: 'a is bad; b is bad' });
  });

  it('never leaks 5xx messages', () => {
    const { body } = run(
      new InternalServerErrorException('db password is hunter2'),
    );
    expect(body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  it('maps duplicate keys to 409 with fields', () => {
    const { status, body } = run({
      code: 11000,
      keyValue: { email: 'a@b.co' },
    });
    expect(status).toBe(409);
    expect(body).toMatchObject({
      code: 'DUPLICATE_KEY',
      fieldErrors: [{ field: 'email', message: 'email already exists' }],
    });
    expect(run({ code: 11000 }).body).toMatchObject({
      code: 'DUPLICATE_KEY',
      message: 'A record with these values already exists',
    });
  });

  it('maps Mongoose cast and validation errors to 400', () => {
    const cast = new MongooseError.CastError('ObjectId', 'xyz', 'hotelId');
    expect(run(cast).body).toMatchObject({
      statusCode: 400,
      code: 'INVALID_ID',
      fieldErrors: [{ field: 'hotelId', message: 'hotelId is invalid' }],
    });
    expect(
      run(new MongooseError.CastError('Number', 'abc', 'price')).body,
    ).toMatchObject({ code: 'BAD_REQUEST' });

    const validation = new MongooseError.ValidationError();
    validation.addError(
      'price',
      new MongooseError.ValidatorError({
        message: 'price is required',
        path: 'price',
      }),
    );
    expect(run(validation).body).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'price', message: 'price is required' }],
    });
  });

  it('maps body-parser errors', () => {
    expect(
      run({ status: 400, type: 'entity.parse.failed' }).body,
    ).toMatchObject({
      statusCode: 400,
      message: 'Malformed JSON request body',
    });
    expect(run({ status: 413, type: 'entity.too.large' }).body).toMatchObject({
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(run({ status: 400 }).body).toMatchObject({ message: 'Bad request' });
  });

  it('turns anything else into a generic 500', () => {
    for (const thrown of [new Error('boom'), 'string', null, { status: 503 }]) {
      expect(run(thrown).body).toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });
});
