# Modos de operação do cliente: anônimo, autenticado e público

O frontend opera em três modos, anônimo (dados só no IndexedDB, sem colaboração), autenticado (sync e colaboração completos) e público (publicToken read-only de 1 hora), sendo que sem login ainda se exige o servidor, porque o boot é fail-fast em `GET /api/config`.

## O eixo que realmente define o modo

Modo não é uma flag única. São dois estados independentes que se combinam:

1. **Identidade** (`sessionContext`, `store/sync/session-context.js`): `SessionMode.OFFLINE` ou `ONLINE`, mais um marcador `_isVisitor`. `isAuthenticated()` só é verdadeiro quando `mode === ONLINE && userId !== null && !_isVisitor` (`session-context.js:196-198`). O visitante público é ONLINE mas **não** autenticado (`session-context.js:264-270`).
2. **Origem do store** (`store/store-origin.js`): `LOCAL` ou `REMOTE`, persistida em `__store_origin__` (`store-origin.js:28`), com espelho síncrono para leitura em hot path (`isRemoteStoreSync()`, `store-origin.js:66-68`). Ver [[store-origin-local-remoto]] e [[dominio-local-vs-remoto]].

A consequência prática está no gate de permissão: `checkPermission()` libera tudo quando `sessionContext.isOffline() || !isRemoteStoreSync()` (`store/sync/permission-guard.js:69-71`). Ou seja, **o papel só restringe um atlas remoto conectado**. Um usuário logado como `viewer` global continua podendo desenhar no próprio workspace local. Ver [[permissoes-atlas]] e [[permissao-vs-papel]].

## 1. Anônimo (sem login)

- Dados vivem só no IndexedDB, origem `LOCAL`, sem WebSocket, sem presença, sem compartilhamento.
- Um único workspace local, não vários atlas nomeados. Atlas nomeado é conceito de servidor. O arquivo `.ebgeo` é o veículo de portabilidade local (ver [[formato-ebgeo-roundtrip]] e [[atlas]]).
- `sync-status.control.js:102` esconde a luz de conexão enquanto `!isAuthenticated()`.

### Armadilha principal: anônimo não é offline

O boot é **fail-fast** no config do servidor. `initApp()` tenta `applyRuntimeConfig` 3 vezes com 1 s de intervalo e, se nenhuma tentativa aplicar, chama `showUnavailableScreen()` e **retorna sem bootar** (`src/js/index.js:73-86`). O `config.js` empacotado é só uma casca hidratada pelo `/api/config` (`src/js/ui/unavailable-screen.js:3-8`). Sem backend alcançável não existe app, nem em modo anônimo. Ver [[config-dinamico]] e [[config-runtime-urls-relativas]].

O retry de 3 tentativas existe para que um soluço transitório de rede não derrube o boot. Só uma indisponibilidade real chega à tela "EBGeo indisponível".

## 2. Autenticado

Fluxo de entrada em um atlas remoto, sempre nesta ordem (`account/account.control.js:783-801`, e o mesmo padrão em `:576-582` e `:818-825`):

```
syncEngine.disconnect() → clearAllDataStore() → markStoreRemote(atlasId)
→ syncEngine.connect(atlasId, { initialPull: true }) → activateAtlasInitialMap() → startAutoFlush()
```

O `clearAllDataStore()` antes do `markStoreRemote` não é opcional: o store é um só, então abrir um atlas remoto descarta o conteúdo anterior. Por isso a UI confirma com o usuário antes quando há trabalho local.

- Sessão sobrevive a F5: `restoreSessionFromStorage()` roda **antes** do boot do store, para que a guarda de boot enxergue a sessão e não descarte o atlas remoto em cache (`src/js/index.js:99-104, 250-263`). Ver [[autenticacao-jwt]], [[refresh-token-rotacao]] e [[sessao-boot-e-ciclo-de-vida]].
- Papel por atlas vem do `connected` do WebSocket e sobrescreve o papel global de login (`sync-engine.js:186-198`). O owner é elevado já no snapshot, antes do handshake, para que os botões de configuração apareçam imediatamente no F5 (`sync-engine.js:177-184`).
- Escrita sai como operação, nunca como REST de escrita de entidade. Ver [[fila-operacoes-outbound]], [[envelope-operacao]] e [[canal-collab-websocket]].
- Flush é gated em `connectionState.isOnline()` (`sync-flush.js:65`); offline temporário acumula na fila local. Ver [[fila-operacoes-pendentes]].

## 3. Público (link de visualização)

Disparado por `?atlasPublico=<link>` na URL, e **só** quando ninguém está logado (`index.js:226-241`):

```
apiClient.getPublicAtlas(link) → setEphemeralToken(atlas.publicToken)
→ clearAllDataStore() → markStoreRemote(atlas.id) → syncEngine.connectPublic(atlas.id)
```

Detalhes que importam:

- `setEphemeralToken` zera o refresh token (`api-client.js:117-120`). O token público é descartável e expira sozinho (contrato de 1 h do backend, ver [[link-publico]]). Não há rotação.
- `connectPublic` chama `disableOperationLogging()` (`sync-engine.js:227`). Isso é anti-vazamento: sem token de push, ops enfileiradas ficariam órfãs e seriam despejadas no atlas errado num login posterior. `connect()` normal faz o inverso, `enableOperationLogging()` (`sync-engine.js:169`), justamente porque um `connectPublic` anterior pode ter desligado.
- O visitante recebe `setVisitorSession()` (ONLINE + VIEWER + `_isVisitor`), então o guard bloqueia escrita no store remoto e o menu de conta não aparece (`sync-engine.js:230-232`).
- O overlay de settings do atlas **também** se aplica ao visitante, respeitando disponibilidade de 3D/360/basemaps (`sync-engine.js:234-235`). Ver [[atlas-settings]].
- O token público entra na URL do socket como qualquer outro: `wsUrl()` monta `?atlasId=&token=&clientId=` com o access token corrente (`api-client.js:935-940`), que nesse momento é o `publicToken`. Ver [[websocket-collab]] e [[client-id-estavel]].

Armadilha: como `isAuthenticated()` é falso para o visitante, qualquer UI que use esse predicado para decidir "estou conectado" vai errar no modo público. Use a origem do store e o `connectionState`, não `isAuthenticated()`.

## Transição anônimo → autenticado (subir o workspace local)

Existe e é implementada, mas não do jeito que o guia descreve. `saveLocalAtlasToServer` (`import_export/save-local-atlas.service.js:91-118`) faz:

1. `buildExportDataObject` dos mapas locais,
2. `buildServerImportPayload` (`import_export/local-atlas-to-server.js`),
3. `apiClient.importAtlas(payload)` → `POST /atlas/import` (`api-client.js:617-619`),
4. upload dos blobs **preservando os ids locais** via `bulkUploadImages` em lotes de 50 (`save-local-atlas.service.js:18, 72-82`; `api-client.js:885-887`).

O serviço **não** conecta nem troca a origem do store, isso fica com a UI chamadora (`save-local-atlas.service.js:11-12`). Ver [[atlas-import-offline]] e [[imagens-atlas]].

Imagens fora do allowlist do servidor (`image/png`, `image/jpeg`, `image/webp`) são reportadas como `skipped`, não como falha (`save-local-atlas.service.js:19, 50-53`). Ícones customizados em SVG caem nesse caso, por SVG ser vetor de XSS armazenado.

> [!CONTRADICAO 2026-07-18] `docs/guias/08-offline-import.md` §4.4 e §4.7 dizem que os `imageId` locais são substituídos por ids de servidor e que é preciso enviar operações de UPDATE nas features de imagem depois do bulk upload. O código em `src/js/import_export/save-local-atlas.service.js:8-10` e `:100-105` sobe os blobs preservando os ids locais (o backend aceita o id do cliente), justamente para que as referências das features importadas continuem válidas **sem rewrite pós-import**. Não há operações de remapeamento.

> [!CONTRADICAO 2026-07-18] `docs/guias/08-offline-import.md` §5.1 modela estado por atlas no IndexedDB (`{ mode, serverId, lastSyncVersion, pendingOperations }` em cada atlas). O código não tem múltiplos atlas locais: existe um marcador único de origem, `__store_origin__` com `{ kind, atlasId }`, em `src/js/store/store-origin.js:28` e `:73-79`, e trocar de atlas remoto passa por `clearAllDataStore()`. Múltiplos atlas locais nomeados são não-objetivo declarado.

> [!CONTRADICAO 2026-07-18] `docs/guias/08-offline-import.md` §5.2 diz que conflitos são "resolvidos via CRDT". O modelo real é LWW por ordem de chegada no servidor, com idempotência por `op_id`; o relógio de Lamport é registrado mas não decide conflito. Ver [[sintese-nao-e-crdt]] e [[modelo-conflito-lww]].

## Tabela de decisão

| Aspecto | Anônimo | Autenticado | Público |
|---|---|---|---|
| `sessionContext.mode` | OFFLINE | ONLINE | ONLINE (`_isVisitor`) |
| `isAuthenticated()` | false | true | **false** |
| Origem do store | LOCAL | REMOTE (quando conectado) | REMOTE |
| Backend exigido no boot | **sim** | sim | sim |
| WebSocket / presença | não | sim | sim (só recebe) |
| Logging de operações | sim (fila local) | sim | **desligado** |
| Gate de papel | inativo | ativo no atlas remoto | bloqueia escrita |
| Token | nenhum | JWT + refresh | efêmero, sem refresh |

## Onde isso encosta

- Fila e envelope de saída: [[fila-operacoes-outbound]], [[envelope-operacao]], [[sync-lww-operacoes]]
- Entrada de dados na conexão: [[snapshot-e-pull-incremental]], [[aplicacao-operacoes-remotas]]
- Colaboração viva: [[presenca-colaborativa]], [[presenca-tempo-real]]
- Compartilhar e clonar: [[compartilhamento-atlas]], [[clone-atlas]], [[sintese-capacidades-por-papel]]
- Observabilidade do pipeline: [[syncledger]]

## Fontes
- `docs/guias/08-offline-import.md`: definição dos três modos, nota de que sem login ainda se exige servidor, fluxo de import de atlas local (`POST /atlas/import`), bulk upload de imagens (limite de 50, allowlist, mapping), tabela offline vs online. Três pontos divergem do código e estão marcados acima.
- `docs/guias/04-websocket-collab.md`: handshake do canal `/api/v1/collab`, token público read-only de 1 h obtido em `GET /atlas/public/:link`, visitante público sem registro de sessão, eixos `permission` vs `role` no `connected`, `clientId` estável.
- `src/js/index.js`: boot fail-fast em `/api/config` com 3 tentativas, restauração de sessão, roteamento de boot (`?atlasPublico` antes de `?atlas`), fluxo completo do modo público.
- `src/js/store/sync/session-context.js`, `permission-guard.js`, `sync-engine.js`, `api-client.js`, `sync-flush.js`: estados de sessão, gate de permissão restrito a store remoto, `connectPublic`, token efêmero, `wsUrl`.
- `src/js/store/store-origin.js`: marcador único LOCAL/REMOTE que define o split, no lugar de estado por atlas.
- `src/js/import_export/save-local-atlas.service.js`: ordem real do upload do workspace local e preservação dos ids de imagem.
- `src/js/account/account.control.js`, `src/js/ui/unavailable-screen.js`, `src/js/account/sync-status.control.js`: sequência de abertura de atlas remoto, tela de indisponibilidade, ocultação do indicador quando anônimo.
