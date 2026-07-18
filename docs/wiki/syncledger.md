# SyncLedger (observabilidade do sync)

Camada aditiva e gated de tracing test/dev-only que carimba um traceId no gesto e grava spans tipados em ring buffers do browser e do backend, fundidos por op.id para tornar o pipeline multiusuário verificável ponta a ponta.

## Por que existe

O caminho de uma edição atravessa três runtimes (browser A, servidor, browser B). Sem correlação, uma falha vira "buraco negro silencioso": o estado final está errado e não há sinal de **em qual estágio** morreu (o gesto não gerou op? a op foi dropada antes do flush? o servidor aplicou com `rowsAffected=0`? o peer filtrou como eco?). O SyncLedger resolve isso carimbando **uma** chave de correlação no nascimento do gesto e costurando-a pelos tokens que já existem no [[envelope-operacao]] (`op.id`, `clientId`, `lamportTimestamp`, `serverVersion`).

Regra de ouro do design: **`op.id` é a chave de junção primária** (sempre funciona); `traceId` é enriquecimento best-effort que liga o gesto às N ops que ele produziu. Se algum hop remover o `traceId`, o merge degrada para junção por `op.id` e nada quebra (`operation-factory.js:94-96`).

## Onde o traceId nasce e como viaja

`runTransaction` minta `const traceId = generateUUID()` e só o publica como ambiente **depois** que a persistência local passou (`store-transaction.js:116`, `setActionTraceId(traceId)` em `:120`, antes de `tx.commit()`). Consequências práticas:

- Um gesto cuja persistência falha **não emite `action.origin` nenhum** (o `catch` faz rollback antes). Ausência de span aqui significa "a transação abortou", não "o tracer perdeu".
- O ambiente é lido **sincronamente** por `createOperation` durante o commit e limpo no `finally` (`store-transaction.js:120-126`). Não há `await` entre set e leitura, então transações concorrentes não se contaminam. Não introduza um `await` dentro de `tx.commit()` sem repensar isso.
- `createOperation` e `createBatchOperations` copiam o ambiente para `op.traceId` (`operation-factory.js:162` e `:188`). No backend o campo sobrevive porque o Joi do envelope é `.unknown(true)` e o `traceId` é explícito no schema, logo ele é ecoado no broadcast do [[canal-collab-websocket]].

## Contrato de estágios

`trace-stages.js` é o vocabulário único que frontend, backend e o merger de teste compartilham (`SPAN_SCHEMA_VERSION = 1`, `trace-stages.js:13`). O backend mantém uma **cópia espelho** que precisa ficar em lockstep: o merger valida `stage` contra `KNOWN_STAGES` e sinaliza estágio desconhecido em vez de descartar em silêncio (`trace-stages.js:6-9`, `:66`).

Estágios (`trace-stages.js:20-41`), na ordem do fluxo:

| Fase | Estágios |
|---|---|
| Saída (autor) | `action.origin`, `enqueue`, `preflush.drop`, `flush.push`, `flush.skip`, `push.ack` |
| Servidor | `server.inserted`, `server.applied`, `server.broadcast` |
| Entrada (peer) | `ws.inbound`, `ws.self-echo`, `gateway.gate`, `apply.persist`, `remote.applied` |
| Efeito/lateral | `render.source`, `presence`, `conn.transition` |

`outcome ∈ { ok, dropped, filtered, failed, idempotent, no-effect }` (`:44-51`). `DropReason` nomeia o porquê: `logging_disabled`, `non_uuid_mapId`, `non_uuid_setting_id`, `batch_filtered`, `echo_self`, `offline`, `parse_error`, `unknown_type` (`:54-63`).

> **Armadilha:** `flush.skip` e `presence` estão declarados no enum mas **nenhum call site do frontend os emite hoje** (nenhum `TraceStage.FLUSH_SKIP` / `TraceStage.PRESENCE` fora de `trace-stages.js`). Esperar por eles em teste trava até o timeout. Para presença, use os sinais de [[presenca-colaborativa]] diretamente.

## Onde cada span é emitido (as-built)

- `action.origin` — `store-transaction.js:122`.
- `preflush.drop` — `operation-dispatcher.js:109` (`logging_disabled`, o caso offline/anônimo), `:121` (`non_uuid_setting_id`), `:134` (`non_uuid_mapId`), `:182`/`:201`/`:267` (batch). Esses drops são a defesa contra o "poison batch": um `mapId` não-UUID faz o Postgres devolver 22P02 e **uma** op derruba o batch inteiro do flush, travando todo o sync. Ver [[dominio-local-vs-remoto]].
- `apply.persist` (lado autor) — `operation-dispatcher.js:152` e `:212`. Como a persistência roda **antes** do logging (que está no `deferAsync`), quando esse span é gravado o dado já é durável no IndexedDB. É o par op-keyed do `apply.persist` de entrada, e fecha o elo "escreveu no IDB local".
- `enqueue` — `operation-dispatcher.js:156` / `:216`, entrada na [[fila-operacoes-outbound]].
- `flush.push` — `sync-engine.js:267` (ok) e `:277` (`failed`, com os `opIds` que emperraram; o batch rejeitado **não** é desenfileirado).
- `push.ack` — `sync-engine.js:66` (consome a resposta de `pushOperations`, antes descartada) e `ws-client.js:294`/`:306`. Além do span, `recordPushAcks` semeia o `serverVersion` próprio do autor (`recordLocalAppliedVersion`), porque o autor filtra o próprio eco e de outro modo nunca saberia sua ordem de chegada. Ver [[ack-idempotencia]] e [[idempotencia-e-convergence-guard]].
- `ws.inbound` / `ws.self-echo` / `conn.transition` — `ws-client.js:278` (`parse_error`), `:369` (`unknown_type`), `:378`, `:398` (eco próprio por [[client-id-estavel]]), `:545`/`:550`.
- `gateway.gate` — `sync-gateway.js:41`, com `reason: offline`; é o early-return quando `connectionState.isOnline()` é falso.
- `apply.persist` (lado peer) + `remote.applied` — `remote-operation-handler.js:356` (após o `repo.saveXxx` awaited) e `:72` no replay de ops de feição bufferizadas quando o mapa chegou atrasado. Uma op de feição apenas **bufferizada** não emite `apply.persist` (`:349-355`); ela emite quando `drainPendingFeatureOps` de fato grava. Ver [[aplicacao-operacoes-remotas]].
- `remote.applied` e `render.source` — via tap de barramento, abaixo.

## O tap de barramento

`installSyncTrace(eventBus)` instala **uma** assinatura `eventBus.onAny(...)` (`bus-tap.js:115-118`), chamada uma vez em `store/services.js:91`. O handler faz `if (!isTracing()) return` na primeira linha e depois age só sobre uma allowlist: eventos hot por frame (cursor temporal, cursores de presença) chegam nele e saem por um único miss de `switch`, sem alocar nada (`bus-tap.js:78-108`).

`render.source` é **opt-in separado**, via `globalThis.__EBGEO_TRACE_RENDER__` (`bus-tap.js:35-41`). Motivo: o probe lê a fonte GeoJSON do MapLibre em O(feições) a cada evento de feature; o sinal determinístico normal é `remote.applied`, que é barato. Ligue o probe só quando quiser a paridade store↔render (invariante I6). O probe roda em `queueMicrotask` para ler a fonte **depois** do dispatch síncrono do evento, onde o layer manager chama `setData` (`bus-tap.js:21-25`).

## Custo, segurança e falha

`record()` retorna na primeira linha quando desligado, sem alocar (`trace-core.js:71`), e está envolto em `try/catch` vazio: **um bug de captura nunca pode quebrar o pipeline que observa** (`:85-87`). O módulo é Node-safe: `window`, `localStorage` e `performance` são acessados defensivamente, para o mesmo código rodar em teste unitário.

Spans guardam **apenas escalares, ids e contagens**, nunca geometria nem payload (`trace-core.js:13-14`). Isso limita memória e evita reter PII além dos ids que já trafegam no fio.

Ring buffer: capacidade padrão 5000 spans, com corte por `splice` quando estoura (`trace-core.js:20`, `:84`). Em run longo os spans mais antigos somem; use `setCapacity` ou drene por teste.

## Como ligar

Browser (`trace-core.js:134-153`), qualquer um dos três:

- `globalThis.__EBGEO_TRACE__ = true` (é o que o Playwright faz via `addInitScript`, ver `enableTrace` em `tests/e2e-ui/helpers/trace-helpers.js:14`);
- `?trace=sync` na URL;
- `localStorage['ebgeo_trace'] === '1'`.

A resolução acontece na **Fase 0** do boot, antes de config e serviços, dentro de `try/catch` para nunca bloquear o boot (`index.js:56-57`). Ver [[sessao-boot-e-ciclo-de-vida]]. A superfície pública estável é `window.__ebgeoSyncTrace` (`get`, `byOpId`, `byTraceId`, `has`, `clear`, `drain`, `waitFor`) instalada por `installWindowBridge` (`trace-core.js:160-189`).

Backend: `EBGEO_TRACE=1` (ou `NODE_ENV=test`), lendo `GET /api/v1/debug/trace?atlasId=<id>`; a rota só é montada com o tracer ligado e fora de produção. Em produção é branch morto.

## Uso em teste

`tests/e2e-ui/helpers/trace-helpers.js` substitui o padrão cego `expect.poll(..., { timeout: 20000 })` por esperas precisas por estágio: `waitForRemoteEntity`, `waitForStage`, `waitForAcked`, `waitForFlushPush`, `waitForRenderSource`, `findDropSpan`. No timeout, dumpe `opHistory(page, opId)` para ver exatamente onde a op parou.

Duas armadilhas de matching:

- **`flush.push` é keyed por batch**: carrega `opIds[]`, não `opId`. Logo `byOpId(opId)` e `has(opId, 'flush.push')` **não** o encontram; existe `waitForFlushPush` justamente por isso (`trace-helpers.js:107-119`).
- `waitForRemoteEntity` retorna `false` quando o tracing está desligado (`EBGEO_E2E_NO_TRACE`), em vez de travar; nesse caso a asserção de store do chamador é a fonte da verdade (`trace-helpers.js:29-45`).

`tests/e2e-ui/helpers/ledger.js` funde os anéis: `collectLedger` drena cada página (rotulando `clientA`, `clientB`, …) e, se receber `baseUrl`/`token`/`atlasId`, o anel do backend (rotulado `server`); o anel do servidor é enriquecimento best-effort e falha em silêncio (`ledger.js:24-44`). `reduceLedger` é **puro** (sem Playwright, sem DOM), portanto testável sob Node.

Ordenação causal: `serverVersion` primeiro, depois `ts`, depois `seq` por ator. **Nunca ordene por relógio de parede entre atores** (`ledger.js:47-52`). Isso é coerente com o [[modelo-conflito-lww]]: quem vence é `max(serverVersion)`, não o `timestamp` nem o Lamport (ver [[sintese-nao-e-crdt]] e [[modelo-conflito-lww]]).

`suspectCause` traduz o último estágio alcançado em causa raiz legível: `dropped:<reason>`, `flush_failed_poison_batch`, `acked_but_no_effect`, `gated_offline_on_peer`, `pushed_no_ack`, `enqueued_not_flushed`, `applied_nowhere` (`ledger.js:109-119`).

## Invariantes verificáveis

`findViolations` cobre I1/I5 (órfãs: saiu do autor e nunca aplicou em peer nenhum) e I2 (ack com `rowsAffected=0`) (`ledger.js:159-171`). `findChainViolations` é **opt-in**, fora de `findViolations` para não mudar o comportamento de `assertLedgerClean`, e checa a cadeia completa habilitada pelo `apply.persist` (`ledger.js:187-215`):

- **I-AP1 (autor)**: quem fez `enqueue` tem que ter confirmado a escrita local no IndexedDB.
- **I-AP2 (peer)**: quem fez `remote.applied` de um tipo que persiste tem que ter confirmado a escrita. `slide` é isento (sua op de entrada é no-op redundante).

Ambas exigem um ledger **já fundido** (spans com `actor`). Outras invariantes do gabarito: I3 (LWW por chegada), I6 (paridade store↔render, exige o probe), I7 (broadcast = membros − autor − fechados − read-only para comentário), I9 (transição de conexão legal), I11 (monotonicidade Lamport).

## O que não é bug

Vários "sumiços" são intencionais e aparecem como `outcome`/`reason` explícitos, não como falha (invariante I10): drop `non_uuid_mapId` no mapa local `Principal` (anti-leak), `ws.self-echo` do próprio autor, `gateway.gate{offline}` e `preflush.drop{logging_disabled}` no modo offline-first anônimo. Mutações fora do log de ops (`atlas_updated`, `map_duplicated`, `maps_merged`) provocam re-pull de snapshot no cliente, não apply de op, então não terão cadeia de span de op (ver [[snapshot-e-pull-incremental]] e [[atlas-modelo-de-dados]]).

> [!CONTRADICAO 2026-07-18] guia *arquitetura-sync* (absorvido) §12.3 lista os spans instrumentados como `operation-dispatcher.js` (`preflush.drop` + `enqueue`), `sync-engine.js`, `ws-client.js` e `sync-gateway.js`, e não menciona `apply.persist`. O código emite `apply.persist` em quatro pontos: `src/js/store/sync/operation-dispatcher.js:152` e `:212` (lado autor) e `src/js/store/sync/remote-operation-handler.js:72` e `:356` (lado peer). O doc está desatualizado em relação ao wire de cadeia completa.

> [!CONTRADICAO 2026-07-18] guia *arquitetura-sync* (absorvido) §12.3 aponta o espelho de backend para `src/utils/sync-trace.js`, enquanto o JSDoc de `src/js/store/sync/diag/trace-stages.js:7` aponta o espelho do contrato de estágios para `ebgeo_backend/src/modules/collab/trace/trace-stages.js`. São dois arquivos distintos (ring vs. enum) ou um deles moveu; ao mexer no enum, confirme o caminho real no repo do backend antes de confiar em qualquer dos dois.

## Fontes

- guia *arquitetura-sync* (absorvido) (§12 e §13): ideia central, contrato de estágios, invariantes I1-I11, como ligar, comportamentos por design.
- guia *05-sync-crdt* (absorvido) (§1): `traceId` como campo opcional do envelope, ecoado no broadcast.
- `src/js/store/sync/diag/trace-stages.js`, `trace-core.js`, `bus-tap.js`: enum de estágios/outcomes/reasons, ring buffer e resolver de flag, tap `onAny` e probe de render.
- `src/js/store/store-transaction.js`, `src/js/store/sync/operation-factory.js`: mint e propagação do `traceId`.
- `src/js/store/sync/{operation-dispatcher,sync-engine,ws-client,sync-gateway,remote-operation-handler}.js`: call sites reais de cada span.
- `src/js/index.js`, `src/js/store/services.js`: pontos de instalação no boot.
- `tests/e2e-ui/helpers/{trace-helpers,ledger}.js`: esperas determinísticas, merge dos anéis, ordenação causal e invariantes de cadeia.
