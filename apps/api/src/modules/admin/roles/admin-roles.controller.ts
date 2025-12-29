import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../../common/types/auth.types';
import { AdminRolesService } from './admin-roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class AdminRolesController {
  constructor(private readonly service: AdminRolesService) {}

  @Get('roles')
  @RequirePermissions('admin.role.manage')
  listRoles(@CurrentUser() _actor: JwtAccessPayload) {
    return this.service.listRoles();
  }

  @Post('roles')
  @RequirePermissions('admin.role.manage')
  createRole(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateRoleDto) {
    return this.service.createRole(actor.sub, dto);
  }

  @Patch('roles/:id/permissions')
  @RequirePermissions('admin.role.manage')
  setRolePermissions(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.service.setRolePermissions(actor.sub, id, dto.permissionIds);
  }

  @Get('permissions')
  @RequirePermissions('admin.permission.manage')
  listPermissions(@CurrentUser() _actor: JwtAccessPayload) {
    return this.service.listPermissions();
  }
}