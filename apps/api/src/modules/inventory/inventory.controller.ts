import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../common/types/auth.types';
import { InventoryService } from './inventory.service';
import { CreateStockMoveDto } from './dto/create-stock-move.dto';
import { PostStockMoveDto } from './dto/post-stock-move.dto';

@Controller('inv')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get('moves')
  @RequirePermissions('inv.move.read')
  listMoves() {
    return this.service.listMoves();
  }

  @Get('moves/:id')
  @RequirePermissions('inv.move.read')
  getMove(@Param('id') id: string) {
    return this.service.getMove(id);
  }

  @Post('moves')
  @RequirePermissions('inv.move.manage')
  createMove(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateStockMoveDto) {
    return this.service.createMove(actor.sub, dto);
  }

  @Post('moves/:id/post')
  @RequirePermissions('inv.move.post')
  postMove(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') id: string,
    @Body() dto: PostStockMoveDto,
  ) {
    return this.service.postMove(actor, id, dto.notes, dto.reason);
  }

  @Post('moves/:id/cancel')
  @RequirePermissions('inv.move.cancel')
  cancel(@CurrentUser() actor: JwtAccessPayload, @Param('id') id: string) {
    return this.service.cancelMove(actor.sub, id);
  }

  @Post('moves/:id/reverse')
  @RequirePermissions('inv.move.reverse')
  reverse(@CurrentUser() actor: JwtAccessPayload, @Param('id') id: string) {
    return this.service.reverseMove(actor.sub, id);
  }

  @Get('onhand')
  @RequirePermissions('inv.onhand.read')
  onHand(@Query('warehouseId') warehouseId?: string, @Query('productId') productId?: string) {
    return this.service.getOnHand({ warehouseId, productId });
  }

  @Get('reports/stock-valuation')
  @RequirePermissions('inv.onhand.read')
  stockValuation(
    @Query('asOf') asOf?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
    @Query('groupBy') groupBy?: 'product' | 'warehouseProduct' | 'productWarehouse',
  ) {
    return this.service.stockValuation({ asOf, warehouseId, productId, groupBy });
  }

  @Get('reports/stock-valuation/layers')
  @RequirePermissions('inv.onhand.read')
  stockValuationLayers(
    @Query('asOf') asOf?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.service.stockValuationLayers({ asOf, warehouseId, productId });
  }

  @Get('reports/fifo-allocations')
  @RequirePermissions('inv.onhand.read')
  fifoAllocations(
    @Query('issueSourceType') issueSourceType?: string,
    @Query('issueSourceId') issueSourceId?: string,
    @Query('issueSourceLineId') issueSourceLineId?: string,
  ) {
    return this.service.fifoAllocations({ issueSourceType, issueSourceId, issueSourceLineId });
  }
}