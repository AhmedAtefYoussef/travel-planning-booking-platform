import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Layered architecture (see README "Project structure"): app -> features -> shared.
 * - shared/ is the bottom layer: it never imports a feature or a route.
 * - features/ never import routes, and reach another feature only through its public
 *   index (`@/features/<name>`), never its internals.
 * Mirrors the backend's dependency-cruiser rules so both halves of the repo read the same way.
 */
const noRouteImports = {
  group: ['@/app/*', '@/app'],
  message:
    'Only src/app may import routes; move shared code into features/ or shared/.',
};
const noDeepFeatureImports = {
  group: ['@/features/*/*'],
  message:
    "Import another feature through its public index ('@/features/<name>').",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/proxy.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noDeepFeatureImports] }],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [noRouteImports, noDeepFeatureImports] },
      ],
    },
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noRouteImports,
            {
              group: ['@/features/*', '@/features'],
              message:
                'shared/ is the bottom layer and cannot depend on a feature.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
