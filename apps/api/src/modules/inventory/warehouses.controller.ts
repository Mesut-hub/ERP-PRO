import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('inv/warehouses')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class WarehousesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('inv.warehouse.read')
  list() {
    return this.prisma.warehouse.findMany({ orderBy: { code: 'asc' } });
  }

  @Get(':id/locations')
  @RequirePermissions('inv.warehouse.read')
  locations(@Param('id') id: string) {
    return this.prisma.warehouseLocation.findMany({
      where: { warehouseId: id },
      orderBy: { code: 'asc' },
    });
  }
}