// Pre-commit formatting and linting of staged files (husky .husky/pre-commit).
// Each app uses its own Prettier/ESLint binaries and config so results match CI exactly.
// Frontend commands run inside frontend/ so ESLint and Prettier pick up its config files.
const quote = (files) => files.map((f) => JSON.stringify(f)).join(' ');

export default {
  '.github/scripts/**/*.mjs': (files) => [
    `node backend/node_modules/prettier/bin/prettier.cjs --config backend/.prettierrc --write ${quote(files)}`,
  ],
  'backend/**/*.ts': (files) => [
    `node backend/node_modules/prettier/bin/prettier.cjs --write ${quote(files)}`,
    `node backend/node_modules/eslint/bin/eslint.js --config backend/eslint.config.mjs --fix --max-warnings 0 ${quote(files)}`,
  ],
  'frontend/**/*.{ts,tsx,mts,mjs,css,json,md}': (files) => [
    `node frontend/scripts/run-in-frontend.mjs prettier --write ${quote(files)}`,
  ],
  'frontend/src/**/*.{ts,tsx}': (files) => [
    `node frontend/scripts/run-in-frontend.mjs eslint --fix --max-warnings 0 ${quote(files)}`,
  ],
};
