/**
 * Browser calls for the moderator's changes (FE-07). Each returns the API's answer or throws an
 * ApiError whose fieldErrors the forms place next to their inputs (GEN-02). The API enforces every
 * rule and the airline scope (ACC-11, GEN-13).
 */
import { api, unwrap } from '@/shared/api/client';
import type { Schemas } from '@/shared/api/types';

type Id = { id: string };

export const updateAirline = (id: string, body: Schemas['UpdateAirlineDto']) =>
  unwrap(api.PATCH('/api/airlines/{id}', { params: { path: { id } }, body }));

/** GEN-08: one JPG/PNG file in the multipart field "logo". */
export const uploadLogo = (id: string, file: File) => {
  const form = new FormData();
  form.append('logo', file);
  return unwrap(
    api.PUT('/api/airlines/{id}/logo', {
      params: { path: { id } },
      body: { logo: '' },
      bodySerializer: () => form,
    }),
  );
};

export const setBaggagePolicy = (
  id: string,
  body: Schemas['BaggagePolicyDto'],
) =>
  unwrap(
    api.PUT('/api/airlines/{id}/baggage-policy', {
      params: { path: { id } },
      body,
    }),
  );

export const setCancellationPolicy = (
  id: string,
  body: Schemas['CancellationPolicyDto'],
) =>
  unwrap(
    api.PUT('/api/airlines/{id}/cancellation-policy', {
      params: { path: { id } },
      body,
    }),
  );

export const createFlight = (body: Schemas['CreateFlightDto']) =>
  unwrap(api.POST('/api/flights', { body }));

export const updateFlight = ({ id }: Id, body: Schemas['UpdateFlightDto']) =>
  unwrap(api.PATCH('/api/flights/{id}', { params: { path: { id } }, body }));

export const addCabin = ({ id }: Id, body: Schemas['CreateCabinDto']) =>
  unwrap(
    api.POST('/api/flights/{id}/cabins', { params: { path: { id } }, body }),
  );

export const updateCabin = (
  { id }: Id,
  cabinId: string,
  body: Schemas['UpdateCabinDto'],
) =>
  unwrap(
    api.PATCH('/api/flights/{id}/cabins/{cabinId}', {
      params: { path: { id, cabinId } },
      body,
    }),
  );

export const cancelFlight = ({ id }: Id) =>
  unwrap(api.POST('/api/flights/{id}/cancel', { params: { path: { id } } }));

/** FLT-29 CSV, downloaded through the /api rewrite so the session cookie goes with it. */
export function passengerCsvHref(flightId: string): string {
  return `/api/flights/${encodeURIComponent(flightId)}/passengers/export`;
}
