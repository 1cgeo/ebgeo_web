# Canal WebSocket /api/v1/collab

Canal de tempo real que autentica no upgrade e transporta broadcast de operações, acks, presença, sinais de re-sincronização e erros, com heartbeat, reconciliação de autorização, backoff de reconexão e semântica away/back.

## Papel do canal no sistema

O collab é **um dos dois transportes** do sync (o outro é o REST `/api/v1`, ver [[sintese-rest-vs-websocket]]). A divisão real, confirmada no código, é assimétrica:

- **Saída de operações NÃO passa pelo WebSocket.** O flush usa `POST /atlas/:id/sync` (ver [[fila-operacoes-outbound]]). `WsClient.sendOperation`/`sendOperations` existem (`src/js/store/sync/ws-client.js:161`, `:170`) mas **não têm nenhum call site na aplicação** (só presença, briefing, `sync_request`, `ping` e `leave` são enviados de fato, por `src/js/presence/presence-bridge.js` e pelo próprio cliente).
- **Entrada de operações passa pelo WebSocket.** O servidor persiste o push HTTP e faz broadcast na sala; cada peer aplica via `_applyInboundOps` (`ws-client.js:375`) → `syncGateway.applyRemoteOperation` (`sync-engine.js:405`), ver [[aplicacao-operacoes-remotas]].

Consequência prática: o `ack`/`ack_batch` do WS é **observabilidade, não fluxo de controle**. O `_emit('ack', ...)` (`ws-client.js:298`, `:311`) não tem handler registrado por ninguém; o dequeue confiável da fila usa o ack **da resposta HTTP**. Os frames só alimentam spans `push.ack` do [[syncledger]]. Ver [[ack-idempotencia]] para a semântica do campo `idempotent`.

## Handshake e autorização

URL montada por `apiClient.wsUrl()` (`src/js/store/sync/api-client.js:935`): base HTTP com `^http` trocado por `ws`, mais `?atlasId=<uuid>&token=<accessToken>&clientId=<id>`.

- `atlasId` ou `token` ausentes → upgrade rejeitado com **400**; JWT inválido/expirado/`alg:none` → **401**; sem permissão de leitura no atlas → **403**. Nada disso abre socket, então o cliente vê apenas um `close`.
- O `token` é o mesmo JWT do REST ([[jwt-emissor-unico]], [[autenticacao-jwt]]). Para visitante de [[link-publico]], é o `publicToken` efêmero (read-only, 1 h), usado por `syncEngine.connectPublic` (`sync-engine.js:228`), que **desabilita o logging de operações** para não orfanizar a fila.
- `clientId` **não é credencial**: é chave estável de presença e de deduplicação de eco ([[client-id-estavel]]). Formato validado no servidor: `^[a-zA-Z0-9_-]{8,64}$`; ausente ou malformado, o servidor gera um. O singleton é construído com `getClientId()` justamente porque sem ele a dedupe de eco fica desligada (`ws-client.js:573`, comentário no código).

O frame `connected` traz `sessionId` (o clientId efetivo), `userId`, `permission` (eixo backend: `owner|manage|write|comment|read`) e `role` (vocabulário de UI). Ver [[permissao-vs-papel]] e [[permissoes-atlas]].

> Atenção: o `syncEngine` re-gate a sessão pelo **`payload.role`** (`sync-engine.js:192`), não por `permission`. Antes disso, o dono já é elevado a `owner` assim que o snapshot chega, para a UI não piscar num F5 (`sync-engine.js:177-184`). O guia 04 recomenda checar `permission !== 'read'` no cliente; a implementação real gateia por papel em `permission-guard.js`.

## Handshake, promessa e máquina de estados

`connect(atlasId, {lastVersion})` (`ws-client.js:117`) resolve **no frame `connected`**, não no `onopen` (`ws-client.js:261-263`). A máquina é `OFFLINE → CONNECTING → ONLINE → RECONNECTING` (`src/js/store/sync/connection-state.js:31-36`), com transições ilegais lançando e sendo engolidas por `_safeTransition` (`ws-client.js:536`).

Duas armadilhas reais aqui:

1. **A promessa de `connect()` pode nunca liquidar.** `_connectReject` é armazenado (`ws-client.js:250`) mas `_onClose` nunca o chama. Se o socket fechar antes do `connected` (401/403 no upgrade, por exemplo), o `await wsClient.connect(...)` do `syncEngine` fica pendurado enquanto o backoff tenta de novo; quem chamou não recebe erro.
2. **Fechar durante `CONNECTING` deixa o estado preso em `CONNECTING`.** `_onClose` sempre transiciona para `RECONNECTING` (`ws-client.js:447-449`, com um ternário cujos dois ramos são idênticos), mas `CONNECTING → RECONNECTING` é inválido, então a transição é descartada. O estado não vira `OFFLINE`, e `isOnline()` continua falso, o que mantém o flush travado ([[fila-operacoes-outbound]]).

## Heartbeat e reconexão

- Cliente: `ping` a cada **25 s** (`DEFAULT_HEARTBEAT_MS = 25000`, `ws-client.js:31`). Se o `pong` do ciclo anterior não chegou, o cliente **fecha o próprio socket com code 4000** (`ws-client.js:486-488`), forçando o caminho de reconexão em vez de conversar com um link morto.
- Servidor: varredura a cada 30 s, `terminate()` em sockets sem pong (close `1006`) e, a cada tick, **reconciliação de autorização** (share revogado, atlas despublicado, organização desativada) fechando com **4003**.
- Reconexão: backoff exponencial `1000 * 2^n`, teto de 30 s, **sem limite de tentativas** (`ws-client.js:462-476`). Só ocorre enquanto `_wantConnected` for verdadeiro; `disconnect()` envia `leave` e fecha com 1000 (`ws-client.js:126-139`).
- Ao reabrir, se o estado anterior era `RECONNECTING`, o cliente dispara `sync_request(lastVersion)` (`ws-client.js:417`, `:425`) e o servidor devolve `sync_response` com ops incrementais ou snapshot completo ([[snapshot-e-pull-incremental]]). **Não há replay automático**: o que passou durante a queda só volta por esse pedido.

> [!CONTRADICAO 2026-07-18] `docs/guias/04-websocket-collab.md` §3.1 diz "ping a cada ~30 segundos" e §7 mostra `maxReconnectAttempts = 5`; o código em `src/js/store/sync/ws-client.js:31` usa 25 s e em `ws-client.js:462` reconecta indefinidamente (sem `maxReconnectAttempts`). `docs/arquitetura-sync.md` já registra os 25 s corretamente.

> [!CONTRADICAO 2026-07-18] `docs/guias/04-websocket-collab.md` §3.9/§4 mandam tratar o close code `4001` como "atlas removido, não reconectar"; o código em `src/js/store/sync/ws-client.js:437-452` **não inspeciona `event.code`** e agenda reconexão para qualquer fechamento. A parada só acontece pela mensagem `atlas_deleted`, que dispara `syncEngine.disconnect()` (`src/js/store/sync/sync-engine.js:429`). Se o close chegar sem/antes da mensagem, ou no caso do `4003` (autorização revogada no heartbeat), o cliente entra em laço de reconexão que o servidor rejeita no upgrade.

## Ops de entrada: cursor de versão, eco e serialização

`_applyInboundOps` (`ws-client.js:375`) faz três coisas por operação, nessa ordem:

1. **Avança `_lastVersion`** com `op.serverVersion` quando maior. O comentário em `ws-client.js:386-390` é importante: `server_version` vem de uma **sequência global compartilhada entre atlas**, portanto é monotônica mas **não contígua** por atlas. Buracos são ops de outro atlas, não perda. Tratar não-contiguidade como gap já causou tempestade de `sync_request` no passado.
2. **Descarta o próprio eco** quando `op.clientId === this._clientId` (`ws-client.js:397`). Isso é obrigatório porque o autor empurrou por HTTP e o broadcast da sala não tem socket dele para excluir. Span `ws.self-echo`.
3. **Serializa os applies** numa cadeia de promessas `_applyChain` (`ws-client.js:409`). O handler faz read-modify-write assíncrono da entrada do mapa no IndexedDB; aplicar em paralelo faz escritas concorrentes na mesma chave se sobrescreverem e perderem tudo menos uma.

Envelope da operação em [[envelope-operacao]]; tipos em [[tipos-entidade-sync]]; resolução de conflito em [[modelo-conflito-lww]] e [[idempotencia-e-convergence-guard]] (lembrando [[sintese-nao-e-crdt]]: a ordem é a de chegada no servidor).

## Sinais fora do log de operações

Nem toda mudança do servidor vira operação. O `switch` de `_onMessage` (`ws-client.js:282`) roteia esses frames para handlers dedicados no `syncEngine`:

| Frame | Handler interno | Efeito no cliente |
|---|---|---|
| `atlas_deleted` | `atlasDeleted` | `disconnect()` + `ATLAS_DELETED_REMOTE` (`sync-engine.js:429`) |
| `atlas_owner_changed` | `atlasOwnerChanged` | re-resolve papel local: novo dono vira `owner`, ex-dono cai para `manager` (`sync-engine.js:441-457`) |
| `sharing_updated` | `sharingUpdated` | só o usuário afetado reage; admin global é ignorado; aplica `msg.role` sem reconectar (`sync-engine.js:465-474`) — ver [[compartilhamento-atlas]] |
| `atlas_settings_updated` | `atlasSettings` | reaplica o overlay de config por atlas (`sync-engine.js:476`) — ver [[atlas-settings]], [[config-dinamico]] |
| `atlas_updated`, `map_duplicated`, `maps_merged` | `serverResync` | **re-pull de snapshot completo** + `LAYERS_CHANGED` (`ws-client.js:352-359`, `sync-engine.js:493`) |

O grupo `serverResync` existe porque renomear atlas, duplicar e mesclar mapa são mutações REST que **criam dados fora do log de operações**: os peers nunca receberiam essas entidades como ops. Antes de existir esse ramo, os frames caíam no `default` e sumiam. Ver [[clone-atlas]].

Dois gates defensivos valem lembrar: tanto `syncResponse` (`sync-engine.js:407-412`) quanto `atlasSettings` (`sync-engine.js:476-483`) **descartam frames tardios quando `connectionState.isOnline()` é falso**, para não persistir dados remotos num store em teardown (logout/troca de atlas) nem recapturar a config restaurada como novo baseline. Ver [[store-origin-local-remoto]] e [[sessao-boot-e-ciclo-de-vida]].

## Presença e backpressure

Presença sai por `presence-bridge.js` (`:350-357` registra `connected`, `presence`, `cursor`, `selection`, `temporal`, `briefingEdit`). Frames de saída: `cursor` (mousemove throttled ~80 ms), `selection` nas três superfícies 2D/3D/360 com `surface` + escopo, `temporal` (estado de linha do tempo, ver [[modulo-temporal]]) e `briefing_edit_start/end` (awareness advisory, sem lock no servidor).

`_sendRaw` implementa **backpressure local** (`ws-client.js:519-533`): se `bufferedAmount > 1 MiB`, frames de tipo `cursor`, `selection` e `temporal` são **descartados** (o próximo frame os supersede), enquanto ops e frames de controle nunca são. Detalhes em [[presenca-tempo-real]] e [[presenca-colaborativa]].

A distinção away/saída é do servidor: `1006` marca `away` com graça de 120 s e emite `user_away`; reconectar com o **mesmo `clientId`** cancela o timer e emite `user_back`; `leave` explícito remove na hora. Ver [[presenca-away-vs-saida]]. Por isso `disconnect()` envia `leave` antes de fechar, evitando o fantasma de 2 minutos na lista dos peers.

## Qualidade adaptativa: contrato existe, cliente não usa

O servidor classifica RTT em bandas e responde `adaptive-settings` (`batchIntervalMs`, `geometryPrecision`, `viewportOnly`) apenas na **transição** de banda. O `ws-client` roteia o frame para `_emit('adaptiveSettings', ...)` (`ws-client.js:340-341`).

> [!CONTRADICAO 2026-07-18] `docs/guias/04-websocket-collab.md` §3.8 e o checklist descrevem o cliente reportando `connection-quality` e aplicando `adaptive-settings`; no repositório **não existe nenhum envio de `connection-quality`** e **nenhum handler registrado para `adaptiveSettings`** (busca em `src/` só encontra as três linhas do próprio `ws-client.js`). O ramo é morto no frontend hoje. Ver [[qualidade-conexao-adaptativa]].

Se for implementar: `geometryPrecision` é sugestão de **transporte**; nunca trunque coordenada antes de persistir.

## Erros e limites

Erro do WS é **plano** (`{type:'error', code, message}`), diferente do envelope REST `{error:{code,message}}` ([[erros-api]]). Códigos: `FORBIDDEN` (read-only tentando enviar op), `VALIDATION_ERROR` (schema Joi, máx. 500 ops por mensagem), `OPERATION_FAILED`, `SYNC_FAILED`. O cliente encaminha tudo para o handler `error` com `kind: 'server'` (`ws-client.js:363`); frames desconhecidos não quebram nada, viram span `ws.inbound{dropped, unknown_type}` (`ws-client.js:369`), o que é a rede de segurança contra divergência de protocolo.

Limites estruturais (ver [[sintese-limites-collab]]):

- **Sala é por [[atlas]], não por mapa.** Cursor e seleção de quem está em outro mapa chegam a todos; filtrar por `mapId` é responsabilidade do frontend.
- **Sem buffer de mensagens perdidas.** Recuperação é sempre `sync_request` na reconexão.
- **Estado efêmero é single-instance** (salas, presença, timers de away vivem em memória de um processo). Escalar horizontalmente exige sticky session ou pub/sub, não implementado. Ver [[deploy-backend]].
- **Lock de mapa é imposto pelo servidor** (409 em mutação de filho, flip e delete exigem `owner`); lock de camada, grupo e feição é advisory e depende do cliente.

## Fontes
- `docs/guias/04-websocket-collab.md`: protocolo completo (query do handshake, códigos 400/401/403, frames `connected`/`ack`/presença/mutações REST, bandas adaptativas, semântica away vs remove, limites de escala).
- `docs/arquitetura-sync.md` §4.2 e §5: montagem da URL por `wsUrl()`, tabela de roteamento do `_onMessage`, heartbeat de 25 s + reconciliação de autorização com close 4003, backoff 1s→30s, self-echo do autor.
- `docs/guias/03-sync-inicial.md` e `docs/guias/05-sync-crdt.md`: semântica de `sync_request`/`sync_response` (snapshot vs incremental) e do modelo de conflito referenciado pelos acks.
- `src/js/store/sync/ws-client.js`: constantes de heartbeat/backoff, backpressure de presença, dedupe de eco, serialização de applies, roteamento de frames (fonte da verdade sobre as contradições marcadas).
- `src/js/store/sync/sync-engine.js`: fiação dos handlers (`atlasDeleted`, `atlasOwnerChanged`, `sharingUpdated`, `atlasSettings`, `serverResync`), gates de frame tardio, `connect`/`connectPublic`.
- `src/js/store/sync/connection-state.js` e `src/js/store/sync/api-client.js`: transições válidas da máquina de conexão e construção da URL do socket.
- `src/js/presence/presence-bridge.js`: quais frames de presença o app realmente envia e assina.
