import { Module } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { AccountingController } from './accounting.controller';
import { FinanceModule } from '../finance/finance.module';
import { SequenceModule } from '../common/sequence/sequence.module';

@Module({
  imports: [FinanceModule, SequenceModule],
  providers: [AccountingService],
  controllers: [AccountingController],
  exports: [AccountingService],
})
export class AccountingModule {}