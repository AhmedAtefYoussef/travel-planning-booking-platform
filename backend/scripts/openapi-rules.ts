/**
 * Swagger/OpenAPI contract rules enforced in CI (Definition of Done on every Jira story):
 *  - every operation is tagged (one tag per module);
 *  - every summary starts with a requirement ID from the official workbook (or a TRVL-n Jira key
 *    for infrastructure endpoints), and every cited ID exists;
 *  - protected operations document 401 and 403 (public ones are marked x-public by @Public());
 *  - operations that accept input document 400; operations with path params document 404;
 *  - lists use the fixed page size of 10: no limit/pageSize/perPage query parameter (GEN-05).
 */

export interface Violation {
  operation: string;
  rule: string;
  message: string;
}

interface Parameter {
  name: string;
  in: string;
}

interface Operation {
  summary?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  'x-public'?: boolean;
}

export interface OpenApiLike {
  paths: Record<string, Record<string, Operation>>;
}

const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
]);
const REQ_ID = String.raw`[A-Z]{3}-\d{2}[a-z]?(?:-B)?`;
const SUMMARY_PREFIX = new RegExp(
  String.raw`^\[?((?:${REQ_ID})(?:\s*[,/]\s*${REQ_ID})*|TRVL-\d+)\]?(?=\s|$)`,
);
const FORBIDDEN_PAGE_SIZE_PARAMS = new Set([
  'limit',
  'pagesize',
  'page_size',
  'perpage',
  'per_page',
]);

export function checkOpenApi(
  doc: OpenApiLike,
  knownRequirementIds: ReadonlySet<string>,
): Violation[] {
  const violations: Violation[] = [];

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method)) continue;
      const operation = `${method.toUpperCase()} ${path}`;
      const add = (rule: string, message: string) =>
        violations.push({ operation, rule, message });
      const responses = op.responses ?? {};
      const params = op.parameters ?? [];

      if (!op.tags || op.tags.length === 0) {
        add(
          'tagged',
          'operation has no Swagger tag; add @ApiTags(<module>) to the controller',
        );
      }

      const match = SUMMARY_PREFIX.exec(op.summary ?? '');
      if (!match) {
        add(
          'summary-requirement-id',
          `summary must start with a requirement ID (e.g. "FLT-11 Search flights"); got "${op.summary ?? ''}"`,
        );
      } else if (!match[1].startsWith('TRVL-')) {
        for (const id of match[1].split(/\s*[,/]\s*/)) {
          if (!knownRequirementIds.has(id)) {
            add(
              'summary-requirement-id',
              `"${id}" is not a requirement ID in the official workbook`,
            );
          }
        }
      }

      if (op['x-public'] !== true) {
        for (const code of ['401', '403']) {
          if (!(code in responses)) {
            add(
              'auth-responses',
              `protected operation must document ${code} (or be marked @Public())`,
            );
          }
        }
      }

      if ((op.requestBody || params.length > 0) && !('400' in responses)) {
        add(
          'validation-response',
          'operation accepts input and must document 400 (fieldErrors, GEN-02)',
        );
      }

      if (params.some((p) => p.in === 'path') && !('404' in responses)) {
        add(
          'not-found-response',
          'operation has path parameters and must document 404',
        );
      }

      for (const p of params) {
        if (
          p.in === 'query' &&
          FORBIDDEN_PAGE_SIZE_PARAMS.has(p.name.toLowerCase())
        ) {
          add(
            'fixed-page-size',
            `query parameter "${p.name}" is not allowed: page size is fixed at 10 (GEN-05)`,
          );
        }
      }
    }
  }
  return violations;
}
