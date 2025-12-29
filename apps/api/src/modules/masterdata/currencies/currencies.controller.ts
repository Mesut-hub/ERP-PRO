import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../../common/types/auth.types';
import { CurrenciesService } from './currencies.service';
import { SetCurrencyStatusDto } from './dto/set-currency-status.dto';

@Controller('md/currencies')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class CurrenciesController {
  constructor(private readonly service: CurrenciesService) {}

  @Get()
  @RequirePermissions('md.currency.read')
  list() {
    return this.service.list();
  }

  @Patch(':code/status')
  @RequirePermissions('md.currency.manage')
  setStatus(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('code') code: string,
    @Body() dto: SetCurrencyStatusDto,
  ) {
    return this.service.setStatus(actor.sub, code, dto.isActive);
  }
}