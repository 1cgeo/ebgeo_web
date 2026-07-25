// Path: eslint-rules/probe.js
// Negative control for the local lint rules. A linter is a verifier, and the
// most expensive lesson in this repo is that the verifier also breaks, and
// breaks quietly: a rule whose selector stops matching reports zero problems
// and looks exactly like a clean codebase.
//
// This probe runs the rules over __fixtures__/ and fails loudly unless every
// `// EXPECT: <rule>` marker in should-flag.js is reported AND should-pass.js
// is completely silent. Wired into `npm run lint` so it cannot rot unnoticed.
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

if (failures.length > 0) {
  console.error('\n❌ Controle negativo das regras locais FALHOU:\n');
  failures.forEach((f) => console.error('  ' + f + '\n'));
  process.exit(1);
}

console.log(
  `✅ Controle negativo ok: ${want.length} violações pegas em should-flag.js, 0 falsos positivos em should-pass.js`
);
