import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import { PUBLIC_ITINERARIES } from '../../common/contracts/tokens';
import { UsersService } from '../users';
import type { CreatePostDto } from './dto/post.dto';
import { PostsService } from './posts.service';
import { Post, PostStatus } from './schemas/post.schema';

/** BLG-01: what PostsService.create stores and returns, without a database. */
describe('PostsService.create (BLG-01)', () => {
  const author = { id: new Types.ObjectId().toHexString(), role: Role.User };
  let created: Record<string, unknown> | undefined;
  const posts = {
    create: jest.fn((doc: Record<string, unknown>) => {
      created = doc;
      return Promise.resolve({
        _id: new Types.ObjectId(),
        images: [],
        isHidden: false,
        likeCount: 0,
        commentCount: 0,
        createdAt: new Date('2026-11-17T10:00:00Z'),
        updatedAt: new Date('2026-11-17T10:00:00Z'),
        ...doc,
      });
    }),
  };
  const users = {
    findProfile: jest.fn((id: string) =>
      Promise.resolve(id === author.id ? { name: 'Malak' } : null),
    ),
  };
  let service: PostsService;

  beforeAll(async () => {
    // Any other dependency the service grows (models, uploads) is auto-mocked and unused by create.
    const moduleRef = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: getModelToken(Post.name), useValue: posts },
        { provide: UsersService, useValue: users },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    service = moduleRef.get(PostsService);
  });
  const dto = (extra: Partial<CreatePostDto> = {}): CreatePostDto => ({
    title: 'Three days in Cairo',
    body: 'Museum, then Khan el-Khalili.',
    ...extra,
  });

  beforeEach(() => {
    created = undefined;
    jest.clearAllMocks();
  });

  it('saves a draft with no publishedAt when no status is sent', async () => {
    const post = await service.create(author, dto());
    expect(created).toMatchObject({
      status: PostStatus.Draft,
      publishedAt: null,
      tags: [],
    });
    expect(created?.authorId).toEqual(new Types.ObjectId(author.id));
    expect(post).toMatchObject({
      status: PostStatus.Draft,
      publishedAt: null,
      author: { id: author.id, name: 'Malak' },
    });
  });

  it('stamps publishedAt when the post is published', async () => {
    const before = Date.now();
    const post = await service.create(
      author,
      dto({ status: PostStatus.Published, tags: ['egypt'] }),
    );
    const stamped = created?.publishedAt as Date;
    expect(stamped).toBeInstanceOf(Date);
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
    expect(post).toMatchObject({
      status: PostStatus.Published,
      tags: ['egypt'],
    });
  });

  it('never takes images on create: they are uploaded afterwards (GEN-08)', async () => {
    await service.create(author, dto());
    expect(created).not.toHaveProperty('images');
  });

  it('shows "Deleted user" when the author account no longer exists', async () => {
    const ghost = { id: new Types.ObjectId().toHexString(), role: Role.User };
    const post = await service.create(ghost, dto());
    expect(post.author).toEqual({ id: ghost.id, name: 'Deleted user' });
  });

  it('shows "Deleted user" for a deactivated author (ACC-12)', async () => {
    users.findProfile.mockResolvedValueOnce({
      name: 'Malak',
      status: 'DEACTIVATED',
    } as never);
    const post = await service.create(author, dto());
    expect(post.author).toEqual({ id: author.id, name: 'Deleted user' });
  });
});

/** BLG-13: attaching an itinerary goes through the PUBLIC_ITINERARIES port, without a database. */
describe('PostsService.attachItinerary (BLG-13)', () => {
  const author = { id: new Types.ObjectId().toHexString(), role: Role.User };
  const stranger = { id: new Types.ObjectId().toHexString(), role: Role.User };
  const postId = new Types.ObjectId();
  const itineraryId = new Types.ObjectId().toHexString();
  const stored = {
    _id: postId,
    authorId: new Types.ObjectId(author.id),
    title: 'Cairo',
    body: 'b',
    tags: [],
    images: [],
    status: PostStatus.Published,
    publishedAt: new Date(),
    isHidden: false,
    likeCount: 0,
    commentCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const posts = {
    findById: jest.fn(() => ({
      lean: () => ({ exec: () => Promise.resolve(stored) }),
    })),
    findOneAndUpdate: jest.fn(
      (_filter: unknown, update: { $set: { itineraryId: unknown } }) => ({
        exec: () =>
          Promise.resolve({ ...stored, itineraryId: update.$set.itineraryId }),
      }),
    ),
  };
  const itineraries = {
    attachable: jest.fn(),
    summaries: jest.fn(),
  };
  let service: PostsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: getModelToken(Post.name), useValue: posts },
        {
          provide: UsersService,
          useValue: { findProfile: () => Promise.resolve({ name: 'Malak' }) },
        },
        { provide: PUBLIC_ITINERARIES, useValue: itineraries },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    service = moduleRef.get(PostsService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    itineraries.summaries.mockResolvedValue(new Map());
  });

  it('stores the itinerary id when the author may attach it', async () => {
    itineraries.attachable.mockResolvedValue(true);
    const post = await service.attachItinerary(author, postId.toHexString(), {
      itineraryId,
    });
    expect(itineraries.attachable).toHaveBeenCalledWith(author.id, itineraryId);
    expect(post.itineraryId).toBe(itineraryId);
    expect(post.itinerary).toBeUndefined();
  });

  it('embeds the summary the port returns for a public itinerary', async () => {
    itineraries.attachable.mockResolvedValue(true);
    const summary = {
      id: itineraryId,
      title: 'Nile trip',
      countries: ['EG'],
      startDate: '2027-03-01',
      days: 3,
    };
    itineraries.summaries.mockResolvedValue(new Map([[itineraryId, summary]]));
    const post = await service.attachItinerary(author, postId.toHexString(), {
      itineraryId,
    });
    expect(post.itinerary).toEqual(summary);
  });

  it('answers 404 and stores nothing when the itinerary is not attachable', async () => {
    itineraries.attachable.mockResolvedValue(false);
    await expect(
      service.attachItinerary(author, postId.toHexString(), { itineraryId }),
    ).rejects.toMatchObject({ status: 404 });
    expect(posts.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('detaches with null without asking the port', async () => {
    const post = await service.attachItinerary(author, postId.toHexString(), {
      itineraryId: null,
    });
    expect(itineraries.attachable).not.toHaveBeenCalled();
    expect(post.itineraryId).toBeNull();
  });

  it("refuses another user's published post with 403", async () => {
    await expect(
      service.attachItinerary(stranger, postId.toHexString(), { itineraryId }),
    ).rejects.toMatchObject({ status: 403 });
    expect(posts.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
