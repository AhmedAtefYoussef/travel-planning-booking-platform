import type { MinorUnits } from '../utils/money';

/** Contract 7 - Currency (Ahmed -> Abdelrahman). Interface only. */

export interface ConversionResult {
  amountMinor: MinorUnits;
  rate: number;
  /** Date of the rates used; older than today when the FX API was down. */
  rateDate: string;
}

export interface CurrencyService {
  /**
   * Converts between ISO 4217 codes using cached rates when the API is
   * unavailable. Throws BadRequestException for an unsupported code.
   */
  convert(
    amountMinor: MinorUnits,
    from: string,
    to: string,
  ): Promise<ConversionResult>;

  supportedCurrencies(): Promise<string[]>;
}
