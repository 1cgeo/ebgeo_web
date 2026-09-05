// Path: eslint-rules/no-maplibre-global.js
// The application reads MapLibre through the single entry point
// (`src/js/map/maplibre.js`), never through the `maplibregl` global.
//
// WHY THIS EXISTS. Until 2026-09-04 the library was a classic `<script>` (the
// UMD bundle in `public/vendors/maplibre-gl.js`), so the ONLY way to reach it
// was the global, and 28 files of `src/js/` did exactly that. The 6.x line
// dropped UMD, the library moved into the npm/Vite module graph, and
// `src/js/map/maplibre.js` became the one file that imports it. That single
// point still assigns `window.maplibregl`, and the assignment is what this rule
// protects: it exists for the bench (`frontend/bench/`), for the Playwright
// specs that reach the library from inside `page.evaluate`, and for nothing
// else. Every module of the application that keeps reading the global gets the
// three defects the module graph would have caught:
//
//   - ORDER. A global is only there after the entry has run the single point's
//     body. A module that touches `maplibregl` at module scope (a constant, a
//     class field default) reads `undefined`, and the symptom is a
//     `new undefined.Map` far from the cause. An import cannot be out of order.
//   - GRAPH. The bundler does not see the edge, so it cannot tell that a page
//     pulls MapLibre in. `paginas-sem-mapa-nao-arrastam-a-store.test.js` walks
//     that graph to keep `atlas.html` and `admin.html` free of the map bundle;
//     an invisible edge is a hole in that guard.
//   - TESTS. The vitest env is `node`, where the seam for a global is
//     `globalThis.maplibregl = {...}` in a `beforeEach` and an undo in
//     `afterEach`. Leak the undo and the next file in the same worker inherits
//     the double. `vi.mock('@js/map/maplibre.js')` is scoped to the file.
//
// WHY NOT `no-restricted-globals`. The core rule reports a reference to the
// global BINDING, which covers `maplibregl.Map` but is blind to
// `window.maplibregl`, `globalThis.maplibregl` and `self.maplibregl` — those
// are member reads on another object, not references to the binding. The blind
// half is not hypothetical: `src/js/terrain/terrain-elevation.js` reached the
// library as `globalThis.maplibregl?.LngLat`, which is also why a `grep` for
// `maplibregl.` missed it (the `?.` breaks the pattern). A rule that catches
// the plain form and misses the guarded one teaches people to write the
// guarded one.
//
// Deliberately NOT flagged (a false positive turns `--max-warnings 0` red and
// gets the rule switched off):
//   - the single entry point itself, `src/js/map/maplibre.js`, which is where
//     the global is published. The exception is by PATH, and it is proved in
//     BOTH directions by `eslint-rules/__fixtures__/no-maplibre-global/`: the
//     entry point stays silent, a sibling under the same `src/js/` does not. An
//     exception that only gets tested for silence is an exception that can grow
//     to cover the tree without anyone noticing.
//   - anything outside `src/**`, because the rule is wired for `src/**/*.js`
//     only. `frontend/tests/**` and `frontend/bench/**` reach the global on
//     purpose: a Playwright spec runs its `page.evaluate` in a page where the
//     app has already booted, and the bench drives a built page it does not
//     import.
//   - a LOCAL binding named `maplibregl`, including the import this rule wants
//     people to write (`import { maplibregl } from '@js/map/maplibre.js'`) and
//     a parameter or test double of the same name. The check is scope-based,
//     not textual, so the fix silences the report by construction.
//   - the string `maplibregl` inside a CSS selector or a comment
//     (`.maplibregl-canvas`), which is the class name the library writes on the
//     DOM and has nothing to do with the JS global.

/** The one file allowed to publish the global, matched against its real path. */
const PONTO_UNICO = '/src/js/map/maplibre.js';

/** Objects whose `maplibregl` property IS the global, spelled another way. */
const PORTADORES_DO_GLOBAL = new Set(['window', 'globalThis', 'self']);

/**
 * True when the file is the single entry point, which is where the global is
 * published and therefore the only place allowed to name it.
 *
 * @param {string} filename Absolute path as ESLint reports it.
 * @returns {boolean}
 */
function isSingleEntryPoint(filename) {
    if (typeof filename !== 'string') return false;
    return filename.replace(/\\/g, '/').endsWith(PONTO_UNICO);
}

/**
 * The identifier resolves to no binding in any enclosing scope, i.e. it is the
 * global. A parameter, an import or a local named `window` shadows it, and then
 * the member read is somebody else's property.
 *
 * @param {Object} scope The scope the reference was found in.
 * @param {string} name
 * @returns {boolean}
 */
function isUnshadowedGlobal(scope, name) {
    for (let atual = scope; atual; atual = atual.upper) {
        const variavel = atual.set.get(name);
        // A variable that exists in the GLOBAL scope is either declared by
        // `languageOptions.globals` (the case here) or by a script-scope
        // declaration; either way it is not a local binding.
        if (variavel && atual.type !== 'global') return false;
    }
    return true;
}

export default {
    meta: {
        type: 'problem',
        docs: {
            description:
                'proíbe ler o MapLibre pelo global `maplibregl` em `src/**` — importe o ponto único `map/maplibre.js`',
        },
        schema: [],
        messages: {
            global:
                'O MapLibre não se lê pelo global. Importe o ponto único: `import { maplibregl } from \'@js/map/maplibre.js\';` (ou pelo caminho relativo, se o arquivo ainda usa `../`). O global só existe depois que o entry da página rodou o corpo daquele arquivo, então quem o lê no corpo do módulo lê `undefined`, e o bundler não enxerga a aresta que `paginas-sem-mapa-nao-arrastam-a-store.test.js` vigia.',
            portador:
                'O MapLibre não se lê por `{{objeto}}.maplibregl`. Importe o ponto único: `import { maplibregl } from \'@js/map/maplibre.js\';`. A forma com `?.` engana duas vezes: some do `grep` por `maplibregl.` e transforma "a biblioteca não carregou ainda" num caminho alternativo silencioso.',
        },
    },
    create(context) {
        if (isSingleEntryPoint(context.filename ?? context.getFilename())) return {};

        const sourceCode = context.sourceCode;

        return {
            MemberExpression(node) {
                if (node.computed) return;
                if (node.object.type !== 'Identifier') return;
                if (!PORTADORES_DO_GLOBAL.has(node.object.name)) return;
                if (node.property.type !== 'Identifier' || node.property.name !== 'maplibregl') return;
                if (!isUnshadowedGlobal(sourceCode.getScope(node), node.object.name)) return;

                context.report({
                    node,
                    messageId: 'portador',
                    data: { objeto: node.object.name },
                });
            },

            Identifier(node) {
                if (node.name !== 'maplibregl') return;
                // A property, a key or a member's property name is not a
                // reference to the binding: `algo.maplibregl` is handled above,
                // and `{ maplibregl: x }` is a key.
                const pai = node.parent;
                if (pai?.type === 'MemberExpression' && pai.property === node && !pai.computed) return;
                if (pai?.type === 'Property' && pai.key === node && !pai.computed) return;
                if (pai?.type === 'ImportSpecifier' || pai?.type === 'ExportSpecifier') return;
                if (!isUnshadowedGlobal(sourceCode.getScope(node), 'maplibregl')) return;

                context.report({ node, messageId: 'global' });
            },
        };
    },
};
