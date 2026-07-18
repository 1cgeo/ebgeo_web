# SyncLedger (observabilidade do sync)

Camada aditiva e gated de tracing test/dev-only que carimba um traceId no gesto e grava spans tipados em ring buffers do browser e do backend, fundidos por op.id para tornar o pipeline multiusuário verificável ponta a ponta.

O código do módulo (`src/js/store/sync/diag/`) é fortemente comentado: enum de estágios, custo do `record()`, motivo do probe de render ser opt-in e a razão de cada drop estão no JSDoc do próprio arquivo. Esta página cobre só o que **não** se descobre lendo um arquivo por vez.

## Por que a chave de junção é `op.id` e não `traceId`

O `traceId` nasce no gesto (`src/js/store/store-transaction.js:116`) e é enriquecimento best-effort: liga um gesto às N ops que ele produziu. O `op.id` é a chave primária de merge porque sobrevive a todo hop sem depender de ninguém propagar campo extra. Se algum salto perder o `traceId`, o merge degrada para junção por `op.id` e nada quebra. Não inverta essa prioridade ao mexer no merger.

Ele sobrevive ao backend porque o Joi do [[envelope-operacao]] é `.unknown(true)` **e** o `traceId` é explícito no schema, então volta no broadcast do [[canal-collab-websocket]]. Perder qualquer uma das duas condições degrada o ledger em silêncio: nenhum teste falha, só a correlação por gesto some.

## Contrato de concorrência do ambiente

O `traceId` é publicado como ambiente e lido **sincronamente** por `createOperation` durante o `tx.commit()`, com limpeza no `finally` (`src/js/store/store-transaction.js:120-126`). A ausência de `await` entre o set e a leitura é o que impede transações concorrentes de se contaminarem.

> **Não introduza um `await` dentro de `tx.commit()`.** Não há teste que pegue isso; a falha aparece como ops de um gesto carimbadas com o traceId de outro, o que corrompe a análise sem quebrar o sync.

## Armadilhas de leitura

- **`flush.skip` e `presence` estão no enum mas nenhum call site os emite.** Grep confirma: as duas constantes só aparecem em `src/js/store/sync/diag/trace-stages.js`. Esperar por elas em teste trava até o timeout. Para presença, use os sinais de [[presenca-colaborativa]] diretamente.
- **Ausência de `action.origin` significa transação abortada, não tracer perdido.** O span é gravado depois da persistência (`src/js/store/store-transaction.js:122`); um gesto cujo `persistFn` lança faz rollback antes de qualquer span.
- **Uma op de feição apenas bufferizada não emite `apply.persist`.** Ela emite quando `drainPendingFeatureOps` de fato grava (`src/js/store/sync/remote-operation-handler.js:72`), que pode ser bem depois. Ver [[aplicacao-operacoes-remotas]].
- **O ring corta em 5000 spans por `splice`** (`src/js/store/sync/diag/trace-core.js:20`, `:84`). Em run longo os spans mais antigos somem sem aviso e uma op antiga parece nunca ter existido. Use `setCapacity` ou drene por teste.

## O que não é bug (invariante I10)

Vários sumiços são intencionais e aparecem como `outcome`/`reason` explícitos, não como falha: drop `non_uuid_mapId` no mapa local `Principal` (anti-leak, ver [[dominio-local-vs-remoto]]), `ws.self-echo` do próprio autor por [[client-id-estavel]], `gateway.gate{offline}` e `preflush.drop{logging_disabled}` no modo offline-first anônimo.

Caso que confunde mais: mutações fora do log de ops (`atlas_updated`, `map_duplicated`, `maps_merged`) provocam **re-pull de snapshot** no cliente, não apply de op. Elas nunca terão cadeia de span de op, e procurar uma é perder tempo. Ver [[snapshot-e-pull-incremental]] e [[atlas-modelo-de-dados]].

## Ordenação causal

`serverVersion` primeiro, depois `ts`, depois `seq` por ator (`tests/e2e-ui/helpers/ledger.js:47-52`). **Nunca ordene por relógio de parede entre atores.** Coerente com [[modelo-conflito-lww]]: quem vence é `max(serverVersion)`, não o timestamp nem o Lamport (ver [[sintese-nao-e-crdt]]).

## Contradições pendentes

> **[!CONTRADICAO]** O guia *arquitetura-sync* (absorvido) §12.3 lista os spans instrumentados como `src/js/store/sync/operation-dispatcher.js`, `src/js/store/sync/sync-engine.js`, `src/js/store/sync/ws-client.js` e `src/js/store/sync/sync-gateway.js`, e **não menciona `apply.persist`**. O código emite `apply.persist` em quatro pontos: `src/js/store/sync/operation-dispatcher.js:152` e `:212` (autor), `src/js/store/sync/remote-operation-handler.js:72` e `:356` (peer). O doc está desatualizado em relação ao wire de cadeia completa.

> **[!CONTRADICAO]** O mesmo §12.3 aponta o espelho de backend para `src/utils/sync-trace.js`, enquanto o JSDoc de `src/js/store/sync/diag/trace-stages.js:7` aponta para `ebgeo_backend/src/modules/collab/trace/trace-stages.js`. São dois arquivos distintos (ring vs. enum) ou um deles moveu. O enum precisa ficar em lockstep com o backend sob pena de o merger sinalizar estágio desconhecido; ao mexer nele, **confirme o caminho real no repo do backend** antes de confiar em qualquer dos dois.

## Fontes

- `src/js/store/sync/diag/{trace-stages,trace-core,bus-tap}.js`: contrato de estágios, ring buffer, tap `onAny` e probe de render (JSDoc extenso, leia antes de perguntar).
- `src/js/store/store-transaction.js`, `src/js/store/sync/operation-factory.js`: mint e propagação do `traceId`.
- `tests/e2e-ui/helpers/{trace-helpers,ledger}.js`: esperas determinísticas, merge dos anéis, ordenação causal e invariantes de cadeia.
- guia *arquitetura-sync* (absorvido) §12-13 e *05-sync-crdt* (absorvido) §1: origem das duas contradições acima.
