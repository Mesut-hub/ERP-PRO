import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from '../health/health.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminUsersModule } from '../admin/users/admin-users.module';
import { AdminRolesModule } from '../admin/roles/admin-roles.module';
import { MasterDataModule } from '../masterdata/masterdata.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { AccountingModule } from '../accounting/accounting.module';
import { SalesModule } from '../sales/sales.module';
import { PaymentsModule } from '../payments/payments.module';
import { FinanceModule } from '../finance/finance.module';
import { SequenceModule } from '../common/sequence/sequence.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    AdminUsersModule,
    AdminRolesModule,
    MasterDataModule,
    InventoryModule,
    PurchasingModule,
    AccountingModule,
    SalesModule,
    PaymentsModule,
    FinanceModule,
    SequenceModule,
    HealthModule,
  ],
})
export class AppModule {}