// ESLint flat config (ESM). Pragmatic baseline: catch real bugs (undefined
// vars, unused values) without fighting the existing style. Prettier owns
// formatting (eslint-config-prettier disables stylistic rules).
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import ebgeoTests from './eslint-rules/index.js';

export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'coverage/**',
      'docs/**',
      // Deliberately-broken samples that exist to prove the local rules fire.
      // Linting them normally would make `npm run lint` red by design.
      'eslint-rules/__fixtures__/**',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Ignore unused function args named req/res/next or _-prefixed, and
      // unused catch bindings (common, harmless patterns in this codebase).
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_|^(req|res|next)$', caughtErrors: 'none' },
      ],
    },
  },
  {
    // Tests frequently declare bindings for readability/intent (response
    // objects asserted inline, scaffolding). Keep no-undef strict but downgrade
    // unused-vars to a warning so CI stays green without churning test files.
    files: ['tests/**/*.js'],
    plugins: { 'ebgeo-tests': ebgeoTests },
    rules: {
      'no-unused-vars': 'warn',
      // Structural blind spot #3 of testes-backend.md: an assertion that only
      // runs when an unverified condition holds is empty coverage — it passes
      // green with the code arbitrarily wrong. Negative control for these three
      // rules: `node eslint-rules/probe.js` (wired into `npm run lint`).
      'ebgeo-tests/no-conditional-assert': 'error',
      'ebgeo-tests/no-disjunctive-assert': 'error',
      'ebgeo-tests/no-unasserted-loop-assert': 'error',
    },
  },
  prettier,
];
