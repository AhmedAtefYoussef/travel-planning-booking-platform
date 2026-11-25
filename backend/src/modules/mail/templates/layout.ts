import { escapeHtml } from './escape-html';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface EmailContent {
  /** The email subject; line breaks are removed so a value can never add a header. */
  subject: string;
  heading: string;
  /** Paragraphs of plain text; each is HTML-escaped in the HTML part. */
  paragraphs: string[];
  /** An optional call to action; `url` is absolute. */
  action?: { label: string; url: string };
}

/** The one frame every email uses; every interpolated value is escaped here, never in a template. */
export function renderEmail(content: EmailContent): RenderedEmail {
  const subject = content.subject.replace(/\s+/g, ' ').trim();
  const textParts = [content.heading, '', ...content.paragraphs];
  if (content.action)
    textParts.push('', `${content.action.label}: ${content.action.url}`);
  textParts.push('', '-- Travel Platform');

  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`)
    .join('');
  const action = content.action
    ? `<p style="margin:16px 0"><a href="${escapeHtml(content.action.url)}">${escapeHtml(content.action.label)}</a></p>`
    : '';
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2933">` +
    `<h2 style="margin:0 0 16px">${escapeHtml(content.heading)}</h2>` +
    `${paragraphs}${action}` +
    `<p style="margin:24px 0 0;color:#667085;font-size:12px">Travel Platform</p></div>`;
  return { subject, text: textParts.join('\n'), html };
}

/** `link` is a frontend route that starts with one "/" (GEN-01); the base has no trailing slash. */
export function absoluteUrl(baseUrl: string, route: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${route}`;
}
