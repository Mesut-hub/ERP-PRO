import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from '../../common/security/password';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async login(params: {
    email: string;
    password: string;
    ip?: string | null;
    userAgent?: string | null;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { email: params.email.toLowerCase() },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await verifyPassword(params.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const permissions: string[] = Array.from(
      new Set(
        user.roles.flatMap((ur: { role: { permissions: { permission: { code: string } }[] } }) =>
          ur.role.permissions.map((rp: { permission: { code: string } }) => rp.permission.code),
        ),
      ),
    ).sort();

    const payload: JwtAccessPayload = {
      sub: user.id,
      email: user.email,
      permissions,
      locale: user.preferredLocale,
    };

    const accessToken = await this.jwt.signAsync(payload);

    // Refresh token: random string stored hashed in DB
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const refreshHash = this.hashToken(refreshToken);

    const refreshTtl = Number(this.config.getOrThrow('JWT_REFRESH_TTL_SECONDS'));
    const expiresAt = new Date(Date.now() + refreshTtl * 1000);

    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
        expiresAt,
      },
    });

    await this.audit.log({
      actorId: user.id,
      action: AuditAction.LOGIN,
      entity: 'User',
      entityId: user.id,
      message: `User login: ${user.email}`,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    });

    return { accessToken, refreshToken, user: { id: user.id, email: user.email, fullName: user.fullName, permissions } };
  }

  async refresh(params: { refreshToken: string; ip?: string | null; userAgent?: string | null }) {
    const refreshHash = this.hashToken(params.refreshToken);

    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: refreshHash },
      include: {
        user: {
          include: {
            roles: {
              include: { role: { include: { permissions: { include: { permission: true } } } } },
            },
          },
        },
      },
    });

    if (!session || session.revokedAt) throw new UnauthorizedException('Invalid refresh token');
    if (session.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Refresh token expired');
    if (session.user.status !== 'ACTIVE') throw new UnauthorizedException('User disabled');

    const permissions: string[] = Array.from(
      new Set(
        session.user.roles.flatMap(
          (ur: { role: { permissions: { permission: { code: string } }[] } }) =>
            ur.role.permissions.map((rp: { permission: { code: string } }) => rp.permission.code),
        ),
      ),
    ).sort();

    const payload: JwtAccessPayload = {
      sub: session.user.id,
      email: session.user.email,
      permissions,
      locale: session.user.preferredLocale,
    };

    const accessToken = await this.jwt.signAsync(payload);

    // Rotate refresh token (recommended)
    const newRefreshToken = crypto.randomBytes(48).toString('base64url');
    const newRefreshHash = this.hashToken(newRefreshToken);

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: {
        tokenHash: newRefreshHash,
        ip: params.ip ?? session.ip,
        userAgent: params.userAgent ?? session.userAgent,
      },
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(params: { refreshToken: string; ip?: string | null; userAgent?: string | null }) {
    const refreshHash = this.hashToken(params.refreshToken);

    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: refreshHash },
      include: { user: true },
    });

    if (!session) return { ok: true };

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    await this.audit.log({
      actorId: session.userId,
      action: AuditAction.LOGOUT,
      entity: 'User',
      entityId: session.userId,
      message: `User logout: ${session.user.email}`,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    });

    return { ok: true };
  }
}