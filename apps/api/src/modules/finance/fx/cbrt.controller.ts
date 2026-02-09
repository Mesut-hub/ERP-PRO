import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CbrtService } from './cbrt.service';

@Controller('md/exchange-rates/cbrt')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class CbrtController {
  constructor(private readonly cbrt: CbrtService) {}

  /**
   * POST /md/exchange-rates/cbrt/sync?date=YYYY-MM-DD
   * - If date omitted, uses today (Istanbul day).
   */
  @Post('sync')
  @RequirePermissions('md.exchange_rate.manage')
  sync(@Query('date') date?: string) {
    return this.cbrt.syncDaily(date);
  }
}
