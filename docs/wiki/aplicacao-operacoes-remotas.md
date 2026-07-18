# Fluxo Inbound: Aplicação de Operações Remotas

O que só se vê atravessando `frontend/src/js/store/sync/ws-client.js`, `frontend/src/js/store/sync/sync-gateway.js`, `frontend/src/js/store/sync/remote-operation-handler.js`, `frontend/src/js/store/sync/operation-dispatcher.js` e `frontend/src/js/store/sync/sync-engine.js` ao mesmo tempo. O caminho em si está comentado linha a linha no código; aqui ficam as decisões, as armadilhas e o que não pode mudar.

Transporte em [[canal-collab-websocket]], formato do `op` em [[envelope-operacao]].

## O guard de convergência vive em três arquivos

Nenhum arquivo isolado mostra o ciclo completo. O incremento está no caminho **outbound** (`frontend/src/js/store/sync/operation-dispatcher.js:147`, `markLocalEditPending`), o decremento chega pelo **ack do push** (`frontend/src/js/store/sync/sync-engine.js:77`) e a auto-cura roda **depois de todo flush** (`frontend/src/js/store/sync/sync-engine.js:298` → `reconcilePendingLocalEdits`, `frontend/src/js/store/sync/remote-operation-handler.js:203`).

Por que o ack precisa semear a versão do próprio autor: o `ws-client` descarta o eco da própria op (`frontend/src/js/store/sync/ws-client.js:397`), logo **o autor nunca aprende a `serverVersion` da própria op pelo WebSocket**. Se o ack não semeasse `lastAppliedVersion`, a op de um peer com versão menor seria aplicada por cima da edição local.

Por que a reconciliação pós-flush é obrigatória e não defensiva: o contador por op vaza sempre que a simetria incremento/decremento quebra (compactação da fila, ops em lote, ack sem versão, batch envenenado). Um contador vazado deixa aquela entidade **permanentemente adiada** (divergência silenciosa, sem erro). A fila de operações é a fonte de verdade da cura, não o contador. Ver [[fila-operacoes-outbound]] e [[ack-idempotencia]].

Alternativa rejeitada: resolver conflito por `timestamp` ou pelo relógio de Lamport. O Lamport é registrado e nunca decide (`frontend/src/js/store/sync/sync-gateway.js:39`); o vencedor é sempre `max(serverVersion)`. Ver [[sintese-nao-e-crdt]], [[modelo-conflito-lww]] e [[idempotencia-e-convergence-guard]].

## Contratos congelados

- **Nunca aplicar ops em paralelo.** A cadeia `_applyChain` (`frontend/src/js/store/sync/ws-client.js:409`) não é cosmética: os handlers fazem read-modify-write assíncrono do **registro inteiro do mapa** no IndexedDB. Um `Promise.all` em qualquer novo chamador reintroduz o clobber e some com todas as ops menos uma. Por isso `pull()` e `sync_response` usam `for ... await` sequencial (`frontend/src/js/store/sync/sync-engine.js:405`, `:414`).
- **Nunca chamar guard de permissão, log de operação ou undo** no caminho inbound (contrato no cabeçalho, `frontend/src/js/store/sync/remote-operation-handler.js:11-15`). Logar cria loop de feedback. Ver [[permissoes-atlas]].
- **Persistir sempre, não apenas emitir.** Bug histórico deste arquivo: layer e group só emitiam, e o peer ficava sem a camada porque **nenhum subscriber persiste eventos `LAYER_*`/`GROUP_*`**. Ao adicionar um `entityType`, escreva na mesma chave que o setter local usa e confira se o consumidor lê por id ou por nome. Ver [[tipos-entidade-sync]].
- **`server_version` é sequência global entre atlas** (`frontend/src/js/store/sync/ws-client.js:386-394`): monotônica, **não contígua** por atlas. Buraco é op de outro atlas, não op perdida. Tratar não-contiguidade como gap já gerou tempestade de `sync_request`.

## Onde o código convida ao erro

- **`isOnline()` é estritamente `ONLINE`**, não `RECONNECTING` (`frontend/src/js/store/sync/connection-state.js:62`). Ops que chegam durante reconexão são descartadas **de propósito**: o gate existe para que a janela disconnect→clear (logout, troca de atlas) não persista dados remotos num store sendo destruído. A recuperação é o `sync_request` do handshake, não o gate. Ver [[dominio-local-vs-remoto]].
- **Chaveamento id vs nome não é simétrico por design, só por acidente.** 3D/360/comment resolvem UUID→nome antes do repo; o snapshot passa `map.id` direto. Os dois funcionam porque `local.repository._resolveMapKey` normaliza qualquer um. Não confie nisso em código novo: resolva explicitamente. O caso que morde é `mapTemporal`, chaveado por **nome** (`temporal_<nome>`) enquanto a op carrega o **UUID**. Ver [[modulo-temporal]].
- **`applyRemoteFeatureOp` UPDATE não cria a feição ausente** (`frontend/src/js/store/sync/remote-operation-handler.js:428`). Se o CREATE se perdeu, o UPDATE é engolido em silêncio; a recuperação é o `sync_request`/snapshot, nunca o handler.
- **Defeito latente:** `applyRemoteFeatureOp` é declarada com 5 parâmetros (`:389`) e chamada com 7 (`:282`, `:68`); os extras são ignorados. Em par, `bufferPendingFeatureOp` guarda só `{opType, featureId, data, serverVersion}` (`:397`), então o `record()` do drain lê `opId`/`traceId` como `undefined` (`:73`). Efeito hoje limitado ao [[syncledger]] (dev/teste): o span do replay perde a chave de join. Corrigir os dois juntos.

## Buffer, não drop

Feição pode chegar antes do mapa (A cria um mapa e desenha em seguida). Dropar seria perda de dados silenciosa, então a op é bufferizada e o handler retorna `false` (`:398`). O detalhe não óbvio: esse `false` viaja até `:346` para que uma op **apenas bufferizada não registre `serverVersion`**: registrar faria uma op legítima posterior ser descartada pelo guard. Como o drain contorna `applyRemoteOperation`, ele reaplica o guard à mão (`:67`, `:78-79`).

> **Nota histórica.** guia *05-sync-crdt* (absorvido) §16 mostra `applyRemoteOperation` fazendo `mergeChanges(existing, op.changes)` no UPDATE e `store.delete(op.entityId)` num object store por entityType; o código em `frontend/src/js/store/sync/remote-operation-handler.js:431` faz `features[index] = data` (substituição cega da feição inteira, sem `op.changes` e sem criar quando ausente) e guarda as feições **dentro do registro do mapa**, não num store `features` separado. O pseudocódigo do guia é ilustrativo; a granularidade LWW é a feição inteira.

## Snapshot: o que se perde ao esquecer

Layers, cesium3d, streetview360, groups e comments vêm **inline** no mapa do snapshot, mas todo leitor os lê de **side-stores dedicados**. O snapshot precisa persistir cada um explicitamente (`:1177-1210`); sem isso um atlas puxado re-exporta sem camadas/3D/360 (P11). Ver [[formato-ebgeo-roundtrip]] e [[snapshot-e-pull-incremental]].

O mesmo padrão morde no `locked`: persistir só o setting fazia o lock valer no peer apenas depois de trocar de mapa e voltar, porque o gate real de edição é `isCurrentMapLockedSync`, que lê a memória (`:1124-1126`).

`atlas_updated`, `map_duplicated` e `maps_merged` (`frontend/src/js/store/sync/ws-client.js:352-358`) disparam `resync()` porque essas mudanças acontecem **fora do log de ops** (clone/merge/rename via REST) e nunca chegariam como operação. Ver [[clone-atlas]] e [[api-rest-atlas]].

## Wiring

O handler é registrado em dois pontos: `frontend/src/js/store/services.js:87` e `frontend/src/js/store/sync/sync-engine.js:400` (`_wireOnce`). A duplicação é intencional: o caminho inbound funciona mesmo antes do engine conectar. Ver [[sessao-boot-e-ciclo-de-vida]].

O redesenho não acontece aqui: as camadas MapLibre reagem aos eventos de ciclo de vida. `applyRemoteMapOp` emite `LAYERS_CHANGED` além de `MAP_*` porque a lista de mapas, o card do mapa atual e o badge de recentes escutam `LAYERS_CHANGED`, não `MAP_*` (`:571-572`).

## Fontes

- guia *arquitetura-sync* (absorvido) §6, §7 e §"LWW por ordem de chegada".
- guia *05-sync-crdt* (absorvido) §16 e §"Eco do autor" (pseudocódigo divergente, ver contradição).
- guia *03-sync-inicial* (absorvido): pull híbrido (`sinceVersion = 0` → snapshot completo).
- `src/js/store/sync/`: `frontend/src/js/store/sync/remote-operation-handler.js`, `frontend/src/js/store/sync/ws-client.js`, `frontend/src/js/store/sync/sync-gateway.js`, `frontend/src/js/store/sync/sync-engine.js`, `frontend/src/js/store/sync/operation-dispatcher.js`. Todos com o porquê comentado no ponto de uso.
