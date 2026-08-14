# SyncLedger (observabilidade do sync)

Camada aditiva e gated de tracing test/dev-only que carimba um traceId no gesto e grava spans tipados em ring buffers do browser e do backend, fundidos por op.id para tornar o pipeline multiusuário verificável ponta a ponta.

O código do módulo (`frontend/src/js/store/sync/diag/`) é fortemente comentado: enum de estágios, custo do `record()`, motivo do probe de render ser opt-in e a razão de cada drop estão no JSDoc do próprio arquivo. Esta página cobre só o que **não** se descobre lendo um arquivo por vez.

## Por que a chave de junção é `op.id` e não `traceId`

O `traceId` nasce no gesto (`frontend/src/js/store/store-transaction.js`) e é enriquecimento best-effort: liga um gesto às N ops que ele produziu. O `op.id` é a chave primária de merge porque sobrevive a todo hop sem depender de ninguém propagar campo extra, inclusive ao pull incremental, que até 2026-07-25 devolvia o PK da linha em `operations` e por isso gerava um grupo órfão para toda op recuperada por replay ([[tabela-operations]]). Se algum salto perder o `traceId`, o merge degrada para junção por `op.id` e nada quebra. Não inverta essa prioridade ao mexer no merger.

Ele sobrevive ao backend porque o Joi do [[envelope-operacao]] é `.unknown(true)` **e** o `traceId` é explícito no schema, então volta no broadcast do [[canal-collab-websocket]]. Perder qualquer uma das duas condições degrada o ledger em silêncio: nenhum teste falha, só a correlação por gesto some.

## Contrato de concorrência do ambiente

O `traceId` é publicado como ambiente e lido **sincronamente** por `createOperation` durante o `tx.commit()`, com limpeza no `finally` (`frontend/src/js/store/store-transaction.js`). A ausência de `await` entre o set e a leitura é o que impede transações concorrentes de se contaminarem.

> **Não introduza um `await` dentro de `tx.commit()`.** Não há teste que pegue isso; a falha aparece como ops de um gesto carimbadas com o traceId de outro, o que corrompe a análise sem quebrar o sync.

## Armadilhas de leitura

- **`flush.skip` e `presence` estão no enum mas nenhum call site os emite** (as duas constantes só aparecem em `frontend/src/js/store/sync/diag/trace-stages.js`). Esperar por elas em teste trava até o timeout. Para presença, use os sinais de [[presenca-colaborativa]] diretamente.
- **Ausência de `action.origin` significa transação abortada, não tracer perdido.** O span é gravado depois da persistência; um gesto cujo `persistFn` lança faz rollback antes de qualquer span.
- **Uma op de feição apenas bufferizada não emite `apply.persist`.** Ela emite quando `drainPendingFeatureOps` de fato grava, que pode ser bem depois. Ver [[aplicacao-operacoes-remotas]].
- **O ring do cliente corta por `splice`** (`frontend/src/js/store/sync/diag/trace-core.js`). Em run longo os spans mais antigos somem sem aviso e uma op antiga parece nunca ter existido. Use `setCapacity` ou drene por teste.
- **O anel do servidor tem dois cortes, não um, e o segundo pega quem não espera.** Além da capacidade **por atlas**, o `Map` de anéis retém no máximo `MAX_ATLAS_RINGS` e evicta o mais antigo por FIFO (`backend/src/utils/sync-trace.js`). Uma suíte que cria um atlas por spec passa desse teto e perde os spans de servidor dos primeiros: `collectLedger` continua devolvendo cadeia, só que degradada para o lado do cliente, sem avisar. Quem procura o sumiço olha o ring do browser, que está intacto. (`clearTrace` sem `atlasId` ainda limpa todos os anéis; o que deixou de alcançar esse caminho foi o HTTP, que agora exige `atlasId`.)

## O que não é bug (invariante I10)

Vários sumiços são intencionais e aparecem como `outcome`/`reason` explícitos, não como falha: drop `non_uuid_mapId` no mapa local `Principal` (anti-leak, ver [[dominio-local-vs-remoto]]), `ws.self-echo` do próprio autor por [[client-id-estavel]], `gateway.gate{offline}` e `preflush.drop{logging_disabled}` no modo offline-first anônimo.

Caso que confunde mais: mutações fora do log de ops (`atlas_updated`, `map_duplicated`, `maps_merged`) provocam **re-pull de snapshot** no cliente, não apply de op. Elas nunca terão cadeia de span de op, e procurar uma é perder tempo. Ver [[snapshot-e-pull-incremental]] e [[atlas-modelo-de-dados]].

## Ordenação causal

`serverVersion` primeiro, depois `ts`, depois `seq` por ator (`frontend/tests/e2e-ui/helpers/ledger.js`). **Nunca ordene por relógio de parede entre atores.** Coerente com [[modelo-conflito-lww]]: quem vence é `max(serverVersion)`, não o timestamp nem o Lamport.

## O elo que a lista canônica de spans esquece

`apply.persist` é o span que fecha a cadeia completa ("escreveu no IndexedDB") e é o que falta em toda enumeração herdada de emissores, que costuma parar em dispatcher, engine, ws-client e gateway. Ele sai de **quatro** pontos, dois de cada lado: `frontend/src/js/store/sync/operation-dispatcher.js` (autor) e `frontend/src/js/store/sync/remote-operation-handler.js` (peer). Um teste que espera cadeia completa e não vê esses quatro está medindo transporte, não persistência.

O espelho de backend do enum de estágios é `backend/src/utils/sync-trace.js`, e só ele; os dois lados se citam pelo caminho real e precisam ficar em lockstep, porque estágio desconhecido faz o merger sinalizar.

## O anel do servidor: dois guardas, não um

`backend/src/modules/debug/debug.routes.js` expõe `GET`/`DELETE /api/v1/debug/trace`, e a garantia "nunca em produção" é uma **conjunção** verificada no ponto de montagem: `isTraceEnabled() && !config.isProd` (`backend/src/app.js`). O segundo termo existe porque `EBGEO_TRACE=1` pode vazar para um ambiente de produção; nesse caso o tracer liga e as rotas continuam não montadas.

O segundo não-óbvio é o gate: o anel é **por atlas**, então ler ou limpar é ação por atlas e passa por `requireAtlasPermission`, não por `auth` sozinho. O `atlasId` chega como query param (as rotas de sync usam param de rota), e `liftAtlasIdToParams` o promove a `req.params` antes do gate, rejeitando 400 quando ausente. O `DELETE` pede `manage`, mais que o `read` do `GET`, porque a versão anterior aceitava a ausência de `atlasId` como "limpe todos os anéis", que era um wipe cross-atlas por qualquer portador de token.

## Histórico

- 2026-07-24: o JSDoc de `frontend/src/js/store/sync/diag/trace-stages.js:7` apontava para um espelho de backend em `collab/trace/`, caminho morto duas vezes (prefixo do layout pré-monorepo mais um diretório que nunca existiu). Não eram dois arquivos distintos, era um ponteiro podre; os dois lados passaram a se citar pelo caminho real.
- 2026-07-25: apagado um `[!CONTRADICAO]` que registrava a ausência de `apply.persist` na enumeração de spans de um guia absorvido. Contradição contra prosa já removida é irresolvível por construção; o fato virou a seção sobre o quarto elo.
