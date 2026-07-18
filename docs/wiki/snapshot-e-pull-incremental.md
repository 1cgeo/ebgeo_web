# Sync Híbrido: Snapshot e Pull Incremental

`GET /atlas/:id/sync/:version` devolve um snapshot completo quando `version == 0` ou `version < min_version`, e uma lista de operações incrementais caso contrário, sinalizado por `isSnapshot`.

## O contrato do endpoint

Rota única para as duas modalidades: `GET /api/v1/atlas/:atlasId/sync/:version`, header `Authorization: Bearer <accessToken>`, permissão mínima `read`. No cliente, o wrapper é `apiClient.pullSync(atlasId, sinceVersion = 0)` (`src/js/store/sync/api-client.js:831`), que faz apenas `GET /atlas/${atlasId}/sync/${sinceVersion}` e devolve o envelope já desembrulhado (`{ snapshot?, operations?, currentVersion, isSnapshot }`).

| Condição no servidor | Resposta |
|---|---|
| `version == 0` **ou** `version < atlas.min_version` | `{ snapshot, currentVersion, isSnapshot: true }` |
| `version >= min_version` | `{ operations: [...], currentVersion, isSnapshot: false }` |

O incremental é literalmente `SELECT * FROM operations WHERE atlas_id=$1 AND server_version > $2 ORDER BY server_version` (ver [[tabela-operations]]). Como o corte é `server_version > sinceVersion`, `currentVersion` é um cursor **exclusivo**: guarde-o e mande-o de volta como está, sem `+1` e sem `-1`.

**Nunca trate o `isSnapshot` como opcional.** Um cliente que pede `/sync/150` pode receber snapshot se um cleanup admin subiu `min_version` acima de 150. É por isso que o campo existe: o cliente decide o caminho de aplicação pela flag, não pela versão que ele pediu.

## Por que dois modos

O log de operações não é infinito. Os endpoints admin de compactação (`POST /atlas/:id/sync/admin/cleanup`, com `keepFromVersion`/`keepDays`) apagam o rabo antigo do log e sobem `min_version`. Sem o fallback de snapshot, um cliente que ficou offline por semanas não teria como se recompor: as operações que ele perdeu deixaram de existir. O snapshot é a rede de segurança que torna a compactação segura.

Ponto crítico e frequentemente mal-entendido: **o snapshot NÃO é replay do log**. Ele é reconstruído a partir das tabelas de entidade (`features`, `layers`, `groups`, `briefings`, ...) numa única leitura, e mapeado para o **mesmo shape do IndexedDB do frontend** (contrato congelado). Cada entidade carrega um objeto `sync` (`{ createdAt, updatedAt, version, ownerId, dirty: false, deleted: false }`), features viram coleções por tipo (`points[]`, `lines[]`, ...) reembrulhadas como GeoJSON, e `cesium3d`/`streetview360` voltam hierárquicos. Consequência prática: o snapshot não sofre das perdas do log compactado, e não existe "op de snapshot" no [[envelope-operacao]].

O incremental, ao contrário, devolve envelopes de operação no vocabulário do frontend (`entityType`/`operationType`/`entityId`/`serverVersion`), com os tipos genéricos `cesium3d`/`streetview360` reconvertidos para os específicos (`marker3d`, `orientation360`, ...) via `data_type` (ver [[tipos-entidade-sync]]). Ou seja, os dois modos entregam formas **diferentes**, e por isso o cliente tem duas funções de aplicação distintas.

## Como o cliente EBGeo usa isso

Três chamadas, todas em `src/js/store/sync/sync-engine.js`:

- **`connect(atlasId, { initialPull = true })`** (`:152`) faz `pullSync(atlasId, 0)`, aplica com `applyRemoteSnapshot(snapshot)` e grava `this._lastVersion = result?.currentVersion ?? 0` (`:157-162`). Só depois abre o WebSocket com `wsClient.connect(atlasId, { lastVersion: this._lastVersion })` (`:186`). `connectPublic` faz o mesmo para o visitante anônimo de [[link-publico]], porém com o logging de operações desabilitado (`:216-228`).
- **`resync()`** (`:332`) faz `pullSync(this._atlasId, 0)`, ou seja, **força snapshot fresco**, e propaga a versão para o socket com `wsClient.setLastVersion` (`:339-340`). É acionada pelo evento WS `serverResync` (`sync-engine.js:493`), emitido para `atlas_updated` / `map_duplicated` / `maps_merged`: mutações feitas pelo servidor **fora** do log de operações, que um pull incremental jamais veria. Guarda `_resyncing` contra execuções sobrepostas.
- **`pull()`** (`:314`) é o pull incremental HTTP puro: `pullSync(atlasId, this._lastVersion)`, aplica `applyRemoteSnapshot` **ou** itera `applyRemoteOperation` conforme o que veio, e avança `_lastVersion`.

> [!CONTRADICAO 2026-07-18] `docs/guias/05-sync-crdt.md` §7 desenha a recuperação pós-offline como `GET /atlas/:id/sync/150` via HTTP, e `docs/guias/03-sync-inicial.md` §11 traz um `SyncManager.incrementalSync()` como implementação de referência. No cliente real, `syncEngine.pull()` não tem **nenhum** chamador em `src/js` (só `connect`/`connectPublic`/`resync` chamam `pullSync`, sempre com versão 0). A recuperação incremental de fato acontece pelo canal WebSocket: `ws-client.js:426` dispara `requestSync(this._lastVersion)` ao reabrir o socket em estado RECONNECTING, e a resposta `sync_response` é tratada em `sync-engine.js:407-425`. O guia descreve o contrato do backend (correto), não o caminho que o frontend exercita.

## O caminho de recuperação real: sync_request/sync_response

Na reconexão, `ws-client._onConnected` (`:419`) detecta que o estado anterior era RECONNECTING e envia `{ type: 'sync_request', lastVersion }` (`:236`). O `sync_response` do servidor é **o mesmo híbrido**: pode trazer `isSnapshot: true` com `snapshot`, ou `ops[]`. O handler em `sync-engine.js:407` reflete isso literalmente, e traz dois cuidados que você não deve remover:

1. **Gate de conexão antes de persistir.** `if (!connectionState.isOnline()) return;` (`:412`) descarta um `sync_response` tardio que chegue na janela disconnect→clear de um logout ou troca de atlas. O caminho de op inbound já era protegido pelo `syncGateway`; o caminho de snapshot não era, e sem isso um snapshot atrasado grava dados do atlas remoto num store que está sendo destruído (ver [[store-origin-local-remoto]]).
2. **Avanço de versão nos dois lugares.** `this._lastVersion = version` **e** `wsClient.setLastVersion(version)` (`:421-423`). `setLastVersion` é monotônico (`ws-client.js:151`: só aceita valor maior), o que evita que um frame fora de ordem regrida o cursor e cause replay eterno.

O `_lastVersion` do socket também avança sozinho a cada op inbound, a partir de `op.serverVersion` (`ws-client.js:392`). Nota importante do código: `server_version` vem de uma sequência **global do atlas** e é **não contígua** por design, então nunca interprete "buraco" na numeração como perda de op. Uma versão anterior fazia isso e gerava tempestades de `sync_request`. Perda real só ocorre atravessando desconexão, e é exatamente isso que o `sync_request` da reconexão cobre. Detalhes do canal em [[canal-collab-websocket]] e [[websocket-collab]].

## Aplicação do snapshot no store local

`applyRemoteSnapshot(snapshot)` vive em `src/js/store/sync/remote-operation-handler.js:1150`. O trabalho pesado não é salvar o mapa, é **redistribuir** o que o backend guarda como colunas para os side-stores que o resto do app lê. `reshapeSnapshotMap` (`:1087`) desestrutura `base_layer`, `notes_title`, `notes_description`, `grid_style`, `temporal_config`, `locked` e reescreve cada um pela chave exata que o consumidor espera:

| Origem (coluna do backend) | Destino local | Chave |
|---|---|---|
| `base_layer` | campo do mapa | `baseLayer` (camelCase, senão o loader não acha) |
| `notes_title` / `notes_description` | `repo.saveMapNotes(id, ...)` | `map_notes_<id>` (por **id**) |
| `grid_style` | `repo.saveGridStyle(id, ...)` | `gridStyle_<id>` (por **id**) |
| `temporal_config` | `repo.saveSetting` | `temporal_<nome>` (por **nome**) |
| `locked` | `repo.saveSetting` + `memoryStore.lockedMaps` | `mapLocked_<nome>` (por **nome**) |

Essa assimetria id vs. nome é uma armadilha clássica: notes/grid são keyed por UUID, temporal e lock por **nome do mapa**, porque é assim que `store-state-manager.setCurrentMap` os lê na ativação do mapa. Errar a chave não quebra nada visivelmente, apenas faz o dado sumir para o usuário. O lock ainda atualiza `memoryStore.lockedMaps` e emite `MAP_LOCK_CHANGED` na hora, senão um peer que já está com o mapa aberto só sente o bloqueio depois de trocar de mapa e voltar. Config temporal em [[modulo-temporal]].

Depois disso, por mapa: `repo.saveMap`, `drainPendingFeatureOps(map.id)` (ops de feição que chegaram antes do mapa existir e foram bufferizadas), e persistência explícita de `groups` (array → objeto por id, mais o cache em memória por nome), `layers` (com `loadLayersToMemory` se for o mapa ativo), `cesium3d`, `streetview360` e `comments` (o backend manda array, o overlay espera `{ [id]: comment }`; ver [[comentario-espacial]]). Essas gravações em side-stores dedicados são a fidelidade de round-trip P11: os handlers de op incremental já escreviam ali, o caminho de snapshot não escrevia, e o resultado era um atlas puxado do servidor que re-exportava **sem** camadas/3D/360, perda silenciosa. Ver [[formato-ebgeo-roundtrip]] e [[aplicacao-operacoes-remotas]].

`snapshot.atlas.settings` também é redistribuído (`applyRemoteAppStateSettings`, `:1162`) para as chaves locais de `mapBadgeColors`, `colorUsage` e `customIcons`. E, no `connect`, o mesmo `snapshot.atlas.settings` alimenta o overlay de configuração por atlas sem round-trip extra (`sync-engine.js:201`, `:247`); ver [[atlas-settings]].

Ao final emite `LAYERS_CHANGED`, `GROUPS_CHANGED` e `COMMENT_UPDATED`, além de `MAP_MODIFIED` por mapa e `BRIEFING_UPDATED` por briefing.

## Armadilhas

- **Snapshot é upsert, não substituição.** `applyRemoteSnapshot` percorre `snapshot.maps` e `snapshot.briefings` gravando cada um; ele **nunca** apaga entidades locais ausentes do snapshot (`remote-operation-handler.js:1166-1225`). Por isso a troca de atlas na UI sempre chama `clearAllDataStore()` **antes** de `syncEngine.connect(...)` (`account/open-atlas.service.js:59-64`, `account/account.control.js:576-578`, `:785-791`, `:818-821`, `index.js:231-233`). Se você adicionar um novo caminho de abertura de atlas e esquecer o clear, o usuário vê os mapas do atlas anterior misturados com os do novo. Um `resync()` no meio da sessão também não remove localmente o que um peer deletou no servidor por fora do log de operações.
- **`initialPull: false` deixa `_lastVersion` em 0.** `connect` só atribui `_lastVersion` dentro do `if (initialPull)` (`sync-engine.js:156-162`), então pular o pull inicial abre o socket com `lastVersion: 0` e um `sync_request` posterior pede o mundo inteiro (ou um snapshot).
- **Nada de timeout no pull.** `_request` só aplica `AbortController` quando o chamador passa `timeoutMs`, e `pullSync` não passa (`api-client.js:831`). É deliberado (P6): uma transferência grande em rede ruim nunca deve ser abortada. Só as chamadas críticas de boot (config, restore de sessão) têm limite.
- **Snapshot não passa pelo LWW por-entidade.** O guard de convergência protege ops inbound; o snapshot é o estado autoritativo do servidor e sobrescreve. Isso significa que uma edição local ainda não flushada pode ser sobreposta por um `resync()`; a fila outbound continua íntegra e será reenviada (idempotente por `op_id`). Ver [[modelo-conflito-lww]], [[idempotencia-e-convergence-guard]] e [[fila-operacoes-outbound]].
- **Viewer read-only recebe snapshot podado.** Comentários espaciais são omitidos para quem tem só `read`, e ops de comentário são filtradas no incremental. O side-store local simplesmente fica vazio, não trate como bug. Ver [[permissoes-atlas]].
- **`min_version` é operacional, não do cliente.** O cliente não tem como prever quando um cleanup vai transformar seu pull incremental em snapshot. Todo consumidor de `pullSync` precisa suportar as duas respostas, sempre. Ver [[sync-admin-operacoes]].

Para diagnosticar um pull que não converge, o [[syncledger]] correlaciona as etapas por `op.id`/`traceId`. Contexto geral do desenho em [[sintese-nao-e-crdt]], [[sintese-rest-vs-websocket]] e [[sessao-boot-e-ciclo-de-vida]].

## Fontes

- `docs/guias/03-sync-inicial.md`: contrato do endpoint de pull, forma completa do snapshot (atlas/maps/features por tipo/layers/groups/groupFeatures/catalogLayers/cesium3d/streetview360/briefings/slides), tabela de transformações backend→snapshot, comparação snapshot vs. operações, semântica de `isSnapshot`.
- `docs/guias/05-sync-crdt.md`: §6 comportamento híbrido do pull e shape da resposta incremental, §9 endpoints admin de cleanup e efeito no `min_version`, §12 idempotência por `op_id`, mapeamento de aliases 3D/360.
- `docs/arquitetura-sync.md`: §7.1 `pullOperations` e o fato de o snapshot ser reconstruído das tabelas de entidade (não por replay), §7.2 `applyRemoteSnapshot`, §7.3 lifecycle do `sync-engine`, §7.4 boot/restore, nota sobre `server_version` não contíguo e `serverResync`.
- `src/js/store/sync/api-client.js:831`, `sync-engine.js:152-235,314-345,407-425,493`, `ws-client.js:117-152,236,314-316,385-393,419-426`, `remote-operation-handler.js:1087-1225`, `account/open-atlas.service.js:59-66`: comportamento as-built (cursor `_lastVersion`, gate de `connectionState.isOnline()`, reshape de colunas para side-stores, `clearAllDataStore` antes do `connect`, ausência de chamador para `pull()`).
