# Presença Colaborativa

Camada efêmera em memória que propaga roster, cursores, seleções (2D/3D/360), cursor temporal e awareness de briefing entre pares de uma sala de atlas. Esta página cobre só o que não se lê no código: as convenções que o próprio JSDoc descreve errado, as armadilhas que atravessam cliente e servidor, e os limites operacionais.

Mapa dos arquivos: `src/js/presence/` (bridge, store, overlays, cores) e `backend/src/modules/collab/`. Os cabeçalhos JSDoc de `frontend/src/js/presence/presence-bridge.js` e `frontend/src/js/presence/presence-store.js` já listam frames inbound/outbound e eventos emitidos; não repetimos aqui.

## Por que presença é requisito, não enfeite

O modelo é **sem locks**: edição simultânea livre, conflito resolvido por [[modelo-conflito-lww]]. Sem presença, dois usuários mexem na mesma feição às cegas e o LWW vira perda de trabalho inexplicada. Presença é o que substitui o lock: o usuário evita a colisão porque **vê** o outro chegando. Por isso o indicador de briefing é advisory e nunca virou lock, e por isso derrubar presença por economia de tráfego é uma decisão de produto, não de infra.

Nada dela passa pela fila de operações, pelo IndexedDB ou pelo Postgres. Não vira linha em [[tabela-operations]], não entra na [[fila-operacoes-outbound]], não participa do LWW. Não confunda com [[envelope-operacao]] (persistido, idempotente) nem com [[comentario-espacial]] (entidade sincronizada de verdade). Só existe em atlas remoto conectado ([[atlas-modelo-de-dados]]); no modo local/anônimo o bridge fica montado e inerte ([[dominio-local-vs-remoto]], [[modos-operacao]]).

**Descartável por construção, e isso é deliberado.** `broadcastCursor` faz `if (!wsClient.isConnected()) return;` (`frontend/src/js/presence/presence-bridge.js:141`) e nunca enfileira: misturar presença com a fila offline faria o usuário reviver cursores de dez minutos atrás no reconnect. No servidor, `cursor`/`selection`/`temporal` estão em `COALESCABLE_TYPES` e são **descartados** quando `bufferedAmount` passa do teto de drop, enquanto o mesmo laço termina (`terminate()`) o socket afogado por operações duráveis para forçar reconnect e replay (`broadcastToRoom`, `backend/src/modules/collab/collab.rooms.js`). Perder um cursor é invisível; perder uma operação é divergência.

## O invariante: TODO frame de presença carrega `clientId`

`resolveKey()` prefere `clientId` e cai para `userId` (`frontend/src/js/presence/presence-store.js:48-64`), então **quem decide a chave é o frame, não o store**. É por isso que carimbar o `clientId` no emissor não é preferência de estilo: é o que impede que a mesma pessoa exista sob duas chaves. Os dois grupos precisam carregá-lo, e hoje carregam:

- **Roster:** snapshot `connected` (`getRoomUsers`, `backend/src/modules/collab/collab.rooms.js`) e os frames `user_joined` / `user_left` / `user_away` / `user_back` (`backend/src/modules/collab/collab.service.js`). No `user_joined` o `clientId` precisa estar **aninhado** dentro de `user`, porque o bridge desembrulha `msg.user`.
- **Awareness:** `cursor`, `temporal` e `selection` (`handleCursor`, `handleTemporal` e `handleSelection` em `backend/src/modules/collab/collab.handlers.js`).

**O que acontece quando um dos dois grupos esquece.** `setCursor`/`setSelection` **criam** a entrada quando a chave não existe (`?? normalizeUser(msg)`, `frontend/src/js/presence/presence-store.js:256`, `:284`), então o mesmo par vira **duas entradas**: uma com nome e sem cursor (chaveada pelo `clientId`, vinda do roster) e outra sem nome e com cursor (chaveada pelo `userId`, vinda do primeiro movimento de mouse). O contador do roster mostra 2 para um par (`getOthers` não deduplica, `frontend/src/js/presence/online-users.control.js:232`) e o rótulo do cursor remoto cai para o UUID cru.

Isto não é hipotético: **aconteceu duas vezes, nas duas metades opostas.** Até `a358a6e` (2026-07-24), `user_away`/`user_back` eram os únicos a carregar `clientId`, o roster inteiro ficava sob `userId`, `_setAway` não achava a chave e retornava sem efeito, então o badge `ausente` nunca aparecia. Aquela correção uniformizou o roster e **não** os frames de awareness, e a assimetria migrou de lado, produzindo a entrada dupla acima. Fechado em 2026-07-25, com regressão em `backend/tests/ws/collab-awareness-clientid.repro.test.js`, cujo último caso afirma diretamente que a chave do roster e a do awareness são a MESMA, para que corrigir um caminho e esquecer o outro reprove.

A lição, que sobreviveu às duas: **uniformize a chave no emissor**, porque o consumidor não tem como reconciliar duas identidades depois. O store não pode se defender sozinho: um frame sem `clientId` é genuinamente inatribuível a uma aba, e casar por `userId` grudaria o cursor de uma aba na outra.

E repare por que a suíte não pegou nenhuma das duas vezes: `presence-store.test.js` injetava `clientId` dentro do payload de `setCursor`, um campo que o backend não emitia. A fixture era mais generosa que o formato de fio, então cada lado passava sozinho e o par estava quebrado. É o ponto cego que a auditoria de testes de backend de 2026-07 nomeou como o quinto: a fronteira entre os dois pacotes afirmada em comentário, testada de cada lado e nunca exercitada em par.

O que a divisão de chave **não** quebrava, e é útil saber por quê:

- **A cor continua estável.** `getPresenceColor` é hash djb2 sobre paleta fixa de 14 slots (`frontend/src/js/presence/presence-colors.js:44-52`), e as três superfícies alimentam o hash com `userId` primeiro (`frontend/src/js/presence/online-users.control.js:269`, `frontend/src/js/presence/remote-selections.layer.js:187`) ou com a chave da própria entrada de cursor, que já é o `userId` (`frontend/src/js/presence/remote-cursors.layer.js:210`). Avatar, cursor e caixa de seleção do mesmo par batem entre superfícies e entre máquinas sem coordenação com o servidor. Passar a chavear a cor por `clientId` trocaria a cor da pessoa no meio da sessão.
- **A exclusão do self continua correta**, porque é feita pelos **dois** ids: o roster exclui por `sessionContext.userId` (`frontend/src/js/presence/online-users.control.js:226-232`) e o overlay de cursor por ambos, com o motivo escrito no código (`frontend/src/js/presence/remote-cursors.layer.js:120-124`). Trocar para só `clientId` faz o usuário ver o próprio cursor.

Duas abas do mesmo navegador **compartilham o `clientId`** (ele vem do `localStorage`, ver [[client-id-estavel]]), então continuam colapsando numa entrada. Do lado do servidor são sockets distintos, e a guarda de `user_left` compara o PAR `(userId, clientId)` (`backend/src/modules/collab/collab.gateway.js`, em `removeConnection`); ver [[canal-collab-websocket]] para os dois sentidos em que essa escolha importa. Até 2026-07-25 ela comparava só o `clientId`, e a diferença aparece exatamente onde o `clientId` deixa de identificar uma pessoa: duas CONTAS no mesmo perfil de navegador mandam o mesmo valor, e o socket vivo da segunda calava o `user_left` da primeira, que ficava no roster alheio para sempre.

Não acredite no JSDoc de `frontend/src/js/presence/presence-store.js:11-13` ("keyed by clientId … a single user may have several browser tabs / clients"): nenhuma das duas metades vale, pelos dois motivos acima.

## Contrato congelado: `mapId` de presença é NOME de mapa

Não há sub-canal por mapa no servidor; toda mensagem vai para a sala inteira e **filtrar é do cliente**. O bridge carimba `getCurrentMapNameSync()` na saída (`frontend/src/js/presence/presence-bridge.js:144,157,196`) e os overlays resolvem o mapa ativo com a mesma função. As duas pontas precisam usar a mesma. Se alguém "corrigir" um lado para UUID, o filtro nunca casa e **nenhum cursor remoto renderiza, sem erro no console**. Contexto do dualismo nome/UUID em [[dominio-local-vs-remoto]].

> **Nota histórica.** As guias 04-websocket-collab §3.2 e 06-presenca-imagens §1.1 documentam `mapId` como UUID (`"mapId": "map-uuid"`). O backend trata o campo como opaco (só reencaminha), então funciona; o contrato real é "chave de mapa acordada entre clientes".

Corolário: `getCursors()` sem argumento devolve cursores de **todos** os mapas, por isso o overlay recusa renderizar quando o mapa ativo é `null` (`frontend/src/js/presence/remote-cursors.layer.js:124-129`).

Mapa ativo pega carona no cursor porque o backend **não tem handler `map_active`**: uma troca de mapa manda um cursor sem posição carregando só o novo `mapId` (`frontend/src/js/presence/presence-bridge.js:153-158`). Quem for adicionar um sinal de "mapa atual" precisa saber que já existe esse canal implícito.

## Seleção: a única presença com gate de papel

Cursor e temporal são ungated de propósito (decisão de produto anotada no cabeçalho de `handleCursor`, `backend/src/modules/collab/collab.handlers.js`). Seleção é editor-gated **dos dois lados**: cliente (`canBroadcastSelection`, `frontend/src/js/presence/presence-bridge.js`) e servidor (`handleSelection`, `backend/src/modules/collab/collab.handlers.js`). O cliente evita tráfego inútil; o servidor é a autoridade, para cliente adulterado não furar o gate. Comentarista e Visualizador recebem seleções mas nunca transmitem. Ver [[permissoes-atlas]] e [[sintese-capacidades-por-papel]]. Como o gate mapeia para a capacidade EDIT, é permissivo no store local e restritivo só em atlas remoto conectado.

**Não replique este gate de presença como gate de escrita.** Esta linha mandava conferir `permission !== 'read'` para autorizar escrita, o que era exato até `1d23ac9` (2026-07-19) e deixou de ser quando o nível `comment` chegou ao servidor: escrita é decidida por `assertOperationAllowed` (`backend/src/modules/sync/sync.service.js`), onde o Comentarista só pode escrever `target: 'comment'`. Presença e escrita têm gates com formatos diferentes de propósito, e o de escrita é hierárquico. Detalhe e consequência em [[canal-collab-websocket]].

Detalhes que evitam bug:

- O escopo por superfície (`mapId`/`tilesetId`/`photoName`) não é decoração: sem ele a seleção dentro de um modelo 3D vazaria para outro modelo ([[catalogo-3d]], [[streetview-360]]).
- **A geometria nunca trafega.** O overlay resolve os ids na fonte **local** e reconstrói a caixa com o mesmo `createSelectionBox` do highlight local. Só funciona porque o atlas é compartilhado; um par que ainda não recebeu a operação de criação não desenha nada.
- **O "acompanha o arraste" não vem de presença.** A caixa segue porque o overlay re-renderiza em `LAYERS_CHANGED`, ou seja, quando a **operação** de movimento do par altera a geometria local. Presença mostra *quem*; [[envelope-operacao]] traz o *quê*. Arraste travado é suspeita de fluxo de operações, não de presença.
- `featureMeta` viaja junto porque os ids sozinhos não carregam o tipo de ferramenta, e o peer precisa montar o destaque sem consultar o store.
- O rótulo temporal ([[modulo-temporal]]) vai **já formatado** (`"D+3"`) porque o peer não tem a config temporal do emissor; o store guarda blob opaco. `TEMPORAL_CURSOR_CHANGED` dispara por rAF, então coalescer na saída é obrigatório, não otimização.

## Away vs saída: a graça depende de um id que pode ser gerado em silêncio

O discriminador é o close code, com override: `code === 1006 && ws.intentionalLeave !== true` (`onClose`, `backend/src/modules/collab/collab.gateway.js`). O `intentionalLeave` existe porque um `leave` pode ser seguido de um `1006` real (o cliente derruba o socket antes do close frame chegar): **a intenção declarada vence o código de fechamento**.

No caminho away, `onClose` **mantém o socket morto dentro da sala** (não chama `leaveRoom`), e é isso que faz o usuário continuar aparecendo com `status: 'away'`. O timer de remoção vive em `awayTimers`, chaveado por `` `${atlasId}::${userId}::${clientId}` `` (`backend/src/modules/collab/collab.gateway.js`, função `awayKey`). Na volta, `onConnection` cancela o timer e faz `leaveRoom` do socket morto **antes** de tudo; sem isso a sala teria os dois e a presença duplicaria.

**O `userId` entrou na chave em 2026-07-25**, e a razão é a mesma que faz o `clientId` ser insuficiente na guarda de `user_left`: ele identifica um perfil de navegador, não uma pessoa. Chaveado só por `` `${atlasId}::${clientId}` ``, o slot suspenso do primeiro usuário era **herdado** pelo segundo que abrisse socket no mesmo perfil dentro da graça. O socket novo cancelava a remoção do primeiro, tirava o socket morto dele da sala sem anunciar `user_left` (então nada mais anunciaria: o timer já não existia) e emitia `user_back` com o id de quem nunca esteve ausente. Hoje o slot pertence ao par `(userId, clientId)`; quando outro usuário toma o `clientId`, o slot antigo é **encerrado na hora**, com o `user_left` que os pares esperam. Regressão em `backend/tests/ws/collab-away-slot-identity.repro.test.js`.

**Por isso o `clientId` estável é obrigatório aqui.** O servidor gera `crypto.randomUUID()` quando o `clientId` falta ou é malformado: a conexão funciona e a continuidade de presença morre **em silêncio**, no pior formato possível (o fantasma away fica os 2 minutos *e* o socket novo entra como segunda sessão). Detalhes do id em [[client-id-estavel]], mesmo id que serve à [[ack-idempotencia]].

Duas consequências não óbvias do heartbeat: como ele derruba com `terminate()` (que produz 1006), heartbeat gera **away, não left**: uma aba em background com timer estrangulado entra em away a cada ciclo. E o mesmo tick re-reconcilia a autorização contra o banco, então um downgrade de compartilhamento tem staleness limitado a um heartbeat ([[compartilhamento-atlas]]). Esta linha registrava como pendência que a **remoção total** de um membro conectado não o desconectava, e isso nunca foi verdade nesta árvore: `reconcileAuthorization` já fechava com `4003` o socket cuja permissão resolve para nada quando a página foi escrita (`backend/src/modules/collab/collab.gateway.js`, presente desde `e30622c`). Como `4003` é close limpo, o par some na hora, sem passar pela graça `away`. Em atlas público a resolução cai para `read` e o socket é apenas rebaixado.

Voltar da graça restaura a **presença, não os dados**: não há replay de frames perdidos nem de operações. O cliente precisa mandar `sync_request` com o `lastVersion` e reenviar a fila offline ([[snapshot-e-pull-incremental]], [[idempotencia-e-convergence-guard]]).

## Teardown: `wsClient.on()` guarda um handler por evento

`stopPresence()` desregistra sobrescrevendo os seis eventos WS com no-ops, porque `wsClient.on()` **substitui** o handler em vez de acumular. O corolário atinge quem nunca leu presença: **dois assinantes do mesmo evento WS não coexistem**: registrar outro handler para `'cursor'` derruba o da presença sem aviso. Todo `on()` novo no bridge precisa do par em `stopPresence()`.

Não existe chamada de `stopPresence` fora do módulo: o bridge vive enquanto o mapa vive. Quem limpa o roster no logout é `frontend/src/js/account/account.control.js` com `presenceStore.clear()`, depois de `logoutAndDisconnect()` ([[sessao-boot-e-ciclo-de-vida]]).

Regra dura complementar: **overlays nunca mutam presença**, só leem e reconciliam. E o store guarda a figura completa, inclusive você; quem exclui self é a UI.

## O que não existe, apesar das guias

> **Nota histórica.** A guia 06-presenca-imagens §1.3 descreve um `CursorManager` que auto-esconde o cursor após 5 s de inatividade. O overlay real **não tem timer nenhum**: o marcador some quando o peer sai da sala, troca de mapa ou some do store. O código da guia é Leaflet enquanto o app usa `maplibregl.Marker`; trate como pseudocódigo.

Também não existem, por design: replay de frames de presença perdidos, lock a partir do indicador de briefing, e escala multi-instância.

**A tabela `active_sessions` está RESERVADA e sem escritor, desde 2026-07-25.** Esta seção descreveu até essa data uma tabela write-only, escrita a cada connect e apagada a cada disconnect; os dois escritores foram removidos junto com o SQL, e hoje nada em `backend/src` insere, apaga ou lê a tabela. O motivo está no cabeçalho da tabela (`backend/src/database/migrations/003_sync.sql:74-86`) e na nota de topo de `backend/src/modules/collab/collab.service.js`: como nenhum `SELECT` jamais existiu, a escrita não comprava nada e ainda PARECIA um rastro durável de sessão, sendo incapaz de ser um (chamadas fire-and-forget que podiam commitar fora de ordem, nenhum reaper, e todo restart orfanando as linhas vivas em silêncio). A tabela ficou porque migração aqui é forward-only e aditiva.

Não construa "quem está online" a partir dela: a verdade é, e sempre foi, o `Map` em memória de `backend/src/modules/collab/collab.rooms.js`. O mesmo vale para as colunas de presença (`cursor_position`, `current_map_id`, `selected_features`) e para o índice `idx_sessions_heartbeat`, que nunca tiveram escritor de verdade. Ressuscitar isso começa pelo **leitor**, não pelo INSERT: coluna viva pela metade engana mais que coluna ausente. Ver [[canal-collab-websocket]] e [[link-publico]].

Existe classificação adaptativa de qualidade (`backend/src/modules/collab/collab.quality.js`) e o cliente reemite a resposta como `adaptiveSettings` (`frontend/src/js/store/sync/ws-client.js:341`), mas **nenhum módulo do frontend assina esse evento hoje**: o gancho existe, o consumidor não ([[qualidade-conexao-adaptativa]]).

## Limite operacional: uma instância

Salas, presença e `awayTimers` são `Map` em memória por processo, sem Redis nem pub/sub. Com duas réplicas, `broadcastToRoom` alcança só os clientes daquela instância e a presença fica partida; sem sticky session, um socket reconectado pode cair em outra instância que não conhece o timer, e o peer some depois de 2 min pela instância antiga e aparece duplicado pela nova. Caminho de menor risco: **uma instância, escala vertical**; alternativa é sticky sessions mais backplane. O WS vive no mesmo processo HTTP, então não dá para escalar WS separado. No NGINX, sem `proxy_http_version 1.1` mais `Upgrade`/`Connection "upgrade"` e sem rotear exatamente `/api/v1/collab`, a presença simplesmente não existe. Ver [[deploy-backend]] e [[sintese-limites-collab]].

## Depuração

Presença não gera spans de operação; o tap de barramento do [[syncledger]] registra `presence` só como probe de efeito de UI. Para "o peer não aparece", cheque nesta ordem: socket conectado ([[canal-collab-websocket]]), snapshot `connected` recebido, **chave resolvida** (o bug do `user_joined` com descritor aninhado, que fazia `resolveKey` não achar identidade e descartar o join em silêncio) e só então a UI. Ao adicionar um frame novo, decida onde fica o descritor e teste o roteamento.

Nunca use presença como fonte de verdade: ela é descartável por construção, e quem move estado real é [[aplicacao-operacoes-remotas]].
