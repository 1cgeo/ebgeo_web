// Path: eslint.config.js

import js from '@eslint/js';
import globals from 'globals';
import ebgeo from './eslint-rules/index.js';

/**
 * ESLint Flat Configuration for EBGEO Project
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 */
export default [
    // Base recommended rules
    js.configs.recommended,

    // Convenções da casa, antes prosa e agora mecânicas. Cada regra foi MEDIDA
    // contra os 601 arquivos antes de entrar, porque com `--max-warnings 0` uma
    // regra que acusa centenas é uma regra que alguém desliga, e o que cada uma
    // deliberadamente NÃO pega está no topo do próprio arquivo.
    // O controle negativo delas é `eslint-rules/probe.js`, que roda ANTES do
    // eslint em `npm run lint:js`: regra de lint também é verificador, e
    // verificador quebra calado.
    {
        files: ['src/**/*.js'],
        plugins: { ebgeo },
        rules: {
            'ebgeo/require-path-comment': 'error',
            'ebgeo/no-event-string-literal': 'error',
            'ebgeo/no-json-clone': 'error',
            'ebgeo/no-inline-style-assignment': 'error',
            'ebgeo/no-unescaped-innerhtml': 'error',
        },
    },

    // Global configuration
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2021,
                // External libraries loaded via script tags
                maplibregl: 'readonly',
                turf: 'readonly',
                milsymbol: 'readonly',
                Cesium: 'readonly',
                localforage: 'readonly',
                Sortable: 'readonly',
                proj4: 'readonly',
                // Node.js globals for config files
                process: 'readonly',
                __dirname: 'readonly'
            }
        },

        rules: {
            // ===== ERROR PREVENTION =====
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_'
            }],
            'no-undef': 'error',
            'no-redeclare': 'error',
            'no-duplicate-case': 'error',
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-extra-boolean-cast': 'error',
            'no-irregular-whitespace': 'error',
            'no-loss-of-precision': 'error',
            'no-misleading-character-class': 'error',
            'no-prototype-builtins': 'warn',
            'no-template-curly-in-string': 'warn',
            'no-unreachable': 'error',
            'no-unsafe-finally': 'error',
            'no-unsafe-optional-chaining': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',

            // ===== BEST PRACTICES =====
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            'no-caller': 'error',
            'no-eval': 'error',
            'no-extend-native': 'error',
            'no-implied-eval': 'error',
            'no-iterator': 'error',
            'no-labels': 'error',
            'no-lone-blocks': 'error',
            'no-multi-str': 'error',
            'no-new-func': 'error',
            'no-new-wrappers': 'error',
            'no-octal-escape': 'error',
            'no-proto': 'error',
            'no-return-assign': ['error', 'except-parens'],
            'no-self-compare': 'error',
            'no-sequences': 'error',
            'no-throw-literal': 'error',
            'no-unmodified-loop-condition': 'error',
            'no-useless-call': 'error',
            'no-useless-concat': 'error',
            'no-useless-escape': 'warn',
            'no-useless-return': 'warn',
            'no-void': 'error',
            'no-with': 'error',
            'prefer-promise-reject-errors': 'warn',
            'radix': 'error',

            // ===== ES6+ =====
            'no-var': 'error',
            'prefer-const': ['warn', { destructuring: 'all' }],
            'prefer-rest-params': 'error',
            'prefer-spread': 'error',
            'no-useless-computed-key': 'warn',
            'no-useless-constructor': 'warn',
            'no-useless-rename': 'warn',
            'no-duplicate-imports': 'error',
            'symbol-description': 'warn',

            // ===== CODE STYLE (minimal, non-controversial) =====
            'no-multiple-empty-lines': ['warn', { max: 2, maxEOF: 1 }],
            'no-trailing-spaces': 'warn',
            'eol-last': ['warn', 'always'],
            'no-tabs': 'error',
            'curly': ['error', 'multi-line', 'consistent'],
            'brace-style': ['warn', '1tbs', { allowSingleLine: true }],

            // ===== CONSOLE (allow in dev, removed by Terser in prod) =====
            'no-console': 'off',

            // ===== COMMENTS =====
            'spaced-comment': ['warn', 'always', {
                line: { markers: ['/'] },
                block: { balanced: true }
            }]
        }
    },

    // Config files (vite, eslint, etc.)
    {
        files: ['*.config.js', 'vite*.js'],
        languageOptions: {
            globals: {
                ...globals.node
            }
        }
    },

    // Ignore patterns
    {
        ignores: [
            'dist/**',
            'src_total/**',
            'node_modules/**',
            'public/**',
            '*.min.js',
            'server/**',
            '*/vendor/',
            // Amostras deliberadamente quebradas, que existem para provar que as
            // regras da casa disparam. Lintá-las normalmente deixaria o
            // `npm run lint` vermelho POR CONSTRUÇÃO. Precisa ser recursivo: a
            // árvore de `require-path-comment` tem um `src/js/` dentro, que é
            // justamente o caminho que aquela regra persegue.
            'eslint-rules/__fixtures__/**',
            // Artefato gerado. O ESLint 9 (flat config) NAO le o .gitignore por
            // conta propria — e por isso que dist/ e node_modules/ estao repetidos
            // aqui — e o script `lint:js` tambem nao recebe --ignore-path, ao
            // contrario do `lint:css`. Sem estas tres linhas, um `npm test` com
            // cobertura deixa o proximo `npm run lint` vermelho no JS do
            // relatorio HTML, e com --max-warnings 0 nao ha como distinguir isso
            // de um erro real do codigo da casa.
            'coverage/**',
            'test-results/**',
            'playwright-report/**',
            'blob-report/**',
            // O backend é um pacote próprio com regras próprias
            // (backend/eslint.config.js). `npm run lint:backend` cuida dele.
            'backend/**'
        ]
    }
];
