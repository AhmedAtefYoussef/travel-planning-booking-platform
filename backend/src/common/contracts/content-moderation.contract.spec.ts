import { Types } from 'mongoose';
import { Role, type AuthUser } from '../auth/auth.types';
import {
  CONTENT_MODERATION_REGISTRY,
  ModeratableContentType,
  visibilityFilter,
} from './index';

const ownerId = new Types.ObjectId().toHexString();

describe('content moderation port (GEN-10)', () => {
  it('exports the content types and the registry token', () => {
    expect(Object.values(ModeratableContentType).sort()).toEqual(
      ['COMMENT', 'ITINERARY', 'POST', 'REVIEW'].sort(),
    );
    expect(typeof CONTENT_MODERATION_REGISTRY).toBe('symbol');
  });

  describe('visibilityFilter: hidden content is visible only to its author and admins', () => {
    it('shows a guest only content that is not hidden', () => {
      expect(visibilityFilter(null)).toEqual({ hidden: { $ne: true } });
    });

    it('adds the viewer’s own hidden content for a signed-in non-admin', () => {
      const viewer: AuthUser = { id: ownerId, role: Role.User };
      expect(visibilityFilter(viewer)).toEqual({
        $or: [
          { hidden: { $ne: true } },
          { authorId: new Types.ObjectId(ownerId) },
        ],
      });
    });

    it('treats moderators like any other non-admin viewer', () => {
      const viewer: AuthUser = { id: ownerId, role: Role.HotelModerator };
      expect(visibilityFilter(viewer, 'ownerId')).toEqual({
        $or: [
          { hidden: { $ne: true } },
          { ownerId: new Types.ObjectId(ownerId) },
        ],
      });
    });

    it('applies no filter for an admin', () => {
      expect(visibilityFilter({ id: ownerId, role: Role.Admin })).toEqual({});
    });

    it('falls back to the guest filter when the viewer id is not an ObjectId', () => {
      expect(visibilityFilter({ id: 'not-an-id', role: Role.User })).toEqual({
        hidden: { $ne: true },
      });
    });
  });
});
