import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { FinanceModule } from '../finance/finance.module';
import { AccountingModule } from '../accounting/accounting.module';
import { SequenceModule } from '../common/sequence/sequence.module';

@Module({
  imports: [InventoryModule, FinanceModule, AccountingModule, SequenceModule],
  providers: [SalesService],
  controllers: [SalesController],
})
export class SalesModule {}