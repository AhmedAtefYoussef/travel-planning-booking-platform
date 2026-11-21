import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { UPLOADS_SERVICE } from '../../common/contracts';
import { LocalDiskUploadsService } from './local-disk-uploads.service';
import { UploadsModule } from './uploads.module';

describe('UploadsModule (GEN-08)', () => {
  it('provides UPLOADS_SERVICE as the local-disk implementation', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ UPLOAD_DIR: './uploads-unit' })],
        }),
        UploadsModule,
      ],
    }).compile();
    const service = moduleRef.get(UPLOADS_SERVICE);
    expect(service).toBeInstanceOf(LocalDiskUploadsService);
    expect(service).toBe(moduleRef.get(LocalDiskUploadsService));
  });
});
