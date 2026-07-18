# 08 - Offline e Import

Este documento cobre o modo offline, reconexão e upload de atlas criado localmente.

---

## Parte 1: Modos de Operação

O frontend deve suportar três modos:

### 1.1 Modo Anônimo (Sem Login)

- Todos os dados ficam no IndexedDB
- Não há autenticação
- Não há colaboração
- A **edição** é 100% local (escreve local, sincroniza depois)

> **Sem login ≠ sem servidor.** O boot do frontend é fail-fast em `GET /api/config`: sem backend
> alcançável o app mostra "EBGeo indisponível" e não roda. O fluxo de import abaixo (acumular local
> → logar → subir) continua válido; o que não existe é operar com o servidor fora do ar.

### 1.2 Modo Autenticado

- Usuário faz login
- Recebe tokens JWT
- Sync completo com servidor
- Colaboração em tempo real
- Pode criar, editar, compartilhar atlas

### 1.3 Modo Público

- Usuário acessa via link público
- Token temporário (1h, somente leitura)
- Pode visualizar e receber atualizações
- Não pode editar

---

## Parte 2: Reconexão e Operações Pendentes

### 2.1 Fluxo de Reconexão

```
Cliente                          Backend
   |                                |
   [Conexão perdida]                |
   |                                |
   [Operações salvas localmente     |
    no IndexedDB com flag pending]  |
   |                                |
   ...tempo passa...                |
   |                                |
   [Conexão restaurada]             |
   |                                |
   |-- GET /atlas/:id/sync/150 ---->|  Pull operações perdidas
   |                                |
   |<-- 200 -----------------------|
   |   { operations, currentVersion}|
   |                                |
   [Merge: aplica ops do servidor,  |
    resolve conflitos LWW]          |
   |                                |
   |-- POST /atlas/:id/sync ------->|  Push operações pendentes
   |   { operations: [pending...] } |
   |                                |
   |<-- 200 -----------------------|
   |                                |
   |-- WS reconnect --------------->|
   |                                |
   [Sincronizado]                   |
```

### 2.2 Gerenciando Operações Pendentes

```javascript
class PendingOperationsManager {
  constructor(db) {
    this.db = db;
  }

  async add(operation) {
    const tx = this.db.transaction('pendingOperations', 'readwrite');
    await tx.objectStore('pendingOperations').put({
      ...operation,
      pendingSince: Date.now()
    });
    await tx.done;
  }

  async getAll() {
    const tx = this.db.transaction('pendingOperations', 'readonly');
    return tx.objectStore('pendingOperations').getAll();
  }

  async remove(opId) {
    const tx = this.db.transaction('pendingOperations', 'readwrite');
    await tx.objectStore('pendingOperations').delete(opId);
    await tx.done;
  }

  async clear() {
    const tx = this.db.transaction('pendingOperations', 'readwrite');
    await tx.objectStore('pendingOperations').clear();
    await tx.done;
  }

  async syncPending(atlasId, token) {
    const pending = await this.getAll();
    if (pending.length === 0) return;

    const response = await fetch(`/api/v1/atlas/${atlasId}/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ operations: pending })
    });

    if (response.ok) {
      const result = await response.json();
      // Remover operações confirmadas
      for (const ack of result.data.acks) {
        await this.remove(ack.opId);
      }
    }
  }
}
```

### 2.3 Indicadores de Status

```javascript
class ConnectionStatus {
  constructor() {
    this.status = 'offline'; // offline, connecting, online, syncing
    this.pendingCount = 0;
  }

  setStatus(status) {
    this.status = status;
    this.render();
  }

  setPendingCount(count) {
    this.pendingCount = count;
    this.render();
  }

  render() {
    const indicator = document.getElementById('connection-status');

    const statusInfo = {
      offline: { icon: '🔴', text: 'Offline', class: 'status-offline' },
      connecting: { icon: '🟡', text: 'Conectando...', class: 'status-connecting' },
      online: { icon: '🟢', text: 'Online', class: 'status-online' },
      syncing: { icon: '🟡', text: 'Sincronizando...', class: 'status-syncing' }
    };

    const info = statusInfo[this.status];
    let text = `${info.icon} ${info.text}`;

    if (this.pendingCount > 0 && this.status === 'offline') {
      text += ` (${this.pendingCount} alterações pendentes)`;
    }

    indicator.className = info.class;
    indicator.textContent = text;
  }
}
```

---

## Parte 3: Upload de Atlas Offline (Import)

### 3.1 Cenário

1. Usuário abre app sem login (modo offline)
2. Cria atlas localmente (IndexedDB)
3. Desenha mapas, features, cria briefings
4. Decide fazer login
5. Quer "subir" o atlas local para sua conta

### 3.2 Endpoint de Import

`POST /api/v1/atlas/import`

#### Headers

`Authorization: Bearer <accessToken>`

#### Request

```json
{
  "atlas": {
    "name": "Meu Atlas Offline",
    "description": "Descrição opcional",
    "settings": {}
  },
  "maps": [
    {
      "id": "local-map-uuid",
      "name": "Mapa Principal",
      "base_layer": "carta-topografica",
      "center_lat": -15.7,
      "center_long": -47.9,
      "zoom": 12,
      "bearing": 0,
      "pitch": 0,
      "features": [
        {
          "id": "local-feat-uuid",
          "feature_type": "point",
          "geometry": { "type": "Point", "coordinates": [-47.9, -15.7] },
          "properties": { "name": "Marco" },
          "layer_id": null
        }
      ],
      "layers": [],
      "groups": [],
      "groupFeatures": [],
      "cesium3dData": [],
      "streetview360Data": []
    }
  ],
  "briefings": [
    {
      "id": "local-briefing-uuid",
      "name": "Briefing",
      "description": null,
      "settings": {},
      "slides": [
        {
          "id": "local-slide-uuid",
          "title": "Slide 1",
          "content": "...",
          "mode": "2d",
          "map_id": "local-map-uuid",
          "position": {},
          "orientation": {}
        }
      ]
    }
  ]
}
```

#### Response (201)

```json
{
  "data": {
    "id": "server-atlas-uuid",
    "name": "Meu Atlas Offline",
    "description": "Descrição opcional",
    "settings": {},
    "map_order": ["local-map-uuid"],
    "version": 1,
    "current_version": 1,
    "created_at": "...",
    "summary": {
      "mapsImported": 1,
      "featuresImported": 1,
      "layersImported": 0,
      "groupsImported": 0,
      "cesium3dImported": 0,
      "streetview360Imported": 0,
      "briefingsImported": 1,
      "slidesImported": 1
    }
  }
}
```

### 3.3 Características do Import

| Característica | Descrição |
|----------------|-----------|
| **IDs preservados** | UUIDs gerados no IndexedDB são mantidos no servidor |
| **Transação atômica** | Tudo é criado ou nada é criado |
| **Owner** | Usuário autenticado se torna owner do atlas |
| **Ordem de inserção** | Atlas → Maps → Layers → Groups → Features → Cesium3D → StreetView360 → Briefings → Slides |
| **Imagens** | Uploadadas separadamente após o import |

### 3.4 Validação

O servidor valida:
- Todos os IDs devem ser UUIDs válidos
- `feature_type` deve ser um dos 20 tipos válidos
- `mode` de slide deve ser válido (2d, 3d, 360)

Observacao: as referências (layer_id, map_id, parent_id) NAO sao validadas contra os IDs do payload na borda (o Joi apenas verifica o formato UUID, permitindo null). A integridade referencial e garantida pela ordem de insercao (maps -> layers -> groups -> features ...) e pelas FKs do PostgreSQL; uma referencia invalida resulta em erro de FK e rollback da transacao.

### 3.5 Implementação de Upload

```javascript
async function uploadOfflineAtlas(localAtlas, accessToken) {
  // 1. Montar payload de import
  const importPayload = {
    atlas: {
      name: localAtlas.name,
      description: localAtlas.description,
      settings: localAtlas.settings || {}
    },
    maps: localAtlas.maps.map(map => ({
      id: map.id,
      name: map.name,
      base_layer: map.base_layer,
      center_lat: map.center_lat,
      center_long: map.center_long,
      zoom: map.zoom,
      bearing: map.bearing || 0,
      pitch: map.pitch || 0,
      features: (map.features || []).map(f => ({
        id: f.id,
        feature_type: f.feature_type,
        geometry: f.geometry,
        properties: f.properties,
        layer_id: f.layer_id
      })),
      layers: map.layers || [],
      groups: map.groups || [],
      groupFeatures: map.groupFeatures || [],
      cesium3dData: map.cesium3dData || [],
      streetview360Data: map.streetview360Data || []
    })),
    briefings: (localAtlas.briefings || []).map(b => ({
      id: b.id,
      name: b.name,
      description: b.description,
      settings: b.settings || {},
      slides: (b.slides || []).map(s => ({
        id: s.id,
        title: s.title,
        content: s.content,
        mode: s.mode,
        map_id: s.map_id,
        position: s.position || {},
        orientation: s.orientation || {}
      }))
    }))
  };

  // 2. Enviar para servidor
  const response = await fetch('/api/v1/atlas/import', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(importPayload)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Import failed');
  }

  const result = await response.json();

  // 3. Atualizar IndexedDB
  await updateLocalAtlasWithServerInfo(localAtlas.id, {
    serverId: result.data.id,
    mode: 'online',
    lastSyncVersion: result.data.current_version
  });

  return result.data;
}
```

---

## Parte 4: Tratamento de Imagens no Import

Imagens no modo offline ficam armazenadas localmente (IndexedDB ou sistema de arquivos). Elas **não são incluídas** no payload de import, pois são binários. O fluxo correto é:

### 4.1 Estrutura de Imagem no IndexedDB Offline

```javascript
// Store: localImages
{
  id: "local-image-uuid",           // ID local gerado no offline
  atlasId: "local-atlas-uuid",      // ID local do atlas
  blob: Blob,                       // Dados binários da imagem
  filename: "foto-001.jpg",
  mimeType: "image/jpeg",
  size: 245678,
  width: 1920,
  height: 1080,
  createdAt: 1699999999999
}
```

### 4.2 Feature de Imagem no IndexedDB

```javascript
{
  id: "local-feature-uuid",
  map_id: "local-map-uuid",
  feature_type: "image",
  geometry: { "type": "Point", "coordinates": [-47.9, -15.7] },
  properties: {
    imageId: "local-image-uuid",    // Referência ao ID local da imagem
    caption: "Foto do objetivo",
    width: 1920,
    height: 1080
  }
}
```

### 4.3 Endpoint de Bulk Upload de Imagens

O backend disponibiliza um endpoint de **bulk upload** que permite enviar múltiplas imagens em base64 de uma só vez, ideal para import de dados do IndexedDB:

`POST /api/v1/atlas/:atlasId/images/bulk`

#### Headers

`Authorization: Bearer <accessToken>`

#### Request

```json
{
  "images": [
    {
      "localId": "local-image-uuid-1",
      "filename": "foto-001.jpg",
      "mimeType": "image/jpeg",
      "data": "data:image/jpeg;base64,/9j/4AAQ..."
    },
    {
      "localId": "local-image-uuid-2",
      "filename": "foto-002.png",
      "mimeType": "image/png",
      "data": "/9j/4AAQ..."
    }
  ]
}
```

#### Response (201)

```json
{
  "data": {
    "uploaded": [
      {
        "localId": "local-image-uuid-1",
        "serverId": "server-image-uuid-1",
        "filename": "foto-001.jpg",
        "size": 245678
      }
    ],
    "failed": [
      {
        "localId": "local-image-uuid-2",
        "error": "File too large: 12MB (max: 10MB)"
      }
    ],
    "mapping": {
      "local-image-uuid-1": "server-image-uuid-1"
    }
  }
}
```

#### Características

| Característica | Descrição |
|----------------|-----------|
| **Máximo de imagens** | 50 por requisição |
| **Formato de dados** | Base64 puro ou data URL (`data:image/png;base64,...`) |
| **Tipos suportados** | `image/png`, `image/jpeg`, `image/webp` (SVG NAO e suportado - removido por ser vetor de XSS armazenado) |
| **Tamanho máximo** | Configurável via `MAX_IMAGE_SIZE_MB` (default: 10MB) |
| **Falhas parciais** | Imagens que falharem não impedem o upload das demais |
| **Mapeamento** | Retorna `mapping` de `localId → serverId` para atualizar features |

### 4.4 Fluxo Completo de Import com Imagens

```
┌─────────────────────────────────────────────────────────────────┐
│  FLUXO DE IMPORT COM IMAGENS                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. IMPORT DO ATLAS (sem imagens)                               │
│     └── POST /atlas/import                                      │
│     └── Features de imagem mantêm imageId local                 │
│     └── Recebe: { id: "server-atlas-uuid", ... }               │
│                                                                 │
│  2. COLETA DE IMAGENS LOCAIS                                    │
│     └── Buscar todas as imagens do atlas local no IndexedDB     │
│     └── Converter Blob → base64                                 │
│     └── Buscar features do tipo "image"                         │
│                                                                 │
│  3. BULK UPLOAD DE IMAGENS (RECOMENDADO)                        │
│     └── POST /atlas/:serverId/images/bulk                       │
│     └── Enviar até 50 imagens por requisição                    │
│     └── Recebe: { mapping: { localId: serverId }, ... }         │
│     └── Processar uploads em lotes se necessário                │
│                                                                 │
│  3. (ALTERNATIVA) UPLOAD INDIVIDUAL                             │
│     └── Para cada imagem:                                       │
│         └── POST /atlas/:serverId/images                        │
│         └── Recebe: { id: "server-image-uuid" }                │
│         └── Guardar mapeamento: localId → serverId              │
│                                                                 │
│  4. ATUALIZAÇÃO DAS FEATURES                                    │
│     └── Para cada feature de imagem:                            │
│         └── Se imageId mudou (local → server):                  │
│             └── Enviar operação de UPDATE via sync              │
│             └── Atualizar properties.imageId                    │
│                                                                 │
│  5. SINCRONIZAÇÃO COMPLETA                                      │
│     └── Todas as imagens no servidor                            │
│     └── Todas as features com IDs de servidor                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.5 Implementação Completa (usando Bulk Upload)

```javascript
class OfflineImportManager {
  constructor(db, accessToken) {
    this.db = db;
    this.accessToken = accessToken;
    this.imageMapping = new Map(); // localId -> serverId
  }

  /**
   * Import completo: atlas + imagens (usando bulk upload)
   */
  async importAtlasWithImages(localAtlas, onProgress) {
    try {
      // Fase 1: Import do atlas (sem imagens)
      onProgress?.({ phase: 'atlas', progress: 0, message: 'Criando atlas...' });
      const serverAtlas = await this.importAtlas(localAtlas);
      onProgress?.({ phase: 'atlas', progress: 100, message: 'Atlas criado' });

      // Fase 2: Coletar imagens locais
      onProgress?.({ phase: 'images', progress: 0, message: 'Coletando imagens...' });
      const localImages = await this.collectLocalImages(localAtlas.id);
      const imageFeatures = await this.collectImageFeatures(localAtlas);

      if (localImages.length === 0) {
        onProgress?.({ phase: 'images', progress: 100, message: 'Nenhuma imagem' });
      } else {
        // Fase 3: Bulk upload das imagens (em lotes de 50)
        onProgress?.({ phase: 'images', progress: 10, message: 'Preparando imagens...' });

        const batchSize = 50;
        const batches = this.chunkArray(localImages, batchSize);
        let uploadedCount = 0;

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          onProgress?.({
            phase: 'images',
            progress: Math.round((i / batches.length) * 80) + 10,
            message: `Enviando lote ${i + 1}/${batches.length}...`
          });

          const result = await this.bulkUploadImages(serverAtlas.id, batch);

          // Atualizar mapeamento com resultados
          for (const [localId, serverId] of Object.entries(result.mapping)) {
            this.imageMapping.set(localId, serverId);
          }

          uploadedCount += result.uploaded.length;

          // Log de falhas
          if (result.failed.length > 0) {
            console.warn(`Falhas no lote ${i + 1}:`, result.failed);
          }
        }

        onProgress?.({
          phase: 'images',
          progress: 90,
          message: `${uploadedCount} imagens enviadas`
        });

        // Fase 4: Atualizar features
        onProgress?.({ phase: 'features', progress: 0, message: 'Atualizando referências...' });
        await this.updateImageFeatures(serverAtlas.id, imageFeatures);
        onProgress?.({ phase: 'features', progress: 100, message: 'Referências atualizadas' });
      }

      // Fase 5: Finalizar
      onProgress?.({ phase: 'complete', progress: 100, message: 'Concluído!' });

      return {
        atlas: serverAtlas,
        imageMapping: this.imageMapping,
        imagesUploaded: this.imageMapping.size
      };

    } catch (error) {
      onProgress?.({ phase: 'error', message: error.message });
      throw error;
    }
  }

  /**
   * Import apenas do atlas (sem imagens)
   */
  async importAtlas(localAtlas) {
    const payload = this.buildImportPayload(localAtlas);

    const response = await fetch('/api/v1/atlas/import', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Import failed');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Coletar todas as imagens locais do atlas
   */
  async collectLocalImages(localAtlasId) {
    const tx = this.db.transaction('localImages', 'readonly');
    const store = tx.objectStore('localImages');
    const index = store.index('atlasId');
    return index.getAll(localAtlasId);
  }

  /**
   * Coletar features do tipo image
   */
  async collectImageFeatures(localAtlas) {
    const imageFeatures = [];

    for (const map of localAtlas.maps) {
      for (const feature of (map.features || [])) {
        if (feature.feature_type === 'image' && feature.properties?.imageId) {
          imageFeatures.push({
            featureId: feature.id,
            mapId: map.id,
            localImageId: feature.properties.imageId
          });
        }
      }
    }

    return imageFeatures;
  }

  /**
   * Bulk upload de imagens (até 50 por vez)
   */
  async bulkUploadImages(serverAtlasId, localImages) {
    // Converter blobs para base64
    const images = await Promise.all(
      localImages.map(async (img) => ({
        localId: img.id,
        filename: img.filename,
        mimeType: img.mimeType,
        data: await this.blobToBase64(img.blob)
      }))
    );

    const response = await fetch(`/api/v1/atlas/${serverAtlasId}/images/bulk`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ images })
    });

    if (!response.ok) {
      throw new Error('Failed to bulk upload images');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Converter Blob para base64
   */
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Dividir array em chunks
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Atualizar features para usar IDs de servidor
   */
  async updateImageFeatures(serverAtlasId, imageFeatures) {
    const operations = [];

    for (const feature of imageFeatures) {
      const serverImageId = this.imageMapping.get(feature.localImageId);

      if (serverImageId && serverImageId !== feature.localImageId) {
        // Criar operação de update
        operations.push({
          id: crypto.randomUUID(),
          type: 'update',
          target: 'feature',
          targetId: feature.featureId,
          mapId: feature.mapId,
          timestamp: Date.now(),
          clientId: this.getClientId(),
          changes: {
            properties: {
              imageId: serverImageId
            }
          }
        });
      }
    }

    if (operations.length > 0) {
      // Enviar todas as operações de update
      const response = await fetch(`/api/v1/atlas/${serverAtlasId}/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ operations })
      });

      if (!response.ok) {
        console.warn('Failed to update some image references');
      }
    }
  }

  buildImportPayload(localAtlas) {
    return {
      atlas: {
        name: localAtlas.name,
        description: localAtlas.description,
        settings: localAtlas.settings || {}
      },
      maps: localAtlas.maps.map(map => ({
        id: map.id,
        name: map.name,
        base_layer: map.base_layer,
        center_lat: map.center_lat,
        center_long: map.center_long,
        zoom: map.zoom,
        bearing: map.bearing || 0,
        pitch: map.pitch || 0,
        features: (map.features || []).map(f => ({
          id: f.id,
          feature_type: f.feature_type,
          geometry: f.geometry,
          properties: f.properties,  // Mantém imageId local por enquanto
          layer_id: f.layer_id
        })),
        layers: map.layers || [],
        groups: map.groups || [],
        groupFeatures: map.groupFeatures || [],
        cesium3dData: map.cesium3dData || [],
        streetview360Data: map.streetview360Data || []
      })),
      briefings: (localAtlas.briefings || []).map(b => ({
        id: b.id,
        name: b.name,
        description: b.description,
        settings: b.settings || {},
        slides: (b.slides || []).map(s => ({
          id: s.id,
          title: s.title,
          content: s.content,
          mode: s.mode,
          map_id: s.map_id,
          position: s.position || {},
          orientation: s.orientation || {}
        }))
      }))
    };
  }

  getClientId() {
    let clientId = localStorage.getItem('ebgeo_client_id');
    if (!clientId) {
      clientId = crypto.randomUUID();
      localStorage.setItem('ebgeo_client_id', clientId);
    }
    return clientId;
  }
}
```

### 4.6 Uso

```javascript
// Exemplo de uso com feedback de progresso
const importManager = new OfflineImportManager(db, accessToken);

const result = await importManager.importAtlasWithImages(localAtlas, (progress) => {
  console.log(`[${progress.phase}] ${progress.progress}% - ${progress.message}`);

  // Atualizar UI
  updateProgressBar(progress.progress);
  updateProgressMessage(progress.message);
});

console.log(`Atlas importado: ${result.atlas.id}`);
console.log(`Imagens enviadas: ${result.imagesUploaded}`);
```

### 4.7 Considerações Importantes

| Aspecto | Tratamento |
|---------|------------|
| **IDs de imagem** | IDs locais são substituídos por IDs do servidor |
| **Falha no upload** | Se uma imagem falhar, o atlas ainda é criado; feature fica com ID inválido |
| **Bulk upload** | Endpoint recomendado - envia até 50 imagens por requisição |
| **Lotes grandes** | Para >50 imagens, dividir em lotes e processar sequencialmente |
| **Retry** | Implementar retry automático para uploads que falharam |
| **Cache local** | Após import, manter cache local para não baixar novamente |
| **Formato base64** | Aceita base64 puro ou data URL (`data:image/png;base64,...`) |

### 4.8 Tratamento de Erros de Imagem

```javascript
async function uploadImageWithRetry(atlasId, image, maxRetries = 3) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await uploadImage(atlasId, image);
    } catch (error) {
      lastError = error;
      console.warn(`Upload attempt ${attempt + 1} failed for ${image.filename}`);

      // Esperar antes de tentar novamente
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }

  // Registrar falha mas não interromper o processo
  console.error(`Failed to upload ${image.filename} after ${maxRetries} attempts`);
  return null; // Retorna null para indicar falha
}
```

---

## Parte 5: Transição Offline → Online

### 5.1 Estado do Atlas no IndexedDB

```javascript
// ANTES do import (atlas offline)
{
  id: "local-uuid",
  name: "Meu Atlas",
  mode: "offline",
  serverId: null,
  lastSyncVersion: null,
  pendingOperations: []
}

// DEPOIS do import (atlas online)
{
  id: "local-uuid",
  name: "Meu Atlas",
  mode: "online",
  serverId: "server-uuid",
  lastSyncVersion: 1,
  pendingOperations: []
}
```

### 5.2 O Que Muda na Aplicação

| Aspecto | Modo Offline | Modo Online |
|---------|--------------|-------------|
| Salvar alterações | Só IndexedDB | IndexedDB + servidor |
| Colaboração | ❌ Indisponível | ✅ WebSocket ativo |
| Cursores de outros | ❌ Não existe | ✅ Visíveis |
| Compartilhamento | ❌ Não existe | ✅ Disponível |
| Indicador visual | "Offline" | "Online" / "Sincronizado" |
| Conflitos | ❌ Não existe | ✅ Resolvidos via CRDT |

### 5.3 Fluxo de UI

```
┌─────────────────────────────────────────────────────────────────┐
│  1. USUÁRIO LOGADO VÊ LISTA DE ATLAS                            │
│     ┌───────────────────────────────────────────────────────┐   │
│     │  📁 Meus Atlas                                        │   │
│     │  ├── 🌐 Operação Alfa        (online, sincronizado)   │   │
│     │  ├── 🌐 Projeto Beta         (online, sincronizado)   │   │
│     │  └── 💾 Atlas Local          (offline) [Subir ↑]      │   │
│     └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. MODAL DE CONFIRMAÇÃO                                        │
│     ┌───────────────────────────────────────────────────────┐   │
│     │  Subir "Atlas Local" para o servidor?                 │   │
│     │                                                       │   │
│     │  Após subir:                                          │   │
│     │  • Suas alterações serão salvas no servidor           │   │
│     │  • Você poderá compartilhar com outros usuários       │   │
│     │  • Colaboração em tempo real será ativada             │   │
│     │                                                       │   │
│     │  Resumo: 3 mapas, 47 feições, 1 briefing              │   │
│     │                                                       │   │
│     │            [Cancelar]  [Subir para Servidor]          │   │
│     └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. PROGRESSO DO UPLOAD                                         │
│     ┌───────────────────────────────────────────────────────┐   │
│     │  Subindo atlas...                                     │   │
│     │                                                       │   │
│     │  ████████████░░░░░░░░  60%                            │   │
│     │                                                       │   │
│     │  ✓ Atlas criado                                       │   │
│     │  ✓ Mapas enviados (3/3)                               │   │
│     │  ⏳ Enviando imagens (2/5)                             │   │
│     │  ○ Conectando colaboração                             │   │
│     └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. SUCESSO                                                     │
│     ┌───────────────────────────────────────────────────────┐   │
│     │  ✅ Atlas enviado com sucesso!                         │   │
│     │                                                       │   │
│     │  "Atlas Local" agora está sincronizado.               │   │
│     │  Colaboração em tempo real ativada.                   │   │
│     │                                                       │   │
│     │                              [OK, entendi]            │   │
│     └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 Indicadores Visuais

**Na lista de atlas:**
- 🌐 = atlas online/sincronizado
- 💾 = atlas offline/local
- ☁️↑ = atlas offline com opção de upload

**Dentro do atlas:**
```
┌─────────────────────────────────────────────────────────────────┐
│  📍 Atlas Local                              🟢 Online │ 👥 3   │
│  ─────────────────────────────────────────────────────────────  │
│  [Mapas] [Briefings] [Compartilhar]                     [...]   │
└─────────────────────────────────────────────────────────────────┘

- 🟢 Online = conectado, sync ativo
- 🟡 Sincronizando = enviando/recebendo
- 🔴 Offline = sem conexão, alterações pendentes
- 👥 3 = 3 usuários online
```

---

## Parte 6: Comportamento Pós-Import

### 6.1 Ativação do Modo Online

```javascript
class AtlasManager {
  async onAtlasImported(localAtlasId, serverResponse) {
    // 1. Atualizar estado local
    await this.db.updateAtlas(localAtlasId, {
      mode: 'online',
      serverId: serverResponse.id,
      lastSyncVersion: serverResponse.current_version
    });

    // 2. Conectar WebSocket
    this.ws = new CollabWebSocket(serverResponse.id, this.accessToken);
    await this.ws.connect();

    // 3. Ativar dispatcher de operações
    this.operationDispatcher.enable();
    this.operationDispatcher.setAtlasId(serverResponse.id);

    // 4. Atualizar UI
    this.ui.showOnlineIndicator();
    this.ui.showCollaborators(this.ws.usersOnline);
    this.ui.enableShareButton();
  }

  async onUserEdit(operation) {
    // Salvar localmente (sempre)
    await this.db.saveOperation(operation);

    // Se online, enviar ao servidor
    if (this.ws?.isConnected) {
      this.ws.sendOperation(operation);
    } else {
      // Acumular para envio posterior
      await this.pendingOps.add(operation);
      this.ui.showPendingCount(await this.pendingOps.count());
    }
  }
}
```

### 6.2 Perda de Conexão Temporária

```
┌─────────────────────────────────────────────────────────────────┐
│  CONEXÃO PERDIDA                                                │
│                                                                 │
│  1. Mostrar indicador: 🔴 Offline (3 alterações pendentes)      │
│  2. Continuar salvando no IndexedDB                             │
│  3. Acumular operações pendentes                                │
│  4. Tentar reconectar automaticamente                           │
│  5. Ao reconectar:                                              │
│     - Enviar operações pendentes (POST /sync)                   │
│     - Buscar operações perdidas (GET /sync/:lastVersion)        │
│     - Reconectar WebSocket                                      │
│     - Mostrar: 🟢 Online (sincronizado)                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Checklist de Implementação

### Modo Offline
- [x] Detecção de backend indisponível — implementada como **tela de bloqueio** ("EBGeo
      indisponível") no boot fail-fast, não como degradação para modo offline
- [ ] ~~Funcionamento completo sem backend~~ — **fora de escopo**: o servidor é a fonte única de
      config/catálogo e é exigido no boot
- [ ] Indicador visual de modo offline

### Reconexão
- [ ] Detecção de perda de conexão
- [ ] Armazenamento de operações pendentes
- [ ] Pull de operações perdidas ao reconectar
- [ ] Push de operações pendentes ao reconectar
- [ ] Reconexão automática do WebSocket
- [ ] Indicadores de status (offline/syncing/online)

### Upload de Atlas Offline
- [ ] Detectar atlas locais não sincronizados após login
- [ ] Indicador visual diferenciando offline vs online
- [ ] Botão "Subir para servidor"
- [ ] Modal de confirmação com resumo (mapas, features, imagens)
- [ ] Função para montar payload no formato correto
- [ ] Chamada ao endpoint POST /atlas/import
- [ ] Feedback visual durante upload (barra de progresso)

### Tratamento de Imagens no Import
- [ ] Armazenar imagens locais no IndexedDB (blob + metadata)
- [ ] Coletar imagens do atlas local após import
- [ ] Converter Blob para base64 para envio
- [x] Usar endpoint bulk upload (POST /atlas/:id/images/bulk) - **Implementado no backend**
- [ ] Dividir em lotes de até 50 imagens se necessário
- [ ] Mapeamento de IDs: local → servidor (resposta do bulk upload)
- [ ] Enviar operações de UPDATE para features de imagem
- [ ] Atualizar properties.imageId com ID do servidor
- [ ] Tratamento de falha no upload (retry, log de erros)
- [ ] Atualização do estado no IndexedDB

### Transição Offline → Online
- [ ] Atualizar estado (mode, serverId, lastSyncVersion)
- [ ] Conectar WebSocket imediatamente
- [ ] Ativar dispatcher de operações
- [ ] Atualizar UI: indicador online, colaboradores, botão compartilhar
- [ ] Notificação de sucesso

---

## Próximo Documento

[09 - Administração](./09-admin.md) - Gerenciamento de usuários e resources
