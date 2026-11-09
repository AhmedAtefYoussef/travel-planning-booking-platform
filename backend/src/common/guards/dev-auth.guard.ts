import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthUser, Role } from '../contracts/auth.contract';
import type { RequestWithUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

export const DEV_USER_HEADER = 'x-dev-user-id';
export const DEV_ROLE_HEADER = 'x-dev-role';
export const DEV_PROVIDER_HEADER = 'x-dev-provider';

/**
 * TEMPORARY global guard until Abdelrahman's JwtAuthGuard + RolesGuard land
 * (contract 1). Deny-by-default:
 *  - @Public() routes pass.
 *  - Everything else needs a user. Outside production the user is taken
 *    from the x-dev-user-id / x-dev-role / x-dev-provider headers so
 *    teammates can exercise protected routes in Swagger and e2e tests.
 *  - In production every non-public request is rejected.
 *  - @Roles(...) is enforced when present.
 */
@Injectable()
export class DevAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = this.resolveUser(request);
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    request.user = user;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      targets,
    );
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }

  private resolveUser(request: RequestWithUser): AuthUser | null {
    // Allow-list: header auth only when explicitly enabled in dev/test.
    const env = this.config.get<string>('NODE_ENV');
    if (
      this.config.get<boolean>('DEV_AUTH_ENABLED') !== true ||
      (env !== 'development' && env !== 'test')
    ) {
      return null;
    }
    const id = header(request, DEV_USER_HEADER);
    if (!id) return null;

    const roleRaw = (
      header(request, DEV_ROLE_HEADER) ?? Role.USER
    ).toUpperCase();
    if (!Object.values(Role).includes(roleRaw as Role)) return null;

    return {
      id,
      role: roleRaw as Role,
      assignedProvider: header(request, DEV_PROVIDER_HEADER) ?? null,
    };
  }
}

function header(request: RequestWithUser, name: string): string | undefined {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}
