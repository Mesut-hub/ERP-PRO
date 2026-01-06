import { Module } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { AccountingController } from './accounting.controller';
import { FinanceModule } from '../finance/finance.module';
import { SequenceModule } from '../common/sequence/sequence.module';
import { AccountingStartupCheckService } from './startup/accounting-startup-check.service';

@Module({
  imports: [FinanceModule, SequenceModule],
  providers: [AccountingService, AccountingStartupCheckService],
  controllers: [AccountingController],
  exports: [AccountingService],
})
export class AccountingModule {}