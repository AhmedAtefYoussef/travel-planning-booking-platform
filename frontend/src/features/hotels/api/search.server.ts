import 'server-only';
import { connection } from 'next/server';
import { serverApi } from '@/shared/api/server';
import type { Page, Schemas } from '@/shared/api/types';
import { toMinorUnits } from '@/shared/lib/format';
import {
  apiFieldToFormField,
  toApiQuery,
  type FieldErrors,
  type HotelSearch,
} from '../model/search-params';

export type HotelResult = Schemas['HotelSearchResultDto'];

export type SearchOutcome =
  | { ok: true; page: Page<HotelResult> }
  | { ok: false; message: string; errors: FieldErrors };

/** Kinder wording for the API's price messages, which speak in minor units. */
const FRIENDLY: Partial<Record<keyof FieldErrors, string>> = {
  maxPrice: 'The maximum price must be at least the minimum price.',
  minPrice: 'Enter a valid minimum price.',
};

type ApiErrorBody = {
  message?: string;
  fieldErrors?: { field: string; message: string }[];
};

function toOutcome(error: unknown): SearchOutcome {
  const body = (error ?? {}) as ApiErrorBody;
  const errors: FieldErrors = {};
  for (const { field, message } of body.fieldErrors ?? []) {
    const formField = apiFieldToFormField(field);
    if (formField) errors[formField] ??= FRIENDLY[formField] ?? message;
  }
  return {
    ok: false,
    message: body.message ?? 'The search could not be run. Please try again.',
    errors,
  };
}

/**
 * Searches hotels with free rooms for the stay (HTL-11) with the HTL-12 price, rating and sort
 * refinements. Per request and uncached: free rooms and prices change all the time.
 */
export async function searchHotels(
  search: HotelSearch,
  currency: string,
): Promise<SearchOutcome> {
  // Live availability and prices: never prerendered, always read per request (Cache Components).
  await connection();
  const api = await serverApi();
  const query = toApiQuery(search, (n) => toMinorUnits(n, currency));
  try {
    const { data, error } = await api.GET('/api/hotels/search', {
      params: { query },
    });
    if (!data) return toOutcome(error);
    return { ok: true, page: data as Page<HotelResult> };
  } catch {
    return {
      ok: false,
      message:
        'Could not reach the hotel service. Check your connection and try again.',
      errors: {},
    };
  }
}
