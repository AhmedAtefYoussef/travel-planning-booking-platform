import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * The key a client's requests are counted under (ADR-0007). An IPv4 address counts as itself, also when it
 * arrives IPv4-mapped (::ffff:203.0.113.7). An IPv6 client usually owns a whole /64 and could take a fresh
 * address for every request, so IPv6 addresses count by their /64 prefix.
 */
export function rateLimitKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  if (!isIPv6(ip)) return ip;
  return `${expandIPv6(ip).slice(0, 4).join(':')}::/64`;
}

/** The eight 16-bit groups of an IPv6 address, as lower-case hex without leading zeros. */
function expandIPv6(ip: string): string[] {
  const address = ip.split('%')[0].toLowerCase(); // drop a zone id (fe80::1%eth0)
  const [head, tail] = address.split('::');
  const parts = (s: string | undefined): string[] =>
    s
      ? s.split(':').flatMap((g) => (g.includes('.') ? ipv4Groups(g) : [g]))
      : [];
  const left = parts(head);
  const right = parts(tail);
  const zeros =
    tail === undefined
      ? []
      : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].map((g) => parseInt(g, 16).toString(16));
}

/** An embedded dotted IPv4 tail (::1.2.3.4) as two IPv6 groups. */
function ipv4Groups(v4: string): string[] {
  const [a, b, c, d] = v4.split('.').map(Number);
  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
}

/** ThrottlerGuard that counts clients by rateLimitKey instead of the raw req.ip. */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(rateLimitKey(req.ip as string | undefined));
  }
}
