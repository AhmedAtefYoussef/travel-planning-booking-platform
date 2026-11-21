import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  FLIGHT_STATUS_INTERVAL_MS,
  FlightStatusService,
} from './flight-status.service';
import type { Flight } from './schemas/flight.schema';

function setup(nodeEnv: string, modified = 2) {
  const model = {
    updateMany: jest.fn(() => ({
      exec: () => Promise.resolve({ modifiedCount: modified }),
    })),
  };
  const config = {
    get: jest.fn(() => nodeEnv),
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return {
    model,
    service: new FlightStatusService(model as unknown as Model<Flight>, config),
  };
}

describe('FlightStatusService (FLT-30)', () => {
  afterEach(() => jest.useRealTimers());

  it('marks Scheduled flights whose departure has passed as Departed, in one update', async () => {
    const { service, model } = setup('development');
    const now = new Date('2026-12-01T12:30:00Z');
    await expect(service.markDeparted(now)).resolves.toBe(2);
    expect(model.updateMany).toHaveBeenCalledWith(
      { status: 'SCHEDULED', departureUtc: { $lte: now } },
      { $set: { status: 'DEPARTED' } },
    );
  });

  it('runs at startup and then every minute outside tests', () => {
    jest.useFakeTimers();
    const { service, model } = setup('development', 0);
    service.onApplicationBootstrap();
    expect(model.updateMany).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(FLIGHT_STATUS_INTERVAL_MS);
    expect(model.updateMany).toHaveBeenCalledTimes(2);
    service.onApplicationShutdown();
    jest.advanceTimersByTime(FLIGHT_STATUS_INTERVAL_MS * 3);
    expect(model.updateMany).toHaveBeenCalledTimes(2);
  });

  it('does not start the timer in tests', () => {
    jest.useFakeTimers();
    const { service, model } = setup('test');
    service.onApplicationBootstrap();
    jest.advanceTimersByTime(FLIGHT_STATUS_INTERVAL_MS * 2);
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('logs and survives a failed run', async () => {
    jest.useFakeTimers();
    const { service, model } = setup('development');
    model.updateMany.mockImplementationOnce(() => ({
      exec: () => Promise.reject(new Error('db down')),
    }));
    service.onApplicationBootstrap();
    await Promise.resolve();
    jest.advanceTimersByTime(FLIGHT_STATUS_INTERVAL_MS);
    expect(model.updateMany).toHaveBeenCalledTimes(2);
    service.onApplicationShutdown();
  });
});
