import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_PATH,
  authCookieOptions,
  clearCookieOptions,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from '../../common/auth/auth-cookies';
import { CurrentUser, Public, Roles } from '../../common/auth/auth.decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import type { EnvironmentVariables } from '../../config/env.validation';
import { UserProfileDto } from '../users';
import { AuthService, type LoginResult } from './auth.service';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/** A cookie value as a non-empty string, or undefined. */
function cookie(req: Request, name: string): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Authentication and account entry points (ACC-01, ACC-04, ACC-19; ACC-06 follows). */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.secureCookies = config.get('COOKIE_SECURE', { infer: true });
  }

  @Post('register')
  @Public()
  @ApiOperation({
    summary: 'ACC-01 Guest registers an account',
    description:
      'Name, unique email, password (8+ characters with a letter and a digit) and the terms-and-privacy consent (`acceptTerms: true`). ' +
      'The new account is an active USER: the role cannot be chosen, so admins and moderators cannot self-register (ACC-18, ACC-13). ' +
      'Each broken rule is returned as a field error (400); an email that is already registered returns 409 EMAIL_ALREADY_REGISTERED. ' +
      'Registering does not log in; call POST /api/auth/login next.',
  })
  @ApiBody({
    type: RegisterDto,
    examples: {
      valid: {
        summary: 'Valid registration',
        value: {
          name: 'Mona Hassan',
          email: 'mona@example.com',
          password: 'Travel2026',
          acceptTerms: true,
        },
      },
      invalid: {
        summary: 'Invalid: bad email, password without a digit, no consent',
        value: {
          name: 'Mona Hassan',
          email: 'not-an-email',
          password: 'onlyletters',
          acceptTerms: false,
        },
      },
      selfPromotion: {
        summary: 'Rejected: choosing a role is not allowed',
        value: {
          name: 'Eve',
          email: 'eve@example.com',
          password: 'Travel2026',
          acceptTerms: true,
          role: 'ADMIN',
        },
      },
    },
  })
  @ApiCreatedResponse({
    type: UserProfileDto,
    description: 'The new account (never includes the password)',
  })
  @ApiErrorResponses(400, 409)
  register(@Body() dto: RegisterDto): Promise<UserProfileDto> {
    return this.auth.register(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'ACC-04 / ACC-19 Log in with email and password',
    description:
      'Works for users, admins and moderators. On success it sets two httpOnly, SameSite=Lax cookies (Secure when COOKIE_SECURE=true): ' +
      '`access_token` (JWT, JWT_ACCESS_TTL, path /api) and `refresh_token` (random, stored hashed, JWT_REFRESH_TTL, path /api/auth). ' +
      "No token is ever returned in the body (ACC-19); the body has the profile and `homePath`, the role's home page. " +
      'Unknown email or wrong password: 401 INVALID_CREDENTIALS "Invalid email or password". ' +
      'Suspended account (correct password): 403 ACCOUNT_SUSPENDED. ' +
      'In Swagger, after logging in, every "Try it out" call sends the cookie automatically.',
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      admin: {
        summary:
          'Seeded admin (values from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD)',
        value: { email: 'admin@example.com', password: 'Admin2026x' },
      },
      traveller: {
        summary: 'A registered user',
        value: { email: 'mona@example.com', password: 'Travel2026' },
      },
      wrongPassword: {
        summary: 'Fails with the generic message',
        value: { email: 'mona@example.com', password: 'WrongPass1' },
      },
    },
  })
  @ApiOkResponse({
    type: LoginResponseDto,
    description: 'Logged in; cookies set via Set-Cookie',
  })
  @ApiErrorResponses(400, 401, 403)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.auth.login(dto);
    this.setAuthCookies(res, result);
    return { user: result.user, homePath: result.homePath };
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'ACC-06 / ACC-19 Refresh the access cookie',
    description:
      'Uses the httpOnly `refresh_token` cookie (sent only to /api/auth) to issue a new `access_token` cookie and a new refresh token; ' +
      'the old refresh token stops working (rotation). No body is needed and no token is returned in the body. ' +
      'Fails with 401 and clears both cookies when the session was logged out, has had no authenticated request for SESSION_IDLE_MINUTES (30), ' +
      'is past JWT_REFRESH_TTL, or the refresh token was already used. A suspended account gets 403 ACCOUNT_SUSPENDED.',
  })
  @ApiOkResponse({ type: LoginResponseDto, description: 'New cookies set' })
  @ApiErrorResponses(401, 403)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    try {
      const result = await this.auth.refresh(cookie(req, REFRESH_COOKIE));
      this.setAuthCookies(res, result);
      return { user: result.user, homePath: result.homePath };
    } catch (error) {
      this.clearAuthCookies(res);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @ApiOperation({
    summary: 'ACC-06 Log out',
    description:
      'Revokes the session on the server (its refresh token and access token stop working at once) and clears both auth cookies. ' +
      'Public on purpose, so a user whose access token already expired can still log out; it always answers 204, even when called twice.',
  })
  @ApiNoContentResponse({
    description: 'Logged out; cookies cleared via Set-Cookie',
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(
      cookie(req, REFRESH_COOKIE),
      cookie(req, ACCESS_COOKIE),
    );
    this.clearAuthCookies(res);
  }

  private setAuthCookies(res: Response, result: LoginResult): void {
    res.cookie(
      ACCESS_COOKIE,
      result.accessToken,
      authCookieOptions(
        this.secureCookies,
        ACCESS_COOKIE_PATH,
        result.accessTtlMs,
      ),
    );
    res.cookie(
      REFRESH_COOKIE,
      result.refreshToken,
      authCookieOptions(
        this.secureCookies,
        REFRESH_COOKIE_PATH,
        result.refreshTtlMs,
      ),
    );
  }

  /** ACC-06: the cookies must be cleared with the same path and flags they were set with. */
  private clearAuthCookies(res: Response): void {
    res.clearCookie(
      ACCESS_COOKIE,
      clearCookieOptions(this.secureCookies, ACCESS_COOKIE_PATH),
    );
    res.clearCookie(
      REFRESH_COOKIE,
      clearCookieOptions(this.secureCookies, REFRESH_COOKIE_PATH),
    );
  }

  @Get('me')
  @Roles()
  @ApiOperation({
    summary: 'ACC-04 / ACC-19 Current user',
    description:
      'Returns the logged-in account from the `access_token` cookie. The frontend uses this instead of reading any token (ACC-19). ' +
      '401 when not logged in, when the session expired, or when the account no longer exists.',
  })
  @ApiOkResponse({ type: UserProfileDto })
  me(@CurrentUser() user: AuthUser): Promise<UserProfileDto> {
    return this.auth.me(user);
  }
}
