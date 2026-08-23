// Path: eslint-rules/probe.js
// Negative control for the local lint rules. A linter is a verifier, and the
// most expensive lesson in this repo is that the verifier also breaks, and
// breaks quietly: a rule whose selector stops matching reports zero problems
// and looks exactly like a clean codebase.
//
// This probe runs the rules over __fixtures__/ and fails loudly unless every
// `// EXPECT: <rule>` marker in should-flag.js is reported, should-pass.js is
// completely silent, AND every rule registered in index.js owns at least one
// marker. The third condition is not decoration: without it a rule added to the
// plugin without a fixture is never executed against anything, and the probe
// reports success having proved one fewer rule than it claims. Wired into
// `npm run lint` so it cannot rot unnoticed.
import { ESLint } from 'eslint';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import plugin from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '__fixtures__');

const RULES = Object.keys(plugin.rules).map((r) => `ebgeo-tests/${r}`);

const eslint = new ESLint({
  cwd: here,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.js'],
      languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
      plugins: { 'ebgeo-tests': plugin },
      rules: Object.fromEntries(RULES.map((r) => [r, 'error'])),
    },
  ],
});

function expectedFrom(file) {
  return [...readFileSync(file, 'utf8').matchAll(/\/\/ EXPECT: ([\w-]+)/g)].map(
    (m) => `ebgeo-tests/${m[1]}`
  );
}

const failures = [];

const flagFile = join(fixtures, 'should-flag.js');
const [flagResult] = await eslint.lintFiles([flagFile]);
const got = flagResult.messages.map((m) => m.ruleId).sort();
const want = expectedFrom(flagFile).sort();
if (JSON.stringify(got) !== JSON.stringify(want)) {
  failures.push(
    `should-flag.js: esperado ${JSON.stringify(want)}, obtido ${JSON.stringify(got)}\n` +
      flagResult.messages.map((m) => `    line ${m.line}: ${m.ruleId} — ${m.message}`).join('\n')
  );
}

const passFile = join(fixtures, 'should-pass.js');
const [passResult] = await eslint.lintFiles([passFile]);
if (passResult.messages.length > 0) {
  failures.push(
    `should-pass.js: falso positivo (${passResult.messages.length})\n` +
      passResult.messages.map((m) => `    line ${m.line}: ${m.ruleId} — ${m.message}`).join('\n')
  );
}

// ---- um probe que não verifica nada não pode passar ----
// As duas comparações acima são de IGUALDADE entre o que a fixture declara e o que
// as regras acusaram, e igualdade é satisfeita por dois vazios. Duas formas disso,
// e nenhuma faz barulho sozinha:
//
//   1. os marcadores somem (fixture reescrita, regra renomeada): `want` fica vazio,
//      `got` fica vazio, `should-pass.js` continua silencioso, e o probe imprime
//      sucesso tendo provado zero;
//   2. uma regra NOVA entra no `index.js` sem ganhar caso na fixture. As regras
//      cobertas continuam batendo, `got === want`, e o probe imprime verde tendo
//      provado três de quatro. A regra nova nunca foi executada contra nada.
//
// É a mesma cobertura vazia que `no-conditional-assert` e as irmãs existem para
// caçar, no arquivo que existe para impedi-la. O probe do frontend já fecha as duas;
// esta é a metade que faltava aqui.
if (want.length === 0) {
  failures.push('nenhum marcador EXPECT em should-flag.js: o probe não verificaria nada');
}

const cobertas = new Set(want.map((r) => r.replace('ebgeo-tests/', '')));
for (const regra of Object.keys(plugin.rules)) {
  if (!cobertas.has(regra)) {
    failures.push(`${regra}: registrada no plugin e SEM caso em should-flag.js — regra não provada`);
  }
}

if (failures.length > 0) {
  console.error('\n❌ Controle negativo das regras locais FALHOU:\n');
  failures.forEach((f) => console.error('  ' + f + '\n'));
  process.exit(1);
}

console.log(
  `✅ Controle negativo ok: ${want.length} violações pegas em should-flag.js, ` +
    `0 falsos positivos em should-pass.js, ${Object.keys(plugin.rules).length} regras provadas`
);
