// Pre-commit formatting and linting of staged files (husky .husky/pre-commit).
// Uses the backend's own Prettier/ESLint binaries and config so results match CI exactly.
const quote = (files) => files.map((f) => JSON.stringify(f)).join(' ');

export default {
  'backend/**/*.ts': (files) => [
    `node backend/node_modules/prettier/bin/prettier.cjs --write ${quote(files)}`,
    `node backend/node_modules/eslint/bin/eslint.js --config backend/eslint.config.mjs --fix --max-warnings 0 ${quote(files)}`,
  ],
};
