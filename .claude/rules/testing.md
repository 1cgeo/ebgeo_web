# Testing Rules

Full guide: `frontend/tests/TESTING.md`. Quick rules for working in this repo:

## When to add tests
- New pure logic (math, geometry, parsing, conversion, formatting) → add a unit
  test in `tests/unit/`, including **at least one edge case** (not just happy path).
- Fixed a bug → add a regression test `tests/<area>/<bug>.repro.test.js` that
  documents the root cause (model: `frontend/tests/integration/import-phantom-map.repro.test.js`).
- Don't hand-test in the chat what a unit test can pin down.

## How to write them
- Environment is `node` (no jsdom). Test **pure functions**, not DOM/MapLibre.
  Keep calculations in `add_*_geometry.js`-style pure modules and test those.
- Edge-case checklist: `null`/`undefined`/`NaN`/`Infinity`, empty, boundaries
  (±90 lat, ±180 lng, 0/360 azimuth), sign/`-0`/modulo wrap, hemispheres,
  antimeridian, round-trips, unit conversions. Remember `x ?? 0` does NOT guard
  `NaN` — use `Number.isFinite`.
- For math/geometry/coordinates prefer **fast-check** invariants (round-trip,
  idempotence, output-range) over hand-picked examples.
- Reuse factories in `frontend/tests/helpers/test-utils.js`. To test a `*_geometry.js`
  that imports the `@tools` barrel, mock `@tools` with a trivial `BaseGeometry`
  (see `frontend/tests/unit/sector-geometry.test.js`). Stub `globalThis.turf` only with
  the methods used.

## Before claiming done
- **Logic**: `npm run lint` and `npm test` **from the repo root**, as separate
  commands run BEFORE any commit. On one command line the lint output lands after
  the commit already succeeded, which is not verification.

  Until 2026-07-25 both root scripts delegated to `frontend/` only, so a
  backend-only change verified exactly as this rule prescribed ran **zero** backend
  tests and came back green: the rule pointed at a guard that did not guard. They
  now run both packages, and the backend lint gained `--max-warnings 0`, which the
  frontend already had (the same warning used to fail one package and pass the
  other).

  **Saiba o que o `npm test` da raiz cobra de você.** Ele encadeia TRÊS pernas:
  `test:frontend` (vitest, node puro), `test:backend` (exige PostgreSQL + PostGIS +
  superusuário) e `test:e2e`, que sobe o BACKEND REAL num `globalSetup` e roda as
  specs `tests/e2e/**` contra ele. Ou seja, o comando que a constituição chama de
  "verificação de lógica" precisa de banco no ar; sem ele a terceira perna falha por
  ambiente, não por código, e é fácil ler esse vermelho como regressão. O que ele NÃO
  roda é o Playwright (`test:e2e:ui`), que é outro comando.

  When you only touched one package, `npm run lint:backend` / `test:backend` (or
  the `:frontend` pair) is the faster loop; just don't mistake it for the whole
  check before a commit that crosses the boundary.
- **UI**: no preview or interactive-browser tool. The approved loop is a
  Playwright capture driving the real app and backend, then READING the produced
  image. Delete the temporary spec afterwards. `npm run test:e2e:ui`.
- There is **no CI of any kind and no git hooks** — everything is run manually.
  (The GitHub Pages workflow was removed on 2026-07-18 along with the dead
  `prepare-deploy.js` it depended on; see [[deploy-web]].)
- **Coverage is a floor, not a report** (backend), desde 2026-07-25. Era
  "report-only, no threshold", e um número sem piso pode cair de 95% para 60%
  entre dois commits sem nada ficar vermelho. Agora `.c8rc.json` tem
  `check-coverage` e o `scripts/run-tests.js` se auto-eleva para `c8` quando roda
  a suíte completa, então **`npm test` sem argumento verifica o piso**;
  `npm test -- <arquivo>` não (um arquivo só contra piso GLOBAL reprovaria
  sempre). Racional e números em `backend/README.md`.
- **Três regras de lint próprias vigiam cobertura vazia em teste** (backend,
  `backend/eslint-rules/`): `no-conditional-assert` (assert dentro de `if` cuja
  condição não foi asserida), `no-disjunctive-assert` (`assert.ok(A || B)`) e
  `no-unasserted-loop-assert` (laço sobre coleção de tamanho não asserido). Na
  primeira execução acharam **46 violações reais** em 28 arquivos. O
  `npm run lint` do backend roda `eslint-rules/probe.js` ANTES do eslint: o probe
  verifica as regras contra fixtures de deve-pegar e não-deve-pegar, porque
  regra de lint também é verificador e verificador quebra calado.
- One Claude Code hook remains (`.claude/settings.json`):
  `.claude/hooks/lint-on-write.js` lints every `.js`/`.css` write and reports back.
  It was DEAD for months, reading a `$TOOL_INPUT_FILE_PATH` that Claude Code never
  sets, while CLAUDE.md promised its output appeared after every write. **If you
  change it, probe it**: write a file with a known error and confirm the report
  arrives. A guard is worth only what its last probe proved.

  **Última sondagem: 2026-08-14, viva nos quatro caminhos.** `.js` sujo no frontend
  (pegou `no-unused-vars`), `.css` sujo no frontend (pegou `color-hex-length` e
  `declaration-block-no-duplicate-properties`), `.js` sujo no backend (o walk-up
  achou o outro pacote) e arquivo limpo (silêncio). Anote a data e o resultado ao
  re-sondar: sem isso "probe it" é conselho sem prazo de validade, e foi assim que a
  versão anterior passou meses morta.
- It resolves the linter by walking up from the edited file to the nearest package
  that CONFIGURES it (`eslint.config.js` / `stylelint.config.js`), which is what
  makes it work in both packages. Silence means clean; a broken install says so out
  loud. Do not "fix" a noisy hook by making it fail quiet, which is how the
  previous one hid.
- **O frontend TAMBÉM tem regras próprias, desde 2026-08** (`frontend/eslint-rules/`,
  ligadas em `frontend/eslint.config.js` sobre `src/**/*.js`, e o `lint:js` roda o
  `eslint-rules/probe.js` ANTES do eslint, como no backend): `require-path-comment`,
  `no-event-string-literal`, `no-json-clone`, `no-inline-style-assignment` e
  `no-unescaped-innerhtml`. Esta linha afirmou por meses o contrário ("o ESLint do
  frontend não tem UMA regra de projeto, nenhuma convenção é mecânica"), e cinco
  convenções da constituição saíram da prosa desde então.
- **Saiba o alcance delas, que é estreito de propósito.** Com `--max-warnings 0` uma
  regra ruidosa é uma regra que alguém desliga, então cada uma foi medida contra os
  ~601 arquivos e comprada com zero falso positivo, pagando em falso negativo. O que
  cada uma deliberadamente NÃO pega está escrito no topo do próprio arquivo, e vale
  ler antes de concluir "o lint não reclamou, então está dentro da convenção". Os
  buracos que mais custam: `no-unescaped-innerhtml` só dispara quando a interpolação
  usa os nomes de campo de dado do usuário (`nome`, `descricao` e afins), e das 214
  interpolações cruas medidas reporta 3; `no-inline-style-assignment` ignora a
  atribuição de UMA propriedade (`el.style.left = ...`, 617 ocorrências, a maioria
  legitimamente computada) e só acusa o bloco estático; `no-json-clone` não pega a
  forma em dois passos (`stringify` numa linha, `parse` na outra);
  `no-event-string-literal` só reconhece o barramento da casa pelo nome do receptor,
  então mini-emissor privado (`toolManager`, `wsClient`) passa. **Import por alias
  continua sem regra nenhuma**, cobrado por leitura.
- Verde do lint no frontend significa hoje "sem erro de sintaxe, sem variável não
  usada e sem violação das cinco regras acima **no recorte que elas cobrem**", não
  "dentro da convenção".

## Collaboration / sync e2e
- For multi-user (collab/sync) behavior, prefer the **SyncLedger** deterministic waits
  (`frontend/tests/e2e-ui/helpers/trace-helpers.js` — `waitForRemoteEntity`/`waitForStage`) over
  store polling; on timeout they name the last sync stage reached. See
  `frontend/tests/e2e-ui/README.md` §"SyncLedger trace helpers".
