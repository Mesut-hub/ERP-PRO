import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { FinanceService } from './finance.service';

@Controller()
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  @Get('ar/open-invoices')
  @RequirePermissions('ar.read')
  arOpen(@Query('customerId') customerId?: string) {
    return this.service.arOpenInvoices(customerId);
  }

  @Get('ar/aging')
  @RequirePermissions('ar.read')
  arAging(@Query('customerId') customerId?: string, @Query('asOf') asOf?: string) {
    return this.service.arAging(customerId, asOf);
  }

  @Get('ap/open-invoices')
  @RequirePermissions('ap.read')
  apOpen(@Query('supplierId') supplierId?: string) {
    return this.service.apOpenInvoices(supplierId);
  }

  @Get('ap/aging')
  @RequirePermissions('ap.read')
  apAging(@Query('supplierId') supplierId?: string, @Query('asOf') asOf?: string) {
    return this.service.apAging(supplierId, asOf);
  }
}