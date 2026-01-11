import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../../common/types/auth.types';
import { ExchangeRatesService } from './exchange-rates.service';
import { CreateExchangeRateDto } from './dto/create-exchange-rate.dto';

@Controller('md/exchange-rates')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class ExchangeRatesController {
  constructor(private readonly service: ExchangeRatesService) {}

  @Get()
  @RequirePermissions('md.exchange_rate.read')
  list(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.list({
      fromCode: from?.toUpperCase(),
      toCode: to?.toUpperCase(),
      take: 100,
    });
  }

  @Post()
  @RequirePermissions('md.exchange_rate.manage')
  create(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateExchangeRateDto) {
    return this.service.create(actor.sub, dto);
  }
}
