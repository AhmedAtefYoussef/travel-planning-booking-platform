// Conventional Commits (brief section 10.6), e.g. "feat(auth): implement registration [ACC-01]".
// Enforced locally by the husky commit-msg hook and in CI by pr-governance.yml.
const scopes = [
  // backend feature modules (brief section 1.1)
  'auth', 'accounts', 'users', 'admin', 'airlines', 'airports', 'flights', 'hotels', 'rooms',
  'bookings', 'flight-bookings', 'hotel-bookings', 'reviews', 'payments', 'refunds', 'policies',
  'itineraries', 'activities', 'budgets', 'currency', 'blog', 'posts', 'comments', 'tags',
  'reports', 'moderation', 'notifications', 'audit', 'uploads', 'reference', 'seed',
  // cross-cutting
  'common', 'config', 'contracts', 'health', 'security', 'swagger', 'db', 'api',
  // repo / delivery
  'repo', 'ci', 'deps', 'deps-dev', 'docs', 'frontend', 'release', 'test',
];

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', scopes],
    'header-max-length': [2, 'always', 100],
    'subject-min-length': [2, 'always', 8],
    'body-max-line-length': [1, 'always', 120],
  },
};
