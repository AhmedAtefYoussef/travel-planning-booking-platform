import { Types, type Model } from 'mongoose';
import { AuthUser, ProviderType, Role } from '../../common/auth/auth.types';
import type { UploadedFileLike } from '../../common/contracts/services.contract';
import { AirlinesService } from './airlines.service';
import type { Airline } from './schemas/airline.schema';

const airlineId = new Types.ObjectId();
const id = airlineId.toHexString();
const OLD = '/uploads/airlines/00000001-0000-4000-8000-000000000000.png';
const NEW = '/uploads/airlines/00000002-0000-4000-8000-000000000000.png';

function fakeAirline(logoUrl: string | null) {
  return {
    _id: airlineId,
    id,
    name: 'EgyptAir',
    code: 'MS',
    logoUrl,
    isActive: true,
    policy: { cancellationTiers: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const file: UploadedFileLike = {
  originalname: 'logo.png',
  mimetype: 'image/png',
  size: 8,
  buffer: Buffer.alloc(8),
};

function setup(
  logoUrl: string | null,
  opts: { previous?: unknown; writeError?: Error; sharedBy?: number } = {},
) {
  const current = fakeAirline(logoUrl);
  const uploads = {
    saveImages: jest.fn(() => Promise.resolve([{ imageId: 'x', url: NEW }])),
    deleteImage: jest.fn(() => Promise.resolve()),
  };
  const model = {
    findById: jest.fn(() => ({ exec: () => Promise.resolve(current) })),
    findOneAndUpdate: jest.fn(() => ({
      exec: () => {
        if (opts.writeError) return Promise.reject(opts.writeError);
        if (opts.previous !== undefined) return Promise.resolve(opts.previous);
        const before = { ...current };
        current.logoUrl = NEW;
        return Promise.resolve(before);
      },
    })),
    exists: jest.fn(() => ({
      exec: () => Promise.resolve(opts.sharedBy ? { _id: 'other' } : null),
    })),
  };
  const service = new AirlinesService(
    model as unknown as Model<Airline>,
    uploads,
    {} as never,
    {} as never,
  );
  return { service, model, uploads };
}

const own: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.AirlineModerator,
  assignedProvider: { type: ProviderType.Airline, providerId: id },
};

describe('AirlinesService.setLogo (GEN-08 / FLT-01)', () => {
  it('stores one logo, swaps it in atomically and deletes the previous local file', async () => {
    const { service, model, uploads } = setup(OLD);
    const dto = await service.setLogo(own, id, [file]);
    expect(uploads.saveImages).toHaveBeenCalledWith([file], {
      entityType: 'AIRLINE_LOGO',
      entityId: id,
      existingCount: 0,
    });
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id },
      { $set: { logoUrl: NEW } },
      { new: false },
    );
    expect(uploads.deleteImage).toHaveBeenCalledWith(OLD);
    expect(dto.logoUrl).toBe(NEW);
  });

  it('leaves an http(s) logo, no logo, or a logo another airline shares alone', async () => {
    for (const [logo, sharedBy] of [
      ['https://cdn.example.com/ms.png', 0],
      [null, 0],
      [OLD, 1],
    ] as const) {
      const { service, uploads } = setup(logo, { sharedBy });
      await service.setLogo(own, id, [file]);
      expect(uploads.deleteImage).not.toHaveBeenCalled();
    }
  });

  it('removes the new file when the airline vanished or the write failed', async () => {
    const gone = setup(OLD, { previous: null });
    await expect(gone.service.setLogo(own, id, [file])).rejects.toMatchObject({
      status: 404,
    });
    expect(gone.uploads.deleteImage).toHaveBeenCalledWith(NEW);

    const failed = setup(OLD, { writeError: new Error('db down') });
    await expect(failed.service.setLogo(own, id, [file])).rejects.toThrow(
      'db down',
    );
    expect(failed.uploads.deleteImage).toHaveBeenCalledWith(NEW);
    expect(failed.uploads.deleteImage).not.toHaveBeenCalledWith(OLD);
  });

  it('another airline moderator gets 403 before anything is saved; admins are allowed', async () => {
    const { service, uploads } = setup(null);
    const stranger: AuthUser = {
      ...own,
      assignedProvider: {
        type: ProviderType.Airline,
        providerId: new Types.ObjectId().toHexString(),
      },
    };
    await expect(service.setLogo(stranger, id, [file])).rejects.toMatchObject({
      status: 403,
    });
    expect(uploads.saveImages).not.toHaveBeenCalled();
    await service.setLogo({ id: 'a', role: Role.Admin }, id, [file]);
    expect(uploads.saveImages).toHaveBeenCalled();
  });
});
