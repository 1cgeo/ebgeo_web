# 05 - Sync CRDT

Este documento cobre as operações CRDT, push/pull HTTP e resolução de conflitos.

---

## Visão Geral

O sistema usa CRDT (Conflict-free Replicated Data Types) com Last-Writer-Wins (LWW):
- Cada operação tem `timestamp` e `clientId`
- Em caso de conflito, a operação mais recente vence
- Delete sempre vence sobre update

---

## 1. Estrutura de Operação

O backend aceita **dois formatos** de operação (ambos válidos):

### Formato Frontend (recomendado)

```typescript
interface Operation {
  id: string;                // UUID da operação
  entityType: string;        // Tipo da entidade (ver lista abaixo)
  operationType: 'create' | 'update' | 'delete';
  entityId: string;          // UUID da entidade
  mapId?: string;            // UUID do mapa (quando aplicável)
  timestamp: number;         // Milliseconds desde epoch
  clientId: string;          // UUID do cliente (gerado no frontend)
  data?: object;             // Dados completos (para create)
  changes?: object;          // Campos alterados (para update)
}
```

### Formato Legacy (também suportado)

```typescript
interface Operation {
  id: string;
  type: 'create' | 'update' | 'delete';
  target: string;
  targetId: string;
  mapId?: string;
  timestamp: number;
  clientId: string;
  data?: object;
  changes?: object;
}
```

> O backend normaliza automaticamente entre os dois formatos.

---

## 2. Targets Suportados

| Target/EntityType | Descrição | Requer mapId |
|-------------------|-----------|--------------|
| `feature` | Feição geoespacial (18 tipos) | Sim |
| `group` | Grupo de feições | Sim |
| `layer` | Camada | Sim |
| `group_feature` | Associação grupo-feição | Não |
| `map` | Mapa | Não |
| `briefing` | Briefing | Não |
| `slide` | Slide de briefing | Não |
| `cesium3d` | Dados 3D do Cesium | Sim |
| `streetview360` | Dados de panoramas 360° | Sim |

### Sub-entidades de Mapa

Estes EntityTypes são mapeados automaticamente para updates na tabela `maps`:

| EntityType | Campos atualizados |
|------------|-------------------|
| `mapPosition` | `center_lat`, `center_long`, `zoom`, `bearing`, `pitch` |
| `baseLayer` | `base_layer` |
| `mapNotes` | `notes_title`, `notes_description` |
| `gridStyle` | ⚠️ **no-op** — não há coluna de grade em `maps` (gap aberto) |
| `catalogLayer` | ⚠️ **incompatível** — frontend emite ops por-camada, backend espera array em `catalog_layers` (gap aberto) |

> **Nota:** Para sub-entidades de mapa, use `mapId` com o ID do mapa a atualizar. Os dados vêm no campo `data` (não `changes`).
>
> ⚠️ `gridStyle` e `catalogLayer` estão registrados como aliases mas **ainda não persistem**.
> Detalhes e fix em [11-gaps-multiusuario.md](../pendente/11-gaps-multiusuario.md).

### Mapeamento de EntityTypes (3D/360)

O backend aceita aliases do frontend e converte automaticamente:

| Frontend | Backend | data_type |
|----------|---------|-----------|
| `marker3d` | `cesium3d` | marker |
| `measurement3d` | `cesium3d` | measurement |
| `viewshed3d` | `cesium3d` | viewshed |
| `cameraPosition3d` | `cesium3d` | camera_position |
| `orientation360` | `streetview360` | orientation |
| `marker360` | `streetview360` | marker |

> Na resposta de pull incremental, os tipos genéricos são convertidos de volta para os tipos específicos do frontend.

---

## 3. Exemplos de Operações

### Criar Feature

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "feature",
  "targetId": "feat-uuid",
  "mapId": "map-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "feature_type": "point",
    "geometry": {
      "type": "Point",
      "coordinates": [-47.9, -15.7]
    },
    "properties": {
      "name": "Posto de Observação",
      "color": "#FF0000",
      "icon": "observation"
    },
    "layer_id": null
  }
}
```

### Atualizar Feature

```json
{
  "id": "op-uuid",
  "type": "update",
  "target": "feature",
  "targetId": "feat-uuid",
  "mapId": "map-uuid",
  "timestamp": 1700000000123,
  "clientId": "client-uuid",
  "changes": {
    "geometry": {
      "type": "Point",
      "coordinates": [-47.91, -15.71]
    },
    "properties": {
      "name": "Posto de Observação Alfa"
    }
  }
}
```

### Deletar Feature

```json
{
  "id": "op-uuid",
  "type": "delete",
  "target": "feature",
  "targetId": "feat-uuid",
  "mapId": "map-uuid",
  "timestamp": 1700000001000,
  "clientId": "client-uuid"
}
```

### Criar Mapa

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "map",
  "targetId": "map-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "name": "Área de Operações",
    "base_layer": "carta-topografica",
    "center_lat": -15.7,
    "center_long": -47.9,
    "zoom": 12,
    "bearing": 0,
    "pitch": 0,
    "analysis_layers": {},
    "catalog_layers": []
  }
}
```

### Criar Briefing

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "briefing",
  "targetId": "briefing-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "name": "Briefing Operacional",
    "description": "Situação atual da operação",
    "settings": {
      "panelPosition": "left",
      "panelWidth": 350
    }
  }
}
```

### Criar Slide

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "slide",
  "targetId": "slide-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "briefing_id": "briefing-uuid",
    "title": "Situação Atual",
    "content": "Descrição da situação...",
    "mode": "2d",
    "map_id": "map-uuid",
    "position": {
      "center": [-47.9, -15.7],
      "zoom": 14
    },
    "orientation": {}
  }
}
```

### Criar Layer

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "layer",
  "targetId": "layer-uuid",
  "mapId": "map-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "name": "Objetivos",
    "visible": true,
    "locked": false,
    "sort_order": 0,
    "style": {
      "color": "#FF0000"
    }
  }
}
```

### Criar Group

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "group",
  "targetId": "group-uuid",
  "mapId": "map-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "name": "Postos de Observação",
    "visible": true,
    "locked": false,
    "style": {},
    "parent_id": null
  }
}
```

### Associar Feature a Group

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "group_feature",
  "targetId": "gf-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "group_id": "group-uuid",
    "feature_id": "feat-uuid"
  }
}
```

### Criar Marcador 3D (Cesium)

```json
{
  "id": "op-uuid",
  "type": "create",
  "target": "marker3d",
  "targetId": "marker-uuid",
  "mapId": "map-uuid",
  "timestamp": 1699999999999,
  "clientId": "client-uuid",
  "data": {
    "tileset_id": "PCL",
    "position": {
      "longitude": -47.9,
      "latitude": -15.7,
      "height": 100
    },
    "properties": {
      "name": "Marco 3D"
    }
  }
}
```

---

## 4. Push de Operações (HTTP)

Usado para enviar operações pendentes após reconexão.

### Endpoint

`POST /api/v1/atlas/:atlasId/sync`

### Headers

`Authorization: Bearer <accessToken>`

### Permissão

`write`

### Request

```json
{
  "operations": [
    {
      "id": "op-uuid-1",
      "type": "create",
      "target": "feature",
      "targetId": "feat-uuid",
      "mapId": "map-uuid",
      "timestamp": 1699999999999,
      "clientId": "client-uuid",
      "data": { ... }
    },
    {
      "id": "op-uuid-2",
      "type": "update",
      "target": "feature",
      "targetId": "feat-uuid-2",
      "mapId": "map-uuid",
      "timestamp": 1700000000000,
      "clientId": "client-uuid",
      "changes": { ... }
    }
  ]
}
```

### Response (200)

```json
{
  "data": {
    "acks": [
      { "opId": "op-uuid-1", "serverVersion": 42 },
      { "opId": "op-uuid-2", "serverVersion": 43 }
    ],
    "serverVersion": 43
  }
}
```

---

## 5. Fluxo de Sync HTTP

```
Cliente                          Backend
   |                                |
   [Reconectou após offline]        |
   |                                |
   |-- GET /atlas/:id/sync/150 ---->|  Pull operações perdidas
   |                                |
   |                                |  Backend verifica:
   |                                |  - Se 150 >= min_version → operações
   |                                |  - Se 150 < min_version → snapshot
   |                                |
   |<-- 200 -----------------------|
   |   { operations: [...],         |  (ou snapshot se muito desatualizado)
   |     currentVersion: 175,       |
   |     isSnapshot: false }        |
   |                                |
   [Aplica operações faltantes]     |
   |                                |
   |-- POST /atlas/:id/sync ------->|  Push operações pendentes
   |   { operations: [...] }        |
   |                                |
   |<-- 200 -----------------------|
   |   { acks: [...],               |
   |     serverVersion: 180 }       |
```

---

## 6. Gerando clientId

O `clientId` identifica unicamente a origem das operações. Deve ser único por sessão:

```javascript
// Opção 1: Gerar UUID único por sessão
const clientId = crypto.randomUUID();

// Opção 2: Persistir por dispositivo (localStorage)
function getClientId() {
  let clientId = localStorage.getItem('ebgeo_client_id');
  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem('ebgeo_client_id', clientId);
  }
  return clientId;
}

// Opção 3: Combinar dispositivo + sessão
const clientId = `${deviceId}-${sessionId}`;
```

---

## 7. Gerando Timestamp

Use timestamp em milliseconds desde Unix epoch:

```javascript
const timestamp = Date.now();
// Resultado: 1699999999999
```

Para garantir ordenação mesmo com relógios dessincronizados, você pode usar um relógio lógico:

```javascript
class LogicalClock {
  constructor() {
    this.lastTimestamp = 0;
  }

  now() {
    const physical = Date.now();
    this.lastTimestamp = Math.max(physical, this.lastTimestamp + 1);
    return this.lastTimestamp;
  }
}

const clock = new LogicalClock();
const timestamp = clock.now();
```

---

## 8. Factory de Operações

```javascript
class OperationFactory {
  constructor(clientId) {
    this.clientId = clientId;
  }

  create(target, targetId, data, mapId = null) {
    return {
      id: crypto.randomUUID(),
      type: 'create',
      target,
      targetId,
      mapId,
      timestamp: Date.now(),
      clientId: this.clientId,
      data
    };
  }

  update(target, targetId, changes, mapId = null) {
    return {
      id: crypto.randomUUID(),
      type: 'update',
      target,
      targetId,
      mapId,
      timestamp: Date.now(),
      clientId: this.clientId,
      changes
    };
  }

  delete(target, targetId, mapId = null) {
    return {
      id: crypto.randomUUID(),
      type: 'delete',
      target,
      targetId,
      mapId,
      timestamp: Date.now(),
      clientId: this.clientId
    };
  }
}

// Uso
const factory = new OperationFactory(clientId);

const createOp = factory.create('feature', featureId, {
  feature_type: 'point',
  geometry: { type: 'Point', coordinates: [-47.9, -15.7] },
  properties: { name: 'Marco' }
}, mapId);

const updateOp = factory.update('feature', featureId, {
  properties: { name: 'Marco Atualizado' }
}, mapId);

const deleteOp = factory.delete('feature', featureId, mapId);
```

---

## 9. Dispatcher de Operações

```javascript
class OperationDispatcher {
  constructor(ws, indexedDB, clientId) {
    this.ws = ws;
    this.db = indexedDB;
    this.factory = new OperationFactory(clientId);
    this.pendingOps = new Map(); // opId -> operation
    this.enabled = false;
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  async dispatch(operation) {
    // 1. Sempre salvar localmente primeiro
    await this.saveToIndexedDB(operation);

    // 2. Enviar para servidor se online e habilitado
    if (this.enabled && this.ws.isConnected) {
      this.pendingOps.set(operation.id, operation);
      this.ws.sendOperation(operation);
    } else if (this.enabled) {
      // Salvar como pendente para envio posterior
      await this.savePendingOperation(operation);
    }
  }

  async onAck(opId, serverVersion) {
    this.pendingOps.delete(opId);
    await this.updateLocalVersion(serverVersion);
    await this.removePendingOperation(opId);
  }

  async syncPending() {
    const pending = await this.getPendingOperations();
    if (pending.length > 0) {
      const response = await fetch(`/api/v1/atlas/${atlasId}/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ operations: pending })
      });

      const result = await response.json();
      for (const ack of result.data.acks) {
        await this.onAck(ack.opId, ack.serverVersion);
      }
    }
  }

  // Helper methods
  async saveToIndexedDB(operation) { /* ... */ }
  async savePendingOperation(operation) { /* ... */ }
  async removePendingOperation(opId) { /* ... */ }
  async getPendingOperations() { /* ... */ }
  async updateLocalVersion(version) { /* ... */ }
}
```

---

## 10. Aplicando Operações Remotas

```javascript
class OperationApplier {
  constructor(indexedDB, eventBus) {
    this.db = indexedDB;
    this.eventBus = eventBus;
  }

  async apply(operation) {
    const storeName = this.getStoreForTarget(operation.target);

    switch (operation.type) {
      case 'create':
        await this.applyCreate(storeName, operation);
        break;
      case 'update':
        await this.applyUpdate(storeName, operation);
        break;
      case 'delete':
        await this.applyDelete(storeName, operation);
        break;
    }

    // Emitir evento para UI atualizar
    this.eventBus.emit(`${operation.target}:${operation.type}`, {
      entityId: operation.targetId,
      mapId: operation.mapId,
      data: operation.data || operation.changes
    });
  }

  async applyCreate(storeName, operation) {
    const entity = {
      id: operation.targetId,
      ...operation.data
    };

    if (operation.mapId) {
      entity.map_id = operation.mapId;
    }

    const tx = this.db.transaction(storeName, 'readwrite');
    await tx.objectStore(storeName).put(entity);
    await tx.done;
  }

  async applyUpdate(storeName, operation) {
    const tx = this.db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);

    const existing = await store.get(operation.targetId);
    if (existing) {
      const updated = this.mergeChanges(existing, operation.changes);
      await store.put(updated);
    }

    await tx.done;
  }

  async applyDelete(storeName, operation) {
    const tx = this.db.transaction(storeName, 'readwrite');
    await tx.objectStore(storeName).delete(operation.targetId);
    await tx.done;
  }

  mergeChanges(existing, changes) {
    const result = { ...existing };

    for (const [key, value] of Object.entries(changes)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Merge profundo para objetos
        result[key] = { ...result[key], ...value };
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  getStoreForTarget(target) {
    const mapping = {
      'feature': 'features',
      'layer': 'layers',
      'group': 'groups',
      'group_feature': 'groupFeatures',
      'map': 'maps',
      'briefing': 'briefings',
      'slide': 'slides',
      'cesium3d': 'cesium3dData',
      'streetview360': 'streetview360Data',
      // Aliases
      'marker3d': 'cesium3dData',
      'measurement3d': 'cesium3dData',
      'viewshed3d': 'cesium3dData',
      'cameraPosition3d': 'cesium3dData',
      'orientation360': 'streetview360Data',
      'marker360': 'streetview360Data'
    };
    return mapping[target];
  }
}
```

---

## 11. Resolução de Conflitos (LWW)

O servidor resolve conflitos automaticamente usando Last-Writer-Wins:

```
Regras de resolução:
1. Comparar timestamps
2. Se timestamps iguais, usar clientId como tiebreaker
3. Delete SEMPRE vence sobre update (mesmo com timestamp menor)
```

O cliente pode implementar a mesma lógica localmente:

```javascript
function shouldApply(remoteOp, localState) {
  // Se entidade não existe localmente, sempre aplicar
  if (!localState) return true;

  // Delete sempre vence
  if (remoteOp.type === 'delete') return true;

  // Comparar timestamps
  if (remoteOp.timestamp > localState.lastModified) return true;

  // Tiebreaker: comparar clientId (ordem lexicográfica)
  if (remoteOp.timestamp === localState.lastModified) {
    return remoteOp.clientId > localState.lastClientId;
  }

  return false;
}
```

---

## Checklist de Implementação

- [ ] Geração de clientId único
- [ ] Geração de timestamp correto
- [ ] Factory de operações (create, update, delete)
- [ ] Dispatcher para envio via WebSocket
- [ ] Armazenamento de operações pendentes
- [ ] Push de operações via HTTP
- [ ] Pull incremental via HTTP
- [ ] Aplicação de operações remotas
- [ ] Merge de changes em updates
- [ ] Emissão de eventos para UI

---

## Próximo Documento

[06 - Presença e Imagens](./06-presenca-imagens.md) - Cursores, seleção e upload de imagens
