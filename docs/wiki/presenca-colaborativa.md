# Presença Colaborativa

Camada efêmera em memória que propaga roster, cursores, seleções (2D/3D/360), cursor temporal e awareness de briefing entre pares de uma sala de atlas. Esta página cobre só o que não se lê no código: as convenções que o próprio JSDoc descreve errado, as armadilhas que atravessam cliente e servidor, e os limites operacionais.

Mapa dos arquivos: `src/js/presence/` (bridge, store, overlays, cores) e `backend/src/modules/collab/`. Os cabeçalhos JSDoc de `frontend/src/js/presence/presence-bridge.js` e `frontend/src/js/presence/presence-store.js` já listam frames inbound/outbound e eventos emitidos; não repetimos aqui.

## Por que presença é requisito, não enfeite

O modelo é **sem locks**: edição simultânea livre, conflito resolvido por [[modelo-conflito-lww]]. Sem presença, dois usuários mexem na mesma feição às cegas e o LWW vira perda de trabalho inexplicada. Presença é o que substitui o lock: o usuário evita a colisão porque **vê** o outro chegando. Por isso o indicador de briefing é advisory e nunca virou lock, e por isso derrubar presença por economia de tráfego é uma decisão de produto, não de infra.

Nada dela passa pela fila de operações, pelo IndexedDB ou pelo Postgres. Não vira linha em [[tabela-operations]], não entra na [[fila-operacoes-outbound]], não participa do LWW. Não confunda com [[envelope-operacao]] (persistido, idempotente) nem com [[comentario-espacial]] (entidade sincronizada de verdade). Só existe em atlas remoto conectado ([[atlas-modelo-de-dados]]); no modo local/anônimo o bridge fica montado e inerte ([[dominio-local-vs-remoto]], [[modos-operacao]]).

**Descartável por construção, e isso é deliberado.** `broadcastCursor` faz `if (!wsClient.isConnected()) return;` (`frontend/src/js/presence/presence-bridge.js:141`) e nunca enfileira: misturar presença com a fila offline faria o usuário reviver cursores de dez minutos atrás no reconnect. No servidor, `cursor`/`selection`/`temporal` estão em `COALESCABLE_TYPES` e são **descartados** quando `bufferedAmount` passa do teto de drop, enquanto o mesmo laço termina (`terminate()`) o socket afogado por operações duráveis para forçar reconnect e replay (`backend/src/modules/collab/collab.rooms.js:55-75`). Perder um cursor é invisível; perder uma operação é divergência.

## A armadilha central: a chave não é `clientId`

O JSDoc de `frontend/src/js/presence/presence-store.js:11-13` afirma que o estado é chaveado por `clientId`, e a guia de arquitetura repetia isso. **É falso com os frames reais do backend.** `resolveKey()` prefere `clientId` (`frontend/src/js/presence/presence-store.js:48-64`), mas o servidor só manda `clientId` em `user_away` e `user_back` (`backend/src/modules/collab/collab.service.js:74-95`); `connected.usersOnline`, `user_joined`, `user_left`, `cursor`, `selection` e `temporal` carregam apenas `id`/`userId`. Na prática **quase toda entrada fica chaveada por `userId`**.

Três consequências que só aparecem cruzando os arquivos:

1. **O badge `ausente` nunca aparece em produção.** `user_away` traz `clientId`, `resolveKey` prefere `clientId`, a entrada existente está sob `userId`, e `_setAway` faz `this._users.get(key)` e **retorna sem efeito** quando não acha (`frontend/src/js/presence/presence-store.js:507-518`). Só é exercitado por testes que injetam a mutação à mão (`frontend/tests/integration/presence-store.test.js:198`). O efeito visível da graça continua correto porque a remoção acontece no servidor, não no badge. Ao mexer aqui, normalize a chave antes de comparar.
2. **Exclusão do self precisa dos dois ids.** O snapshot `connected` inclui você (o `joinRoom` roda antes do `getRoomUsers`) e o `clientId` do [[client-id-estavel]] é outro id que não bate com a chave usada. Por isso o roster exclui por `sessionContext.userId` (`frontend/src/js/presence/online-users.control.js:226-232`) e os overlays excluem pelos **dois** (`frontend/src/js/presence/remote-cursors.layer.js:118-142`). Trocar para só `clientId` faz o usuário ver o próprio cursor.
3. **Duas abas do mesmo usuário colapsam numa entrada** e são filtradas como self: suas outras abas não aparecem no roster. O backend, ao contrário, trata abas como sockets distintos, e por isso `removeConnection` só anuncia `user_left` quando sai o **último** socket daquele userId (`backend/src/modules/collab/collab.gateway.js:440-460`). Anunciar incondicionalmente derrubaria o usuário do roster dos pares enquanto ele ainda está online.

A cor também deriva dessa chave: `getPresenceColor` é hash djb2 determinístico sobre paleta fixa (`frontend/src/js/presence/presence-colors.js:44-52`), o que faz avatar, cursor e caixa de seleção do mesmo par baterem entre superfícies e entre máquinas **sem coordenação com o servidor**. Alternar entre `userId` e `clientId` troca a cor da pessoa no meio da sessão. Colisão em 14 slots é esperada e aceita.

## Contrato congelado: `mapId` de presença é NOME de mapa

Não há sub-canal por mapa no servidor; toda mensagem vai para a sala inteira e **filtrar é do cliente**. O bridge carimba `getCurrentMapNameSync()` na saída (`frontend/src/js/presence/presence-bridge.js:144,157,196`) e os overlays resolvem o mapa ativo com a mesma função. As duas pontas precisam usar a mesma. Se alguém "corrigir" um lado para UUID, o filtro nunca casa e **nenhum cursor remoto renderiza, sem erro no console**. Contexto do dualismo nome/UUID em [[dominio-local-vs-remoto]].

> **Nota histórica.** As guias 04-websocket-collab §3.2 e 06-presenca-imagens §1.1 documentam `mapId` como UUID (`"mapId": "map-uuid"`). O backend trata o campo como opaco (só reencaminha), então funciona; o contrato real é "chave de mapa acordada entre clientes".

Corolário: `getCursors()` sem argumento devolve cursores de **todos** os mapas, por isso o overlay recusa renderizar quando o mapa ativo é `null` (`frontend/src/js/presence/remote-cursors.layer.js:124-129`).

Mapa ativo pega carona no cursor porque o backend **não tem handler `map_active`**: uma troca de mapa manda um cursor sem posição carregando só o novo `mapId` (`frontend/src/js/presence/presence-bridge.js:153-158`). Quem for adicionar um sinal de "mapa atual" precisa saber que já existe esse canal implícito.

## Seleção: a única presença com gate de papel

Cursor e temporal são ungated de propósito (decisão de produto anotada em `backend/src/modules/collab/collab.handlers.js:70-78`). Seleção é editor-gated **dos dois lados**: cliente (`frontend/src/js/presence/presence-bridge.js:167-173`) e servidor (`backend/src/modules/collab/collab.handlers.js:82-85`). O cliente evita tráfego inútil; o servidor é a autoridade, para cliente adulterado não furar o gate. Comentarista e Visualizador recebem seleções mas nunca transmitem. Ver [[permissoes-atlas]] e [[sintese-capacidades-por-papel]]; para autorizar escrita cheque `permission !== 'read'`, não `role`. Como o gate mapeia para a capacidade EDIT, é permissivo no store local e restritivo só em atlas remoto conectado.

Detalhes que evitam bug:

- O escopo por superfície (`mapId`/`tilesetId`/`photoName`) não é decoração: sem ele a seleção dentro de um modelo 3D vazaria para outro modelo ([[catalogo-3d]], [[streetview-360]]).
- **A geometria nunca trafega.** O overlay resolve os ids na fonte **local** e reconstrói a caixa com o mesmo `createSelectionBox` do highlight local. Só funciona porque o atlas é compartilhado; um par que ainda não recebeu a operação de criação não desenha nada.
- **O "acompanha o arraste" não vem de presença.** A caixa segue porque o overlay re-renderiza em `LAYERS_CHANGED`, ou seja, quando a **operação** de movimento do par altera a geometria local. Presença mostra *quem*; [[envelope-operacao]] traz o *quê*. Arraste travado é suspeita de fluxo de operações, não de presença.
- `featureMeta` viaja junto porque os ids sozinhos não carregam o tipo de ferramenta, e o peer precisa montar o destaque sem consultar o store.
- O rótulo temporal ([[modulo-temporal]]) vai **já formatado** (`"D+3"`) porque o peer não tem a config temporal do emissor; o store guarda blob opaco. `TEMPORAL_CURSOR_CHANGED` dispara por rAF, então coalescer na saída é obrigatório, não otimização.

## Away vs saída: a graça depende de um id que pode ser gerado em silêncio

O discriminador é o close code, com override: `code === 1006 && ws.intentionalLeave !== true` (`backend/src/modules/collab/collab.gateway.js:469`). O `intentionalLeave` existe porque um `leave` pode ser seguido de um `1006` real (o cliente derruba o socket antes do close frame chegar): **a intenção declarada vence o código de fechamento**.

No caminho away, `onClose` **mantém o socket morto dentro da sala** (não chama `leaveRoom`), e é isso que faz o usuário continuar aparecendo com `status: 'away'`. O timer de remoção vive em `awayTimers`, chaveado por `` `${atlasId}::${clientId}` `` (`backend/src/modules/collab/collab.gateway.js:31-45`). Na volta, `onConnection` cancela o timer e faz `leaveRoom` do socket morto **antes** de tudo; sem isso a sala teria os dois e a presença duplicaria (`backend/src/modules/collab/collab.gateway.js:300-313`).

**Por isso o `clientId` estável é obrigatório aqui.** O servidor gera `crypto.randomUUID()` quando o `clientId` falta ou é malformado: a conexão funciona e a continuidade de presença morre **em silêncio**, no pior formato possível (o fantasma away fica os 2 minutos *e* o socket novo entra como segunda sessão). Detalhes do id em [[client-id-estavel]], mesmo id que serve à [[ack-idempotencia]].

Duas consequências não óbvias do heartbeat: como ele derruba com `terminate()` (que produz 1006), heartbeat gera **away, não left**: uma aba em background com timer estrangulado entra em away a cada ciclo. E o mesmo tick re-reconcilia a autorização contra o banco, então um downgrade de compartilhamento tem staleness limitado a um heartbeat ([[compartilhamento-atlas]]). Pendência conhecida: a **remoção total** de um membro conectado não o desconecta, ele só perde acesso ao reconectar.

Voltar da graça restaura a **presença, não os dados**: não há replay de frames perdidos nem de operações. O cliente precisa mandar `sync_request` com o `lastVersion` e reenviar a fila offline ([[snapshot-e-pull-incremental]], [[idempotencia-e-convergence-guard]]).

## Teardown: `wsClient.on()` guarda um handler por evento

`stopPresence()` desregistra sobrescrevendo os seis eventos WS com no-ops, porque `wsClient.on()` **substitui** o handler em vez de acumular. O corolário atinge quem nunca leu presença: **dois assinantes do mesmo evento WS não coexistem**: registrar outro handler para `'cursor'` derruba o da presença sem aviso. Todo `on()` novo no bridge precisa do par em `stopPresence()`.

Não existe chamada de `stopPresence` fora do módulo: o bridge vive enquanto o mapa vive. Quem limpa o roster no logout é `frontend/src/js/account/account.control.js` com `presenceStore.clear()`, depois de `logoutAndDisconnect()` ([[sessao-boot-e-ciclo-de-vida]]).

Regra dura complementar: **overlays nunca mutam presença**, só leem e reconciliam. E o store guarda a figura completa, inclusive você; quem exclui self é a UI.

## O que não existe, apesar das guias

> **Nota histórica.** A guia 06-presenca-imagens §1.3 descreve um `CursorManager` que auto-esconde o cursor após 5 s de inatividade. O overlay real **não tem timer nenhum**: o marcador some quando o peer sai da sala, troca de mapa ou some do store. O código da guia é Leaflet enquanto o app usa `maplibregl.Marker`; trate como pseudocódigo.

Também não existem, por design: replay de frames de presença perdidos, lock a partir do indicador de briefing, e escala multi-instância.

Existe classificação adaptativa de qualidade (`backend/src/modules/collab/collab.quality.js`) e o cliente reemite a resposta como `adaptiveSettings` (`frontend/src/js/store/sync/ws-client.js:341`), mas **nenhum módulo do frontend assina esse evento hoje**: o gancho existe, o consumidor não ([[qualidade-conexao-adaptativa]]).

## Limite operacional: uma instância

Salas, presença e `awayTimers` são `Map` em memória por processo, sem Redis nem pub/sub. Com duas réplicas, `broadcastToRoom` alcança só os clientes daquela instância e a presença fica partida; sem sticky session, um socket reconectado pode cair em outra instância que não conhece o timer, e o peer some depois de 2 min pela instância antiga e aparece duplicado pela nova. Caminho de menor risco: **uma instância, escala vertical**; alternativa é sticky sessions mais backplane. O WS vive no mesmo processo HTTP, então não dá para escalar WS separado. No NGINX, sem `proxy_http_version 1.1` mais `Upgrade`/`Connection "upgrade"` e sem rotear exatamente `/api/v1/collab`, a presença simplesmente não existe. Ver [[deploy-backend]] e [[sintese-limites-collab]].

## Depuração

Presença não gera spans de operação; o tap de barramento do [[syncledger]] registra `presence` só como probe de efeito de UI. Para "o peer não aparece", cheque nesta ordem: socket conectado ([[canal-collab-websocket]]), snapshot `connected` recebido, **chave resolvida** (o bug do `user_joined` com descritor aninhado, que fazia `resolveKey` não achar identidade e descartar o join em silêncio) e só então a UI. Ao adicionar um frame novo, decida onde fica o descritor e teste o roteamento.

Nunca use presença como fonte de verdade: ela é descartável por construção, e quem move estado real é [[aplicacao-operacoes-remotas]].
