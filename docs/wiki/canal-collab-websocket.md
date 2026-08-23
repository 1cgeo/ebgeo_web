# Canal /api/v1/collab (WebSocket)

Por que o canal existe apesar de as operacoes saírem por HTTP, o que nele é contrato congelado, e onde o cliente diverge do que o servidor promete.

## O transporte é assimétrico, e isso é deliberado

Ops **saem** por `POST /atlas/:id/sync` ([[fila-operacoes-outbound]]) e **entram** pelo WebSocket. O canal tem `sendOperation`/`sendOperations` (`frontend/src/js/store/sync/ws-client.js`), mas **nenhum call site na aplicacao**: o app só emite presença, briefing, `sync_request`, `ping` e `leave`. A saída ficou no HTTP porque o dequeue da fila precisa de uma resposta correlacionada e retentável; um `ack` assíncrono por socket obrigaria a manter a correlação à mão e a decidir o que fazer com ops em voo durante uma reconexão.

Consequência que morde: o `ack`/`ack_batch` do WS é **observabilidade, não fluxo de controle**. O `_emit('ack', ...)` (`frontend/src/js/store/sync/ws-client.js`) **não tem handler registrado por ninguém**; o dequeue confiável usa o ack da resposta HTTP, e os frames só alimentam spans `push.ack` do [[syncledger]]. Não escreva lógica de fila pendurada no `ack` do socket.

Corolário do broadcast: como o autor empurrou por HTTP, a sala **não tem socket dele para excluir**. Ele recebe o próprio eco e precisa filtrar por `op.clientId` (`frontend/src/js/store/sync/ws-client.js`). Sem `clientId` no singleton, o autor reaplica cada op que publicou, e foi exatamente esse o bug que motivou o comentário em `frontend/src/js/store/sync/ws-client.js`. Ver [[client-id-estavel]] e [[aplicacao-operacoes-remotas]].

## Handshake: rejeição invisível e permissão que envelhece

Rejeição no upgrade (`400` sem `atlasId`/`token`, `401` JWT inválido, `403` org desativada ou sem leitura) acontece **antes de o socket abrir**: o cliente não recebe status HTTP, só um `close`. Qualquer diagnóstico por código HTTP no frontend é impossível por construção. `resolvePermission` está em `backend/src/modules/collab/collab.gateway.js`; ver [[permissoes-atlas]], [[autenticacao-jwt]] e [[link-publico]].

O `clientId` **não é credencial**, é chave de presença e continuidade. Malformado ou ausente, o servidor gera um `crypto.randomUUID()` (validação no upgrade em `backend/src/modules/collab/collab.gateway.js`, geração em `onConnection`) e você perde silenciosamente a janela `away` e o `user_back`: o socket funciona, a presença degrada sem erro.

**O que esse defeito NÃO explica é a dedupe de eco**, e a página afirmou o contrário até 2026-07-25. O descarte do próprio eco compara `op.clientId === this._clientId` (`frontend/src/js/store/sync/ws-client.js`), dois valores do lado do cliente que nunca passam pelo query param; o UUID gerado no servidor substitui só a chave de sala e presença e **nunca volta ao cliente**. Quando a dedupe quebra, a causa é `_clientId` nulo no singleton (`frontend/src/js/store/sync/ws-client.js`), não o handshake. Mandar quem depura "estou reaplicando minhas próprias ops" olhar o upgrade do WS custa a sessão inteira. Ver [[client-id-estavel]].

**Armadilha de sessão longa:** a permissão é cacheada no objeto `ws` no handshake, mas um socket vive horas. Por isso ela é re-reconciliada contra o banco a cada batida de heartbeat (`reconcileAuthorization`, `backend/src/modules/collab/collab.gateway.js`, chamada de dentro de `heartbeatSweep`). Revogação fecha com `4003`; rebaixamento write→read apenas abaixa `ws.permission` e a próxima escrita é recusada. **A janela de staleness é de um intervalo de heartbeat (~30 s)**, e não há como encurtá-la sem mudar o intervalo.

Duas correções de 2026-07-25 é que fazem esse "~30 s" ser verdade, e as duas atacavam o mesmo furo: uma reconciliação que não reconcilia. (a) `heartbeatSweep` disparava `reconcileAuthorization` **sem `await`**, então N sockets viravam N queries simultâneas contra um pool de dez e um sweep ainda drenando quando o próximo começava empurrava a revogação para duas batidas (~60 s); hoje o sweep é assíncrono e escoa por um pool limitado. (b) O `catch` de `reconcileAuthorization` só **logava**, e enquanto a checagem falhasse o socket seguia com a permissão que o handshake resolveu, por tempo indefinido. Agora as falhas **consecutivas** são contadas e a terceira fecha com `4003`. A assimetria é deliberada: um soluço transitório de banco não pode virar logout coletivo (o sweep toca todos os sockets de uma vez), mas a incapacidade sustentada de verificar autorização não é permissão concedida. Regressão em `backend/tests/ws/collab-authz-reconcile-failure.test.js`.

## Os dois eixos de permissão, e o gate que o cliente realmente usa

O frame `connected` traz `permission` (por-atlas: `owner|manage|write|comment|read`, o campo **congelado**) e `role` (vocabulário de UI derivado por `toFrontendRole`, que **colapsa informação**). O gate autoritativo de escrita é `assertOperationAllowed` (`backend/src/modules/sync/sync.service.js`): `read` não escreve nada, `comment` escreve **só** `target: 'comment'`, e `write`/`manage`/`owner` escrevem tudo, com excluir mapa reservado a `manage` e acima e travar mapa reservado ao `owner` (`operationDenialReason`).

**Esta linha prescrevia `permission !== 'read'`,** e isso era exato até `1d23ac9` (2026-07-19), o commit que trouxe o nível `comment` para o servidor. Depois dele a prescrição virou a lista fechada que a constituição proíbe, e o custo é assimétrico: os handlers do WS continuam checando só `ws.permission === 'read'` (`handleOperation`/`handleOperations`, `backend/src/modules/collab/collab.handlers.js`), então o Comentarista atravessa o gate raso e só é barrado lá dentro, por um `throw` que **aborta o lote inteiro** (contraste com a recusa por-op, em [[sintese-limites-collab]] §6).

Na prática o `syncEngine` re-gateia a sessão pelo **`payload.role`** (`frontend/src/js/store/sync/sync-engine.js`), e o gate real vive em `frontend/src/js/store/sync/permission-guard.js`. Antes disso o dono já é elevado a `owner` assim que o snapshot chega (`frontend/src/js/store/sync/sync-engine.js`), só para a UI não piscar num F5. Divergência conhecida entre contrato e cliente: ver [[sintese-eixos-de-permissao]].

`usersOnline` inclui **você mesmo** e inclui quem está `away` (`getRoomUsers`, `backend/src/modules/collab/collab.rooms.js`). Nada de presença é persistido: vive em memória no objeto `ws`. **Desde 2026-07-25 isso vale sem exceção**: nenhum socket, autenticado ou público, escreve no banco por causa de presença. Até então o handshake gravava uma linha por conexão em `active_sessions` e pulava o visitante público, cujo `sub` é `public-<uuid>` e quebraria a FK para `users`; os dois escritores foram removidos porque a tabela nunca teve um `SELECT` em `backend/src`, e aquela FK era o último papel que ela cumpria. Em 2026-08-23 a própria tabela saiu do schema. Ver [[presenca-colaborativa]] §"O que não existe".

## Máquina de estados: a armadilha que sobrou

O handshake que nunca liquidava já foi corrigido: uma rejeição no upgrade fecha o socket **sem** frame `connected`, e por isso `_onClose` liquida a promessa pendente (`frontend/src/js/store/sync/ws-client.js`) em vez de deixar o `await syncEngine.connect(...)` pendurado sem timeout. O laço de reconexão fica de pé de propósito: `_open()` reinstala um par resolve/reject novo, e `_scheduleReconnect` engole a rejeição, de modo que uma queda depois de sessão estabelecida ainda reconecta.

O que **permanece**: fechar durante `CONNECTING` prende o estado. `_onClose` sempre transiciona para `RECONNECTING` (com um ternário cujos dois ramos são idênticos), mas `CONNECTING → RECONNECTING` não está em `VALID_TRANSITIONS` (`frontend/src/js/store/sync/connection-state.js`) e a transição é engolida por `_safeTransition`. O estado não vira `OFFLINE`, `isOnline()` continua falso e o flush fica travado ([[fila-operacoes-outbound]]).

## Close codes: contrato de reconexão que o cliente não cumpre

Por contrato, `4001` (atlas deletado, `closeRoom`, `backend/src/modules/collab/collab.rooms.js`) e `4003` (acesso revogado) **não devem disparar reconexão**. **O cliente não cumpre isso:** `_onClose` não decide nada por `event.code` (ele só o reporta no evento de erro) e agenda reconexão para qualquer fechamento, com backoff exponencial **sem limite de tentativas**. A parada só acontece pela mensagem `atlas_deleted`, que dispara `syncEngine.disconnect()`. Se o close chegar sem ela ou antes dela, e sempre no caso do `4003`, o cliente entra em laço de reconexão que o servidor rejeita no upgrade.

## away vs saída: só `1006` ganha graça

`onClose` (`backend/src/modules/collab/collab.gateway.js`) trata **apenas o código `1006`** (e sem `leave` explícito) como queda de rede: marca `away`, mantém o socket morto na sala e agenda remoção após `WS_AWAY_GRACE_MS` (default 120 s). Reconectar com o **mesmo `clientId`** dentro da janela cancela o timer e emite `user_back`. Por isso `disconnect()` envia `leave` antes de fechar: sem ele, o usuário vira fantasma por 2 minutos na lista dos peers.

Duas consequências não óbvias:

1. `user_left` só é anunciado quando **o último socket daquele par `(userId, clientId)`** sai (`removeConnection`, em `backend/src/modules/collab/collab.gateway.js`). A guarda comparava só `userId` até `a358a6e` (2026-07-24), e a troca não é cosmética: como o roster do par é chaveado por cliente e `user_left` apaga UMA chave, guardar por usuário fazia a primeira de duas abas sair sem anunciar nada e ficar no roster alheio para sempre. Remover a guarda também não serve, porque a reconexão reusa o **mesmo** `clientId` ([[client-id-estavel]]) e o close atrasado do socket velho apagaria a presença recém-criada. Sem `clientId` nos dois lados, cai no comportamento antigo, por usuário.

   **O `userId` voltou à comparação em 2026-07-25, agora somado ao `clientId` em vez de substituí-lo**, porque comparar só o `clientId` errava no sentido oposto: ele identifica um perfil de navegador, não uma pessoa, então DUAS CONTAS na mesma máquina compartilham o valor e o socket vivo da segunda calava o `user_left` da primeira. É o mesmo par que passou a chavear o slot `away` ([[presenca-colaborativa]]); regressão em `backend/tests/ws/collab-away-slot-identity.repro.test.js`.

   O efeito colateral que ninguém procura, e que **permanece** para o MESMO usuário: o socket em `away` continua na sala (o caminho de queda não chama `leaveRoom`) e a guarda de sobrevivente não filtra socket já fechado. Como duas abas do mesmo navegador compartilham o `clientId`, uma aba fantasma pendente faz a outra, fechando **limpamente**, não anunciar `user_left` nenhum: os pares seguem exibindo o usuário até o timer de graça vencer, até 120 s depois. Auto-cura, mas o sintoma ("fechou direito e continua na lista por dois minutos") é depurado como bug de presença no cliente, longe da causa.
2. O close `4000` do heartbeat do cliente **não é `1006`**, então o servidor o trata como saída limpa e remove na hora, sem janela `away`. Na prática o caminho `away` é queda de rede real ou `terminate()` do heartbeat do servidor. Ver [[presenca-colaborativa]].

## `serverVersion` é global, não contíguo por atlas

O broadcast **não é a op crua**: o servidor carimba `serverVersion` (`handleOperation` para op única e `handleOperations` para lote, `backend/src/modules/collab/collab.handlers.js`), que é a ordem de chegada usada pelo [[modelo-conflito-lww]]. Mas o `server_version` vem de uma **sequência global compartilhada entre atlas**: buraco na numeração é op de outro atlas, **não perda**. Tratar não-contiguidade como gap já causou tempestade de `sync_request` (`frontend/src/js/store/sync/ws-client.js`). Perda genuína só ocorre atravessando desconexão, e se recupera pelo `sync_request` do reconnect ([[snapshot-e-pull-incremental]]). Lembrando [[modelo-conflito-lww]]: quem decide é a ordem de chegada no servidor.

Os applies inbound são **serializados numa cadeia de promessas** (`frontend/src/js/store/sync/ws-client.js`) porque o handler faz read-modify-write assíncrono da entrada do mapa no IndexedDB; aplicar em paralelo faz escritas concorrentes se sobrescreverem e perde todas menos uma.

## Gates de visibilidade que o nome do frame não denuncia

- **Comentário nunca chega a conexão `read`** (`skipReadOnly`, `backend/src/modules/collab/collab.rooms.js`). Lote misto é *dividido*, para que o `read` ainda receba as ops não-comentário (`broadcastOperations`, `backend/src/modules/collab/collab.rooms.js`). Ver [[comentario-espacial]].
- **`selection` é gated a editores e acima**: `read` e `comment` têm o frame **descartado em silêncio, sem `error`** (`backend/src/modules/collab/collab.handlers.js`). `cursor` e `temporal` são livres. Comentarista e visualizador só recebem seleção alheia.
- Erros do WS são planos (`{type, code, message}`), diferente do envelope REST `{error:{code,message}}` de [[erros-api]].

## Backpressure: op durável nunca é descartada

Medido por socket em `bufferedAmount` (`backend/src/modules/collab/collab.rooms.js`): acima de 1 MiB frames coalescáveis (`cursor`/`temporal`/`selection`) são descartados, porque o próximo frame os supera e o drop se auto-cura. Acima de 8 MiB o socket é `terminate()` **de propósito**, para que reconecte e recupere via `sync_request`. Op durável nunca é descartada em silêncio: isso divergiria o peer permanentemente, enquanto matar o socket é recuperável. O cliente replica a mesma política na saída (`_sendRaw`, `frontend/src/js/store/sync/ws-client.js`).

## Sinais fora do log de operações

Renomear atlas, duplicar e mesclar mapa **criam dados fora do log de operações**: os peers nunca receberiam essas entidades como ops. Por isso `atlas_updated`, `map_duplicated` e `maps_merged` disparam **re-pull de snapshot completo** (`serverResync`, `frontend/src/js/store/sync/ws-client.js`); antes desse ramo os frames caíam no `default` e sumiam. Ver [[api-rest-atlas]] e [[clone-atlas]]. Já `sharing_updated` e `atlas_owner_changed` reajustam o papel local **sem reconectar** (`frontend/src/js/store/sync/sync-engine.js`); ver [[compartilhamento-atlas]].

Dois gates defensivos: `syncResponse` (`frontend/src/js/store/sync/sync-engine.js`) e `atlasSettings` **descartam frames tardios quando `connectionState.isOnline()` é falso**, para não persistir dados remotos num store em teardown (logout/troca de atlas) nem recapturar a config restaurada como novo baseline. Ver [[dominio-local-vs-remoto]], [[sessao-boot-e-ciclo-de-vida]], [[atlas-settings]] e [[config-dinamico]].

## Qualidade adaptativa: contrato existe, cliente não usa

O servidor classifica banda de RTT e responde `adaptive-settings` **apenas na transição de banda** (`handleConnectionQuality`, `backend/src/modules/collab/collab.handlers.js`). O ramo é **morto no frontend**: não existe envio de `connection-quality` nem handler para `adaptiveSettings` fora das próprias linhas de `frontend/src/js/store/sync/ws-client.js`. Contrato publicado sem consumidor.

Se for implementar: `geometryPrecision` é sugestão de **transporte**, nunca trunque coordenada antes de persistir. O Postgres guarda geometria em precisão cheia (`truncateCoords` é utilitário de saída, deliberadamente sem call site). Ver [[qualidade-conexao-adaptativa]].

## Limites conhecidos

- **Sala é por [[atlas-modelo-de-dados]], não por mapa.** Todo cursor/seleção/op vai a todos conectados ao atlas; filtrar por `mapId` e por `surface` é responsabilidade do frontend. Sub-canais por mapa não existem.
- **Estado efêmero é single-instance.** Salas, presença e timers de `away` vivem na memória de um processo (`backend/src/modules/collab/collab.rooms.js`). Escalar horizontalmente exige sticky session ou pub/sub, não implementado. Ver [[deploy-backend]].
- **Sem buffer de mensagens** para cliente desconectado: a recuperação é sempre por `sync_request`.
- Lock de **mapa** é imposto pelo servidor; lock de camada, grupo e feição é advisory e depende do cliente. Ver [[sintese-limites-collab]].
- Ao escrever um cliente novo: trate `idempotent: true` como sucesso no dequeue ([[ack-idempotencia]], [[idempotencia-e-convergence-guard]]); envelope e tipos em [[envelope-operacao]] e [[tipos-entidade-sync]]; o token é o mesmo JWT do REST ([[jwt-emissor-unico]]), exceto o `publicToken` efêmero de [[link-publico]], que desabilita o logging de operações para não orfanizar a fila (`frontend/src/js/store/sync/sync-engine.js`). Presença temporal em [[modulo-temporal]]. Divisão REST/WS em [[sintese-rest-vs-websocket]].

Quais frames de presença o app **realmente** envia e assina se lê em `frontend/src/js/presence/presence-bridge.js`, que costuma ser menos do que o servidor aceita.
