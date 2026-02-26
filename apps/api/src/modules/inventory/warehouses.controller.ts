import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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

  @Post()
  @RequirePermissions('inv.warehouse.manage')
  create(@Body() dto: any) {
    const code = String(dto.code ?? '').trim().toUpperCase();
    const name = String(dto.name ?? '').trim();
    const sectorTag = dto.sectorTag ? String(dto.sectorTag).trim() : null;
    const isActive = dto.isActive === undefined ? true : !!dto.isActive;

    if (!code || code.length < 2) throw new Error('code is required (min 2 chars)');
    if (!name || name.length < 2) throw new Error('name is required (min 2 chars)');

    return this.prisma.warehouse.create({
      data: { code, name, isActive, sectorTag },
    });
  }

  @Patch(':id')
  @RequirePermissions('inv.warehouse.manage')
  update(@Param('id') id: string, @Body() dto: any) {
    const patch: any = {};
    if (dto.code !== undefined) patch.code = String(dto.code).trim().toUpperCase();
    if (dto.name !== undefined) patch.name = String(dto.name).trim();
    if (dto.isActive !== undefined) patch.isActive = !!dto.isActive;
    if (dto.sectorTag !== undefined) patch.sectorTag = dto.sectorTag ? String(dto.sectorTag).trim() : null;

    return this.prisma.warehouse.update({ where: { id }, data: patch });
  }

  @Get(':id/locations')
  @RequirePermissions('inv.warehouse.read')
  locations(@Param('id') id: string) {
    return this.prisma.warehouseLocation.findMany({
      where: { warehouseId: id },
      orderBy: { code: 'asc' },
    });
  }

  @Post(':id/locations')
  @RequirePermissions('inv.warehouse.manage')
  createLocation(@Param('id') id: string, @Body() dto: any) {
    const code = String(dto.code ?? '').trim().toUpperCase();
    const name = dto.name ? String(dto.name).trim() : null;
    const isActive = dto.isActive === undefined ? true : !!dto.isActive;

    if (!code || code.length < 2) throw new Error('location code is required (min 2 chars)');

    return this.prisma.warehouseLocation.create({
      data: { warehouseId: id, code, name, isActive },
    });
  }

  @Patch(':id/locations/:locId')
  @RequirePermissions('inv.warehouse.manage')
  updateLocation(@Param('id') id: string, @Param('locId') locId: string, @Body() dto: any) {
    const patch: any = {};
    if (dto.code !== undefined) patch.code = String(dto.code).trim().toUpperCase();
    if (dto.name !== undefined) patch.name = dto.name ? String(dto.name).trim() : null;
    if (dto.isActive !== undefined) patch.isActive = !!dto.isActive;

    // ensure location belongs to this warehouse
    return this.prisma.warehouseLocation.update({
      where: { id: locId },
      data: patch,
    });
  }
}