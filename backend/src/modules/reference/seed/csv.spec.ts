import { csvRecords, parseCsv } from './csv';

describe('parseCsv (GEN-12 dataset reader)', () => {
  it('reads plain rows and skips blank lines', () => {
    expect(parseCsv('a,b\n1,2\n\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles quotes, escaped quotes, commas and line breaks inside quotes', () => {
    expect(
      parseCsv('"name","note"\r\n"Kingdom Centre, Riyadh","say ""hi""\nthere"'),
    ).toEqual([
      ['name', 'note'],
      ['Kingdom Centre, Riyadh', 'say "hi"\nthere'],
    ]);
  });

  it('strips a UTF-8 byte-order mark and keeps non-ASCII text', () => {
    expect(parseCsv('﻿name\nRömerberg')).toEqual([['name'], ['Römerberg']]);
  });

  it('rejects an unterminated quoted field', () => {
    expect(() => parseCsv('a\n"open')).toThrow('inside a quoted field');
  });
});

describe('csvRecords', () => {
  it('maps rows to trimmed header-keyed records', () => {
    expect(
      csvRecords('code, name\nEG , Egypt', ['code', 'name'], 'X.csv'),
    ).toEqual([{ code: 'EG', name: 'Egypt' }]);
  });

  it('names a missing column', () => {
    expect(() =>
      csvRecords('code\nEG', ['code', 'name'], 'Countries.csv'),
    ).toThrow('Countries.csv is missing column(s): name');
  });

  it('names the line with the wrong number of fields', () => {
    expect(() => csvRecords('a,b\n1,2\n3', ['a'], 'X.csv')).toThrow(
      'X.csv line 3 has 1 fields, expected 2',
    );
  });

  it('rejects an empty file', () => {
    expect(() => csvRecords('', ['a'], 'X.csv')).toThrow('X.csv is empty');
  });
});
