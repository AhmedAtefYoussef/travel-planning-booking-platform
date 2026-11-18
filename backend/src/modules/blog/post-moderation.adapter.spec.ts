import { Types } from 'mongoose';
import {
  ModeratableContentType,
  type ContentModeration,
} from '../../common/contracts';
import { PostModerationAdapter } from './post-moderation.adapter';
import { PostStatus } from './schemas/post.schema';

const ID = new Types.ObjectId();
const AUTHOR = new Types.ObjectId();
const SESSION = {} as never;

const chain = (value: unknown) => ({
  session: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

function setup(found: unknown = null) {
  const posts = {
    findById: jest.fn(() => chain(found)),
    updateOne: jest.fn(() => chain({ modifiedCount: 1 })),
    findOneAndDelete: jest.fn(() =>
      chain({ _id: ID, images: ['/uploads/posts/a.jpg'] }),
    ),
  };
  const comments = { deleteMany: jest.fn(() => chain({})) };
  const likes = { deleteMany: jest.fn(() => chain({})) };
  const uploads = { deleteImage: jest.fn().mockResolvedValue(undefined) };
  const registry: jest.Mocked<ContentModeration> = {
    register: jest.fn(),
    get: jest.fn(),
  };
  const adapter = new PostModerationAdapter(
    posts as never,
    comments as never,
    likes as never,
    uploads as never,
    registry,
  );
  return { adapter, posts, comments, likes, uploads, registry };
}

describe('PostModerationAdapter: GEN-09, GEN-10 posts as moderatable content', () => {
  it('registers itself for POST at start-up', () => {
    const { adapter, registry } = setup();
    adapter.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(adapter);
    expect(adapter.type).toBe(ModeratableContentType.Post);
  });

  it('starts without a moderation module', () => {
    const adapter = new PostModerationAdapter(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(() => adapter.onModuleInit()).not.toThrow();
  });

  it.each([
    [PostStatus.Published, true],
    [PostStatus.Draft, false],
  ])('describes a %s post as public: %s', async (status, isPublic) => {
    const { adapter } = setup({
      _id: ID,
      authorId: AUTHOR,
      status,
      isHidden: false,
    });
    await expect(adapter.find(ID.toHexString())).resolves.toEqual({
      id: ID.toHexString(),
      authorId: AUTHOR.toHexString(),
      isHidden: false,
      isPublic,
    });
  });

  it('answers null/false for an unknown or malformed id without a CastError', async () => {
    const { adapter, posts } = setup(null);
    await expect(adapter.find(ID.toHexString())).resolves.toBeNull();
    await expect(adapter.find('nope')).resolves.toBeNull();
    await expect(adapter.setHidden('nope', true, SESSION)).resolves.toBe(false);
    await expect(adapter.remove('nope', SESSION)).resolves.toBeNull();
    expect(posts.updateOne).not.toHaveBeenCalled();
    expect(posts.findOneAndDelete).not.toHaveBeenCalled();
  });

  it('unhides only a hidden post, in the caller session', async () => {
    const { adapter, posts } = setup();
    await expect(
      adapter.setHidden(ID.toHexString(), false, SESSION),
    ).resolves.toBe(true);
    expect(posts.updateOne).toHaveBeenCalledWith(
      { _id: ID.toHexString(), isHidden: true },
      { $set: { isHidden: false } },
      { session: SESSION },
    );
  });

  it('removes the post with its comments and likes, and its images only after commit', async () => {
    const { adapter, comments, likes, uploads } = setup();
    const removed = await adapter.remove(ID.toHexString(), SESSION);
    expect(comments.deleteMany).toHaveBeenCalledWith(
      { postId: ID.toHexString() },
      { session: SESSION },
    );
    expect(likes.deleteMany).toHaveBeenCalled();
    expect(uploads.deleteImage).not.toHaveBeenCalled();
    await removed!.afterCommit();
    expect(uploads.deleteImage).toHaveBeenCalledWith('/uploads/posts/a.jpg');
  });

  it('answers null when the post was already gone', async () => {
    const { adapter, posts, comments } = setup();
    posts.findOneAndDelete.mockReturnValueOnce(chain(null));
    await expect(adapter.remove(ID.toHexString(), SESSION)).resolves.toBeNull();
    expect(comments.deleteMany).not.toHaveBeenCalled();
  });
});
