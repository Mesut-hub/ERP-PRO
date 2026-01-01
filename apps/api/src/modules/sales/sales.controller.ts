import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { SalesService } from './sales.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { DeliverSalesOrderDto } from './dto/deliver-sales-order.dto';
import { CreateCustomerInvoiceDto } from './dto/create-customer-invoice.dto';
import { ApproveSalesOrderDto } from './dto/approve-sales-order.dto';
import { PostingOverrideDto } from '../common/dto/posting-override.dto';
import { CreateInvoiceNoteDto } from './dto/create-invoice-note.dto';

@Controller('sales')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class SalesController {
  constructor(private readonly service: SalesService) {}

  @Get('orders')
  @RequirePermissions('sales.order.read')
  listOrders() {
    return this.service.listOrders();
  }

  @Post('orders')
  @RequirePermissions('sales.order.manage')
  createOrder(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateSalesOrderDto) {
    return this.service.createOrder(actor.sub, dto);
  }

  @Post('orders/:id/approve')
  @RequirePermissions('sales.order.approve')
  approveOrder(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') id: string,
    @Body() dto: ApproveSalesOrderDto,
  ) {
    return this.service.approveOrder(actor, id, dto.reason);
  }

  @Post('orders/:id/deliver')
  @RequirePermissions('sales.order.deliver')
  deliver(@CurrentUser() actor: JwtAccessPayload, @Param('id') id: string, @Body() dto: DeliverSalesOrderDto) {
    return this.service.deliverOrder(actor, id, dto);
  }

  @Get('invoices')
  @RequirePermissions('sales.invoice.read')
  listInvoices() {
    return this.service.listInvoices();
  }

  @Post('invoices')
  @RequirePermissions('sales.invoice.manage')
  createInvoice(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateCustomerInvoiceDto) {
    return this.service.createInvoice(actor.sub, dto);
  }

  @Post('invoices/:id/post')
  @RequirePermissions('sales.invoice.post')
  postInvoice(@CurrentUser() actor: JwtAccessPayload, @Param('id') id: string, @Body() dto: PostingOverrideDto) {
    return this.service.postInvoice(actor, id, dto.reason);
  }

  @Post('invoice-notes')
  @RequirePermissions('sales.invoice.manage')
  createInvoiceNote(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateInvoiceNoteDto) {
    return this.service.createInvoiceNote(actor, dto);
  }
}