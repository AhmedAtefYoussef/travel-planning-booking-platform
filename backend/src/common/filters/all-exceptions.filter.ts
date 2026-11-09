import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import type { FieldError } from '../pipes/validation.pipe';

interface Shaped {
  status: number;
  message: string | string[];
  fieldErrors?: FieldError[];
}

const REASONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

function isDuplicateKey(e: unknown): e is { keyValue?: object } {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 11000
  );
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const shaped = this.shape(exception);

    const body: Record<string, unknown> = {
      statusCode: shaped.status,
      error: REASONS[shaped.status] ?? 'Error',
      message: shaped.message,
    };
    if (shaped.fieldErrors) body.fieldErrors = shaped.fieldErrors;
    body.path = req.url;
    body.timestamp = new Date().toISOString();
    res.status(shaped.status).json(body);
  }

  private shape(e: unknown): Shaped {
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const r = e.getResponse();
      if (typeof r === 'string') return { status, message: r };
      const o = r as {
        message?: string | string[];
        fieldErrors?: FieldError[];
      };
      return {
        status,
        message: o.message ?? e.message,
        fieldErrors: o.fieldErrors,
      };
    }
    if (isDuplicateKey(e)) {
      const keys = Object.keys(e.keyValue ?? {});
      return {
        status: HttpStatus.CONFLICT,
        message: keys.length
          ? `Duplicate value for: ${keys.join(', ')}`
          : 'Duplicate value',
      };
    }
    if (e instanceof MongooseError.CastError) {
      return { status: HttpStatus.BAD_REQUEST, message: `Invalid ${e.path}` };
    }
    if (e instanceof MongooseError.ValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        fieldErrors: Object.entries(e.errors).map(([field, err]) => ({
          field,
          message: err.message,
        })),
      };
    }
    this.logger.error(e instanceof Error ? e.stack : String(e));
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}
