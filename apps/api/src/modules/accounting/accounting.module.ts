import { Module } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { AccountingController } from './accounting.controller';
import { FinanceModule } from '../finance/finance.module';
import { SequenceModule } from '../common/sequence/sequence.module';
import { AccountingStartupCheckService } from './startup/accounting-startup-check.service';
import { AccountingReportsController } from './accounting-reports.controller';
import { AccountingReportsService } from './accounting-reports.service';

@Module({
  imports: [FinanceModule, SequenceModule],
  providers: [AccountingService, AccountingStartupCheckService, AccountingReportsService],
  controllers: [AccountingController, AccountingReportsController],
  exports: [AccountingService],
})
export class AccountingModule {}
