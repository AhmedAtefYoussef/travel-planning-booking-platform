/** Contract 8 - uploads (Ahmed -> everyone). Interface only. */

/** Structural subset of Express.Multer.File, so no multer types needed. */
export interface UploadedImageFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface SaveImagesOptions {
  /** Maximum number of files accepted in this call. */
  max: number;
}

export interface StoredImage {
  id: string;
  /** Public URL path, e.g. /uploads/<id>.jpg */
  url: string;
  mimetype: string;
  size: number;
}

export interface UploadsService {
  /** Validates type/size/count and stores files under UPLOAD_DIR. */
  saveImages(
    files: UploadedImageFile[],
    options: SaveImagesOptions,
  ): Promise<StoredImage[]>;

  deleteImage(id: string): Promise<void>;
}
