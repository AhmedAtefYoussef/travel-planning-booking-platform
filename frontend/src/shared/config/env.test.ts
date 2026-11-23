import { describe, expect, it } from 'vitest';
import { readServerEnv } from './env';

describe('readServerEnv', () => {
  it('defaults BACKEND_URL to the local API so builds need no env file', () => {
    expect(readServerEnv({})).toEqual({ BACKEND_URL: 'http://localhost:3000' });
    expect(readServerEnv({ BACKEND_URL: '' }).BACKEND_URL).toBe(
      'http://localhost:3000',
    );
  });

  it('strips trailing slashes', () => {
    expect(
      readServerEnv({ BACKEND_URL: 'https://api.example.com//' }).BACKEND_URL,
    ).toBe('https://api.example.com');
  });

  it('rejects a malformed or non-http URL', () => {
    expect(() => readServerEnv({ BACKEND_URL: 'localhost:3000' })).toThrow();
    expect(() => readServerEnv({ BACKEND_URL: 'ftp://example.com' })).toThrow();
  });
});
