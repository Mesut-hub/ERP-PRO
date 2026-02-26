import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { WarehousesController } from './warehouses.controller';
import { FinanceModule } from '../finance/finance.module';
import { SequenceModule } from '../common/sequence/sequence.module';
import { FifoService } from './costing/fifo.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [FinanceModule, SequenceModule, AccountingModule],
  providers: [InventoryService, FifoService],
  controllers: [InventoryController, WarehousesController],
  exports: [InventoryService, FifoService],
})
export class InventoryModule {}
