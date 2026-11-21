import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import { AppException, FieldError } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { ErrorResponseDto } from '../errors/error-response.dto';
import { InvalidInputError } from '../errors/invalid-input.error';

const DEFAULT_CODES: Partial<Record<number, ErrorCode>> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  415: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  429: ErrorCode.TOO_MANY_REQUESTS,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};

interface Normalized {
  status: number;
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldError[];
}

/**
 * Converts every thrown error into the one response shape documented as ErrorResponseDto:
 * {statusCode, error, code, message, fieldErrors?, path, timestamp} (GEN-02, TRVL-130).
 * Internal details (stack traces, driver messages) never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const n = this.normalize(exception);

    if (n.status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${n.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseDto = {
      statusCode: n.status,
      error: httpReason(n.status),
      code: n.code,
      message: n.message,
      ...(n.fieldErrors?.length ? { fieldErrors: n.fieldErrors } : {}),
      // Path only: query strings may carry tokens or personal data and must not be echoed back.
      path: (req.originalUrl ?? req.url ?? '').split('?')[0],
      timestamp: new Date().toISOString(),
    };
    res.status(n.status).json(body);
  }

  normalize(exception: unknown): Normalized {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        fieldErrors: exception.fieldErrors,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code:
          DEFAULT_CODES[status] ??
          (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST),
        message: status >= 500 ? 'Internal server error' : messageOf(exception),
      };
    }

    if (isDuplicateKeyError(exception)) {
      const fields = Object.keys(
        exception.keyValue ?? exception.keyPattern ?? {},
      );
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.DUPLICATE_KEY,
        message: fields.length
          ? `A record with this ${fields.join(', ')} already exists`
          : 'A record with these values already exists',
        fieldErrors: fields.map((field) => ({
          field,
          message: `${field} already exists`,
        })),
      };
    }

    if (exception instanceof MongooseError.CastError) {
      // Usually an unvalidated id from the client; logged because it can also hide a server-side bug.
      this.logger.warn(`CastError on ${exception.path}: ${exception.kind}`);
      return {
        status: HttpStatus.BAD_REQUEST,
        code:
          exception.kind === 'ObjectId'
            ? ErrorCode.INVALID_ID
            : ErrorCode.BAD_REQUEST,
        message: `Invalid value for ${exception.path}`,
        fieldErrors: [
          { field: exception.path, message: `${exception.path} is invalid` },
        ],
      };
    }

    if (exception instanceof MongooseError.ValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Validation failed',
        fieldErrors: Object.entries(exception.errors).map(([field, err]) => ({
          field,
          message: err.message,
        })),
      };
    }

    if (exception instanceof InvalidInputError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.BAD_REQUEST,
        message: exception.message,
      };
    }

    // Errors raised by Express middleware before Nest routing (malformed JSON, body too large).
    if (isClientHttpError(exception)) {
      const status = exception.status;
      return {
        status,
        code: DEFAULT_CODES[status] ?? ErrorCode.BAD_REQUEST,
        message:
          exception.type === 'entity.parse.failed'
            ? 'Malformed JSON request body'
            : exception.type === 'entity.too.large'
              ? 'Request body is too large'
              : 'Bad request',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }
}

function messageOf(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : exception.message;
}

function httpReason(status: number): string {
  const name = HttpStatus[status];
  if (!name) return 'Error';
  return name
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface DuplicateKeyError {
  code: 11000;
  keyValue?: Record<string, unknown>;
  keyPattern?: Record<string, unknown>;
}

function isDuplicateKeyError(e: unknown): e is DuplicateKeyError {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 11000
  );
}

/**
 * Only body-parser style errors (expose: true, type 'entity.*') are trusted as client errors. Any other
 * object with a 4xx `status` (e.g. an HTTP client error from an upstream API) is a server problem.
 */
function isClientHttpError(e: unknown): e is { status: number; type?: string } {
  if (typeof e !== 'object' || e === null) return false;
  const { status, expose, type } = e as {
    status?: unknown;
    expose?: unknown;
    type?: unknown;
  };
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    expose === true &&
    typeof type === 'string' &&
    type.startsWith('entity.')
  );
}
