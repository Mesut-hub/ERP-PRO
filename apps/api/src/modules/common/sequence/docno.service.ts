import { Injectable } from '@nestjs/common';
import { SequenceService } from './sequence.service';
import { buildDocNo } from './docno';

@Injectable()
export class DocNoService {
  constructor(private readonly seq: SequenceService) {}

  async allocate(code: string, documentDate: Date) {
    const n = await this.seq.next(code, documentDate, 'DAY');
    return buildDocNo(code, documentDate, n);
  }
}
