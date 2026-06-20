# Fase 8 — Colaboração ponta a ponta (opcional, frontend-pesado)

> **✅ STATUS: PEÇAS DE BACKEND PRONTAS; cliente é frontend.** O servidor de colaboração já está
> completo: handshake JWT, salas por atlas, broadcast de cursor/seleção/operação, awareness de
> briefing, **ack por operação (`results[]`) + idempotência (Fase 1)**, **monitor de qualidade
> adaptativo (Fase 1)**, **vocabulário de papéis no `connected` (Fase 1)** e agora **handshake com
> `clientId` estável** (`?clientId=`, com fallback) para idempotência/presença na reconexão.
> **Follow-ups (frontend/infra):** o cliente WebSocket (transição ONLINE, `RemoteRepository`, loop
> send/ack/dequeue, fila offline) é **trabalho do `ebgeo_web`**; `user_away` vs remove e Redis pub/sub
> para escala horizontal são opcionais (estado efêmero em memória numa instância hoje).
> **Status:** opcional. Só inicie depois de **fase-1** (sync multiusuário) e **fase-5**
> (multi-org/identidade) concluídas. Esforço: **Alto**, mas o grosso é **frontend** — as peças de
> backend desta fase são pequenas e bem delimitadas (handshake com `clientId` estável, away vs.
> remove, Redis opcional). Leia `_padroes.md` e `00-visao-geral.md` antes.
>
> **Decisão de plano (D1 em `00-visao-geral.md`):** a recomendação é fazer fase-0/1 já e ativar o
> cliente ponta a ponta **depois**, quando houver banda de frontend. Esta fase descreve esse "depois".

---

## 1. Objetivo & contexto

Hoje o EBGeo tem um **servidor de colaboração funcionando** e um **cliente 100% inerte**. O servidor
WebSocket (`src/modules/collab/`) já faz handshake JWT, salas por atlas, broadcast de
`cursor`/`selection`/`operation`/`operations`, awareness de briefing, ack por operação (após fase-1)
e fechamento de sala em delete de atlas. O que **não existe** é o cliente que fecha o loop.

**Fato verificado (fonte de verdade — D2/2.3 da avaliação):** no frontend o subsistema de sync está
**inerte por design**. Não existe nenhum `new WebSocket`, o `connectionState` **nunca transiciona
para ONLINE**, e não há `RemoteRepository`. Todo o aparato (fila de operações, `OperationDispatcher`,
`OperationFactory`, Lamport clock) está **cabeado mas nunca rodou**. Enquanto isso não mudar, o atlas
é, na prática, **persistência remota REST** (push/pull manual de sync), sem tempo real.

**Lição central do protótipo `prototipo_colaboracao_tempo_real`** (org `1cgeo`, o repo que tem um loop
colaborativo de fato rodando sobre o mesmo stack que o EBGeo quer — MapLibre + react-map-gl + Zustand +
React Query): mesmo lá, **o cliente está atrás do servidor**. O loop fechado de verdade é **só
cursores + comentários**. O cliente do protótipo **não** escuta eventos de feature, **não** envia
`clientId` no handshake, **não** tem fila offline, **não** trata `version`/conflito, **não** faz sync
incremental — embora o backend dele implemente tudo isso. Ou seja: o protótipo **prova o backend de
colaboração, não o cliente completo**.

Portanto esta fase é majoritariamente **construir o cliente de transporte** (no repositório de
frontend, fora deste backend) e adicionar um punhado de ajustes de backend que o cliente ponta a ponta
exige:

1. **Handshake com `clientId` estável** (hoje o servidor gera um `crypto.randomUUID()` por conexão →
   reconexão perde idempotência e presença "pisca").
2. **Distinguir queda de rede de saída intencional** (marcar `away`, não remover da lista).
3. **Auto-rejoin + keepalive** robusto (parte cliente, parte protocolo).
4. **Opcional: Redis pub/sub** para escala horizontal (broadcasts hoje só alcançam a mesma instância).

> **Onde está cada peça:** idempotência por `op_id`, `batch + ack`, viewport loading (`GET` por
> bounds) e monitor de qualidade **vêm da fase-1**. Esta fase **consome** essas peças no cliente; não
> as reimplementa no backend. O CAVEAT do JSONB sem PostGIS para o viewport loading **é herdado da
> fase-1** (filtro espacial server-side não está disponível sem mudança — ver §5).

### Limitação compartilhada de escala

Estado de tempo real (salas, presença, cursores, seleções) vive **em memória, em uma única instância**
(`src/modules/collab/collab.rooms.js`, `const rooms = new Map()`). `broadcastToRoom` só alcança
clientes conectados **à mesma instância de processo**. Sem Redis, escalar horizontalmente o WS quebra
o broadcast cross-instância. O durável (operations, atlas, features) já está no Postgres — só o efêmero
precisa de pub/sub. A Tarefa 6 (opcional) cobre isso.

---

## 2. Pré-requisitos / dependências de outras fases

| Depende de | O que esta fase consome dali |
|------------|------------------------------|
| **fase-0** (transitivo) | Hardening base: rate limit, Joi no `/sync`, helmet, auth timing-safe. |
| **fase-1** | **Idempotência por `op_id`** (`ON CONFLICT DO NOTHING` no log de operations) — base do reenvio idempotente. **Batch + ack por operação** (`acks[]` com `{opId, serverVersion, idempotent?}`) — base do dequeue. **Viewport loading** (`GET /atlas/:id/sync/bounds?...`) — base do carregamento por bounds. **Monitor de qualidade** (mensagens `adaptive-settings`). **Modelo de conflito decidido** (LWW-por-chegada + idempotência) e **vocabulário de papéis** (owner/editor/viewer ↔ owner/write/read). |
| **fase-5** | **Identidade única**: o JWT carrega `sub`, `role`, `organization_id`. O `clientId` estável precisa ser único por dispositivo dentro da org; presença e auditoria de sessão referenciam `organization_id`. |

**Bloqueio:** não inicie sem fase-1 e fase-5 concluídas. O `findingsDigest` desta fase assume que o
ack por operação e a idempotência por `op_id` já existem no backend.

---

## 3. Decisões de arquitetura aplicáveis

1. **LWW-por-chegada + idempotência por `op_id`** (D2, decidido na fase-1). O cliente **não** precisa
   de relógio lógico para correção — só de `op.id` estável (chave de idempotência) e `clientId`
   estável. O `crdt` morto (`src/crdt`) **não** é religado por esta fase.
2. **Não adotar Yjs/Automerge.** O motor próprio (LWW + log append-only por `server_version` sequence)
   é o ajuste certo para feições geográficas (atributo + geometria). O protótipo chegou
   independentemente à mesma conclusão (versão otimista + idempotência, sem CRDT lib). Yjs só se
   justificaria, isolado, para edição de **texto livre** caractere-a-caractere — fora de escopo.
3. **`clientId` estável vem do cliente, não do servidor.** Mudar o handshake para aceitar um
   `clientId` fornecido pelo cliente (persistido em `localStorage`) — essencial para idempotência
   sobreviver à reconexão e para presença não duplicar.
4. **`server_version` (sequence monotônica) é o cursor de sync**, não `updated_at` (relógio de
   parede). O cliente guarda `lastVersion` e pede incremental a partir dele. (Já é assim no backend;
   o cliente deve respeitar.)
5. **Away, não remove.** Distinguir desconexão de rede (manter na lista como `away`, com TTL) de saída
   intencional (`leave`/close limpo → remover). Evita o "usuário pisca na lista".
6. **Redis é opcional e aditivo.** Pub/sub para o efêmero; o durável continua no Postgres. Recomendação
   abaixo (Tarefa 6): **adiar** até haver requisito real de multi-instância; manter a abstração de
   broadcast pronta para receber o adapter.

### Contrato de eventos de referência (do protótipo) — **carregar o CONTRATO, não o transporte**

O protótipo usa **Socket.IO**; o EBGeo usa **`ws` puro**. Não copie o transporte. Use a lista abaixo
como **mapa de capacidades** para nomear/cobrir as mensagens do cliente EBGeo. A coluna "EBGeo hoje"
mostra o equivalente já existente em `src/modules/collab/collab.gateway.js`.

| Categoria | Eventos do protótipo (Socket.IO) | EBGeo hoje (`ws` puro) |
|-----------|----------------------------------|------------------------|
| Conexão/qualidade | `connection-info`, `auto-rejoin`, `latency-check(-response)`, `connection-quality`, `adaptive-settings`, `keepalive-ping` | `connected` (out), `ping`/`pong`; `adaptive-settings` vem da fase-1 |
| Sala/presença (in) | `join-map`, `leave-map`, `map-heartbeat`, `get-updates-since` | join via handshake na URL; `sync_request` |
| Sala/presença (out) | `user-info`, `users`, `user-joined`, `user-disconnected`, `user-away`, `sync-updates` | `connected.usersOnline`, `user_joined`, `user_left`, `sync_response`; **`user_away` é novo (Tarefa 2)** |
| Cursor | `mousemove` → `user-move` | `cursor` (in) → `cursor` (out broadcast) |
| Seleção | `select-features` → `features-selected` | `selection` (in) → `selection` (out broadcast) |
| Features | `batch-feature-operations`, `get-features-in-bounds`, `delete-features` (in); `features-loaded`, `feature-created/updated/deleted`, `feature-update-conflict`, `batch-operation-results`, `use-viewport-loading` (out) | `operation`/`operations` (in) → `ack`/`ack_batch` + broadcast `operation`/`operations` (out); bounds via `GET` da fase-1 |
| Polígono (drag colaborativo efêmero) | `drag-polygon` → `polygon-dragging` (sem persistir) | **não existe — opcional, Tarefa 5** |
| Comentários/respostas | `create/update/delete-comment`, `update-comment-position`, `*-reply`, `batch-comment-operations` | comentários viajam dentro de `properties` da feição via op de sync normal; **sem canal dedicado** |

### Envelope de operação (offline/batch) — referência verbatim do protótipo

```ts
{ id: string,          // id da operação no cliente = chave de idempotência (== op.id no EBGeo)
  type: 'create-feature'|'update-feature'|'delete-feature'|'create-comment'|...,
  timestamp: number,   // epoch ms do cliente
  offline?: boolean,
  data: { ... } }      // payload por tipo; update exige version
```

No EBGeo o envelope equivalente já existe (`{id, entityType, operationType, entityId, mapId, data,
timestamp, clientId}`). O cliente deve usar `op.id` como chave de idempotência (a UNIQUE constraint
chega na fase-1) e fazer **dequeue** ao receber o ack correspondente (`ack`/`ack_batch`).

---

## 4. Tarefas

> **Tarefas de backend (implementáveis neste repositório):** 1, 2, 6.
> **Tarefas de frontend (descritas como contrato, implementadas no repo do SPA):** 3, 4, 5.
> **Tarefa transversal:** 7 (testes e2e).

---

### Tarefa 1: Aceitar `clientId` estável no handshake WebSocket

**Objetivo:** parar de gerar `clientId` aleatório por conexão no servidor; aceitar um `clientId`
fornecido pelo cliente (persistido em `localStorage` no frontend) para que idempotência e presença
sobrevivam a reconexões.

**Arquivos afetados:**
- `src/modules/collab/collab.gateway.js` (modificar `attachWebSocket` / `onConnection`)

**Padrão de código:** `_padroes.md` §1 (módulo collab já existe); cite o trecho atual
`collab.gateway.js:148` (`const clientId = crypto.randomUUID();`).

**Estado atual (verificado):** em `collab.gateway.js:81-82` lê-se `atlasId` e `token` da query string;
em `collab.gateway.js:148` o servidor faz `const clientId = crypto.randomUUID();` — **ignorando**
qualquer id do cliente. Logo, a mesma aba que reconecta vira um cliente "novo" toda vez.

**Implementação:**
1. No `server.on('upgrade')`, ler também `url.searchParams.get('clientId')`.
2. Validar o `clientId` recebido: deve casar `^[a-zA-Z0-9_-]{8,64}$` (UUID v4 ou nanoid). Se ausente
   ou inválido, **gerar** um `crypto.randomUUID()` (fallback — preserva compatibilidade com clientes
   antigos) e devolvê-lo no `connected` para o cliente persistir.
3. Passar o `clientId` resolvido para `onConnection(ws, user, atlasId, permission, clientId)`.
4. Em `onConnection`, usar o `clientId` recebido em vez de gerar um novo; manter o resto igual
   (`ws.clientId = clientId`, `collabService.createSession(...)`, `connected.sessionId = clientId`).

**Exemplo (estilo do repo, ES Modules):**
```javascript
// collab.gateway.js — dentro de server.on('upgrade'), após validar atlasId/token
const CLIENT_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const rawClientId = url.searchParams.get('clientId');
const clientId = (rawClientId && CLIENT_ID_RE.test(rawClientId))
  ? rawClientId
  : crypto.randomUUID(); // fallback para clientes antigos

wss.handleUpgrade(request, socket, head, (ws) => {
  onConnection(ws, { /* ...user... */ }, atlasId, permission, clientId);
});

// onConnection(ws, user, atlasId, permission, clientId) — remover a geração interna:
function onConnection(ws, user, atlasId, permission, clientId) {
  ws.clientId = clientId;
  // ... resto inalterado ...
  ws.send(JSON.stringify({ type: 'connected', sessionId: clientId, /* ... */ }));
}
```

**Critérios de aceitação:**
- [ ] Conexão com `?clientId=<id válido>` resulta em `ws.clientId === <id>` e `connected.sessionId === <id>`.
- [ ] Conexão **sem** `clientId` (ou inválido) ainda conecta e recebe um `sessionId` gerado (não regride o cliente atual).
- [ ] Reconectar com o mesmo `clientId` reusa a mesma linha em `active_sessions` (o `INSERT_SESSION`
      já é `ON CONFLICT (user_id, atlas_id, client_id) DO UPDATE` em `collab.service.js:8-13`).
- [ ] Caminho de op idempotente: reenviar a mesma `op.id` (fase-1) após reconexão **não** duplica.

**Testes:**
- `tests/ws/collab.test.js`: conectar com `clientId` fixo → assertar `connected.sessionId`; reconectar
  com o mesmo `clientId` → assertar que `active_sessions` não cresce; conectar sem `clientId` → assertar
  que um `sessionId` válido volta.

**Dependências:** fase-1 (idempotência por `op_id`) — o ganho de reconexão idempotente só se materializa
com a UNIQUE constraint da fase-1. A Tarefa 1 pode ser mergeada antes, mas seu teste idempotente
depende da fase-1.

---

### Tarefa 2: Away vs. remove — distinguir queda de rede de saída intencional

**Objetivo:** quando um WebSocket cai por rede (close não-limpo / heartbeat estourado), marcar o usuário
como `away` por uma janela de graça (broadcast `user_away`) em vez de removê-lo imediatamente da lista
de presença. Saída intencional (close code limpo) remove na hora.

**Arquivos afetados:**
- `src/modules/collab/collab.gateway.js` (modificar `onClose` e o `heartbeatInterval`)
- `src/modules/collab/collab.service.js` (adicionar `broadcastUserAway`)
- `src/modules/collab/collab.rooms.js` (marcar `ws.away`/timer no objeto da conexão)

**Padrão de código:** `_padroes.md` §1; broadcast segue o padrão de `broadcastUserLeft`
(`collab.service.js:105-110`).

**Estado atual (verificado):** `onClose` (`collab.gateway.js:252-263`) sempre faz `leaveRoom` +
`deleteSession` + `broadcastUserLeft` — sem distinguir o motivo. O `heartbeatInterval`
(`collab.gateway.js:129-137`) chama `ws.terminate()` em clientes inativos, o que também dispara
`onClose`. Resultado: oscilação de rede = "usuário pisca na lista".

**Implementação:**
1. No `ws.on('close', (code) => onClose(ws, code))`, passar o **close code** ao `onClose`.
2. Em `onClose(ws, code)`: se `code === 1000` (close limpo/intencional) ou o cliente enviou
   `leave` explícito (ver passo 4) → remover imediatamente (`leaveRoom` + `deleteSession` +
   `broadcastUserLeft`). Caso contrário (rede caiu / `terminate`) → **marcar away**:
   broadcast `user_away` com `{userId, clientId}`, manter a sessão por `AWAY_GRACE_MS` (ex.: 120000,
   alinhado à janela de 2 min do protótipo), e só então remover de fato se não houver reconexão com o
   mesmo `clientId`.
3. Na reconexão (Tarefa 1), se existir uma sessão `away` com o mesmo `clientId`, **cancelar o timer de
   remoção** e broadcastar `user_joined` (ou um `user_back`) para limpar o estado `away` nos peers.
4. Adicionar um tipo de mensagem `leave` no `handleMessage` para saída intencional explícita (cliente
   manda antes de fechar) → trata como remoção imediata.

**Exemplo:**
```javascript
// collab.gateway.js
const AWAY_GRACE_MS = config.ws.awayGraceMs ?? 120000;

function onClose(ws, code) {
  const intentional = code === 1000 || ws.intentionalLeave === true;
  if (intentional) {
    leaveRoom(ws.atlasId, ws);
    collabService.deleteSession(ws.userId, ws.atlasId, ws.clientId);
    collabService.broadcastUserLeft(ws.atlasId, ws.userId, ws.clientId);
    return;
  }
  // Rede caiu: marcar away, manter por janela de graça
  collabService.broadcastUserAway(ws.atlasId, ws.userId, ws.clientId);
  scheduleAwayRemoval(ws); // setTimeout(AWAY_GRACE_MS) → leaveRoom + deleteSession + broadcastUserLeft
}
```

**Critérios de aceitação:**
- [ ] Close com code `1000` ou mensagem `leave` → `user_left` imediato; sessão removida de `active_sessions`.
- [ ] Close não-limpo (rede) → `user_away` imediato; `user_left` só após `AWAY_GRACE_MS` sem reconexão.
- [ ] Reconexão com o mesmo `clientId` dentro da janela → cancela a remoção; peers recebem `user_joined`/`user_back`.
- [ ] `getRoomUsers` (`collab.rooms.js:75`) ganha um campo `status: 'online' | 'away'` por cliente.

**Testes:**
- `tests/ws/collab-broadcasts.test.js`: simular close não-limpo → assertar `user_away` e ausência de
  `user_left` imediato; reconectar dentro da janela → assertar cancelamento; close limpo → assertar
  `user_left` imediato. (Use uma janela curta via `config.ws.awayGraceMs` no `NODE_ENV=test`.)

**Dependências:** Tarefa 1 (precisa do `clientId` estável para casar reconexão com sessão `away`).

---

### Tarefa 3: Cliente WebSocket — handshake, transição ONLINE e `RemoteRepository` (FRONTEND)

> **Tarefa de frontend.** Descrita aqui como contrato a ser implementado no repositório do SPA. O
> backend não muda além do que as Tarefas 1, 2 e 6 entregam.

**Objetivo:** construir a camada de transporte que hoje é no-op: abrir `new WebSocket`, transicionar
`connectionState` para `ONLINE`, implementar `RemoteRepository` (que hoje não existe).

**Contrato com o backend (já pronto, do `collab.gateway.js`):**
- URL autenticada: `ws://host/api/v1/collab?atlasId=<id>&token=<JWT>&clientId=<estável>`.
- URL pública (read-only, token de 1h via `GET /atlas/public/:link`):
  `ws://host/api/v1/collab?atlasId=<id>&token=<PUBLIC_TOKEN>&clientId=<estável>`.
- Primeira mensagem do servidor: `{ type: 'connected', sessionId, userId, permission, usersOnline }`.
- Heartbeat: cliente manda `{type:'ping'}` periodicamente; servidor responde `{type:'pong'}` e marca
  `ws.isAlive` (`collab.handlers.js:11`). Se o cliente não pingar dentro de
  `WS_HEARTBEAT_INTERVAL_MS`, o servidor `terminate()`.

**Implementação (frontend):**
1. Gerar e persistir um `clientId` estável (`crypto.randomUUID()` salvo em `localStorage`) — reusar em
   toda reconexão.
2. Implementar `RemoteRepository` com a mesma interface do repositório local, mas que **emite operações
   via WS** (`{type:'operation', op}` / `{type:'operations', ops}`) e **aplica operações remotas**
   recebidas (`{type:'operation'|'operations'}`).
3. Transicionar `connectionState`: `OFFLINE → CONNECTING → ONLINE` ao receber `connected`; voltar a
   `OFFLINE`/`RECONNECTING` em close/erro.
4. Ao entrar em `ONLINE`, disparar um `sync_request` (`{type:'sync_request', lastVersion}`) para
   reconciliar (snapshot se `lastVersion` < `min_version`, senão ops incrementais — `collab.handlers.js:159`).
5. Mapear `permission` → papel da UI: `owner→owner`, `write→editor`, `read→viewer` (vocabulário da
   fase-1). Read-only desabilita o envio de ops (o servidor já rejeita com `FORBIDDEN` —
   `collab.handlers.js:50`).

**Critérios de aceitação (frontend):**
- [ ] `connectionState` chega a `ONLINE` (hoje **nunca** acontece).
- [ ] `RemoteRepository` existe e fecha o loop: op local → WS → broadcast → peer aplica.
- [ ] `clientId` é estável entre reconexões (mesmo valor no `connected.sessionId`, dado o fallback do servidor).
- [ ] Cliente público conecta read-only e **não** consegue enviar ops (recebe `error/FORBIDDEN`).

**Testes:** e2e na Tarefa 7. No backend, cobertura indireta via `tests/ws/`.

**Dependências:** Tarefa 1 (handshake aceita `clientId`); fase-1 (ack/idempotência).

---

### Tarefa 4: Loop send/ack/dequeue + fila offline + escuta de eventos (FRONTEND)

> **Tarefa de frontend.**

**Objetivo:** fila offline com reenvio idempotente, consumindo o **ack por operação** da fase-1;
escutar eventos de feature/selection; `fly-to`.

**Contrato com o backend (já pronto):**
- Push single: `{type:'operation', op}` → servidor responde `{type:'ack', opId, serverVersion}` e
  broadcasta `{type:'operation', userId, op}` aos peers (`collab.handlers.js:48-87`).
- Push batch: `{type:'operations', ops}` → `{type:'ack_batch', opIds, serverVersion}` + broadcast
  `{type:'operations', userId, ops}` (`collab.handlers.js:92-130`).
- **Idempotência:** reenviar a mesma `op.id` é seguro (UNIQUE + `ON CONFLICT DO NOTHING` da fase-1);
  o ack volta mesmo para op já aplicada (`idempotent: true` quando a fase-1 expuser esse campo).

**Implementação (frontend):**
1. **Fila offline persistente** (IndexedDB): toda op gerada localmente entra na fila com `op.id` estável.
2. **Send:** ao estar `ONLINE`, drenar a fila (em batch quando possível via `operations`).
3. **Ack/dequeue:** remover da fila a op cujo `opId` veio em `ack`/`ack_batch`. Atualizar `lastVersion`
   com o `serverVersion` retornado.
4. **Reenvio idempotente:** ops não-ackeadas após timeout/reconexão são reenviadas com o **mesmo
   `op.id`** (não regenerar). O backend deduplica.
5. **Escuta de eventos remotos:** aplicar `operation`/`operations`, refletir `selection` e `cursor` de
   peers na UI; `fly-to` para o viewport/feição de um peer ao clicar na lista de presença.

**Casos difíceis a tratar (os 3 do protótipo, §10):**
- **Conflito de versão:** sob LWW-por-chegada, não há rejeição por versão; a última op aplicada vence.
  O cliente deve aceitar que sua op pode ser sobrescrita por uma op remota posterior e re-renderizar a
  partir do estado autoritativo (o que o broadcast/`sync_response` traz).
- **Reenvio idempotente:** garantir `op.id` estável e dequeue só após ack (não após send).
- **Ordem fora de sequência:** ops podem chegar fora de ordem; aplicar por `server_version` crescente
  (descartar ops com `server_version` já visto; pedir `sync_request` se houver buraco).

**Critérios de aceitação (frontend):**
- [ ] Op offline persiste e é reenviada ao reconectar, **sem duplicar** (idempotência).
- [ ] Dequeue ocorre **apenas** após `ack`/`ack_batch`.
- [ ] Eventos remotos de feature/selection re-renderizam a UI; `fly-to` funciona.
- [ ] `lastVersion` avança monotonicamente; buraco dispara `sync_request`.

**Dependências:** Tarefa 3; fase-1 (ack por operação + idempotência).

---

### Tarefa 5: Presença/UX e viewport loading no cliente (FRONTEND)

> **Tarefa de frontend.**

**Objetivo:** entregar a tela de colaboração — o backend já transmite `cursor`/`selection`; falta a UI.
Mais: consumir o `GET` incremental por bounds da fase-1 para viewport loading.

**Contrato com o backend (já pronto):**
- Cursor: cliente manda `{type:'cursor', position, mapId}` → servidor broadcasta `{type:'cursor',
  userId, position, mapId}` (`collab.handlers.js:19-29`). **Throttle no cliente** (~150 ms, como o
  protótipo) antes de enviar.
- Seleção: `{type:'selection', featureIds, mapId}` → broadcast `{type:'selection', userId, featureIds,
  mapId}` (`collab.handlers.js:34-43`).
- Presença: `connected.usersOnline` + `user_joined`/`user_left`/`user_away` (Tarefa 2).
- Viewport: `GET /atlas/:id/sync/bounds?...` (fase-1) — **CAVEAT herdado:** as features do atlas são
  JSONB **sem PostGIS**, então o filtro espacial é por bounding box em JS no servidor (ou cliente),
  **não** `ST_Intersects`. Ver §5 (Riscos).

**Implementação (frontend):**
1. **Cursores rotulados** (nome/posto do usuário), com cores estáveis por `userId`.
2. **Toggle de privacidade** (não transmitir o próprio cursor).
3. **Indicador de quem-edita/selecionou** (highlight da seleção remota por usuário).
4. **Lista de presença** (online/away/offline; `fly-to` ao clicar).
5. **Viewport loading:** ao mover o mapa, pedir features por bounds (debounce) e manter um `Set` de ids
   já carregados (evita re-fetch) — ideia priorizada do protótipo (§8 item 1).
6. **Degradação adaptativa:** consumir `adaptive-settings` (fase-1) para ajustar throttle de cursor,
   tamanho de batch e precisão de geometria sob rede ruim.

**Critérios de aceitação (frontend):**
- [ ] Cursores e seleções de peers aparecem rotulados e atualizam em tempo real.
- [ ] Toggle de privacidade silencia o próprio cursor.
- [ ] Lista de presença reflete online/away/offline; `fly-to` funciona.
- [ ] Mover o mapa carrega features por bounds sem re-fetch de ids já carregados.

**Opcional (backend, baixa prioridade):** canal efêmero de **drag de polígono** (`drag-polygon` →
`polygon-dragging`, sem persistir) para preview colaborativo de arrasto. Acrescenta um `case
'polygon_drag'` em `handleMessage` que só rebroadcasta (sem tocar o Postgres). Implemente apenas se a
UX exigir.

**Dependências:** Tarefa 3; fase-1 (bounds + monitor de qualidade).

---

### Tarefa 6: (Opcional) Redis pub/sub para escala horizontal

**Objetivo:** permitir múltiplas instâncias do servidor WS compartilhando broadcasts. Hoje
`broadcastToRoom` só alcança a mesma instância (`collab.rooms.js:39-50`, `const rooms = new Map()`).

**Recomendação:** **adiar** até haver requisito real de multi-instância. Single-instance é suficiente
para o piloto. Manter a **abstração de broadcast** pronta para receber o adapter — esta tarefa entrega
a abstração; ligar o Redis é opt-in por env.

**Arquivos afetados:**
- `src/modules/collab/collab.rooms.js` (introduzir uma camada `publish`/`subscribe` por trás de `broadcastToRoom`)
- `src/modules/collab/collab.pubsub.js` (criar — adapter local-only por padrão, Redis se `REDIS_URL`)
- `src/config.js` (adicionar `optional('REDIS_URL', null)`)

**Padrão de código:** `_padroes.md` §5 (config via `optional`); manter a API pública de `collab.rooms.js`
inalterada (as Tarefas 1/2 e o resto do código continuam chamando `broadcastToRoom`).

**Implementação:**
1. Criar `collab.pubsub.js` com duas implementações por trás da mesma interface:
   - **Local (default):** `publish(atlasId, msg)` chama o broadcast em memória direto (comportamento atual).
   - **Redis (se `REDIS_URL`):** `publish` faz `PUBLISH collab:<atlasId> <json>`; cada instância
     `SUBSCRIBE collab:<atlasId>` e, ao receber, faz o broadcast **em memória local** para seus próprios
     clientes. Inclua um `originInstanceId` na mensagem para a própria instância não re-broadcastar o
     que acabou de publicar localmente.
2. `broadcastToRoom` passa a chamar `pubsub.publish(atlasId, message)`. O fan-out para sockets locais
   continua em `collab.rooms.js`.
3. O **durável continua no Postgres** — Redis só transporta o efêmero (cursor/selection/operation
   broadcast/presence). Nenhum estado de verdade vive no Redis.

**Decisão aberta (declarar a recomendação):**
- **Ramo A (recomendado):** entregar só a abstração + adapter local agora; ligar Redis quando escalar.
  Custo baixo, sem dependência operacional nova no piloto.
- **Ramo B:** ligar Redis já. Justificável apenas se o deploy de produção for multi-instância desde o
  início (load balancer com sticky sessions ainda assim é exigido para o handshake/heartbeat). Adiciona
  uma dependência operacional (Redis HA) à rede militar.

**Critérios de aceitação:**
- [ ] Sem `REDIS_URL`, o comportamento é idêntico ao atual (broadcast em memória).
- [ ] Com `REDIS_URL`, uma op enviada à instância A é recebida por um peer conectado à instância B.
- [ ] Nenhum estado durável passa pelo Redis; matar o Redis degrada o tempo real cross-instância mas
      **não** perde dados (continuam no Postgres).
- [ ] A própria instância não duplica o broadcast da mensagem que publicou.

**Testes:**
- `tests/ws/collab-pubsub.test.js`: com adapter local, assertar broadcast como hoje. (Teste com Redis
  real fica atrás de uma flag/skip se `REDIS_URL` não estiver presente no ambiente de CI.)

**Dependências:** nenhuma direta; pode ir por último.

---

### Tarefa 7: Testes e2e multiusuário e ajuste fino de conflito

**Objetivo:** cobrir o loop colaborativo ponta a ponta com testes, incluindo os **3 casos difíceis** que
o protótipo deixou sem cobertura (lição negativa §10): conflito de versão, reenvio idempotente, ordem
fora de sequência.

**Arquivos afetados:**
- `tests/ws/collab-e2e.test.js` (criar)
- `tests/integration/sync.test.js` (estender com casos de idempotência/ordem, se ainda não cobertos na fase-1)

**Padrão de código:** `_padroes.md` §9 (testes WS em `tests/ws/`, runner automatizado cria/dropa DB).
Use dois (ou três) clientes WS no mesmo atlas para simular multiusuário.

**Implementação (casos obrigatórios):**
1. **Conflito de versão (LWW-por-chegada):** dois clientes editam a mesma feição quase simultaneamente;
   assertar que a **última op aplicada (por `server_version`) vence** e que ambos convergem após
   broadcast/`sync_request`. (Confirma a garantia real, não a documentação antiga.)
2. **Reenvio idempotente:** cliente envia op, perde o ack (simular), reenvia a **mesma `op.id`**;
   assertar que o estado **não** duplica e que o segundo ack volta (idempotente — fase-1).
3. **Ordem fora de sequência:** entregar ops a um peer fora de ordem; assertar que ele aplica por
   `server_version` crescente e que um buraco dispara `sync_request` que reconcilia.
4. **Reconexão:** cliente cai (close não-limpo) e reconecta com o mesmo `clientId` dentro da janela →
   assertar `user_away` seguido de cancelamento (Tarefa 2) e que a fila offline drena sem duplicar.
5. **Read-only:** cliente público tenta enviar op → recebe `error/FORBIDDEN` (`collab.handlers.js:50`),
   estado não muda.

**Critérios de aceitação:**
- [ ] Os 5 casos acima passam via `npm run test:ws`.
- [ ] Caso negativo de permissão coberto (read-only não escreve).
- [ ] Convergência verificada: após uma rajada concorrente, todos os clientes têm o mesmo estado final.

**Testes:** os próprios desta tarefa.

**Dependências:** Tarefas 1, 2 (backend); fase-1 (idempotência/ack). Tarefas 3-5 (frontend) são
exercitadas por testes e2e no repo do SPA, mas o backend cobre o protocolo via `tests/ws/`.

---

## 5. Riscos & cuidados

| Risco | Mitigação |
|-------|-----------|
| **Viewport loading sem PostGIS no atlas** (CAVEAT herdado da fase-1). As features são JSONB; não há `ST_Intersects` server-side. | Filtro por bounding box em JS (no servidor, sobre o JSONB, ou no cliente sobre o snapshot). **Não** introduzir PostGIS no schema atlas — `00-visao-geral.md` §3 manda manter JSONB para atlas; PostGIS fica no schema `ng` (gazetteer/3D). Aceitar que para datasets muito grandes o viewport é aproximado. |
| **Escala single-instance** (estado em memória, `collab.rooms.js`). | Tarefa 6 (Redis) opcional; até lá, deploy single-instance ou sticky-session no LB. Documentar a limitação. |
| **`clientId` falsificável** (vem do cliente). | É só chave de presença/idempotência, **não** de autorização — a autorização vem do JWT (`payload.sub`, permissão resolvida em `resolvePermission`, `collab.gateway.js:18`). Um `clientId` forjado só afeta a própria sessão do atacante. Validar formato (Tarefa 1) evita injeção em logs/SQL (a UNIQUE da fase-1 é parametrizada). |
| **`user_away` vazando presença após crash do servidor.** | Sessões `away` têm TTL via `setTimeout` em memória; se a instância morre, os clientes reconectam e a lista se reconstrói do zero (`getRoomUsers`). `active_sessions` no Postgres deve ter limpeza por `last_heartbeat` antigo (job/consulta) para não acumular. |
| **Não copiar os anti-padrões do protótipo (§10):** batch HTTP que não passa o `t` da transação; schema único divergente; idempotência check-then-insert sem UNIQUE (race); identidade efêmera; estado sem Redis. | O EBGeo já faz certo: `tx(async t => ...)` passa `t` adiante (`_padroes.md` §4); migrations versionadas; UNIQUE + `ON CONFLICT` na fase-1; JWT + permissões reais; Redis opcional (Tarefa 6). **Manter assim.** |
| **Quebrar o caminho anônimo / contrato do frontend.** | Esta fase é aditiva. O cliente público continua read-only via token de 1h; o handshake aceita ausência de `clientId` (fallback). Nenhum contrato congelado (snapshot, sync envelope) muda. |
| **Throttle/flood de cursor.** | Throttle no cliente (~150 ms) + (opcional) rate limit por conexão no servidor para `cursor`/`selection`. Não persistir cursor a cada mensagem (já é só broadcast in-memory). |

---

## 6. Definition of Done da fase

Além do DoD universal de `_padroes.md` §10, esta fase está concluída quando:

- [ ] **Tarefa 1:** o handshake aceita `clientId` estável; reconexão reusa a sessão; fallback preserva clientes antigos.
- [ ] **Tarefa 2:** queda de rede → `user_away` (não `user_left`); saída intencional → `user_left` imediato; reconexão na janela cancela a remoção.
- [ ] **Tarefa 7:** os 3 casos difíceis (conflito de versão, reenvio idempotente, ordem fora de sequência) + reconexão + read-only têm teste passando em `tests/ws/`.
- [ ] **Tarefas 3-5 (frontend):** o cliente transiciona para `ONLINE` (hoje nunca acontece), tem `RemoteRepository`, fila offline com dequeue por ack, presença/UX e viewport loading. (Verificado no repo do SPA; aqui só o contrato de backend é garantido.)
- [ ] **Tarefa 6 (opcional):** abstração de broadcast pronta; sem `REDIS_URL` o comportamento é idêntico ao atual; com `REDIS_URL`, broadcast cross-instância funciona e nenhum estado durável passa pelo Redis.
- [ ] **`CLAUDE.md` atualizado:** seção WebSocket documenta `clientId` no handshake, `user_away`, e (se ligado) Redis. Remover a afirmação de que o cliente nunca conecta, uma vez que o frontend ative.
- [ ] **Caminho anônimo e contratos congelados preservados** (snapshot, envelope de op, token público de 1h).
- [ ] `npm test` verde (unit + integration + ws).
