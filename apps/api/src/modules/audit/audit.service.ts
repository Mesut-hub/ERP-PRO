import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    actorId?: string | null;
    action: AuditAction;
    entity: string;
    entityId?: string | null;
    message?: string | null;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  }) {
    const { before, after, ...rest } = params;
    return this.prisma.auditLog.create({
      data: {
        ...rest,
        before: before as any,
        after: after as any,
      },
    });
  }
}