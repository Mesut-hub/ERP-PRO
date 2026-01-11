import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, refreshToken: string) {
    const name = this.config.getOrThrow<string>('REFRESH_COOKIE_NAME');
    const secure = this.config.get<string>('COOKIE_SECURE') === 'true';
    const sameSite = (this.config.get<string>('COOKIE_SAME_SITE') ?? 'lax') as
      | 'lax'
      | 'strict'
      | 'none';

    res.cookie(name, refreshToken, {
      httpOnly: true,
      secure,
      sameSite,
      path: '/auth',
    });
  }

  private clearRefreshCookie(res: Response) {
    const name = this.config.getOrThrow<string>('REFRESH_COOKIE_NAME');
    res.clearCookie(name, { path: '/auth' });
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login({
      email: dto.email,
      password: dto.password,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.setRefreshCookie(res, result.refreshToken);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('refresh')
  async refresh(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const name = this.config.getOrThrow<string>('REFRESH_COOKIE_NAME');
    const refreshToken = req.cookies?.[name];

    if (!refreshToken) {
      this.clearRefreshCookie(res);
      return { accessToken: null };
    }

    const result = await this.auth.refresh({
      refreshToken,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.setRefreshCookie(res, result.refreshToken);

    return { accessToken: result.accessToken };
  }

  @Post('logout')
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const name = this.config.getOrThrow<string>('REFRESH_COOKIE_NAME');
    const refreshToken = req.cookies?.[name];

    if (refreshToken) {
      await this.auth.logout({
        refreshToken,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    this.clearRefreshCookie(res);
    return { ok: true };
  }
}
