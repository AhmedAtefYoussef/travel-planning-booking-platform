import 'server-only';
import { connection } from 'next/server';
import { cache } from 'react';
import { serverApi } from '@/shared/api/server';
import type { Schemas } from '@/shared/api/types';

export type FlightDetails = Schemas['FlightDetailsDto'];

const MONGO_ID = /^[a-f0-9]{24}$/i;

/**
 * FLT-17: one flight with its airline, cabins, baggage and cancellation tiers, or null when it does
 * not exist (the page shows the not-found screen). Other failures throw to the error boundary.
 * Memoised per request, so the page and its metadata share one call.
 */
export const getFlight = cache(async function getFlight(
  id: string,
): Promise<FlightDetails | null> {
  if (!MONGO_ID.test(id)) return null;
  // Live seats and bookability: never prerendered, always read per request (Cache Components).
  await connection();
  const api = await serverApi();
  const { data, response } = await api.GET('/api/flights/{id}', {
    params: { path: { id } },
  });
  if (data) return data;
  if (response.status === 404 || response.status === 400) return null;
  throw new Error(`Flight details failed with status ${response.status}`);
});
