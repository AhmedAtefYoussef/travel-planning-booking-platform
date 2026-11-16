import type { RefundQuote } from '../../common/contracts';
import { formatMinor } from '../../common/utils/money';

/**
 * The refund sentence of a BOOKING_CANCELLED notice (FLT-26, HTL-21), in the platform currency (PAY-04).
 */
export function refundLine(quote: RefundQuote): string {
  return quote.amountMinor > 0
    ? `Refund: ${formatMinor(quote.amountMinor, quote.currency)} ${quote.currency} (${quote.refundPercent}%).`
    : 'No refund applies under the cancellation policy you accepted.';
}
