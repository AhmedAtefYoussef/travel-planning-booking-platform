import 'server-only';
import { connection } from 'next/server';
import { serverApi } from '@/shared/api/server';
import type { Page, Schemas } from '@/shared/api/types';
import { toMinorUnits } from '@/shared/lib/format';
import { toApiQuery } from '../model/links';
import {
  apiFieldToFormField,
  type FieldErrors,
  type FlightSearch,
} from '../model/search-params';

export type FlightResult = Schemas['FlightSearchResultDto'];

export type SearchOutcome =
  | {
      ok: true;
      outbound: Page<FlightResult>;
      /** Present for round trips. */
      return: Page<FlightResult> | null;
    }
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
 * Runs a one-way (FLT-11) or round-trip (FLT-12) search with the FLT-12 passenger types and the
 * FLT-15 price range and sort. Per request and uncached: seats and prices change all the time.
 */
export async function searchFlights(
  search: FlightSearch,
  currency: string,
): Promise<SearchOutcome> {
  // Live seats and prices: never prerendered, always read per request (Cache Components).
  await connection();
  const api = await serverApi();
  const query = toApiQuery(search, (n) => toMinorUnits(n, currency));
  try {
    if (search.trip === 'round') {
      const { data, error } = await api.GET('/api/flights/search/round-trip', {
        params: {
          query: query as typeof query & { returnDate: string },
        },
      });
      if (!data) return toOutcome(error);
      return { ok: true, outbound: data.outbound, return: data.return };
    }
    const { data, error } = await api.GET('/api/flights/search', {
      params: { query },
    });
    if (!data) return toOutcome(error);
    return { ok: true, outbound: data as Page<FlightResult>, return: null };
  } catch {
    return {
      ok: false,
      message:
        'Could not reach the flight service. Check your connection and try again.',
      errors: {},
    };
  }
}
