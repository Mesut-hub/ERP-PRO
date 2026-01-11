import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../../common/types/auth.types';
import { ProductCategoriesService } from './product-categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('md/product-categories')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class ProductCategoriesController {
  constructor(private readonly service: ProductCategoriesService) {}

  @Get()
  @RequirePermissions('md.product.read')
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermissions('md.product.manage')
  create(@CurrentUser() actor: JwtAccessPayload, @Body() dto: CreateCategoryDto) {
    return this.service.create(actor.sub, dto);
  }

  @Patch(':id')
  @RequirePermissions('md.product.manage')
  update(
    @CurrentUser() actor: JwtAccessPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.service.update(actor.sub, id, dto);
  }
}
