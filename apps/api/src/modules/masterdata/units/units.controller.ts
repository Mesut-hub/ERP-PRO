import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../../common/types/auth.types';
import { UnitsService } from './units.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

@Controller('md/units')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class UnitsController {
  constructor(private readonly service: UnitsService) {}

  @Get()
  @RequirePermissions('md.unit.read')
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermissions('md.unit.manage')
  create(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateUnitDto) {
    return this.service.create(actor.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('md.unit.manage')
  update(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.service.update(actor.sub, id, dto);
  }
}
