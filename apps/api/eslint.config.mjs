// Minimal ESLint 9 flat config for Phase 0.
// TypeScript-aware linting (typescript-eslint + shared preset in
// @command-center/config) is a follow-up; for now this lints the plain
// JS config files and enforces ignores so `pnpm lint` is wired into turbo.
export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "off",
    },
  },
];
