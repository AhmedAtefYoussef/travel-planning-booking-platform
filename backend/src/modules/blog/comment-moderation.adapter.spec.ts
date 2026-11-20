import { Types } from 'mongoose';
import {
  ModeratableContentType,
  type ContentModeration,
} from '../../common/contracts';
import { CommentModerationAdapter } from './comment-moderation.adapter';
import { PostStatus } from './schemas/post.schema';

const ID = new Types.ObjectId();
const POST = new Types.ObjectId();
const AUTHOR = new Types.ObjectId();
const SESSION = {} as never;

const chain = (value: unknown) => ({
  session: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

function setup(
  comment: unknown = null,
  post: unknown = { status: PostStatus.Published, isHidden: false },
) {
  const comments = {
    findById: jest.fn(() => chain(comment)),
    updateOne: jest.fn(() => chain({ modifiedCount: 1 })),
    findOneAndDelete: jest.fn(() => chain({ _id: ID, postId: POST })),
  };
  const posts = {
    findById: jest.fn(() => chain(post)),
    updateOne: jest.fn(() => chain({ modifiedCount: 1 })),
  };
  const registry: jest.Mocked<ContentModeration> = {
    register: jest.fn(),
    get: jest.fn(),
  };
  const adapter = new CommentModerationAdapter(
    comments as never,
    posts as never,
    registry,
  );
  return { adapter, comments, posts, registry };
}

const stored = (isHidden = false) => ({
  _id: ID,
  postId: POST,
  authorId: AUTHOR,
  isHidden,
});

describe('CommentModerationAdapter: GEN-09, GEN-10 comments as moderatable content', () => {
  it('registers itself for COMMENT at start-up', () => {
    const { adapter, registry } = setup();
    adapter.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(adapter);
    expect(adapter.type).toBe(ModeratableContentType.Comment);
  });

  it('starts without a moderation module', () => {
    const adapter = new CommentModerationAdapter({} as never, {} as never);
    expect(() => adapter.onModuleInit()).not.toThrow();
  });

  it.each([
    ['a published visible post', { status: PostStatus.Published }, true],
    ['a draft post', { status: PostStatus.Draft }, false],
    ['a hidden post', { status: PostStatus.Published, isHidden: true }, false],
    ['a deleted post', null, false],
  ])('a comment under %s is public: %s', async (_, post, isPublic) => {
    const { adapter } = setup(stored(), post);
    await expect(adapter.find(ID.toHexString())).resolves.toEqual({
      id: ID.toHexString(),
      authorId: AUTHOR.toHexString(),
      isHidden: false,
      isPublic,
    });
  });

  it('answers null/false for an unknown or malformed id without a CastError', async () => {
    const { adapter, comments, posts } = setup(null);
    await expect(adapter.find(ID.toHexString())).resolves.toBeNull();
    expect(posts.findById).not.toHaveBeenCalled();
    await expect(adapter.find('nope')).resolves.toBeNull();
    await expect(adapter.setHidden('nope', true, SESSION)).resolves.toBe(false);
    await expect(adapter.remove('nope', SESSION)).resolves.toBeNull();
    expect(comments.updateOne).not.toHaveBeenCalled();
    expect(comments.findOneAndDelete).not.toHaveBeenCalled();
  });

  it('hides only a visible comment, in the caller session', async () => {
    const { adapter, comments } = setup();
    await expect(
      adapter.setHidden(ID.toHexString(), true, SESSION),
    ).resolves.toBe(true);
    expect(comments.updateOne).toHaveBeenCalledWith(
      { _id: ID.toHexString(), isHidden: { $ne: true } },
      { $set: { isHidden: true } },
      { session: SESSION },
    );
  });

  it('answers false when the comment already had that state', async () => {
    const { adapter, comments } = setup();
    comments.updateOne.mockReturnValueOnce(chain({ modifiedCount: 0 }));
    await expect(
      adapter.setHidden(ID.toHexString(), false, SESSION),
    ).resolves.toBe(false);
  });

  it("removes the comment and lowers its post's counters in the same session", async () => {
    const { adapter, posts } = setup();
    const removed = await adapter.remove(ID.toHexString(), SESSION);
    expect(posts.updateOne).toHaveBeenCalledWith(
      { _id: POST, commentCount: { $gte: 1 } },
      { $inc: { commentCount: -1, interactionScore: -1 } },
      { session: SESSION, runValidators: true },
    );
    await expect(removed!.afterCommit()).resolves.toBeUndefined();
  });

  it('answers null when the comment was already gone', async () => {
    const { adapter, comments, posts } = setup();
    comments.findOneAndDelete.mockReturnValueOnce(chain(null));
    await expect(adapter.remove(ID.toHexString(), SESSION)).resolves.toBeNull();
    expect(posts.updateOne).not.toHaveBeenCalled();
  });
});
