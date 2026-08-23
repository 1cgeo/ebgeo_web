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
    // This block used to downgrade `no-unused-vars` to 'warn' "so CI stays green
    // without churning test files". Both halves were dead: there is no CI in this
    // repository (no .github/, no git hook outside the .sample files), and the lint
    // script runs eslint with `--max-warnings 0`, which fails on a warning exactly
    // like an error. The tolerance the comment promised never existed, and reading it
    // as if it did is how a run comes back red for a reason nobody expected.
    //
    // Promoted to 'error' because the tree is clean today, so the level now says what
    // the command already does. A severity-only entry keeps the options configured
    // above (argsIgnorePattern, caughtErrors), which is why they are not repeated.
    files: ['tests/**/*.js'],
    plugins: { 'ebgeo-tests': ebgeoTests },
    rules: {
      'no-unused-vars': 'error',
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
