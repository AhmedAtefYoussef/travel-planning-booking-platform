import 'server-only';
import { cacheLife } from 'next/cache';
import createClient from 'openapi-fetch';
import { readServerEnv } from '@/shared/config/env';
import type { paths, Schemas } from '@/shared/api/types';

export type Airport = Pick<
  Schemas['AirportDto'],
  'iataCode' | 'name' | 'timeZone'
>;

/** The API refuses page numbers above this; the seeded list is a handful of pages. */
const MAX_PAGES = 50;

/**
 * Every seeded airport (FLT-02) for the search form's from/to pickers, read page by page from the
 * public GET /api/airports. It is reference data loaded at setup, so it is cached for hours and shared
 * by all visitors; no cookies are sent. A failed load throws, so a failure is never cached.
 */
export async function listAllAirports(): Promise<Airport[]> {
  'use cache';
  cacheLife('hours');
  const api = createClient<paths>({ baseUrl: readServerEnv().BACKEND_URL });
  const airports: Airport[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await api.GET('/api/airports', {
      params: { query: { page } },
    });
    if (!data) throw new Error('Could not load the airport list');
    airports.push(
      ...(data.items ?? []).map(({ iataCode, name, timeZone }) => ({
        iataCode,
        name,
        timeZone,
      })),
    );
    if (page >= data.totalPages) break;
  }
  return airports;
}
