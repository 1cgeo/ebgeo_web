# 04 - WebSocket e Colaboração

Este documento cobre a conexão WebSocket e o protocolo de colaboração em tempo real do EBGeo.

O canal `/api/v1/collab` entrega ao frontend:
- Colaboração em tempo real entre usuários (operações CRDT broadcast por atlas)
- Presença viva (cursores, seleção, lista de usuários online) com distinção **away vs saída**
- Ack por operação com sinalização de **idempotência** (dequeue confiável de fila offline)
- Monitor de qualidade de conexão **adaptativo** (o servidor recomenda settings de transporte)
- Broadcast de mutações REST (atlas/settings/sharing/merge) para a sala

> **Identidade.** O acesso ao canal é por **JWT** (mesmo emissor único do REST — ver
> [`./01-autenticacao.md`](./01-autenticacao.md)). O `clientId` da query **não** é credencial: é só uma
> chave estável de presença/idempotência. A autorização (permissão de atlas) é resolvida no handshake.

---

## 1. URL de Conexão (Handshake)

### Usuário Autenticado

```
ws://host/api/v1/collab?atlasId=<atlas-uuid>&token=<accessToken>&clientId=<clientId>
```

### Usuário Público

```
ws://host/api/v1/collab?atlasId=<atlas-uuid>&token=<publicToken>&clientId=<clientId>
```

O `publicToken` é obtido em `GET /atlas/public/:link` (campo `publicToken`), é **read-only** e
**expira em 1 hora** (ver [`./07-compartilhamento.md`](./07-compartilhamento.md) se aplicável, ou o
módulo de sharing). Visitantes públicos **não** geram registro de sessão no banco.

### Parâmetros de query

| Parâmetro | Obrigatório | Descrição |
|-----------|-------------|-----------|
| `atlasId` | Sim | UUID do atlas a colaborar. Ausência → upgrade rejeitado com `400`. |
| `token` | Sim | Access token (JWT) ou public token. Inválido/`alg:none` → `401`. Sem permissão no atlas → `403`. |
| `clientId` | Não (recomendado) | Identificador **estável** do cliente entre reconexões. Persista no `localStorage`. |

### `?clientId=` estável (idempotência + presença na reconexão)

O `clientId` permite que **idempotência** (de operações) e **presença** sobrevivam a uma reconexão da
mesma aba. Sem ele, cada reconexão vira um "cliente novo": a sessão duplica na lista de presença e a
janela de graça `away` (ver §4) não encontra o timer pendente para cancelar.

- **Formato validado** pelo servidor: `^[a-zA-Z0-9_-]{8,64}$` (UUID v4 ou nanoid servem).
- **Ausente OU malformado** → o servidor gera um `crypto.randomUUID()` (fallback de back-compat; a
  conexão funciona, mas você perde a continuidade de presença/idempotência entre reconexões).
- O `clientId` efetivo volta no `connected` como `sessionId` (use-o para correlacionar).

```javascript
// Frontend: gere uma vez e persista
let clientId = localStorage.getItem('ebgeo.clientId');
if (!clientId) {
  clientId = crypto.randomUUID();        // casa com o regex do servidor
  localStorage.setItem('ebgeo.clientId', clientId);
}
const url = `ws://${HOST}/api/v1/collab?atlasId=${atlasId}&token=${token}&clientId=${clientId}`;
```

> **Contrato congelado**: o `clientId` enviado válido é ecoado em `connected.sessionId`. Reconectar com
> o **mesmo `clientId`** dentro da janela de graça cancela a remoção `away` e dispara `user_back`.

### Códigos de rejeição do upgrade (antes de abrir o socket)

| HTTP | Causa |
|------|-------|
| `400 Bad Request` | `atlasId` ou `token` ausente na query. |
| `401 Unauthorized` | JWT inválido, expirado, ou assinado com algoritmo fora do allowlist (`alg:none` rejeitado). |
| `403 Forbidden` | Token válido, mas sem permissão de leitura no atlas (não-owner, sem share, atlas não público). |

---

## 2. Conexão Estabelecida (`connected`)

Ao concluir o handshake, o servidor envia **uma** mensagem `connected`:

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
      "mapId": "map-uuid",
      "cursorPosition": { "lat": -15.7, "lng": -47.9 },
      "status": "online"
    }
  ]
}
```

| Campo | Descrição |
|-------|-----------|
| `sessionId` | É o **`clientId` efetivo** (o que você enviou, ou o gerado pelo servidor no fallback). |
| `userId` | ID do usuário autenticado (ou `public-<uuid>` para visitante). |
| `permission` | Permissão **por-atlas** (eixo backend): `owner`, `write` ou `read`. **Campo congelado.** |
| `role` | Vocabulário de **papel** esperado pelo frontend: `owner`, `admin`, `editor` ou `viewer`. |
| `usersOnline` | Outros usuários atualmente na sala (inclui quem está `away`). |

### `permission` vs `role` (dois eixos)

O backend mantém dois eixos ortogonais e expõe **ambos** no `connected`:

- `permission` (por-atlas): `owner` / `write` / `read` — usado para autorizar escrita (ver §3.4).
- `role` (vocabulário de UI): derivado de `permission` + `role global` do JWT (`user`/`admin`):

| Entrada | `role` emitido |
|---------|----------------|
| `role` global `admin` (qualquer permissão) | `admin` |
| `permission = owner` | `owner` |
| `permission = write` | `editor` |
| `permission = read` (ou público/none) | `viewer` |

> **Contrato congelado**: `permission` continua sendo emitido com o vocabulário `owner/write/read`. O
> `role` é **aditivo** — não substitui `permission`. Para autorizar escrita no cliente, cheque
> `permission !== 'read'` (não o `role`).

### `usersOnline[].status`

Cada usuário na lista carrega `status: "online" | "away"`. Um usuário marcado `away` caiu de forma
anormal (queda de rede) e está dentro da janela de graça — **não o remova da UI ainda** (ver §4).

---

## 3. Tipos de Mensagem

Resumo do protocolo (C = cliente→servidor, S = servidor→cliente):

| Tipo | Direção | Resposta / efeito |
|------|---------|-------------------|
| `ping` | C→S | `pong` |
| `cursor` | C→S | broadcast `cursor` aos peers |
| `selection` | C→S | broadcast `selection` aos peers |
| `operation` | C→S | `ack` ao emissor + broadcast `operation` aos peers |
| `operations` | C→S | `ack_batch` ao emissor + broadcast `operations` aos peers |
| `sync_request` | C→S | `sync_response` (snapshot ou ops) |
| `connection-quality` | C→S | `adaptive-settings` (só na mudança de banda) |
| `leave` | C→S | fecha o socket (1000) → `user_left` imediato |
| `briefing_edit_start` / `briefing_edit_end` | C→S | broadcast `briefing_edit_started` / `briefing_edit_ended` |
| `connected` | S→C | enviado uma vez no handshake (§2) |
| `pong` | S→C | resposta ao `ping` |
| `ack` / `ack_batch` | S→C | confirmação de operação(ões) (§3.4/§3.5) |
| `user_joined` / `user_left` / `user_away` / `user_back` | S→C | eventos de presença (§3.7) |
| `atlas_updated` / `atlas_deleted` / `atlas_settings_updated` / `sharing_updated` / `maps_merged` / `map_duplicated` | S→C | mutações REST broadcast (§3.9) |
| `adaptive-settings` | S→C | settings de transporte recomendados (§3.8) |
| `error` | S→C | erro de processamento (§3.10) |

### 3.1 Heartbeat (Ping/Pong)

Manter a conexão ativa enviando `ping` a cada ~30 segundos. O servidor também roda um heartbeat
próprio (`WS_HEARTBEAT_INTERVAL_MS`, default 30 s): conexões sem atividade são marcadas e, no ciclo
seguinte, encerradas via `terminate()` (close code `1006`, tratado como queda de rede — ver §4).

```javascript
// Cliente → Servidor
{ "type": "ping" }

// Servidor → Cliente
{ "type": "pong" }
```

> Enviar `ping` zera o flag de inatividade no servidor (mantém o socket vivo). Sem `ping`, o servidor
> pode terminar a conexão como inativa.

### 3.2 Posição do Cursor

```javascript
// Cliente → Servidor
{
  "type": "cursor",
  "position": { "lat": -15.78, "lng": -47.92 },
  "mapId": "map-uuid"
}

// Servidor → Outros clientes (peers; o emissor é excluído)
{
  "type": "cursor",
  "userId": "user-uuid",
  "position": { "lat": -15.78, "lng": -47.92 },
  "mapId": "map-uuid"
}
```

### 3.3 Seleção de Features

```javascript
// Cliente → Servidor
{
  "type": "selection",
  "featureIds": ["feat-1", "feat-2"],
  "mapId": "map-uuid"
}

// Servidor → Outros clientes
{
  "type": "selection",
  "userId": "user-uuid",
  "featureIds": ["feat-1", "feat-2"],
  "mapId": "map-uuid"
}
```

### 3.4 Operação CRDT (Única)

Requer `permission` de escrita (`owner`/`write`). Read-only → `error` com code `FORBIDDEN`. A op é
validada (mesmo schema Joi do `POST /sync`, máx. 500 ops por mensagem) antes de aplicar.

```javascript
// Cliente → Servidor
{
  "type": "operation",
  "op": {
    "id": "op-uuid",
    "entityType": "feature",
    "operationType": "create",
    "entityId": "feature-uuid",
    "mapId": "map-uuid",
    "timestamp": 1699999999999,
    "clientId": "client-uuid",
    "data": {
      "feature_type": "point",
      "geometry": { "type": "Point", "coordinates": [-47.9, -15.7] },
      "properties": { "name": "Marco", "color": "#FF0000" }
    }
  }
}

// Servidor → Cliente emissor (confirmação com resultado por-op)
{
  "type": "ack",
  "opId": "op-uuid",
  "serverVersion": 42,
  "result": {
    "success": true,
    "operationId": "op-uuid",
    "idempotent": false,
    "currentVersion": 42
  }
}

// Servidor → Outros clientes (broadcast; o emissor é excluído)
{
  "type": "operation",
  "userId": "user-uuid",
  "op": { /* mesma operação recebida */ }
}
```

> **Vocabulário de op (compat).** O backend aceita **ambos** os vocabulários: o do frontend
> (`entityType`/`operationType`/`entityId`) e o legado (`target`/`type`/`targetId`). Use o do frontend.
> Detalhes do modelo CRDT em [`./05-sync-crdt.md`](./05-sync-crdt.md).

#### O objeto `result` (idempotência)

O `ack` carrega um `result` por operação — a peça que o frontend usa para um **dequeue confiável** da
fila offline:

| Campo | Descrição |
|-------|-----------|
| `success` | `true` quando a op foi registrada (aplicada **ou** reconhecida como duplicata). |
| `operationId` | O `op.id` enviado (chave de idempotência). |
| `idempotent` | `true` se a op **já havia sido aplicada** antes (reenvio): o servidor **não** reaplicou o efeito, só devolveu a versão registrada. `false` = aplicada agora. |
| `currentVersion` | `server_version` registrada para esta op (ou a versão atual do atlas). |

> **Contrato congelado**: o `ack` carrega `result` (objeto único) e o `ack_batch` carrega `results[]`
> (array, um por op, na ordem enviada), cada item no shape `{success, operationId, idempotent,
> currentVersion}`. Trate **`idempotent: true` como sucesso** (a op estava na fila por um retry; remova-a).

### 3.5 Operações em Lote

```javascript
// Cliente → Servidor
{
  "type": "operations",
  "ops": [
    { /* operação 1 (com id) */ },
    { /* operação 2 (com id) */ }
  ]
}

// Servidor → Cliente emissor
{
  "type": "ack_batch",
  "opIds": ["op-uuid-1", "op-uuid-2"],
  "serverVersion": 44,
  "results": [
    { "success": true, "operationId": "op-uuid-1", "idempotent": false, "currentVersion": 43 },
    { "success": true, "operationId": "op-uuid-2", "idempotent": false, "currentVersion": 44 }
  ]
}

// Servidor → Outros clientes (broadcast único)
{
  "type": "operations",
  "userId": "user-uuid",
  "ops": [ /* mesmas operações */ ]
}
```

`results[i]` corresponde a `ops[i]` (mesma ordem). Num reenvio parcial, só os itens duplicados vêm com
`idempotent: true`.

### 3.6 Sync Request (Pull via WebSocket)

```javascript
// Cliente → Servidor
{
  "type": "sync_request",
  "lastVersion": 35
}

// Servidor → Cliente (incremental)
{
  "type": "sync_response",
  "isSnapshot": false,
  "ops": [ /* operações desde a versão 35 */ ],
  "currentVersion": 42
}

// Servidor → Cliente (snapshot — quando lastVersion == 0 ou < min_version)
{
  "type": "sync_response",
  "isSnapshot": true,
  "snapshot": { /* snapshot completo do atlas (ver doc 05) */ },
  "currentVersion": 42
}
```

> **Nota:** sistema híbrido — snapshot completo quando `lastVersion == 0` ou cliente muito desatualizado
> (`lastVersion < min_version`); senão, operações incrementais. Use após reconexão para recuperar o que
> foi perdido. Detalhes em [`./03-sync-inicial.md`](./03-sync-inicial.md) e [`./05-sync-crdt.md`](./05-sync-crdt.md).

### 3.7 Eventos de Presença

```javascript
// Alguém entrou (broadcast aos peers)
{
  "type": "user_joined",
  "user": { "id": "user-uuid", "nome": "Capitão Silva", "posto_graduacao": "Cap" }
}

// Alguém saiu de fato (saída intencional OU expiração da graça away)
{
  "type": "user_left",
  "userId": "user-uuid"
}

// Alguém caiu de forma anormal (queda de rede) — está `away`, NÃO remova ainda
{
  "type": "user_away",
  "userId": "user-uuid",
  "clientId": "client-uuid"
}

// Um usuário `away` reconectou dentro da janela de graça — limpe o estado `away`
{
  "type": "user_back",
  "userId": "user-uuid",
  "clientId": "client-uuid"
}
```

Ver §4 para a semântica completa de **away vs remove**.

### 3.8 Monitor de Qualidade Adaptativo

O cliente mede o RTT (ex.: via tempo de `ping`/`pong`) e **reporta** ao servidor; o servidor classifica
a banda e, **só quando a banda muda**, devolve `adaptive-settings` com recomendações de transporte.

```javascript
// Cliente → Servidor (amostra de latência)
{ "type": "connection-quality", "rttMs": 600 }

// Servidor → Cliente (só na MUDANÇA de banda)
{
  "type": "adaptive-settings",
  "quality": "poor",
  "batchIntervalMs": 1500,
  "geometryPrecision": 5,
  "viewportOnly": true
}
```

Bandas e settings recomendados:

| Banda (`quality`) | RTT (ms) | `batchIntervalMs` | `geometryPrecision` | `viewportOnly` |
|-------------------|----------|-------------------|---------------------|----------------|
| `excellent` | < 100 | 250 | 7 | false |
| `good` | < 300 | 500 | 7 | false |
| `poor` | < 800 | 1500 | 5 | true |
| `critical` | ≥ 800 | 3000 | 4 | true |

Notas de integração:
- O servidor **só emite na transição** de banda (evita spam). Aplique e mantenha até a próxima.
- `geometryPrecision` é uma sugestão de **transporte** (casas decimais de coordenada para reduzir bytes
  na saída) — **nunca** trunque antes de persistir; o servidor armazena a geometria em precisão cheia.
- `rttMs` inválido (não-finito ou negativo) é ignorado silenciosamente.

### 3.9 Mutações REST broadcast

Alterações feitas pela **REST API** são propagadas à sala por WebSocket, para que clientes conectados
reajam sem polling:

```javascript
// PUT /atlas/:atlasId  → nome/descrição/map_order
{ "type": "atlas_updated", "data": { /* atlas atualizado */ } }

// DELETE /atlas/:atlasId  → fecha as conexões da sala com code 4001
{ "type": "atlas_deleted", "atlasId": "atlas-uuid" }

// PATCH /atlas/:atlasId/settings
{ "type": "atlas_settings_updated", "settings": { /* settings */ } }

// POST/PUT/DELETE /atlas/:atlasId/sharing/*
{ "type": "sharing_updated", "action": "user_added", "userId": "...", "permission": "write" }
// action ∈ public_enabled | public_disabled | user_added | user_updated | user_removed

// POST /atlas/:atlasId/maps/:mapId/duplicate
{ "type": "map_duplicated", "mapId": "novo-map-uuid" }

// POST /atlas/:atlasId/maps/:mapId/merge
{ "type": "maps_merged", "destMapId": "map-uuid", "sourceMapIds": ["..."] }
```

Notas de integração:
- `atlas_deleted` chega **junto** com o fechamento da conexão (close code `4001`, motivo `Atlas deleted`).
  Trate o code 4001 como "atlas removido", **não** como queda de rede (não tente reconectar à mesma sala).
- O push de operações via REST (`POST /sync`) também faz broadcast de `operations` à sala (mesmo shape de
  §3.5). O emissor HTTP **não** tem socket para ser excluído — ignore ops cujo `clientId` seja o seu.

### 3.10 Awareness de Briefing

```javascript
// Cliente → Servidor (começou a editar um briefing)
{ "type": "briefing_edit_start", "briefingId": "briefing-uuid" }
// Servidor → peers
{ "type": "briefing_edit_started", "userId": "...", "userName": "Cap Silva", "briefingId": "briefing-uuid" }

// Cliente → Servidor (parou de editar)
{ "type": "briefing_edit_end", "briefingId": "briefing-uuid" }
// Servidor → peers
{ "type": "briefing_edit_ended", "userId": "...", "userName": "Cap Silva", "briefingId": "briefing-uuid" }
```

É **awareness advisory** (sinaliza quem está editando) — não há lock no servidor; a escrita ainda é via
sync com LWW.

### 3.11 Erros

```javascript
{ "type": "error", "code": "FORBIDDEN", "message": "Read-only users cannot send operations" }
```

| Código | Quando |
|--------|--------|
| `FORBIDDEN` | Cliente read-only tentou enviar `operation`/`operations`. |
| `VALIDATION_ERROR` | A(s) op(s) falharam no schema Joi (`pushSchema`) — ex.: campo faltando, > 500 ops. |
| `OPERATION_FAILED` | Erro ao aplicar a operação no banco. |
| `SYNC_FAILED` | Erro ao processar um `sync_request`. |

> Mensagem de erro do WS é **plana** (`{type:'error', code, message}`) — distinta do envelope REST
> `{error:{code,message}}`.

---

## 4. Presença: away vs remove

A presença distingue **queda de rede** de **saída intencional** para evitar que um usuário "pisque" para
fora da lista numa reconexão rápida.

| Evento | Close code | Tratamento |
|--------|-----------|------------|
| Queda de rede / heartbeat `terminate()` | `1006` (abnormal) | Marca `away`, mantém na sala, agenda remoção após a graça, broadcast `user_away`. |
| Mensagem `leave` | fecha com `1000` | Remoção **imediata** (`user_left`). |
| `close()` limpo do cliente | `1000`/`1005`/`1001`/... | Remoção **imediata** (`user_left`). |
| `atlas_deleted` | `4001` | Remoção (sala fechada). |

- **Janela de graça**: `WS_AWAY_GRACE_MS` (default **120 000 ms** = 2 min). Se não houver reconexão com o
  **mesmo `clientId`** dentro da janela, o usuário é removido de fato (`user_left`).
- **Reconexão dentro da graça** (mesmo `clientId`): cancela o timer, descarta o socket morto e emite
  `user_back`. A linha de sessão é **reusada** (não duplica presença).
- O usuário `away` continua aparecendo em `usersOnline` com `status: "away"`.

```
Cliente A (rede caiu)            Backend                          Cliente B
   |  (socket morre, 1006)         |                                |
   |                               |-- WS: user_away -------------->|  [marca A como "away",
   |                               |   { userId, clientId }         |   NÃO remove]
   |                               |                                |
   |   ...reconecta com mesmo      |                                |
   |   clientId dentro de 2 min    |                                |
   |==  novo socket, handshake ===>|                                |
   |<-- WS: connected -------------|                                |
   |                               |-- WS: user_back ------------->|  [limpa "away" de A]
   |                               |   { userId, clientId }         |
   |                               |                                |
   |  (se NÃO reconectar a tempo)  |                                |
   |                               |-- WS: user_left ------------->|  [remove A]
```

Notas de integração:
- Persista o `clientId` (§1) — é o que liga o socket novo à sessão `away`.
- Para sair de propósito (ex.: usuário fechou o atlas), envie `{ "type": "leave" }` antes de fechar:
  evita os 2 min de `away` fantasma na lista dos peers.

---

## 5. Fluxo de Colaboração (operação)

```
Cliente A                        Backend                         Cliente B
   |                                |                                |
   [Usuário cria feature]           |                                |
   |-- WS: operation -------------->|                                |
   |   { op: { entityType:'feature',|                                |
   |     operationType:'create',    |                                |
   |     entityId:'uuid', data:{} } }|                               |
   |                                |-- WS: operation -------------->|
   |                                |   (broadcast à sala, sem A)    |
   |<-- WS: ack --------------------|                                |
   |   { opId, serverVersion,       |                [Cliente B aplica
   |     result:{idempotent,...} }  |                 operação local]
```

---

## 6. Fluxo de Presença (cursor)

```
Cliente A                        Backend                         Cliente B
   |-- WS: cursor ----------------->|                                |
   |   { position:{lat,lng},        |-- WS: cursor ----------------->|
   |     mapId:'uuid' }             |   { userId, position, mapId }  |
   |                                |                [Exibe cursor de A,
   |                                |                 filtrado por mapId]
```

---

## 7. Implementação de Referência

```javascript
class CollabWebSocket {
  constructor(atlasId, token) {
    this.atlasId = atlasId;
    this.token = token;
    this.clientId = this.getOrCreateClientId();
    this.ws = null;
    this.sessionId = null;
    this.permission = null;
    this.role = null;
    this.pingInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  getOrCreateClientId() {
    let id = localStorage.getItem('ebgeo.clientId');
    if (!id) {
      id = crypto.randomUUID();              // casa com ^[a-zA-Z0-9_-]{8,64}$
      localStorage.setItem('ebgeo.clientId', id);
    }
    return id;
  }

  connect() {
    const url = `ws://${HOST}/api/v1/collab`
      + `?atlasId=${this.atlasId}&token=${this.token}&clientId=${this.clientId}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => { this.reconnectAttempts = 0; this.startPing(); };
    this.ws.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
    this.ws.onclose = (e) => {
      this.stopPing();
      if (e.code === 4001) { this.onAtlasDeleted(); return; } // não reconectar
      this.attemptReconnect();
    };
    this.ws.onerror = (err) => console.error('WebSocket erro:', err);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        this.sessionId = msg.sessionId;       // == clientId efetivo
        this.permission = msg.permission;     // owner/write/read
        this.role = msg.role;                 // owner/admin/editor/viewer
        this.onUsersOnline(msg.usersOnline);  // cada um com status online|away
        break;
      case 'pong': break;
      case 'cursor': this.onCursorUpdate(msg.userId, msg.position, msg.mapId); break;
      case 'selection': this.onSelectionUpdate(msg.userId, msg.featureIds, msg.mapId); break;
      case 'operation': this.onRemoteOperation(msg.op); break;
      case 'operations': msg.ops.forEach((op) => this.onRemoteOperation(op)); break;
      case 'ack': this.onAck(msg.opId, msg.serverVersion, msg.result); break;
      case 'ack_batch': this.onAckBatch(msg.opIds, msg.serverVersion, msg.results); break;
      case 'sync_response': this.onSyncResponse(msg); break;
      case 'adaptive-settings': this.onAdaptiveSettings(msg); break;
      case 'user_joined': this.onUserJoined(msg.user); break;
      case 'user_left': this.onUserLeft(msg.userId); break;
      case 'user_away': this.onUserAway(msg.userId, msg.clientId); break;     // marcar away
      case 'user_back': this.onUserBack(msg.userId, msg.clientId); break;     // limpar away
      case 'atlas_updated': this.onAtlasUpdated(msg.data); break;
      case 'atlas_settings_updated': this.onSettingsUpdated(msg.settings); break;
      case 'sharing_updated': this.onSharingUpdated(msg); break;
      case 'maps_merged': this.onMapsMerged(msg.destMapId, msg.sourceMapIds); break;
      case 'map_duplicated': this.onMapDuplicated(msg.mapId); break;
      case 'briefing_edit_started': this.onBriefingEdit(msg, true); break;
      case 'briefing_edit_ended': this.onBriefingEdit(msg, false); break;
      case 'error': this.onError(msg.code, msg.message); break;
    }
  }

  startPing() {
    this.lastPingAt = 0;
    this.pingInterval = setInterval(() => {
      this.lastPingAt = Date.now();
      this.send({ type: 'ping' });
    }, 30000);
  }
  stopPing() { if (this.pingInterval) clearInterval(this.pingInterval); this.pingInterval = null; }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) { this.onMaxReconnect(); return; }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    setTimeout(() => this.connect(), delay);
    // Após o connected, chame requestSync(lastVersion) para recuperar o perdido.
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendCursor(lat, lng, mapId) { this.send({ type: 'cursor', position: { lat, lng }, mapId }); }
  sendSelection(featureIds, mapId) { this.send({ type: 'selection', featureIds, mapId }); }

  sendOperation(op) {
    if (this.permission === 'read') return false;   // checar permission, não role
    this.send({ type: 'operation', op });
    return true;
  }
  sendOperations(ops) {
    if (this.permission === 'read') return false;
    this.send({ type: 'operations', ops });
    return true;
  }

  requestSync(lastVersion) { this.send({ type: 'sync_request', lastVersion }); }

  // Reportar qualidade de conexão (mede o RTT no pong; ver onMessage 'pong')
  reportQuality(rttMs) { this.send({ type: 'connection-quality', rttMs }); }

  leave() { this.send({ type: 'leave' }); }   // saída intencional (sem away)
  disconnect() { this.stopPing(); this.ws?.close(); this.ws = null; }

  // Callbacks a implementar
  onUsersOnline() {} onCursorUpdate() {} onSelectionUpdate() {} onRemoteOperation() {}
  onAck() {} onAckBatch() {} onSyncResponse() {} onAdaptiveSettings() {}
  onUserJoined() {} onUserLeft() {} onUserAway() {} onUserBack() {}
  onAtlasUpdated() {} onSettingsUpdated() {} onSharingUpdated() {} onMapsMerged() {}
  onMapDuplicated() {} onAtlasDeleted() {} onBriefingEdit() {} onError() {} onMaxReconnect() {}
}
```

---

## 8. Exibindo Cursores e Lista de Online

O frontend deve filtrar cursores/seleção por `mapId` (todas as mensagens são broadcast por **atlas**,
não por mapa — ver §10) e tratar `status: "away"` de forma distinta de online.

```javascript
// Filtrar cursores pelo mapa ativo
ws.onCursorUpdate = (userId, position, mapId) => {
  if (mapId === currentMapId) cursors.updateCursor(userId, position);
};

// Presença: away vs online
ws.onUserAway = (userId) => onlineUsers.setStatus(userId, 'away'); // esmaecer, não remover
ws.onUserBack = (userId) => onlineUsers.setStatus(userId, 'online');
ws.onUserLeft = (userId) => { onlineUsers.remove(userId); cursors.removeCursor(userId); };

// connected: usuários iniciais já trazem status
ws.onUsersOnline = (users) => {
  users.forEach((u) => onlineUsers.upsert(u.id, u.nome, u.status)); // u.status: online|away
};
```

---

## 9. Recuperação após reconexão

Mensagens enviadas enquanto o cliente esteve desconectado **não** são reenviadas (não há replay). O
fluxo correto:

1. Reconectar com **backoff exponencial** e o **mesmo `clientId`** (cancela `away` se dentro da graça).
2. Após receber `connected`, enviar `sync_request` com o último `lastVersion` conhecido.
3. O servidor responde snapshot completo (se muito desatualizado) ou operações incrementais (§3.6).
4. Reenviar a fila offline de operações; trate `result.idempotent: true` como sucesso (já aplicada).

---

## 10. Limitações Atuais e Notas de Escala

### Rooms são por Atlas, não por Mapa

Todas as mensagens são broadcast para **todos os clientes conectados ao atlas**, independente do mapa
ativo. Cursor e seleção de usuários em outros mapas chegam a todos — o frontend **deve filtrar por
`mapId`** (§8). Operações CRDT são sempre broadcast para todos (necessário para consistência). Sub-canais
por mapa são um gap conhecido (P3), não implementado.

### Sem replay de mensagens perdidas

Reconexão usa `sync_request` para recuperar o que foi perdido (§9). Não há buffer de mensagens por
cliente desconectado.

### Escala single-instance

O estado efêmero (salas, presença, cursores, timers de `away`) vive **em memória de uma única
instância**. O estado durável está no Postgres. Escalar horizontalmente exige sticky-session no load
balancer (ou uma camada pub/sub — não implementada). Ver [`../deploy/deploy.md`](../deploy/deploy.md).

### `locked` é advisory

`locked` (mapa/camada/grupo/feição) **não** é enforçado pelo servidor — o sync nunca rejeita escrita em
entidade travada. O bloqueio é frontend-only. Ver [`./05-sync-crdt.md`](./05-sync-crdt.md).

---

## Checklist de Implementação

- [ ] `clientId` estável persistido no `localStorage` (formato `^[a-zA-Z0-9_-]{8,64}$`) na URL
- [ ] Conexão WebSocket com token apropriado + tratamento de `400`/`401`/`403` no upgrade
- [ ] Heartbeat (ping a cada ~30 s); medir RTT no `pong`
- [ ] Recebimento de `connected`; armazenar `sessionId`, `permission` **e** `role`
- [ ] Renderizar `usersOnline` com `status` (online vs away)
- [ ] Verificar `permission !== 'read'` antes de enviar operações
- [ ] Envio/recebimento de cursor e seleção (filtrar por `mapId`)
- [ ] Envio de operações (single/batch) e processamento de `ack`/`ack_batch` (usar `result(s)`)
- [ ] Tratar `idempotent: true` como sucesso no dequeue da fila offline
- [ ] Recebimento de operações remotas (ignorar as do próprio `clientId` vindas do broadcast REST)
- [ ] Presença: `user_joined`/`user_left`/`user_away`/`user_back` (away ≠ remoção)
- [ ] Enviar `leave` na saída intencional (evita away fantasma)
- [ ] Reportar `connection-quality` e aplicar `adaptive-settings` (sem truncar antes de persistir)
- [ ] Reagir a mutações REST broadcast (`atlas_updated`/`atlas_settings_updated`/`sharing_updated`/`maps_merged`/`map_duplicated`)
- [ ] Tratar `atlas_deleted` + close `4001` (não reconectar)
- [ ] Awareness de briefing (`briefing_edit_started`/`briefing_edit_ended`)
- [ ] Reconexão com backoff exponencial + `sync_request` para recuperar o perdido
- [ ] Tratamento de erros (`error` plano: `FORBIDDEN`/`VALIDATION_ERROR`/`OPERATION_FAILED`/`SYNC_FAILED`)

---

## Próximo Documento

[05 - Sync CRDT](./05-sync-crdt.md) - Operações CRDT, snapshot e resolução de conflitos (LWW por chegada + idempotência).
