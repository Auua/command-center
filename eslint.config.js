import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const rootDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(rootDir, 'apps/web');

// eslint-config-next is installed in apps/web, so resolve it from there.
// Only core-web-vitals is pulled in: next/typescript would register a second
// @typescript-eslint plugin instance, and the root typescript-eslint presets
// below already cover everything it adds.
const compat = new FlatCompat({ baseDirectory: webDir });

export default tseslint.config(
  // 0. Never lint build output or generated files
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.vercel/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/web/next-env.d.ts',
      '.claude/**',
    ],
  },

  // 1. Apply recommended JS and TS rules
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,

  // 2. Next.js rules, scoped to the web app (before block 3 so the shared
  // project rules win on any overlap)
  ...compat.extends('next/core-web-vitals').map((config) => ({
    ...config,
    files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
    settings: {
      ...config.settings,
      next: { rootDir: webDir },
    },
  })),

  // 3. Project configuration and strict type requirements
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Enforces explicit return types on functions and class methods
      '@typescript-eslint/explicit-function-return-type': 'error',

      // Enforces explicit types on exported module boundaries
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      // Warns or errors against using the unsafe 'any' type, forcing real types
      '@typescript-eslint/no-explicit-any': 'error',

      // General code quality rules
      'no-unused-vars': 'off', // Turn off base rule as TS handles it
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],

      // NestJS modules/guards are decorated, intentionally empty classes
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },

  // 4. Type-aware parsing for TS files: projectService resolves each file
  // against its own package's tsconfig (a single shared `project` path can't
  // cover a monorepo). Scoped to TS so plain-JS config files need no tsconfig.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Vercel entrypoint imports ../dist, so it lives outside the api
          // tsconfig on purpose — parse it with the default project instead
          allowDefaultProject: ['apps/api/api/index.ts'],
        },
        tsconfigRootDir: rootDir,
      },
    },
  },

  // 5. Run Prettier as a fixable lint rule (and disable conflicting stylistic
  // rules via the bundled eslint-config-prettier) — `eslint --fix` formats
  prettierRecommended,
);
