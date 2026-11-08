import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export interface FieldError {
  /** Dotted path of the offending input, e.g. "passengers[0].dob" (GEN-02). */
  field: string;
  message: string;
}

/**
 * Throw this from services for business-rule failures so the client gets a stable `code`:
 *   throw new AppException(HttpStatus.CONFLICT, ErrorCode.INSUFFICIENT_INVENTORY, 'Only 2 seats left in Economy');
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: FieldError[],
  ) {
    super({ message, code, fieldErrors }, status);
  }
}

/** 400 with field-level messages (GEN-02). Raised by the global ValidationPipe. */
export class ValidationFailedException extends AppException {
  constructor(fieldErrors: FieldError[]) {
    super(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_FAILED,
      'Validation failed',
      fieldErrors,
    );
  }
}
