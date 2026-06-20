// ESLint flat config (ESM). Pragmatic baseline: catch real bugs (undefined
// vars, unused values) without fighting the existing style. Prettier owns
// formatting (eslint-config-prettier disables stylistic rules).
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/**', 'data/**', 'coverage/**', 'docs/**'] },
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
    rules: {
      'no-unused-vars': 'warn',
    },
  },
  prettier,
];
