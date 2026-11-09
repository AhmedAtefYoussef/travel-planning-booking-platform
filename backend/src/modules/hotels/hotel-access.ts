import { ForbiddenException } from '@nestjs/common';
import { AuthUser, Role } from '../../common/contracts/auth.contract';

/** A hotel moderator may only act on the one hotel they are assigned to. */
export function assertOwnHotel(
  user: AuthUser | undefined,
  hotelId: string,
): AuthUser {
  if (
    !user ||
    user.role !== Role.HOTEL_MOD ||
    user.assignedProvider !== hotelId
  ) {
    throw new ForbiddenException('You can only manage your own hotel');
  }
  return user;
}

/** Read access for the own moderator or any admin. */
export function assertOwnHotelOrAdmin(
  user: AuthUser | undefined,
  hotelId: string,
): AuthUser {
  if (user?.role === Role.ADMIN) return user;
  return assertOwnHotel(user, hotelId);
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}
