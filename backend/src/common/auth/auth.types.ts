/**
 * Auth contract shared by every module (TRVL-131). The stub guard and the real guards (ACC-11,
 * Abdelrahman) both populate `request.user` with this exact shape, so module code never changes.
 */

export enum Role {
  User = 'USER',
  Admin = 'ADMIN',
  AirlineModerator = 'AIRLINE_MODERATOR',
  HotelModerator = 'HOTEL_MODERATOR',
}

export enum ProviderType {
  Airline = 'AIRLINE',
  Hotel = 'HOTEL',
}

/** A moderator manages exactly one provider (brief section 4, ACC-13). */
export interface AssignedProvider {
  type: ProviderType;
  providerId: string;
}

export interface AuthUser {
  id: string;
  role: Role;
  assignedProvider?: AssignedProvider;
}

export const MODERATOR_PROVIDER: Readonly<Partial<Record<Role, ProviderType>>> =
  {
    [Role.AirlineModerator]: ProviderType.Airline,
    [Role.HotelModerator]: ProviderType.Hotel,
  };

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
