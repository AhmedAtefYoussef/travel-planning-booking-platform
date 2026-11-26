import 'server-only';
import { cacheLife } from 'next/cache';
import createClient from 'openapi-fetch';
import { readServerEnv } from '@/shared/config/env';
import type { paths } from '@/shared/api/types';

export type CityOption = { cityId: string; name: string };
export type Destination = { code: string; name: string; cities: CityOption[] };

/** The API refuses page numbers above this; the seeded lists are a page or two. */
const MAX_PAGES = 50;

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

/**
 * Every seeded country with its cities (HTL-11) for the search form's destination picker, read page
 * by page from the public GET /api/countries and /api/cities. It is reference data loaded at setup,
 * so it is cached for hours and shared by all visitors; no cookies are sent. A failed load throws,
 * so a failure is never cached.
 */
export async function listDestinations(): Promise<Destination[]> {
  'use cache';
  cacheLife('hours');
  const api = createClient<paths>({ baseUrl: readServerEnv().BACKEND_URL });

  const countries: { code: string; name: string }[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await api.GET('/api/countries', {
      params: { query: { page } },
    });
    if (!data) throw new Error('Could not load the country list');
    countries.push(
      ...(data.items ?? []).map(({ code, name }) => ({ code, name })),
    );
    if (page >= data.totalPages) break;
  }

  const cities = new Map<string, CityOption[]>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await api.GET('/api/cities', {
      params: { query: { page } },
    });
    if (!data) throw new Error('Could not load the city list');
    for (const { cityId, name, countryCode } of data.items ?? []) {
      cities.set(countryCode, [
        ...(cities.get(countryCode) ?? []),
        { cityId, name },
      ]);
    }
    if (page >= data.totalPages) break;
  }

  return countries
    .map(({ code, name }) => ({
      code,
      name,
      cities: [...(cities.get(code) ?? [])].sort(byName),
    }))
    .sort(byName);
}
