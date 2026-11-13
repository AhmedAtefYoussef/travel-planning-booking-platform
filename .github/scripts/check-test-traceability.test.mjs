import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citedIds, testTraceability } from './check-test-traceability.mjs';

const matrix = `## Accounts

| ID | Type | Endpoint(s) | Owner | Jira | PR | Status |
|---|---|---|---|---|---|---|
| ACC-05 | Mandatory | POST /api/auth/login | Abdelrahman | TRVL-15 | #45 | Done |
| ACC-07a | Mandatory | POST /api/admin/users/:id/reset-password | Abdelrahman | TRVL-17 | #52 | Done |
| ACC-12 | Mandatory | DELETE /api/users/me | Abdelrahman | TRVL-22 | #49 | Partial: bookings block pending |
| ACC-15 | Mandatory | PATCH /api/admin/accounts/:id/suspend | Karim | TRVL-25 | - | Not started |
| GEN-11 | Mandatory | (transition table) | Ahmed | TRVL-106 | #4 | Partial: transition table only |
`;

test('citedIds reads IDs from describe titles only', () => {
  const src = `
    describe('Login lockout (e2e): ACC-05', () => {
      it('mentions ACC-12 in a test name only', () => {});
    });
    describe.each([[1]])("Reset (vv): ACC-07a, GEN-13", () => {});
    // describe('commented ACC-99') still matches the pattern, which is acceptable
  `;
  const ids = citedIds(src);
  assert.ok(ids.has('ACC-05'));
  assert.ok(ids.has('ACC-07a'));
  assert.ok(ids.has('GEN-13'));
  assert.ok(!ids.has('ACC-12'));
});

test('citedIds does not confuse ACC-07 with ACC-07a or GEN-01 with GEN-01-B', () => {
  const ids = citedIds(
    "describe('Admin reset: ACC-07a', () => {}); describe('Mail: GEN-01-B', () => {});",
  );
  assert.ok(ids.has('ACC-07a'));
  assert.ok(!ids.has('ACC-07'));
  assert.ok(ids.has('GEN-01-B'));
  assert.ok(!ids.has('GEN-01'));
});

test('testTraceability tracks Done and Partial rows and lists citing specs', () => {
  const rows = testTraceability(matrix, [
    [
      'backend/test/auth-lockout.e2e-spec.ts',
      "describe('Lockout (e2e): ACC-05', () => {})",
    ],
    [
      'backend/test/vv/accounts.vv.e2e-spec.ts',
      "describe('Deactivation (vv): ACC-12', () => {})",
    ],
  ]);
  assert.deepEqual(
    rows.map((r) => [r.id, r.status, r.specs.length]),
    [
      ['ACC-05', 'Done', 1],
      ['ACC-07a', 'Done', 0],
      ['ACC-12', 'Partial', 1],
      ['GEN-11', 'Partial', 0],
    ],
  );
  assert.equal(rows[0].owner, 'Abdelrahman');
});

test('Not started rows are never reported', () => {
  const rows = testTraceability(matrix, []);
  assert.ok(!rows.some((r) => r.id === 'ACC-15'));
});
