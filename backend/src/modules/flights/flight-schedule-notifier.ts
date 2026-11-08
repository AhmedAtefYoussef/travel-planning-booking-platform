import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  FLIGHT_BOOKINGS_LOOKUP,
  NOTIFICATIONS_SERVICE,
  NotificationType,
  type FlightBookingsLookup,
  type NotificationsService,
} from '../../common/contracts';

/** What changed, in each airport's local time (GEN-06), for the message text. */
export interface ScheduleChange {
  flightId: string;
  flightNumber: string;
  from: string;
  to: string;
  departureLocal: string;
  arrivalLocal: string;
}

/**
 * FLT-05: any time change sends an in-app notification to every user with a Confirmed booking on the
 * flight. Bookings (FLIGHT_BOOKINGS_LOOKUP) and notifications (NOTIFICATIONS_SERVICE, GEN-01) belong
 * to other modules and are injected as optional, so flights work before those modules exist.
 * Notifying happens after the edit is saved: a failure is logged and never undoes the edit.
 */
@Injectable()
export class FlightScheduleNotifier {
  private readonly logger = new Logger(FlightScheduleNotifier.name);

  constructor(
    @Optional()
    @Inject(FLIGHT_BOOKINGS_LOOKUP)
    private readonly bookings?: FlightBookingsLookup,
    @Optional()
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notifications?: NotificationsService,
  ) {}

  /** Returns how many notifications were sent, or null when the other modules are not wired yet. */
  async timesChanged(change: ScheduleChange): Promise<number | null> {
    if (!this.bookings || !this.notifications) {
      this.logger.warn(
        `Flight ${change.flightNumber} times changed, but bookings/notifications are not available yet; no one was notified (FLT-05)`,
      );
      return null;
    }
    try {
      const confirmed = await this.bookings.confirmedBookings(change.flightId);
      if (!confirmed.length) return 0;
      await this.notifications.notifyMany(
        confirmed.map((b) => ({
          userId: b.userId,
          type: NotificationType.FlightScheduleChanged,
          title: `Flight ${change.flightNumber} has a new schedule`,
          body: `${change.from} → ${change.to} now departs ${formatLocal(change.departureLocal)} and arrives ${formatLocal(change.arrivalLocal)} (local times).`,
          link: `/bookings/flights/${b.bookingId}`,
        })),
      );
      return confirmed.length;
    } catch (e) {
      this.logger.error(
        `Could not notify passengers of flight ${change.flightNumber} about its new times`,
        e instanceof Error ? e.stack : String(e),
      );
      return null;
    }
  }
}

/** "2027-12-01T14:30:00.000+02:00" -> "2027-12-01 14:30". */
function formatLocal(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
