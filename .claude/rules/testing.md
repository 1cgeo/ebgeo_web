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

  **ANTES DA TABELA, A PERGUNTA QUE A ANTECEDE: as duas sessões estão no MESMO diretório de
  trabalho?** Nesta máquina, em 2026-09-01, estavam. Isso é uma classe acima de tudo o que vem
  abaixo, porque ali o que se compartilha não é um recurso do teste, é o SUJEITO dele: a sua
  rodada mede os arquivos da outra pessoa, meio escritos inclusive, e o `git status` que você
  lê como "minha árvore" é a árvore das duas. O HEAD anda sob os seus pés sem você dar um pull.

  O sintoma é bem mais silencioso que uma colisão de porta ou de banco, e ele foi medido:
  duas rodadas de `test:e2e:ui` do mesmo lote deram **307 e 308 casos**, as duas verdes, e a
  diferença era uma spec que a outra sessão acrescentara entre elas. Ficou meia hora como
  "divergência não explicada" porque a primeira investigação comparou conjuntos de spec e
  linha, respondeu "nenhuma diferença" e estava errada; um `grep` pelo nome do arquivo nas
  duas saídas achou na hora. Contagem de casos que muda entre rodadas é a mesma família do
  denominador de cobertura que muda: **contradição interna, e ela sempre vence a hipótese de
  que o número é sobre o código.**

  E há uma janela que NENHUMA das duas fontes reconstrói depois: o arquivo ainda NÃO commitado.
  Um agente da outra sessão escrevendo agora aparece só no `git status` DAQUELE instante, e some
  de lá quando o dono commita; a partir daí o `git log` o data pelo commit, que é posterior ao
  momento em que ele já tinha entrado na sua rodada. Das fontes de divergência entre duas
  rodadas, esta é a única que não se reconstrói a posteriori: quando você for investigar, ela
  não está em lugar nenhum. O que resta é combinar antes, e é por isso que o aviso vale mais
  que a arqueologia.

  Na prática: antes de tratar qualquer diferença entre duas rodadas como regressão, pergunte
  se alguém escreveu no diretório entre elas (`git log --since` mais `git status`), e depois
  procure a tabela.

  **O MAPA DE QUEM POSSUI O QUÊ, medido em 2026-09-01**, porque descobrimos estas fronteiras
  uma a uma, cada vez pagando uma colisão. Duas sessões só colidem se compartilharem uma
  linha desta tabela:

  | camada | porta | banco | escreve `coverage/tmp`? |
  |---|---|---|---|
  | `test:frontend` (vitest) | nenhuma | nenhum | não |
  | `test:backend` | nenhuma | `ebgeo_test` (`TEST_DB_NAME` sobrepõe) | SIM, sob c8 |
  | `test:e2e` (contrato, 3ª perna da raiz) | 3911 | `ebgeo_e2e` | não |
  | `test:e2e:ui` e `test:e2e:mega` (Playwright) | 3912 **e 4321** | `ebgeo_ui_e2e` | não |
  | os quatro configs de cenário (Playwright) | as MESMAS 3912 e 4321 | o MESMO | não |

  **A ÚLTIMA LINHA É QUATRO CONFIGS E NÃO UMA CAMADA NOVA, e é por isso que ela não ganha coluna
  própria.** `playwright.atlas-safety.config.js`, `playwright.migration-data.config.js`,
  `playwright.release-checks.config.js` e `playwright.release-production.config.js` (todos em
  `frontend/`) fazem spread do `playwright.config.js` base e trocam só `testMatch`, `retries` e
  `timeout`, de modo que herdam o `globalSetup`, a porta do backend, a do Vite e o banco: uma
  rodada de cenário colide com uma rodada de `test:e2e:ui` exatamente como duas rodadas de
  `test:e2e:ui` colidem entre si, e as três variáveis de isolamento do parágrafo adiante são as
  mesmas. Três coisas que não se leem na tabela e cada uma já custou uma leitura errada: só dois
  deles têm script (`test:e2e:atlas` e `test:e2e:migracao`), os outros dois se rodam nomeando o
  config; o de dados de migração **lança na importação** se `EBGEO_MIGRATION_DATA_DIR` não estiver
  no ambiente, de propósito, porque nenhuma rodada normal pode depender do acervo externo de
  alguém; e o de produção é o único que troca o `webServer`, por um HTTPS em 127.0.0.1:44431 com
  `reuseExistingServer: false`, mas o `globalSetup` PRÓPRIO dele sobe o mesmo backend na 3912 e no
  mesmo banco, então trocar o servidor do app não o isola de nada.

  **A COLUNA DA PORTA DO PLAYWRIGHT TEM DOIS NÚMEROS, e o segundo é o que morde calado.**
  A 3912 é o backend, e ela GRITA (ver adiante). A 4321 é o Vite que serve o APP, e
  `playwright.config.js` a abre com `reuseExistingServer: !process.env.CI`: se outro checkout
  já tiver um Vite ali, o Playwright REUSA aquele servidor e a sua rodada passa a medir o
  `src/` do OUTRO worktree, sem um aviso em lugar nenhum. É a forma mais pura de "o
  instrumento está medindo outra cópia do sujeito": os specs passam, a captura sai bonita, e
  nada do que você editou entrou na medida.

  MEDIDO em 2026-09-14, e o que denunciou foi uma CONTRADIÇÃO entre rodadas: duas capturas do
  mesmo commit relataram `ms.getVersion()` 3.0.4 e depois 3.0.2, e a segunda pediu
  `/vendors/milsymbol.min.js`, um arquivo que aquele commit tinha apagado. O dono da 4321 era o
  `frontend` de outro worktree. A regra prática que sai daí: **ao capturar ou depurar, registre
  os pedidos de REDE do recurso em questão**, porque o caminho servido nomeia a árvore, enquanto
  o resultado visual não nomeia nada.

  A saída já existe e está documentada em `frontend/tests/e2e-ui/constants.js`: as quatro
  coordenadas são sobrescritíveis por ambiente, e **isolar uma sem isolar as outras ainda
  colide**. O conjunto completo é `EBGEO_UI_E2E_APP_PORT`, `EBGEO_UI_E2E_BACKEND_PORT` e
  `EBGEO_UI_E2E_DB_NAME`. Dois agentes na mesma máquina definem os três e param de esperar um
  pelo outro.

  **A CAMADA DO PLAYWRIGHT SE ISOLA POR ENV, e são TRÊS variáveis, não uma.**
  `frontend/tests/e2e-ui/constants.js` lê `EBGEO_UI_E2E_APP_PORT` (Vite, padrão 4321),
  `EBGEO_UI_E2E_BACKEND_PORT` (padrão 3912) e `EBGEO_UI_E2E_DB_NAME`, e o cabeçalho de lá
  avisa que isolar uma sem as outras ainda colide: trocar só a porta deixava a segunda rodada
  DROPANDO o banco da primeira, e o sintoma que chega é `banco de dados ... não existe` na
  rodada de quem não fez nada. Medido em 2026-09-14, com dois agentes na mesma máquina: as
  três juntas resolveram. **Desde o mesmo dia o banco DERIVA do checkout** (padrão
  `ebgeo_ui_e2e_<chave>`, a mesma `CHECKOUT_KEY` do arquivo de estado), então o que sobra
  para lembrar são as duas PORTAS; o nome do banco só precisa ser passado quando duas rodadas
  do MESMO checkout coexistem.
  Se sua spec instala `page.route` com a origem do app escrita à mão, ela quebra
  exatamente aqui: leia `APP_ORIGIN` e `BACKEND_PORT` das constantes, senão o roteamento
  engole o próprio `GET /api/config` e o app não boota, com cara de defeito de produto.

  **E HÁ UM QUINTO RECURSO COMPARTILHADO QUE NÃO É DE TESTE E É O ÚNICO QUE DESTRÓI
  TRABALHO: `git stash`.** Ele é do REPOSITÓRIO, não do worktree: `refs/stash` é um ref
  comum, então a pilha é a MESMA para a árvore principal e para todo `git worktree`, e o
  `git stash list` de um mostra o que o outro empilhou. Medido em 2026-09-14: uma sessão
  em `plano/npmb` empilhou o próprio trabalho para medir uma linha de base, outra sessão
  em `plano/npma` empilhou o dela no intervalo, e o `git stash pop` da primeira aplicou o
  trabalho da SEGUNDA na árvore da primeira e apagou a entrada dela. Nada acusa: o `pop`
  sai com sucesso e o `git status` que se lê depois descreve arquivos que a sessão nunca
  tocou. Duas regras daí: **não use `git stash` para medir linha de base num repositório
  com worktrees vivos** (use `git worktree add` sobre o commit, ou meça o `dist/` antes de
  editar); e se já usou, recupere pelo SHA em vez de pela posição, porque a posição mudou
  (`git fsck --unreachable` acha o commit pela mensagem, `git stash store <sha>` devolve o
  do outro à pilha e `git stash apply <sha>` traz o seu de volta sem mexer nela).

  **E O WORKTREE DE LINHA DE BASE TEM UMA ARMADILHA QUE DESTRÓI O `node_modules` REAL, no
  Windows** (medido em 2026-09-21, e o dano foi desta sessão). Um `git worktree add` não traz
  `node_modules`, então a linha de base roda com uma JUNÇÃO de `frontend/node_modules` e de
  `backend/node_modules` para os diretórios da árvore principal. `git worktree remove --force`
  apaga a árvore de trabalho recursivamente e ATRAVESSA a junção: ele começou a apagar os pacotes
  reais em ordem alfabética (81 pacotes de escopo no backend, de `@bcoe` em diante) e só parou onde
  um arquivo estava em uso. Nada acusa na hora; o sintoma chega depois, como
  `Cannot find module '@hapi/hoek/lib/assert'` num teste sem relação com o que se mexeu. Duas
  regras daí: **desfaça as junções ANTES de remover o worktree** (no PowerShell,
  `(Get-Item <caminho>).Delete()` remove a junção sem seguir o alvo; nunca `Remove-Item -Recurse`
  nem `rm -rf` sobre ela), e só então `git worktree remove`; e se o dano já aconteceu, o reparo é
  `npm ci` no pacote, que reinstala pelo lockfile SEM escrevê-lo, com o stack de desenvolvimento
  PARADO antes, porque o Vite segura o binário nativo do rolldown e o `npm ci` aborta no meio com
  `EPERM`, deixando o diretório pior do que estava. Parar o shell do `npm run dev` não basta: a
  árvore de processos sobrevive a ele, e é ela que segura o arquivo.

  A consequência que mais surpreende, e que evita coordenação desnecessária: o `npm test` da
  RAIZ e o Playwright **não colidem em nada**, porque a perna de e2e da raiz é outra porta e
  outro banco, e o Playwright sobe o backend por `spawn` sem passar por c8. Quem roda a raiz
  só precisa combinar com quem roda `test:backend`. E o inverso também vale: quem roda
  Playwright durante uma medição de cobertura alheia não a contamina.

  **A RAIZ NÃO É UMA LINHA DA TABELA, ELA SÃO AS TRÊS PRIMEIRAS**, e é aqui que a leitura
  apressada erra em favor de si mesma. `npm test` encadeia `test:frontend`, `test:backend` e
  `test:e2e`, então ele HERDA a linha do meio inteira: toma `ebgeo_test` e **escreve em
  `coverage/tmp` sob c8**, porque o `run-tests.js` se auto-eleva ao rodar a suíte completa.
  Duas coisas seguem daí, e nenhuma delas se lê na tabela sozinha: duas RAÍZES colidem entre
  si, e rodar a raiz durante uma medição de cobertura alheia **contamina** a medição. A frase
  acima isenta o Playwright, não a raiz, e a diferença importa porque a raiz é o comando que a
  constituição manda rodar antes de todo commit, ou seja, o mais frequente dos quatro.

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

  **A CAPTURA ESPERA O ESTADO, NÃO O TEMPO, e quem delega a captura relê a imagem** (medido em
  2026-09-20). Um toast que nasce num `onload` de imagem, num `fetch` ou em qualquer callback
  assíncrono ainda não existe na linha seguinte ao gesto: o `page.screenshot` dispara, o spec fecha
  verde e a imagem sai SEM o que ela deveria provar. Foi assim que a recusa de imagem por dimensão
  ganhou uma captura sem toast nenhum, e o relatório do agente que a produziu descrevia o texto do
  toast mesmo assim. Duas regras daí: antes do screenshot, espere o estado por localizador com o
  texto (`expect(page.locator('.toast', { hasText: ... })).toBeVisible()`) e imprima o `innerText`
  no stdout, que é o caminho independente da imagem; e ao receber de um subagente um relatório que
  diz "li a imagem", abra a imagem, porque a frase é prosa e o arquivo é o pixel.

  **E PARA TOAST O ESTADO É A OPACIDADE COMPUTADA, não a visibilidade do Playwright** (medido em
  2026-09-21). O toast nasce com `opacity: 0` e anima até 1, e `toBeVisible()` não olha opacidade:
  logo depois de ele passar, o toast já está por cima da tela e a frase ainda é invisível, de modo
  que a captura sai sem o texto enquanto o spec "prova" que ele estava lá. Espere a opacidade
  computada passar de 0,9 (`expect.poll` sobre `getComputedStyle`) antes do screenshot. Da mesma
  família: ler `getPaintProperty` logo depois de um `aria-pressed` virar devolve a tinta do estado
  ANTERIOR, porque o rótulo é escrito pela view e a tinta passa pelo controlador; espere a própria
  expressão.

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

  **A QUEDA DO RENDERIZADOR NÃO SE CONSERTA POR BANDEIRA DE LANÇAMENTO, e a lista de
  bandeiras que a intuição oferece JÁ É O PADRÃO DO HARNESS** (medido em 2026-09-15 nesta
  máquina, 480 boots em cinco configurações). O sintoma está declarado com mecanismo e taxa no
  cabeçalho de `frontend/tests/e2e-ui/vertices-em-cliques-rapidos.spec.js`: o processo da página
  morre no boot do mapa e a falha chega como Target crashed, sem erro de página nenhum.

  **O primeiro fato mata a prescrição inteira: não há driver de GPU dentro do processo.** A
  leitura da extensão de depuração de renderizador dentro da página devolve "ANGLE (Google,
  Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", e a linha de comando VIVA do
  processo de GPU (`Get-CimInstance Win32_Process`) traz `--use-angle=swiftshader-webgl`,
  `--use-gl=angle` e `--enable-unsafe-swiftshader`; o processo do navegador nasce ainda com
  `--disable-back-forward-cache` e `--disable-dev-shm-usage`. Ou seja, `--use-angle=swiftshader`,
  o par `--use-gl=angle --use-angle=swiftshader-webgl`, `--enable-unsafe-swiftshader`,
  `--disable-features=BackForwardCache` e `--disable-dev-shm-usage` são TODOS o padrão do headless
  shell do Playwright: acrescentá-los mede a linha de base duas vezes. E a mensagem de console que
  fundamentava a suspeita ("GL Driver Message ... GPU stall due to ReadPixels") é saída de
  depuração do próprio ANGLE sobre SwiftShader, não de um driver de fornecedor, que ali não
  existe. Confira a bandeira contra o PROCESSO antes de gastar bateria com ela.

  **O segundo fato diz onde a queda não está.** O Windows registra toda ocorrência como exceção
  0x80000003 (STATUS BREAKPOINT) no módulo chrome-headless-shell.exe, sempre no MESMO deslocamento
  0x0000000000d7d2c3: é um CHECK determinístico do Chromium, não uma parada de driver e não
  corrupção de memória. A memória também não sustenta a leitura de OOM: amostrada a cada 9 s numa
  bateria de 64 boots, a soma dos processos oscilou POR TESTE entre 49 MB e 822 MB, com o maior
  processo em 519 MB, sem tendência de subida.

  **E o log de eventos do Windows NÃO serve de contador.** O WER agrupa duplicata por bucket: uma
  janela com TRÊS reprovações deixou UM evento. Quem contar queda pelo Visualizador de Eventos
  subconta, e subconta mais quanto pior estiver o quadro. O contador que vale continua sendo a
  reprovação do caso, em série e com `--retries=0`.

  **A medição**, sempre sobre `frontend/tests/e2e-ui/vertices-em-cliques-rapidos.spec.js` (o
  arquivo que mais boota mapa por minuto), em série e sem retry:

  | configuração | quedas / boots | taxa | custo |
  |---|---|---|---|
  | padrão do harness (headless shell, SwiftShader) | 5 / 160 | 3,1% | 5,5 s/caso; boot 3,82 s; viewshed 30,1 s |
  | `--use-angle=d3d11` (GPU real, RTX 4070 Ti) | 4 / 128 | 3,1% | 5,3 s/caso; boot 3,74 s; viewshed 21,2 s |
  | `--disable-gpu-driver-bug-workarounds` | 1 / 64 | 1,6% | igual ao padrão |
  | `--in-process-gpu` | 3 / 64 | 4,7% | igual ao padrão |
  | canal `chromium` (binário completo) + SwiftShader | 3 / 64 | 4,7% | boot 3,85 s, e a falha PIORA |

  Nenhuma diferença sai do ruído: 16 quedas em 480 boots, 3,3% no agregado, e a 3,3% uma bateria
  de 64 espera 2,1 quedas, de modo que 1 e 4 são o mesmo número. A variância entre baterias da
  MESMA configuração mostra isso sozinha: as quatro baterias do padrão deram 0 em 32, 2 em 32, 3
  em 64 e 0 em 32, ou seja, metade delas voltou limpa. **Nada foi mudado no config, e é
  esse o resultado.** Em particular, não promova o 1 de 64 da terceira linha a conserto: ela é a
  única bandeira da lista que ainda não era padrão, e o que ela desliga é a lista de contornos de
  bug de DRIVER, que sob SwiftShader está vazia. É um dip de ruído com mecanismo nulo.

  **A queda sobrevive à troca COMPLETA do rasterizador**, o que tira a pilha de GL da lista de
  suspeitos apesar da mensagem de console: ela acontece na mesma taxa com SwiftShader e com o
  driver da NVIDIA. E o canal `chromium` é PIOR, com o custo fora da taxa: com o binário completo
  a falha deixa de ser Target crashed num caso e vira "worker process exited unexpectedly
  (code=3221225477)", isto é, ACCESS VIOLATION derrubando o worker inteiro, que é a assinatura que
  custou as duas tentativas de `frontend/tests/e2e-ui/browser-collab-shared-atlas.spec.js` na
  rodada completa de 2b809a2f.

  **Uma medição de tabela vale por si e não pelo motivo que a gerou**: trocar o rasterizador por
  hardware muda 190 de 881280 pixels do `frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js` (0,022%)
  e 11 pixels de CLASSE (0,001%), com verde e vermelho em 17,331% e 4,824% dos dois lados. A
  referência versionada passa sem regeneração, com quase cinquenta vezes de folga dentro do teto
  de 1%, e a suíte de viewshed fica um terço mais rápida. Ou seja, o teto daquele arquivo foi bem
  escolhido: ele sobrevive a uma troca de GPU, que é exatamente o cenário que o comentário dele
  antecipava. Isso não autoriza a troca (ela não conserta nada e amarraria ao driver desta máquina
  uma referência hoje reprodutível em qualquer uma), mas tira o pixel da lista de objeções caso
  alguém precise de hardware por outro motivo.

  **E o comando ignora uma spec em silêncio.** O mesmo config traz uma lista de
  ignorados que tira `frontend/tests/e2e-ui/browser-collab-mega.spec.js` da rodada
  normal, salvo quando a própria linha de comando nomeia a mega (é o que
  `TARGETING_MEGA` decide, lendo os argumentos do processo), e ela tem script
  próprio, `test:e2e:mega`. A decisão está
  comentada no config (a mega é peça de demonstração de duas browsers, e cada
  dimensão dela já está coberta pelas specs `browser-collab-*` focadas), e é
  legítima; o que não é legítimo é ler "`test:e2e:ui` verde" como "a pasta
  `tests/e2e-ui/` inteira passou". Não passou: um arquivo dela não rodou.

  **E UM CASO SÓ MEDE COM O ASSET APONTADO POR AMBIENTE.**
  `frontend/tests/e2e-ui/vazamento-viewers.spec.js` §30.2 abre e fecha o visualizador 3D
  contra um modelo REAL, e `backend/.gitignore` exclui `data/models3d/`: um checkout limpo e
  todo worktree do git ficam sem o arquivo, a rota do tileset responde 404 e o caso PULA,
  nomeando a saída. O pulo não aparece como vermelho em lugar nenhum, e enquanto ele acontece
  a cobertura sobre o vazamento de listener do visualizador 3D é ZERO. A saída é apontar
  `MODELS_3D_DIR` (caminho ABSOLUTO) para um diretório que TENHA o arquivo antes de chamar o
  Playwright: `frontend/tests/e2e-ui/backend.js` espalha o ambiente do processo no `spawn` do
  backend e não sobrescreve essa variável, e
  `backend/src/modules/models3d/models3d.store.js` resolve o caminho do modelo contra ela, de
  modo que um absoluto vale de qualquer diretório de trabalho. Medido em 19/09/2026 na árvore
  principal, que tem o arquivo: com a variável apontada, §30.2 EXECUTA e dá 3 de 3 verdes em
  série com `--retries=0`, a cerca de 36 s por execução. **E o controle mede a metade que a
  homologação leu ao contrário:** na MESMA árvore o caso executa TAMBÉM sem a variável, porque
  o padrão resolve contra o `backend/` do próprio checkout. Ou seja, o pulo nunca foi do produto
  nem da máquina: ele é de QUAL checkout roda o Playwright, e a variável é o conserto de quem
  roda de um que não tem o arquivo. Antes de contar aquela célula como aprovada, confira que o
  caso RODOU em vez de ter pulado.
- **O Playwright lê `aria-disabled` como desabilitado, e isso colide de frente com a regra "o
  ESTADO recusa o clique"** (medido em 2026-09-02, três rodadas perdidas num spec do menu de camada).
  O comando bloqueado por estado é desenhado com `aria-disabled` e NUNCA com a propriedade
  `disabled`, porque o clique é como o motivo chega à pessoa. Mas o `click()` do Playwright espera o
  alvo ficar "enabled" e trata `aria-disabled="true"` como não habilitado, então ele espera para
  sempre por um botão que a casa desenha assim de propósito; e `toBeEnabled()` reprova pelo mesmo
  motivo, medindo o CONTRÁRIO do que a regra pede. No spec, clique o item bloqueado por
  `dispatchEvent('click')` e afirme a ausência da propriedade por
  `evaluate((el) => el.disabled === true)` igual a falso, além do atributo. Modelo:
  `frontend/tests/e2e-ui/browser-layer-transfer-permissions.spec.js`. Da mesma família: um handler
  que REMOVE o próprio botão (a alça de continuação, a linha do menu de conversão) também só se
  clica por `dispatchEvent`, porque o `click()` tenta de novo ao ver o alvo sumir no meio do gesto.
  E rode o Playwright de DENTRO de `frontend/` (`cd frontend && npx playwright test ...`): da raiz
  do monorepo o runner carrega os specs com outra instância de `@playwright/test`, acusa
  "did not expect test.beforeEach() to be called here" e termina com "No tests found", sem
  executar nada, com cara de rodada.
- **"Test timed out in 5000ms" NUM ARQUIVO QUE NINGUÉM TOCOU, E QUE PASSA SOZINHO, QUASE NUNCA É O
  CÓDIGO SOB TESTE: É O `import()` A FRIO** (medido em 2026-09-20, três flakes do mesmo dia com esta
  raiz). O vitest dá 5 s a cada caso, e um caso que faz `await import(...)` de um grafo grande paga
  ali dentro a TRANSFORMAÇÃO dos módulos na primeira vez que o worker os vê. Medido em
  `frontend/tests/integration/migracao-main-riscos-abertos.repro.test.js`, com a máquina em repouso
  e com 96 processos ocupando 32 núcleos: a migração leva de 9 a 19 ms nas DUAS condições; o import
  a frio vai de 175 ms para 7,7 a 11,2 s, e cai a 320 ms com o cache do worker quente. Taxa antes do
  conserto, em série sob carga: 8 de 10 verdes; depois, 12 de 12.

  Três coisas que a medição ensinou e a intuição erra:

  - **carga "moderada" não reproduz.** Trinta processos numa máquina de 32 núcleos deram 8 de 8
    verdes, porque sobrava núcleo. Só a sobrecarga (três vezes os núcleos) reproduziu, e é ela que
    corresponde a duas ou três sessões rodando suíte e Playwright ao mesmo tempo;
  - **a primeira hipótese estava errada.** O arquivo tem um caso com folga de 50 ms sobre um
    temporizador e uma janela de 50 ms de `BroadcastChannel`, que é onde o olho vai. Nenhum dos
    dois falhou em 28 execuções; quem falhou foram os dois casos que IMPORTAM;
  - **o segundo vermelho era cascata.** O caso seguinte ao que estoura também estoura, sem ter
    defeito próprio. Leia o PRIMEIRO vermelho do arquivo.

  O conserto é tirar o import a frio do orçamento do caso, não subir o orçamento às cegas: um
  `beforeAll` com tempo próprio que importa os módulos uma vez. O `vi.resetModules()` de cada caso
  continua valendo, porque ele refaz a AVALIAÇÃO, que é barata, e o que se paga uma vez é a
  transformação. Caso que carrega uma ferramenta inteira (o ESLint, em
  `frontend/tests/unit/maplibre-construtores-regua.test.js`) leva orçamento próprio no terceiro
  argumento do `it`. **Desde 2026-09-20 o tempo limite global de caso do frontend é de 20 s**, no
  lugar dos 5 s padrão do vitest, por autorização do dono, e o número é o pior caso medido (11,2 s)
  com folga; ele está escrito em `frontend/vitest.config.js` com a medição ao lado. O preço
  declarado: um caso que TRAVA de verdade é denunciado em 20 s em vez de 5. Isso não aposenta o
  aquecimento: 20 s cala o sintoma, e o `beforeAll` é o que tira o carregador da conta do caso.

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
