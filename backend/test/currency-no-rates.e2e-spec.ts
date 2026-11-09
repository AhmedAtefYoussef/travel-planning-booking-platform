/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { ServiceUnavailableException } from '@nestjs/common';
import request from 'supertest';
import type { CurrencyService } from '../src/common/contracts/currency.contract';
import { CURRENCY_SERVICE } from '../src/common/contracts/tokens';
import { createTestApp, TestApp } from './utils/test-app';

jest.setTimeout(120_000);

describe('ITN-18 currency with no rates ever cached (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ fxFailing: true });
  });
  afterAll(async () => {
    await t.close();
  });

  it('convert fails with 503 when the FX API is down and nothing is cached', async () => {
    const currency: CurrencyService = t.app.get(CURRENCY_SERVICE);
    await expect(currency.convert(10000, 'USD', 'EGP')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('GET /currencies/rates is 503; the currency list stays available', async () => {
    const http = () => request(t.app.getHttpServer());
    await http().get('/api/currencies/rates').expect(503);
    await http().get('/api/currencies').expect(200);
  });
});
