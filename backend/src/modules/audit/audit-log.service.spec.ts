import { sanitizeMetadata } from './audit-log.service';

describe('sanitizeMetadata (audit entries never store secrets)', () => {
  it('drops secret-looking keys at any depth and keeps the rest', () => {
    expect(
      sanitizeMetadata({
        before: { status: 'ACTIVE', passwordHash: 'x' },
        after: { status: 'SUSPENDED' },
        token: 't',
        cardNumber: '4242',
        list: [{ secret: 's', ok: true }],
      }),
    ).toEqual({
      before: { status: 'ACTIVE' },
      after: { status: 'SUSPENDED' },
      list: [{ ok: true }],
    });
  });

  it('passes primitives through and truncates anything too deep to check', () => {
    expect(sanitizeMetadata('x')).toBe('x');
    expect(sanitizeMetadata(null)).toBeNull();
    const deep = {
      a: { b: { c: { d: { e: { password: 'never-stored' } } } } },
    };
    expect(sanitizeMetadata(deep)).toEqual({
      a: { b: { c: { d: { e: '[truncated]' } } } },
    });
  });
});
