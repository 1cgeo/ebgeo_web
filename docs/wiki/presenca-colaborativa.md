# Presença Colaborativa

Camada efêmera em memória que propaga roster de usuários, cursores, seleções nas três superfícies (2D/3D/360), cursor temporal e awareness de edição de briefing entre os pares de uma sala de atlas, com tolerância a queda via janela away/back.

## O que é (e o que não é)

Presença é **awareness**, não dado. Nada dela passa pela fila de operações, pelo IndexedDB ou pelo Postgres: os frames viajam apenas pelo [[canal-collab-websocket]], são best-effort e somem quando o socket cai. Não vira linha em `operations` ([[tabela-operations]]), não entra na [[fila-operacoes-outbound]] e não participa do [[modelo-conflito-lww]]. Não confunda com [[envelope-operacao]] (persistido, idempotente, versionado) nem com [[comentario-espacial]] (esse sim é entidade sincronizada).

Presença é **requisito, não enfeite**: guia *acoes-interface-multiusuario* (absorvido):8` classifica awareness como obrigatório, e a §4 (linhas 584-590) lista o que expor: cursor/avatar por usuário, lista de online, mapa ativo de cada um, quem está editando briefing e o instante temporal de cada um. A razão é doutrinária: o modelo é **sem locks**, com edição simultânea livre e [[modelo-conflito-lww]] resolvendo o conflito. Sem presença, dois usuários mexem na mesma feição às cegas e o LWW vira perda de trabalho inexplicada. Presença é o que substitui o lock: o usuário evita a colisão porque **vê** o outro chegando.

Consequências práticas:

- Frame de presença perdido = perdido. `broadcastCursor` faz `if (!wsClient.isConnected()) return;` (`src/js/presence/presence-bridge.js:141`), nunca enfileira. Misturar presença com a fila offline faria o usuário "reviver" cursores de dez minutos atrás no reconnect.
- Sob backpressure local o próprio transporte **descarta** frames de presença: `cursor`/`selection`/`temporal` estão em `COALESCABLE_TYPES` e são jogados fora quando `socket.bufferedAmount > 1 MiB` (`src/js/store/sync/ws-client.js:36`, `:519-525`). No servidor, socket afogado além do teto sofre `terminate()` para reconectar e replayar (`collab.rooms.js:68,102`). Operações duráveis nunca são descartadas assim: perder um cursor é invisível, perder uma operação é perda de dado.
- No servidor, cursor, mapa corrente, seleção e temporal vivem **em memória no objeto `ws`** (`collab.service.js:20-25`); `active_sessions` guarda só connect/heartbeat.
- Presença só existe em atlas remoto conectado ([[atlas-modelo-de-dados]]). No modo local/anônimo ([[dominio-local-vs-remoto]], [[modos-operacao]]) o bridge fica montado mas inerte.

## Anatomia (cliente)

```
ws-client.js  ──frames──▶  presence-bridge.js  ──▶  presence-store.js  ──eventos──▶  overlays/roster
   (transporte)              (roteamento)            (estado puro)                    (DOM/render)
```

1. **`presence-bridge.js`** — o único lugar que fala WS, sem UI. `startPresence({ map })` é chamado uma vez em `src/js/map_sig.js:632` (montagem dos overlays em `:622-632`). Inbound: handlers para `connected`, `presence`, `cursor`, `selection`, `temporal`, `briefingEdit` (`:350-357`). Outbound: `mousemove` (throttle 80 ms), `MAP_LOCK_CHANGED`, `TEMPORAL_CURSOR_CHANGED`, `BRIEFING_EDIT_STARTED/ENDED`, mudança de `selection.features` no StateManager (`:395`) e cliques `MARKER_3D_*`/`MARKER_360_*` (`:405-418`).
2. **`presence-store.js`** — estado puro, sem DOM, `Map<chave, PresenceUser>`. Emite `PRESENCE_CHANGED` (roster/away/currentMap/temporal/briefing), `PRESENCE_CURSORS_CHANGED` (só cursor, com `{mapId}`) e `PRESENCE_SELECTIONS_CHANGED` (com `{surface}`). A separação existe para que um movimento de mouse a 12 Hz não re-renderize o roster inteiro (`presence-store.js:16-18`, `events/event_types.js:228-232`). Os três emits são envolvidos em `try/catch` porque o event bus pode não existir antes de `initServices()` (`:521-551`). Ao acrescentar um consumidor, assine o evento mais estreito que resolve o problema.
3. **Render** — `OnlineUsersControl` (roster + dropdown de awareness), `RemoteCursorsLayer` (um `maplibregl.Marker` por peer), `RemoteSelectionsLayer` (fonte `remote-selection-boxes`). O 3D e o 360 leem o store diretamente: `marker_tool_3d.js:518,881` usa `getSelections('3d', tilesetId)` ([[catalogo-3d]]) e `street_view_viewer.js:1057,1336` usa `getSelections('360', photoName)` ([[streetview-360]]).

Regra dura: **overlays nunca mutam presença**. Eles leem `getCursors/getSelections/getOthers` e reconciliam; quem escreve no store é só o bridge. E o store guarda a **figura completa** (inclusive você mesmo): quem exclui self é a UI.

## Chaveamento e a armadilha do self

`resolveKey()` prefere `clientId`, cai para `userId` e, por último, para `id` (`presence-store.js:48-64`). Só que o backend **não manda `clientId` na maioria dos frames**:

| Frame | Campos de identidade | Chave efetiva no store |
|---|---|---|
| `connected.usersOnline` (`collab.rooms.js:163-190`) | `id` | userId |
| `user_joined` (`collab.service.js:53-63`) | `user.id` | userId |
| `user_left` (`collab.service.js:67-72`) | `userId` | userId |
| `cursor` / `selection` / `temporal` (`collab.handlers.js:39-107`) | `userId` | userId |
| `user_away` / `user_back` (`collab.service.js:79-95`) | `userId` **+ `clientId`** | **clientId** |

> [!CONTRADICAO 2026-07-18] guia *arquitetura-sync* (absorvido):330` diz "Tudo é keyed por `clientId`". O código contradiz: com os frames reais do backend, praticamente toda entrada fica chaveada por `userId`. Só `user_away`/`user_back` carregam `clientId`, e é exatamente aí que o caminho quebra (ver abaixo).

Disso decorrem duas consequências já visíveis no código:

1. **A exclusão do self usa `sessionContext.userId`, não `clientId`** (`online-users.control.js:226-232`). O snapshot `connected` inclui você (o `joinRoom` acontece antes do `getRoomUsers`, `collab.gateway.js:336-340`) e o `clientId` do [[client-id-estavel]] é outro id, persistido por navegador, que não bate com a chave usada. Os overlays vão além e excluem pelos **dois** ids (`remote-cursors.layer.js:120-142`, `remote-selections.layer.js:177-178`); `getOthers(self)` também compara `self` contra `user.clientId` **e** `user.userId` (`presence-store.js:415-425`), para tolerar as duas convenções. Passar `clientId` no roster faz você aparecer no seu próprio roster e ver o próprio cursor.
2. **Duas abas do mesmo usuário colapsam em uma entrada.** Chave = userId, então a segunda aba sobrescreve a primeira e é filtrada como "self": outras abas suas não aparecem na lista de online. É deliberado, mas contradiz o JSDoc do `online-users.control.js`, que ainda fala em `clientId`. O backend, ao contrário, trata abas como sockets distintos e por isso `removeConnection` só anuncia `user_left` quando é o **último** socket daquele userId (`collab.gateway.js:445-460`).

Cor e iniciais também derivam dessa chave (ver adiante), o que é mais um motivo para não alternar entre convenções no meio da sessão.

## Cursor: broadcast por atlas, filtro por mapa no cliente

O servidor **não** tem sub-canal por mapa: toda mensagem de presença vai para todos os clientes do atlas. Filtrar é responsabilidade do cliente, em dois lugares: `getCursors(mapId)` descarta cursores cujo `cursor.mapId` não bate (`presence-store.js:432-448`) e o `RemoteCursorsLayer` recusa renderizar quando o mapa ativo é `null` (`remote-cursors.layer.js:127-129`), porque `getCursors()` sem argumento devolveria cursores de **todos** os mapas.

**O campo `mapId` é um nome.** O bridge carimba `getCurrentMapNameSync()` nos frames de saída (`presence-bridge.js:144`, `:157`, `:196`) e os overlays resolvem o mapa ativo com a mesma função (`remote-cursors.layer.js:63-69`, `remote-selections.layer.js:70`), então o par bate. Se alguém "corrigir" um lado para UUID sem corrigir o outro, o filtro nunca casa e **nenhum cursor remoto renderiza**, sem erro no console. Contexto do dualismo nome/UUID em [[dominio-local-vs-remoto]].

> [!CONTRADICAO 2026-07-18] guia *04-websocket-collab* (absorvido) §3.2 e guia *06-presenca-imagens* (absorvido) §1.1 documentam `mapId` como UUID do mapa (`"mapId": "map-uuid"`); `presence-bridge.js:144` envia o nome. O backend trata o campo como opaco (só reencaminha), então funciona, mas o contrato real é "chave de mapa acordada entre clientes", não UUID.

**Throttle e coalescing:** `map.on('mousemove')` → leading + um único trailing por janela de **80 ms** (`CURSOR_THROTTLE_MS`, `presence-bridge.js:61`; handler em `:299-331`), não os 50 ms do exemplo do guia. O trailing guarda só a última posição (`:316-330`); intermediárias são descartadas, nunca enfileiradas, porque presença atrasada é pior que presença perdida.

**Mapa ativo pega carona no cursor:** o backend não tem handler `map_active`, então uma troca de mapa manda um cursor **sem posição** carregando só o novo `mapId` (`broadcastCurrentMap`, `presence-bridge.js:32-35,153-158`), disparado por `MAP_LOCK_CHANGED` (`:372`). O store lê `mapId` de todo frame inbound e atualiza `currentMap` (`_applyCurrentMap`, `presence-store.js:258-267`), por isso `setCursor` pode emitir dois eventos: sempre `PRESENCE_CURSORS_CHANGED` e, quando `currentMap` mudou, também `PRESENCE_CHANGED`.

## Seleção: a única presença com gate de papel

Cursor e temporal são ungated de propósito (decisão de produto, comentada em `collab.handlers.js:71-74`). Seleção é **editor-gated dos dois lados**: no cliente `canBroadcastSelection()` consulta `checkPermission('CREATE_FEATURE').allowed` (`presence-bridge.js:167-173`) e o servidor repete o gate, com `handleSelection` retornando cedo para `read` e `comment` (`collab.handlers.js:82-85`). Um Comentarista ou Visualizador **recebe** seleções dos pares mas nunca transmite a sua. O cliente evita tráfego inútil; o servidor é a autoridade, para um cliente adulterado não furar o gate. Ver [[permissoes-atlas]], [[permissoes-atlas]] e [[sintese-capacidades-por-papel]]; para autorizar escrita cheque `permission !== 'read'`, não `role`. A via de participação do Comentarista é [[comentario-espacial]]. Como o gate mapeia para a capacidade EDIT, ele é permissivo no store local e restritivo só num atlas remoto conectado ([[dominio-local-vs-remoto]]).

O frame é escopado por superfície: `'2d'` usa `mapId`, `'3d'` usa `tilesetId`, `'360'` usa `photoName` (`presence-store.js:461-492`). Sem escopo, a seleção dentro de um modelo 3D vazaria para outro modelo.

Detalhes que evitam bug:

- `featureMeta` (`{id, type}` por feição) viaja junto para o peer montar a caixa de destaque sem consultar o store (`presence-bridge.js:186-196`). Os ids sozinhos não carregam o tipo de ferramenta.
- Deseleção vira `selection = null` (lista vazia normaliza para `null`), mas `setSelection` captura a superfície **antes** de zerar, para notificar a superfície que acabou de limpar (`presence-store.js:285-298`). Sem isso o destaque do peer ficaria preso na tela.
- A geometria nunca trafega: o `RemoteSelectionsLayer` resolve os ids na fonte **local** e reconstrói a caixa com o mesmo `createSelectionBox` do highlight local, tingida com a cor do par (`remote-selections.layer.js:10-16`). Só funciona porque o atlas é compartilhado.
- O "acompanha o arraste" **não** vem de frames de seleção: a caixa segue porque o overlay 2D também re-renderiza em `LAYERS_CHANGED` (`remote-selections.layer.js:47-52`), ou seja, quando a **operação** de movimento do par chega e altera a geometria local. Presença mostra *quem*; [[envelope-operacao]] traz o *quê*. Arraste travado é suspeita de fluxo de operações, não de presença.

## Temporal e briefing

- **Temporal** ([[modulo-temporal]]): `TEMPORAL_CURSOR_CHANGED` dispara **por rAF** durante o playback, então o bridge coalesce (leading + um trailing por janela de 80 ms, `scheduleCoalesced`, `presence-bridge.js:245-265`). O payload leva `{cursor, label, playing}` com o rótulo **já formatado** (`"D+3"`), porque o peer não tem a config temporal do emissor (`:274-292`). O store guarda o blob opaco; a linha do tempo é local por usuário.
- **Briefing**: `briefing_edit_start/end` sobem no início/fim da edição; inbound `briefing_edit_started/ended` viram `setBriefingEdit` (`presence-bridge.js:121-133`). É indicador **advisory, não lock**: dois usuários podem editar o mesmo briefing e o resultado cai no [[modelo-conflito-lww]].

## Ciclo de vida da sala: joined / left / away / back

Quatro frames descrevem a sala, roteados em `presence-bridge.js:89-114`:

| Frame | Efeito no store | Observação |
|---|---|---|
| `user_joined` | `userJoined(msg.user)` | O descritor vem **aninhado** em `user`; os demais trazem os campos no topo |
| `user_left` | `userLeft(msg)` | Remoção definitiva, e só do **último** socket daquele userId |
| `user_away` | `userAway(msg)` | Marca `away = true`, **não** remove |
| `user_back` | `userBack(msg)` | Limpa `away` |

A assimetria do `user_joined` já causou bug: passar a mensagem inteira fazia `resolveKey()` não achar identidade no topo e **descartar o join em silêncio**, deixando o par invisível no roster (comentário em `presence-bridge.js:94-99`). Ao adicionar um frame novo, decida onde fica o descritor e teste o roteamento.

O snapshot inicial vem em `connected.usersOnline` e substitui a membresia inteira via `setInitial` (`presence-store.js:185-197`); ele **inclui você** e inclui quem está `away` (campo `status`, lido em `:148,164`). O `connected` traz ainda `sessionId`/`permission`/`role`.

### Janela de graça: away vs saída

O discriminador no servidor é o close code, com um flag de override (`collab.gateway.js:469`; `ABNORMAL_CLOSE = 1006` em `:25`):

```js
const networkDrop = code === ABNORMAL_CLOSE && ws.intentionalLeave !== true;
```

| Evento | Close code | Efeito |
|---|---|---|
| Queda de rede / `terminate()` do heartbeat | `1006` | `ws.away = true`, `user_away`, timer de remoção agendado (`:485-497`) |
| Mensagem `leave` | servidor seta `ws.intentionalLeave = true` e fecha com `1000` (`:418-423`) | remoção imediata, `user_left` |
| `close()` limpo do cliente (`1000`/`1001`/`1005`) | qualquer ≠ `1006` | remoção imediata |
| `atlas_deleted` | `4001` | remoção imediata (sala fechada) |
| Shutdown do servidor | `1001` (`:183`) | remoção imediata, sem enxurrada de `away` |

O `intentionalLeave` existe porque um `leave` pode ser seguido de um `1006` real (o cliente derruba o socket antes do close frame chegar): a intenção declarada vence o código de fechamento.

No caminho `away`, `onClose` **mantém o socket morto dentro da sala** (não chama `leaveRoom`), por isso o usuário continua em `usersOnline` com `status: client.away ? 'away' : 'online'` (`collab.rooms.js:185`); um `setTimeout(awayGraceMs)` é agendado em `awayTimers`, `Map` em memória chaveado por `` `${atlasId}::${clientId}` `` (`collab.gateway.js:34,494-497`), com `unref()` para não segurar o processo Node. Expirando, `removeConnection` sai da sala, apaga a linha de sessão e (condicionalmente) emite `user_left`.

No `user_back`, `onConnection` procura o timer pendente antes de qualquer outra coisa, faz `clearTimeout`, chama `leaveRoom(pending.ws)` para **descartar o socket morto** (sem isso a sala teria os dois e a presença duplicaria) e emite `broadcastUserBack` (`collab.gateway.js:306-313`).

Por isso o `clientId` estável é obrigatório aqui: a chave do timer é `atlasId::clientId`. Reconectar com outro `clientId` não encontra o timer e dá o pior dos mundos, o fantasma `away` fica 2 minutos na lista *e* o socket novo entra como segunda sessão. O servidor gera `crypto.randomUUID()` quando o `clientId` falta ou é malformado (`:305`), então a conexão funciona mas a continuidade de presença morre em silêncio. O frontend persiste o id em `localStorage` sob `ebgeo_client_id` (`store/sync/operation-factory.js:41-49`) e constrói o singleton com ele (`ws-client.js:573`); regex aceito e detalhes em [[client-id-estavel]], mesmo id que serve à [[ack-idempotencia]].

Do lado cliente, `WsClient.disconnect()` manda `{type:'leave'}` e fecha com `1000` (`ws-client.js:131-132`), então saída deliberada nunca vira `away`; F5 e fechar aba produzem close limpo (`1001`/`1000`) e também removem na hora. Voltar da graça restaura a presença, **não os dados**: não há replay de frames perdidos, o cliente precisa mandar `sync_request` com o `lastVersion` e reenviar a fila offline, tratando `result.idempotent: true` como sucesso ([[snapshot-e-pull-incremental]], [[fila-operacoes-outbound]], [[idempotencia-e-convergence-guard]]).

> [!CONTRADICAO 2026-07-18] guia *ui-ux-ebgeo* (absorvido) e guia *visao-e-principios* (absorvido):239` descrevem o badge `ausente` aparecendo no roster durante a graça, mas com o frame real isso não acontece: `user_away` traz `clientId` (`collab.service.js:79-86`), `resolveKey` prefere `clientId` (`presence-store.js:53-55`), a entrada existente está chaveada por `userId`, e `_setAway` faz `this._users.get(key)` e **retorna sem efeito** quando não acha (`presence-store.js:507-518`). O badge só é exercitado por testes que injetam a mutação à mão (`tests/integration/presence-store.test.js:198`, `tests/e2e-ui/presence.spec.js:296-300`). O efeito visível da graça (o usuário não some e reaparece) continua correto, porque a remoção só ocorre no fim da graça, no servidor. Ao mexer nessa área, normalize a chave antes de comparar.

O heartbeat (`WS_HEARTBEAT_INTERVAL_MS`, padrão 30 s, `config.js:84`) tem duplo papel: derruba socket que não pongou **e** re-reconcilia a autorização contra o banco a cada tick, então um downgrade ou revogação de compartilhamento tem staleness limitado a um heartbeat (`collab.gateway.js:284-289`, ver [[compartilhamento-atlas]]). Como `terminate()` produz `1006`, o heartbeat gera `away`, não `left`: uma aba em background com timer estrangulado entra em `away` a cada ciclo. Pendência conhecida (guia *ui-ux-ebgeo* (absorvido):220-223`): a **remoção total** de um membro conectado não o desconecta, ele só perde acesso ao reconectar.

`WS_AWAY_GRACE_MS` tem default `120000` (`config.js:89`), validado em `0..86400000` (`:168`). Com `0` a remoção é praticamente imediata, mas ainda passa por `user_away` seguido de `user_left`. O gateway expõe `setAwayGraceMs(ms)` (`:39-41`) e `heartbeatSweep(wss)` como hooks de teste/ops.

## Teardown do bridge

`startPresence` é idempotente (`state._started`, `presence-bridge.js:338-342`). `stopPresence()` (`:425-456`) precisa fazer **cinco** coisas, e esquecer qualquer uma vaza: desligar o `mousemove` do mapa, soltar a subscrição de seleção do StateManager, `cleanup(state)` para timers e subscrições de bus, sobrescrever os seis eventos WS do bridge com no-ops (`:446-449`) e por fim `presenceStore.clear()`. A sobrescrita é a forma de desregistrar porque `wsClient.on()` guarda **um único handler por evento**; o corolário é que dois assinantes do mesmo evento WS não coexistem, registrar outro handler para `'cursor'` derruba o da presença sem aviso.

Não existe chamada de `stopPresence` fora do próprio módulo: o bridge vive enquanto o mapa vive. Quem limpa o roster no logout é `account.control.js:849` (`presenceStore.clear()`), depois de `syncEngine.logoutAndDisconnect()`, junto com o apagamento do dado remoto (guia *visao-e-principios* (absorvido):174`). Ver [[sessao-boot-e-ciclo-de-vida]] e [[dominio-local-vs-remoto]].

## Identidade visual determinística

`getPresenceColor(key)` é um hash djb2 sobre uma paleta fixa de 14 tons escuros o bastante para texto branco (`presence-colors.js:33-52`). A mesma chave dá a mesma cor em **todos** os clientes, sem coordenação com o servidor, então avatar do roster, cursor no mapa e caixa de seleção do mesmo peer são da mesma cor. Passe sempre a mesma chave (preferencialmente `userId`); alternar entre `userId` e `clientId` troca a cor da pessoa no meio da sessão, e cor aleatória ou por ordem de chegada quebra a correspondência entre superfícies e entre máquinas. Colisão com 14 slots é esperada e aceita. `getInitials` monta o avatar (primeira + última palavra, acentos preservados).

## O que não existe, apesar dos guias

> [!CONTRADICAO 2026-07-18] guia *06-presenca-imagens* (absorvido) §1.3 descreve um `CursorManager` que auto-esconde o cursor após 5 s sem movimento (`setTimeout` + `setOpacity(0)`); o `RemoteCursorsLayer` real (`remote-cursors.layer.js:116-161`) **não tem timer nenhum**: o marcador some quando o peer sai da sala, troca de mapa ou some do store, nunca por inatividade. O código do guia também é Leaflet (`L.divIcon`, `L.marker`) enquanto o app usa `maplibregl.Marker` — trate aquele trecho como pseudocódigo.

Também não existem, por design: replay de frames de presença perdidos, lock de edição a partir do indicador de briefing e escala multi-instância.

Existe classificação adaptativa de qualidade de conexão (`collab.quality.js`), que sugere intervalo de batch, precisão geométrica e viewport-only por banda de RTT; a truncagem é **transport-only**, o JSONB persistido mantém precisão cheia ([[qualidade-conexao-adaptativa]]). O cliente reemite a resposta como `adaptiveSettings` (`ws-client.js:341`), mas **nenhum módulo do frontend assina esse evento hoje**: o gancho existe, o consumidor não.

## Limites operacionais

Salas, presença e `awayTimers` são `Map` **em memória por processo**, sem Redis nem pub/sub (`docs/deploy.md:500-506`). Logo, **não escala horizontalmente**: com duas réplicas, `broadcastToRoom` alcança só os clientes daquela instância e a presença fica partida (sintoma no runbook: "broadcast WS não chega a alguns clientes", `deploy.md:562`); sem sticky session, um socket reconectado pode cair em outra instância que não conhece o timer, e o peer some depois de 2 min pela instância antiga e aparece duplicado pela nova. Caminho de menor risco em produção: **uma instância**, escala vertical; alternativa é sticky sessions + backplane. O WS vive no mesmo processo HTTP (`createServer(app)` + handler de `upgrade`), então não dá para escalar WS separado. No NGINX, sem `proxy_http_version 1.1` + `Upgrade`/`Connection "upgrade"` e sem rotear exatamente `/api/v1/collab` (outro pathname recebe 404), a presença simplesmente não existe. Ver [[deploy-backend]] e [[sintese-limites-collab]].

## Observabilidade e checklist de armadilhas

Presença não gera spans de operação, mas o tap de barramento do [[syncledger]] registra `presence` como probe de efeito de UI. Para depurar "o peer não aparece", cheque na ordem: socket conectado ([[canal-collab-websocket]]), snapshot `connected` recebido, chave resolvida (o bug histórico do `user_joined` aninhado) e só então a UI.

1. Não assuma `clientId` como chave: na prática as entradas são chaveadas por `userId`, e só `user_away`/`user_back` mandam `clientId` — é justamente aí que o caminho quebra.
2. Exclusão de si mesmo é por `userId` no roster e pelos **dois** ids nos overlays.
3. `mapId` de presença é **nome** de mapa, não UUID, e as duas pontas precisam usar a mesma função.
4. Nunca enfileire presença offline nem persista posição de cursor: descarte o frame antigo, mande o novo.
5. Trate `user_away` como "esmaeça", nunca como "remova"; envie `leave` na saída intencional.
6. Ao mexer em seleção remota, lembre do escopo por superfície (mapId/tilesetId/photoName) e do gate de edição nos dois lados.
7. Ao adicionar sinal de awareness de alta frequência, coalesça (leading + um trailing) e marque-o como coalescável no backpressure.
8. Todo `on()` novo no bridge precisa do par correspondente em `stopPresence()`.
9. Não use presença como fonte de verdade: ela é descartável por construção ([[aplicacao-operacoes-remotas]] é quem move estado real).


## Shape dos frames no fio

## Shape dos frames no fio

Os campos abaixo são contrato; note as assimetrias (descritor aninhado só em `user_joined`, `clientId` só em `user_away`/`user_back`, `userName` só nos frames de briefing).

### Cursor

```javascript
// C→S
{ "type": "cursor", "position": { "lat": -15.78, "lng": -47.92 }, "mapId": "chave-do-mapa" }

// S→peers (emissor excluído)
{ "type": "cursor", "userId": "user-uuid", "position": { "lat": -15.78, "lng": -47.92 }, "mapId": "chave-do-mapa" }
```

### Seleção

```javascript
// C→S (o app acrescenta surface + escopo e featureMeta opcional)
{ "type": "selection", "featureIds": ["feat-1", "feat-2"], "mapId": "chave-do-mapa" }

// S→peers
{ "type": "selection", "userId": "user-uuid", "featureIds": ["feat-1", "feat-2"], "mapId": "chave-do-mapa" }
```

### Ciclo de vida da sala

```javascript
// descritor ANINHADO em `user` — só neste frame
{ "type": "user_joined", "user": { "id": "user-uuid", "nome": "Capitão Silva", "posto_graduacao": "Cap" } }

// remoção definitiva (saída intencional OU expiração da graça)
{ "type": "user_left", "userId": "user-uuid" }

// queda anormal: marque away, NÃO remova
{ "type": "user_away", "userId": "user-uuid", "clientId": "client-uuid" }

// reconexão dentro da graça: limpe o away
{ "type": "user_back", "userId": "user-uuid", "clientId": "client-uuid" }
```

### Snapshot inicial (`connected.usersOnline`)

```json
{
  "type": "connected",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-uuid",
  "permission": "owner",
  "role": "owner",
  "usersOnline": [
    {
      "id": "outro-user-uuid",
      "nome": "Tenente Lima",
      "posto_graduacao": "Ten",
      "mapId": "chave-do-mapa",
      "cursorPosition": { "lat": -15.7, "lng": -47.9 },
      "status": "online"
    }
  ]
}
```

Cada item pode ainda trazer `selectedFeatures`, `selectionContext` e `temporalState`. A lista **inclui você mesmo** e inclui quem está `away`.

### Awareness de briefing

A saída leva só o `briefingId`; a entrada ganha `userId` **e** `userName` já resolvido, para o peer rotular o indicador sem consultar o roster.

```javascript
// C→S
{ "type": "briefing_edit_start", "briefingId": "briefing-uuid" }
{ "type": "briefing_edit_end",   "briefingId": "briefing-uuid" }

// S→peers
{ "type": "briefing_edit_started", "userId": "...", "userName": "Cap Silva", "briefingId": "briefing-uuid" }
{ "type": "briefing_edit_ended",   "userId": "...", "userName": "Cap Silva", "briefingId": "briefing-uuid" }
```

## Fontes

- guia *arquitetura-sync* (absorvido) (§5, §9, §10): presença só em memória no servidor, catálogo de mensagens WS, gates de `cursor`/`selection`/`temporal`, papel do `clientId`.
- guia *acoes-interface-multiusuario* (absorvido): awareness como requisito (linha 8) e a lista canônica do que expor (§4, linhas 584-590).
- guia *ui-ux-ebgeo* (absorvido), guia *visao-e-principios* (absorvido): descrição de produto (roster, cursores, seleção que acompanha o arraste, gate de edição), modelo sem locks, limpeza no logout, `WS_AWAY_GRACE_MS`, pendência da revogação ao vivo.
- guia *04-websocket-collab* (absorvido) e guia *06-presenca-imagens* (absorvido): protocolo dos frames, `usersOnline[].status`, semântica away vs remove, limites single-instance; e a implementação de referência do `CursorManager` (Leaflet, com auto-hide) que diverge do cliente real.
- `docs/deploy.md`: WS no mesmo processo HTTP, requisitos de upgrade no NGINX (§7), limite de escala horizontal (linhas 500-506, 562).
- Código do cliente (manda sobre a prosa): `src/js/presence/{presence-store,presence-bridge,remote-cursors.layer,remote-selections.layer,online-users.control,presence-colors}.js`, `src/js/store/sync/{ws-client,operation-factory}.js`, `src/js/map_sig.js:622-632`, `src/js/account/account.control.js:849`.
- Código do backend: `ebgeo_backend/src/modules/collab/{gateway,handlers,rooms,service,quality}.js` e `ebgeo_backend/src/config.js:84,89,168`.
