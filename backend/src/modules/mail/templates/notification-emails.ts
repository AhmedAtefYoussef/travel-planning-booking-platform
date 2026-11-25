import { NotificationType } from '../../../common/contracts';
import { absoluteUrl, renderEmail, type RenderedEmail } from './layout';

/** What the in-app notification (GEN-01) already says; the email repeats it. */
export interface NotificationEmailInput {
  title: string;
  body: string;
  /** Frontend route, e.g. /bookings/flights/<id>. */
  link?: string;
  /** APP_BASE_URL: the frontend origin the route is opened on. */
  baseUrl: string;
}

type Template = (n: NotificationEmailInput) => RenderedEmail;

/** One template per notification type: its own lead-in sentence and call-to-action label. */
function template(
  subjectPrefix: string,
  intro: string,
  actionLabel: string,
): Template {
  return (n) =>
    renderEmail({
      subject: `${subjectPrefix}: ${n.title}`,
      heading: n.title,
      paragraphs: [intro, n.body],
      action: n.link
        ? { label: actionLabel, url: absoluteUrl(n.baseUrl, n.link) }
        : undefined,
    });
}

export const bookingConfirmed = template(
  'Booking confirmed',
  'Good news, your booking is confirmed.',
  'View your booking',
);
export const bookingCancelled = template(
  'Booking cancelled',
  'A booking of yours was cancelled.',
  'View your booking',
);
export const refundIssued = template(
  'Refund issued',
  'A refund has been started for you.',
  'View your refund',
);
export const refundUpdated = template(
  'Refund update',
  'There is an update on your refund.',
  'View your refund',
);
export const flightScheduleChanged = template(
  'Flight schedule changed',
  'The schedule of a flight you booked has changed.',
  'View your booking',
);
export const accountSuspended = template(
  'Account suspended',
  'Your account has been suspended by an administrator.',
  'Open the platform',
);
export const accountReactivated = template(
  'Account reactivated',
  'Your account has been reactivated and you can sign in again.',
  'Open the platform',
);
export const providerDeactivated = template(
  'Provider deactivated',
  'A provider you manage has been deactivated by an administrator.',
  'Open the platform',
);
export const providerReactivated = template(
  'Provider reactivated',
  'A provider you manage has been reactivated by an administrator.',
  'Open the platform',
);

/** Exhaustive on purpose: adding a NotificationType fails to compile until it has an email. */
export const NOTIFICATION_TEMPLATES: Record<NotificationType, Template> = {
  [NotificationType.BookingConfirmed]: bookingConfirmed,
  [NotificationType.BookingCancelled]: bookingCancelled,
  [NotificationType.RefundIssued]: refundIssued,
  [NotificationType.RefundUpdated]: refundUpdated,
  [NotificationType.FlightScheduleChanged]: flightScheduleChanged,
  [NotificationType.AccountSuspended]: accountSuspended,
  [NotificationType.AccountReactivated]: accountReactivated,
  [NotificationType.ProviderDeactivated]: providerDeactivated,
  [NotificationType.ProviderReactivated]: providerReactivated,
};
