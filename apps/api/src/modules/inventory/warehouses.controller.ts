import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
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
  async create(@Body() dto: any) {
    const code = String(dto.code ?? '').trim().toUpperCase();
    const name = String(dto.name ?? '').trim();
    const sectorTag = dto.sectorTag ? String(dto.sectorTag).trim() : null;
    const isActive = dto.isActive === undefined ? true : !!dto.isActive;

    if (!code || code.length < 2)
      throw new BadRequestException('Warehouse code is required (min 2 chars).');
    if (!name || name.length < 2)
      throw new BadRequestException('Warehouse name is required (min 2 chars).');

    const existing = await this.prisma.warehouse.findUnique({ where: { code } });
    if (existing) throw new BadRequestException(`Warehouse code already exists: ${code}`);

    try {
      return await this.prisma.warehouse.create({
        data: { code, name, isActive, sectorTag },
      });
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Failed to create warehouse');
    }
  }

  @Patch(':id')
  @RequirePermissions('inv.warehouse.manage')
  async update(@Param('id') id: string, @Body() dto: any) {
    const wh = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!wh) throw new NotFoundException('Warehouse not found');

    const patch: any = {};
    if (dto.code !== undefined) patch.code = String(dto.code).trim().toUpperCase();
    if (dto.name !== undefined) patch.name = String(dto.name).trim();
    if (dto.isActive !== undefined) patch.isActive = !!dto.isActive;
    if (dto.sectorTag !== undefined)
      patch.sectorTag = dto.sectorTag ? String(dto.sectorTag).trim() : null;

    if (patch.code && patch.code.length < 2)
      throw new BadRequestException('Warehouse code must be at least 2 chars.');
    if (patch.name && patch.name.length < 2)
      throw new BadRequestException('Warehouse name must be at least 2 chars.');

    if (patch.code && patch.code !== wh.code) {
      const exists = await this.prisma.warehouse.findUnique({ where: { code: patch.code } });
      if (exists) throw new BadRequestException(`Warehouse code already exists: ${patch.code}`);
    }

    try {
      return await this.prisma.warehouse.update({ where: { id }, data: patch });
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Failed to update warehouse');
    }
  }

  @Get(':id/locations')
  @RequirePermissions('inv.warehouse.read')
  async locations(@Param('id') id: string) {
    const wh = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!wh) throw new NotFoundException('Warehouse not found');

    return this.prisma.warehouseLocation.findMany({
      where: { warehouseId: id },
      orderBy: { code: 'asc' },
    });
  }

  @Post(':id/locations')
  @RequirePermissions('inv.warehouse.manage')
  async createLocation(@Param('id') id: string, @Body() dto: any) {
    const wh = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!wh) throw new NotFoundException('Warehouse not found');

    const code = String(dto.code ?? '').trim().toUpperCase();

    // ✅ Prisma expects name: string (required) in your schema
    const name = String(dto.name ?? '').trim();

    const isActive = dto.isActive === undefined ? true : !!dto.isActive;

    if (!code || code.length < 2)
      throw new BadRequestException('Location code is required (min 2 chars).');

    const existing = await this.prisma.warehouseLocation.findFirst({
      where: { warehouseId: id, code },
      select: { id: true },
    });
    if (existing)
      throw new BadRequestException(`Location code already exists in warehouse ${wh.code}: ${code}`);

    try {
      return await this.prisma.warehouseLocation.create({
        data: { warehouseId: id, code, name, isActive },
      });
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Failed to create location');
    }
  }

  @Patch(':id/locations/:locId')
  @RequirePermissions('inv.warehouse.manage')
  async updateLocation(@Param('id') id: string, @Param('locId') locId: string, @Body() dto: any) {
    const wh = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!wh) throw new NotFoundException('Warehouse not found');

    const loc = await this.prisma.warehouseLocation.findUnique({ where: { id: locId } });
    if (!loc || loc.warehouseId !== id) {
      throw new NotFoundException('Location not found for this warehouse');
    }

    const patch: any = {};
    if (dto.code !== undefined) patch.code = String(dto.code).trim().toUpperCase();

    // ✅ keep it string if provided; do NOT set null
    if (dto.name !== undefined) patch.name = String(dto.name ?? '').trim();

    if (dto.isActive !== undefined) patch.isActive = !!dto.isActive;

    if (patch.code && patch.code.length < 2)
      throw new BadRequestException('Location code must be at least 2 chars.');

    if (patch.code && patch.code !== loc.code) {
      const exists = await this.prisma.warehouseLocation.findFirst({
        where: { warehouseId: id, code: patch.code },
        select: { id: true },
      });
      if (exists)
        throw new BadRequestException(
          `Location code already exists in warehouse ${wh.code}: ${patch.code}`,
        );
    }

    try {
      return await this.prisma.warehouseLocation.update({
        where: { id: locId },
        data: patch,
      });
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Failed to update location');
    }
  }
}