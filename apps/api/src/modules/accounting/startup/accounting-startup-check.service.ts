import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AccountingStartupCheckService implements OnModuleInit {
  private readonly logger = new Logger(AccountingStartupCheckService.name);

  // Keep this list minimal but strict. Expand as you add new integrations.
  private readonly requiredAccountCodes = [
    '150',
    '191',
    '320',
    '327',
    '328',
    '391',
    '600',
    '621',
    '770',
  ];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const rows = await this.prisma.account.findMany({
      where: { code: { in: this.requiredAccountCodes } },
      select: { code: true, isActive: true },
    });

    const found = new Map(rows.map((r) => [r.code, r]));
    const missing = this.requiredAccountCodes.filter((c) => !found.has(c));
    const inactive = this.requiredAccountCodes.filter(
      (c) => found.get(c) && !found.get(c)!.isActive,
    );

    if (missing.length || inactive.length) {
      const msg =
        `Accounting startup check failed.\n` +
        (missing.length ? `Missing account codes: ${missing.join(', ')}\n` : '') +
        (inactive.length ? `Inactive account codes: ${inactive.join(', ')}\n` : '');

      this.logger.error(msg);
      // Fail fast: crash the app so this is fixed immediately in deployment
      throw new Error(msg);
    }

    this.logger.log(
      `Accounting startup check OK. Required accounts present: ${this.requiredAccountCodes.join(', ')}`,
    );
  }
}
