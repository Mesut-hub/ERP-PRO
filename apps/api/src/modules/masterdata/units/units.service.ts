import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.unit.findMany({ orderBy: { code: 'asc' } });
  }

  async create(actorId: string, data: { code: string; name: string }) {
    const code = data.code.trim().toUpperCase();

    const exists = await this.prisma.unit.findUnique({ where: { code } });
    if (exists) throw new BadRequestException('Unit code exists');

    const created = await this.prisma.unit.create({ data: { code, name: data.name } });

    await this.audit.log({
      actorId,
      action: AuditAction.CREATE,
      entity: 'Unit',
      entityId: created.id,
      after: created,
      message: `Created unit ${code}`,
    });

    return created;
  }

  async update(actorId: string, id: string, data: { name?: string }) {
    const before = await this.prisma.unit.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Unit not found');

    const after = await this.prisma.unit.update({ where: { id }, data: { name: data.name ?? before.name } });

    await this.audit.log({
      actorId,
      action: AuditAction.UPDATE,
      entity: 'Unit',
      entityId: id,
      before,
      after,
      message: `Updated unit ${before.code}`,
    });

    return after;
  }
}