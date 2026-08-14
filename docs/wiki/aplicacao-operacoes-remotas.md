# Fluxo Inbound: Aplicação de Operações Remotas

O que só se vê atravessando `frontend/src/js/store/sync/ws-client.js`, `frontend/src/js/store/sync/sync-gateway.js`, `frontend/src/js/store/sync/remote-operation-handler.js`, `frontend/src/js/store/sync/operation-dispatcher.js` e `frontend/src/js/store/sync/sync-engine.js` ao mesmo tempo. O caminho em si está comentado linha a linha no código; aqui ficam as decisões, as armadilhas e o que não pode mudar.

Transporte em [[canal-collab-websocket]], formato do `op` em [[envelope-operacao]].

## O guard de convergência vive em três arquivos

Nenhum arquivo isolado mostra o ciclo completo. O incremento está no caminho **outbound** (`markLocalEditPending`, `frontend/src/js/store/sync/operation-dispatcher.js`), o decremento chega pelo **ack do push** (`frontend/src/js/store/sync/sync-engine.js`) e a auto-cura roda **depois de todo flush** (`reconcilePendingLocalEdits`, `frontend/src/js/store/sync/remote-operation-handler.js`).

Por que o ack precisa semear a versão do próprio autor: o `ws-client` descarta o eco da própria op, logo **o autor nunca aprende a `serverVersion` da própria op pelo WebSocket**. Se o ack não semeasse `lastAppliedVersion`, a op de um peer com versão menor seria aplicada por cima da edição local.

Por que a reconciliação pós-flush é obrigatória e não defensiva: o contador por op vaza sempre que a simetria incremento/decremento quebra (compactação da fila, ops em lote, ack sem versão, batch envenenado). Um contador vazado deixa aquela entidade **permanentemente adiada**, ou seja divergência silenciosa, sem erro. A fila de operações é a fonte de verdade da cura, não o contador. Ver [[fila-operacoes-outbound]] e [[ack-idempotencia]].

Alternativa rejeitada: resolver conflito por `timestamp` ou pelo relógio de Lamport. O Lamport é registrado e nunca decide; o vencedor é sempre `max(serverVersion)`. Ver [[modelo-conflito-lww]] e [[idempotencia-e-convergence-guard]].

## Contratos congelados

- **Nunca aplicar ops em paralelo.** A cadeia `_applyChain` (`frontend/src/js/store/sync/ws-client.js`) não é cosmética: as feições moram **dentro do registro do mapa** no IndexedDB, e os handlers fazem read-modify-write assíncrono desse registro inteiro. Um `Promise.all` em qualquer novo chamador reintroduz o clobber e some com todas as ops menos uma. Por isso `pull()` e `sync_response` usam `for ... await` sequencial.
- **Nunca chamar guard de permissão, log de operação ou undo** no caminho inbound (contrato no cabeçalho, `frontend/src/js/store/sync/remote-operation-handler.js`). Logar cria loop de feedback. Ver [[permissoes-atlas]].
- **Persistir sempre, não apenas emitir.** Bug histórico deste arquivo: layer e group só emitiam, e o peer ficava sem a camada porque **nenhum subscriber persiste eventos `LAYER_*`/`GROUP_*`**. Ao adicionar um `entityType`, escreva na mesma chave que o setter local usa e confira se o consumidor lê por id ou por nome. Ver [[tipos-entidade-sync]].
- **`server_version` é sequência global entre atlas**: monotônica, **não contígua** por atlas. Buraco é op de outro atlas, não op perdida. Tratar não-contiguidade como gap já gerou tempestade de `sync_request`.

## Onde o código convida ao erro

- **`isOnline()` é estritamente `ONLINE`**, não `RECONNECTING` (`frontend/src/js/store/sync/connection-state.js`). Ops que chegam durante reconexão são descartadas **de propósito**: o gate existe para que a janela disconnect→clear (logout, troca de atlas) não persista dados remotos num store sendo destruído. A recuperação é o `sync_request` do handshake, não o gate. Ver [[dominio-local-vs-remoto]].
- **Chaveamento id vs nome não é simétrico por design, só por acidente.** 3D/360/comment resolvem UUID→nome antes do repo; o snapshot passa `map.id` direto. Os dois funcionam porque `local.repository._resolveMapKey` normaliza qualquer um. Não confie nisso em código novo: resolva explicitamente. O caso que morde é `mapTemporal`, chaveado por **nome** (`temporal_<nome>`) enquanto a op carrega o **UUID**. Ver [[modulo-temporal]].
- **`applyRemoteFeatureOp` UPDATE não cria a feição ausente.** Se o CREATE se perdeu, o UPDATE é engolido em silêncio; a recuperação é o `sync_request`/snapshot, nunca o handler. E a granularidade do LWW é a **feição inteira**: o UPDATE substitui `features[index]` por completo, não mescla campos.

## Buffer, não drop

Feição pode chegar antes do mapa (A cria um mapa e desenha em seguida). Dropar seria perda de dados silenciosa, então a op é bufferizada e o handler retorna `false`. O detalhe não óbvio: esse `false` viaja de volta para que uma op **apenas bufferizada não registre `serverVersion`**, porque registrar faria uma op legítima posterior ser descartada pelo guard. Como o drain contorna `applyRemoteOperation`, ele reaplica o guard à mão.

## Snapshot: o que se perde ao esquecer

Layers, cesium3d, streetview360, groups e comments vêm **inline** no mapa do snapshot, mas todo leitor os lê de **side-stores dedicados**. O snapshot precisa persistir cada um explicitamente; sem isso um atlas puxado re-exporta sem camadas/3D/360 (P11). Ver [[formato-ebgeo-roundtrip]] e [[snapshot-e-pull-incremental]].

O mesmo padrão morde no `locked`: persistir só o setting fazia o lock valer no peer apenas depois de trocar de mapa e voltar, porque o gate real de edição é `isCurrentMapLockedSync`, que lê a memória.

`atlas_updated`, `map_duplicated` e `maps_merged` disparam `resync()` porque essas mudanças acontecem **fora do log de ops** (clone/merge/rename via REST) e nunca chegariam como operação. Ver [[clone-atlas]] e [[api-rest-atlas]].

## Wiring

O handler é registrado em dois pontos: `frontend/src/js/store/services.js` e `_wireOnce` no `sync-engine`. A duplicação é intencional: o caminho inbound funciona mesmo antes do engine conectar. Ver [[sessao-boot-e-ciclo-de-vida]].

O redesenho não acontece aqui: as camadas MapLibre reagem aos eventos de ciclo de vida. `applyRemoteMapOp` emite `LAYERS_CHANGED` além de `MAP_*` porque a lista de mapas, o card do mapa atual e o badge de recentes escutam `LAYERS_CHANGED`, não `MAP_*`.
