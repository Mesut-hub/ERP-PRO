import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class AdminRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listRoles() {
    return this.prisma.role.findMany({
      orderBy: { code: 'asc' },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async listPermissions() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }

  async createRole(actorId: string, data: { code: string; name: string; description?: string }) {
    const code = data.code.trim().toUpperCase();

    const exists = await this.prisma.role.findUnique({ where: { code } });
    if (exists) throw new BadRequestException('Role code already exists');

    const created = await this.prisma.role.create({
      data: { code, name: data.name, description: data.description },
    });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'Role',
      entityId: created.id,
      after: created,
      message: `Created role ${created.code}`,
    });

    return created;
  }

  async setRolePermissions(actorId: string, roleId: string, permissionIds: string[]) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: true },
    });
    if (!role) throw new NotFoundException('Role not found');

    const perms = await this.prisma.permission.findMany({ where: { id: { in: permissionIds } } });
    if (perms.length !== permissionIds.length) throw new BadRequestException('One or more permissionIds invalid');

    const beforeIds = role.permissions.map((rp) => rp.permissionId).sort();
    const afterIds = permissionIds.slice().sort();

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId, permissionId })) });
    });

    await this.audit.log({
      actorId,
      action: AuditAction.UPDATE,
      entity: 'Role',
      entityId: roleId,
      before: { permissionIds: beforeIds },
      after: { permissionIds: afterIds },
      message: `Updated role permissions ${role.code}`,
    });

    return { ok: true };
  }
}