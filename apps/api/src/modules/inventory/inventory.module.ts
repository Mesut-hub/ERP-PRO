import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { WarehousesController } from './warehouses.controller';
import { FinanceModule } from '../finance/finance.module';
import { SequenceModule } from '../common/sequence/sequence.module';

@Module({
  imports: [FinanceModule, SequenceModule],
  providers: [InventoryService],
  controllers: [InventoryController, WarehousesController],
  exports: [InventoryService],
})
export class InventoryModule {}