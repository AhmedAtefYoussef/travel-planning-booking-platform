import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Role } from '../../common/auth/auth.types';
import { AccountStatus, UsersService } from '../users';
import { CommentsService } from './comments.service';
import { PostsService } from './posts.service';
import { Comment } from './schemas/comment.schema';
import { Post } from './schemas/post.schema';

/** A Mongoose query that resolves to `value` whether it is awaited through lean() or exec(). */
const q = <T>(value: T) => {
  const query = {
    sort: () => query,
    skip: () => query,
    limit: () => query,
    lean: () => query,
    exec: () => Promise.resolve(value),
  };
  return query;
};

/** BLG-05 / BLG-07 / ACC-12: the comment rules, without a database. */
describe('CommentsService (BLG-05, BLG-07, ACC-12)', () => {
  const reader = { id: new Types.ObjectId().toHexString(), role: Role.User };
  const authorId = new Types.ObjectId();
  const postId = new Types.ObjectId();
  const stored = (body: string, by = new Types.ObjectId()) => ({
    _id: new Types.ObjectId(),
    postId,
    authorId: by,
    body,
    createdAt: new Date('2026-11-18T10:00:00Z'),
    updatedAt: new Date('2026-11-18T10:00:00Z'),
  });

  const posts = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const comments = {
    find: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
  };
  const connection = {
    transaction: jest.fn((fn: (session: string) => Promise<unknown>) =>
      fn('session'),
    ),
  };
  const users = { findProfile: jest.fn() };
  const postsService = { authorsOf: jest.fn() };
  let service: CommentsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: getModelToken(Post.name), useValue: posts },
        { provide: getModelToken(Comment.name), useValue: comments },
        { provide: getConnectionToken(), useValue: connection },
        { provide: UsersService, useValue: users },
        { provide: PostsService, useValue: postsService },
      ],
    }).compile();
    service = moduleRef.get(CommentsService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    posts.findOne.mockReturnValue(q({ _id: postId, authorId }));
    users.findProfile.mockResolvedValue({ status: AccountStatus.Active });
    postsService.authorsOf.mockResolvedValue(new Map());
  });

  it('BLG-05 lists a public post’s comments, oldest first, with "Deleted user" for an unknown author', async () => {
    const first = stored('first');
    comments.find.mockReturnValue(q([first]));
    comments.countDocuments.mockReturnValue(q(1));
    const page = await service.list(postId.toHexString(), 1);
    expect(page.items).toEqual([
      expect.objectContaining({
        id: first._id.toHexString(),
        body: 'first',
        author: { id: first.authorId.toHexString(), name: 'Deleted user' },
      }),
    ]);
    expect(page.total).toBe(1);
  });

  it('BLG-05 a missing, draft or hidden post is 404 for listing and adding', async () => {
    posts.findOne.mockReturnValue(q(null));
    await expect(service.list(postId.toHexString(), 1)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.add(reader, postId.toHexString(), 'hi'),
    ).rejects.toMatchObject({ status: 404 });
    expect(connection.transaction).not.toHaveBeenCalled();
  });

  it("ACC-12 a deactivated author's post is 404 for listing and adding", async () => {
    users.findProfile.mockResolvedValue({ status: AccountStatus.Deactivated });
    await expect(service.list(postId.toHexString(), 1)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.add(reader, postId.toHexString(), 'hi'),
    ).rejects.toMatchObject({ status: 404 });
    expect(users.findProfile).toHaveBeenCalledWith(authorId.toHexString());
    expect(connection.transaction).not.toHaveBeenCalled();
  });

  it('BLG-05 adds a comment and counts it in the same transaction', async () => {
    const mine = stored('Great tips', new Types.ObjectId(reader.id));
    posts.findOneAndUpdate.mockReturnValue(q({ _id: postId }));
    comments.create.mockResolvedValue([mine]);
    postsService.authorsOf.mockResolvedValue(
      new Map([[reader.id, { id: reader.id, name: 'Reader' }]]),
    );
    const dto = await service.add(reader, postId.toHexString(), 'Great tips');
    expect(posts.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: postId.toHexString() }),
      { $inc: { commentCount: 1, interactionScore: 1 } },
      { session: 'session' },
    );
    expect(dto).toMatchObject({
      body: 'Great tips',
      author: { id: reader.id, name: 'Reader' },
    });
  });

  it('BLG-05 a post that stops being public before the update is still 404', async () => {
    posts.findOneAndUpdate.mockReturnValue(q(null));
    await expect(
      service.add(reader, postId.toHexString(), 'late'),
    ).rejects.toMatchObject({ status: 404 });
    expect(comments.create).not.toHaveBeenCalled();
  });

  it('BLG-07 the author edits their comment; anyone else is 403 and a missing comment 404', async () => {
    const mine = stored('old', new Types.ObjectId(reader.id));
    comments.findById.mockReturnValue(q(mine));
    comments.findOneAndUpdate.mockReturnValue(q({ ...mine, body: 'new' }));
    const dto = await service.update(reader, mine._id.toHexString(), 'new');
    expect(dto.body).toBe('new');
    expect(comments.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: mine._id, authorId: mine.authorId },
      { $set: { body: 'new' } },
      { new: true, runValidators: true },
    );

    const theirs = stored('theirs');
    comments.findById.mockReturnValue(q(theirs));
    await expect(
      service.update(reader, theirs._id.toHexString(), 'x'),
    ).rejects.toMatchObject({ status: 403 });

    comments.findById.mockReturnValue(q(null));
    await expect(
      service.update(reader, theirs._id.toHexString(), 'x'),
    ).rejects.toMatchObject({ status: 404 });

    comments.findById.mockReturnValue(q(mine));
    comments.findOneAndUpdate.mockReturnValue(q(null));
    await expect(
      service.update(reader, mine._id.toHexString(), 'gone'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("BLG-07 the author deletes their comment and the post's count goes down in the same transaction", async () => {
    const mine = stored('bye', new Types.ObjectId(reader.id));
    comments.findById.mockReturnValue(q(mine));
    comments.deleteOne.mockReturnValue(q({ deletedCount: 1 }));
    posts.updateOne.mockReturnValue(q({ modifiedCount: 1 }));
    await service.remove(reader, mine._id.toHexString());
    expect(posts.updateOne).toHaveBeenCalledWith(
      { _id: postId, commentCount: { $gte: 1 } },
      { $inc: { commentCount: -1, interactionScore: -1 } },
      { session: 'session', runValidators: true },
    );

    comments.deleteOne.mockReturnValue(q({ deletedCount: 0 }));
    posts.updateOne.mockClear();
    await expect(
      service.remove(reader, mine._id.toHexString()),
    ).rejects.toMatchObject({ status: 404 });
    expect(posts.updateOne).not.toHaveBeenCalled();
  });
});
