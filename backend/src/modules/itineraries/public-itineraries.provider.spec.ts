import { Types, type Model } from 'mongoose';
import { PublicItinerariesProvider } from './public-itineraries.provider';
import {
  ItineraryVisibility,
  type Itinerary,
} from './schemas/itinerary.schema';

/** BLG-13: which itineraries a post may carry, and which of them are shown, without a database. */
describe('PublicItinerariesProvider (BLG-13)', () => {
  const author = new Types.ObjectId();
  const itineraryId = new Types.ObjectId();
  const exists = jest.fn();
  const find = jest.fn();
  const provider = new PublicItinerariesProvider({
    exists: (filter: unknown) => ({ exec: () => exists(filter) as unknown }),
    find: (filter: unknown) => ({
      lean: () => ({ exec: () => find(filter) as unknown }),
    }),
  } as unknown as Model<Itinerary>);

  beforeEach(() => jest.clearAllMocks());

  it('attachable: asks for a visible itinerary that is the authors own or public', async () => {
    exists.mockResolvedValue({ _id: itineraryId });
    await expect(
      provider.attachable(author.toHexString(), itineraryId.toHexString()),
    ).resolves.toBe(true);
    expect(exists).toHaveBeenCalledWith({
      _id: itineraryId,
      isHidden: { $ne: true },
      $or: [{ ownerId: author }, { visibility: ItineraryVisibility.Public }],
    });
  });

  it('attachable: false when nothing matches', async () => {
    exists.mockResolvedValue(null);
    await expect(
      provider.attachable(author.toHexString(), itineraryId.toHexString()),
    ).resolves.toBe(false);
  });

  it('attachable: false for a malformed id without querying', async () => {
    await expect(
      provider.attachable(author.toHexString(), 'nope'),
    ).resolves.toBe(false);
    expect(exists).not.toHaveBeenCalled();
  });

  it('summaries: one query for public, visible itineraries, keyed by id', async () => {
    find.mockResolvedValue([
      {
        _id: itineraryId,
        title: 'Nile',
        countries: ['EG'],
        startDate: '2027-03-01',
        days: [{}, {}],
      },
    ]);
    const id = itineraryId.toHexString();
    const result = await provider.summaries([id, id, 'bad']);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({
      _id: { $in: [itineraryId] },
      visibility: ItineraryVisibility.Public,
      isHidden: { $ne: true },
    });
    expect(result.get(id)).toEqual({
      id,
      title: 'Nile',
      countries: ['EG'],
      startDate: '2027-03-01',
      days: 2,
    });
  });

  it('summaries: no query when there is nothing valid to look up', async () => {
    expect((await provider.summaries(['bad'])).size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });
});
