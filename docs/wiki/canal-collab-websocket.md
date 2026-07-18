# Canal /api/v1/collab (WebSocket)

Por que o canal existe apesar de as operacoes saírem por HTTP, o que nele é contrato congelado, e onde o cliente diverge do que o servidor promete.

## O transporte é assimétrico, e isso é deliberado

Ops **saem** por `POST /atlas/:id/sync` ([[fila-operacoes-outbound]]) e **entram** pelo WebSocket. O canal tem `sendOperation`/`sendOperations` (`frontend/src/js/store/sync/ws-client.js:161`, `:170`), mas **nenhum call site na aplicacao**: o app só emite presença, briefing, `sync_request`, `ping` e `leave`. A saída ficou no HTTP porque o dequeue da fila precisa de uma resposta correlacionada e retentável; um `ack` assíncrono por socket obrigaria a manter a correlação à mão e a decidir o que fazer com ops em voo durante uma reconexão.

Consequência que morde: o `ack`/`ack_batch` do WS é **observabilidade, não fluxo de controle**. O `_emit('ack', ...)` (`frontend/src/js/store/sync/ws-client.js:298`, `:311`) **não tem handler registrado por ninguém**; o dequeue confiável usa o ack da resposta HTTP, e os frames só alimentam spans `push.ack` do [[syncledger]]. Não escreva lógica de fila pendurada no `ack` do socket.

Corolário do broadcast: como o autor empurrou por HTTP, a sala **não tem socket dele para excluir**. Ele recebe o próprio eco e precisa filtrar por `op.clientId` (`frontend/src/js/store/sync/ws-client.js:397`). Sem `clientId` no singleton, o autor reaplica cada op que publicou, e foi exatamente esse o bug que motivou o comentário em `frontend/src/js/store/sync/ws-client.js:568-572`. Ver [[client-id-estavel]] e [[aplicacao-operacoes-remotas]].

## Handshake: rejeição invisível e permissão que envelhece

Rejeição no upgrade (`400` sem `atlasId`/`token`, `401` JWT inválido, `403` org desativada ou sem leitura) acontece **antes de o socket abrir**: o cliente não recebe status HTTP, só um `close`. Qualquer diagnóstico por código HTTP no frontend é impossível por construção. `resolvePermission` está em `backend/src/modules/collab/collab.gateway.js:52`; ver [[permissoes-atlas]], [[autenticacao-jwt]] e [[link-publico]].

O `clientId` **não é credencial**, é chave de presença, continuidade e dedupe de eco. Malformado ou ausente, o servidor gera um `crypto.randomUUID()` (`backend/src/modules/collab/collab.gateway.js:230`, `:303`) e você perde silenciosamente a janela `away` e a dedupe: o socket funciona, o comportamento degrada sem erro.

**Armadilha de sessão longa:** a permissão é cacheada no objeto `ws` no handshake, mas um socket vive horas. Por isso ela é re-reconciliada contra o banco a cada batida de heartbeat (`reconcileAuthorization`, `backend/src/modules/collab/collab.gateway.js:118`, chamada de `heartbeatSweep` em `:160`). Revogação fecha com `4003`; rebaixamento write→read apenas abaixa `ws.permission` e a próxima escrita é recusada. **A janela de staleness é de um intervalo de heartbeat (~30 s)**, e não há como encurtá-la sem mudar o intervalo.

## Os dois eixos de permissão, e o gate que o cliente realmente usa

O frame `connected` traz `permission` (por-atlas: `owner|manage|write|comment|read`, o campo **congelado**) e `role` (vocabulário de UI derivado por `toFrontendRole`, que **colapsa informação**). O contrato manda decidir escrita por `permission !== 'read'`.

Na prática o `syncEngine` re-gateia a sessão pelo **`payload.role`** (`frontend/src/js/store/sync/sync-engine.js:192-198`), e o gate real vive em `frontend/src/js/store/sync/permission-guard.js`. Antes disso o dono já é elevado a `owner` assim que o snapshot chega (`frontend/src/js/store/sync/sync-engine.js:177-184`), só para a UI não piscar num F5. Divergência conhecida entre contrato e cliente: ver [[sintese-eixos-de-permissao]].

`usersOnline` inclui **você mesmo** e inclui quem está `away` (`getRoomUsers`, `backend/src/modules/collab/collab.rooms.js:163`). Nada de presença é persistido: vive em memória no objeto `ws`; visitante público sequer gera sessão, porque seu `sub` é `public-<uuid>` e quebraria a FK de `active_sessions` (`backend/src/modules/collab/collab.gateway.js:333`).

## Máquina de estados: duas armadilhas reais

1. **A promessa de `connect()` pode nunca liquidar.** `_connectReject` é armazenado (`frontend/src/js/store/sync/ws-client.js:249`) e **nunca chamado em lugar nenhum**. Se o socket fechar antes do frame `connected` (401/403 no upgrade), o `await wsClient.connect(...)` do `syncEngine` fica pendurado para sempre enquanto o backoff tenta de novo, sem erro para quem chamou.
2. **Fechar durante `CONNECTING` prende o estado.** `_onClose` sempre transiciona para `RECONNECTING` (`frontend/src/js/store/sync/ws-client.js:447-449`, com um ternário cujos dois ramos são idênticos), mas `CONNECTING → RECONNECTING` é inválido (`frontend/src/js/store/sync/connection-state.js:33`) e a transição é engolida por `_safeTransition`. O estado não vira `OFFLINE`, `isOnline()` continua falso e o flush fica travado ([[fila-operacoes-outbound]]).

## Close codes: contrato de reconexão que o cliente não cumpre

Por contrato, `4001` (atlas deletado, `closeRoom`, `backend/src/modules/collab/collab.rooms.js:153`) e `4003` (acesso revogado) **não devem disparar reconexão**. **O cliente não cumpre isso:** `_onClose` não inspeciona `event.code` e agenda reconexão para qualquer fechamento, com backoff exponencial **sem limite de tentativas**. A parada só acontece pela mensagem `atlas_deleted`, que dispara `syncEngine.disconnect()` (`frontend/src/js/store/sync/sync-engine.js:429`). Se o close chegar sem ela ou antes dela, e sempre no caso do `4003`, o cliente entra em laço de reconexão que o servidor rejeita no upgrade.

> **Nota histórica.** guia *04-websocket-collab* (absorvido) §3.1 diz "ping a cada ~30 segundos" e §7 mostra `maxReconnectAttempts = 5`; o código usa 25 s (`frontend/src/js/store/sync/ws-client.js:31`) e reconecta indefinidamente.

## away vs saída: só `1006` ganha graça

`onClose` (`backend/src/modules/collab/collab.gateway.js:468`) trata **apenas o código `1006`** (e sem `leave` explícito) como queda de rede: marca `away`, mantém o socket morto na sala e agenda remoção após `WS_AWAY_GRACE_MS` (default 120 s). Reconectar com o **mesmo `clientId`** dentro da janela cancela o timer e emite `user_back`. Por isso `disconnect()` envia `leave` antes de fechar: sem ele, o usuário vira fantasma por 2 minutos na lista dos peers.

Duas consequências não óbvias:

1. `user_left` só é anunciado quando **o último socket daquele `userId`** sai (`backend/src/modules/collab/collab.gateway.js:453`). Sem essa guarda, uma segunda aba ou uma reconexão com `clientId` novo derrubaria o usuário da lista dos peers, já que `user_left` é chaveado só por `userId`.
2. O close `4000` do heartbeat do cliente **não é `1006`**, então o servidor o trata como saída limpa e remove na hora, sem janela `away`. Na prática o caminho `away` é queda de rede real ou `terminate()` do heartbeat do servidor. Ver [[presenca-colaborativa]].

## `serverVersion` é global, não contíguo por atlas

O broadcast **não é a op crua**: o servidor carimba `serverVersion` (`backend/src/modules/collab/collab.handlers.js:146` e `:197`), que é a ordem de chegada usada pelo [[modelo-conflito-lww]]. Mas o `server_version` vem de uma **sequência global compartilhada entre atlas**: buraco na numeração é op de outro atlas, **não perda**. Tratar não-contiguidade como gap já causou tempestade de `sync_request` (`frontend/src/js/store/sync/ws-client.js:386-390`). Perda genuína só ocorre atravessando desconexão, e se recupera pelo `sync_request` do reconnect ([[snapshot-e-pull-incremental]]). Lembrando [[sintese-nao-e-crdt]]: quem decide é a ordem de chegada no servidor.

Os applies inbound são **serializados numa cadeia de promessas** (`frontend/src/js/store/sync/ws-client.js:409`) porque o handler faz read-modify-write assíncrono da entrada do mapa no IndexedDB; aplicar em paralelo faz escritas concorrentes se sobrescreverem e perde todas menos uma.

> **Nota histórica.** guia *04-websocket-collab* (absorvido) §3.4 diz que o broadcast leva "mesma operacao recebida"; o código em `backend/src/modules/collab/collab.handlers.js:146` envia `{...data.op, serverVersion}`.

## Gates de visibilidade que o nome do frame não denuncia

- **Comentário nunca chega a conexão `read`** (`skipReadOnly`, `backend/src/modules/collab/collab.rooms.js:56`). Lote misto é *dividido*, para que o `read` ainda receba as ops não-comentário (`broadcastOperations`, `backend/src/modules/collab/collab.rooms.js:84`). Ver [[comentario-espacial]].
- **`selection` é gated a editores e acima**: `read` e `comment` têm o frame **descartado em silêncio, sem `error`** (`backend/src/modules/collab/collab.handlers.js:83`). `cursor` e `temporal` são livres. Comentarista e visualizador só recebem seleção alheia.
- Erros do WS são planos (`{type, code, message}`), diferente do envelope REST `{error:{code,message}}` de [[erros-api]].

> **Nota histórica.** guia *04-websocket-collab* (absorvido) §3 e §3.3 apresentam `selection` como broadcast incondicional e omitem `surface`; o código em `backend/src/modules/collab/collab.handlers.js:83` descarta frames de `read`/`comment` e propaga `surface`/`tilesetId`/`photoName`/`featureMeta`.

## Backpressure: op durável nunca é descartada

Medido por socket em `bufferedAmount` (`backend/src/modules/collab/collab.rooms.js:13`): acima de 1 MiB frames coalescáveis (`cursor`/`temporal`/`selection`) são descartados, porque o próximo frame os supera e o drop se auto-cura. Acima de 8 MiB o socket é `terminate()` **de propósito**, para que reconecte e recupere via `sync_request`. Op durável nunca é descartada em silêncio: isso divergiria o peer permanentemente, enquanto matar o socket é recuperável. O cliente replica a mesma política na saída (`_sendRaw`, `frontend/src/js/store/sync/ws-client.js:524`).

## Sinais fora do log de operações

Renomear atlas, duplicar e mesclar mapa **criam dados fora do log de operações**: os peers nunca receberiam essas entidades como ops. Por isso `atlas_updated`, `map_duplicated` e `maps_merged` disparam **re-pull de snapshot completo** (`serverResync`, `frontend/src/js/store/sync/ws-client.js:352-359`); antes desse ramo os frames caíam no `default` e sumiam. Ver [[api-rest-atlas]] e [[clone-atlas]]. Já `sharing_updated` e `atlas_owner_changed` reajustam o papel local **sem reconectar** (`frontend/src/js/store/sync/sync-engine.js:441`, `:465`); ver [[compartilhamento-atlas]].

Dois gates defensivos: `syncResponse` (`frontend/src/js/store/sync/sync-engine.js:412`) e `atlasSettings` (`:481`) **descartam frames tardios quando `connectionState.isOnline()` é falso**, para não persistir dados remotos num store em teardown (logout/troca de atlas) nem recapturar a config restaurada como novo baseline. Ver [[dominio-local-vs-remoto]], [[sessao-boot-e-ciclo-de-vida]], [[atlas-settings]] e [[config-dinamico]].

## Qualidade adaptativa: contrato existe, cliente não usa

O servidor classifica banda de RTT e responde `adaptive-settings` **apenas na transição de banda** (`backend/src/modules/collab/collab.handlers.js:219`).

> **Nota histórica.** guia *04-websocket-collab* (absorvido) §3.8 e o checklist descrevem o cliente reportando `connection-quality` e aplicando `adaptive-settings`; no repositório **não existe nenhum envio de `connection-quality`** nem handler para `adaptiveSettings` (só as linhas do próprio `frontend/src/js/store/sync/ws-client.js:99` e `:341`). O ramo é morto no frontend hoje.

Se for implementar: `geometryPrecision` é sugestão de **transporte**, nunca trunque coordenada antes de persistir. O Postgres guarda geometria em precisão cheia (`truncateCoords` é utilitário de saída, deliberadamente sem call site). Ver [[qualidade-conexao-adaptativa]].

## Limites conhecidos

- **Sala é por [[atlas-modelo-de-dados]], não por mapa.** Todo cursor/seleção/op vai a todos conectados ao atlas; filtrar por `mapId` e por `surface` é responsabilidade do frontend. Sub-canais por mapa não existem.
- **Estado efêmero é single-instance.** Salas, presença e timers de `away` vivem na memória de um processo (`backend/src/modules/collab/collab.rooms.js:6`). Escalar horizontalmente exige sticky session ou pub/sub, não implementado. Ver [[deploy-backend]].
- **Sem buffer de mensagens** para cliente desconectado: a recuperação é sempre por `sync_request`.
- Lock de **mapa** é imposto pelo servidor; lock de camada, grupo e feição é advisory e depende do cliente. Ver [[sintese-limites-collab]].
- Ao escrever um cliente novo: trate `idempotent: true` como sucesso no dequeue ([[ack-idempotencia]], [[idempotencia-e-convergence-guard]]); envelope e tipos em [[envelope-operacao]] e [[tipos-entidade-sync]]; o token é o mesmo JWT do REST ([[jwt-emissor-unico]]), exceto o `publicToken` efêmero de [[link-publico]], que desabilita o logging de operações para não orfanizar a fila (`frontend/src/js/store/sync/sync-engine.js:227`). Presença temporal em [[modulo-temporal]]. Divisão REST/WS em [[sintese-rest-vs-websocket]].

## Fontes
- guia *04-websocket-collab* (absorvido): contrato do canal, semântica away vs saída, bandas de qualidade adaptativa e limites de escala (fonte das contradições marcadas).
- guia *arquitetura-sync* (absorvido) §4.2 e §5; guias *03-sync-inicial* e *05-sync-crdt* (absorvidos).
- `ebgeo_backend/src/modules/collab/{collab.gateway,collab.handlers,collab.rooms,collab.quality}.js` e `backend/src/config.js`.
- `ebgeo_backend/src/modules/{atlas,maps,sharing}/*.controller.js`: frames de mutação REST broadcast.
- `ebgeo_web/src/js/store/sync/{ws-client,sync-engine,connection-state,api-client}.js` (fonte da verdade sobre as divergências cliente/contrato).
- `ebgeo_web/src/js/presence/presence-bridge.js`: quais frames de presença o app realmente envia e assina.
