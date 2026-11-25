import { Role, type AuthUser } from '../../common/auth/auth.types';
import type {
  AccountAdmin,
  AuditService,
  NotificationsService,
  ProviderState,
  ProviderStatus,
} from '../../common/contracts';
import { ParseProviderKindPipe } from './provider-kind.pipe';
import { ProviderActivationService } from './provider-activation.service';

const ADMIN: AuthUser = { id: 'a'.repeat(24), role: Role.Admin };
const PROVIDER = 'c'.repeat(24);
const SESSION = {
  id: 'tx',
  withTransaction: (fn: () => Promise<void>) => fn(),
  endSession: () => Promise.resolve(),
};

function store(state: ProviderState | null, changed = true) {
  return {
    find: jest.fn().mockResolvedValue(state),
    findMany: jest.fn().mockResolvedValue(state ? [state] : []),
    setActive: jest.fn().mockResolvedValue(changed),
  } satisfies jest.Mocked<ProviderStatus>;
}

function setup(airline = store(null), hotel = store(null)) {
  const connection = {
    startSession: jest.fn(() => Promise.resolve(SESSION)),
  };
  const accounts: jest.Mocked<AccountAdmin> = {
    find: jest.fn(),
    changeStatus: jest.fn(),
    revokeAllSessions: jest.fn(),
    moderatorsOf: jest.fn().mockResolvedValue(['m1', 'm2']),
  };
  const audit: jest.Mocked<AuditService> = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const notifications: jest.Mocked<NotificationsService> = {
    notify: jest.fn(),
    notifyMany: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ProviderActivationService(
    connection as never,
    airline,
    hotel,
    accounts,
    audit,
    notifications,
  );
  return { service, accounts, audit, notifications };
}

const failure = (p: Promise<unknown>) =>
  p.catch((e: unknown) => e) as Promise<{
    status?: number;
    message?: string;
  }>;

describe('ProviderActivationService: ACC-15, GEN-07', () => {
  it('deactivates an airline, notifies each of its moderators and audits it, all in one transaction', async () => {
    const airline = store({ id: PROVIDER, name: 'EgyptAir', isActive: true });
    const hotel = store(null);
    const { service, accounts, audit, notifications } = setup(airline, hotel);

    await expect(
      service.setActive(ADMIN, 'airline', PROVIDER, false, 'licence'),
    ).resolves.toEqual({
      id: PROVIDER,
      type: 'AIRLINE',
      name: 'EgyptAir',
      isActive: false,
    });
    expect(airline.setActive).toHaveBeenCalledWith(PROVIDER, false, SESSION);
    expect(hotel.find).not.toHaveBeenCalled();
    expect(accounts.moderatorsOf).toHaveBeenCalledWith(
      'AIRLINE',
      PROVIDER,
      SESSION,
    );
    const sent = notifications.notifyMany.mock.calls[0];
    expect(sent[1]).toBe(SESSION);
    expect(sent[0].map((n) => [n.userId, n.type, n.link])).toEqual([
      ['m1', 'PROVIDER_DEACTIVATED', '/moderator/airline'],
      ['m2', 'PROVIDER_DEACTIVATED', '/moderator/airline'],
    ]);
    expect(sent[0][0].body).toContain('EgyptAir');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DEACTIVATE_PROVIDER',
        targetType: 'AIRLINE',
        targetId: PROVIDER,
        reason: 'licence',
        metadata: { providerName: 'EgyptAir', moderatorsNotified: 2 },
      }),
      SESSION,
    );
  });

  it('reactivates a hotel through the hotel store', async () => {
    const hotel = store({ id: PROVIDER, name: 'Nile Inn', isActive: false });
    const { service, audit, notifications } = setup(store(null), hotel);
    await expect(
      service.setActive(ADMIN, 'hotel', PROVIDER, true),
    ).resolves.toMatchObject({ type: 'HOTEL', isActive: true });
    expect(notifications.notifyMany.mock.calls[0][0][0]).toMatchObject({
      type: 'PROVIDER_REACTIVATED',
      link: '/moderator/hotel',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REACTIVATE_PROVIDER',
        targetType: 'HOTEL',
      }),
      SESSION,
    );
  });

  it('is 404 for an unknown provider and 409 when already in that state or changed in parallel', async () => {
    expect(
      await failure(setup().service.setActive(ADMIN, 'hotel', PROVIDER, false)),
    ).toMatchObject({ status: 404, message: 'Hotel not found' });

    const open = store({ id: PROVIDER, name: 'Nile Inn', isActive: true });
    expect(
      await failure(
        setup(store(null), open).service.setActive(
          ADMIN,
          'hotel',
          PROVIDER,
          true,
        ),
      ),
    ).toMatchObject({ status: 409, message: 'Nile Inn is already active' });
    expect(open.setActive).not.toHaveBeenCalled();

    const raced = setup(
      store({ id: PROVIDER, name: 'EgyptAir', isActive: true }, false),
    );
    expect(
      await failure(raced.service.setActive(ADMIN, 'airline', PROVIDER, false)),
    ).toMatchObject({ status: 409 });
    expect(raced.audit.record).not.toHaveBeenCalled();
  });
});

describe('ParseProviderKindPipe: ACC-15', () => {
  it('accepts airline and hotel and rejects anything else with a type field error', () => {
    const pipe = new ParseProviderKindPipe();
    expect(pipe.transform('airline')).toBe('airline');
    expect(pipe.transform('hotel')).toBe('hotel');
    for (const bad of ['AIRLINE', 'train', undefined]) {
      expect(() => pipe.transform(bad)).toThrow(
        expect.objectContaining({ status: 400 }) as Error,
      );
    }
  });
});
