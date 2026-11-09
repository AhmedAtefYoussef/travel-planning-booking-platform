/** Contract 8 - notifications (Karim -> everyone). */

export interface NotificationInput {
  /** Machine-readable kind, e.g. BOOKING_CONFIRMED, REFUND_ISSUED. */
  type: string;
  title: string;
  body: string;
  /** Relative front-end link, e.g. /bookings/flight/123. */
  link?: string;
}

export interface NotificationsService {
  notify(userId: string, notification: NotificationInput): Promise<void>;
}
