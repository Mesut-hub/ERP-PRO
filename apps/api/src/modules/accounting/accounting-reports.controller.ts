import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AccountingReportsService } from './accounting-reports.service';
import { LedgerReportQueryDto } from './dto/ledger-report-query.dto';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { GrniReportQueryDto } from './dto/grni-report-query.dto';



@Controller('acc/reports')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class AccountingReportsController {
  constructor(private readonly service: AccountingReportsService) {}

  @Get('ledger')
  @RequirePermissions('acc.journal.read')
  ledger(@Query() q: LedgerReportQueryDto) {
    return this.service.ledger(q);
  }

  @Get('trial-balance')
  @RequirePermissions('acc.journal.read')
  trialBalance(@Query() q: TrialBalanceQueryDto) {
    return this.service.trialBalance(q);
  }

  // ADD endpoint inside controller:
  @Get('grni')
  @RequirePermissions('acc.journal.read')
  grni(@Query() q: GrniReportQueryDto) {
    return this.service.grni(q);
  }
}
