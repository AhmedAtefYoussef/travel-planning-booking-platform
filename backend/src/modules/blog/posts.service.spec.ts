import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import type { UsersService } from '../users';
import type { CreatePostDto } from './dto/post.dto';
import { PostsService } from './posts.service';
import { PostStatus } from './schemas/post.schema';

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
  const service = new PostsService(
    posts as never,
    users as unknown as UsersService,
  );
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
});
