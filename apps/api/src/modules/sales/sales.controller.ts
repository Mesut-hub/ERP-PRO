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
import { CreateSalesReturnDto } from './dto/create-sales-return.dto';
import { PrismaService } from '../prisma/prisma.service';

@Controller('sales')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class SalesController {
  constructor(
    private readonly service: SalesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('orders')
  @RequirePermissions('sales.order.read')
  listOrders() {
    return this.service.listOrders();
  }

  @Get('orders/:id')
  @RequirePermissions('sales.order.read')
  async getOrder(@Param('id') id: string) {
    // We fetch via prisma because SalesService is redacted here and we want predictable includes.
    const so = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        warehouse: true,
        currency: true,
        lines: true,
      },
    });
    return so;
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
  deliver(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') id: string,
    @Body() dto: DeliverSalesOrderDto,
  ) {
    return this.service.deliverOrder(actor, id, dto);
  }

  @Get('orders/:id/delivery-summary')
  @RequirePermissions('sales.order.read')
  async deliverySummary(@Param('id') id: string) {
    const rows = await this.prisma.salesDeliveryLine.groupBy({
      by: ['soLineId'],
      where: {
        soLineId: { not: null },
        delivery: { soId: id },
      },
      _sum: { quantity: true },
    });

    const deliveredBySoLineId: Record<string, string> = {};
    for (const r of rows) {
      if (!r.soLineId) continue;
      deliveredBySoLineId[r.soLineId] = String(r._sum.quantity ?? '0');
    }

    return { ok: true, soId: id, deliveredBySoLineId };
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
  postInvoice(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') id: string,
    @Body() dto: PostingOverrideDto,
  ) {
    return this.service.postInvoice(actor, id, dto.reason);
  }

  @Post('invoice-notes')
  @RequirePermissions('sales.invoice.manage')
  createInvoiceNote(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateInvoiceNoteDto) {
    return this.service.createInvoiceNote(actor, dto);
  }

  @Get('deliveries')
  @RequirePermissions('sales.order.read')
  listDeliveries() {
    return this.prisma.salesDelivery.findMany({
      orderBy: { createdAt: 'desc' },
      include: { warehouse: true, lines: true },
      take: 100,
    });
  }

  @Get('deliveries/:id')
  @RequirePermissions('sales.order.read')
  getDelivery(@Param('id') id: string) {
    return this.service.getDelivery(id);
  }

  // return against delivery
  @Post('deliveries/:id/return')
  @RequirePermissions('sales.order.deliver')
  createReturn(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') deliveryId: string,
    @Body() dto: CreateSalesReturnDto,
  ) {
    return this.service.createSalesReturn(actor, deliveryId, dto);
  }

  @Post('deliveries/:id/backfill-cost')
  @RequirePermissions('sales.delivery.cost.backfill')
  backfillDeliveryCost(@CurrentUser() actor: JwtAccessPayload, @Param('id') deliveryId: string) {
    return this.service.backfillDeliveryCostSnapshot(actor, deliveryId);
  }

  @Get('returns')
  @RequirePermissions('sales.order.read')
  listReturns() {
    return this.prisma.salesReturn.findMany({
      orderBy: { createdAt: 'desc' },
      include: { delivery: true, lines: true, warehouse: true },
      take: 100,
    });
  }

  @Get('returns/:id')
  @RequirePermissions('sales.order.read')
  getReturn(@Param('id') id: string) {
    return this.prisma.salesReturn.findUnique({
      where: { id },
      include: { delivery: true, lines: true, warehouse: true, stockMove: true },
    });
  }

  @Get('invoices/:id')
  @RequirePermissions('sales.invoice.read')
  getInvoice(@Param('id') id: string) {
    return this.prisma.customerInvoice.findUnique({
      where: { id },
      include: { customer: true, currency: true, lines: true },
    });
  }
}
