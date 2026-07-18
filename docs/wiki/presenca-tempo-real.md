# Presença em tempo real: cursores, seleção e ciclo de vida

Presença combina cursor e seleção broadcast por atlas (o cliente filtra por mapId e auto-esconde cursores inativos) com os eventos user_joined/user_left/user_away/user_back que descrevem quem está na sala.

## O que é presença aqui

Presença é o estado **efêmero** da colaboração: quem está na sala, onde o mouse de cada um está, o que cada um selecionou, qual mapa está vendo, qual instante da timeline está olhando e se está editando um briefing. Nada disso é operação, nada disso persiste: não entra na fila outbound (ver [[fila-operacoes-outbound]]), não vira linha em `operations` ([[tabela-operations]]) e não participa do LWW ([[modelo-conflito-lww]]). É best-effort puro: se o socket está fechado, o frame simplesmente não é enviado (`presence-bridge.js:140-145` faz `if (!wsClient.isConnected()) return`).

O transporte é o mesmo socket das operações ([[canal-collab-websocket]], [[websocket-collab]]); a arquitetura de camadas está em [[presenca-colaborativa]] e [[presenca-colaboracao]].

## Broadcast por atlas, filtro por mapa no cliente

O servidor **não** tem sub-canal por mapa: toda mensagem de presença vai para todos os clientes conectados ao atlas ([[atlas]]), independente do mapa ativo. É responsabilidade do cliente filtrar.

O filtro vive em dois lugares:

- `presence-store.js:432-448` (`getCursors(mapId)`) descarta cursores cujo `cursor.mapId` não bate.
- `remote-cursors.layer.js:127-129` recusa renderizar qualquer coisa quando o mapa ativo é `null` (chamar `getCursors()` sem argumento devolveria cursores de todos os mapas, e isso seria um bug visual).

O mesmo vale para seleção, com um detalhe extra: `getSelections(surface, scopeKey)` (`presence-store.js:461-492`) escopa por superfície, e a chave de escopo muda conforme a superfície: `mapId` para `2d`, `tilesetId` para `3d`, `photoName` para `360`. Um marcador selecionado dentro de um modelo 3D só aparece para quem está no mesmo tileset.

**Armadilha do `mapId`.** O bridge carimba `getCurrentMapNameSync()` nos frames de saída (`presence-bridge.js:144`, `:157`, `:196`), ou seja, o **nome** do mapa, não o UUID. O overlay de cursores resolve o mapa ativo com a mesma função (`remote-cursors.layer.js:67-69`) justamente porque as duas pontas precisam usar a mesma chave. Se alguém "corrigir" um dos lados para UUID sem corrigir o outro, o filtro nunca casa e **nenhum cursor remoto renderiza**, sem erro nenhum no console.

> [!CONTRADICAO 2026-07-18] `docs/guias/04-websocket-collab.md` §3.2 e `docs/guias/06-presenca-imagens.md` §1.1 documentam `mapId` como UUID do mapa (`"mapId": "map-uuid"`); o código em `src/js/presence/presence-bridge.js:144` envia `getCurrentMapNameSync()`, o nome do mapa. O backend trata o campo como opaco (só reencaminha), então funciona, mas o contrato real hoje é "chave de mapa acordada entre clientes", não UUID.

## Cursor: throttle, coalescing e backpressure

O caminho de saída do cursor é `map.on('mousemove')` → throttle leading + um único trailing → `wsClient.sendCursor`:

- Janela de throttle: **80 ms** (`CURSOR_THROTTLE_MS`, `presence-bridge.js:61`), não os 50 ms do exemplo do guia.
- O trailing guarda só a **última** posição (`presence-bridge.js:316-330`); posições intermediárias são descartadas, nunca enfileiradas. Presença atrasada é pior que presença perdida.
- Uma segunda rede de proteção existe no transporte: `ws-client.js:34-37` marca `cursor`, `selection` e `temporal` como coalescáveis e `ws-client.js:522-526` **descarta** esses frames quando `socket.bufferedAmount` passa de 1 MiB. Operações duráveis e frames de controle nunca são descartados. Isso importa em conexão ruim, e é complementar ao [[qualidade-conexao-adaptativa]].

O mapa ativo pega carona no frame de cursor: como o backend não tem handler `map_active`, uma troca de mapa dispara um cursor **sem posição** carregando só o novo `mapId` (`presence-bridge.js:153-158`, acionado por `MAP_LOCK_CHANGED` em `:372`). O store lê `mapId` de todo frame de presença e atualiza `currentMap` (`presence-store.js:258-267`).

## Seleção: editor-gated na saída, aberta na entrada

Diferente do cursor, a **seleção só é transmitida por quem pode editar**. `canBroadcastSelection()` (`presence-bridge.js:167-173`) consulta `checkPermission('CREATE_FEATURE')`; um Comentarista ou Visualizador **recebe** seleções dos pares mas nunca transmite a sua. O gate espelha o `handleSelection` do backend. Ver [[permissoes-atlas]] e [[permissao-vs-papel]] (e lembre: para autorizar escrita, cheque `permission !== 'read'`, não `role`).

Como o gate mapeia para a capacidade EDIT, ele é **permissivo no store local** e restritivo só num atlas remoto conectado, coerente com [[store-origin-local-remoto]].

O frame 2D leva `featureMeta` (`{id, type}` por feição, `presence-bridge.js:186-196`) para o par desenhar a caixa de destaque sem consultar o próprio store, já que o id sozinho não diz o tipo de ferramenta.

Detalhe de UX importante em `presence-store.js:288-298`: numa **desseleção** (`featureIds` vazio → `selection = null`), a superfície do frame é capturada **antes** de zerar, para que o evento `PRESENCE_SELECTIONS_CHANGED` ainda diga qual superfície precisa apagar o destaque. Sem isso, o realce do par ficaria preso na tela.

## Ciclo de vida da sala: joined / left / away / back

Quatro frames descrevem a sala, e o cliente os roteia em `presence-bridge.js:89-114`:

| Frame | Efeito no store | Observação |
|---|---|---|
| `user_joined` | `userJoined(msg.user)` | O descritor vem **aninhado** em `user`; o resto vem no topo |
| `user_left` | `userLeft(msg)` | Remoção definitiva |
| `user_away` | `userAway(msg)` | Marca `away = true`, **não** remove |
| `user_back` | `userBack(msg)` | Limpa `away` |

A assimetria do `user_joined` já causou bug: passar a mensagem inteira fazia `resolveKey()` procurar `id`/`userId`/`clientId` no topo, não achar nada e **descartar o join em silêncio**, deixando o par invisível no roster. O comentário em `presence-bridge.js:96-99` documenta isso. Se você adicionar um frame novo de presença, decida onde fica o descritor e teste o roteamento.

A distinção away/left é o coração de [[presenca-away-vs-saida]]: `away` significa queda anormal (close 1006) dentro da janela de graça, e o usuário continua listado, esmaecido (`online-users.control.js:279-317`). Reconectar com o **mesmo `clientId`** cancela a remoção, daí a importância de [[client-id-estavel]]. Na saída intencional o cliente envia `{type:'leave'}` antes de fechar (`ws-client.js:131-132`), evitando dois minutos de fantasma na lista dos pares.

O snapshot inicial vem no `connected.usersOnline` e substitui a membresia inteira via `setInitial` (`presence-store.js:185-197`) — a lista **inclui você mesmo** e inclui quem está `away` (com `status`, lido em `presence-store.js:148,164`).

## Chaveamento e exclusão do próprio usuário

O store é chaveado por `clientId`, com fallback para `userId` e depois `id` (`presence-store.js:48-64`), porque um mesmo usuário pode ter várias abas e porque nem todo frame carrega `clientId`. Isso cria uma armadilha concreta: frames de cursor carregam só `userId`, então a entrada acaba chaveada por `userId`. Por isso o overlay exclui o próprio usuário por **ambos** os ids (`remote-cursors.layer.js:139-142`); excluir só por `clientId` faria você ver o próprio cursor.

Consequência do outro lado: o roster chama `getOthers(sessionContext.userId)` (`online-users.control.js:232`), então **outras abas suas não aparecem** na lista de online. É deliberado, mas contradiz o JSDoc do arquivo, que ainda fala em `clientId`.

Cor e iniciais são derivadas determinísticamente da chave (djb2 sobre uma paleta fixa de 14 cores, `presence-colors.js:33-52`), de modo que a mesma pessoa tem a mesma cor no roster e no cursor, em todos os clientes, sem coordenação com o servidor.

## Eventos e desacoplamento

O store é puro (sem DOM) e publica três eventos no barramento (`presence-store.js:520-551`):

- `PRESENCE_CHANGED` `{users}` — membresia, `away`, `currentMap`, contagem de seleção (consumido pelo roster).
- `PRESENCE_CURSORS_CHANGED` `{mapId}` — evento leve por movimento de cursor.
- `PRESENCE_SELECTIONS_CHANGED` `{surface}` — evento leve por mudança de seleção.

A separação existe para que um movimento de mouse a 12 fps não force o roster a re-renderizar. Se você acrescentar um consumidor, assine o evento mais estreito que resolve o problema.

## Ciclo de vida do bridge

`startPresence({ map })` (chamado em `map_sig.js:632`) é idempotente e registra: handlers WS de entrada, `mousemove` no mapa, e assinaturas de bus para mapa ativo, temporal ([[modulo-temporal]]), briefing e seleção 2D/3D/360. `stopPresence()` desfaz tudo e chama `presenceStore.clear()`.

Cuidado no teardown: `wsClient.on()` guarda **um único handler por evento**, então `stopPresence` "desregistra" sobrescrevendo com no-ops (`presence-bridge.js:445-449`). Se você registrar outro consumidor do mesmo evento WS em outro módulo, um dos dois some sem aviso.

## O que NÃO existe (apesar do guia)

> [!CONTRADICAO 2026-07-18] `docs/guias/06-presenca-imagens.md` §1.3 descreve um `CursorManager` que auto-esconde o cursor após 5 s sem movimento (`setTimeout` + `setOpacity(0)`); o `RemoteCursorsLayer` real (`src/js/presence/remote-cursors.layer.js:116-161`) **não tem timer nenhum**: o marcador some quando o usuário sai da sala, troca de mapa ou some do store, e não por inatividade. Um par parado mantém o cursor visível indefinidamente. O código do guia também é Leaflet (`L.divIcon`, `L.marker`), enquanto o app usa `maplibregl.Marker` — trate aquele trecho como pseudocódigo ilustrativo, não como contrato.

Também não existem, por design: replay de frames de presença perdidos durante desconexão (ver [[snapshot-e-pull-incremental]] para o que **é** recuperável), lock de edição a partir do indicador de briefing (é awareness advisory) e escala multi-instância — presença, salas e timers de graça vivem na memória de uma única instância. Ver [[sintese-limites-collab]].

## Checklist para não errar

- Filtre cursor e seleção por chave de mapa, e use a **mesma** função nas duas pontas.
- Nunca enfileire presença: descarte o frame antigo, mande o novo.
- Trate `user_away` como "esmaeça", nunca como "remova".
- Exclua o próprio usuário por `clientId` **e** `userId`.
- Persista o `clientId` ([[client-id-estavel]]); sem ele a reconexão duplica a presença.
- Envie `leave` na saída intencional.
- Não use presença como fonte de verdade de dados: ela é descartável por construção ([[aplicacao-operacoes-remotas]] é quem move estado real).

## Fontes

- `docs/guias/04-websocket-collab.md`: protocolo dos frames `cursor`/`selection`/`temporal`, tabela de tipos de mensagem, payload do `connected` com `usersOnline` e `status`, semântica away vs remove e a nota de que salas são por atlas (o cliente deve filtrar por `mapId`).
- `docs/guias/06-presenca-imagens.md`: fluxos de cursor e seleção ponta a ponta, checklist de presença, e a implementação de referência do `CursorManager` (Leaflet, com auto-hide) que diverge do cliente real.
- `src/js/presence/presence-store.js`: chaveamento por clientId com fallback, normalização de cursor/seleção, escopo por superfície, flag `away`, eventos emitidos.
- `src/js/presence/presence-bridge.js`: throttle de 80 ms, piggyback do mapa ativo no frame de cursor, gate de seleção por permissão de edição, ciclo start/stop.
- `src/js/presence/remote-cursors.layer.js`: reconciliação de marcadores, filtro por mapa ativo, exclusão do próprio usuário por dois ids, ausência de auto-hide.
- `src/js/presence/presence-colors.js`, `src/js/presence/online-users.control.js`: cor determinística por usuário e renderização do roster com estado ausente.
- `src/js/store/sync/ws-client.js`: frames coalescáveis descartados sob backpressure (1 MiB), envio de `leave` no disconnect intencional.
