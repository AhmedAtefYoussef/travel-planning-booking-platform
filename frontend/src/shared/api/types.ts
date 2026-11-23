import type { components, paths } from './schema';

/** Generated from docs/api/openapi.json (`npm run api:types`); never edit schema.d.ts by hand. */
export type { components, paths };
export type Schemas = components['schemas'];

export type UserProfile = Schemas['UserProfileDto'];
export type Role = UserProfile['role'];
export type ErrorResponse = Schemas['ErrorResponseDto'];
export type ErrorCode = ErrorResponse['code'];

/** Every list endpoint returns this envelope; the page size is fixed at 10 (GEN-05). */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
