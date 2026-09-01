# Browser E2E (Playwright) — `tests/e2e-ui/`

Real-browser (Chromium) end-to-end layer, **complementary** to the headless Node E2E
in `tests/e2e/` (which drives the same transport in Node against the real backend).

## What it covers

- **`smoke.spec.js`** — the app boots in real Chromium (served by Vite) and mounts a
  MapLibre canvas; uncaught page errors are reported as a soft assertion.
- **`integration.spec.js`** — drives the **real** transport modules
  (`api-client` / `ws-client` / `operation-factory`), imported live from the Vite dev
  server **inside the browser**, against the **real backend**: an HTTP round-trip
  (register → login → push feature → read back via snapshot) and a WebSocket broadcast
  (a feature pushed over HTTP arrives on a real browser `WebSocket`). This exercises the
  browser's own `fetch` + `WebSocket` + CORS + IndexedDB stack — coverage the Node E2E
  can't give.

> The two specs above are the transport-level baseline; the suite has since grown to
> cover clicking through the app UI to log in / open a backend project (e.g.
> `login-flow.spec.js`: AccountControl → login modal → project picker → sync badge),
> plus many feature, collaboration, and presence specs (`browser-*.spec.js`,
> `presence*.spec.js`, `*-local.spec.js`).

## UI-first philosophy (non-negotiable)

**Anything a user can do through the UI MUST be driven through the real UI in the test** —
never through a programmatic shortcut. Concretely:

- **Create features** by activating the real toolbar tool and clicking the canvas (point =
  one click; line/polygon = vertex clicks + right-click to finish). Do **not** call
  `store.addFeature(...)` via `page.evaluate`.
- **Edit features** (rename / recolor / describe / move / delete) through the real
  attribute panel + canvas (select via the layers tree or a canvas click, then use the
  panel inputs / color picker, drag to move, `Delete` to delete). Do **not** call
  `updateFeature` / `updateFeatureProperty` / `removeFeature`.
- **Maps / layers / groups** through the sidebar tabs + context menus; **settings** through
  their modals/toggles.

Programmatic `page.evaluate` calls are allowed **only** for things with **no UI**:

1. **Setup**: registering users, seeding an atlas/map, sharing/permission routes (all
   backend-only), enabling the tracer, forcing reconnect/offline, controlling the clock.
2. **Assertion reads**: reading the store / live MapLibre source to *verify* an outcome
   (`readFeatures`, `getCurrentMapFeatures`, `getSource(...).getData()`) — there is no UI
   for "asserting".

Reusable UI drivers live in **`helpers/collab-helpers.js`** (`drawLineUI`, `drawPointUI`,
`drawPolygonUI`, `selectFeatureUI`, `renameViaPanelUI`, `recolorViaPanelUI`,
`deleteFeatureUI`, …). `browser-collab-native-render.spec.js` is the reference: it draws
through the real line tool and asserts native cross-client render. When a feature type
genuinely has no single-gesture UI create (e.g. `processed_los`/`processed_visibility` are
**analysis outputs**, `image` needs a file pick), document the exception inline.

## Contas: papel global e escopo de produção — `helpers/accounts.js`

`createVerifiedUser()` é o único caminho para uma conta usável nesta camada, e desde 2026-08-23
ele sabe o eixo GLOBAL inteiro, não só `role='user'`:

```js
const admin    = await createVerifiedUser({ prefix: 'x', role: 'admin' });
const produtor = await createVerifiedUser({ prefix: 'x', role: 'producer', producerOrgSlug: 'dsg' });
const om       = await resolveOrganization({ slug: '1-cgeo' });   // { id, nome, sigla, slug }
```

Três coisas que não se adivinham:

- **O par (papel, OM de produção) é BICONDICIONAL no banco** (`users_producer_scope_check`), e o
  helper não oferece o estado que o banco recusa: `role: 'producer'` sem OM resolve a OM semeada,
  e OM com qualquer outro papel LEVANTA. Aceitar o par impossível devolveria um 23514 disfarçado
  de 500, vinte passos adiante.
- **`resolveOrganization` falha ALTO** quando o slug não existe, listando os que existem. Sem
  isso, uma base semeada diferente viraria um 401 lá adiante, que se lê como bug do app.
- **A conta continua NASCENDO pela rota pública**, com o e-mail confirmado pela rota pública; só
  a PROMOÇÃO é SQL, porque criar administrador exige administrador e esta camada parte de banco
  vazio. O `UPDATE` que cinco specs copiavam saiu delas; o `accessToken` do login de prova volta
  no retorno, cunhado DEPOIS da promoção (um token anterior carregaria o papel velho até
  expirar, porque `flexibleAuth` não reconcilia).

`helpers/catalog-seed.js` continua escrevendo recurso por SQL, e o `fileoverview` de lá diz qual
metade da justificativa caiu com isto e qual continua de pé.

## SyncLedger trace helpers

The collaboration specs are wired to **SyncLedger** (the additive, env-gated sync
tracing layer; see `../../docs/arquitetura-sync.md`). Instead of polling
the store, prefer the deterministic waits in `helpers/trace-helpers.js`
(`waitForRemoteEntity`, `waitForStage`, `getClientLedger`) — on timeout they dump the
ledger naming the **last stage reached**, so a failure says *where* sync died.
`helpers/ledger.js` merges each browser's `window.__ebgeoSyncTrace` ring with the
backend ring (`GET /api/v1/debug/trace`) via `collectLedger`, reduces it (`reduceLedger`,
pure) and checks invariants (`findViolations`). `helpers/collab-helpers.js` is now
trace-gated with a graceful fallback to the original store poll, so the existing specs
keep working. Demo spec: `browser-collab-ledger.spec.js`. Tracing turns on via
`?trace=sync` / `localStorage` (browser) and `EBGEO_TRACE=1` / `NODE_ENV=test` (backend).

## A mega FLAKEIA em `pollPeerFeatureWhere`, e a taxa está medida (2026-09-01)

Medido em duas rodadas de `npm run test:e2e:mega`, nesta ordem: a primeira REPROVOU nas duas
tentativas (a inicial e a retentativa), a segunda passou. Sempre no mesmo ponto, o
`pollPeerFeatureWhere` do passo CROSS-EDIT (`browser-collab-mega.spec.js`), com a mensagem
`Timeout 8000ms exceeded` apesar de o chamador ter pedido 35000.

O que já está DESCARTADO como causa, com evidência da mesma bateria:

- **Não é regressão de sync.** Na mesma rodada, as 38 specs `browser-collab-*` focadas passaram,
  incluindo `browser-collab-full-chain.spec.js` (o UPDATE atravessando a cadeia inteira até o par),
  que é exatamente a dimensão em que a mega reprova, e o `browser-collab-ledger.spec.js`.
- **Não é o conserto de 2026-08-28 ter faltado.** O `operationType: 'update'` está lá, e o
  `fileoverview` de `pollPeerFeatureWhere` (`helpers/collab-helpers.js`) descreve este mesmo
  sintoma como tendo sido, uma vez, defeito do INSTRUMENTO e não do produto.

O que NÃO foi investigado, e é por onde a próxima pessoa começa: nos DOIS ramos do helper o poll de
confirmação cai para 8 s fixos, inclusive no `catch`, que trata a expiração do gate como se o trace
tivesse funcionado. Ou seja, o timeout que o chamador pediu por saber que aquela atualização vem
atrás de uma fila de ops é descartado justamente no caso que ele previu. A pergunta a responder
ANTES de mexer é qual dos dois ramos roda quando a mega reprova, porque o conserto é diferente em
cada um, e subir o teto sem saber disso é trocar um vermelho honesto por um verde que não prova
nada.

Enquanto isso: **a mega vermelha sozinha não é sinal de regressão**. Confirme em série (a
constituição pede a taxa, não uma rodada) e olhe primeiro se alguma `browser-collab-*` focada
também caiu. Se só a mega cai, é este flake.

## Full-chain specs (the robust collab pattern)

A collab spec should not just assert "the feature eventually showed up on B". It should
prove, for **each operation**, that it traversed the **entire** multi-user pipeline — and,
when it doesn't, say **exactly which link broke**. That is what the **full-chain DSL** does.

The six links (mapped to SyncLedger stages + two ground-truths the trace can't fake):

| # | Link | Deterministic signal | Ground-truth |
|---|------|----------------------|--------------|
| 1 | author IndexedDB     | `apply.persist` (author) | `repo.getMap()` on A (reads IDB, not memoryStore) |
| 2 | transport → backend  | `push.ack` (author)      | — |
| 3 | backend stored       | `server.inserted/applied`| `SELECT … FROM operations WHERE op_id=$1` + entity row |
| 4 | signal → peers       | `server.broadcast` + `ws.inbound` | — |
| 5 | peer IndexedDB       | `apply.persist` (peer)   | `repo.getMap()` on each peer |
| 6 | appeared in browser  | `remote.applied` + `render.source` | MapLibre source |

`apply.persist` is emitted by the app (gated, zero-cost when tracing is off) right after the
IndexedDB write on **both** sides: author in `operation-dispatcher.js`, peer in
`remote-operation-handler.js`. `render.source` needs the entity-render probe
(`window.__EBGEO_TRACE_RENDER__`), which the fixture turns on.

### Writing one — use the `collab` fixture

```js
import { collabTest, expect, drawLineUI } from './helpers/collab.fixtures.js';

collabTest('a line CREATE traverses all six links to the peer', async ({ collab }) => {
    const id = await drawLineUI(collab.author, COORDS);          // real UI gesture
    await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });
});
```

`browser-collab-full-chain.spec.js` is the **canonical template** (create / update / delete +
three-client fan-out). Copy it to start a new spec.

The fixture (`helpers/collab.fixtures.js`) seeds two users + a shared atlas, opens the author
+ peers (each its own context, tracer + render probe on), resolves the owner token, opens the
read-only SQL connection, and attaches the unified ledger on teardown. It exposes on `collab`:

- `author`, `peers[]`, `pages`, `atlasId`, `mapId`, `mapName`, `db`, `userA`, `userB`.
- `expectFullSync(opRef)` — the upsert chain (entity must EXIST at both ends).
- `expectFullSyncDelete(opRef)` — the delete chain (entity GONE at both ends, Postgres row tombstoned).
- `expectNotSynced(opRef, {settle, expectDrop})` / `expectBlockedAt(opRef, {reason})` — **negative**
  path (permission / lock / isolation): the op must NOT reach the peers.
- `assertLedgerClean()` (I2: no acked-but-no-effect) and `assertChainClean()` (I-AP1/I-AP2:
  no claimed IndexedDB write left unconfirmed).

`opRef` = `{ entityId, entityType='feature', type (storage bucket, e.g. 'lines'), operationType='create', opId?, timeout? }`.

Scale to **N peers** per describe (three-client fan-out — every peer is verified):

```js
collabTest.use({ collabOptions: { peers: 2, permission: 'write' } });
```

### Ground-truth helpers

- `helpers/idb.js` — `readIdbEntity(page, {entityId, entityType, mapId, storage})` reads the
  **IndexedDB** via the repository (bypasses the in-memory `memoryStore` that `readFeatures`
  reads). This is links 1 and 5's real check.
- `helpers/db.js` — `createDb(dbName)` → `queryOperation(opId)`, `queryFeatureRow(entityId)`,
  `queryEntityRow(table, id)`, `queryServerVersion(atlasId)`. Direct SQL against the throwaway
  DB (link 3). Independent of the trace, so a missing row breaks link 3 even if the spans exist.

### Migrating an existing collab spec

1. Replace the `seedSharedAtlas` + two `openClient` + `loginUI`/`openAtlasUI` boilerplate with
   `collabTest(... async ({ collab }) => …)`.
2. Keep the **UI gesture** (`drawLineUI`/panel edit) to produce the change on `collab.author`.
3. Replace ad-hoc `pollPeerFeature` / store-poll assertions with one `collab.expectFullSync(...)`
   (or `expectFullSyncDelete` / `expectNotSynced`).
4. Negative specs (`permissions`, `lock`, `multimap-isolation`) use `expectNotSynced` /
   `expectBlockedAt` instead.

> Note: update/delete in the template use the store-op escape hatch for brevity. Where a real
> panel-driven UI driver exists, prefer it (per the UI-first philosophy above). The README's
> `renameViaPanelUI`/`deleteFeatureUI` references are aspirational — add those drivers to
> `collab-helpers.js` as specs need them.

## Two TABS of one user (not two users) — `helpers/two-tabs.js`

Every `browser.newContext()` in this folder is a **user profile**: its own cookies, localStorage
and IndexedDB. That is right for collaboration and wrong for *one* user with two tabs open, which
is what the tab-lock and the per-atlas IndexedDB namespace arbitrate over. `helpers/two-tabs.js`
opens `context.newPage()` twice on ONE profile and adds the reads that go with it:

- `createTabContext(browser, baseUrl)` / `openTab(ctx, url)` — one profile, N tabs.
- `idbDatabaseNames(page)` — the databases of the origin. **Throws** where
  `indexedDB.databases()` is missing, because an empty list would make every "must NOT exist"
  assertion pass without measuring anything.
- `readIdbKeys` / `readIdbFeatureIds` — raw reads that never CREATE the database they are asked
  about (they check `databases()` first): `indexedDB.open(name)` on an absent name manufactures it.
- `sampleFeatureInDb` — presence sampled *through* a destructive act. "Did the other tab's data
  survive" asked once, afterwards, is a race and measured as one (1 run in 4). **Sem chamador
  hoje**: o único caso que o usava (A3) saiu quando a decisão que ele codificava foi superada
  (ver a bateria abaixo). Fica porque é o instrumento da janela "durante o ato", que a promoção
  de A1 depois de E7 volta a precisar.
- `sampleIdbKeys` / `classifyKeySamples` — o irmão dele para a pergunta que vem DEPOIS de uma
  destruição: "estes bancos VOLTARAM?". Amostra `absent` / `empty` / `keys` / `unreadable` numa
  janela, porque a recriação que se quer proibir é uma escrita que pode chegar a qualquer
  instante nos segundos seguintes.
- `queueDbOf(suffix)` / `QUEUE_STORE` — o endereço da fila de saída (`ebgeo` no slot legado,
  `ebgeo__<sufixo>` no resto), escrito à mão pelo mesmo motivo que `atlasDbNames`.
- `waitForOverlayTitle(page, título)` — espera o overlay COM AQUELE TEXTO e **nunca lança**:
  devolve o que a aba virou. Bloqueado e congelado dividem um elemento e uma classe, e só o
  texto os separa; e uma asserção de locator reportaria "elemento não encontrado" tanto para
  "não congelou" quanto para "foi parar no seletor de projetos".
- `atlasDbNames(suffix)` / `mapsDbOf` / `remoteSuffix` — the expected names, written out instead of
  derived from `atlas-namespace.js`, so the expectation does not come from the code under test.
- `classifySamples` — splits a sample series into `has` / `gone` / `absent` / **`unreadable`**. A
  read that could not run (the tab navigated, the execution context died) is its OWN category and
  never counts as destruction; folding it into "gone" made a navigation look like a wipe.
- `tabDiagnostic(page)` — blocked, sync state, WHICH PAGE, map loaded, url, title, in one round
  trip. A gate asserting only "the badge is not online" cannot tell a blocked tab from one that
  fell through to `atlas.html` from one that never booted; measured, all three happened.
- `pendingGate(testInfo, { setup, gate, marca })` — see below.
- `activeScopeOf` is **diagnostic only**: it imports an app module through the dev server and can
  receive a second instance (HMR `?t=`), so it may report a scope that is not the app's.

### `pendingGate`: why a `test.fail()` case here is not just `test.fail()`

`test.fail()` marks the whole test, so **any** throw is reported as the expected failure: a
timeout in setup, a renamed selector, a navigation that destroys the execution context. This
folder used to carry the rule "read the attached error, it must be the named assertion", and the
rule was measured to lapse in 2 runs out of 6.

`pendingGate` makes it mechanical. It throws **only** when the gate failed with the named message
(`marca`); a broken setup, or a failure with any other message, RETURNS instead, which makes the
case pass, and Playwright reports a fail-marked test that passes as a run failure. Either way the
evidence is attached. So "expected failure" can only mean the named assertion, and the day the
defect closes the case also goes red, which is what forces the marker out in the same commit.

Reference spec: `browser-multi-tab-namespace.spec.js` (the two-tab instrument; the decisions it exercises are in `docs/wiki/namespace-por-atlas.md`). It
pins `retries: 0` via `test.describe.configure`, because retrying a real two-tab race reports it
as "flaky", which is a green run. Read the block comment at the top of that file for the list of
what the cases DO NOT cover, which is as load-bearing as the cases themselves.

**Sem backend, o arquivo inteiro é pulado**, e skip é verde sem verificação. Um caso de guarda
fora da describe reprova a rodada nesse estado, a menos que a intenção seja declarada em
`EBGEO_E2E_NO_DB=1`.

## A bateria final de duas abas: como rodar e como LER

São dois arquivos, e eles se rodam juntos porque compartilham o instrumento e o critério:

```bash
# a bateria inteira (os dois arquivos, ~15 min em série, um worker)
DB_USER=postgres DB_PASSWORD=postgres npx playwright test browser-multi-tab

# só o namespace (A*), ou só fila + desmontagem (B*)
npx playwright test browser-multi-tab-namespace
npx playwright test browser-multi-tab-teardown
```

Os dois pinam `retries: 0` (`test.describe.configure`): repetir uma corrida real de duas abas e
reportá-la como "flaky" é uma rodada verde. **Rode em série e relate N/N**, nunca uma rodada só:
uma medição única de algo probabilístico não é medição.

### O que cada caso prova

| caso | arquivo | o que fica provado se ele passa |
|---|---|---|
| A0z | namespace | o servidor do e2e não trocou a página no meio da medição (sem socket de HMR, sem módulo `?t=`). É o controle do instrumento: sem ele, os outros casos podem estar medindo outra cópia do app. |
| A0a | namespace | duas abas no mesmo atlas **LOCAL** colidem, e a segunda é bloqueada. É a regra do ENDEREÇO: um par local x local não passa pela espera de `keysCollide`. |
| A0b | namespace | uma SEGUNDA aba desenha de verdade, e o ponto cai no namespace dela (e em nenhum banco local). |
| A0c | namespace | o que a aba local escreve não chega ao atlas de servidor da outra aba. É a única asserção da bateria que pergunta ao SERVIDOR. |
| A1 | namespace | **PENDENTE (E7)**: duas abas em atlas distintos, as duas vivas, sem vazamento cruzado no disco nem no servidor. |
| A2 | namespace | duas abas no MESMO atlas remoto: a segunda mostra o overlay. É o controle negativo de A1 (sem ele, "as duas passaram" é indistinguível de um predicado sempre-falso). |
| A2b | namespace | **PENDENTE**: a aba bloqueada fica mesmo parada (foi medido que ela reconectava ~2 s depois). |
| A3b | namespace | depois do logout da própria aba, nada do atlas de servidor continua legível em banco nenhum. |
| A4 | namespace | **PENDENTE (E1)**: visitante de link público não polui os bancos do atlas LOCAL. |
| B0 | fila/desmontagem | o bfcache está DESLIGADO neste runner. Não é decoração: é o que impede um caso de fingir que cobre o Web Lock sob bfcache. |
| B1 | fila/desmontagem | a fila de saída da aba A sobrevive à TROCA DE PROJETO na aba B. Era o defeito mais caro da fase (a fila era global e um `clear` apagava a de todos). |
| B2 | fila/desmontagem | a fila do atlas X sobrevive a sair de X e voltar, isto é, o wipe de entrada não destrói a fila do atlas que está sendo aberto. |
| B3 | fila/desmontagem | o aviso de desmontagem chega à aba vizinha, ela congela (o overlay TROCA de texto) e os bancos condenados **não voltam** depois de uma escrita tardia. |

### Como ler uma falha

1. **Um caso marcado `test.fail()` que aparece como FALHA da rodada é boa notícia**, e o anexo
   diz qual: `O GATE PASSOU` significa que o defeito fechou e que o marcador tem de sair no
   mesmo commit. `SETUP QUEBRADO` ou `O GATE CAIU POR OUTRO MOTIVO` significam harness, nunca
   defeito. `ORÇAMENTO ESTOURADO` vira um SKIP com a razão anexada, e um pulo não é um verde.
   Hoje isso vale para A1, A2b e A4: **E1 e E2 entraram depois que esses três foram escritos**,
   então A2b e A4 podem muito bem passar nesta rodada. Se passarem, apague o `test.fail()`.
2. **Um caso B que falha é vermelho de verdade**, porque nenhum deles é `test.fail`. A diferença
   é propositalmente essa: B1/B2/B3 medem código que já entrou.
3. Todo caso desta bateria anexa a evidência (a lista de `indexedDB.databases()`, a série de
   amostras, o diagnóstico da aba). **Leia o anexo antes da mensagem**, porque a mensagem diz o
   que foi violado e o anexo diz o que a aba virou.

### O que a bateria NÃO cobre (e não deve ser lido como se cobrisse)

- **O Web Lock sob `pagehide`/bfcache**, que é a janela em que a Decisão 1 do plano alega que o
  lock ganha de um lease. **Não é reproduzível aqui**: o Playwright 1.61.1 sobe o Chromium com
  `--disable-back-forward-cache` entre os switches PADRÃO (`playwright-core/lib/coreBundle.js`,
  lista `chromiumSwitches`), e B0 mede o efeito disso em vez de confiar na leitura. Ligar o
  bfcache exigiria `ignoreDefaultArgs` + `--enable-features=BackForwardCache`, e ainda assim uma
  aba do mapa (WebSocket vivo, IndexedDB aberto) é candidata duvidosa a entrar nele: duas
  incertezas independentes, uma delas do produto.
- **Duas abas em atlas remotos DISTINTOS**, fora de A1: bloqueado por E7, e a aba bloqueada nem
  executa o caminho destrutivo (`openRemoteAtlas` retorna cedo quando a claim falha).
- **Dois atlas LOCAIS distintos em duas abas**: não há UI para criar o segundo slot.
- **"Uma aba nunca segura dois atlas"**: o único sinal que poderia asseri-lo é `activeScopeOf`,
  que é diagnóstico por desenho.
- **A ORDEM dentro de B3** ("a irmã parou antes de o emissor esvaziar"): o que se assere é o
  efeito da ordem, não a ordem.
- **Uma TERCEIRA aba, F5, fechar-e-reabrir e a tomada de controle por "Usar aqui".**

## How it runs

`playwright.config.js`:
- **`webServer`** runs `npx vite --config ./tests/e2e-ui/vite.e2e.config.js --port 4321
  --strictPort`. That config is the repo's real `vite.config.js` **com o watcher e o HMR
  removidos**: um `src/` editado durante a rodada faria o Vite re-servir o módulo com
  `?t=<epoch>` e recarregar a página no meio da medição (medido: 6 de 10 casos de
  `browser-multi-tab-namespace` caíram de uma vez, por motivo que não é do app). O `@fileoverview`
  daquele arquivo tem os corpos e o controle que prova que o HMR está mesmo fora (caso A0z).
- **`globalSetup`** (`e2e-ui/global-setup.js`) spawns the real `ebgeo_backend` on port
  `3912` against a throwaway `ebgeo_ui_e2e` Postgres DB (created + migrated), with
  `CORS_ORIGIN` set to the Vite origin so the browser can call it cross-origin.
- **`globalTeardown`** kills the backend and drops the DB.
- If Postgres / the backend can't come up, the specs **skip** cleanly (they never fail
  the run for a missing DB).

### Duas cópias do repositório no mesmo computador

As coordenadas desta camada são FIXAS por padrão (Vite 4321, backend 3912, banco
`ebgeo_ui_e2e`, arquivo de estado no temp), então dois checkouts que rodem a suíte ao mesmo
tempo colidem nas quatro. **A colisão pior é silenciosa**: `reuseExistingServer` faz o
Playwright REUSAR um Vite que já esteja na 4321 — servindo o `src/` do OUTRO checkout —, e a
suíte passa a medir código que não é o que se está editando, com tudo verde.

As quatro aceitam variável de ambiente, com os mesmos padrões de antes:

```bash
EBGEO_UI_E2E_APP_PORT=4331 EBGEO_UI_E2E_BACKEND_PORT=3922 \
EBGEO_UI_E2E_DB_NAME=ebgeo_ui_e2e_b npm run test:e2e:ui
```

O arquivo de estado no temp DERIVA da porta do backend, então trocar a porta já o separa;
o banco NÃO deriva de nada e precisa ser passado à parte, senão a segunda rodada dropa o
banco da primeira no meio dela.

### O MESMO checkout também colide consigo mesmo, e essa é a mais fácil de cair

O parágrafo acima descreve dois checkouts. O caso que de fato ocorreu (2026-08-30) é mais
banal: **um Vite desta camada que sobrou de uma rodada anterior e nunca foi encerrado** (o
processo era de VINTE E SEIS HORAS antes). `reuseExistingServer` o reusou, e como este config
não tem watcher, ele continuou servindo o módulo que carregou quando subiu. O sintoma foi uma
captura de tela da aba nova que mostrava o painel **sem** a aba — um `toBeVisible` que falhou
apontando para o produto, quando o errado era o instrumento.

O jeito de descobrir é olhar a idade do processo, não o código:

```bash
netstat -ano | grep ":4321" | grep LISTENING     # o PID que segura a porta
powershell "Get-Process -Id <PID> | Select StartTime"
```

Se o `StartTime` for anterior à sua última edição, mate o processo antes de concluir
qualquer coisa sobre a tela. Um verde (ou um vermelho) obtido de um Vite mais velho que o
código não afirma nada sobre o código.

## Prerequisites (one-time)

Playwright is a `devDependency` but the browser binary must be fetched. Because
`package-lock.json` is protected here, **you** run:

```bash
npm install                       # installs @playwright/test
npx playwright install chromium   # downloads the Chromium build
```

Also needs a reachable PostgreSQL with PostGIS (same as the backend test suite:
superuser `postgres:postgres` for `CREATE EXTENSION`, app role `ebgeo:ebgeo_secret`).

`global-setup` reads `DB_USER` / `DB_PASSWORD` (default `ebgeo` / `ebgeo_secret`) to provision the
throwaway `ebgeo_ui_e2e` DB. On a machine whose Postgres only has the `postgres:postgres`
superuser (no `ebgeo` role), **override** them — otherwise the backend won't come up and the
specs `skip` instead of running.

## Run

```bash
npm run test:e2e:ui                                   # full browser-E2E suite

# Machine without the `ebgeo` role → point it at your local Postgres:
DB_USER=postgres DB_PASSWORD=postgres npm run test:e2e:ui

# A single spec (substring match on the filename):
DB_USER=postgres DB_PASSWORD=postgres npx playwright test browser-authz-ui
```

This neither commits nor touches `package-lock.json`.
