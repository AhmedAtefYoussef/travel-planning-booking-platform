// Runs the frontend's own Prettier or ESLint from inside frontend/, so their configs and plugins
// resolve the same way as in CI. Used by the repo-root lint-staged config (pre-commit hook):
//   node frontend/scripts/run-in-frontend.mjs prettier --write <files...>
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const BINARIES = {
  prettier: 'node_modules/prettier/bin/prettier.cjs',
  eslint: 'node_modules/eslint/bin/eslint.js',
};

const [tool, ...args] = process.argv.slice(2);
if (!(tool in BINARIES)) {
  console.error(
    `Unknown tool "${tool}". Use: ${Object.keys(BINARIES).join(', ')}`,
  );
  process.exit(2);
}

const relativeArgs = args.map((arg) =>
  path.isAbsolute(arg) ? path.relative(frontendDir, arg) : arg,
);
const result = spawnSync(
  process.execPath,
  [path.join(frontendDir, BINARIES[tool]), ...relativeArgs],
  { cwd: frontendDir, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
