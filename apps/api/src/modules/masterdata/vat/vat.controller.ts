import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('md/vat')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class VatController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('rates')
  @RequirePermissions('md.vat.read')
  listRates() {
    return this.prisma.vatRate.findMany({ orderBy: { percent: 'asc' } });
  }
}
