import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { PostingLockService } from './posting-lock.service';
import { FinanceAdminController } from './finance-admin.controller';
import { FxModule } from './fx/fx.module';

@Module({
  imports: [FxModule],
  providers: [FinanceService, PostingLockService],
  controllers: [FinanceController, FinanceAdminController],
  exports: [PostingLockService, FxModule],
})
export class FinanceModule {}
