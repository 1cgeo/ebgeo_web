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
  `NaN`; use `Number.isFinite`.
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

  **O laço apertado, com os tempos medidos em 2026-08-16** (o dono reclamou de
  lentidão, e a primeira explicação que dei estava errada por não ter medido):

  | comando | tempo |
  |---|---|
  | `npm test --prefix frontend` (a suíte inteira: tudo em `tests/`, menos os dois diretórios de e2e que o `vitest.config.js` exclui) | 8 s |
  | `npm run test:fast --prefix backend -- <arquivo>` | 1,5 s |
  | `npm test --prefix backend -- <arquivo>` | 2,8 s |

  (A célula do frontend dizia "4214 casos, 229 arquivos". O número saiu porque
  ninguém o remede: em 2026-08-23 os mesmos diretórios já somavam 285 arquivos, e
  um absoluto que envelhece sozinho vira mentira com cara de medição. A propriedade
  que sobrevive é a da coluna da direita, e ela é a razão da tabela: a suíte inteira
  do frontend custa segundos, não minutos.)

  Ou seja: **o ciclo de banco do backend custa ~1,2 s, não os 40 s que a intuição
  atribuía a ele**, e nenhum dos dois pacotes é lento por arquivo. O que demora é a
  suíte INTEIRA do backend (sob `c8`, verificando o piso) e a perna de e2e. Antes de
  otimizar qualquer coisa aqui, meça: esta linha existe porque um palpite virou
  diagnóstico e quase virou trabalho.

  `test:fast` (`--reuse-db`) **exige um alvo** e recusa a suíte completa: ele troca
  hermeticidade por tempo, e a rodada que vale antes do commit não pode fazer esse
  câmbio. Vermelho em banco reaproveitado se confirma sem a bandeira antes de virar
  diagnóstico, porque dado de rodada anterior também reprova.

  **NÃO reponha o atalho que o backend teve até 2026-08-23**, e é útil saber que ele
  existiu, porque a próxima pessoa incomodada com o tempo de rodada reinventa
  exatamente aquilo. Era um script que chamava `node --test` direto sobre os arquivos
  de teste: sem criar banco, sem aplicar migração pendente, sem passar pelo
  `scripts/run-tests.js` e portanto sem `c8` e sem o piso de cobertura. Saiu do
  `package.json` naquela data.

  A lição é o contraste com o `test:fast`, que é o atalho legítimo. Ele compra tempo
  entregando UMA propriedade (hermeticidade) e continua aplicando migração pendente,
  que é o que o impede de virar "rápido contra o schema velho"; e recusa a suíte
  inteira, para não ser confundido com a rodada que vale. Pular a migração entrega o
  vermelho ERRADO (schema defasado reprovando código certo) e o verde errado (código
  que só passa porque a coluna nova ainda não existe); pular o `c8` reporta verde sem
  o piso. Nenhum dos dois se anuncia: quem rodou vê a mesma linha de sucesso da rodada
  hermética, e é aí que o atalho deixa de ser troca informada e vira medição falsa. A
  rodada que vale antes do commit é `npm test` sem argumento, no pacote, ou o
  `npm test` da raiz.

  **DUAS RODADAS DO BACKEND NA MESMA MÁQUINA SE ATROPELAM, e o vermelho que sai disso
  se lê como regressão** (medido em 2026-08-29). Elas compartilham o banco
  `ebgeo_test`: a que começa depois o dropa e recria no meio da primeira, e o sintoma
  é `3D000 database ... does not exist`, `42P01 relação ... não existe` e casos que
  terminam `cancelled`, tudo em arquivos sem relação com o que você mexeu, e nada na
  saída aponta para a causa. Antes de diagnosticar, confirme que não há outra rodada
  viva (a de um agente em paralelo, a sua de dois terminais atrás). A saída é dar
  banco próprio a uma delas por `TEST_DB_NAME`, que `backend/scripts/run-tests.js` lê
  (no PowerShell, `$env:TEST_DB_NAME='ebgeo_test_2'` antes do comando; o Bash aceita
  o prefixo na mesma linha). Reconfirme o vermelho sozinho antes de tratá-lo como
  código quebrado: é a mesma regra do banco reaproveitado do `test:fast`.

  **E O BANCO NÃO É O ÚNICO RECURSO COMPARTILHADO: A COBERTURA TAMBÉM COLIDE, e essa
  colisão é PIOR, porque não grita** (medido em 2026-09-01). O `c8` coleta por
  `NODE_V8_COVERAGE` num diretório temporário (`backend/coverage/tmp`) e o `.c8rc.json`
  tem `clean: true`: duas rodadas simultâneas apagam os arquivos de cobertura uma da
  outra. O sintoma não é erro nenhum, é um NÚMERO PLAUSÍVEL E MENOR, com todos os
  testes passando, e o piso reprovando por causa dele. Medido no mesmo dia, sobre o
  MESMO commit e os MESMOS 4368 casos verdes, três rodadas contaminadas deram statements
  de 90,11%, 97,37% e 97,9%, com o piso reprovando nas duas primeiras; duas rodadas
  isoladas deram 97,9% (43434/44362), idênticas no numerador e no denominador.

  Três coisas que essa medição ensinou e que a intuição erra:

  - **o número baixo é o artefato, não o alto.** A leitura natural ("cobertura caiu,
    alguém commitou código sem teste") aponta para código e para pessoa, e foi assim que
    uma sessão acusou o lote de outra sem ter isolado o instrumento;
  - **contaminação não só SUBTRAI.** O argumento de que ela só pode derrubar o número
    (perde-se arquivo de cobertura, nunca teste) é quase certo e não é hermético: as duas
    rodadas medem a mesma suíte, então o que a outra escreveu no diretório pode SOMAR
    cobertura à sua. Um verde obtido com o diretório compartilhado, portanto, também não
    prova nada;
  - **o denominador denuncia.** Com `all: true` o total de funções deveria ser fixo pelo
    conjunto de arquivos; nas três rodadas contaminadas ele foi 882, 887 e 925. Total que
    muda entre rodadas do mesmo commit é a evidência de que o instrumento, e não o código,
    está variando. Olhe o denominador antes de acreditar na porcentagem.

  **O TERCEIRO RECURSO COMPARTILHADO É A PORTA, e ela é o contra-exemplo útil.** O backend
do `test:e2e:ui` sobe na 3912, e um órfão de rodada interrompida a segura. Essa colisão
  GRITA, e se nomeia: `frontend/tests/e2e-ui/backend.js` recusa subir dizendo "a porta 3912
  já responde /api/v1/health antes de subirmos: outro backend está de pé (tipicamente órfão
  de uma rodada anterior interrompida)". Achar o dono é `Get-NetTCPConnection -LocalPort 3912
  -State Listen`.

  Postos lado a lado, os três dizem uma coisa que nenhum deles diz sozinho: **a graduação não
  é de gravidade do recurso, é de quanto o modo de falha foi instrumentado.** A porta grita e
  se nomeia, porque alguém escreveu aquela frase; o banco grita mal, com `3D000` e `42P01` em
  arquivos sem relação com o que se mexeu; a cobertura não grita, e devolve uma porcentagem
  crível que acusa o código de outra pessoa. O trabalho, quando um recurso novo passar a ser
  compartilhado, é escrever a frase, não descobrir o sintoma depois.

  **E NÃO USE `backend/coverage/tmp` COMO SEMÁFORO DE RODADA VIVA.** É a verificação que a
  leitura deste texto sugere e ela responde sempre a mesma coisa: o `clean: true` limpa no
  INÍCIO da rodada, então o resíduo de uma rodada TERMINADA fica lá até a próxima começar.
  Medido em 2026-09-01 com ZERO processos node vivos: 819 arquivos no diretório. Diretório
  cheio é o estado de repouso, e quem o usar como semáforo lê "ocupado" sempre, ignora o
  semáforo em uma semana e volta a medir cobertura contaminada achando que conferiu. O sinal
  válido é a lista de processos (`tasklist | grep -c node.exe`, ou o equivalente do seu
  shell), e ele foi o que de fato acusou a rodada paralela naquele dia; a contagem de
  arquivos foi citada junto, como se corroborasse, e não corroborava nada.

  A saída é isolar os DOIS eixos, não um: banco por `TEST_DB_NAME` e diretório de
  cobertura próprio, rodando `npx c8 --temp-directory <dir> node scripts/run-tests.js`
  de dentro de `backend/` (com `NODE_V8_COVERAGE` posto pelo c8, `run-tests.js` não
  se auto-eleva de novo, então não há dupla instrumentação). Isolar só o banco deixa a
  cobertura exposta, e foi o que produziu duas das três medições divergentes.

  **E o runner monta o ambiente do processo de teste EXPLICITAMENTE, sem ler o
  arquivo .env.test.** Variável posta lá fica inócua com cara de configurada, que é a
  classe "o verificador também quebra calado": ela tem de entrar na lista de
  `backend/scripts/run-tests.js`. Foi o que aconteceu com `TILE_SERVER_URL` em
  2026-08-29, e o modo de falha dela é o pior tipo: o índice de regime só indexa
  endereço que caia sob aquela base, então sem ela o índice sai VAZIO, e índice vazio
  significa recusar tudo, de modo que um teste de tile passaria medindo a ausência de
  configuração em vez do gate.
- **UI**: no preview or interactive-browser tool. The approved loop is a
  Playwright capture driving the real app and backend, then READING the produced
  image. Delete the temporary spec afterwards. `npm run test:e2e:ui`.

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

  **E o comando ignora uma spec em silêncio.** O mesmo config traz uma lista de
  ignorados que tira `frontend/tests/e2e-ui/browser-collab-mega.spec.js` da rodada
  normal, salvo quando a própria linha de comando nomeia a mega (é o que
  `TARGETING_MEGA` decide, lendo os argumentos do processo), e ela tem script
  próprio, `test:e2e:mega`. A decisão está
  comentada no config (a mega é peça de demonstração de duas browsers, e cada
  dimensão dela já está coberta pelas specs `browser-collab-*` focadas), e é
  legítima; o que não é legítimo é ler "`test:e2e:ui` verde" como "a pasta
  `tests/e2e-ui/` inteira passou". Não passou: um arquivo dela não rodou.
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

  **Última sondagem: 2026-08-23, viva nos quatro caminhos.** `.js` sujo no frontend
  (pegou `no-unused-vars`), `.css` sujo no frontend (pegou
  `declaration-block-no-duplicate-properties` e `color-hex-length`), `.js` sujo no
  backend (o walk-up achou o outro pacote e a saída veio como erro) e arquivo limpo
  (silêncio). A sondagem foi por caminho INDEPENDENTE do que produz o resultado no
  dia a dia: payload real no stdin do `.claude/hooks/lint-on-write.js`, e não o
  texto que ele injeta de volta na sessão, porque conferir o hook pela saída que o
  próprio hook põe na conversa é o verificador chancelando a si mesmo. (Sondagem
  anterior: 2026-08-14, mesmo resultado.) Anote a data e o resultado ao re-sondar:
  sem isso "probe it" é conselho sem prazo de validade, e foi assim que a versão
  anterior passou meses morta.

  **ARMADILHA DA PRÓPRIA SONDAGEM, descoberta em 2026-08-23, e ela devolve verde sem
  ter provado nada.** No Git Bash o `pwd` devolve caminho POSIX (`/c/Users/...`).
  Montar o `file_path` do payload a partir dele entrega ao hook uma string que o
  `path.resolve` do Node no Windows lê como RELATIVA à raiz do drive, virando
  `C:\c\Users\...`: caminho que não existe, fora da raiz do projeto, e cujo walk-up
  não acha `eslint.config.js` em lugar nenhum. O hook então sai por `process.exit(0)`
  SEM escrever coisa alguma, que é byte a byte o que ele faz para um arquivo limpo.
  Quem sondar assim vê silêncio, conclui "não acusou nada" e registra uma sondagem
  que não sondou. Passe o caminho no formato do Windows (`C:\...`) ao montar o
  payload. Esta é a classe "o verificador também quebra, e quebra calado" da
  constituição, na volta mais irônica possível: o defeito estava no aparelho de medir
  o aparelho de medir.
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
  regra ruidosa é uma regra que alguém desliga, então cada uma foi medida contra a
  árvore INTEIRA de `frontend/src/js/` e comprada com zero falso positivo, pagando em
  falso negativo. O que cada uma deliberadamente NÃO pega está escrito no topo do
  próprio arquivo, e vale ler antes de concluir "o lint não reclamou, então está
  dentro da convenção". Os buracos que mais custam: `no-unescaped-innerhtml` só
  dispara quando a interpolação usa os nomes de campo de dado do usuário (`nome`,
  `descricao` e afins), e ignora toda interpolação fora desse léxico;
  `no-inline-style-assignment` ignora a atribuição de UMA propriedade
  (`el.style.left = ...`, a esmagadora maioria legitimamente computada) e só acusa o
  bloco estático; `no-json-clone` não pega a forma em dois passos (`stringify` numa
  linha, `parse` na outra); `no-event-string-literal` só reconhece o barramento da
  casa pelo nome do receptor, então mini-emissor privado (`toolManager`, `wsClient`)
  passa. **Import por alias continua sem regra nenhuma**, cobrado por leitura.

  **Os absolutos que moravam nesta linha saíram, e a razão é a mesma da tabela de
  tempos.** Ela dizia "medida contra os ~601 arquivos" (em 2026-08-23 são 655) e que
  `no-unescaped-innerhtml` "das 214 interpolações cruas reporta 3". Esse 3 é hoje
  **zero**: as três violações reais foram corrigidas. Zero achados NÃO é a regra
  morta, e a distinção é exatamente a que a constituição chama de cobertura vazia:
  quem prova que ela continua discriminando é o `eslint-rules/probe.js` do frontend,
  contra fixtures sintéticas, e é ele que se deve rodar para saber. Os cabeçalhos das
  próprias regras ainda carregam absolutos medidos em 2026-08-13 (a contagem de
  arquivos e a de interpolações cruas em
  `frontend/eslint-rules/no-unescaped-innerhtml.js`); ao mexer num deles, troque o
  número pela propriedade em vez de remedi-lo.
- Verde do lint no frontend significa hoje "sem erro de sintaxe, sem variável não
  usada e sem violação das cinco regras acima **no recorte que elas cobrem**", não
  "dentro da convenção". E **metade dele é tolerante a warning**: o `lint:js` roda
  `eslint . --max-warnings 0`, mas o `lint:css` roda `stylelint` **sem** essa
  bandeira, e o `lint` do frontend é os dois em sequência. Hoje isso é inócuo, porque
  nenhuma regra do `frontend/stylelint.config.js` está em severidade de aviso (as
  ligadas são `true` ou valor, que é erro), então não existe warning para tolerar. É
  uma propriedade da CONFIGURAÇÃO, não do script: no dia em que alguém puser uma regra
  em `warning`, ou em que o `stylelint-config-standard` trouxer uma nova assim numa
  atualização, o CSS passa a reprovar sem reprovar, e nada avisa. Se for mexer aí,
  ponha a bandeira no `package.json` no mesmo commit.

## Collaboration / sync e2e
- For multi-user (collab/sync) behavior, prefer the **SyncLedger** deterministic waits
  (`frontend/tests/e2e-ui/helpers/trace-helpers.js`, com `waitForRemoteEntity`/`waitForStage`) over
  store polling; on timeout they name the last sync stage reached. See
  `frontend/tests/e2e-ui/README.md` §"SyncLedger trace helpers".
