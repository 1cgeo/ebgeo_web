# 06 - Presença e Imagens

Este documento cobre o sistema de presença (cursores e seleção) e upload/download de imagens.

---

## Parte 1: Presença

### 1.1 Movimento de Cursor

O cursor mostra onde cada usuário está focado no mapa.

```
Cliente A                        Backend                         Cliente B
   |                                |                                |
   |-- WS: cursor ----------------->|                                |
   |   { position: {lat, lng},      |                                |
   |     mapId: 'uuid' }            |                                |
   |                                |-- WS: cursor ----------------->|
   |                                |   { userId, userName,          |
   |                                |     position, mapId }          |
   |                                |                                |
   |                                |                [Exibe cursor de A]
```

#### Enviando Cursor

```javascript
// Throttle para não enviar muitas mensagens
const sendCursor = throttle((lat, lng, mapId) => {
  ws.send({
    type: 'cursor',
    position: { lat, lng },
    mapId
  });
}, 50); // Máximo 20 vezes por segundo

// No evento de movimento do mouse no mapa
map.on('mousemove', (e) => {
  sendCursor(e.latlng.lat, e.latlng.lng, currentMapId);
});
```

#### Recebendo Cursor

```javascript
ws.onCursorUpdate = (userId, position, mapId) => {
  // Só mostrar se for o mapa atual
  if (mapId !== currentMapId) {
    cursorManager.hideCursor(userId);
    return;
  }

  const user = onlineUsers.get(userId);
  if (user) {
    cursorManager.updateCursor(userId, user.nome, position);
  }
};
```

### 1.2 Seleção de Features

Mostra quais features outros usuários selecionaram.

```
Cliente A                        Backend                         Cliente B
   |                                |                                |
   |-- WS: selection -------------->|                                |
   |   { featureIds: ['uuid'...] }  |                                |
   |                                |-- WS: selection -------------->|
   |                                |   { userId, featureIds }       |
   |                                |                                |
   |                                |                [Destaca features
   |                                |                 selecionadas por A]
```

#### Enviando Seleção

```javascript
function onSelectionChange(selectedFeatureIds) {
  ws.send({
    type: 'selection',
    featureIds: selectedFeatureIds,
    mapId: currentMapId
  });
}
```

#### Recebendo Seleção

```javascript
ws.onSelectionUpdate = (userId, featureIds, mapId) => {
  if (mapId !== currentMapId) return;

  // Remover destaque anterior deste usuário
  selectionManager.clearUserSelection(userId);

  // Aplicar novo destaque
  const user = onlineUsers.get(userId);
  const color = getUserColor(userId);

  for (const featureId of featureIds) {
    selectionManager.highlightFeature(featureId, {
      userId,
      userName: user?.nome,
      color
    });
  }
};
```

### 1.3 Gerenciando Cursores

```javascript
class CursorManager {
  constructor(map) {
    this.map = map;
    this.cursors = new Map();
    this.hideTimeouts = new Map();
  }

  updateCursor(userId, userName, position) {
    // Cancelar timeout de esconder
    if (this.hideTimeouts.has(userId)) {
      clearTimeout(this.hideTimeouts.get(userId));
    }

    let cursor = this.cursors.get(userId);
    if (!cursor) {
      cursor = this.createCursor(userId, userName);
      this.cursors.set(userId, cursor);
    }

    // Atualizar posição com animação suave
    cursor.setLatLng([position.lat, position.lng]);

    // Auto-esconder após 5 segundos sem movimento
    const timeout = setTimeout(() => {
      this.hideCursor(userId);
    }, 5000);
    this.hideTimeouts.set(userId, timeout);
  }

  hideCursor(userId) {
    const cursor = this.cursors.get(userId);
    if (cursor) {
      cursor.setOpacity(0);
    }
  }

  removeCursor(userId) {
    const cursor = this.cursors.get(userId);
    if (cursor) {
      this.map.removeLayer(cursor);
      this.cursors.delete(userId);
    }

    if (this.hideTimeouts.has(userId)) {
      clearTimeout(this.hideTimeouts.get(userId));
      this.hideTimeouts.delete(userId);
    }
  }

  createCursor(userId, userName) {
    const color = getUserColor(userId);

    const icon = L.divIcon({
      className: 'remote-cursor',
      html: `
        <div class="cursor-container" style="--cursor-color: ${color}">
          <svg class="cursor-icon" viewBox="0 0 24 24">
            <path d="M5 2l14 14-6 2-2 6z" fill="${color}"/>
          </svg>
          <span class="cursor-label">${userName}</span>
        </div>
      `,
      iconSize: [100, 30],
      iconAnchor: [0, 0]
    });

    return L.marker([0, 0], { icon, opacity: 1 }).addTo(this.map);
  }
}
```

### 1.4 CSS para Cursores

```css
.remote-cursor {
  pointer-events: none;
  z-index: 1000;
}

.cursor-container {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.cursor-icon {
  width: 16px;
  height: 16px;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
}

.cursor-label {
  background: var(--cursor-color);
  color: white;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
```

---

## Parte 2: Upload de Imagens

### 2.1 Visão Geral

Imagens são gerenciadas via REST separadamente das operações CRDT:
1. Upload da imagem → recebe `imageId`
2. Criar feature com referência ao `imageId`

### 2.2 Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/v1/atlas/:id/images` | Listar imagens |
| POST | `/api/v1/atlas/:id/images` | Upload de imagem |
| POST | `/api/v1/atlas/:id/images/bulk` | Bulk upload (base64, offline import) |
| GET | `/api/v1/atlas/:id/images/:imageId` | Download de imagem |
| DELETE | `/api/v1/atlas/:id/images/:imageId` | Deletar imagem |

### 2.3 Upload de Imagem

#### Request

```javascript
const formData = new FormData();
formData.append('image', file); // File ou Blob

const response = await fetch(`/api/v1/atlas/${atlasId}/images`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
    // NÃO definir Content-Type - o browser define automaticamente
  },
  body: formData
});
```

#### Response (201)

```json
{
  "data": {
    "id": "image-uuid",
    "atlas_id": "atlas-uuid",
    "filename": "IMG_20231115_142530.jpg",
    "mime_type": "image/jpeg",
    "size_bytes": 245678,
    "storage_path": "./data/images/atlas-uuid/unique-id.jpg",
    "uploaded_by": "user-uuid",
    "created_at": "2023-11-15T14:25:30.000Z"
  }
}
```

> **Nota:** O campo `filename` armazena o nome original do arquivo enviado. Não há campos `width`/`height` — esses valores devem ser obtidos pelo frontend ao renderizar a imagem.

### 2.4 Limites e Tipos Aceitos

- **Tamanho máximo:** 10 MB
- **Tipos aceitos:** PNG, JPEG, SVG, WebP

### 2.5 Fluxo Completo: Adicionar Imagem ao Mapa

```
Cliente A                        Backend                         Cliente B
   |                                |                                |
   |-- POST /atlas/:id/images ----->|  (1) Upload binário
   |   multipart/form-data          |
   |   { file: <binary> }           |
   |                                |
   |<-- 201 -----------------------|
   |   { data: { id: 'img-uuid',    |
   |     filename, size_bytes } }   |
   |                                |
   |-- WS: operation -------------->|  (2) Cria feature com referência
   |   { type: 'create',            |
   |     target: 'feature',         |
   |     data: {                    |
   |       feature_type: 'image',   |
   |       properties: {            |
   |         imageId: 'img-uuid'    |
   |       }                        |
   |     }                          |
   |   }                            |
   |                                |-- WS: operation -------------->|
   |                                |                                |
   |                                |                [Cliente B recebe
   |                                |                 operação, vê imageId]
   |                                |                                |
   |                                |<-- GET /atlas/:id/images/img --|
   |                                |                                |
   |                                |-- 200 (binary) --------------->|
   |                                |                                |
   |                                |                [Exibe imagem]
```

### 2.6 Implementação de Upload

```javascript
async function uploadImage(atlasId, file) {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`/api/v1/atlas/${atlasId}/images`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    },
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Upload failed');
  }

  return response.json();
}

// Uso: Criar feature de imagem
async function addImageToMap(atlasId, mapId, file, position) {
  // 1. Upload da imagem
  const uploadResult = await uploadImage(atlasId, file);
  const imageId = uploadResult.data.id;

  // 2. Criar feature com referência
  const operation = operationFactory.create('feature', crypto.randomUUID(), {
    feature_type: 'image',
    geometry: {
      type: 'Point',
      coordinates: [position.lng, position.lat]
    },
    properties: {
      imageId: imageId,
      caption: file.name
    }
  }, mapId);

  // 3. Enviar operação
  dispatcher.dispatch(operation);

  return { imageId, featureId: operation.targetId };
}
```

### 2.7 Download e Exibição

```javascript
// URL para download
function getImageUrl(atlasId, imageId) {
  return `/api/v1/atlas/${atlasId}/images/${imageId}`;
}

// Carregar imagem
async function loadImage(atlasId, imageId) {
  const response = await fetch(getImageUrl(atlasId, imageId), {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to load image');
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

// Cache de imagens
class ImageCache {
  constructor() {
    this.cache = new Map();
  }

  async get(atlasId, imageId) {
    const key = `${atlasId}:${imageId}`;

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const url = await loadImage(atlasId, imageId);
    this.cache.set(key, url);
    return url;
  }

  clear() {
    for (const url of this.cache.values()) {
      URL.revokeObjectURL(url);
    }
    this.cache.clear();
  }
}
```

### 2.8 Listar Imagens

#### Request

```
GET /api/v1/atlas/:atlasId/images
```

#### Response

```json
{
  "data": [
    {
      "id": "image-uuid-1",
      "atlas_id": "atlas-uuid",
      "filename": "IMG_001.jpg",
      "mime_type": "image/jpeg",
      "size_bytes": 245678,
      "storage_path": "./data/images/atlas-uuid/unique-id-1.jpg",
      "uploaded_by": "user-uuid",
      "created_at": "2023-11-15T14:25:30.000Z"
    },
    {
      "id": "image-uuid-2",
      "atlas_id": "atlas-uuid",
      "filename": "screenshot.png",
      "mime_type": "image/png",
      "size_bytes": 123456,
      "storage_path": "./data/images/atlas-uuid/unique-id-2.png",
      "uploaded_by": "user-uuid",
      "created_at": "2023-11-16T10:00:00.000Z"
    }
  ]
}
```

### 2.9 Bulk Upload (Base64)

Usado para importação offline/IndexedDB. Aceita até 50 imagens por requisição.

#### Request

```
POST /api/v1/atlas/:atlasId/images/bulk
```

```json
{
  "images": [
    {
      "localId": "local-uuid-1",
      "filename": "foto1.png",
      "mimeType": "image/png",
      "data": "iVBORw0KGgo..."
    },
    {
      "localId": "local-uuid-2",
      "filename": "foto2.jpeg",
      "mimeType": "image/jpeg",
      "data": "data:image/jpeg;base64,/9j/4AAQ..."
    }
  ]
}
```

> O campo `data` aceita tanto base64 puro quanto formato data URL (`data:image/...;base64,...`).

#### Response (201)

```json
{
  "data": {
    "uploaded": [
      { "localId": "local-uuid-1", "serverId": "server-uuid-1", "filename": "foto1.png", "size": 12345 },
      { "localId": "local-uuid-2", "serverId": "server-uuid-2", "filename": "foto2.jpeg", "size": 67890 }
    ],
    "failed": [],
    "mapping": {
      "local-uuid-1": "server-uuid-1",
      "local-uuid-2": "server-uuid-2"
    }
  }
}
```

> **Falhas parciais:** Imagens válidas são salvas mesmo se outras falharem. Use `mapping` para atualizar referências de `imageId` nas features.

### 2.10 Deletar Imagem

#### Request

```
DELETE /api/v1/atlas/:atlasId/images/:imageId
```

#### Response

204 No Content

> **Nota:** Ao deletar uma imagem, as features que a referenciam ficam com `imageId` apontando para uma imagem inexistente. O frontend deve tratar isso exibindo um placeholder.

---

## Parte 3: Referência de Feature de Imagem

### Estrutura da Feature

```json
{
  "id": "feature-uuid",
  "map_id": "map-uuid",
  "feature_type": "image",
  "geometry": {
    "type": "Point",
    "coordinates": [-47.9, -15.7]
  },
  "properties": {
    "imageId": "image-uuid",
    "caption": "Vista do objetivo",
    "rotation": 0,
    "opacity": 1
  }
}
```

### Renderizando Feature de Imagem

```javascript
async function renderImageFeature(feature, imageCache) {
  const { imageId, caption, rotation, opacity } = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;

  try {
    const imageUrl = await imageCache.get(atlasId, imageId);

    // Criar overlay de imagem
    // Dimensões da imagem devem ser obtidas após carregar o blob
    const img = new Image();
    img.src = imageUrl;
    await new Promise(resolve => { img.onload = resolve; });
    const bounds = calculateImageBounds(lat, lng, img.naturalWidth, img.naturalHeight);
    const overlay = L.imageOverlay(imageUrl, bounds, {
      opacity: opacity ?? 1,
      interactive: true
    });

    if (rotation) {
      // Aplicar rotação via CSS transform
      overlay.getElement()?.style.transform = `rotate(${rotation}deg)`;
    }

    return overlay;
  } catch (error) {
    console.error('Erro ao carregar imagem:', error);
    // Retornar placeholder
    return createPlaceholderMarker(lat, lng, caption);
  }
}

function calculateImageBounds(lat, lng, width, height, scale = 0.0001) {
  // Calcular bounds aproximados baseado nas dimensões
  const aspect = width / height;
  const latOffset = scale;
  const lngOffset = scale * aspect;

  return [
    [lat - latOffset, lng - lngOffset],
    [lat + latOffset, lng + lngOffset]
  ];
}
```

---

## Checklist de Implementação

### Presença
- [ ] Envio de posição do cursor (throttled)
- [ ] Recebimento de cursores de outros usuários
- [ ] Exibição de cursores no mapa
- [ ] Auto-hide de cursores inativos
- [ ] Remoção de cursor quando usuário sai
- [ ] Envio de seleção de features
- [ ] Recebimento de seleção de outros usuários
- [ ] Destaque visual de features selecionadas por outros

### Imagens
- [ ] Upload de imagem via FormData
- [ ] Criação de feature referenciando imagem
- [ ] Download e cache de imagens
- [ ] Renderização de features de imagem
- [ ] Listagem de imagens do atlas
- [ ] Deleção de imagem
- [ ] Tratamento de imagens inexistentes (placeholder)

---

## Próximo Documento

[07 - Compartilhamento](./07-compartilhamento.md) - Links públicos e compartilhamento com usuários
