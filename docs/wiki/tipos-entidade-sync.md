# EntityTypes Sincronizáveis e seu Mapeamento

Catálogo dos tipos de entidade que viajam como operação (feature, layer, group, map, briefing, slide, comment, 3D/360, sub-entidades de mapa e catalogLayer) e as traduções que o backend aplica entre aliases do frontend, tabelas e `data_type`.

## O enum é a fonte da verdade

Os tipos aceitos vivem em `src/js/store/sync/operation-types.js:8-37`, congelados em `EntityType`:

`atlas`, `map`, `feature`, `layer`, `group`, `marker3d`, `measurement3d`, `viewshed3d`, `cameraPosition3d`, `orientation360`, `marker360`, `mapPosition`, `baseLayer`, `mapNotes`, `gridStyle`, `mapTemporal`, `catalogLayer`, `briefing`, `slide`, `comment`, `setting`.

`isValidEntityType()` (`operation-types.js:53`) valida contra esse conjunto. Adicionar um tipo exige tocar três lugares: o enum, um logger no dispatcher e um `case` no handler remoto. Faltar o `case` não quebra nada visivelmente, apenas dispara `console.warn('unknown entity type')` em `remote-operation-handler.js:341` e a op some silenciosamente no peer.

Duas armadilhas no enum:

- **`atlas` não é usado em lugar nenhum.** Nenhum `EntityType.ATLAS` aparece no código. Configuração de atlas viaja como `setting`, não como `atlas`.
- **`group_feature` não existe no frontend.** O backend tem a tabela `group_features` e o `tableMap` a suporta (`arquitetura-sync.md:279`), mas o cliente nunca emite esse tipo, associação feição/grupo vai embutida na própria feição ou no grupo.

## Como um tipo vira operação (outbound)

Toda emissão passa por `logOperation(entityType, operationType, entityId, mapId, data, previousData)` (`operation-dispatcher.js:105`). Sobre ele existem wrappers tipados, e a assinatura muda conforme a família:

| Família | Wrapper | Assinatura | `mapId` |
|---|---|---|---|
| Entidade de mapa | `logFeatureOperation`, `logLayerOperation`, `logGroupOperation`, `logCommentOperation`, `logCatalogLayerOperation`, os de 3D/360 | `(opType, entityId, mapId, data, prev)` | UUID do mapa |
| Nível-atlas | `logMapOperation`, `logBriefingOperation`, `logSettingOperation` | `(opType, entityId, data, prev)` | sempre `null` (`createEntityLogger(..., true)`, `operation-dispatcher.js:245`) |
| Sub-entidade de mapa | `logMapPositionOperation`, `logBaseLayerOperation`, `logMapNotesOperation`, `logGridStyleOperation`, `logMapTemporalOperation` | `(opType, mapId, data, prev)` | `entityId === mapId` |

A terceira família é a mais fácil de errar: `createMapSettingLogger` (`operation-dispatcher.js:260-275`) recebe **um único id** e o usa como `entityId` e como `mapId`. Passar o nome do mapa em vez do UUID faz a op ser descartada em silêncio.

O `slide` é a exceção que ninguém espera: `briefing.operations.js:302` chama `logOperation(EntityType.SLIDE, ..., slide.id, briefingId, slide)`, ou seja, **o slot `mapId` carrega o `briefingId`**. Funciona porque briefingId também é UUID e passa o guard, mas não trate `op.mapId` de um `slide` como mapa.

Detalhe do formato do envelope em [[envelope-operacao]]; a fila e a compactação em [[fila-operacoes-outbound]].

## Os dois guards que descartam ops antes do flush

Ambos em `logOperation` e replicados em `logBatchOperations` (`operation-dispatcher.js:120-139` e `192-198`). Existem por causa de um bug real: **uma única op inválida derruba o batch inteiro do flush e trava todo o sync**.

1. **`setting` com id não-UUID e diferente de `'atlas'`** (`operation-dispatcher.js:120`). Chaves locais como `lastActiveMap` são estado de visualização por cliente e o Postgres rejeitaria com 22P02. Motivo: `DropReason.NON_UUID_SETTING_ID`.
2. **Qualquer op com `mapId` presente e não-UUID** (`operation-dispatcher.js:133`). É o anti-vazamento do mapa local `Principal`, que é chaveado por nome. Motivo: `DropReason.NON_UUID_MAPID`. Ops de nível-atlas passam `mapId = null` e não são afetadas.

Os descartes viram spans `preflush.drop` no [[syncledger]]. Se algo "não sincronizou e não deu erro", esse é o primeiro lugar a olhar. A separação entre o que é local e o que é remoto está em [[store-origin-local-remoto]] e [[dominio-local-vs-remoto]].

## Sub-entidades de mapa

Cinco tipos que não têm tabela própria, o backend os converte em `UPDATE` na linha de `maps`:

| EntityType | Coluna(s) em `maps` | Payload |
|---|---|---|
| `mapPosition` | `center_lat`, `center_long`, `zoom`, `bearing`, `pitch` | campos do viewport |
| `baseLayer` | `base_layer` | `{ baseLayer }` ou `{ base_layer }` |
| `mapNotes` | `notes_title`, `notes_description` | `{ title, description }` |
| `gridStyle` | `grid_style` (JSONB) | `{ format, visible }` |
| `mapTemporal` | `temporal_config` (JSONB) | `{ ativo, modo, unidade, inicio, fim, origem }` |

Na entrada, todos os cinco caem no mesmo `case` agrupado e vão para `applyRemoteMapSettingOp(entityType, mapId, data)` (`remote-operation-handler.js:320-326`, implementação em `:848`). Note que esse handler ignora `operationType`: sub-entidade de mapa só faz sentido como update.

> [!CONTRADICAO 2026-07-18] `docs/guias/05-sync-crdt.md:122` e `:130-134` dizem que `mapTemporal` é "gated" e que "o frontend ainda não emite a op de sync", deixando `temporal_config` no default `{}`. O código emite: `src/js/store/temporal.operations.js:107` chama `logMapTemporalOperation(OperationType.UPDATE, mapManager.getMapId(target), next)` a cada `setMapTemporalConfig`, com o UUID resolvido justamente para passar o guard. A config temporal por mapa **sincroniza**. Continua verdade que dados temporais **por feição** (`temporalInicio`, `temporalFim`, `trajetoria`) viajam verbatim dentro de `data.properties` numa op `feature` normal, sem depender disso. Ver [[modulo-temporal]].

## Aliases 3D/360 e o `data_type`

O frontend usa seis tipos específicos; o backend guarda tudo em duas tabelas genéricas e discrimina por `data_type`. A tradução é automática nos dois sentidos (`ENTITY_TYPE_MAP` na ingestão, `REVERSE_ENTITY_TYPE_MAP` no pull):

| Frontend | Tabela backend | `data_type` |
|---|---|---|
| `marker3d` | `cesium3d_data` | `marker` |
| `measurement3d` | `cesium3d_data` | `measurement` |
| `viewshed3d` | `cesium3d_data` | `viewshed` |
| `cameraPosition3d` | `cesium3d_data` | `camera_position` |
| `orientation360` | `streetview360_data` | `orientation` |
| `marker360` | `streetview360_data` | `marker` |

Consequência prática: **o cliente nunca vê `cesium3d` nem `streetview360` como `entityType`**. No pull incremental e no broadcast o tipo volta específico, e é por isso que `remote-operation-handler.js:302-318` tem um `case` por alias, não um genérico. No snapshot, ao contrário, o formato é hierárquico (`cesium3d { markers, measurements, viewsheds, cameraPositions }`), reagrupado por `data_type` (`arquitetura-sync.md:576-578`). Ver [[snapshot-e-pull-incremental]], [[catalogo-3d]] e [[streetview-360]].

Também há tolerância de shape: o backend aceita o formato plano camelCase que o store real emite (`{ id, tilesetId | photoName, position, properties, style, sync }`) e reagrupa para `{ data_type, tileset_id | photo_name, data: {...} }`, sem conversão no cliente.

## `catalogLayer` é dual-mode

Único tipo com tabela dedicada (`catalog_layers`) **e** uma coluna legada (`maps.catalog_layers`), e o handler do backend decide qual usar pelo shape do payload:

- Se `data`/`changes` traz `catalog_layers` como **array**, grava o array inteiro na coluna legada do mapa (compat com clone e import).
- Caso contrário, opera **uma linha por camada** pelo `entityId`: `create` com `ON CONFLICT (id) DO NOTHING`, `update` mescla em `data`, `delete` é soft-delete.

No snapshot as duas formas coexistem: `map.catalogLayers[]` (por-camada, com `sync`) e a coluna legada. Não assuma que só uma está preenchida.

## `setting` é atlas-scoped, sempre

`logAtlasSetting(patch)` (`operation-dispatcher.js:346`) resolve o id do atlas best-effort e cai no sentinela `'atlas'` se não conseguir. Isso é seguro porque **o handler de `setting` do backend escopa pela rota (`:atlasId`) e ignora o `entityId`**. O merge em `atlas.settings` é whitelisted, chaves de disponibilidade de recurso nunca entram por aqui (`arquitetura-sync.md:283`), o que é a fronteira entre [[atlas-settings]] e edição colaborativa comum.

Chamadores reais: `mapOrder` e `mapBadgeColors` (`map.operations.js:161`, `:723`), `customIcons` (`customIcons.operations.js:131`), `colorUsage` (`repository.js:424`), `terrainExaggeration` (`modals/settings.modal.js:228`). Todos podem ser chamados incondicionalmente porque o logger é no-op quando o logging está desligado (offline). Ver [[atlas]] e [[atlas-modelo-de-dados]].

## Nem todo tipo converge igual

`CONVERGENCE_GUARDED` (`remote-operation-handler.js:115-125`) lista os nove tipos cujo `update` substitui o objeto inteiro e que por isso recebem o guard de convergência (adiar a op remota enquanto há edição local sem ack, depois descartar o que for mais antigo por `serverVersion`):

`feature`, `layer`, `group`, `marker3d`, `measurement3d`, `viewshed3d`, `cameraPosition3d`, `orientation360`, `marker360`.

**Ficam de fora, deliberadamente:** `map`, `briefing`, `slide`, `comment`, `setting`, `catalogLayer` e as cinco sub-entidades de mapa. Para elas vale apenas o último a chegar, sem defesa contra reordenação. Detalhe do mecanismo em [[idempotencia-e-convergence-guard]], modelo geral em [[modelo-conflito-lww]] e [[sync-lww-operacoes]], e o porquê disso não ser CRDT em [[sintese-nao-e-crdt]].

O mesmo conjunto governa o lado de saída: `logOperation` só chama `markLocalEditPending(entityId)` para tipos guardados (`operation-dispatcher.js:147`).

## `slide`: emitido, mas no-op na entrada

`slide` tem ops de saída (`briefing.operations.js:302/337/367`) e **nenhum efeito inbound**. O `case EntityType.SLIDE` em `remote-operation-handler.js:333-338` só marca `entityPersisted = false` e retorna, com o comentário explicando o motivo: slides convergem pela op do `briefing` pai, já que `updateBriefing` registra o array completo de slides e `applyRemoteBriefingOp` o aplica. O `case` existe apenas para não cair no `warn` de tipo desconhecido.

Isso significa que uma op `slide` isolada que chegue de um peer **não altera nada** no destino. Se você mexer em slides fora de `updateBriefing`, o peer não vê.

## `comment` e a fronteira de permissão

`comment` é map-scoped (carrega o UUID do mapa) e é o único tipo com um degrau de permissão próprio: `permission-guard.js:41-43` mapeia create/update/delete de comentário para `PermissionAction.COMMENT`, acessível a partir do papel Comentarista, enquanto as demais entidades exigem `write`. O backend repete a checagem por operação (`assertOperationAllowed`): um usuário `comment`-tier só escreve comentários. Ver [[comentario-espacial]], [[permissoes-atlas]] e [[permissao-vs-papel]].

## Tabela de roteamento no backend

`tableMap` em `sync.service.js` (`arquitetura-sync.md:279`), depois de aplicado o `ENTITY_TYPE_MAP`:

`feature→features`, `layer→layers`, `group→groups`, `map`/`map_meta→maps`, `briefing→briefings`, `slide→slides`, `cesium3d→cesium3d_data`, `streetview360→streetview360_data`, `comment→comments`, `catalog_layer→catalog_layers`, `group_feature→group_features`.

Regras que dependem do tipo:

- **Lock gate:** só para alvos filhos com `mapId` (`feature`, `group`, `layer`, `cesium3d`, `streetview360`, `catalog_layer`, `group_feature`). Mapa travado devolve `ConflictError('Map is locked')`. Entidades de nível-atlas passam direto.
- **Delete:** soft-delete em tudo, **exceto `group_feature`** (hard delete). Delete de `layer` cascateia soft-delete às feições dela.
- **Create:** `INSERT ... SELECT ... WHERE EXISTS (mapa pertence a ESTE atlas)`, guarda anti-IDOR cross-atlas, mais `ON CONFLICT (id) DO NOTHING`.

O log persistido é o mesmo para todos os tipos, ver [[tabela-operations]].

## Armadilhas em ordem de frequência

1. **Passar nome de mapa onde se espera UUID** em qualquer logger map-scoped ou de sub-entidade: op descartada sem erro visível. Sintoma no ledger: `preflush.drop{non_uuid_mapId}`.
2. **Usar `logSettingOperation` para estado local** (preferência por cliente): descartado pelo guard de `setting`. Estado por cliente não é sincronizável, por design.
3. **Assumir que `op.mapId` de um `slide` é um mapa.** É o `briefingId`.
4. **Esperar que uma op `slide` isolada apareça no peer.** Não aparece.
5. **Esperar `cesium3d`/`streetview360` como `entityType` no cliente.** Nunca chegam assim, sempre no alias específico.
6. **Adicionar tipo ao enum sem o `case` inbound.** Sai, chega e é ignorado com um `warn`.
7. **Contar com o guard de convergência em `map`/`briefing`/`comment`.** Eles não estão em `CONVERGENCE_GUARDED`.
8. **Compactação da fila agrupa por `entityType:entityId`** (`operation-queue.js:272`). Como as sub-entidades de mapa compartilham `entityId === mapId`, elas só não colidem porque o `entityType` difere, um tipo novo que reuse o id do mapa passa a competir por esse grupo.

Identidade do emissor em [[client-id-estavel]]; confirmação e dedupe em [[ack-idempotencia]]; transporte em [[websocket-collab]]; aplicação no destino em [[aplicacao-operacoes-remotas]]; contratos que não podem mudar em [[sintese-contratos-congelados]].

## Fontes
- `docs/guias/05-sync-crdt.md`: tabela de targets/EntityTypes, sub-entidades de mapa e colunas, mapeamento de aliases 3D/360 para `data_type`, dual-mode do `catalogLayer`, exemplos de payload por tipo, tolerância de shape do store real.
- `docs/guias/03-sync-inicial.md`: formato do snapshot e o `getStoreForEntityType` de referência (inclui `group_feature` e `catalog_layer`, que o frontend não emite).
- `docs/arquitetura-sync.md`: lista canônica do `EntityType`, `ENTITY_TYPE_MAP`/`REVERSE_ENTITY_TYPE_MAP`, `tableMap` do backend, lock gate por alvo filho, regras de create/update/delete/setting, reagrupamento hierárquico 3D/360 no snapshot.
- `src/js/store/sync/operation-types.js`: enum congelado e validadores.
- `src/js/store/sync/operation-dispatcher.js`: guards de preflush, as três famílias de logger, `logAtlasSetting`.
- `src/js/store/sync/remote-operation-handler.js`: switch de roteamento inbound, `CONVERGENCE_GUARDED`, no-op do `slide`.
- `src/js/store/temporal.operations.js`: emissão real da op `mapTemporal` (contradiz o guia 05).
- `src/js/store/briefing.operations.js`: ops de `slide` com `briefingId` no slot `mapId`.
- `src/js/store/sync/permission-guard.js`: `comment` como única entidade com degrau de permissão próprio.
- `src/js/store/sync/operation-queue.js`: chave de compactação `entityType:entityId`.
