# Testes: o núcleo

Guia completo: `frontend/tests/TESTING.md`. O detalhe de cada camada mora em arquivos com `paths:` (índice no fim), que carregam quando um arquivo daquela camada é lido.

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
  `NaN`; use `Number.isFinite`.

- For math/geometry/coordinates prefer **fast-check** invariants (round-trip,
  idempotence, output-range) over hand-picked examples.

- Reuse factories in `frontend/tests/helpers/test-utils.js`. To test a `*_geometry.js`
  that imports the `@tools` barrel, mock `@tools` with a trivial `BaseGeometry`
  (see `frontend/tests/unit/sector-geometry.test.js`). Stub `globalThis.turf` only with
  the methods used.

## Before claiming done

- **Logic, every commit**: `npm run lint` and `npm run test:tocados` from the repo
  root, as separate commands run BEFORE the commit (on one command line the lint
  output lands after the commit already succeeded). The script picks the suite from
  the git diff; `-- --plano` shows the choice without running anything.
- **Everything, `npm test` at the root**: before deploy, before taking work to
  main, and whenever `test:tocados` picks it (contract between the packages, or
  code in both). Owner's decision of 2026-09-24.

**Saiba o que o `npm test` da raiz cobra de você.** Ele encadeia TRÊS pernas:
`test:frontend` (vitest, node puro), `test:backend` (exige PostgreSQL + PostGIS +
superusuário, e é 16 dos ~19 minutos) e `test:e2e`, que sobe o BACKEND REAL num
`globalSetup`. Sem banco a perna do backend falha por ambiente, não por código. O
que ele NÃO roda é o Playwright (`test:e2e:ui`), que é outro comando.

**`Test timed out` nos censos que varrem a árvore, com a `Duration` do
`test:frontend` muito acima dos ~55 s, é carga da máquina, não código** (medido em
2026-09-24: 11 casos a 91 s, zero a 51 s, mesmo commit). Leia a `Duration` antes
de diagnosticar, e repita com a máquina quieta; asserção que falha não tem essa
desculpa.

`test:fast` (`--reuse-db`) **exige um alvo** e recusa a suíte completa: ele troca
hermeticidade por tempo, e a rodada que vale antes do commit não pode fazer esse
câmbio. Vermelho em banco reaproveitado se confirma sem a bandeira antes de virar
diagnóstico, porque dado de rodada anterior também reprova. Não reponha o atalho antigo que chamava `node --test` direto (sem banco, sem migração, sem `c8`): ele reportava verde sem nada disso, e a história está em [testes-backend.md](testes-backend.md).

- **UI**: no preview or interactive-browser tool. The approved loop is a
  Playwright capture driving the real app and backend, then READING the produced
  image. Delete the temporary spec afterwards. `npm run test:e2e:ui`.

A captura espera o ESTADO, nunca o tempo: toast nascido em callback assíncrono ainda não existe na linha seguinte ao gesto, e toast só está legível quando a opacidade computada passa de 0,9. Quem recebe de um subagente "li a imagem" abre a imagem. Detalhe em [testes-playwright.md](testes-playwright.md).

**VERDE COM "flaky" NÃO É VERDE, e é o default aqui.**
`frontend/playwright.config.js` tem `retries: 1`, então a única camada que
exercita a UI re-executa o caso que falhou e, se ele passar na segunda tentativa,
a rodada FECHA verde com o defeito apenas rotulado `flaky` na saída do reporter.
Isso colide de frente com a seção "Verificação" da constituição ("uma medição de
algo probabilístico não é medição"): o que o retry produz é exatamente a medição
única de algo probabilístico, com o agravante de o próprio corredor já saber que
houve interleaving perdedora e não reprovar por ela. O comentário do config
justifica a escolha pelas specs de colaboração (duas a três browsers reais numa
rodada serial longa), e o custo de rodada é decisão do dono: **não mexa no
`retries`**. O que muda é a leitura. Ao ler a saída do `test:e2e:ui`, procure a
contagem de `flaky` ANTES de declarar verde; um caso que flakeia é um caso não
verificado, e se ele for o `_backend-required.spec.js` o que ficou mascarado foi
justamente o guarda do "verde por skip". Um caso que precisa medir corrida
desliga o retry em si mesmo, e há precedente:
`frontend/tests/e2e-ui/browser-multi-tab-namespace.spec.js` chama
`test.describe.configure({ retries: 0 })`, porque ali a corrida É o sujeito. Se o
seu caso mede tempo ou concorrência, copie esse opt-out; se você está
investigando um flake, rode em SÉRIE e relate a taxa, que é o que a constituição
pede.

Rode o Playwright de DENTRO de `frontend/`: da raiz o runner carrega os specs com outra instância de `@playwright/test` e termina em "No tests found" sem executar nada, com cara de rodada.

- There is **no CI of any kind and no git hooks**: everything is run manually.
  (The GitHub Pages workflow was removed on 2026-07-18 along with the dead
  `prepare-deploy.js` it depended on; see [[deploy-web]].)

- **Coverage is a floor, not a report** (backend), desde 2026-07-25. Era
  "report-only, no threshold", e um número sem piso pode cair de 95% para 60%
  entre dois commits sem nada ficar vermelho. Agora `.c8rc.json` tem
  `check-coverage` e o `scripts/run-tests.js` se auto-eleva para `c8` quando roda
  a suíte completa, então **`npm test` sem argumento verifica o piso**;
  `npm test -- <arquivo>` não (um arquivo só contra piso GLOBAL reprovaria
  sempre). Racional e números em `backend/README.md`.

- One Claude Code hook remains (`.claude/settings.json`):
  `.claude/hooks/lint-on-write.js` lints every `.js`/`.css` write and reports back.
  It was DEAD for months, reading a `$TOOL_INPUT_FILE_PATH` that Claude Code never
  sets, while CLAUDE.md promised its output appeared after every write. **If you
  change it, probe it**: write a file with a known error and confirm the report
  arrives. A guard is worth only what its last probe proved. A última sondagem, e a armadilha da própria sondagem no Git Bash, estão em [testes-frontend-e-lint.md](testes-frontend-e-lint.md).

## O shell desta máquina mente sobre barra invertida e fim de linha

O Bash da ferramenta é Git Bash, e ele erra calado de duas formas. Barra invertida dentro de `node -e`, heredoc ou `sed` chega mutilada (a dupla vira simples, ou vira caractere de controle); e `grep`, `sed` e `od` escondem o `\r` de arquivo CRLF, que é o que este checkout tem (`core.autocrlf=true`). O resultado tem cara de resultado: contagem zero, regra que nunca casa, "o arquivo é LF". Então: script com regex, barra invertida ou âncora de várias linhas vai para ARQUIVO escrito pelo editor e roda com `node`; fim de linha se mede dentro do `node`; e toda substituição por script conta os alvos e aborta se casar zero. O livro-razão tem seis ocorrências desta classe; as cinco primeiras terminavam em "codificado como prática da sessão", que é por que ela voltou.

## Rodadas concorrentes na mesma máquina

Antes de tratar diferença entre duas rodadas como regressão, pergunte se outra sessão escreveu no mesmo diretório entre elas (`git log --since` mais `git status`): nesta máquina, sessões diferentes já compartilharam o diretório de trabalho, e aí a sua rodada mede os arquivos da outra, meio escritos inclusive. Contagem de casos que muda entre rodadas do mesmo commit é contradição interna, e ela vence a hipótese de que o número é sobre o código. O arquivo ainda não commitado é a única fonte de divergência que não se reconstrói depois: combine antes.

**O MAPA DE QUEM POSSUI O QUÊ, medido em 2026-09-01**, porque descobrimos estas fronteiras
uma a uma, cada vez pagando uma colisão. Duas sessões só colidem se compartilharem uma
linha desta tabela:

| camada | porta | banco | escreve `coverage/tmp`? |
|---|---|---|---|
| `test:frontend` (vitest) | nenhuma | nenhum | não |
| `test:backend` | nenhuma | `ebgeo_test` (`TEST_DB_NAME` sobrepõe) | SIM, sob c8 |
| `test:e2e` (contrato, 3ª perna da raiz) | 3911 | `ebgeo_e2e` | não |
| `test:e2e:ui` e `test:e2e:mega` (Playwright) | 3912 **e 4321** | `ebgeo_ui_e2e` | não |
| `test:e2e:tablet` (Playwright, contexto com toque) | as MESMAS 3912 e 4321 | o MESMO | não |
| os configs de cenário (Playwright) | as MESMAS 3912 e 4321 (salvo `release-production`, com a 3912 literal) | o MESMO | não |

A RAIZ não é uma linha da tabela, ela são as TRÊS primeiras: `npm test` herda a linha do backend inteira (toma `ebgeo_test` e escreve em `coverage/tmp` sob c8), então duas raízes colidem entre si, e rodar a raiz durante uma medição de cobertura alheia a contamina. Quem roda só Playwright não colide com a raiz nem com o backend.

- **Isolar o backend** são DOIS eixos: banco por `TEST_DB_NAME` e cobertura por `npx c8 --temp-directory <dir> node scripts/run-tests.js` de dentro de `backend/`. Isolar só o banco deixa a cobertura exposta, e cobertura contaminada não grita: devolve uma porcentagem crível e menor (olhe o denominador antes de acreditar na porcentagem).

- **Isolar o Playwright** são TRÊS variáveis: `EBGEO_UI_E2E_APP_PORT`, `EBGEO_UI_E2E_BACKEND_PORT` e `EBGEO_UI_E2E_DB_NAME` (o banco já deriva do checkout). A porta 4321 é reusada em silêncio por `reuseExistingServer`, e aí a rodada mede o `src/` de OUTRO worktree.

- **`git stash` é do REPOSITÓRIO, não do worktree**: a pilha é a mesma para todos os worktrees, e um `pop` pode aplicar o trabalho de outra sessão e apagar a entrada dela, com sucesso e sem aviso. Não use `git stash` para medir linha de base com worktrees vivos (use `git worktree add` sobre o commit). Se já usou, recupere pelo SHA (`git fsck --unreachable`, `git stash store <sha>`, `git stash apply <sha>`), nunca pela posição.

- **Worktree de linha de base com junção de `node_modules`, no Windows**: `git worktree remove --force` ATRAVESSA a junção e apaga os pacotes reais. A ordem que não danifica: `git worktree add --detach <dir> <commit>`, `New-Item -ItemType Junction` para cada `node_modules`, o trabalho, `(Get-Item <junção>).Delete()` para CADA junção, e só então `git worktree remove --force` e `git worktree prune`. Nunca `Remove-Item -Recurse` nem `rm -rf` sobre a junção. Se o dano já aconteceu, `npm ci` no pacote, com o stack de desenvolvimento PARADO (a árvore de processos do Vite segura o binário nativo do rolldown).

## Índice das regras de teste com escopo

| arquivo | assunto |
|---|---|
| [testes-backend.md](testes-backend.md) | tempos medidos, `test:fast`, o atalho que saiu, banco e cobertura que colidem, ambiente explícito do runner, regras de lint de teste do backend |
| [testes-playwright.md](testes-playwright.md) | portas e configs de cenário, captura e toast, queda do renderizador, arquivos que o comando ignora, `MODELS_3D_DIR`, sessão em spec, `aria-disabled`, espera de colaboração, SyncLedger |
| [testes-frontend-e-lint.md](testes-frontend-e-lint.md) | `import()` a frio e o tempo limite do vitest, regras de lint do frontend e o alcance delas, sondagem do hook |
