import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { PostingLockService } from './posting-lock.service';
import { FinanceAdminController } from './finance-admin.controller';

@Module({
  providers: [FinanceService, PostingLockService],
  controllers: [FinanceController, FinanceAdminController],
  exports: [PostingLockService],
})
export class FinanceModule {}