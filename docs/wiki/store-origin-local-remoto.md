# Separação Local ↔ Remoto e o Anti-leak do Principal

O EBGeo distingue workspace local e atlas remoto por um marcador de origem persistido (não por namespacing de IndexedDB), e descarta pré-flush operações do mapa local Principal, que é keyed por nome e não por UUID.

## O marcador de origem

Todo o mecanismo cabe em `src/js/store/store-origin.js` (na verdade `src/js/store/store-origin.js`): um único registro `{ kind, atlasId }` persistido no appStore sob a chave `'__store_origin__'` (`store-origin.js:28`), com espelho em memória para leitura síncrona.

- `StoreOriginKind` = `'local' | 'remote'` (`store-origin.js:25`).
- Default é sempre LOCAL, inclusive quando a chave está ausente ou a leitura falha (`store-origin.js:31,44-53`). Isso é a **garantia aditiva**: o usuário offline pré-existente nunca é afetado, porque a máquina remota só engata depois de um connect explícito.
- `loadStoreOrigin()` (async, boot) hidrata o espelho; `getStoreOriginSync()` / `isRemoteStoreSync()` (`store-origin.js:59,66`) são as leituras de hot path.
- `markStoreRemote(atlasId)` / `markStoreLocal()` (`store-origin.js:87,96`) escrevem o marcador.

**Não existe namespacing de IndexedDB por atlas.** Há *um* store local, e o marcador diz apenas se o conteúdo atual é "meu workspace desta máquina" ou "atlas de servidor emprestado enquanto conectado". Múltiplos atlas locais nomeados são um não-objetivo deliberado: local = um workspace + `.ebgeo` (ver [[formato-ebgeo-roundtrip]]); atlas nomeados são conceito de servidor ([[atlas]], [[atlas-modelo-de-dados]]).

## Por que um marcador e não namespacing

O marcador responde a uma pergunta que o namespacing não responderia sozinho: *este dado tem direito de continuar existindo aqui?* Dados de atlas remoto são temporários e devem sumir no logout/disconnect. A consequência prática é que, para trabalhar offline num atlas de servidor, o usuário precisa **baixar o `.ebgeo`**, que vira um atlas local (`store-origin.js:12-15`). Ver [[dominio-local-vs-remoto]] e [[atlas-import-offline]].

## O ciclo de vida do marcador

**Abrir atlas remoto** (`account/open-atlas.service.js:41-81`):

1. Se o store atual é local *e* tem feições (`!isRemoteStoreSync() && await hasAnyMapFeatures()`), confirma antes de destruir (o usuário é orientado a baixar `.ebgeo`).
2. Se já havia conexão, `stopAutoFlush()` + `syncEngine.disconnect()` (um socket por atlas, o servidor não tem "switch"). Ver [[websocket-collab]].
3. `clearAllDataStore()`.
4. **`markStoreRemote(atlasId)` ANTES do connect**, deliberadamente: é intenção durável. Se a aba morrer no meio do pull de snapshot, a guarda de boot vê `'remote'` e descarta o dado parcial em vez de promovê-lo a atlas local permanente.
5. `syncEngine.connect(atlasId, { initialPull: true })` ([[snapshot-e-pull-incremental]]), depois `activateAtlasInitialMap(mapId)`.
6. Se o connect lança (403/404 etc.), o `catch` faz `markStoreLocal()` para o boot não ficar retentando um atlas morto a cada F5.

**Limpar / sair**: `clearAllDataStore()` (`store/store.js:215-217`) sempre aterrissa em atlas LOCAL em branco, e o logout em `account/account.control.js:646-651` faz `stopAutoFlush` → `disconnect` → `clearAllDataStore` → `markStoreLocal`.

**Guarda de boot**: `enforceLocalStoreWhenLoggedOut()` (`store/store.js:137-156`) roda em `initializeWithLastActiveMap()`. Se `isRemoteStoreSync()` e ninguém está autenticado, apaga tudo (mapas, imagens, settings, grupos, camadas, 3D, 360, briefings, comentários, atlas, e `operationQueue.clear()`) e re-marca LOCAL. Isso é o que impede um usuário deslogado de continuar editando um atlas de servidor. Ver [[sessao-boot-e-ciclo-de-vida]].

> [!CONTRADICAO 2026-07-18] `docs/arquitetura-sync.md:240` diz que o boot chama `reconnectLastAtlas()`, que "se autenticado e `loadStoreOrigin()` for `{kind:'remote', atlasId}`, refaz `connect` + `markStoreRemote` + `startAutoFlush`". Não existe `reconnectLastAtlas` no código. O boot em `src/js/index.js:158-160` tenta, nesta ordem, `openPublicAtlasFromUrl(?atlasPublico)`, `openAtlasFromUrl(?atlas=<uuid>)` e, se nenhum casar, `openAtlasChooserOnBoot()` (`index.js:272-283`), que **descarta** o dado remoto (`if (origin.kind === 'remote') await clearAllDataStore()`) e abre o seletor de atlas. A barra de endereços é a fonte da verdade; não há reconexão silenciosa ao último atlas.

## O marcador como gate de permissão

`checkPermission(action)` retorna permitido quando `sessionContext.isOffline() || !isRemoteStoreSync()` (`store/sync/permission-guard.js:71`). Ou seja: **o gate de papel só vale para um atlas remoto conectado**; o store local é sempre editável, mesmo logado. Sem essa cláusula, um usuário cujo papel global é `viewer` não conseguiria desenhar no próprio workspace. Mesma lógica no cadeado de mapa: `MapLockController.isReadOnly()` retorna `false` de saída se `!isRemoteStoreSync()` (`locking/map-lock.controller.js:86`). Ver [[permissao-vs-papel]] e [[permissoes-atlas]].

## O anti-leak do Principal

O mapa local default `Principal` é **keyed por nome**, não por UUID. Mapas de atlas de servidor são keyed por UUID. Isso cria duas armadilhas, cada uma com sua defesa.

### 1. Poison pill no flush (drop pré-flush)

O backend rejeita um `mapId` não-UUID com erro Postgres 22P02, e **uma única op ruim faz o lote inteiro do flush falhar**, travando todo o sync. Por isso `operation-dispatcher.js` dropa antes de enfileirar:

- op map-scoped (feature/layer/group/catalogLayer/3D/360) com `mapId` de contexto não-UUID → drop, razão `non_uuid_mapId` (`operation-dispatcher.js:133-139`);
- op de `SETTING` cujo `entityId` não é UUID nem o sentinela `'atlas'` (ex.: `lastActiveMap`, que é view state por cliente) → drop, razão `non_uuid_setting_id` (`operation-dispatcher.js:120-126`);
- o mesmo filtro em lote, em `logBatchOperations` (`operation-dispatcher.js:192-205`, razão `batch_filtered`);
- e em `createMapSettingLogger`, onde `entityId === mapId` (`operation-dispatcher.js:266-272`).

Ops atlas-level (map/briefing/setting) passam `mapId = null` e não são afetadas. Todo drop emite um span `preflush.drop` com `reason` no [[syncledger]], então "editei e nada sincronizou" tem causa nomeada em vez de sumiço silencioso. Razões em `store/sync/diag/trace-stages.js:56-57`. Ver [[fila-operacoes-outbound]] e [[envelope-operacao]].

**Armadilha:** logging desabilitado (offline/anônimo) também produz `preflush.drop`, com `reason: logging_disabled` (`operation-dispatcher.js:106-114`). Ao depurar, distinga as duas causas.

### 2. Sombreamento no connect (strays locais)

Leituras de mapa por nome acertam direto a chave de armazenamento. Se o `Principal` local (keyed por `'Principal'`) coexistir com um mapa de atlas chamado `Principal` (keyed por UUID), `repo.getMap('Principal')` acerta o **stray local vazio** e o usuário aterrissa num mapa em branco. Por isso `activateAtlasInitialMap()` (`store/map.operations.js:353-393`), que só roda depois do connect, apaga toda entrada cujo `data.id` não seja UUID (`map.operations.js:363-371`) e só então resolve o mapa inicial (mapId pedido por deep link > `lastActiveMap` por nome > primeiro mapa nomeado). Se o atlas está vazio, cria `'Mapa 1'` com `addMap` para o usuário já editar um mapa sincronizado.

Detalhe importante: `setCurrentMap` é chamado com o **nome**, não com a chave UUID, porque presença e cursores usam `mapId` por nome, e peers filtrariam um UUID cru. Ver [[presenca-colaborativa]].

### 3. Criação de mapa com sync ativo

`addMap()` decide a keying pelo estado do sync: `const syncActive = isOperationLoggingEnabled()` → `createMapData(mapName, mapData, { uuidKeyed: syncActive })` (`map.operations.js:184-185`). Com sync ativo o mapa nasce UUID-keyed, então uma reaplicação posterior de snapshot (reconnect, resync, import-merge-rename de um peer) atualiza **a mesma** entrada em vez de duplicar (cópia local por nome + cópia do snapshot por UUID). Registro no `mapResolver` só acontece quando `mapId !== mapName` (`map.operations.js:187-190`).

### 4. Exibição

Como as chaves são uma mistura de UUIDs e nomes, `getAllMapNamesStore()` resolve cada chave UUID→nome via `mapResolver.resolveToName` e de-duplica (`map.operations.js:102-117`). Sem isso o mapa de um peer apareceria na lista como um UUID cru.

## Checklist para não errar

- Nunca assuma que a chave de armazenamento de um mapa é o nome, nem que é UUID. Resolva sempre (`mapResolver`).
- Ao criar uma nova op map-scoped, passe o **UUID** do mapa em `mapId`, ou ela será dropada em silêncio (com span, mas em silêncio para o usuário).
- Nova chave de setting que seja por cliente (view state) não deve virar op: ela seria dropada por `non_uuid_setting_id` de qualquer forma, e enfileirá-la só polui a fila.
- Antes de qualquer operação destrutiva no store, verifique `isRemoteStoreSync()`: se for local com trabalho, o usuário precisa da chance de baixar `.ebgeo`.
- Marque REMOTE **antes** de conectar e reverta para LOCAL em qualquer falha de connect. A ordem é o que torna o crash mid-pull seguro.
- Ao adicionar um gate por papel, replique a cláusula `!isRemoteStoreSync() → permitido`, senão você quebra a edição do workspace local do usuário logado.

## Fontes

- `docs/arquitetura-sync.md`: princípio da separação por marcador de origem (§linha 41), anti-leak do `Principal` e §7.5 (linha 242-244), gate de permissão só para atlas remoto conectado (linha 316), drop `non_uuid_mapId` no ledger (linha 420), tabela de módulos (linhas 449-450). O boot descrito em §7.4 (linha 240) diverge do código, ver CONTRADICAO.
- `src/js/store/store-origin.js`: chave `'__store_origin__'`, `StoreOriginKind`, default LOCAL, API sync/async.
- `src/js/store/store.js`: guarda de boot `enforceLocalStoreWhenLoggedOut`, `clearAllDataStore` re-marcando LOCAL, re-exports do barrel.
- `src/js/store/sync/operation-dispatcher.js`: drops pré-flush (`non_uuid_mapId`, `non_uuid_setting_id`, `batch_filtered`, `logging_disabled`) e a razão do poison pill (22P02 derruba o lote).
- `src/js/store/map.operations.js`: `activateAtlasInitialMap` (remoção de strays, ordem de resolução), `addMap` UUID-keyed com sync ativo, `getAllMapNamesStore` resolvendo UUID→nome.
- `src/js/account/open-atlas.service.js` e `src/js/account/account.control.js`: sequência abrir/sair, `markStoreRemote` antes do connect, reversão em erro.
- `src/js/store/sync/permission-guard.js` e `src/js/locking/map-lock.controller.js`: gate de papel restrito ao store remoto.
- `src/js/index.js`: ordem real do boot (`?atlasPublico` → `?atlas` → seletor de atlas com descarte do remoto).
- `src/js/store/sync/diag/trace-stages.js`: nomes das razões de drop.
