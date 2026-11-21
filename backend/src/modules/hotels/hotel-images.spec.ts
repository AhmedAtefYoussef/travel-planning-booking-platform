import { Types, type Model } from 'mongoose';
import { AuthUser, ProviderType, Role } from '../../common/auth/auth.types';
import type {
  ReferenceService,
  StoredImage,
  UploadedFileLike,
} from '../../common/contracts/services.contract';
import { HotelsService } from './hotels.service';
import type { Hotel } from './schemas/hotel.schema';

const hotelId = new Types.ObjectId();
const id = hotelId.toHexString();
const IMG = (n: number) =>
  `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const urlOf = (n: number) => `/uploads/hotels/${IMG(n)}.png`;

function fakeHotel(photos: string[] = [], isActive = true) {
  return {
    _id: hotelId,
    id,
    name: 'Nile View Hotel',
    address: '12 Corniche El Nil',
    cityId: 'cairo',
    countryCode: 'EG',
    description: '',
    photos,
    starClass: undefined,
    amenities: [] as string[],
    isActive,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const file: UploadedFileLike = {
  originalname: 'a.png',
  mimetype: 'image/png',
  size: 8,
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

function setup(
  stored: ReturnType<typeof fakeHotel> | null,
  opts: { writeResult?: unknown; writeError?: Error; sharedBy?: number } = {},
) {
  let seq = 10;
  const uploads = {
    saveImages: jest.fn((files: UploadedFileLike[]): Promise<StoredImage[]> =>
      Promise.resolve(
        files.map(() => {
          seq += 1;
          return { imageId: IMG(seq), url: urlOf(seq) };
        }),
      ),
    ),
    deleteImage: jest.fn(() => Promise.resolve()),
  };
  const model = {
    findById: jest.fn(() => ({ exec: () => Promise.resolve(stored) })),
    findOneAndUpdate: jest.fn(
      (
        _filter: unknown,
        update: {
          $push?: { photos: { $each: string[] } };
          $pull?: { photos: string };
        },
      ) => ({
        exec: () => {
          if (opts.writeError) return Promise.reject(opts.writeError);
          if (opts.writeResult !== undefined)
            return Promise.resolve(opts.writeResult);
          if (!stored) return Promise.resolve(null);
          if (update.$push) stored.photos.push(...update.$push.photos.$each);
          if (update.$pull)
            stored.photos = stored.photos.filter(
              (p) => p !== update.$pull?.photos,
            );
          return Promise.resolve(stored);
        },
      }),
    ),
    exists: jest.fn(() => ({
      exec: () => Promise.resolve(opts.sharedBy ? { _id: 'other' } : null),
    })),
  };
  const service = new HotelsService(
    model as unknown as Model<Hotel>,
    {} as ReferenceService,
    uploads,
    {} as never,
    {} as never,
  );
  return { service, model, uploads };
}

const own: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.HotelModerator,
  assignedProvider: { type: ProviderType.Hotel, providerId: id },
};
const admin: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.Admin,
};

describe('HotelsService images (GEN-08 / HTL-01)', () => {
  it('saves with the current count, then pushes only while the hotel still has room', async () => {
    const hotel = fakeHotel([urlOf(1), urlOf(2), urlOf(3)]);
    const { service, model, uploads } = setup(hotel);
    const dto = await service.addImages(own, id, [file, file]);
    expect(uploads.saveImages).toHaveBeenCalledWith([file, file], {
      entityType: 'HOTEL',
      entityId: id,
      existingCount: 3,
    });
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: id,
        isActive: true,
        $expr: { $lte: [{ $size: '$photos' }, 3] },
      },
      { $push: { photos: { $each: [urlOf(11), urlOf(12)] } } },
      { new: true },
    );
    expect(dto.photos).toHaveLength(5);
  });

  it('when a concurrent upload took the room, deletes the saved files and returns 400', async () => {
    const { service, uploads } = setup(fakeHotel([urlOf(1)]), {
      writeResult: null,
    });
    await expect(
      service.addImages(own, id, [file, file]),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'images', message: expect.any(String) }],
    });
    expect(uploads.deleteImage.mock.calls).toEqual([[urlOf(11)], [urlOf(12)]]);
  });

  it('deletes the saved files when the database write fails', async () => {
    const { service, uploads } = setup(fakeHotel(), {
      writeError: new Error('db down'),
    });
    await expect(service.addImages(own, id, [file])).rejects.toThrow('db down');
    expect(uploads.deleteImage).toHaveBeenCalledWith(urlOf(11));
  });

  it('checks the scope before saving anything; admins may upload to any hotel', async () => {
    const { service, uploads } = setup(fakeHotel());
    const stranger: AuthUser = {
      ...own,
      assignedProvider: {
        type: ProviderType.Hotel,
        providerId: new Types.ObjectId().toHexString(),
      },
    };
    await expect(service.addImages(stranger, id, [file])).rejects.toMatchObject(
      { status: 403 },
    );
    expect(uploads.saveImages).not.toHaveBeenCalled();

    const { service: asAdmin, model } = setup(fakeHotel([], false));
    await asAdmin.addImages(admin, id, [file]);
    expect(model.findOneAndUpdate.mock.calls[0][0]).not.toHaveProperty(
      'isActive',
    );
  });

  it('a moderator cannot upload to a deactivated hotel (ACC-15)', async () => {
    const { service, uploads } = setup(fakeHotel([], false));
    await expect(service.addImages(own, id, [file])).rejects.toMatchObject({
      status: 403,
    });
    expect(uploads.saveImages).not.toHaveBeenCalled();
  });

  it('removes one image from photos and from disk', async () => {
    const hotel = fakeHotel([
      urlOf(1),
      'https://cdn.example.com/x.jpg',
      urlOf(2),
    ]);
    const { service, uploads } = setup(hotel);
    const dto = await service.removeImage(own, id, IMG(1));
    expect(dto.photos).toEqual(['https://cdn.example.com/x.jpg', urlOf(2)]);
    expect(uploads.deleteImage).toHaveBeenCalledWith(urlOf(1));
  });

  it('keeps the file while another hotel still lists it', async () => {
    const { service, uploads } = setup(fakeHotel([urlOf(1)]), {
      sharedBy: 1,
    });
    await service.removeImage(own, id, IMG(1));
    expect(uploads.deleteImage).not.toHaveBeenCalled();
  });

  it('400 for a malformed image id, 404 for one the hotel does not have', async () => {
    const { service, uploads } = setup(fakeHotel([urlOf(1)]));
    await expect(
      service.removeImage(own, id, '../../etc/passwd'),
    ).rejects.toMatchObject({
      status: 400,
      fieldErrors: [{ field: 'imageId', message: expect.any(String) }],
    });
    await expect(service.removeImage(own, id, IMG(9))).rejects.toMatchObject({
      status: 404,
    });
    expect(uploads.deleteImage).not.toHaveBeenCalled();
  });

  it('404 when a concurrent request removed the image first', async () => {
    const { service, uploads } = setup(fakeHotel([urlOf(1)]), {
      writeResult: null,
    });
    await expect(service.removeImage(own, id, IMG(1))).rejects.toMatchObject({
      status: 404,
    });
    expect(uploads.deleteImage).not.toHaveBeenCalled();
  });
});
