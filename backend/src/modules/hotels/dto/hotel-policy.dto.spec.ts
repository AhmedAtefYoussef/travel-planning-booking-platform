import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SetHotelPoliciesDto } from './hotel-policy.dto';

const fields = (body: object) =>
  validateSync(plainToInstance(SetHotelPoliciesDto, body))
    .map((e) => e.property)
    .sort();

describe('SetHotelPoliciesDto (HTL-09)', () => {
  it('accepts 24-hour HH:mm times, with check-out earlier than check-in', () => {
    expect(fields({ checkInTime: '14:00', checkOutTime: '12:00' })).toEqual([]);
    expect(fields({ checkInTime: '00:00', checkOutTime: '23:59' })).toEqual([]);
  });

  it('requires both times', () => {
    expect(fields({})).toEqual(['checkInTime', 'checkOutTime']);
    expect(fields({ checkInTime: '14:00' })).toEqual(['checkOutTime']);
    expect(fields({ checkInTime: null, checkOutTime: '12:00' })).toEqual([
      'checkInTime',
    ]);
  });

  it.each(['2pm', '24:00', '9:30', '12:60', '12:30:00', ' 14:00', '', 1400])(
    'rejects %p',
    (value) => {
      expect(fields({ checkInTime: value, checkOutTime: '12:00' })).toEqual([
        'checkInTime',
      ]);
    },
  );
});
