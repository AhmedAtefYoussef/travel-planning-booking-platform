// Pre-commit formatting and linting of staged files (husky .husky/pre-commit).
// Uses the backend's own Prettier/ESLint binaries and config so results match CI exactly.
const quote = (files) => files.map((f) => JSON.stringify(f)).join(' ');

export default {
  '.github/scripts/**/*.mjs': (files) => [
    `node backend/node_modules/prettier/bin/prettier.cjs --config backend/.prettierrc --write ${quote(files)}`,
  ],
  'backend/**/*.ts': (files) => [
    `node backend/node_modules/prettier/bin/prettier.cjs --write ${quote(files)}`,
    `node backend/node_modules/eslint/bin/eslint.js --config backend/eslint.config.mjs --fix --max-warnings 0 ${quote(files)}`,
  ],
  // The Next.js app has its own Prettier (with the Tailwind class sorter) and ESLint, run from inside
  // frontend/ so they resolve their configs and plugins as in CI. One glob per file type so the two
  // tools never edit the same file at the same time.
  'frontend/**/*.{ts,tsx}': (files) => [
    `node frontend/scripts/run-in-frontend.mjs prettier --write ${quote(files)}`,
    `node frontend/scripts/run-in-frontend.mjs eslint --fix --max-warnings 0 ${quote(files)}`,
  ],
  'frontend/**/*.{mjs,css,md}': (files) => [
    `node frontend/scripts/run-in-frontend.mjs prettier --write ${quote(files)}`,
  ],
};
