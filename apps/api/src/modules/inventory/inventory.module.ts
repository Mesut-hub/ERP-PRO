import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { WarehousesController } from './warehouses.controller';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [FinanceModule],
  providers: [InventoryService],
  controllers: [InventoryController, WarehousesController],
  exports: [InventoryService],
})
export class InventoryModule {}