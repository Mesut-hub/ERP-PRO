import { Module } from '@nestjs/common';
import { SequenceService } from './sequence.service';
import { DocNoService } from './docno.service';

@Module({
  providers: [SequenceService, DocNoService],
  exports: [SequenceService, DocNoService],
})
export class SequenceModule {}