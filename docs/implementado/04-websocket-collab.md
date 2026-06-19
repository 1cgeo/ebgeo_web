# 04 - WebSocket e Colaboração

Este documento cobre a conexão WebSocket e o protocolo de colaboração em tempo real.

---

## Visão Geral

O WebSocket permite:
- Colaboração em tempo real entre usuários
- Envio/recebimento de operações CRDT
- Presença (cursores, seleção)
- Notificação de entrada/saída de usuários

---

## 1. URL de Conexão

### Usuário Autenticado

```
ws://host/api/v1/collab?atlasId=<atlas-uuid>&token=<accessToken>
```

### Usuário Público

```
ws://host/api/v1/collab?atlasId=<atlas-uuid>&token=<publicToken>
```

---

## 2. Conexão Estabelecida

Ao conectar com sucesso, o servidor envia:

```json
{
  "type": "connected",
  "sessionId": "session-uuid",
  "userId": "user-uuid",
  "permission": "owner",
  "usersOnline": [
    {
      "id": "outro-user-uuid",
      "nome": "Tenente Lima",
      "posto_graduacao": "Ten",
      "mapId": "map-uuid",
      "cursorPosition": { "lat": -15.7, "lng": -47.9 }
    }
  ]
}
```

| Campo | Descrição |
|-------|-----------|
| `sessionId` | ID único desta sessão WebSocket |
| `userId` | ID do usuário autenticado |
| `permission` | Nível de permissão (`read`, `write`, `owner`) |
| `usersOnline` | Lista de outros usuários atualmente conectados |

---

## 3. Tipos de Mensagem

### 3.1 Heartbeat (Ping/Pong)

Manter a conexão ativa enviando ping a cada 30 segundos.

```javascript
// Cliente → Servidor
{ "type": "ping" }

// Servidor → Cliente
{ "type": "pong" }
```

### 3.2 Posição do Cursor

```javascript
// Cliente → Servidor
{
  "type": "cursor",
  "position": { "lat": -15.78, "lng": -47.92 },
  "mapId": "map-uuid"
}

// Servidor → Outros clientes
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

```javascript
// Cliente → Servidor
{
  "type": "operation",
  "op": {
    "id": "op-uuid",
    "type": "create",
    "target": "feature",
    "targetId": "feature-uuid",
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

// Servidor → Cliente (confirmação)
{
  "type": "ack",
  "opId": "op-uuid",
  "serverVersion": 42
}

// Servidor → Outros clientes (broadcast)
{
  "type": "operation",
  "userId": "user-uuid",
  "op": { /* mesma operação */ }
}
```

### 3.5 Operações em Lote

```javascript
// Cliente → Servidor
{
  "type": "operations",
  "ops": [
    { /* operação 1 */ },
    { /* operação 2 */ }
  ]
}

// Servidor → Cliente (confirmação)
{
  "type": "ack_batch",
  "opIds": ["op-uuid-1", "op-uuid-2"],
  "serverVersion": 44
}
```

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
  "ops": [ /* operações desde versão 35 */ ],
  "currentVersion": 42
}

// Servidor → Cliente (snapshot - quando lastVersion == 0 ou < min_version)
{
  "type": "sync_response",
  "isSnapshot": true,
  "snapshot": { /* snapshot completo do atlas (ver doc 05) */ },
  "currentVersion": 42
}
```

> **Nota:** O sistema híbrido retorna snapshot completo quando `lastVersion == 0` ou quando o cliente está muito desatualizado (`lastVersion < min_version`). Caso contrário, retorna operações incrementais.

### 3.7 Eventos de Presença

```javascript
// Servidor → Clientes (quando alguém entra)
{
  "type": "user_joined",
  "user": {
    "id": "user-uuid",
    "nome": "Capitão Silva",
    "posto_graduacao": "Cap"
  }
}

// Servidor → Clientes (quando alguém sai)
{
  "type": "user_left",
  "userId": "user-uuid"
}
```

### 3.8 Erros

```javascript
{
  "type": "error",
  "code": "FORBIDDEN",
  "message": "Write permission required"
}
```

Códigos de erro comuns:
- `FORBIDDEN` - Sem permissão para a ação (ex: read-only tentando enviar operação)
- `OPERATION_FAILED` - Falha ao processar operação CRDT
- `SYNC_FAILED` - Falha ao processar sync request

---

## 4. Fluxo de Colaboração

```
Cliente A                        Backend                         Cliente B
   |                                |                                |
   [Usuário cria feature]           |                                |
   |                                |                                |
   |-- WS: operation -------------->|                                |
   |   { type: 'create',            |                                |
   |     target: 'feature',         |                                |
   |     targetId: 'uuid',          |                                |
   |     data: {...} }              |                                |
   |                                |                                |
   |                                |-- WS: operation -------------->|
   |                                |   [Broadcast para sala]        |
   |                                |                                |
   |<-- WS: ack --------------------|                                |
   |   { opId, serverVersion }      |                                |
   |                                |                                |
   |                                |                [Cliente B aplica
   |                                |                 operação local]
```

---

## 5. Fluxo de Presença

```
Cliente A                        Backend                         Cliente B
   |                                |                                |
   |-- WS: cursor ----------------->|                                |
   |   { position: {lat, lng},      |                                |
   |     mapId: 'uuid' }            |                                |
   |                                |-- WS: cursor ----------------->|
   |                                |   { userId, position, mapId }  |
   |                                |                                |
   |                                |                [Exibe cursor de A]
```

---

## 6. Implementação de Referência

```javascript
class CollabWebSocket {
  constructor(atlasId, token) {
    this.atlasId = atlasId;
    this.token = token;
    this.ws = null;
    this.sessionId = null;
    this.permission = null;
    this.pingInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    const url = `ws://${HOST}/api/v1/collab?atlasId=${this.atlasId}&token=${this.token}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('WebSocket conectado');
      this.reconnectAttempts = 0;
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handleMessage(msg);
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket desconectado', event.code);
      this.stopPing();
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket erro:', error);
    };
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        this.sessionId = msg.sessionId;
        this.permission = msg.permission;
        this.onUsersOnline(msg.usersOnline);
        break;

      case 'pong':
        // Heartbeat OK
        break;

      case 'cursor':
        this.onCursorUpdate(msg.userId, msg.position, msg.mapId);
        break;

      case 'selection':
        this.onSelectionUpdate(msg.userId, msg.featureIds, msg.mapId);
        break;

      case 'operation':
        this.onRemoteOperation(msg.op);
        break;

      case 'ack':
        this.onOperationAck(msg.opId, msg.serverVersion);
        break;

      case 'ack_batch':
        msg.opIds.forEach(id => this.onOperationAck(id, msg.serverVersion));
        break;

      case 'user_joined':
        this.onUserJoined(msg.user);
        break;

      case 'user_left':
        this.onUserLeft(msg.userId);
        break;

      case 'error':
        this.onError(msg.code, msg.message);
        break;
    }
  }

  startPing() {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Máximo de tentativas de reconexão atingido');
      this.onMaxReconnectAttemptsReached();
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`Tentando reconectar em ${delay}ms...`);
    setTimeout(() => this.connect(), delay);
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('WebSocket não está aberto');
    }
  }

  // Enviar posição do cursor
  sendCursor(lat, lng, mapId) {
    this.send({
      type: 'cursor',
      position: { lat, lng },
      mapId
    });
  }

  // Enviar seleção de features
  sendSelection(featureIds, mapId) {
    this.send({
      type: 'selection',
      featureIds,
      mapId
    });
  }

  // Enviar operação CRDT
  sendOperation(op) {
    if (this.permission === 'read') {
      console.warn('Sem permissão de escrita');
      return false;
    }
    this.send({ type: 'operation', op });
    return true;
  }

  // Enviar múltiplas operações
  sendOperations(ops) {
    if (this.permission === 'read') {
      console.warn('Sem permissão de escrita');
      return false;
    }
    this.send({ type: 'operations', ops });
    return true;
  }

  // Solicitar sync via WebSocket
  requestSync(lastVersion) {
    this.send({
      type: 'sync_request',
      lastVersion
    });
  }

  // Desconectar
  disconnect() {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // Callbacks a serem implementados pelo consumidor
  onUsersOnline(users) {}
  onCursorUpdate(userId, position, mapId) {}
  onSelectionUpdate(userId, featureIds, mapId) {}
  onRemoteOperation(op) {}
  onOperationAck(opId, serverVersion) {}
  onUserJoined(user) {}
  onUserLeft(userId) {}
  onError(code, message) {}
  onMaxReconnectAttemptsReached() {}
}
```

---

## 7. Exibindo Cursores de Outros Usuários

```javascript
class CursorManager {
  constructor(map) {
    this.map = map;
    this.cursors = new Map(); // userId -> marker
  }

  updateCursor(userId, userName, position, color) {
    let cursor = this.cursors.get(userId);

    if (!cursor) {
      // Criar novo cursor
      cursor = this.createCursorMarker(userName, color);
      this.cursors.set(userId, cursor);
    }

    // Atualizar posição
    cursor.setLatLng([position.lat, position.lng]);
  }

  removeCursor(userId) {
    const cursor = this.cursors.get(userId);
    if (cursor) {
      this.map.removeLayer(cursor);
      this.cursors.delete(userId);
    }
  }

  createCursorMarker(userName, color) {
    // Implementação específica para Leaflet/Mapbox/etc
    const icon = L.divIcon({
      className: 'user-cursor',
      html: `
        <div style="color: ${color}">
          <svg>...</svg>
          <span>${userName}</span>
        </div>
      `
    });

    return L.marker([0, 0], { icon }).addTo(this.map);
  }
}
```

---

## 8. Gerenciando Lista de Usuários Online

```javascript
class OnlineUsersManager {
  constructor() {
    this.users = new Map();
  }

  setInitialUsers(users) {
    this.users.clear();
    for (const user of users) {
      this.users.set(user.id, user);
    }
    this.render();
  }

  addUser(user) {
    this.users.set(user.id, user);
    this.render();
    this.showNotification(`${user.nome} entrou`);
  }

  removeUser(userId) {
    const user = this.users.get(userId);
    if (user) {
      this.users.delete(userId);
      this.render();
      this.showNotification(`${user.nome} saiu`);
    }
  }

  render() {
    const container = document.getElementById('online-users');
    container.innerHTML = '';

    for (const user of this.users.values()) {
      const element = document.createElement('div');
      element.className = 'online-user';
      element.innerHTML = `
        <span class="user-avatar" style="background: ${this.getColorForUser(user.id)}"></span>
        <span class="user-name">${user.nome}</span>
      `;
      container.appendChild(element);
    }
  }

  getColorForUser(userId) {
    // Gerar cor consistente baseada no ID
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${hash % 360}, 70%, 50%)`;
  }

  showNotification(message) {
    // Toast ou similar
  }
}
```

---

## 9. Integração Completa

```javascript
class CollaborationManager {
  constructor(atlasId, accessToken) {
    this.atlasId = atlasId;
    this.accessToken = accessToken;
    this.ws = new CollabWebSocket(atlasId, accessToken);
    this.cursors = new CursorManager(map);
    this.onlineUsers = new OnlineUsersManager();

    this.setupCallbacks();
  }

  setupCallbacks() {
    this.ws.onUsersOnline = (users) => {
      this.onlineUsers.setInitialUsers(users);
      users.forEach(u => {
        if (u.cursorPosition) {
          this.cursors.updateCursor(u.id, u.nome, u.cursorPosition,
            this.onlineUsers.getColorForUser(u.id));
        }
      });
    };

    this.ws.onCursorUpdate = (userId, position, mapId) => {
      const user = this.onlineUsers.users.get(userId);
      if (user && mapId === this.currentMapId) {
        this.cursors.updateCursor(userId, user.nome, position,
          this.onlineUsers.getColorForUser(userId));
      }
    };

    this.ws.onUserJoined = (user) => {
      this.onlineUsers.addUser(user);
    };

    this.ws.onUserLeft = (userId) => {
      this.onlineUsers.removeUser(userId);
      this.cursors.removeCursor(userId);
    };

    this.ws.onRemoteOperation = (op) => {
      // Aplicar operação no IndexedDB e atualizar UI
      this.applyRemoteOperation(op);
    };

    this.ws.onOperationAck = (opId, serverVersion) => {
      // Marcar operação como confirmada
      this.markOperationConfirmed(opId, serverVersion);
    };

    this.ws.onError = (code, message) => {
      console.error(`WebSocket Error: ${code} - ${message}`);
      if (code === 'FORBIDDEN') {
        this.showPermissionError();
      }
    };
  }

  connect() {
    this.ws.connect();
  }

  disconnect() {
    this.ws.disconnect();
  }
}
```

---

## 10. Limitações Atuais do WebSocket

### Rooms são por Atlas, não por Mapa

Todas as mensagens são broadcast para **todos os clientes conectados ao atlas**, independente do mapa ativo. Isso significa:
- Cursor e seleção de usuários em outros mapas são recebidos por todos
- O frontend deve filtrar por `mapId` para exibir apenas cursores do mesmo mapa
- Operações CRDT são sempre broadcast para todos (necessário para consistência)

```javascript
// Frontend deve filtrar cursores por mapId
ws.onCursorUpdate = (userId, position, mapId) => {
  if (mapId === currentMapId) {
    cursors.updateCursor(userId, position);
  }
};
```

### Operações REST não emitem eventos WS

Alterações feitas via REST API **não são broadcast via WebSocket**:
- `PUT /atlas/:atlasId` (nome, descrição, map_order)
- `PATCH /atlas/:atlasId/settings` (configurações)
- `DELETE /atlas/:atlasId` (deletar atlas)
- `POST/DELETE /atlas/:atlasId/sharing/*` (compartilhamento)

O frontend deve fazer polling ou refresh manual para essas operações até que o backend implemente broadcast REST→WS.

### Sem replay de mensagens perdidas

Quando um cliente desconecta e reconecta, mensagens enviadas durante a desconexão são perdidas. O cliente deve:
1. Reconectar com backoff exponencial
2. Enviar `sync_request` com `lastVersion` para obter operações perdidas
3. O servidor retorna snapshot completo ou operações incrementais conforme necessário

### Sem awareness de briefing

Não existem mensagens para indicar quem está editando um briefing (`briefing_edit_started` / `briefing_edit_ended`). Múltiplos usuários podem editar o mesmo briefing sem saber.

---

## Checklist de Implementação

- [ ] Conexão WebSocket com token apropriado
- [ ] Heartbeat (ping/pong a cada 30s)
- [ ] Recebimento de mensagem `connected`
- [ ] Armazenamento de `sessionId` e `permission`
- [ ] Verificação de permissão antes de enviar operações
- [ ] Envio de posição do cursor
- [ ] Envio de seleção de features
- [ ] Recebimento de cursores de outros usuários
- [ ] Recebimento de seleção de outros usuários
- [ ] Envio de operações CRDT via WebSocket
- [ ] Recebimento de operações remotas
- [ ] Processamento de ack de operações
- [ ] Exibição de lista de usuários online
- [ ] Tratamento de `user_joined` e `user_left`
- [ ] Reconexão automática com backoff exponencial
- [ ] Tratamento de erros
- [ ] Filtrar cursores/seleção por `mapId` no frontend
- [ ] Sync request após reconexão (para recuperar operações perdidas)

---

## Próximo Documento

[05 - Sync CRDT](./05-sync-crdt.md) - Operações CRDT e resolução de conflitos
