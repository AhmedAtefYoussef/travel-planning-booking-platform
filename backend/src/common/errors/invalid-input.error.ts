/**
 * Thrown by pure helpers (money, dates, refund quotes) when a caller passes invalid business input,
 * e.g. an unknown currency, a non-existent local time or a cancellation after departure.
 * AllExceptionsFilter turns it into 400 BAD_REQUEST with this message. A plain RangeError (a real bug)
 * still becomes a 500, so programming errors are never disguised as client errors.
 */
export class InvalidInputError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}
