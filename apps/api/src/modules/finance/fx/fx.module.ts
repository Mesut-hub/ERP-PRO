import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FxService } from './fx.service';
import { CbrtService } from './cbrt.service';
import { CbrtController } from './cbrt.controller';

@Module({
  imports: [PrismaModule],
  providers: [FxService, CbrtService],
  controllers: [CbrtController],
  exports: [FxService, CbrtService],
})
export class FxModule {}
