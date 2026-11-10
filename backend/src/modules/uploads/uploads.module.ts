import { Global, Module } from '@nestjs/common';
import { UPLOADS_SERVICE } from '../../common/contracts';
import { ImageUploadsService } from './uploads.service';

/**
 * Uploads (GEN-08): validates and stores JPG/PNG images for every module that attaches media.
 * Global so blog, itineraries, hotels and flights can inject UPLOADS_SERVICE without importing this
 * module (docs/architecture/contracts.md). The owning module keeps the URLs on its own documents and
 * exposes its own endpoints (for example PUT /api/airlines/:id/logo).
 */
@Global()
@Module({
  providers: [
    ImageUploadsService,
    { provide: UPLOADS_SERVICE, useExisting: ImageUploadsService },
  ],
  exports: [UPLOADS_SERVICE, ImageUploadsService],
})
export class UploadsModule {}
