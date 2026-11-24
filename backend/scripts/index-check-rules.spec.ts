import {
  blocksStartup,
  compareIndexes,
  defaultIndexName,
} from './index-check-rules';

describe('index check rules (db:indexes)', () => {
  const key = { reporterId: 1, targetType: 1, targetId: 1 };

  it('builds MongoDB default names', () => {
    expect(defaultIndexName(key)).toBe('reporterId_1_targetType_1_targetId_1');
    expect(defaultIndexName({ status: 1, createdAt: -1 })).toBe(
      'status_1_createdAt_-1',
    );
  });

  it('reports the startup error 85 case: same index, another name', () => {
    const [f] = compareIndexes(
      [{ key, unique: true, name: 'one_report_per_user_and_item' }],
      [{ key, unique: true, name: 'reporterId_1_targetType_1_targetId_1' }],
    );
    expect(f).toMatchObject({
      kind: 'name-clash',
      existingName: 'reporterId_1_targetType_1_targetId_1',
    });
    expect(blocksStartup(f)).toBe(true);
  });

  it('is fine once the code uses the existing default name', () => {
    expect(
      compareIndexes(
        [{ key, unique: true }],
        [{ key, unique: true, name: 'reporterId_1_targetType_1_targetId_1' }],
      ),
    ).toEqual([{ kind: 'ok', name: 'reporterId_1_targetType_1_targetId_1' }]);
  });

  it('flags a unique mismatch on the same fields and name', () => {
    const [f] = compareIndexes(
      [{ key: { email: 1 }, unique: true }],
      [{ key: { email: 1 }, name: 'email_1' }],
    );
    expect(f.kind).toBe('option-clash');
    expect(blocksStartup(f)).toBe(true);
  });

  it('lists indexes that do not exist yet without blocking', () => {
    const [f] = compareIndexes(
      [{ key: { airlineId: 1, departureUtc: 1 }, name: 'airline_departure' }],
      [],
    );
    expect(f.kind).toBe('missing');
    expect(blocksStartup(f)).toBe(false);
  });

  it('does not compare text indexes', () => {
    expect(compareIndexes([{ key: { title: 'text' } }], [])[0].kind).toBe(
      'skipped',
    );
  });
});
