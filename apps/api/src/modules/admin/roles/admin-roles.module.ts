import { Module } from '@nestjs/common';
import { AdminRolesService } from './admin-roles.service';
import { AdminRolesController } from './admin-roles.controller';

@Module({
  providers: [AdminRolesService],
  controllers: [AdminRolesController],
})
export class AdminRolesModule {}
