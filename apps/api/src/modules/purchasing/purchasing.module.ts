import { Module } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { AccountingModule } from '../accounting/accounting.module';
import { FinanceModule } from '../finance/finance.module';
import { SequenceModule } from '../common/sequence/sequence.module';

@Module({
  imports: [InventoryModule, AccountingModule, FinanceModule, SequenceModule],
  providers: [PurchasingService],
  controllers: [PurchasingController],
  exports: [PurchasingService]
})
export class PurchasingModule {}