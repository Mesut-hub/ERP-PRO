import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FxService } from './fx.service';

@Module({
  imports: [PrismaModule],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}