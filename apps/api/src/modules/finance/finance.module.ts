import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { PostingLockService } from './posting-lock.service';
import { FinanceAdminController } from './finance-admin.controller';
import { FxService } from './fx/fx.service';
import { ExchangeRateAdminController } from './exchange-rate-admin.controller';

@Module({
  providers: [FinanceService, PostingLockService, FxService],
  controllers: [FinanceController, FinanceAdminController, ExchangeRateAdminController],
  exports: [PostingLockService, FxService],
})
export class FinanceModule {}