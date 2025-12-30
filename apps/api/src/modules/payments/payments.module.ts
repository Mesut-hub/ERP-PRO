import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { FinanceModule } from '../finance/finance.module';
import { AccountingModule } from '../accounting/accounting.module';
import { SequenceModule } from '../common/sequence/sequence.module';

@Module({
  imports: [FinanceModule, AccountingModule, SequenceModule],
  providers: [PaymentsService],
  controllers: [PaymentsController],
})
export class PaymentsModule {}