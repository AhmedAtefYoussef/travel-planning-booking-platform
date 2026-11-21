import { checkOpenApi, OpenApiLike } from './openapi-rules';

const ids = new Set(['FLT-11', 'GEN-05', 'ACC-07a', 'GEN-01-B']);
const rules = (doc: OpenApiLike) => checkOpenApi(doc, ids).map((v) => v.rule);

const good = {
  summary: 'FLT-11 Search one-way flights',
  tags: ['Flights'],
  parameters: [{ name: 'page', in: 'query' }],
  responses: { '200': {}, '400': {}, '401': {}, '403': {} },
};

describe('checkOpenApi', () => {
  it('accepts a fully documented operation', () => {
    expect(
      checkOpenApi({ paths: { '/api/flights/search': { get: good } } }, ids),
    ).toEqual([]);
  });

  it('accepts bracketed, multi-ID, lettered and Jira-key summaries', () => {
    for (const summary of [
      '[GEN-05] List',
      'FLT-11, GEN-05 List',
      'ACC-07a Reset',
      'GEN-01-B Mail',
      'TRVL-128 Health',
    ]) {
      expect(rules({ paths: { '/x': { get: { ...good, summary } } } })).toEqual(
        [],
      );
    }
  });

  it('rejects summaries without a valid workbook requirement ID', () => {
    expect(
      rules({
        paths: { '/x': { get: { ...good, summary: 'Search flights' } } },
      }),
    ).toEqual(['summary-requirement-id']);
    // ACC-03 is cited by the brief but does not exist in the workbook.
    expect(
      rules({
        paths: { '/x': { get: { ...good, summary: 'ACC-03 Register' } } },
      }),
    ).toEqual(['summary-requirement-id']);
  });

  it('requires a tag', () => {
    expect(rules({ paths: { '/x': { get: { ...good, tags: [] } } } })).toEqual([
      'tagged',
    ]);
  });

  it('requires 401/403 unless the operation is public', () => {
    const responses = { '200': {}, '400': {} };
    expect(rules({ paths: { '/x': { get: { ...good, responses } } } })).toEqual(
      ['auth-responses', 'auth-responses'],
    );
    expect(
      rules({
        paths: { '/x': { get: { ...good, responses, 'x-public': true } } },
      }),
    ).toEqual([]);
  });

  it('requires 400 for input and 404 for path params', () => {
    const op = {
      ...good,
      parameters: [{ name: 'id', in: 'path' }],
      responses: { '200': {}, '401': {}, '403': {} },
    };
    expect(rules({ paths: { '/x/{id}': { get: op } } })).toEqual([
      'validation-response',
      'not-found-response',
    ]);
  });

  it('forbids client-controlled page sizes (GEN-05)', () => {
    const op = {
      ...good,
      parameters: [
        { name: 'page', in: 'query' },
        { name: 'limit', in: 'query' },
      ],
    };
    expect(rules({ paths: { '/x': { get: op } } })).toEqual([
      'fixed-page-size',
    ]);
  });

  it('ignores non-operation path item keys', () => {
    expect(checkOpenApi({ paths: { '/x': { parameters: {} } } }, ids)).toEqual(
      [],
    );
  });
});
