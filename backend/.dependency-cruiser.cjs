/**
 * Architecture rules (brief section 1.1, MVC with feature-based NestJS modules). CI runs
 * `npm run arch:check` on every PR; a violation fails the "architecture" check.
 *
 *   controller -> service -> model (Mongoose schema)
 *   modules talk to each other only through common/contracts or a module's public index.ts
 *   common/ is shared infrastructure and never depends on a feature module
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports hide coupling between modules and break Nest DI ordering.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'controllers-do-not-touch-models',
      severity: 'error',
      comment:
        'MVC: controllers validate input and delegate to services; only services use Mongoose models.',
      from: { path: '\\.controller\\.ts$' },
      to: { path: ['\\.schema\\.ts$', '(^|/)schemas/'], dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'controllers-do-not-import-mongoose',
      severity: 'error',
      comment: 'MVC: database access belongs in services.',
      from: { path: '\\.controller\\.ts$' },
      to: { path: '(^|/)node_modules/(mongoose|@nestjs/mongoose)/' },
    },
    {
      name: 'common-is-independent-of-modules',
      severity: 'error',
      comment: 'common/ is shared infrastructure; it must not depend on any feature module.',
      from: { path: '^src/common/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'modules-use-public-api-of-other-modules',
      severity: 'error',
      comment:
        'Import another module only through its index.ts (public API) or through common/contracts tokens. ' +
        'Reaching into its services/schemas couples you to internals the owner may change.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/.+',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'no-test-code-in-app',
      severity: 'error',
      from: { path: '^src/', pathNot: '\\.spec\\.ts$' },
      to: { path: ['\\.spec\\.ts$', '^test/', 'node_modules/(@nestjs/testing|supertest|mongodb-memory-server)'] },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['^dist/', '^coverage/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['main', 'types'],
    },
  },
};
