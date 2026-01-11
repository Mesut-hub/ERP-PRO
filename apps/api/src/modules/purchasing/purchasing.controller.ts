import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { PurchasingService } from './purchasing.service';
import { CreatePoDto } from './dto/create-po.dto';
import { ReceivePoDto } from './dto/receive-po.dto';
import { CreateSupplierInvoiceDto } from './dto/create-supplier-invoice.dto';
import { PostingOverrideDto } from '../common/dto/posting-override.dto';
import { CreateSupplierInvoiceNoteDto } from './dto/create-supplier-invoice-note.dto';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';

@Controller('pur')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class PurchasingController {
  constructor(private readonly service: PurchasingService) {}

  @Get('pos')
  @RequirePermissions('pur.po.read')
  listPOs() {
    return this.service.listPOs();
  }

  @Post('pos')
  @RequirePermissions('pur.po.manage')
  createPO(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreatePoDto) {
    return this.service.createPO(actor.sub, dto);
  }

  @Post('pos/:id/approve')
  @RequirePermissions('pur.po.approve')
  approvePO(@CurrentUser() actor: JwtAccessPayload, @Param('id') id: string) {
    return this.service.approvePO(actor.sub, id);
  }

  @Post('pos/:id/receive')
  @RequirePermissions('pur.po.receive')
  receivePO(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') id: string,
    @Body() dto: ReceivePoDto,
  ) {
    return this.service.receivePO(actor, id, dto);
  }

  @Get('invoices')
  @RequirePermissions('pur.invoice.read')
  listInvoices() {
    return this.service.listSupplierInvoices();
  }

  @Post('invoices')
  @RequirePermissions('pur.invoice.manage')
  createInvoice(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateSupplierInvoiceDto) {
    return this.service.createSupplierInvoice(actor.sub, dto);
  }

  @Get('invoices/:id')
  @RequirePermissions('pur.invoice.read')
  getInvoice(@Param('id') id: string) {
    return this.service.getSupplierInvoice(id);
  }

  @Post('invoices/:id/post')
  @RequirePermissions('pur.invoice.post')
  postInvoice(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') id: string,
    @Body() dto: PostingOverrideDto,
  ) {
    return this.service.postSupplierInvoice(actor, id, dto.reason);
  }

  @Post('invoice-notes')
  @RequirePermissions('pur.invoice.manage')
  createInvoiceNote(
    @CurrentUser() actor: JwtAccessPayload,
    @Body() dto: CreateSupplierInvoiceNoteDto,
  ) {
    return this.service.createSupplierInvoiceNote(actor, dto);
  }

  @Get('receipts/:id')
  @RequirePermissions('pur.po.read')
  getReceipt(@Param('id') id: string) {
    return this.service.getReceipt(id);
  }

  @Post('receipts/:id/return')
  @RequirePermissions('pur.po.receive')
  createReturn(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') receiptId: string,
    @Body() dto: CreatePurchaseReturnDto,
  ) {
    return this.service.createPurchaseReturn(actor, receiptId, dto);
  }

  @Get('returns/:id')
  @RequirePermissions('pur.po.read')
  getReturn(@Param('id') id: string) {
    return this.service.getPurchaseReturn(id);
  }
}
