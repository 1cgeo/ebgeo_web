# Canal /api/v1/collab (WebSocket)

Canal WebSocket por atlas que entrega colaboracao em tempo real, presenca viva, ack de operacoes e broadcast de mutacoes REST, com autorizacao resolvida no handshake por JWT, heartbeat, reconciliacao de permissao e semantica away/back.

## Papel do canal no sistema

O collab e **um dos dois transportes** do sync (o outro e o REST `/api/v1`, ver [[sintese-rest-vs-websocket]]). A divisao real, confirmada no codigo, e assimetrica:

- **Saida de operacoes NAO passa pelo WebSocket.** O flush usa `POST /atlas/:id/sync` (ver [[fila-operacoes-outbound]]). `WsClient.sendOperation`/`sendOperations` existem (`ws-client.js:161`, `:170`) mas **nao tem nenhum call site na aplicacao**; de fato so saem presenca, briefing, `sync_request`, `ping` e `leave` (`src/js/presence/presence-bridge.js` e o proprio cliente).
- **Entrada de operacoes passa pelo WebSocket.** O servidor persiste o push HTTP e faz broadcast na sala; cada peer aplica via `_applyInboundOps` (`ws-client.js:375`) para `syncGateway.applyRemoteOperation` (`sync-engine.js:405`), ver [[aplicacao-operacoes-remotas]].

Consequencia pratica: o `ack`/`ack_batch` do WS e **observabilidade, nao fluxo de controle**. O `_emit('ack', ...)` (`ws-client.js:298`, `:311`) nao tem handler registrado por ninguem; o dequeue confiavel da fila usa o ack **da resposta HTTP**, e os frames so alimentam spans `push.ack` do [[syncledger]].

## Handshake e autorizacao

URL: `ws(s)://host/api/v1/collab?atlasId=<uuid>&token=<jwt>&clientId=<id>`, montada por `apiClient.wsUrl()` (`api-client.js:935`, base HTTP com `^http` trocado por `ws`). O gateway serve **apenas** esse path; upgrade em qualquer outro caminho recebe `404` e o socket e destruido (`collab.gateway.js:217`).

Ordem de rejeicao no upgrade, antes de o socket abrir (o cliente ve so um `close`):

| HTTP | Causa | Codigo |
|---|---|---|
| `400` | falta `atlasId` ou `token` | `collab.gateway.js:232` |
| `401` | JWT invalido/expirado, ou algoritmo fora do allowlist (`alg:none` cai aqui) | `collab.gateway.js:241` |
| `403` | organizacao desativada, OU token valido sem permissao de leitura no atlas | `collab.gateway.js:252` e `:260` |

A permissao vem de `resolvePermission()` (`collab.gateway.js:52`), nesta ordem: token publico (so vale para o atlas emissor e se o atlas ainda for `is_public`) → `role` global `admin` recebe `owner` → dono do atlas → linha em `atlas_shares` → `is_public` = `read`. Ver [[permissoes-atlas]], [[autenticacao-jwt]] e [[link-publico]].

O `token` e o mesmo JWT do REST ([[jwt-emissor-unico]]). Para visitante de [[link-publico]] e o `publicToken` efemero (read-only, 1 h), usado por `syncEngine.connectPublic` (`sync-engine.js:213`), que **desabilita o logging de operacoes** para nao orfanizar a fila.

O `clientId` **nao e credencial**: e chave estavel de presenca, continuidade e dedupe de eco, validado por `^[a-zA-Z0-9_-]{8,64}$` (`collab.gateway.js:20`); ausente ou malformado, o servidor gera um `crypto.randomUUID()` e voce perde continuidade entre reconexoes e a dedupe de eco. O singleton do frontend e construido com `getClientId()` exatamente por isso (`ws-client.js:573`). Detalhe em [[client-id-estavel]].

**Armadilha de autorizacao de longa duracao:** a permissao e cacheada no objeto `ws` no handshake, mas **re-reconciliada a cada batida do heartbeat** (`reconcileAuthorization`, `collab.gateway.js:118`, chamada de `heartbeatSweep` em `:160`). Share revogado, atlas despublicado ou organizacao desativada fecham o socket com **`4003`**; um rebaixamento (write→read) apenas abaixa `ws.permission`, e a proxima escrita e recusada. A janela de staleness e de um intervalo de heartbeat (~30 s).

## Frame `connected` e os dois eixos de permissao

Enviado uma unica vez (`collab.gateway.js:345`) com `sessionId` (= `clientId` efetivo), `userId`, `permission`, `role` e `usersOnline`.

- `permission` e o eixo **por-atlas** e e o campo congelado: `owner | manage | write | comment | read`.
- `role` e vocabulario de UI derivado por `toFrontendRole(permission, roleGlobal)`: `owner | admin | manager | editor | commenter | viewer`.

O contrato manda checar `permission !== 'read'` para decidir escrita, nunca `role` (o `role` colapsa informacao). Ver [[permissoes-atlas]] e [[sintese-eixos-de-permissao]]. Na pratica, porem, o `syncEngine` re-gate a sessao pelo **`payload.role`** (`sync-engine.js:195`), e o gate real vive em `permission-guard.js`; antes disso o dono ja e elevado a `owner` assim que o snapshot chega, para a UI nao piscar num F5 (`sync-engine.js:177-184`).

`usersOnline` (`getRoomUsers`, `collab.rooms.js:163`) inclui **voce mesmo** e inclui quem esta `away`; cada item traz `mapId`, `cursorPosition`, `selectedFeatures`, `selectionContext`, `temporalState` e `status: 'online' | 'away'`. Nada disso e persistido: presenca viva mora em memoria no objeto `ws` (`collab.service.js:218`); `active_sessions` so registra conectar/desconectar, e visitante publico nao gera sessao (o `sub` e `public-<uuid>` e quebraria a FK, `collab.gateway.js:333`).

## Promessa de connect e maquina de estados

`connect(atlasId, {lastVersion})` (`ws-client.js:117`) resolve **no frame `connected`**, nao no `onopen` (`ws-client.js:429-432`). A maquina e `OFFLINE → CONNECTING → ONLINE → RECONNECTING` (`connection-state.js:31-36`), com transicoes ilegais lancando e sendo engolidas por `_safeTransition` (`ws-client.js:536`).

Duas armadilhas reais:

1. **A promessa de `connect()` pode nunca liquidar.** `_connectReject` e armazenado (`ws-client.js:249`) mas nunca e chamado em lugar nenhum. Se o socket fechar antes do `connected` (401/403 no upgrade), o `await wsClient.connect(...)` do `syncEngine` fica pendurado enquanto o backoff tenta de novo, sem erro para quem chamou.
2. **Fechar durante `CONNECTING` deixa o estado preso em `CONNECTING`.** `_onClose` sempre transiciona para `RECONNECTING` (com um ternario cujos dois ramos sao identicos), mas `CONNECTING → RECONNECTING` e invalido e a transicao e descartada. O estado nao vira `OFFLINE`, `isOnline()` continua falso e o flush fica travado ([[fila-operacoes-outbound]]).

## Protocolo de mensagens

Roteador do servidor em `collab.gateway.js:384`. Cliente→servidor: `ping`, `cursor`, `selection`, `temporal`, `operation`, `operations`, `sync_request`, `connection-quality`, `leave`, `briefing_edit_start/end`. Tipo desconhecido e apenas logado. No cliente, frames desconhecidos viram span `ws.inbound{dropped, unknown_type}` (`ws-client.js:369`), rede de seguranca contra divergencia de protocolo.

**Operacoes.** `operation`/`operations` exigem `permission !== 'read'`, senao o servidor devolve `error` com code `FORBIDDEN` (`collab.handlers.js:115`). As ops passam pelo mesmo `pushSchema` Joi do `POST /sync` (max. 500 ops), e o gate fino por tipo de op fica no service (`assertOperationAllowed`). O emissor recebe `ack` com `result` (ou `ack_batch` com `results[]`, um por op, na ordem enviada) no shape `{success, operationId, idempotent, currentVersion}`. Trate `idempotent: true` como sucesso no dequeue; ver [[ack-idempotencia]] e [[idempotencia-e-convergence-guard]].

O broadcast aos peers **nao e a op crua**: o servidor carimba `serverVersion` em cada op (`collab.handlers.js:146` para a unica, `:197` para o lote), que e a ordem de chegada usada pelo [[modelo-conflito-lww]]. Envelope em [[envelope-operacao]], tipos em [[tipos-entidade-sync]].

> [!CONTRADICAO 2026-07-18] guia *04-websocket-collab* (absorvido) §3.4 diz que o broadcast leva "mesma operacao recebida"; o codigo em `src/modules/collab/collab.handlers.js:146` envia `{...data.op, serverVersion}`.

**Regra de visibilidade de comentario:** ops de `entityType === 'comment'` nunca chegam a conexoes `read` (`skipReadOnly` em `collab.rooms.js:56`; lote misto e *dividido* para que o `read` ainda receba as ops nao-comentario, `broadcastOperations`, `collab.rooms.js:84`). Ver [[comentario-espacial]].

**Cursor / selection / temporal.** `cursor` e `temporal` sao livres. `selection` e **gated a editores e acima**: `read` e `comment` tem o frame descartado em silencio, sem `error` (`collab.handlers.js:83`), ou seja, comentarista e visualizador so recebem selecao alheia. O payload de selecao carrega `surface` (`2d|3d|360`) mais o escopo (`mapId`, `tilesetId`, `photoName`) e `featureMeta` opcional, para o peer renderizar o destaque na superficie certa sem lookup.

> [!CONTRADICAO 2026-07-18] guia *04-websocket-collab* (absorvido) §3 e §3.3 apresentam `selection` como broadcast incondicional e omitem `surface`; o codigo em `collab.handlers.js:83` descarta frames de `read`/`comment` e propaga `surface`/`tilesetId`/`photoName`/`featureMeta`.

**Erros do WS** sao planos: `{type:'error', code, message}`, com `FORBIDDEN`, `VALIDATION_ERROR`, `OPERATION_FAILED`, `SYNC_FAILED`, diferente do envelope REST `{error:{code,message}}` de [[erros-api]]. O cliente encaminha tudo ao handler `error` com `kind: 'server'` (`ws-client.js:363`).

## Heartbeat, reconexao e codigos de fechamento

- **Servidor:** varredura a cada `WS_HEARTBEAT_INTERVAL_MS` (default 30000): quem esta com `isAlive=false` e `terminate()` (vira `1006` → `away`), os demais tem o flag zerado e a autorizacao reconciliada (`heartbeatSweep`, `collab.gateway.js:153`). O `ping` do cliente re-arma o flag (`handlePing`, `collab.handlers.js:31`).
- **Cliente:** pinga a cada **25 s** (`DEFAULT_HEARTBEAT_MS`, `ws-client.js:31`). Se o `pong` do ciclo anterior nao chegou, fecha o proprio socket com **code 4000**, forcando reconexao em vez de conversar com link morto.
- **Reconexao:** backoff exponencial `1000 * 2^n`, teto de 30 s, **sem limite de tentativas** (`_scheduleReconnect`), so enquanto `_wantConnected` for verdadeiro. `disconnect()` envia `leave` e fecha com 1000.

> [!CONTRADICAO 2026-07-18] guia *04-websocket-collab* (absorvido) §3.1 diz "ping a cada ~30 segundos" e §7 mostra `maxReconnectAttempts = 5`; o codigo usa 25 s (`ws-client.js:31`) e reconecta indefinidamente. guia *arquitetura-sync* (absorvido) ja registra os 25 s corretamente.

| Close code | Significado | Efeito na presenca |
|---|---|---|
| `1000`/`1001`/`1005` | saida limpa, `leave`, shutdown (`closeAllSockets`, `collab.gateway.js:183`) | remocao imediata |
| `1006` | queda de rede ou `terminate()` do heartbeat | `away` + timer de graca |
| `1009` | frame acima de 10 MiB (`maxPayload`, `collab.gateway.js:29`) | remocao imediata |
| `4000` | timeout de `pong` decidido pelo cliente | remocao imediata (nao e `away`) |
| `4001` | atlas deletado (`closeRoom`, `collab.rooms.js:153`) | sala destruida, nao reconecte |
| `4003` | acesso revogado ou organizacao desativada | remocao imediata |

Por contrato, `4001` e `4003` nao devem disparar reconexao. **O cliente nao cumpre isso:** `_onClose` nao inspeciona `event.code` e agenda reconexao para qualquer fechamento. A parada so acontece pela mensagem `atlas_deleted`, que dispara `syncEngine.disconnect()` (`sync-engine.js:429`); se o close chegar sem/antes dela, ou no caso do `4003`, o cliente entra em laco de reconexao que o servidor rejeita no upgrade.

## Presenca: away vs saida

Presenca sai por `presence-bridge.js` (`:350-357` registra `connected`, `presence`, `cursor`, `selection`, `temporal`, `briefingEdit`): `cursor` (mousemove throttled ~80 ms), `selection` nas tres superficies com `surface` + escopo, `temporal` (ver [[modulo-temporal]]) e `briefing_edit_start/end` (awareness advisory, sem lock no servidor).

`onClose` (`collab.gateway.js:468`) trata **apenas o codigo `1006`** (e sem `leave` explicito) como queda de rede: marca `ws.away = true`, mantem o socket morto na sala, emite `user_away` e agenda remocao apos `WS_AWAY_GRACE_MS` (default 120000 ms, `src/config.js:89`). Qualquer outro codigo remove na hora (`user_left`). Reconectar com o **mesmo `clientId`** dentro da janela cancela o timer, expulsa o socket morto e emite `user_back` (`collab.gateway.js:307`). Por isso `disconnect()` envia `leave` antes de fechar, evitando o fantasma de 2 minutos.

Duas armadilhas reais:

1. O `user_left` so e anunciado quando **o ultimo socket daquele `userId`** sai da sala (`collab.gateway.js:453`). Sem isso, uma segunda aba ou uma reconexao com `clientId` novo derrubaria o usuario da lista dos peers, ja que `user_left` e chaveado so por `userId`.
2. Como o close `4000` do heartbeat do cliente nao e `1006`, o servidor trata como saida limpa e remove imediatamente, sem janela `away`. Ou seja, o caminho `away` na pratica e queda de rede real ou `terminate()` do heartbeat do servidor.

Detalhes em [[presenca-colaborativa]], [[presenca-colaborativa]] e [[presenca-colaborativa]].

## Backpressure

Backpressure do servidor e por socket, medido em `bufferedAmount` (`collab.rooms.js:13`): acima de 1 MiB frames coalescaveis (`cursor`/`temporal`/`selection`) sao descartados, porque o proximo frame os supera; acima de 8 MiB o socket e `terminate()`, de proposito, para que reconecte e recupere via `sync_request`. Op duravel **nunca** e descartada em silencio, pois isso divergiria o peer. O cliente aplica a mesma logica na saida em `_sendRaw` (`PRESENCE_BUFFER_LIMIT` = 1 MiB, `ws-client.js:37`), poupando ops e frames de controle.

## Ops de entrada: cursor de versao, eco e serializacao

`_applyInboundOps` (`ws-client.js:375`) faz tres coisas por operacao, nessa ordem:

1. **Avanca `_lastVersion`** com `op.serverVersion` quando maior. O `server_version` vem de uma **sequencia global compartilhada entre atlas**, portanto e monotonico mas **nao contiguo por atlas**: buraco na numeracao e op de outro atlas, nao perda. Tratar nao-contiguidade como gap ja causou tempestade de `sync_request`.
2. **Descarta o proprio eco** quando `op.clientId === this._clientId`. E obrigatorio porque o autor empurrou por HTTP e o broadcast da sala nao tem socket dele para excluir; sem `clientId` o autor reaplica cada op que publicou. Span `ws.self-echo`.
3. **Serializa os applies** numa cadeia de promessas `_applyChain`. O handler faz read-modify-write assincrono da entrada do mapa no IndexedDB; aplicar em paralelo faz escritas concorrentes se sobrescreverem.

Lembrando [[sintese-nao-e-crdt]]: a ordem que decide e a de chegada no servidor.

## Pull e recuperacao apos reconexao

Nao ha replay de mensagens perdidas por cliente. A recuperacao e `sync_request { lastVersion }` → `sync_response` com `ops` incrementais, ou `isSnapshot: true` com o snapshot completo quando `lastVersion == 0` ou o cliente esta abaixo do `min_version` (`collab.handlers.js:257`). O cliente dispara isso automaticamente ao receber `connected` vindo do estado `RECONNECTING`. Ver [[snapshot-e-pull-incremental]].

## Sinais fora do log de operacoes

Escritas REST que nao passam pelo log de operacoes sao anunciadas pelo canal, para o cliente reagir sem polling. O `switch` de `_onMessage` (`ws-client.js:282`) roteia para handlers dedicados no `syncEngine`:

| Frame | Origem no backend | Efeito no cliente |
|---|---|---|
| `atlas_deleted` | `atlas.controller.js:29` (fecha a sala, `4001`) | `disconnect()` + `ATLAS_DELETED_REMOTE` (`sync-engine.js:429`) |
| `atlas_owner_changed` | `atlas.controller.js:81` | novo dono vira `owner`, ex-dono cai para `manager` (`sync-engine.js:441-457`) |
| `sharing_updated` | `sharing.controller.js:14,20,32,50,65` (`public_enabled`, `public_disabled`, `user_added`, `user_updated`, `user_removed`) | so o usuario afetado reage, admin global e ignorado, aplica `msg.role` sem reconectar — [[compartilhamento-atlas]] |
| `atlas_settings_updated` | rota de settings do atlas | reaplica o overlay de config por atlas — [[atlas-settings]], [[config-dinamico]] |
| `atlas_updated` (`atlas.controller.js:23`), `map_duplicated` (`:71`), `maps_merged` (`maps.controller.js:20`) | | **re-pull de snapshot completo** via `serverResync` + `LAYERS_CHANGED` |

O grupo `serverResync` existe porque renomear atlas, duplicar e mesclar mapa **criam dados fora do log de operacoes**: os peers nunca receberiam essas entidades como ops, e antes desse ramo os frames caiam no `default` e sumiam. Ver [[api-rest-atlas]] e [[clone-atlas]].

Dois gates defensivos: tanto `syncResponse` (`sync-engine.js:407-412`) quanto `atlasSettings` (`:476-483`) **descartam frames tardios quando `connectionState.isOnline()` e falso**, para nao persistir dados remotos num store em teardown (logout/troca de atlas) nem recapturar a config restaurada como novo baseline. Ver [[dominio-local-vs-remoto]] e [[sessao-boot-e-ciclo-de-vida]].

## Qualidade adaptativa: contrato existe, cliente nao usa

`connection-quality { rttMs }` classifica a banda (`collab.quality.js:12`: `excellent` <100, `good` <300, `poor` <800, `critical` >=800) e o servidor responde `adaptive-settings` **apenas na transicao de banda** (`collab.handlers.js:219`), com `batchIntervalMs`, `geometryPrecision` e `viewportOnly`. `rttMs` nao-finito ou negativo e ignorado sem resposta.

> [!CONTRADICAO 2026-07-18] guia *04-websocket-collab* (absorvido) §3.8 e o checklist descrevem o cliente reportando `connection-quality` e aplicando `adaptive-settings`; no repositorio nao existe **nenhum envio de `connection-quality`** nem **handler para `adaptiveSettings`** (so as linhas do proprio `ws-client.js:99` e `:341`). O ramo e morto no frontend hoje.

Se for implementar: `geometryPrecision` e sugestao de **transporte**, nunca trunque coordenada antes de persistir; o Postgres guarda geometria em precisao cheia (`truncateCoords` e utilitario de saida, deliberadamente sem call site). Ver [[qualidade-conexao-adaptativa]].

## Limites conhecidos

- **Sala e por [[atlas-modelo-de-dados]], nao por mapa.** Todo cursor/selecao/op e broadcast a todos conectados ao atlas; filtrar por `mapId` (e por `surface`) e responsabilidade do frontend. Sub-canais por mapa nao existem.
- **Estado efemero e single-instance.** Salas, presenca, timers de `away` e o mapa `rooms` vivem na memoria de um processo (`collab.rooms.js:6`). Escalar horizontalmente exige sticky session ou pub/sub, nao implementado. Ver [[deploy-backend]].
- **Sem buffer de mensagens** para cliente desconectado: a recuperacao e sempre por `sync_request`.
- Lock de **mapa** e imposto pelo servidor (mutacao de filho vira 409, flip de `locked` e delete exigem `owner`); lock de camada, grupo e feicao e advisory e depende do cliente. Ver [[modelo-conflito-lww]] e [[sintese-limites-collab]].


## Tabela completa de tipos de mensagem

## Tabela completa de tipos de mensagem

Inventário do protocolo (C = cliente→servidor, S = servidor→cliente). O roteador de entrada está em `collab.gateway.js:384`; tipo desconhecido é apenas logado, sem `error` de volta.

| Tipo | Direção | Resposta / efeito |
|---|---|---|
| `ping` | C→S | `pong`; re-arma o flag `isAlive` do heartbeat |
| `cursor` | C→S | broadcast `cursor` aos peers (emissor excluído) |
| `selection` | C→S | broadcast `selection` aos peers — **gated**: `read`/`comment` são descartados em silêncio |
| `temporal` | C→S | broadcast `temporal` aos peers (presença temporal) |
| `operation` | C→S | `ack` ao emissor + broadcast `operation` (com `serverVersion` carimbado) aos peers |
| `operations` | C→S | `ack_batch` ao emissor + broadcast `operations` aos peers |
| `sync_request` | C→S | `sync_response` (snapshot ou ops incrementais) |
| `connection-quality` | C→S | `adaptive-settings` **só na mudança de banda** |
| `leave` | C→S | servidor fecha o socket com `1000` → `user_left` imediato (sem janela `away`) |
| `briefing_edit_start` / `briefing_edit_end` | C→S | broadcast `briefing_edit_started` / `briefing_edit_ended` |
| `connected` | S→C | enviado **uma única vez** no handshake |
| `pong` | S→C | resposta ao `ping` |
| `ack` / `ack_batch` | S→C | confirmação de operação(ões) com `result` / `results[]` |
| `user_joined` / `user_left` / `user_away` / `user_back` | S→C | eventos de presença |
| `atlas_updated` / `atlas_deleted` / `atlas_settings_updated` / `atlas_owner_changed` / `sharing_updated` / `maps_merged` / `map_duplicated` | S→C | mutações REST propagadas à sala |
| `adaptive-settings` | S→C | settings de transporte recomendados (unicast, só ao socket que reportou) |
| `error` | S→C | erro de processamento, envelope plano `{type, code, message}` |

### Payload dos frames de mutação REST

Os nomes de campo variam por frame e não são deriváveis do nome do tipo:

```javascript
{ "type": "atlas_updated",           "data": { /* atlas atualizado */ } }
{ "type": "atlas_deleted",           "atlasId": "atlas-uuid" }
{ "type": "atlas_settings_updated",  "settings": { /* settings do atlas */ } }
{ "type": "map_duplicated",          "mapId": "novo-map-uuid" }
{ "type": "maps_merged",             "destMapId": "map-uuid", "sourceMapIds": ["map-uuid", "..."] }
{ "type": "sharing_updated",         "action": "user_added", "userId": "...", "permission": "write" }
// action ∈ public_enabled | public_disabled | user_added | user_updated | user_removed
```

O push de operações por REST (`POST /sync`) também gera broadcast de `operations` à sala, no mesmo shape do frame WS. Como o emissor HTTP **não tem socket para ser excluído**, ele recebe o próprio eco e precisa filtrar por `op.clientId`.


## Checklist de integração do canal

## Checklist de integração do canal

Para quem for escrever um cliente novo contra o canal. Os itens marcados com ⚠ divergem do que o EBGeo Web faz hoje — leia a nota indicada antes de copiar.

- [ ] `clientId` estável persistido em `localStorage` (formato `^[a-zA-Z0-9_-]{8,64}$`) e enviado na query — ver [[client-id-estavel]]
- [ ] Tratar `400` / `401` / `403` do upgrade (não abrem socket: o cliente vê só um `close`)
- [ ] Heartbeat: `ping` periódico e medição de RTT no `pong` (o cliente EBGeo pinga a 25 s, não 30 s)
- [ ] Consumir `connected` e guardar `sessionId`, `permission` **e** `role`
- [ ] Renderizar `usersOnline` com `status` (`online` vs `away`), filtrando a própria entrada pelo `userId` do `connected`
- [ ] ⚠ Verificar `permission !== 'read'` antes de enviar operações (o cliente real gateia por `role` — ver [[permissoes-atlas]])
- [ ] Enviar/receber `cursor` e `selection` filtrando por `mapId` (e por `surface` no caso de seleção)
- [ ] Enviar operações (single/batch) e processar `ack` / `ack_batch` pelo `result` / `results[]`
- [ ] Tratar `idempotent: true` como sucesso no dequeue da fila offline — ver [[ack-idempotencia]]
- [ ] Descartar operações remotas cujo `clientId` seja o seu (eco do broadcast REST)
- [ ] Presença: `user_joined` / `user_left` / `user_away` / `user_back`, lembrando que `away` ≠ remoção
- [ ] Enviar `{type:'leave'}` na saída intencional (evita 2 min de fantasma na lista dos peers)
- [ ] ⚠ Reportar `connection-quality` e aplicar `adaptive-settings`, sem truncar geometria antes de persistir (ramo morto no frontend hoje — ver [[qualidade-conexao-adaptativa]])
- [ ] Reagir às mutações REST broadcast (`atlas_updated`, `atlas_settings_updated`, `sharing_updated`, `maps_merged`, `map_duplicated`, `atlas_owner_changed`)
- [ ] ⚠ Tratar `atlas_deleted` + close `4001` como "não reconectar" (o `ws-client` real não inspeciona `event.code`)
- [ ] Awareness de briefing (`briefing_edit_started` / `briefing_edit_ended`), lembrando que é advisory, não lock
- [ ] Reconexão com backoff exponencial + `sync_request` para recuperar o intervalo perdido
- [ ] Tratar `error` plano (`FORBIDDEN`, `VALIDATION_ERROR`, `OPERATION_FAILED`, `SYNC_FAILED`)

## Fontes
- guia *04-websocket-collab* (absorvido): contrato do canal, tabela de tipos de mensagem, codigos 400/401/403, semantica away vs saida, bandas de qualidade adaptativa, checklist de integracao e limites de escala.
- guia *arquitetura-sync* (absorvido) §4.2 e §5: montagem da URL por `wsUrl()`, roteamento do `_onMessage`, heartbeat de 25 s, reconciliacao com close 4003, backoff 1s→30s, self-echo do autor.
- guia *03-sync-inicial* (absorvido) e guia *05-sync-crdt* (absorvido): semantica de `sync_request`/`sync_response` e o modelo de conflito referenciado pelos acks.
- `ebgeo_backend/src/modules/collab/collab.gateway.js`: upgrade, `resolvePermission`, reconciliacao por heartbeat (4003), roteador, timers de `away`, regra do ultimo socket para `user_left`.
- `ebgeo_backend/src/modules/collab/collab.handlers.js`: gates de `operation`/`selection`, carimbo de `serverVersion`, ack/ack_batch, sync_request, qualidade adaptativa.
- `ebgeo_backend/src/modules/collab/collab.rooms.js`: fan-out, backpressure (1 MiB/8 MiB), visibilidade de comentario, `getRoomUsers`, `closeRoom` 4001.
- `ebgeo_backend/src/modules/collab/collab.quality.js` e `src/config.js`: bandas de RTT, defaults `WS_HEARTBEAT_INTERVAL_MS` e `WS_AWAY_GRACE_MS`.
- `ebgeo_backend/src/modules/{atlas,maps,sharing}/*.controller.js`: frames de mutacao REST broadcast, incluindo `atlas_owner_changed`.
- `ebgeo_web/src/js/store/sync/ws-client.js`: heartbeat/backoff, backpressure local, dedupe de eco, serializacao de applies, roteamento de frames (fonte da verdade sobre as contradicoes marcadas).
- `ebgeo_web/src/js/store/sync/sync-engine.js`, `connection-state.js`, `api-client.js`: fiacao dos handlers, gates de frame tardio, `connect`/`connectPublic`, transicoes validas, construcao da URL.
- `ebgeo_web/src/js/presence/presence-bridge.js`: quais frames de presenca o app realmente envia e assina.
