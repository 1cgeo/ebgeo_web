# Presença e awareness em tempo real

Presença é requisito, não enfeite: roster de quem está online no atlas, cursores remotos, seleção remota que acompanha o arraste nas três superfícies (2D/3D/360) e tolerância a queda via janela away/back com o mesmo clientId.

## Por que é requisito

`docs/acoes-interface-multiusuario.md:8` classifica awareness como **obrigatório** (não nice-to-have), e a §4 do mesmo documento (linhas 584-590) lista o que precisa ser exposto: cursor/avatar por usuário, lista de online, mapa ativo de cada um, quem está editando briefing e o instante temporal de cada um. A razão é doutrinária: o modelo é **sem locks**, edição simultânea livre com [[sync-lww-operacoes]] resolvendo o conflito. Sem presença, dois usuários mexem na mesma feição às cegas e o LWW vira perda de trabalho inexplicada. Presença é o que substitui o lock: o usuário evita a colisão porque **vê** o outro chegando.

Corolário: presença é a única camada em que "o outro está aqui" aparece. Não existe bloqueio de edição por usuário; ver o cursor e a caixa de seleção alheia é a prevenção.

## Anatomia: três camadas, uma direção

```
ws-client.js  ──frames──▶  presence-bridge.js  ──▶  presence-store.js  ──eventos──▶  overlays/roster
   (transporte)              (roteamento)            (estado puro)                    (DOM/render)
```

- `src/js/presence/presence-store.js` é **puro** (sem DOM) e emite três eventos no barramento: `PRESENCE_CHANGED` (membership/away/mapa/temporal/briefing), `PRESENCE_CURSORS_CHANGED` (só cursor) e `PRESENCE_SELECTIONS_CHANGED` (só seleção, com a `surface` que mudou). A separação existe para o overlay de cursor não re-renderizar o roster inteiro a 12 Hz (`presence-store.js:16-18`, `events/event_types.js:228-232`).
- `src/js/presence/presence-bridge.js` é o único lugar que fala com o socket ([[websocket-collab]], [[canal-collab-websocket]]). Ele não tem UI (`presence-bridge.js:26-30`).
- Overlays: `remote-cursors.layer.js` (marcadores DOM MapLibre), `remote-selections.layer.js` (source `remote-selection-boxes`), `online-users.control.js` (roster). Montagem em `src/js/map_sig.js:622-632`.

Regra dura: **overlays nunca mutam presença**. Eles leem `presenceStore.getCursors/getSelections/getOthers` e reconciliam. Quem escreve no store é só o bridge.

## A armadilha central: a chave de identidade

`resolveKey` prefere `clientId`, cai para `userId`, cai para `id` (`presence-store.js:48-64`). Mas o backend **não manda clientId na maioria dos frames**:

| Frame | Campos de identidade | Chave efetiva no store |
|---|---|---|
| `connected.usersOnline` (`collab.rooms.js:163-190`) | `id` | userId |
| `user_joined` (`collab.service.js:53-63`) | `user.id` | userId |
| `user_left` (`collab.service.js:67-72`) | `userId` | userId |
| `cursor` / `selection` / `temporal` (`collab.handlers.js:39-107`) | `userId` | userId |
| `user_away` / `user_back` (`collab.service.js:79-95`) | `userId` **+ `clientId`** | **clientId** |

Consequências práticas, todas já visíveis no código:

1. **Exclusão de si mesmo é por `userId`, não por `clientId`.** O snapshot `connected` inclui você (o `joinRoom` acontece antes do `getRoomUsers`, `collab.gateway.js:336-340`), e `sessionContext.clientId` é outro id, persistente e diferente. O roster passa `sessionContext.userId` explicitamente por causa disso (`online-users.control.js:226-232`); os overlays excluem pelos **dois** ids (`remote-cursors.layer.js:120-124`, `remote-selections.layer.js:177-178`). Trocar isso por `clientId` faz o usuário ver o próprio cursor e a si mesmo no roster. Sobre o id estável em si, ver [[client-id-estavel]].
2. **Duas abas do mesmo usuário colapsam em uma entrada.** Chave = userId, então a segunda aba sobrescreve a primeira e é filtrada como "self". O backend, porém, trata abas como sockets distintos (por isso `removeConnection` só anuncia `user_left` quando é o **último** socket daquele userId, `collab.gateway.js:445-460`).

> [!CONTRADICAO 2026-07-18] `docs/ui-ux-ebgeo.md` e `docs/visao-e-principios.md:239` descrevem o estado `ausente` aparecendo no roster durante a janela de graça, mas com o frame real do backend isso não acontece: `user_away` traz `clientId` (`collab.service.js:79-86`), `resolveKey` prefere `clientId` (`presence-store.js:53-55`), a entrada existente está chaveada por `userId`, e `_setAway` faz `this._users.get(key)` e **retorna sem fazer nada** quando não acha (`presence-store.js:507-518`). O badge "ausente" só é exercitado por testes que injetam a mutação à mão (`tests/integration/presence-store.test.js:198` usa `clientId`; `tests/e2e-ui/presence.spec.js:296-300` chama `userAway({ userId })` direto no store). O efeito colateral visível da janela de graça (o usuário **não** some e reaparece) continua correto, porque a remoção só ocorre no fim da graça, no servidor. Ver [[presenca-away-vs-saida]].

## Frames de saída e seus throttles

Tudo em `presence-bridge.js`:

- **Cursor**: `mousemove` do MapLibre, leading + um único trailing por janela de 80 ms (`CURSOR_THROTTLE_MS`, linha 61; handler em 299-331). Valores intermediários são **descartados**, nunca enfileirados.
- **Mapa ativo** (caso C): o backend **não tem handler `map_active`**. O mapa corrente pega carona no frame de cursor: na troca de mapa manda-se um cursor **sem posição** carregando o novo `mapId` (`presence-bridge.js:32-35, 153-158`), disparado por `MAP_LOCK_CHANGED` (linha 372), que é o sinal de fato de "mapa trocou". O store lê `mapId` de todo frame de presença (`presence-store.js:258-267`).
- **Temporal** (caso E): `TEMPORAL_CURSOR_CHANGED` dispara **por rAF** durante o playback; por isso passa pelo mesmo coalescing de 80 ms (`scheduleCoalesced`, linhas 245-265). Manda-se `{ cursor, label, playing }` com o rótulo **já formatado** ("D+3") para o par não precisar da config temporal do emissor (linhas 274-292). A linha do tempo é local por usuário, ver [[modulo-temporal]].
- **Seleção** (caso F): 2D via subscrição em `selection.features` do StateManager (linha 395), 3D via `MARKER_3D_CLICKED/_DESELECTED`, 360 via `MARKER_360_*` (linhas 405-418).
- **Briefing** (caso D): `BRIEFING_EDIT_STARTED/_ENDED` viram `briefing_edit_start/end`.

`mapId` nesses frames é o **nome** do mapa (`getCurrentMapNameSync`), não UUID. Os overlays filtram pelo mesmo resolvedor (`remote-selections.layer.js:70`, `remote-cursors.layer.js`). Se um lado mandar UUID e o outro comparar nome, o cursor some silenciosamente. Contexto do dualismo nome/UUID em [[dominio-local-vs-remoto]].

## Seleção é gated por edição; cursor e temporal não

`canBroadcastSelection()` checa `CREATE_FEATURE` no permission-guard (`presence-bridge.js:167-173`) e o servidor repete o gate: `handleSelection` retorna cedo para `read` e `comment` (`collab.handlers.js:82-85`). Ou seja, **Visualizador e Comentarista só recebem** seleção alheia, nunca emitem. Cursor e temporal ficam abertos de propósito (decisão de produto, comentada em `collab.handlers.js:71-74`). Ver [[permissoes-atlas]], [[permissao-vs-papel]], [[sintese-capacidades-por-papel]]; a via de participação do Comentarista é [[comentario-espacial]].

O gate está nos dois lados por motivos diferentes: o cliente evita tráfego inútil, o servidor é a autoridade (um cliente adulterado não fura o gate).

## As três superfícies e o "acompanha o arraste"

O frame de seleção carrega `surface` mais a **chave de escopo daquela superfície**: `mapId` para 2D, `tilesetId` para 3D, `photoName` para 360 (`presence-store.js:461-478`). Sem escopo, a seleção de um par dentro de um modelo 3D vazaria para outro modelo.

- 2D: `remote-selections.layer.js` resolve cada `featureId` para a geometria **local** (atlas compartilhado, a geometria já está aqui) e reconstrói a caixa com o mesmo `createSelectionBox` do highlight local, tingida com a cor do par (linhas 10-16).
- 3D: `3d_models_viewer_tool/tools/marker_tool_3d.js:518,881` ([[catalogo-3d]]).
- 360: `street_view_tool/street_view_viewer.js:1057,1336` ([[streetview-360]]).

O "acompanha o arraste" não vem de frames de seleção: o frame só carrega ids, nunca geometria. A caixa segue porque o overlay 2D também re-renderiza em `LAYERS_CHANGED` (`remote-selections.layer.js:47-52`), ou seja, quando a **operação** de movimento do par chega e altera a geometria local. Presença mostra *quem*; [[envelope-operacao]] traz o *quê*. Se o arraste parecer travado, o suspeito é o fluxo de operações, não a presença.

Detalhe fino: `featureMeta` (id + tipo por feição) viaja junto para o overlay 2D montar a caixa certa sem consultar o store (`presence-bridge.js:188-191`); ids de seleção sozinhos não carregam o tipo da ferramenta.

## Queda de rede: away/back com o mesmo clientId

Do lado servidor (`collab.gateway.js:464-497`):

- Fechamento **limpo** (qualquer código != 1006, ou `leave` explícito, que seta `intentionalLeave` e fecha com 1000, linhas 418-424): remove na hora, sem graça.
- Fechamento **anormal** (1006, queda de rede ou `terminate()` do heartbeat): marca `ws.away = true`, **mantém o socket morto na sala**, faz broadcast de `user_away` e agenda a remoção para `WS_AWAY_GRACE_MS` (padrão **120 s**, `config.js:89`).
- Reconexão com o **mesmo clientId** dentro da janela cancela o timer, expulsa o socket velho da sala (para não duplicar presença) e faz broadcast de `user_back` (`collab.gateway.js:305-312`).

O heartbeat (`WS_HEARTBEAT_INTERVAL_MS`, padrão 30 s, `config.js:84`) tem duplo papel: derruba socket que não pongou **e** re-reconcilia a autorização contra o banco a cada tick, então um downgrade/revogação de compartilhamento tem staleness limitado a um heartbeat (`collab.gateway.js:284-289`). Ver [[compartilhamento-atlas]]. Pendência conhecida (`docs/ui-ux-ebgeo.md:220-223`): a **remoção total** de um membro conectado não o desconecta, ele só perde acesso ao reconectar.

Isso é o oposto de [[presenca-tempo-real]] ingênua: a UX exigida é "não pisca". Sem a janela, cada blip de rede tiraria e recolocaria o usuário no roster de todos.

## Efemeridade: nada disso é persistido nem enfileirado

- No servidor, cursor, mapa corrente, seleção e temporal vivem **em memória no objeto `ws`** (`collab.service.js:20-25`). A tabela `active_sessions` guarda só connect/disconnect. Escrita em banco por cursor seria desperdício.
- No cliente, presença é **best-effort**: todo broadcast começa com `if (!wsClient.isConnected()) return`. Nada vai para a fila offline. Presença nunca entra em [[fila-operacoes-outbound]]; misturar as duas coisas faria o usuário "reviver" cursores de dez minutos atrás no reconnect.
- Sob backpressure local, frames `cursor|selection|temporal` são **descartados** quando o `bufferedAmount` passa de 1 MiB (`ws-client.js:35-38, 522-525`). No servidor, socket afogado além do teto é `terminate()` para reconectar e replayar, e operações duráveis nunca são descartadas (`collab.rooms.js:68,102`). A assimetria é deliberada: perder um cursor é invisível, perder uma operação é perda de dado.
- Existe classificação adaptativa de qualidade de conexão (`collab.quality.js`) que sugere intervalo de batch, precisão geométrica e viewport-only por banda de RTT; a truncagem é **transport-only**, o JSONB persistido mantém precisão cheia. Ver [[qualidade-conexao-adaptativa]].

## Ciclo de vida e teardown

`startPresence({ map })` é idempotente (`presence-bridge.js:338-342`). `stopPresence()` (linhas 425-456) precisa fazer **cinco** coisas, e esquecer qualquer uma vaza: desliga o `mousemove` do mapa, solta a subscrição de seleção do StateManager, `cleanup(state)` para timers e subscrições de bus, sobrescreve os seis eventos WS que o bridge possui com no-op (o `ws-client.on()` guarda **um handler por evento**, então re-registrar um no-op é como se desregistra) e por fim `presenceStore.clear()`.

No logout, o socket fecha, a presença é limpa e o dado remoto é apagado (`docs/visao-e-principios.md:174`); ver [[sessao-boot-e-ciclo-de-vida]] e [[store-origin-local-remoto]]. Em modo local/anônimo nada disso liga: presença existe apenas para um [[atlas]] remoto conectado.

## Identidade visual determinística

`presence-colors.js` deriva cor por hash djb2 sobre a chave (userId preferencialmente), de uma paleta de 14 tons escuros o bastante para texto branco. Mesma chave, mesma cor, em **todo cliente**: o par é reconhecível pela cor no roster, no cursor e na caixa de seleção. Não randomize nem atribua cor por ordem de chegada, isso quebra a correspondência entre superfícies e entre máquinas. `getInitials` monta o avatar (primeira + última palavra, acentos preservados).

## Limites operacionais

O estado de salas e presença é um `Map` **em memória por processo**, sem Redis nem pub/sub (`docs/deploy.md:500-506`). Logo: **não escala horizontalmente**. Com duas réplicas, `broadcastToRoom` alcança só os clientes daquela instância e a presença fica partida (sintoma no runbook: "broadcast WS não chega a alguns clientes", `deploy.md:562`). Caminho de menor risco em produção: **uma instância**, escala vertical; alternativa é sticky sessions + backplane. O WS vive no mesmo processo HTTP (`createServer(app)` + handler de `upgrade`), então também não dá para escalar WS separado. No NGINX, sem `proxy_http_version 1.1` + `Upgrade`/`Connection "upgrade"`, e sem rotear exatamente `/api/v1/collab` (o backend responde 404 a outro pathname), a presença simplesmente não existe. Ver [[deploy-backend]] e [[sintese-limites-collab]].

## Checklist de armadilhas

1. Não assuma `clientId` como chave de presença: na prática as entradas são chaveadas por `userId` (só `user_away`/`user_back` mandam clientId, e é justamente aí que o caminho quebra).
2. Exclusão de si mesmo no roster é por `userId`; nos overlays, pelos dois ids.
3. `mapId` de presença é **nome** de mapa, não UUID.
4. Não enfileire frame de presença offline e não persista posição de cursor.
5. Ao mexer em seleção remota, lembre do escopo por superfície (mapId/tilesetId/photoName) e do gate de edição nos dois lados.
6. Ao adicionar um sinal novo de awareness de alta frequência, coalesça (leading + um trailing) e marque-o como coalescável no backpressure.
7. Todo `on()` novo no bridge precisa do par correspondente em `stopPresence()`.

Panorâmica complementar em [[presenca-colaborativa]].

## Fontes

- `docs/acoes-interface-multiusuario.md`: awareness declarado como requisito (linha 8) e a lista canônica do que expor (§4, linhas 584-590); classificação por ação de o que é local, o que é broadcast e o que é awareness.
- `docs/ui-ux-ebgeo.md`: descrição de produto da presença (roster, cursores, seleção que acompanha o arraste, gate de edição, §"Presença / awareness", linhas 150-156); "Vendo agora" no diálogo de compartilhamento; pendência da revogação ao vivo.
- `docs/visao-e-principios.md`: presença em tempo real como parte do modelo sem locks (linha 18); limpeza de presença no logout (linha 174); presença tolerante a queda via `WS_AWAY_GRACE_MS` (linha 239).
- `docs/deploy.md`: WS no mesmo processo HTTP, requisitos de upgrade no NGINX (§7) e o limite de não escalar horizontalmente sem backplane (linhas 500-506, 562).
- Código (manda sobre a prosa): `src/js/presence/{presence-store,presence-bridge,remote-cursors.layer,remote-selections.layer,online-users.control,presence-colors}.js`, `src/js/store/sync/ws-client.js`, `src/js/map_sig.js:622-632`; backend `src/modules/collab/{gateway,handlers,rooms,service,quality}.js` e `src/config.js:84,89`.
