# Domínio local vs. domínio remoto (store-origin)

O IndexedDB do navegador guarda dois domínios rigidamente separados, um workspace local persistente e editável sem login, e uma cópia efêmera de um atlas do servidor descartada ao desconectar, discriminados pelo marcador de origem `store-origin.js` (`{kind, atlasId}`), não por namespacing de IndexedDB.

## O problema que o marcador resolve

O EBGeo usa **um único store IndexedDB** para as duas realidades. Não há namespacing por atlas: o store guarda um atlas por vez, e trocar de atlas é destrutivo (desconecta, `clearAllDataStore`, conecta). Sem um discriminador, dado remoto que sobrevivesse ao logout ficaria editável offline, sem sincronizar com ninguém: o usuário acharia que colabora, mas estaria editando uma cópia morta.

O marcador responde a uma pergunta que o namespacing não responderia sozinho: *este dado tem direito de continuar existindo aqui?* Dado de atlas remoto é temporário por definição e deve sumir no logout/disconnect.

Regra de ouro para o usuário: para trabalhar offline em algo que veio do servidor, **baixe o `.ebgeo` antes de desconectar** (ver [[formato-ebgeo-roundtrip]]). Isso transforma o dado remoto em dado local.

## A API (`src/js/store/store-origin.js`)

| Função | O que faz |
|---|---|
| `loadStoreOrigin()` | Hidrata o espelho em memória a partir do marcador persistido. Chamar **uma vez no boot**, antes de qualquer leitura síncrona (`store-origin.js:44`). |
| `getStoreOriginSync()` | Lê o espelho em memória (`{kind, atlasId}`) (`store-origin.js:59`). |
| `isRemoteStoreSync()` | `true` quando o store guarda um atlas do servidor (`store-origin.js:66`). É o predicado usado nos gates. |
| `markStoreRemote(atlasId)` / `markStoreLocal()` | Persistem a origem (`store-origin.js:87,96`). |

Detalhes que importam:

- `StoreOriginKind` = `'local' | 'remote'` (`store-origin.js:25`). O marcador vive no appStore sob a chave `'__store_origin__'` (`store-origin.js:28`), via `getSettingCompat`/`setSettingCompat`.
- **Default é `local`** e o valor é **ausente** para todo usuário offline preexistente (`DEFAULT_ORIGIN`, `store-origin.js:31`). Qualquer erro de leitura ou valor malformado (sem campo `kind`) também cai em `local` (`store-origin.js:47-52`). Essa é a garantia aditiva: a maquinaria remota só engata depois de um connect explícito.
- Leituras são **síncronas** de propósito, porque rodam em caminhos quentes (guarda de permissão em toda escrita do store).
- **Armadilha:** `atlasId` é persistido mas **nenhum código de produção o lê** hoje. Só `kind` é consultado (`index.js:279`, `permission-guard.js:71`, `map-lock.controller.js:86`). O antigo `reconnectLastAtlas` sumiu; a reabertura do atlas é dirigida pela **URL** (`?atlas=<uuid>`), não pelo marcador. Não escreva código novo assumindo que `atlasId` é a fonte de verdade do atlas conectado, use `syncEngine.atlasId`.

## Ciclo de vida do marcador

**Abrir atlas do servidor** (`account/open-atlas.service.js:41-81`):

1. Se o store atual é local *e* tem feições (`!isRemoteStoreSync() && await hasAnyMapFeatures()`), confirma antes de destruir (o usuário é orientado a baixar o `.ebgeo`).
2. Se já havia conexão, `stopAutoFlush()` + `syncEngine.disconnect()`. É um socket por atlas, o servidor não tem "switch" (ver [[canal-collab-websocket]]).
3. `clearAllDataStore()`.
4. **`markStoreRemote(atlasId)` ANTES do `connect`**, deliberadamente: é intenção durável. Se a aba morrer no meio do pull do snapshot, o boot guard vê `remote` e descarta o parcial em vez de promovê-lo a atlas local permanente.
5. `syncEngine.connect(atlasId, { initialPull: true })` (ver [[snapshot-e-pull-incremental]]), depois `activateAtlasInitialMap(mapId)`.
6. **Falha no connect** (403/404 ou queda): o `catch` faz `markStoreLocal()` e relança (`open-atlas.service.js:66-73`). Sem isso, um F5 ficaria retentando eternamente um atlas morto.

**Outros pontos de escrita**, todos com a mesma disciplina de ordem:

- **Seletor de projetos** (`account.control.js:785-790`), **criação de atlas** (`account.control.js:576-577`) e **link público** (`index.js:230-233`) repetem o par `clearAllDataStore` → `markStoreRemote` → `connect`.
- **`clearAllDataStore()` sempre termina em `markStoreLocal()`** (`store.js:213`). Isso é obrigatório e não incidental: o clear apaga o appStore (`clearAllAppSettings`), o que apagaria o próprio marcador. A remarcação vem **depois** dos clears, nunca antes. O clear também zera `clearAllAtlasData()` e `operationQueue.clear()`, o registro do atlas e a fila pendente pertencem ao atlas abandonado.
- **Logout** (`_handleLogout`, `account.control.js:840-851`): `stopAutoFlush` → `syncEngine.logoutAndDisconnect()` → `presenceStore.clear()` → `clearAllDataStore()`.
- **Atlas excluído pelo dono** (`_handleRemoteAtlasDeleted`, `account.control.js:646-655`): `stopAutoFlush` → `disconnect` → `clearAllDataStore` → `markStoreLocal` → seletor de projetos, protegido por uma flag de reentrância porque quem exclui dispara o teardown direto **e** recebe o broadcast `atlas_deleted`.
- **Sessão perdida** (idle timeout / refresh falho) converge no mesmo destino: teardown e atlas local em branco.

## O boot guard

`enforceLocalStoreWhenLoggedOut()` (`store.js:137-156`) roda como **primeira linha** de `initializeWithLastActiveMap()` (`store.js:164`), antes de qualquer leitura do repositório:

```
loadStoreOrigin()
if (!isRemoteStoreSync() || sessionContext.isAuthenticated()) return;  // no-op
→ resetMemoryStore + mapResolver.clear + apaga tudo (maps, images, appSettings, groups,
  layers, cesium3d, streetview360, briefings, comments, atlas, fila de operações)
  e markStoreLocal()
```

A condição é dupla: **origem `remote` E ninguém autenticado**. Para o usuário offline de sempre a condição é falsa, então é literalmente um no-op, é assim que o princípio P1 (backend é aditivo) se sustenta. A restauração de sessão roda **antes** desta guarda, então um usuário autenticado que volta mantém a sessão em vez de ser limpo. Note que a **fila outbound também é limpa**, senão operações não enviadas de um atlas abandonado vazariam para o próximo (ver [[fila-operacoes-outbound]] e [[fila-operacoes-outbound]]).

## O que a origem gateia

`isRemoteStoreSync()` não é um detalhe de bookkeeping, é o interruptor de três comportamentos:

1. **Permissões.** `checkPermission` libera tudo quando `sessionContext.isOffline() || !isRemoteStoreSync()` (`permission-guard.js:71`). O papel por atlas (visualizador/comentarista/editor/gestor) **só vale em atlas remoto conectado**; o store local é sempre editável, inclusive por um usuário logado cujo papel global seria restritivo. Sem essa cláusula, um usuário `viewer` não conseguiria desenhar no próprio workspace. Ver [[permissoes-atlas]] e [[permissoes-atlas]].
2. **Modo somente-leitura.** `MapLockController.isReadOnly()` retorna `false` de saída quando `!isRemoteStoreSync()` (`map-lock.controller.js:86`); só em atlas remoto um viewer/comentarista vê o cadeado não-alternável.
3. **Guarda de destruição.** Todo caminho que substitui o store (`openRemoteAtlas`, `openProjectPicker`) só pede confirmação "isso apaga seus dados locais, baixe um `.ebgeo`" quando `!isRemoteStoreSync() && await hasAnyMapFeatures()`, ou seja, quando o que será destruído é trabalho **local** insubstituível. Dado remoto é descartável por definição, o servidor é a fonte da verdade.

## Isolamento e identidade de mapa (o anti-leak do Principal)

O marcador cobre local↔remoto, mas **não** cobre remoto↔remoto. O isolamento entre atlas vem de outro lugar: um store por vez + clear destrutivo na troca, e no servidor uma sala por atlas com guarda IDOR (ver [[atlas-modelo-de-dados]], [[atlas-modelo-de-dados]]).

Há uma armadilha específica de chaveamento: mapas de atlas remotos são chaveados por **UUID**, o mapa local padrão `Principal` é chaveado por **nome**. Quatro defesas decorrem disso.

### 1. Poison pill no flush (drop pré-flush)

O backend rejeita um `mapId` não-UUID com erro Postgres 22P02, e **uma única op ruim faz o lote inteiro do flush falhar**, travando todo o sync. Por isso `operation-dispatcher.js` descarta antes de enfileirar:

- op map-scoped (feature/layer/group/catalogLayer/3D/360) com `mapId` de contexto não-UUID → drop, razão `non_uuid_mapId` (`operation-dispatcher.js:133-139`);
- op de `SETTING` cujo `entityId` não é UUID nem o sentinela `'atlas'` (ex.: `lastActiveMap`, que é view state por cliente) → drop, razão `non_uuid_setting_id` (`operation-dispatcher.js:120-126`);
- o mesmo filtro em lote, em `logBatchOperations` (`operation-dispatcher.js:192-205`, razão `batch_filtered`);
- e em `createMapSettingLogger`, onde `entityId === mapId` (`operation-dispatcher.js:266-272`).

Ops atlas-level (map/briefing/setting) passam `mapId = null` e não são afetadas. Todo drop emite um span `preflush.drop` com `reason` no [[syncledger]], então "editei e nada sincronizou" tem causa nomeada em vez de sumiço silencioso. Razões em `store/sync/diag/trace-stages.js:53-59`. Ver [[envelope-operacao]].

**Armadilha:** logging desabilitado (offline/anônimo) também produz `preflush.drop`, com `reason: logging_disabled` (`operation-dispatcher.js:106-114`). Ao depurar, distinga as duas causas.

### 2. Sombreamento no connect (strays locais)

Leituras de mapa por nome acertam direto a chave de armazenamento. Se o `Principal` local (keyed por `'Principal'`) coexistir com um mapa de atlas chamado `Principal` (keyed por UUID), `repo.getMap('Principal')` acerta o **stray local vazio** e o usuário aterrissa num mapa em branco. Por isso `activateAtlasInitialMap()` (`store/map.operations.js:353-393`), que só roda depois do connect, apaga toda entrada cujo `data.id` não seja UUID (`map.operations.js:363-371`) e só então resolve o mapa inicial (mapId pedido por deep link > `lastActiveMap` por nome > primeiro mapa nomeado). Se o atlas está vazio, cria `'Mapa 1'` com `addMap` para o usuário já editar um mapa sincronizado.

Detalhe importante: `setCurrentMap` é chamado com o **nome**, não com a chave UUID, porque presença e cursores usam `mapId` por nome, e peers filtrariam um UUID cru. Ver [[presenca-colaborativa]].

### 3. Criação de mapa com sync ativo

`addMap()` decide a keying pelo estado do sync: `const syncActive = isOperationLoggingEnabled()` → `createMapData(mapName, mapData, { uuidKeyed: syncActive })` (`map.operations.js:184-185`). Com sync ativo o mapa nasce UUID-keyed, então uma reaplicação posterior de snapshot (reconnect, resync, import-merge-rename de um peer) atualiza **a mesma** entrada em vez de duplicar. Registro no `mapResolver` só acontece quando `mapId !== mapName` (`map.operations.js:187-190`).

### 4. Exibição

Como as chaves são uma mistura de UUIDs e nomes, `getAllMapNamesStore()` resolve cada chave UUID→nome via `mapResolver.resolveToName` e de-duplica (`map.operations.js:102-117`). Sem isso o mapa de um peer apareceria na lista como um UUID cru.

## Pontes entre os domínios

- **Remoto → local:** "Salvar projeto" exporta o estado conectado como `.ebgeo`. É a única forma suportada de levar um atlas do servidor para uso offline.
- **Local → remoto:** "Salvar no servidor" (`import_export/save-local-atlas.service.js`) empacota o workspace local, faz o transform, `POST /atlas/import` preservando IDs de entidade do cliente, sobe imagens preservando id, e então `clearAllDataStore` + `markStoreRemote` + `connect`. Ver [[atlas-import-offline]] e [[clone-atlas]].

A fidelidade de ida e volta (P11) exige que toda adição ao transform local→servidor tenha contrapartida no `applyRemoteSnapshot` (ver [[snapshot-e-pull-incremental]], [[aplicacao-operacoes-remotas]]).

## Não-objetivo deliberado: múltiplos atlas locais nomeados

O modelo local é **um workspace + arquivos `.ebgeo`**. "Atlas nomeado" é conceito de servidor. Namespacing por atlas no IndexedDB seria um refactor pesado da persistência **sem ganho de princípio**, já que a separação local↔remoto já é garantida pelo marcador, e só adicionaria risco ao caso de uso offline. Isso é P12 e é decisão fechada, não backlog.

## Divergências entre documentação e código

> [!CONTRADICAO 2026-07-18] guia *visao-e-principios* (absorvido) §4 (passo 4) e guia *arquitetura-sync* (absorvido):240` (§7.4) dizem que o boot chama `reconnectLastAtlas()`, que "se autenticado e `loadStoreOrigin()` for `{kind:'remote', atlasId}`, refaz `connect` + `markStoreRemote` + `startAutoFlush`". Não existe `reconnectLastAtlas` no código. Em `src/js/index.js:157-160` a precedência é: link público (`openPublicAtlasFromUrl`, `?atlasPublico=`) → deep link `?atlas=<uuid>` (`openAtlasFromUrl`) → senão `openAtlasChooserOnBoot()`, que em `index.js:272-283` faz `loadStoreOrigin()` e, se a origem for `remote`, chama `clearAllDataStore()` e **abre o seletor de projetos**. A URL é a fonte de verdade do que reabrir; o marcador serve apenas para descartar o resíduo remoto. Não há reconexão silenciosa ao último atlas.

> [!CONTRADICAO 2026-07-18] guia *ui-ux-ebgeo* (absorvido) §2 diz "O boot não passa pelo Drive: F5 reconecta o último atlas automaticamente". Em `src/js/index.js:272-283`, um boot autenticado numa URL nua (`/`) **abre** o Atlas Drive e descarta o dado remoto anterior. O F5 só reabre o atlas porque `deep-link/atlas-url-sync.js:31-35` mantém `?atlas=<uuid>` escrito na barra de endereços enquanto há conexão.

> [!CONTRADICAO 2026-07-18] O comentário de boot em `src/js/index.js:148` ainda descreve "otherwise reconnect the last remote atlas for a restored authenticated session", mas a linha `index.js:160` chama `openAtlasChooserOnBoot()`. Comentário desatualizado, o comportamento é o seletor.

Ver [[sessao-boot-e-ciclo-de-vida]] para a sequência completa de boot e [[autenticacao-jwt]] para a restauração de sessão.

## Checklist para não errar

- Precisa saber se pode escrever? Use `checkPermission`, não `sessionContext.role` cru, e nunca esqueça que local é sempre editável. Ao adicionar um gate por papel, replique a cláusula `!isRemoteStoreSync() → permitido`, senão você quebra a edição do workspace local do usuário logado.
- Adicionou um novo side-store persistido? Ele precisa entrar em **`clearAllDataStore` e em `enforceLocalStoreWhenLoggedOut`** (as duas listas são paralelas e precisam ficar em sincronia), senão dado remoto sobrevive ao logout (violação da invariante 2).
- Vai marcar `remote`? Marque **antes** do `connect` e reverta para `local` em qualquer falha. A ordem é o que torna o crash mid-pull seguro.
- Vai limpar o store? `markStoreLocal()` depois dos clears, nunca antes.
- Antes de qualquer operação destrutiva no store, verifique `isRemoteStoreSync()`: se for local com trabalho, o usuário precisa da chance de baixar o `.ebgeo`.
- Nunca assuma que a chave de armazenamento de um mapa é o nome, nem que é UUID. Resolva sempre pelo `mapResolver`.
- Ao criar uma nova op map-scoped, passe o **UUID** do mapa em `mapId`, ou ela será descartada com span, mas em silêncio para o usuário.
- Nova chave de setting que seja por cliente (view state) não deve virar op: ela seria descartada por `non_uuid_setting_id` de qualquer forma, e enfileirá-la só polui a fila.
- Adicionou um dado que entra no `.ebgeo`? Ele precisa ter caminho de sincronização (P9) e voltar no snapshot (P11).

## Fontes

- guia *visao-e-principios* (absorvido): os dois domínios (§2), princípios P1/P2/P3/P4/P9/P11/P12, ciclo de vida de boot/login/logout (§4), pontes entre modos (§5), isolamento e chaveamento por UUID (§6), invariantes (§9).
- guia *arquitetura-sync* (absorvido): separação por marcador de origem (linha 41), anti-leak do `Principal` e §7.5 (linhas 242-244), gate de permissão só para atlas remoto conectado (linha 316), drop `non_uuid_mapId` no ledger (linha 420), tabela de módulos (linhas 449-450). O boot descrito em §7.4 (linha 240) diverge do código, ver CONTRADICAO.
- guia *ui-ux-ebgeo* (absorvido): estados de sessão, URL como fonte de verdade, Atlas Drive, modo de visualização segura, decisão do workspace único (§10).
- `src/js/store/store-origin.js`: API, chave `'__store_origin__'`, `StoreOriginKind`, default LOCAL e fallback em erro.
- `src/js/store/store.js:137-218`: boot guard `enforceLocalStoreWhenLoggedOut` e `clearAllDataStore` (incluindo a ordem clear → `markStoreLocal`).
- `src/js/account/open-atlas.service.js` e `src/js/account/account.control.js`: marcar remoto antes do connect, reverter no erro, guardas de confirmação, logout (`_handleLogout`) e atlas excluído (`_handleRemoteAtlasDeleted`).
- `src/js/index.js:148-283`: precedência real de roteamento de boot e `openAtlasChooserOnBoot` (base das contradições registradas).
- `src/js/store/sync/permission-guard.js:71` e `src/js/locking/map-lock.controller.js:86`: gates que dependem de `isRemoteStoreSync()`.
- `src/js/store/sync/operation-dispatcher.js:106-272`: descartes pré-flush (`logging_disabled`, `non_uuid_setting_id`, `non_uuid_mapId`, `batch_filtered`) e a razão do poison pill (22P02 derruba o lote).
- `src/js/store/map.operations.js`: `activateAtlasInitialMap` (remoção de strays, ordem de resolução), `addMap` UUID-keyed com sync ativo, `getAllMapNamesStore` resolvendo UUID→nome.
- `src/js/store/sync/diag/trace-stages.js:53-59`: nomes das razões de drop.
- `tests/store/store-origin.test.js`: comportamento pinado (default LOCAL, persistência do `atlasId`, fallback em valor malformado).
