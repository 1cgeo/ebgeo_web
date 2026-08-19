# Sync Híbrido: Snapshot e Pull Incremental

`GET /atlas/:id/sync/:version` devolve snapshot completo ou lista de operações incrementais, discriminado por `isSnapshot`. Contrato em `pullOperations` (`backend/src/modules/sync/sync.service.js`); consumo em `frontend/src/js/store/sync/sync-engine.js`.

## Por que dois modos

O log de operações não é infinito: o cleanup admin apaga o rabo antigo e sobe `min_version` (ver [[sync-admin-operacoes]], [[tabela-operations]]). Sem o fallback de snapshot, um cliente semanas offline não teria como se recompor, porque as operações que ele perdeu deixaram de existir. O snapshot é o que torna a compactação segura.

**O snapshot NÃO é replay do log.** Ele é reconstruído a partir das tabelas de entidade e materializado já no shape do IndexedDB do frontend. Por isso ele não herda as perdas do log compactado, e por isso não existe "op de snapshot" no [[envelope-operacao]]. Consequência de projeto: os dois modos entregam formas **diferentes** (snapshot hierárquico, incremental por alias de `data_type`), então os caminhos de aplicação não podem compartilhar roteamento. Ver [[tipos-entidade-sync]].

## O cursor é lido ANTES dos dados, e é só isso que segura o snapshot

`getAtlasSnapshot` (`backend/src/modules/sync/sync.service.js`) roda dentro de `task()`, ou seja, **conexão compartilhada sem transação**. As consultas de entidade são sequenciais e não há advisory lock aqui, ao contrário do push ([[modelo-conflito-lww]]): um push concorrente pode commitar **no meio** da montagem, e parte do snapshot sai anterior à op, parte posterior.

O que torna isso seguro não é um lock, é uma ordem. `current_version` vem da **primeira** consulta (`GET_ATLAS_METADATA`) e é justamente esse valor que volta como cursor do cliente. Uma op que commite durante a montagem cai portanto **acima** do cursor entregue, e retorna no pull incremental seguinte; reaplicar é idempotente, então a direção do erro é a segura.

> **Não mova a leitura de `current_version` para depois dos dados, e não a troque pelo `GET_CURRENT_VERSION`** que o push usa. Com o cursor lido no fim, a op comitada durante a montagem ficaria **abaixo** dele e abaixo do corte do pull incremental: perdida para sempre, sem erro nenhum. É a mesma classe de falha silenciosa que justificou o advisory lock do push, e aqui não existe lock protegendo.

Corolário para quem for otimizar a montagem: qualquer reordenação das consultas é livre **menos** essa primeira. O custo real do snapshot é outro, e está anotado no próprio código: ele retém uma conexão do pool durante a série inteira e roda no caminho quente (todo `connect` e todo pull atrasado passam por ele), o que é o motivo de as coleções serem buscadas uma vez por atlas e agrupadas por `map_id`, em vez de uma vez por mapa.

## Armadilhas do cursor

- **`isSnapshot` nunca é opcional.** Um cliente que pede `/sync/150` recebe snapshot se um cleanup subiu `min_version` acima de 150. O cliente não tem como prever isso, então todo consumidor de `pullSync` precisa suportar as duas respostas, sempre. Decidir o caminho de aplicação pela versão que você pediu é o erro clássico aqui.
- **`currentVersion` é cursor exclusivo** (o corte é `server_version > cursor`). Guarde verbatim, sem `+1` nem `-1`. No incremental ele é o maior `serverVersion` do lote, não o próximo.
- **REST diz `operations`, WebSocket diz `ops`.** Mesmo híbrido, nomes diferentes: quem responde no canal WS é `handleSyncRequest` (`backend/src/modules/collab/collab.handlers.js`). Um parser reaproveitado entre os dois transportes lê `undefined` e aplica zero operações **sem erro**. Ver [[canal-collab-websocket]].
- **`server_version` vem de sequência global do atlas e é não contígua por design.** Buraco na numeração é op de outro atlas, não op perdida. Uma versão anterior tratava buraco como perda e gerava tempestades de `sync_request`. Perda real só ocorre atravessando desconexão.
- **`initialPull: false` deixa `_lastVersion` em 0**, porque a atribuição está dentro do `if` (`frontend/src/js/store/sync/sync-engine.js`). O socket abre com `lastVersion: 0` e o `sync_request` seguinte pede o mundo inteiro.

## O caminho de recuperação real é o WebSocket

`syncEngine.pull()`, o pull incremental HTTP, **não tem nenhum chamador em `src/js`**, só um teste de integração. As três chamadas vivas de `pullSync` (`connect`, `connectPublic` de [[link-publico]], `resync`) usam sempre versão 0, ou seja, sempre snapshot. A recuperação incremental de fato acontece pelo canal WS: ao reabrir o socket vindo de RECONNECTING, `frontend/src/js/store/sync/ws-client.js` dispara `requestSync(this._lastVersion)`.

Dois cuidados no handler de `sync_response` que não devem ser removidos:

1. **Gate `connectionState.isOnline()` antes de persistir.** Descarta um `sync_response` tardio caindo na janela entre o disconnect e a limpeza de um logout ou troca de atlas. O caminho de op inbound já era protegido pelo `syncGateway`; o de snapshot não era, e sem o gate um snapshot atrasado grava dados do atlas remoto num store sendo destruído (ver [[dominio-local-vs-remoto]]).
2. **Avanço de versão nos dois lugares.** `setLastVersion` é monotônico (só aceita maior), o que impede que um frame fora de ordem regrida o cursor e cause replay eterno.

`resync()` força snapshot fresco e existe para as mutações que o servidor faz **fora** do log (`atlas_updated`, `map_duplicated`, `maps_merged`): um pull incremental jamais as veria.

## Snapshot é upsert, não substituição

`applyRemoteSnapshot` grava cada mapa e briefing do snapshot e **nunca apaga entidade local ausente dele** (`frontend/src/js/store/sync/remote-operation-handler.js`). Por isso todo caminho de troca de atlas chama `clearAllDataStore()` **antes** de `syncEngine.connect(...)` (`frontend/src/js/account/open-atlas.service.js`, `frontend/src/js/account/account.control.js`, `frontend/src/js/index.js`). Um caminho novo de abertura que esqueça o clear mistura os mapas do atlas anterior com os do novo. Pelo mesmo motivo, um `resync()` no meio da sessão não remove localmente o que um peer deletou por fora do log.

Outras consequências desse desenho:

- **Snapshot não passa pelo LWW por-entidade.** Ele é o estado autoritativo do servidor e sobrescreve, inclusive edição local ainda não flushada. A fila outbound continua íntegra e reenvia (idempotente por `op_id`). Ver [[modelo-conflito-lww]], [[idempotencia-e-convergence-guard]], [[fila-operacoes-outbound]].
- **Viewer read-only recebe snapshot podado**: comentários espaciais são omitidos e ops de comentário filtradas no incremental. O side-store local fica vazio; não é bug. Ver [[permissoes-atlas]].
- **Os dois modos entregam a camada de catálogo sem definição, por mecanismos DIFERENTES, e a diferença é contrato.** No snapshot a definição é REIDRATADA do catálogo pelo predicado de quem lê (só quem alcança o recurso a recebe). No incremental ela é apenas PODADA (`backend/src/modules/sync/catalog-layer-op.js`), sem reidratação para ninguém: a op é payload de cliente, não entidade materializada, e o cliente resolve a definição do `/api/config` dele, que já é filtrado pelo mesmo predicado. A mesma poda vale para o rebroadcast ao vivo, HTTP e WS, no ponto único `broadcastOperations`. Quem escrever um consumidor que espere `config` numa op de `catalogLayer` está lendo um formato que só clientes pré-F11 produziam.
- **`pullSync` não tem timeout** (não passa `timeoutMs` ao `_request`). Deliberado (P6): transferência grande em rede ruim não deve ser abortada. Só as chamadas críticas de boot têm limite.

## Redistribuição para os side-stores

O trabalho pesado de `applyRemoteSnapshot` não é salvar o mapa, é espalhar o que o backend guarda como colunas para os side-stores que o resto do app lê (`reshapeSnapshotMap`).

**A armadilha é a assimetria de chave:** notes e grid são keyed por **id** (`map_notes_<id>`, `gridStyle_<id>`), mas temporal e lock por **nome do mapa** (`temporal_<nome>`, `mapLocked_<nome>`), porque é assim que `store-state-manager.setCurrentMap` os lê na ativação. Errar a chave não quebra nada visivelmente: o dado apenas some para o usuário. O lock também precisa atualizar `memoryStore.lockedMaps` e emitir `MAP_LOCK_CHANGED` na hora, senão um peer com o mapa já aberto só sente o bloqueio depois de trocar de mapa e voltar. Ver [[modulo-temporal]].

**P11, fidelidade de round-trip:** `layers`, `groups`, `cesium3d`, `streetview360` e `comments` chegam inline no mapa do snapshot, mas todo leitor (loaders de export, layer manager) os busca em side-stores dedicados. Os handlers de op incremental já escreviam ali; o caminho de snapshot não escrevia, e o resultado era um atlas puxado do servidor que re-exportava **sem** camadas/3D/360, perda silenciosa. Comentários ainda mudam de forma no caminho (array no backend, `{ [id]: comment }` no overlay). Ver [[formato-ebgeo-roundtrip]], [[aplicacao-operacoes-remotas]], [[comentario-espacial]].

## Contratos congelados no shape

O snapshot mistura deliberadamente snake_case (herdado das colunas) com camelCase (herdado do IndexedDB). **Não normalize nada ao consumir**: o loader procura os nomes exatos (`center_long`, não `lng`; `baseLayer` camelCase, senão o loader não acha). Assimetrias que custam tempo se descobertas em produção:

1. **`layers[]` não tem objeto `sync`**: os metadados vêm planos no topo, ao contrário de atlas/map/group/briefing/3D/360. Código genérico com `entity.sync.version` quebra só em camadas.
2. **`currentVersion` aparece duas vezes**, dentro de `snapshot` e ao lado dele. O cursor a guardar é o de fora.
3. **`catalogLayers[]` (entidades com `sync`) é a única forma no snapshot.** Havia também uma coluna homônima do mapa, que saía ao lado; a migração 022 a apagou ([[tipos-entidade-sync]]).
4. **As chaves das coleções de feição não são `tipo + 's'`.** Várias são irregulares e congeladas (`FEATURE_TYPE_MAPPINGS`, `frontend/src/js/store/store.constants.js`), incluindo um plural incorreto e tipos invariáveis. O backend materializa o snapshot já nesses buckets e o cliente grava direto; bucket com nome errado não gera erro, a feição simplesmente some da tela. Quem decide a renderização é `properties.source` (singular), não a chave do bucket.
5. **Metadados de sync de feição vivem dentro de `properties`**, não num objeto `sync` como nas demais entidades. `dirty` e `deleted` vêm sempre `false`: são campos do modelo local, materializados só para o shape bater, e não carregam informação do servidor.

Ver [[sintese-contratos-congelados]], [[atlas-modelo-de-dados]], [[catalogo-3d]], [[streetview-360]].

Para diagnosticar um pull que não converge, o [[syncledger]] correlaciona as etapas por `op.id`/`traceId`. Desenho geral em [[modelo-conflito-lww]], [[sintese-rest-vs-websocket]] e [[sessao-boot-e-ciclo-de-vida]].
