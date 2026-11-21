import { Global, Module } from '@nestjs/common';
import { UPLOADS_SERVICE } from '../../common/contracts';
import { LocalDiskUploadsService } from './local-disk-uploads.service';

/**
 * GEN-08 image uploads. Global so hotels, airlines, blog (BLG-10) and itineraries (ITN-12) inject
 * UPLOADS_SERVICE without importing this module; the files are served from /uploads/ (app.setup.ts).
 */
@Global()
@Module({
  providers: [
    LocalDiskUploadsService,
    { provide: UPLOADS_SERVICE, useExisting: LocalDiskUploadsService },
  ],
  exports: [UPLOADS_SERVICE],
})
export class UploadsModule {}
