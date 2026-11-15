import { ValidateBy, ValidationOptions, isURL } from 'class-validator';

/** Public folders under /uploads/ (GEN-08), one per kind of entity that has images. */
export type UploadFolder = 'posts' | 'activities' | 'hotels' | 'airlines';

const UUID_V4 =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/**
 * The only shape a stored upload URL can take: /uploads/<folder>/<uuid v4>.<jpg|png>. Nothing else
 * (no "..", no query, no other extension) ever matches, so a matching URL maps to exactly one file.
 */
export function localUploadUrlPattern(
  folders: readonly UploadFolder[],
): RegExp {
  return new RegExp(
    `^/uploads/(${folders.join('|')})/(${UUID_V4})\\.(jpg|png)$`,
  );
}

const HTTP_URL = {
  protocols: ['http', 'https'],
  require_protocol: true,
  require_tld: false,
};

/**
 * An image link: an http(s) URL, or a file this backend stored for `folder` (GEN-08). Used by the
 * hotel photos (HTL-01) and the airline logo (FLT-01) so the URLs the upload endpoints return can be
 * sent back in a PATCH (e.g. to reorder photos).
 */
export function IsImageUrl(
  folder: UploadFolder,
  options?: ValidationOptions,
): PropertyDecorator {
  const local = localUploadUrlPattern([folder]);
  return ValidateBy(
    {
      name: 'isImageUrl',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          (local.test(value) || isURL(value, HTTP_URL)),
      },
    },
    options,
  );
}
