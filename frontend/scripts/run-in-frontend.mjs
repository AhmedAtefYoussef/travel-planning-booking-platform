// Runs a frontend tool (prettier | eslint) from inside frontend/, so it resolves its own config and
// plugins exactly as `npm run lint` / `npm run format` do. Used by the root lint-staged config.
// Usage: node frontend/scripts/run-in-frontend.mjs <prettier|eslint> [args...] -- <absolute files...>
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..');
const bins = {
  prettier: join(frontend, 'node_modules/prettier/bin/prettier.cjs'),
  eslint: join(frontend, 'node_modules/eslint/bin/eslint.js'),
};
const [tool, ...args] = process.argv.slice(2);
if (!bins[tool]) {
  console.error(
    `Unknown tool "${tool}"; expected one of: ${Object.keys(bins).join(', ')}`,
  );
  process.exit(2);
}
const { status } = spawnSync(process.execPath, [bins[tool], ...args], {
  cwd: frontend,
  stdio: 'inherit',
});
process.exit(status ?? 1);
