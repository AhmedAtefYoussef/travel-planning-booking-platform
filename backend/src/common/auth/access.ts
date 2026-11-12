import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { AuthUser, MODERATOR_PROVIDER, ProviderType, Role } from './auth.types';

/**
 * Ownership and provider-scope checks (ACC-11). Call them in services after loading the resource,
 * so the rule holds no matter which controller or frontend calls the service (GEN-13).
 */

/** A string id or an ObjectId (anything whose toString() is the 24-hex id). */
export type IdLike = string | { toHexString(): string } | null | undefined;

function idOf(id: IdLike): string | null {
  if (id == null) return null;
  return typeof id === 'string' ? id : id.toHexString();
}

function forbidden(message: string): AppException {
  return new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, message);
}

export interface OwnershipOptions {
  /** Roles that may access any owner's resource, e.g. [Role.Admin] for read-only admin views (ACC-17). */
  bypassRoles?: Role[];
  /**
   * Answer 404 instead of 403, so a stranger cannot even learn that a private resource exists
   * (ACC-11 allows 403 or 404). Use it for private itineraries and bookings looked up by id.
   */
  notFound?: boolean;
}

/** True when `user` owns the resource or holds a bypass role. */
export function isOwner(
  user: AuthUser,
  ownerId: IdLike,
  options: OwnershipOptions = {},
): boolean {
  if (options.bypassRoles?.includes(user.role)) return true;
  const owner = idOf(ownerId);
  return owner !== null && owner === user.id;
}

/**
 * Throws 403 unless `user` owns the resource: private bookings and itineraries (ACC-11).
 *   assertOwner(user, booking.userId, { bypassRoles: [Role.Admin] });
 */
export function assertOwner(
  user: AuthUser,
  ownerId: IdLike,
  options: OwnershipOptions = {},
): void {
  if (isOwner(user, ownerId, options)) return;
  if (options.notFound) {
    throw new AppException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'Resource not found',
    );
  }
  throw forbidden('You can only access your own resources');
}

/**
 * Owner-scoped query filter for lists (ACC-11): the caller's own documents, or every document for a
 * bypass role. Spread it into the find filter so another user's records are never even read:
 *   this.bookings.find({ ...ownerFilter(user, 'userId', { bypassRoles: [Role.Admin] }), status })
 */
export function ownerFilter(
  user: AuthUser,
  field = 'userId',
  options: Pick<OwnershipOptions, 'bypassRoles'> = {},
): Record<string, Types.ObjectId> {
  if (options.bypassRoles?.includes(user.role)) return {};
  return { [field]: new Types.ObjectId(user.id) };
}

/** True when `user` moderates exactly this provider (brief section 4: one assigned provider). */
export function managesProvider(
  user: AuthUser,
  type: ProviderType,
  providerId: IdLike,
): boolean {
  return (
    MODERATOR_PROVIDER[user.role] === type &&
    user.assignedProvider?.type === type &&
    idOf(providerId) !== null &&
    user.assignedProvider.providerId === idOf(providerId)
  );
}

/**
 * Throws 403 unless `user` is the moderator assigned to this airline/hotel, or an admin when
 * `allowAdmin` is set (e.g. admins create providers, ACC-13, FLT-01, HTL-01).
 *   assertProviderScope(user, ProviderType.Hotel, room.hotelId);
 */
export function assertProviderScope(
  user: AuthUser,
  type: ProviderType,
  providerId: IdLike,
  options: { allowAdmin?: boolean } = {},
): void {
  if (options.allowAdmin && user.role === Role.Admin) return;
  if (!managesProvider(user, type, providerId)) {
    throw forbidden(`You can only manage your assigned ${type.toLowerCase()}`);
  }
}
