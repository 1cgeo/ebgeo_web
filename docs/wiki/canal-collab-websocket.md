# Canal /api/v1/collab (WebSocket)

Canal WebSocket por atlas que entrega colaboração em tempo real, presença viva, ack de operações e broadcast de mutações REST, com autorização resolvida no handshake por JWT.

## Handshake e autorização

URL: `ws(s)://host/api/v1/collab?atlasId=<uuid>&token=<jwt>&clientId=<id>`. O gateway serve **apenas** esse path; upgrade em qualquer outro caminho recebe `404` e o socket é destruído (`collab.gateway.js:217`).

Ordem de rejeição no upgrade, antes de o socket abrir:

| HTTP | Causa | Código |
|---|---|---|
| `400` | falta `atlasId` ou `token` | `collab.gateway.js:232` |
| `401` | JWT inválido/expirado, ou algoritmo fora do allowlist (`alg:none` cai aqui) | `collab.gateway.js:241` |
| `403` | organização desativada, OU token válido sem permissão de leitura no atlas | `collab.gateway.js:252` e `:260` |

A permissão vem de `resolvePermission()` (`collab.gateway.js:52`), nesta ordem: token público (só vale para o atlas emissor e se o atlas ainda for `is_public`) → `role` global `admin` recebe `owner` → dono do atlas → linha em `atlas_shares` → `is_public` = `read`. Ver [[permissoes-atlas]], [[autenticacao-jwt]] e [[link-publico]].

O `token` é a credencial; o `clientId` **não é**. Ele é só chave estável de presença e continuidade, validado por `^[a-zA-Z0-9_-]{8,64}$` (`collab.gateway.js:20`); ausente ou malformado, o servidor gera um `crypto.randomUUID()` e você perde continuidade entre reconexões. No frontend a URL é montada em `api-client.js:935` (`wsUrl()`), com o `clientId` estável de `getClientId()` (`ws-client.js`, singleton no fim do arquivo). Detalhe em [[client-id-estavel]].

**Armadilha de autorização de longa duração:** a permissão é cacheada no objeto `ws` no handshake, mas **re-reconciliada a cada batida do heartbeat** (`reconcileAuthorization`, `collab.gateway.js:118`, chamada de `heartbeatSweep` em `:160`). Share revogado, atlas despublicado ou organização desativada fecham o socket com **`4003`**; um rebaixamento (write→read) apenas abaixa `ws.permission`, e a próxima escrita é recusada. A janela de staleness é de um intervalo de heartbeat (~30 s).

## Frame `connected` e os dois eixos de permissão

Enviado uma única vez (`collab.gateway.js:345`) com `sessionId` (= `clientId` efetivo), `userId`, `permission`, `role` e `usersOnline`.

- `permission` é o eixo **por-atlas** e é o campo congelado: `owner | manage | write | comment | read`.
- `role` é vocabulário de UI derivado por `toFrontendRole(permission, roleGlobal)`: `owner | admin | manager | editor | commenter | viewer`.

Para decidir se pode escrever, cheque `permission !== 'read'`, nunca `role` (o `role` colapsa informação). Ver [[permissao-vs-papel]] e [[sintese-eixos-de-permissao]].

`usersOnline` (`getRoomUsers`, `collab.rooms.js:163`) inclui **você mesmo** e inclui quem está `away`; cada item traz `mapId`, `cursorPosition`, `selectedFeatures`, `selectionContext`, `temporalState` e `status: 'online' | 'away'`. Nada disso é persistido: presença viva mora em memória no objeto `ws` (`collab.service.js:218`); `active_sessions` só registra conectar/desconectar, e visitante público não gera sessão (o `sub` é `public-<uuid>` e quebraria a FK, `collab.gateway.js:333`).

## Protocolo de mensagens

Roteador em `collab.gateway.js:384`. Cliente→servidor: `ping`, `cursor`, `selection`, `temporal`, `operation`, `operations`, `sync_request`, `connection-quality`, `leave`, `briefing_edit_start/end`. Tipo desconhecido é apenas logado.

**Operações.** `operation`/`operations` exigem `permission !== 'read'`, senão o servidor devolve `error` com code `FORBIDDEN` (`collab.handlers.js:115`). As ops passam pelo mesmo `pushSchema` Joi do `POST /sync` (máx. 500 ops), e o gate fino por tipo de op fica no service (`assertOperationAllowed`). O emissor recebe `ack` com `result` (ou `ack_batch` com `results[]`, um por op, na ordem enviada) no shape `{success, operationId, idempotent, currentVersion}`. Trate `idempotent: true` como sucesso no dequeue da [[fila-operacoes-outbound]]; ver [[ack-idempotencia]] e [[idempotencia-e-convergence-guard]].

O broadcast aos peers **não é a op crua**: o servidor carimba `serverVersion` em cada op (`collab.handlers.js:146` para a única, `:197` para o lote), que é a ordem de chegada usada pelo [[modelo-conflito-lww]]. O cliente usa esse campo para avançar o cursor de replay (`ws-client.js`, `_applyInboundOps`).

> [!CONTRADICAO 2026-07-18] `docs/guias/04-websocket-collab.md` §3.4 diz que o broadcast leva "mesma operação recebida"; o código em `src/modules/collab/collab.handlers.js:146` envia `{...data.op, serverVersion}`, com o `serverVersion` de chegada acrescentado.

**Regra de visibilidade de comentário:** ops de `entityType === 'comment'` nunca chegam a conexões `read` (`skipReadOnly` em `collab.rooms.js:56`; lote misto é *dividido* para que o `read` ainda receba as ops não-comentário, `broadcastOperations`, `collab.rooms.js:84`). Ver [[comentario-espacial]].

**Cursor / selection / temporal.** `cursor` e `temporal` são livres. `selection` é **gated a editores e acima**: `read` e `comment` têm o frame descartado em silêncio, sem `error` (`collab.handlers.js:83`), ou seja, comentarista e visualizador só recebem seleção alheia. O payload de seleção carrega `surface` (`2d|3d|360`) mais o escopo (`mapId`, `tilesetId`, `photoName`) e `featureMeta` opcional, para o peer renderizar o destaque na superfície certa sem lookup (`collab.handlers.js:87` e `ws-client.js` `sendSelection`).

> [!CONTRADICAO 2026-07-18] `docs/guias/04-websocket-collab.md` §3 e §3.3 apresentam `selection` como broadcast incondicional aos peers e omitem o campo `surface`; o código em `src/modules/collab/collab.handlers.js:83` descarta silenciosamente frames de quem tem `permission` `read` ou `comment`, e propaga `surface`/`tilesetId`/`photoName`/`featureMeta`.

**Erros do WS** são planos: `{type:'error', code, message}`, com `FORBIDDEN`, `VALIDATION_ERROR`, `OPERATION_FAILED`, `SYNC_FAILED`. Isso difere do envelope REST `{error:{code,message}}` de [[erros-api]].

## Presença: away vs saída

`onClose` (`collab.gateway.js:468`) trata **apenas o código `1006`** (e sem `leave` explícito) como queda de rede: marca `ws.away = true`, mantém o socket morto na sala, emite `user_away` e agenda remoção após `WS_AWAY_GRACE_MS` (default 120000 ms, `src/config.js:89`). Qualquer outro código remove na hora (`user_left`). Reconectar com o **mesmo `clientId`** dentro da janela cancela o timer, expulsa o socket morto e emite `user_back` (`collab.gateway.js:307`).

Duas armadilhas reais:

1. O `user_left` só é anunciado quando **o último socket daquele `userId`** sai da sala (`collab.gateway.js:453`). Sem isso, uma segunda aba ou uma reconexão com `clientId` novo derrubaria o usuário da lista dos peers, já que `user_left` é chaveado só por `userId`.
2. O heartbeat do próprio cliente fecha o socket com **código `4000`** ao não receber `pong` (`ws-client.js`, `_startHeartbeat`). Como `4000 !== 1006`, o servidor trata como saída limpa e remove imediatamente, sem janela `away`. Idem para `disconnect()`, que envia `leave` e fecha com `1000`. Ou seja, o caminho `away` na prática é queda de rede real ou `terminate()` do heartbeat do servidor.

Detalhes em [[presenca-away-vs-saida]], [[presenca-tempo-real]] e [[presenca-colaborativa]].

## Heartbeat, backpressure e códigos de fechamento

O servidor varre todos os sockets a cada `WS_HEARTBEAT_INTERVAL_MS` (default 30000): quem está com `isAlive=false` é `terminate()` (vira `1006` → `away`), os demais têm o flag zerado e a autorização reconciliada (`heartbeatSweep`, `collab.gateway.js:153`). O `ping` do cliente re-arma o flag (`handlePing`, `collab.handlers.js:31`). O cliente web pinga a cada **25 s** (`DEFAULT_HEARTBEAT_MS` em `ws-client.js:30`), não 30 s.

Backpressure é por socket, medido em `bufferedAmount` (`collab.rooms.js:13`): acima de 1 MiB frames coalescáveis (`cursor`/`temporal`/`selection`) são descartados, porque o próximo frame os supera; acima de 8 MiB o socket é `terminate()`, de propósito, para que ele reconecte e recupere via `sync_request`. Op durável **nunca** é descartada em silêncio, pois isso divergiria o peer. O cliente aplica a mesma lógica na saída (`PRESENCE_BUFFER_LIMIT`, `ws-client.js:37`). O frame máximo aceito é 10 MiB (`maxPayload`, `collab.gateway.js:29`); acima disso o `ws` fecha com `1009`.

| Close code | Significado | Efeito na presença |
|---|---|---|
| `1000`/`1001`/`1005` | saída limpa, `leave`, shutdown (`closeAllSockets`, `collab.gateway.js:183`) | remoção imediata |
| `1006` | queda de rede ou `terminate()` do heartbeat | `away` + timer de graça |
| `1009` | frame acima de 10 MiB | remoção imediata |
| `4000` | timeout de `pong` decidido pelo cliente | remoção imediata (não é `away`) |
| `4001` | atlas deletado (`closeRoom`, `collab.rooms.js:153`) | sala destruída, não reconecte |
| `4003` | acesso revogado ou organização desativada | remoção imediata |

`4001` e `4003` não devem disparar reconexão à mesma sala.

## Pull e recuperação após reconexão

Não há replay de mensagens perdidas por cliente. O caminho de recuperação é `sync_request { lastVersion }` → `sync_response` com `ops` incrementais, ou `isSnapshot: true` com o snapshot completo quando `lastVersion == 0` ou o cliente está abaixo do `min_version` (`collab.handlers.js:257`). O cliente dispara isso automaticamente ao receber `connected` vindo do estado `RECONNECTING` (`ws-client.js`, `_onConnected`). Ver [[snapshot-e-pull-incremental]] e [[aplicacao-operacoes-remotas]].

Cuidado com o `serverVersion`: ele vem de uma sequência **global** compartilhada entre atlas, então é monotônico mas **não contíguo por atlas**. Buraco na numeração é op de outro atlas, não perda. Tratar não-contiguidade como gap gerava tempestade de `sync_request` (comentário em `ws-client.js`, `_applyInboundOps`). Aplicação de ops remotas é **serializada** numa promise chain, porque o handler faz read-modify-write assíncrono da entrada do mapa no IndexedDB e aplicações concorrentes se sobrescrevem.

Ops empurradas por HTTP (`POST /sync`) também são broadcast à sala, e nesse caso o emissor não tem socket a excluir. O cliente filtra o próprio eco por `op.clientId === this._clientId` (`ws-client.js`, `_applyInboundOps`); sem o `clientId` no singleton, o autor reaplica cada op que ele mesmo publicou. Ver [[sintese-rest-vs-websocket]] e [[envelope-operacao]].

## Mutações REST propagadas à sala

Escritas REST que não passam pelo log de operações são anunciadas pelo canal, para o cliente reagir sem polling:

| Frame | Origem |
|---|---|
| `atlas_updated` | `atlas.controller.js:23` |
| `atlas_deleted` | `atlas.controller.js:29` (fecha a sala, `4001`) |
| `map_duplicated` | `atlas.controller.js:71` |
| `atlas_owner_changed` | `atlas.controller.js:81` |
| `maps_merged` | `maps.controller.js:20` |
| `sharing_updated` | `sharing.controller.js:14,20,32,50,65` (`public_enabled`, `public_disabled`, `user_added`, `user_updated`, `user_removed`) |
| `atlas_settings_updated` | rota de settings do atlas, ver [[atlas-settings]] |

No cliente, `atlas_updated`, `map_duplicated` e `maps_merged` **não** são aplicados campo a campo: emitem `serverResync` para forçar re-pull de snapshot, justamente porque essas entidades nunca chegam como ops (`ws-client.js`, case `'atlas_updated'`). Ver [[api-rest-atlas]], [[compartilhamento-atlas]] e [[clone-atlas]].

Nota: o guia lista as mutações REST mas omite `atlas_owner_changed`, que existe no backend (`atlas.controller.js:81`) e é tratado no cliente.

## Qualidade adaptativa

`connection-quality { rttMs }` classifica a banda (`collab.quality.js:12`: `excellent` <100, `good` <300, `poor` <800, `critical` ≥800) e o servidor responde `adaptive-settings` **apenas na transição de banda** (`collab.handlers.js:219`), com `batchIntervalMs`, `geometryPrecision` e `viewportOnly`. `rttMs` não-finito ou negativo é ignorado sem resposta. `geometryPrecision` é sugestão de **transporte**: nunca trunque antes de persistir, o Postgres guarda geometria em precisão cheia (`truncateCoords` é utilitário de saída, deliberadamente sem call site). Detalhe em [[qualidade-conexao-adaptativa]].

Estado atual do frontend: o `WsClient` recebe e reemite `adaptive-settings`, mas **nunca envia** `connection-quality` (nenhum call site em `src/js`), logo a banda nunca muda no servidor e o frame não chega na prática. É um gancho pronto, não um caminho vivo.

## Limites conhecidos

- **Sala é por atlas, não por mapa.** Todo cursor/seleção/op é broadcast a todos conectados ao atlas; filtrar por `mapId` (e por `surface`) é responsabilidade do frontend. Sub-canais por mapa não existem.
- **Estado efêmero é single-instance.** Salas, presença, timers de `away` e o mapa `rooms` vivem na memória de um processo (`collab.rooms.js:6`). Escalar horizontalmente exige sticky session ou pub/sub, que não está implementado. Ver [[deploy-backend]].
- **Sem buffer de mensagens** para cliente desconectado: a recuperação é sempre por `sync_request`.
- Lock de **mapa** é imposto pelo servidor (mutação de filho vira 409, flip de `locked` e delete exigem `owner`); lock de camada, grupo e feição é advisory e depende do cliente. Ver [[sync-lww-operacoes]] e [[sintese-limites-collab]].

Conceitos vizinhos: [[websocket-collab]], [[sessao-boot-e-ciclo-de-vida]], [[store-origin-local-remoto]], [[syncledger]], [[sintese-nao-e-crdt]].

## Fontes
- `docs/guias/04-websocket-collab.md`: contrato do canal, tabela de tipos de mensagem, semântica away vs saída, bandas de qualidade adaptativa, checklist de integração e limites de escala.
- `ebgeo_backend/src/modules/collab/collab.gateway.js`: upgrade, resolução de permissão, re-reconciliação por heartbeat (4003), roteador de mensagens, timers de `away`, regra do último socket para `user_left`.
- `ebgeo_backend/src/modules/collab/collab.handlers.js`: gates de `operation`/`selection`, carimbo de `serverVersion` no broadcast, ack/ack_batch, sync_request, qualidade adaptativa.
- `ebgeo_backend/src/modules/collab/collab.rooms.js`: fan-out, backpressure (1 MiB/8 MiB), regra de visibilidade de comentário, `getRoomUsers` (status online/away), `closeRoom` 4001.
- `ebgeo_backend/src/modules/collab/collab.quality.js` e `src/config.js`: bandas de RTT, settings recomendados, defaults `WS_HEARTBEAT_INTERVAL_MS` e `WS_AWAY_GRACE_MS`.
- `ebgeo_backend/src/modules/{atlas,maps,sharing}/*.controller.js`: frames de mutação REST broadcast, incluindo `atlas_owner_changed`.
- `ebgeo_web/src/js/store/sync/ws-client.js` e `api-client.js`: montagem da URL, heartbeat de 25 s com close 4000, backpressure local, filtro de eco por `clientId`, serialização de apply, `serverResync`.
