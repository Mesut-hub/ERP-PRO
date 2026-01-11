import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, UserStatus } from '@prisma/client';
import { hashPassword } from '../../../common/security/password';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        preferredLocale: true,
        createdAt: true,
        updatedAt: true,
        roles: { select: { role: { select: { id: true, code: true, name: true } } } },
      },
    });
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        preferredLocale: true,
        createdAt: true,
        updatedAt: true,
        roles: { select: { role: { select: { id: true, code: true, name: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(
    actorId: string,
    data: { email: string; fullName: string; password: string; preferredLocale?: string },
  ) {
    const email = data.email.toLowerCase();

    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new BadRequestException('Email already exists');

    const passwordHash = await hashPassword(data.password);

    const created = await this.prisma.user.create({
      data: {
        email,
        fullName: data.fullName,
        passwordHash,
        preferredLocale: data.preferredLocale ?? 'en',
        status: UserStatus.ACTIVE,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        preferredLocale: true,
        createdAt: true,
      },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'User',
      entityId: created.id,
      after: created,
      message: `Created user ${created.email}`,
    });

    return created;
  }

  async update(
    actorId: string,
    id: string,
    data: { email?: string; fullName?: string; password?: string; preferredLocale?: string },
  ) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('User not found');

    const patch: any = {};

    if (data.email) patch.email = data.email.toLowerCase();
    if (data.fullName) patch.fullName = data.fullName;
    if (data.preferredLocale) patch.preferredLocale = data.preferredLocale;

    if (data.password) {
      patch.passwordHash = await hashPassword(data.password);
    }

    const after = await this.prisma.user.update({
      where: { id },
      data: patch,
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        preferredLocale: true,
        updatedAt: true,
      },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: id,
      before: {
        id: before.id,
        email: before.email,
        fullName: before.fullName,
        status: before.status,
        preferredLocale: before.preferredLocale,
      },
      after,
      message: `Updated user ${after.email}`,
    });

    return after;
  }

  async setStatus(actorId: string, id: string, status: UserStatus) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('User not found');

    const after = await this.prisma.user.update({
      where: { id },
      data: { status },
      select: { id: true, email: true, fullName: true, status: true, updatedAt: true },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: id,
      before: { status: before.status },
      after: { status: after.status },
      message: `Set status ${after.email} => ${after.status}`,
    });

    return after;
  }

  async setRoles(actorId: string, id: string, roleIds: string[]) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Validate roles exist
    const roles = await this.prisma.role.findMany({ where: { id: { in: roleIds } } });
    if (roles.length !== roleIds.length)
      throw new BadRequestException('One or more roleIds invalid');

    const beforeRoleIds = user.roles.map((r) => r.roleId).sort();

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
    });

    const afterRoleIds = roleIds.slice().sort();

    await this.audit.log({
      actorId,
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: id,
      before: { roleIds: beforeRoleIds },
      after: { roleIds: afterRoleIds },
      message: `Updated user roles`,
    });

    return { ok: true };
  }
}
