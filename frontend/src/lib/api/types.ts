import type { components } from './schema';

/**
 * Response and request shapes of the Milestone 1 API, generated from docs/api/openapi.json
 * (`npm run api:types`). Import DTOs from here instead of redefining them by hand.
 */
export type Schemas = components['schemas'];

export type UserProfile = Schemas['UserProfileDto'];
export type LoginResponse = Schemas['LoginResponseDto'];
export type Role = UserProfile['role'];
export type AccountStatus = UserProfile['status'];

/** GEN-05: every list endpoint returns this shape with a fixed page size of 10 (`?page=` only). */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const PAGE_SIZE = 10;
