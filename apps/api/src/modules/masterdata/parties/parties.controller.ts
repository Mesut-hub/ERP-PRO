import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PartyType } from '@prisma/client';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../../common/types/auth.types';
import { PartiesService } from './parties.service';
import { CreatePartyDto } from './dto/create-party.dto';
import { UpdatePartyDto } from './dto/update-party.dto';

@Controller('md/parties')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class PartiesController {
  constructor(private readonly service: PartiesService) {}

  @Get()
  @RequirePermissions('md.party.read')
  list(@Query('type') type?: PartyType) {
    return this.service.list(type);
  }

  @Post()
  @RequirePermissions('md.party.manage')
  create(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreatePartyDto) {
    return this.service.create(actor.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('md.party.manage')
  update(@CurrentUser() actor: JwtAccessPayload, @Param('id') id: string, @Body() dto: UpdatePartyDto) {
    return this.service.update(actor.sub, id, dto);
  }
}