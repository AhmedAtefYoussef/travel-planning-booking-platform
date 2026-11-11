import type { PayableBooking } from '../../common/contracts';
import { ValidationFailedException } from '../../common/errors/app.exception';
import {
  BookingPoliciesService,
  PayableBookings,
} from './booking-policies.service';
import { ParseBookingTypePipe } from './booking-type.pipe';

function provider(name: string): jest.Mocked<PayableBooking> {
  const mock = {
    getPayable: jest.fn(),
    getPolicies: jest.fn(() => Promise.resolve({ from: name } as never)),
    acceptPolicies: jest.fn(() => Promise.resolve({ accepted: name } as never)),
    markConfirmed: jest.fn(),
    markPaymentFailed: jest.fn(),
  };
  return mock as unknown as jest.Mocked<PayableBooking>;
}

describe('PAY-02 booking policies', () => {
  it('routes each booking type to its own module', async () => {
    const flights = provider('flights');
    const hotels = provider('hotels');
    const service = new BookingPoliciesService(
      new PayableBookings(flights, hotels),
    );
    await expect(service.get('FLIGHT' as never, 'b1', 'u1')).resolves.toEqual({
      from: 'flights',
    });
    await expect(service.get('HOTEL' as never, 'b2', 'u1')).resolves.toEqual({
      from: 'hotels',
    });
    expect(flights.getPolicies).toHaveBeenCalledWith('b1', 'u1');
    await expect(
      service.accept('HOTEL' as never, 'b2', 'u1', true),
    ).resolves.toEqual({
      accepted: 'hotels',
    });
    expect(hotels.acceptPolicies).toHaveBeenCalledWith('b2', 'u1');
  });

  it('answers 404 for a booking type whose module is not there yet', () => {
    const service = new BookingPoliciesService(
      new PayableBookings(provider('flights'), undefined),
    );
    expect(() => service.get('HOTEL' as never, 'b', 'u')).toThrow(
      expect.objectContaining({ status: 404 }) as Error,
    );
  });

  it('never records an acceptance without the ticked box', () => {
    const flights = provider('flights');
    const service = new BookingPoliciesService(new PayableBookings(flights));
    expect(() => service.accept('FLIGHT' as never, 'b', 'u', false)).toThrow(
      ValidationFailedException,
    );
    expect(flights.acceptPolicies).not.toHaveBeenCalled();
  });

  it('parses the :type path segment', () => {
    const pipe = new ParseBookingTypePipe();
    expect(pipe.transform('flight')).toBe('FLIGHT');
    expect(pipe.transform(' Hotel ')).toBe('HOTEL');
    for (const bad of ['train', '', 7, undefined]) {
      expect(() => pipe.transform(bad)).toThrow(ValidationFailedException);
    }
  });
});
