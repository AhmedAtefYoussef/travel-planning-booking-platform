import { ProviderType } from '../../common/auth/auth.types';
import { ParseProviderTypePipe } from './provider-type.pipe';

describe('ParseProviderTypePipe (ACC-15)', () => {
  const pipe = new ParseProviderTypePipe();

  it.each([
    ['airline', ProviderType.Airline],
    ['HOTEL', ProviderType.Hotel],
  ])('maps %s to %s', (value, type) => {
    expect(pipe.transform(value)).toBe(type);
  });

  it.each(['ship', '', 'constructor', undefined, 3])(
    'rejects %p with a 400 field error on type',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(
        expect.objectContaining({
          status: 400,
          response: expect.objectContaining({
            code: 'VALIDATION_FAILED',
            fieldErrors: [expect.objectContaining({ field: 'type' })],
          }),
        }),
      );
    },
  );
});
