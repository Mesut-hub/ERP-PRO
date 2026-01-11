import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PostingOverrideDto } from '../common/dto/posting-override.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';

@Controller('pay')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get('payments')
  @RequirePermissions('pay.payment.read')
  list() {
    return this.service.list();
  }

  @Post('payments')
  @RequirePermissions('pay.payment.manage')
  create(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreatePaymentDto) {
    return this.service.create(actor, dto);
  }

  @Post('payments/:id/post')
  @RequirePermissions('pay.payment.post')
  post(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') id: string,
    @Body() dto: PostingOverrideDto,
  ) {
    return this.service.post(actor, id, dto.reason);
  }

  @Post('payments/:id/void')
  @RequirePermissions('pay.payment.post')
  void(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') id: string,
    @Body() dto: VoidPaymentDto,
  ) {
    return this.service.voidPayment(actor, id, dto);
  }
}
