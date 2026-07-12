import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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

  // 2. Project configuration and strict type requirements
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

  // 3. Defer stylistic rules to Prettier so they don't clash
  prettier,
);
