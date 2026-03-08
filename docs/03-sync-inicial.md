# 03 - Sync Inicial

Este documento cobre o pull inicial de dados e o sistema de snapshot.

---

## Visão Geral

Ao abrir um atlas, o frontend precisa carregar todos os dados. O backend usa um **sistema híbrido** de sincronização:

1. **Snapshot** (versão 0 ou < min_version): Estado completo materializado
2. **Operações incrementais** (versão >= min_version): Lista de alterações

---

## 1. Fluxo de Abertura de Atlas

```
Cliente                          Backend
   |                                |
   |  [Usuário clica em um atlas]   |
   |                                |
   |-- GET /atlas/:id/sync/0 ------>|  (1) Pull inicial - versão 0
   |   Authorization: Bearer token  |
   |                                |
   |<-- 200 -----------------------|
   |   { snapshot: {                |  ← Retorna SNAPSHOT
   |       atlas: {...},            |
   |       maps: [...],             |
   |       briefings: [...]         |
   |     },                         |
   |     currentVersion: 150,       |
   |     isSnapshot: true }         |
   |                                |
   [Cliente carrega snapshot        |
    diretamente no IndexedDB]       |
   |                                |
   |-- WS /collab?atlasId=X&token=Y>|  (2) Conecta WebSocket
   |                                |
   |<-- WS: connected --------------|
   |   { sessionId, permission,     |
   |     usersOnline: [...] }       |
   |                                |
   [Atlas pronto para uso]          |
```

---

## 2. Endpoint de Pull

### Endpoint

`GET /api/v1/atlas/:atlasId/sync/:version`

### Headers

`Authorization: Bearer <accessToken>`

### Permissão Mínima

`read`

### Parâmetro

- `:version` - Última versão conhecida pelo cliente (use `0` para pull inicial)

---

## 3. Resposta: Snapshot

Retornado quando `version == 0` ou `version < min_version`:

```json
{
  "data": {
    "snapshot": {
      "atlas": {
        "id": "atlas-uuid",
        "name": "Operação Alfa",
        "description": "Atlas da operação",
        "settings": { "..." },
        "mapOrder": ["map-uuid-1", "map-uuid-2"],
        "isPublic": false,
        "sync": {
          "createdAt": 1705312200000,
          "updatedAt": 1705312200000,
          "version": 1,
          "ownerId": "user-uuid",
          "dirty": false,
          "deleted": false
        }
      },
      "maps": [
        {
          "id": "map-uuid-1",
          "name": "Área Principal",
          "base_layer": "carta-topografica",
          "center_lat": -15.7,
          "center_long": -47.9,
          "zoom": 12,
          "bearing": 0,
          "pitch": 0,
          "notes_title": null,
          "notes_description": null,
          "analysis_layers": {},
          "catalog_layers": [],
          "locked": false,
          "sync": {
            "createdAt": 1705312200000,
            "updatedAt": 1705312200000,
            "version": 1,
            "ownerId": null,
            "dirty": false,
            "deleted": false
          },
          "features": {
            "points": [
              {
                "type": "Feature",
                "geometry": { "coordinates": [-47.9, -15.7] },
                "properties": {
                  "name": "Marco",
                  "color": "#FF0000",
                  "id": "feat-uuid",
                  "source": "point",
                  "createdAt": 1705312200000,
                  "updatedAt": 1705312200000,
                  "version": 1
                }
              }
            ],
            "lines": [],
            "polygons": [],
            "texts": [],
            "images": [],
            "circles": [],
            "rectangles": [],
            "ellipses": [],
            "brushes": [],
            "arrows": [],
            "boundarys": [],
            "occupied_fronts": [],
            "military_symbols": [],
            "coordination_measures": [],
            "los": [],
            "visibility": [],
            "processed_los": [],
            "processed_visibility": []
          },
          "layers": [
            {
              "id": "layer-uuid",
              "name": "Camada 1",
              "visible": true,
              "locked": false,
              "opacity": 1,
              "order": 0,
              "style": {},
              "createdAt": 1705312200000,
              "updatedAt": 1705312200000,
              "version": 1
            }
          ],
          "groups": [
            {
              "id": "group-uuid",
              "name": "Grupo 1",
              "visible": true,
              "locked": false,
              "style": {},
              "parent_id": null,
              "features": [
                { "type": "point", "id": "feat-uuid" }
              ],
              "sync": {
                "createdAt": 1705312200000,
                "updatedAt": 1705312200000,
                "version": 1,
                "ownerId": null,
                "dirty": false,
                "deleted": false
              }
            }
          ],
          "groupFeatures": [
            { "group_id": "group-uuid", "feature_id": "feat-uuid" }
          ],
          "cesium3d": {
            "cameraPositions": {
              "PCL": {
                "id": "cesium-uuid",
                "tilesetId": "PCL",
                "position": { "longitude": -43.2, "latitude": -22.9, "height": 100 },
                "sync": {
                  "createdAt": 1705312200000,
                  "updatedAt": 1705312200000,
                  "version": 1,
                  "ownerId": null,
                  "dirty": false,
                  "deleted": false
                }
              }
            },
            "markers": [],
            "measurements": [],
            "viewsheds": []
          },
          "streetview360": {
            "orientations": {
              "foto-001": {
                "id": "sv360-uuid",
                "photoName": "foto-001",
                "heading": 45,
                "pitch": 0,
                "sync": {
                  "createdAt": 1705312200000,
                  "updatedAt": 1705312200000,
                  "version": 1,
                  "ownerId": null,
                  "dirty": false,
                  "deleted": false
                }
              }
            },
            "markers": []
          }
        }
      ],
      "briefings": [
        {
          "id": "briefing-uuid",
          "name": "Briefing Ops",
          "description": "...",
          "settings": {},
          "slide_order": ["slide-1", "slide-2"],
          "sync": {
            "createdAt": 1705312200000,
            "updatedAt": 1705312200000,
            "version": 1,
            "ownerId": null,
            "dirty": false,
            "deleted": false
          },
          "slides": [
            {
              "id": "slide-1",
              "briefing_id": "briefing-uuid",
              "title": "Situação",
              "content": "...",
              "mode": "2d",
              "map_id": "map-uuid-1",
              "model_id": null,
              "photo_id": null,
              "position": {},
              "orientation": {},
              "is_broken": false,
              "broken_reason": null
            }
          ]
        }
      ],
      "currentVersion": 150
    },
    "currentVersion": 150,
    "isSnapshot": true
  }
}
```

---

## 4. Resposta: Operações Incrementais

Retornado quando `version >= min_version`:

> **Nota:** O backend converte os nomes de campos para o formato do frontend na resposta. Tipos genéricos (`cesium3d`, `streetview360`) são convertidos de volta para tipos específicos (`marker3d`, `orientation360`, etc.).

```json
{
  "data": {
    "operations": [
      {
        "id": "op-uuid",
        "entityType": "feature",
        "operationType": "create",
        "entityId": "feat-uuid",
        "mapId": "map-uuid",
        "data": { "..." },
        "changes": null,
        "timestamp": 1699999999999,
        "clientId": "client-uuid",
        "serverVersion": 151
      },
      {
        "id": "op-uuid-2",
        "entityType": "feature",
        "operationType": "update",
        "entityId": "feat-uuid",
        "mapId": "map-uuid",
        "data": null,
        "changes": { "properties": { "name": "Novo nome" } },
        "timestamp": 1700000000123,
        "clientId": "client-uuid-2",
        "serverVersion": 152
      }
    ],
    "currentVersion": 152,
    "isSnapshot": false
  }
}
```

---

## 5. Comparação: Snapshot vs Operações

| Aspecto | Snapshot | Operações |
|---------|----------|-----------|
| Retornado quando | versão = 0 ou < min_version | versão >= min_version |
| Conteúdo | Estado atual completo | Lista de alterações |
| Processamento cliente | Carrega diretamente | Aplica sequencialmente |
| Tamanho | Proporcional ao estado | Proporcional às mudanças |
| `isSnapshot` | `true` | `false` |

---

## 6. Carregando Snapshot no IndexedDB

> **Nota:** O snapshot do backend já retorna a estrutura no formato esperado pelo frontend (features organizadas por tipo como GeoJSON, cesium3d/streetview360 hierárquicos, sync metadata em cada entidade).

```javascript
async function loadSnapshotToIndexedDB(snapshot) {
  const db = await openDatabase();
  const tx = db.transaction(['atlas', 'maps', 'features', 'layers',
                            'groups', 'briefings', 'slides'], 'readwrite');

  try {
    // 1. Salvar atlas (inclui sync metadata)
    await tx.objectStore('atlas').put({
      ...snapshot.atlas,
      lastSyncVersion: snapshot.currentVersion
    });

    // 2. Salvar mapas e suas entidades
    for (const map of snapshot.maps) {
      // Map já inclui: locked, sync metadata
      await tx.objectStore('maps').put({
        id: map.id,
        atlasId: snapshot.atlas.id,
        name: map.name,
        base_layer: map.base_layer,
        center_lat: map.center_lat,
        center_long: map.center_long,
        zoom: map.zoom,
        bearing: map.bearing,
        pitch: map.pitch,
        locked: map.locked,
        notes_title: map.notes_title,
        notes_description: map.notes_description,
        analysis_layers: map.analysis_layers,
        catalog_layers: map.catalog_layers,
        sync: map.sync
      });

      // Features - já organizadas por tipo: { points: [], lines: [], ... }
      // Cada feature é GeoJSON: { type: "Feature", geometry, properties: { ...props, id, source, createdAt, updatedAt, version } }
      await tx.objectStore('features').put({
        mapId: map.id,
        ...map.features
      });

      // Layers - já transformadas: { id, name, visible, locked, opacity, order, style, createdAt, updatedAt, version }
      for (const layer of map.layers) {
        await tx.objectStore('layers').put({
          ...layer,
          mapId: map.id
        });
      }

      // Groups - incluem features embutidas [{ type, id }] e sync metadata
      for (const group of map.groups) {
        await tx.objectStore('groups').put({
          ...group,
          mapId: map.id
        });
      }

      // Cesium3D - hierárquico: { cameraPositions: {}, markers: [], measurements: [], viewsheds: [] }
      // Cada entrada inclui sync metadata
      // (armazenar conforme estrutura do frontend)

      // StreetView360 - hierárquico: { orientations: {}, markers: [] }
      // Cada entrada inclui sync metadata
    }

    // 3. Salvar briefings e slides (briefings incluem sync metadata)
    for (const briefing of snapshot.briefings) {
      await tx.objectStore('briefings').put({
        ...briefing,
        atlasId: snapshot.atlas.id,
        slides: undefined // Slides são salvos separadamente
      });

      for (const slide of briefing.slides) {
        await tx.objectStore('slides').put({
          ...slide,
          atlasId: snapshot.atlas.id
        });
      }
    }

    await tx.done;
    console.log('Snapshot carregado com sucesso');
  } catch (error) {
    console.error('Erro ao carregar snapshot:', error);
    throw error;
  }
}
```

---

## 7. Aplicando Operações Incrementais

> **Nota:** As operações incrementais usam nomes no formato do frontend (`entityType`, `operationType`, `entityId`, `mapId`, `timestamp`, `clientId`, `serverVersion`). Tipos específicos de 3D/360 são retornados diretamente (ex: `marker3d`, `orientation360`).

```javascript
async function applyOperations(operations) {
  const db = await openDatabase();

  for (const op of operations) {
    const storeName = getStoreForEntityType(op.entityType);
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);

    switch (op.operationType) {
      case 'create':
        await store.put({
          id: op.entityId,
          ...op.data,
          mapId: op.mapId
        });
        break;

      case 'update':
        const existing = await store.get(op.entityId);
        if (existing) {
          await store.put({
            ...existing,
            ...op.changes
          });
        }
        break;

      case 'delete':
        await store.delete(op.entityId);
        break;
    }

    await tx.done;
  }
}

function getStoreForEntityType(entityType) {
  const mapping = {
    'feature': 'features',
    'layer': 'layers',
    'group': 'groups',
    'map': 'maps',
    'briefing': 'briefings',
    'slide': 'slides',
    // Tipos específicos de 3D/360 (retornados como tipos frontend)
    'marker3d': 'cesium3dData',
    'measurement3d': 'cesium3dData',
    'viewshed3d': 'cesium3dData',
    'cameraPosition3d': 'cesium3dData',
    'orientation360': 'streetview360Data',
    'marker360': 'streetview360Data',
    'group_feature': 'groupFeatures'
  };
  return mapping[entityType];
}
```

---

## 8. Estrutura Completa do Snapshot

O snapshot retorna estrutura idêntica ao IndexedDB do frontend, com transformações automáticas:

```
snapshot
├── atlas
│   ├── id, name, description
│   ├── settings, mapOrder, isPublic
│   └── sync { createdAt, updatedAt, version, ownerId, dirty, deleted }
│
├── maps[]
│   ├── id, name, base_layer
│   ├── center_lat, center_long
│   ├── zoom, bearing, pitch
│   ├── notes_title, notes_description
│   ├── analysis_layers, catalog_layers
│   ├── locked
│   ├── sync { createdAt, updatedAt, version, ownerId, dirty, deleted }
│   │
│   ├── features {}                          ← Objeto organizado por tipo
│   │   ├── points[]                          (GeoJSON Features)
│   │   ├── lines[]                           { type: "Feature",
│   │   ├── polygons[]                          geometry: {...},
│   │   ├── texts[], images[]                   properties: { ...props,
│   │   ├── circles[], rectangles[]               id, source, createdAt,
│   │   ├── ellipses[], brushes[]                 updatedAt, version } }
│   │   ├── arrows[], boundarys[]
│   │   ├── occupied_fronts[]
│   │   ├── military_symbols[]
│   │   ├── coordination_measures[]
│   │   ├── los[], visibility[]
│   │   └── processed_los[], processed_visibility[]
│   │
│   ├── layers[]
│   │   ├── id, name, visible, locked
│   │   ├── opacity, order (sort_order → order)
│   │   ├── style, createdAt, updatedAt, version
│   │
│   ├── groups[]
│   │   ├── id, name, visible, locked
│   │   ├── style, parent_id
│   │   ├── features [{ type, id }]           ← Refs embutidas
│   │   └── sync { createdAt, updatedAt, version, ownerId, dirty, deleted }
│   │
│   ├── groupFeatures[]                       ← Mantido para compatibilidade
│   │   └── { group_id, feature_id }
│   │
│   ├── cesium3d {}                           ← Objeto hierárquico
│   │   ├── cameraPositions { [tilesetId]: entry }
│   │   ├── markers []
│   │   ├── measurements []
│   │   └── viewsheds []
│   │   (cada entry: { id, tilesetId, ...data, sync })
│   │
│   └── streetview360 {}                      ← Objeto hierárquico
│       ├── orientations { [photoName]: entry }
│       └── markers []
│       (cada entry: { id, photoName, ...data, sync })
│
├── briefings[]
│   ├── id, name, description
│   ├── settings, slide_order
│   ├── sync { createdAt, updatedAt, version, ownerId, dirty, deleted }
│   │
│   └── slides[]
│       ├── id, briefing_id
│       ├── title, content, mode (2d, 3d, 360)
│       ├── map_id, model_id, photo_id
│       ├── position, orientation
│       └── is_broken, broken_reason
│
└── currentVersion (number)
```

### Transformações Aplicadas pelo Backend

| Campo no DB | Campo no Snapshot | Descrição |
|-------------|-------------------|-----------|
| `features[]` (flat) | `features {}` (por tipo) | Organizado em 18 coleções como GeoJSON Features |
| `cesium3d_data[]` (flat) | `cesium3d {}` (hierárquico) | Separado por `data_type` em cameraPositions/markers/measurements/viewsheds |
| `streetview360_data[]` (flat) | `streetview360 {}` (hierárquico) | Separado por `data_type` em orientations/markers |
| `sort_order` | `order` | Layers usam `order` ao invés de `sort_order` |
| `map_order` | `mapOrder` | Atlas usa camelCase |
| `is_public` | `isPublic` | Atlas usa camelCase |
| timestamps | `sync.createdAt` etc. | Convertido para milliseconds (epoch) |

---

## 9. Tipos de Feature Suportados

O backend suporta 18 tipos de features:

| Categoria | Tipos |
|-----------|-------|
| **Básicos** | `point`, `line`, `polygon`, `text`, `image` |
| **Formas** | `circle`, `rectangle`, `ellipse`, `brush` |
| **Militares** | `arrow`, `boundary`, `occupied_front`, `military_symbol`, `coordination_measure` |
| **Análises** | `los`, `visibility`, `processed_los`, `processed_visibility` |

---

## 10. Fluxo de Sincronização

```
┌─────────────────────────────────────────────────────────────┐
│                     SYNC INICIAL                            │
├─────────────────────────────────────────────────────────────┤
│  1. GET /atlas/:id/sync/0                                   │
│  2. Recebe SNAPSHOT (isSnapshot: true)                      │
│  3. Carrega snapshot no IndexedDB                           │
│  4. Armazena currentVersion                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     SYNC INCREMENTAL                        │
├─────────────────────────────────────────────────────────────┤
│  1. GET /atlas/:id/sync/:lastVersion                        │
│  2. Recebe OPERAÇÕES (isSnapshot: false)                    │
│  3. Aplica operações no IndexedDB                           │
│  4. Atualiza currentVersion                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. Implementação de Referência

```javascript
class SyncManager {
  constructor(atlasId, accessToken) {
    this.atlasId = atlasId;
    this.accessToken = accessToken;
    this.lastVersion = 0;
  }

  async initialSync() {
    const response = await fetch(
      `/api/v1/atlas/${this.atlasId}/sync/0`,
      {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      }
    );

    const result = await response.json();

    if (result.data.isSnapshot) {
      await this.loadSnapshot(result.data.snapshot);
    } else {
      // Não deveria acontecer para versão 0, mas tratar por segurança
      await this.applyOperations(result.data.operations);
    }

    this.lastVersion = result.data.currentVersion;
    return this.lastVersion;
  }

  async incrementalSync() {
    const response = await fetch(
      `/api/v1/atlas/${this.atlasId}/sync/${this.lastVersion}`,
      {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      }
    );

    const result = await response.json();

    if (result.data.isSnapshot) {
      // Ficou muito desatualizado, recarregar tudo
      await this.loadSnapshot(result.data.snapshot);
    } else {
      await this.applyOperations(result.data.operations);
    }

    this.lastVersion = result.data.currentVersion;
    return this.lastVersion;
  }

  async loadSnapshot(snapshot) {
    // Implementação do passo 6
    await loadSnapshotToIndexedDB(snapshot);
  }

  async applyOperations(operations) {
    // Implementação do passo 7
    await applyOperations(operations);
  }
}

// Uso
const syncManager = new SyncManager(atlasId, accessToken);
await syncManager.initialSync();
```

---

## Checklist de Implementação

- [ ] Chamada ao endpoint de pull com versão 0
- [ ] Detecção de `isSnapshot` na resposta
- [ ] Carregamento de snapshot no IndexedDB
- [ ] Armazenamento de `lastVersion`
- [ ] Pull incremental quando necessário
- [ ] Aplicação de operações incrementais
- [ ] Fallback para snapshot quando versão < min_version

---

## Próximo Documento

[04 - WebSocket Colaboração](./04-websocket-collab.md) - Conexão e presença em tempo real
