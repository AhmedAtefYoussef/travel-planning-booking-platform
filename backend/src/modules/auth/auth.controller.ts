import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/auth/auth.decorators';
import { ApiErrorResponses } from '../../common/swagger/api-responses.decorator';
import { UserProfileDto } from '../users';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

/** Authentication and account entry points (ACC-01; ACC-04, ACC-06 and ACC-19 follow). */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
}
