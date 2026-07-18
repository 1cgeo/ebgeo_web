# Presença Colaborativa

Camada efêmera em memória, keyed por `clientId`, que propaga roster de usuários, cursores, seleções, cursor temporal e awareness de edição de briefing entre os pares de uma sala de atlas.

## O que é (e o que não é)

Presença é **awareness**, não dado. Nada dela passa pela fila de operações, pelo IndexedDB ou pelo Postgres: os frames viajam apenas pelo [[canal-collab-websocket]], são best-effort e somem quando o socket cai. Não confunda com [[envelope-operacao]] (persistido, idempotente, versionado) nem com [[comentario-espacial]] (esse sim é entidade sincronizada).

Consequências práticas:

- Frame de presença perdido = perdido. `broadcastCursor` faz `if (!wsClient.isConnected()) return;` (`src/js/presence/presence-bridge.js:141`), nunca enfileira.
- Sob backpressure local o próprio transporte **descarta** frames de presença: `cursor`/`selection`/`temporal` estão em `COALESCABLE_TYPES` e são jogados fora quando `socket.bufferedAmount > 1 MiB` (`src/js/store/sync/ws-client.js:36`, `:519-525`). Operações nunca são descartadas assim.
- Presença só existe em atlas remoto conectado. No modo local/anônimo ([[dominio-local-vs-remoto]], [[modos-operacao]]) o bridge fica montado mas inerte.

## Anatomia (cliente)

Três camadas em `src/js/presence/`, sem acoplamento cruzado:

1. **`presence-bridge.js`** — o único lugar que fala WS. `startPresence({ map })` é chamado uma vez em `src/js/map_sig.js:632`. Inbound: registra handlers para `connected`, `presence`, `cursor`, `selection`, `temporal`, `briefingEdit` (`presence-bridge.js:350-357`). Outbound: `mousemove` (throttle 80 ms), `MAP_LOCK_CHANGED`, `TEMPORAL_CURSOR_CHANGED` (throttle 80 ms), `BRIEFING_EDIT_STARTED/ENDED`, mudança de `selection.features` no StateManager, e cliques `MARKER_3D_*`/`MARKER_360_*`.
2. **`presence-store.js`** — estado puro, sem DOM, `Map<clientId, PresenceUser>`. Emite `PRESENCE_CHANGED` (roster/away/currentMap/temporal/briefing), `PRESENCE_CURSORS_CHANGED` (só cursor, com `{mapId}`) e `PRESENCE_SELECTIONS_CHANGED` (com `{surface}`). Os três emits são envolvidos em `try/catch` porque o event bus pode não existir antes de `initServices()` (`presence-store.js:521-551`).
3. **Render** — `OnlineUsersControl` (roster + dropdown de awareness), `RemoteCursorsLayer` (um `maplibregl.Marker` por peer), `RemoteSelectionsLayer` (caixas de contorno na fonte `remote-selection-boxes`). O 3D e o 360 leem o store diretamente: `marker_tool_3d.js:518` usa `getSelections('3d', tilesetId)` e `street_view_viewer.js:1057` usa `getSelections('360', photoName)`.

A separação importa: o store guarda a **figura completa** (inclusive você mesmo); quem exclui self é a UI.

## Chaveamento e a armadilha do self

`resolveKey()` prefere `clientId`, cai para `userId` e, por último, para `id` (`presence-store.js:48-64`), porque o snapshot de join do backend traz os usuários como `{ id, nome, ... }` sem `clientId`.

> [!CONTRADICAO 2026-07-18] `docs/arquitetura-sync.md:330` diz "Tudo é keyed por `clientId`"; o código em `src/js/presence/presence-store.js:48-64` faz fallback para `userId` e depois `id`, então uma entrada vinda do snapshot pode ficar chaveada pelo id de usuário do backend, não pelo `clientId`.

Disso decorre a pegadinha central: **a exclusão do self usa `sessionContext.userId`, não `clientId`** (`online-users.control.js:230-232`). O `clientId` do [[client-id-estavel]] é um id persistido por navegador e não bate com a chave que o servidor usou no snapshot. `getOthers(self)` compara `self` contra `user.clientId` **e** `user.userId` (`presence-store.js:415-425`), justamente para tolerar as duas convenções. Se você passar `clientId` ali, você aparece no seu próprio roster.

Corolário: um mesmo usuário com duas abas aparece duas vezes (duas chaves), o que é intencional.

## Cursor e o campo `mapId` que é um nome

O bridge envia `mapId: getCurrentMapNameSync()` (`presence-bridge.js:144`), ou seja, o campo chamado `mapId` carrega o **nome** do mapa. O `RemoteCursorsLayer` resolve a chave ativa com a mesma função, então o par bate (`remote-cursors.layer.js:63-69`). Ao mexer nisso, mude os dois lados juntos ou os cursores somem silenciosamente (filtro por chave que nunca casa).

O backend não tem handler `map_active`. O indicador "fulano está no mapa X" **pega carona** no frame de cursor: numa troca de mapa (`MAP_LOCK_CHANGED`) o cliente manda um cursor **sem posição** só para carregar o novo `mapId` (`broadcastCurrentMap`, `presence-bridge.js:153-158`), e o store lê `mapId` de todo frame inbound (`_applyCurrentMap`). Por isso `setCursor` pode emitir dois eventos: sempre `PRESENCE_CURSORS_CHANGED` e, quando `currentMap` mudou, também `PRESENCE_CHANGED` (`presence-store.js:260-267`).

`getCursors(mapId)` sem argumento devolve cursores de **todos** os mapas; a layer trata `mapId` ausente como "nada a renderizar" em vez de renderizar tudo (`remote-cursors.layer.js:127-129`).

## Seleção: a única presença com gate de papel

Cursor e temporal são ungated. Seleção é **editor-gated dos dois lados**: no cliente, `canBroadcastSelection()` consulta `checkPermission('CREATE_FEATURE').allowed` (`presence-bridge.js:167-173`), espelhando o gate do backend. Um Comentarista ou Visualizador **recebe** seleções dos pares mas nunca transmite a sua. Ver [[permissao-vs-papel]] e [[permissoes-atlas]].

O frame de seleção é escopado por superfície: `'2d'` usa `mapId`, `'3d'` usa `tilesetId`, `'360'` usa `photoName` (`presence-store.js:461-478`). Enviar seleção 3D sem `tilesetId` faz ela aparecer no modelo errado.

Detalhes que evitam bug:

- `featureMeta` (`{id, type}` por feição) viaja junto para o peer montar a caixa de destaque sem consultar o store (`presence-bridge.js:188-190`). Os ids sozinhos não carregam o tipo de ferramenta.
- Deseleção vira `selection = null` (lista vazia normaliza para `null`), mas `setSelection` captura a superfície **antes** de zerar, para notificar a superfície que acabou de limpar (`presence-store.js:285-298`). Sem isso o destaque do peer ficaria preso na tela.
- A geometria nunca trafega: o `RemoteSelectionsLayer` resolve os ids na fonte local, o que só funciona porque o atlas é compartilhado.

## Temporal e briefing

- **Temporal** ([[modulo-temporal]]): `TEMPORAL_CURSOR_CHANGED` dispara **por rAF** durante o playback, então o bridge coalesce (leading + um trailing por janela de 80 ms, `scheduleCoalesced`). O payload leva `{cursor, label, playing}` com o rótulo já formatado (`"D+3"`), porque o peer não tem a config temporal do emissor (`presence-bridge.js:274-292`). O store guarda o blob opaco.
- **Briefing**: `briefing_edit_start/end` sobem no início/fim da edição; inbound `briefing_edit_started/ended` viram `setBriefingEdit` (`presence-bridge.js:121-133`). É indicador, **não lock**: dois usuários podem editar o mesmo briefing e o resultado cai no [[modelo-conflito-lww]].

## Ciclo de vida e teardown

- `startPresence` é idempotente (`state._started`). Não existe chamada de `stopPresence` fora do próprio módulo, porque o bridge vive enquanto o mapa vive.
- Quem limpa o roster no logout é `account.control.js:849` (`presenceStore.clear()`), depois de `syncEngine.logoutAndDisconnect()`. Ver [[sessao-boot-e-ciclo-de-vida]].
- `stopPresence()` desregistra os handlers WS **sobrescrevendo-os com no-ops** (`presence-bridge.js:446-449`), porque `wsClient.on()` guarda um único handler por evento. Isso significa que dois assinantes do mesmo evento WS não coexistem: registrar outro handler para `'cursor'` derruba o da presença.

## Cor e identidade visual

`getPresenceColor(key)` é um hash djb2 determinístico sobre uma paleta de 14 cores (`presence-colors.js`). A mesma chave dá a mesma cor em **todos** os clientes, então avatar do roster, cursor no mapa e caixa de seleção do mesmo peer são da mesma cor. Passe sempre a mesma chave (preferencialmente `userId`); alternar entre `userId` e `clientId` troca a cor da pessoa no meio da sessão. Colisão de cor com 14 slots é esperada e aceita.

## Servidor

A presença é só memória no processo do backend; `active_sessions` registra apenas connect/heartbeat. Broadcast servidor→cliente: `user_joined` (aninhando o descritor em `msg.user`, ao contrário de `user_left`/`user_away`/`user_back`, que trazem `userId` no topo, ver `presence-bridge.js:94-99`), mais o snapshot `connected` com `usersOnline`/`sessionId`/`permission`/`role`. Detalhes de away/saída em [[presenca-away-vs-saida]] e do roster em [[presenca-tempo-real]].

O backend classifica RTT e responde `adaptive-settings` ([[qualidade-conexao-adaptativa]]); o cliente reemite como `adaptiveSettings` (`ws-client.js:341`) mas **nenhum módulo do frontend assina esse evento hoje** — o gancho existe, o consumidor não.

## Observabilidade

Presença não gera spans de operação, mas o tap de barramento do [[syncledger]] registra `presence` como probe de efeito de UI. Para depurar "o peer não aparece", cheque na ordem: socket conectado ([[websocket-collab]]), snapshot `connected` recebido, chave resolvida (o bug histórico do `user_joined` aninhado), e só então a UI. Limites conhecidos da colaboração em [[sintese-limites-collab]].

## Fontes
- `docs/arquitetura-sync.md` (§10, §5, §9): presença só em memória no servidor, catálogo de mensagens WS cliente↔servidor, gates de `cursor`/`selection`/`temporal`, papel do `clientId`.
- `src/js/presence/presence-store.js`: chaveamento com fallback, normalização de cursor/seleção, escopo por superfície, `getOthers`.
- `src/js/presence/presence-bridge.js`: roteamento inbound/outbound, throttles de 80 ms, gate de seleção por `CREATE_FEATURE`, piggyback de mapa ativo no cursor, teardown por no-op.
- `src/js/store/sync/ws-client.js`: `COALESCABLE_TYPES` + descarte por backpressure, assinaturas de `sendCursor/sendSelection/sendTemporal/sendBriefingEdit*`, emissão de `adaptiveSettings`.
- `src/js/presence/online-users.control.js`, `remote-cursors.layer.js`, `remote-selections.layer.js`, `presence-colors.js`: exclusão de self por `userId`, chave de mapa por nome, cor determinística.
- `src/js/map_sig.js`, `src/js/account/account.control.js`: montagem única do bridge e limpeza do roster no logout.
