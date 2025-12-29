import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../../common/types/auth.types';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('md/products')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @RequirePermissions('md.product.read')
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermissions('md.product.manage')
  create(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateProductDto) {
    return this.service.create(actor.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('md.product.manage')
  update(@CurrentUser() actor: JwtAccessPayload, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.service.update(actor.sub, id, dto);
  }
}