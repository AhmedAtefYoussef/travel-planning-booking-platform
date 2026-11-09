/** Contract 1 - auth decorators and guards (Abdelrahman -> everyone). */

export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
  AIRLINE_MOD = 'AIRLINE_MOD',
  HOTEL_MOD = 'HOTEL_MOD',
}

/** What `@CurrentUser()` returns on every authenticated request. */
export interface AuthUser {
  id: string;
  role: Role;
  /** Airline or hotel id for AIRLINE_MOD / HOTEL_MOD; null otherwise. */
  assignedProvider: string | null;
}
