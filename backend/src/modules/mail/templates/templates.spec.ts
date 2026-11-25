import { NotificationType } from '../../../common/contracts';
import { escapeHtml } from './escape-html';
import { moderatorInvitation } from './moderator-invitation';
import { NOTIFICATION_TEMPLATES } from './notification-emails';

const BASE = 'http://localhost:3001/';
const HOSTILE = `<script>alert("x")</script> & 'q'`;

describe('escapeHtml', () => {
  it('escapes the five characters that matter in content and attributes', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;',
    );
  });

  it('leaves plain text alone and escapes & only once per occurrence', () => {
    expect(escapeHtml('Cairo to Dubai, 14:30')).toBe('Cairo to Dubai, 14:30');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('notification emails (GEN-01-B)', () => {
  it.each(Object.values(NotificationType))(
    '%s has a template with the title, body and an absolute link',
    (type) => {
      const email = NOTIFICATION_TEMPLATES[type]({
        title: 'Flight MS123 confirmed',
        body: 'CAI -> DXB, 2 passengers.',
        link: '/bookings/flights/abc123',
        baseUrl: BASE,
      });
      expect(email.subject).toContain('Flight MS123 confirmed');
      expect(email.text).toContain('CAI -> DXB, 2 passengers.');
      expect(email.text).toContain(
        'http://localhost:3001/bookings/flights/abc123',
      );
      expect(email.html).toContain(
        'href="http://localhost:3001/bookings/flights/abc123"',
      );
      // CAI -> DXB must be escaped in HTML but not in the text part.
      expect(email.html).toContain('CAI -&gt; DXB');
    },
  );

  it.each(Object.values(NotificationType))(
    '%s escapes every interpolated value in the HTML part',
    (type) => {
      const email = NOTIFICATION_TEMPLATES[type]({
        title: HOSTILE,
        body: HOSTILE,
        link: `/x?a="1"&b=<2>`,
        baseUrl: BASE,
      });
      expect(email.html).not.toContain('<script>');
      expect(email.html).not.toContain('"1"');
      expect(email.html).toContain('&lt;script&gt;');
    },
  );

  it('omits the call to action when the notification has no link', () => {
    const email = NOTIFICATION_TEMPLATES[NotificationType.AccountSuspended]({
      title: 'Account suspended',
      body: 'Contact support.',
      baseUrl: BASE,
    });
    expect(email.html).not.toContain('<a ');
    expect(email.text).not.toContain('http');
  });

  it('never lets a title add a header line to the subject', () => {
    const email = NOTIFICATION_TEMPLATES[NotificationType.BookingCancelled]({
      title: 'Hello\r\nBcc: evil@example.com',
      body: 'b',
      baseUrl: BASE,
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});

describe('moderatorInvitation (ACC-13)', () => {
  it('points to the login page and tells them an admin shares the password', () => {
    const email = moderatorInvitation({ name: 'Ops', baseUrl: BASE });
    expect(email.text).toContain('http://localhost:3001/login');
    expect(email.text).toMatch(/administrator will share/i);
  });

  it('escapes the name', () => {
    const email = moderatorInvitation({ name: HOSTILE, baseUrl: BASE });
    expect(email.html).not.toContain('<script>');
  });
});
