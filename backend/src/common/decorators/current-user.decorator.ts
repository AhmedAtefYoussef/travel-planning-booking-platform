import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../contracts/auth.contract';

export interface RequestWithUser {
  user?: AuthUser;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Injects the authenticated user `{ id, role, assignedProvider }`, or one
 * of its fields: `@CurrentUser('id') userId: string`.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest<RequestWithUser>().user;
    return field ? user?.[field] : user;
  },
);
