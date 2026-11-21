import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Page, PAGE_SIZE, toPage } from '../../common/pagination/pagination';
import { PasswordService } from '../../common/security/password.service';
import type {
  DemoItemDto,
  DemoPasswordResultDto,
  DemoUniqueResultDto,
  DemoValidationDto,
  DemoValidationResultDto,
} from './dto/diagnostics.dto';
import { DiagnosticRecord } from './schemas/diagnostic-record.schema';

/** 23 rows: more than two full pages, so page 3 shows a partial page (GEN-05). */
export const DEMO_ROW_COUNT = 23;

@Injectable()
export class DiagnosticsService {
  constructor(
    @InjectModel(DiagnosticRecord.name)
    private readonly records: Model<DiagnosticRecord>,
    private readonly passwords: PasswordService,
  ) {}

  validate(dto: DemoValidationDto): DemoValidationResultDto {
    return { valid: true, passengerCount: dto.passengers.length };
  }

  list(page: number): Page<DemoItemDto> {
    const start = (page - 1) * PAGE_SIZE;
    const items = Array.from(
      { length: Math.max(0, Math.min(PAGE_SIZE, DEMO_ROW_COUNT - start)) },
      (_, i) => ({
        number: start + i + 1,
        label: `Sample row ${start + i + 1}`,
      }),
    );
    return toPage(items, DEMO_ROW_COUNT, page);
  }

  async findRecord(id: string): Promise<DemoUniqueResultDto> {
    const record = await this.records.findById(id).lean().exec();
    if (!record) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Record not found',
      );
    }
    return { id, key: record.key };
  }

  async createRecord(key: string): Promise<DemoUniqueResultDto> {
    const doc = await this.records.create({ key });
    return { id: doc.id as string, key: doc.key };
  }

  async hashDemo(password: string): Promise<DemoPasswordResultDto> {
    const [firstHash, secondHash] = await Promise.all([
      this.passwords.hash(password),
      this.passwords.hash(password),
    ]);
    const [a, b, wrong] = await Promise.all([
      this.passwords.verify(password, firstHash),
      this.passwords.verify(password, secondHash),
      this.passwords.verify(`${password}x`, firstHash),
    ]);
    return {
      firstHash,
      secondHash,
      saltsDiffer: firstHash.slice(7, 29) !== secondHash.slice(7, 29),
      bothVerify: a && b,
      wrongPasswordVerifies: wrong,
      containsPlainText:
        firstHash.includes(password) || secondHash.includes(password),
      workFactor: bcrypt.getRounds(firstHash),
    };
  }
}
