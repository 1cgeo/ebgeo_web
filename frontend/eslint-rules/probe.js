// Path: eslint-rules/probe.js
// Negative control for the local lint rules. A linter is a verifier, and the
// most expensive lesson in this repo is that the verifier also breaks, and
// breaks quietly: a rule whose selector stops matching reports zero problems and
// looks exactly like a clean codebase. The web package learned this twice in one
// night, from the other side: the knip config pointed at three of four pages and
// called live code dead, and the wiki linter matched a pre-monorepo path prefix
// and reported "cites no code" on the 44 pages citing the correct path.
//
// This probe fails loudly unless every `// EXPECT: <rule>` marker is reported AND
// the should-pass side is completely silent. It is wired into `npm run lint`, so
// it cannot rot unnoticed.
//
// TWO FIXTURE SHAPES, and the second one exists because of a real blind spot.
// Most rules are about a CONSTRUCT, so a single flat file exercises them. But
// `require-path-comment` is about the FIRST LINE of a file plus where that file
// sits on disk, so it cannot be exercised from inside a shared fixture: a probe
// that only read the two flat files would pass green while verifying nothing
// about it. Hence the nested tree, whose paths are the fixture.
//
// `no-maplibre-global` needs a nested tree for the same reason and in the OTHER
// direction: its exception (the single entry point may name the global) is by
// path, so proving it means two real files under a real `src/js/`, one that must
// stay silent and one, its neighbour, that must not. Checking only the silent
// half would pass an exception that had grown to cover the whole tree.
import { ESLint } from 'eslint';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import plugin from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '__fixtures__');

const RULES = Object.keys(plugin.rules).map((r) => `ebgeo/${r}`);

const eslint = new ESLint({
    cwd: here,
    overrideConfigFile: true,
    overrideConfig: [
        {
            files: ['**/*.js'],
            languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
            plugins: { ebgeo: plugin },
            rules: Object.fromEntries(RULES.map((r) => [r, 'error'])),
        },
    ],
});

/**
 * Rules a fixture file declares it must trigger, read from its own markers.
 *
 * @param {string} file
 * @returns {string[]}
 */
function expectedFrom(file) {
    return [...readFileSync(file, 'utf8').matchAll(/\/\/ EXPECT: ([\w-]+)/g)]
        .map((m) => `ebgeo/${m[1]}`);
}

const failures = [];

// ---- flat fixtures: one file that must fire, one that must stay silent ----
const flagFile = join(fixtures, 'should-flag.js');
const passFile = join(fixtures, 'should-pass.js');

const [flagged] = await eslint.lintFiles([flagFile]);
const [passed] = await eslint.lintFiles([passFile]);

const esperado = expectedFrom(flagFile);
const obtido = flagged.messages.map((m) => m.ruleId);

for (const regra of new Set(esperado)) {
    const querido = esperado.filter((r) => r === regra).length;
    const achado = obtido.filter((r) => r === regra).length;
    if (achado < querido) {
        failures.push(`${regra}: should-flag.js declara ${querido} caso(s) e a regra pegou ${achado}`);
    }
}
for (const m of passed.messages) {
    failures.push(`${m.ruleId}: FALSO POSITIVO em should-pass.js linha ${m.line} — ${m.message}`);
}

// ---- nested fixture: the file-level rule, whose subject is the path itself ----
const arvore = join(fixtures, 'require-path-comment');
const deveAcusar = [
    join(arvore, 'src/js/missing-header.js'),
    join(arvore, 'src/js/wrong-header.js'),
];
const deveCalar = [
    join(arvore, 'src/js/correct-header.js'),
    join(arvore, 'src/js/nested/deep-file.js'),
    join(arvore, 'tests/out-of-scope.js'),
];

for (const arquivo of deveAcusar) {
    const [res] = await eslint.lintFiles([arquivo]);
    const n = res.messages.filter((m) => m.ruleId === 'ebgeo/require-path-comment').length;
    if (n !== 1) {
        failures.push(`require-path-comment: ${arquivo} devia render 1 report e rendeu ${n}`);
    }
}
for (const arquivo of deveCalar) {
    const [res] = await eslint.lintFiles([arquivo]);
    for (const m of res.messages) {
        failures.push(`${m.ruleId}: FALSO POSITIVO em ${arquivo} linha ${m.line} — ${m.message}`);
    }
}

// ---- nested fixture: the path EXCEPTION, proved in both directions ----
// The entry point and its neighbour sit in the same `src/js/` tree on purpose.
// If the exception ever widened (a folder match, a `src/js/` match), the
// neighbour would fall silent, and only this half of the pair would notice.
const arvoreMaplibre = join(fixtures, 'no-maplibre-global');
const pontoUnico = join(arvoreMaplibre, 'src/js/map/maplibre.js');
const vizinho = join(arvoreMaplibre, 'src/js/tool_manager/vizinho-do-ponto-unico.js');

const [resPontoUnico] = await eslint.lintFiles([pontoUnico]);
for (const m of resPontoUnico.messages) {
    failures.push(`${m.ruleId}: FALSO POSITIVO em ${pontoUnico} linha ${m.line} — ${m.message}`);
}

const [resVizinho] = await eslint.lintFiles([vizinho]);
const queridosVizinho = expectedFrom(vizinho).length;
const achadosVizinho = resVizinho.messages
    .filter((m) => m.ruleId === 'ebgeo/no-maplibre-global').length;
if (queridosVizinho === 0) {
    failures.push('no-maplibre-global: o vizinho do ponto unico perdeu os marcadores EXPECT');
}
if (achadosVizinho !== queridosVizinho) {
    failures.push(
        `no-maplibre-global: ${vizinho} declara ${queridosVizinho} caso(s) e a regra pegou ${achadosVizinho}`
    );
}

// ---- a probe that verifies nothing must not pass ----
// If the markers vanish (a fixture rewritten, a rule renamed), every loop above
// iterates over an empty list and the probe reports success. This is the same
// empty coverage the rules themselves exist to catch.
if (esperado.length === 0) {
    failures.push('nenhum marcador EXPECT em should-flag.js: o probe nao verificaria nada');
}
const cobertas = new Set([...new Set(esperado)].map((r) => r.replace('ebgeo/', '')));
cobertas.add('require-path-comment');   // coberta pela arvore aninhada
for (const regra of Object.keys(plugin.rules)) {
    if (!cobertas.has(regra)) {
        failures.push(`${regra}: registrada no plugin e SEM fixture — regra nao provada`);
    }
}

if (failures.length) {
    console.error('❌ Controle negativo das regras locais FALHOU:');
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(1);
}

const nRegras = Object.keys(plugin.rules).length;
console.log(
    `✅ Controle negativo ok: ${esperado.length} casos pegos em should-flag.js, `
    + `2 na arvore de caminho, ${achadosVizinho} na arvore do ponto unico `
    + `(e o ponto unico calado), 0 falsos positivos, ${nRegras} regras provadas`
);
