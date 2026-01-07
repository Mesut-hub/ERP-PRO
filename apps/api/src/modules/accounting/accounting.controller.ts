import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { AccountingService } from './accounting.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { PostingOverrideDto } from '../common/dto/posting-override.dto';
import { ReverseJournalDto } from './dto/reverse-journal.dto';

@Controller('acc')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class AccountingController {
  constructor(private readonly service: AccountingService) {}

  @Get('accounts')
  @RequirePermissions('acc.account.read')
  listAccounts() {
    return this.service.listAccounts();
  }

  @Get('journals')
  @RequirePermissions('acc.journal.read')
  listJournals() {
    return this.service.listJournalEntries();
  }

  // NEW: query by integration source (PurchaseReturn, SupplierInvoice, SalesDelivery, etc.)
  @Get('journals/by-source')
  @RequirePermissions('acc.journal.read')
  listJournalsBySource(@Query('sourceType') sourceType: string, @Query('sourceId') sourceId: string) {
    return this.service.listJournalEntriesBySource(sourceType, sourceId);
  }

  @Post('journals')
  @RequirePermissions('acc.journal.manage')
  create(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateJournalDto) {
    return this.service.createJournal(actor.sub, dto);
  }

  @Post('journals/:id/post')
  @RequirePermissions('acc.journal.post')
  post(@CurrentUser() actor: JwtAccessPayload, @Param('id') id: string, @Body() dto: PostingOverrideDto) {
    return this.service.postJournal(actor, id, dto.reason);
  }

  @Post('journals/:id/reverse')
  @RequirePermissions('acc.journal.post')
  reverse(@CurrentUser() actor: JwtAccessPayload, @Param('id') id: string, @Body() dto: ReverseJournalDto) {
    return this.service.reverseJournal(actor, id, dto);
  }
}