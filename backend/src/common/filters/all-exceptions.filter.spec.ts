import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/api/x?y=1' }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return {
    code: (status.mock.calls as number[][])[0][0],
    body: (json.mock.calls as Record<string, unknown>[][])[0][0],
  };
}

describe('AllExceptionsFilter', () => {
  it('shapes HttpExceptions', () => {
    const { code, body } = run(new NotFoundException('Booking not found'));
    expect(code).toBe(404);
    expect(body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'Booking not found',
      path: '/api/x?y=1',
    });
    expect(typeof body.timestamp).toBe('string');
    expect(body.fieldErrors).toBeUndefined();
  });

  it('keeps 403 status', () => {
    const { code, body } = run(new ForbiddenException('nope'));
    expect(code).toBe(403);
    expect(body.error).toBe('Forbidden');
  });

  it('passes fieldErrors with dotted paths through', () => {
    const fieldErrors = [{ field: 'address.city', message: 'too short' }];
    const { code, body } = run(
      new BadRequestException({ message: 'Validation failed', fieldErrors }),
    );
    expect(code).toBe(400);
    expect(body.message).toBe('Validation failed');
    expect(body.fieldErrors).toEqual(fieldErrors);
  });

  it('maps a Mongo duplicate key error to 409', () => {
    const err = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyValue: { email: 'a@b.co' },
    });
    const { code, body } = run(err);
    expect(code).toBe(409);
    expect(body.error).toBe('Conflict');
    expect(body.message).toContain('email');
    expect(body.message).not.toContain('a@b.co');
  });

  it('maps an invalid ObjectId CastError to 400', () => {
    const err = new MongooseError.CastError('ObjectId', 'bad', '_id');
    const { code, body } = run(err);
    expect(code).toBe(400);
    expect(body.error).toBe('Bad Request');
  });

  it('maps a Mongoose ValidationError to 400 with fieldErrors', () => {
    const err = new MongooseError.ValidationError();
    err.addError(
      'name',
      new MongooseError.ValidatorError({
        message: 'Name is required',
        path: 'name',
        type: 'required',
      }),
    );
    const { code, body } = run(err);
    expect(code).toBe(400);
    expect(body.fieldErrors).toEqual([
      { field: 'name', message: 'Name is required' },
    ]);
  });

  it('hides internals of unknown errors as 500', () => {
    const { code, body } = run(new Error('db password is hunter2'));
    expect(code).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
