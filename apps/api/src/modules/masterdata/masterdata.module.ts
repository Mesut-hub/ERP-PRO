import { Module } from '@nestjs/common';
import { CurrenciesModule } from './currencies/currencies.module';
import { ExchangeRatesModule } from './exchange-rates/exchange-rates.module';
import { VatModule } from './vat/vat.module';
import { UnitsModule } from './units/units.module';
import { PartiesModule } from './parties/parties.module';
import { ProductsModule } from './products/products.module';
import { ProductCategoriesModule } from './product-categories/product-categories.module';

@Module({
  imports: [
    CurrenciesModule,
    ExchangeRatesModule,
    VatModule,
    UnitsModule,
    PartiesModule,
    ProductCategoriesModule,
    ProductsModule,
  ],
})
export class MasterDataModule {}
