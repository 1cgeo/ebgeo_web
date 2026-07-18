# 02 - Atlas Básico

Este documento cobre o CRUD básico de Atlas e listagem.

---

## Visão Geral

O Atlas é a entidade principal do sistema. Cada atlas pode conter:
- Múltiplos mapas
- Briefings e slides
- Features, layers e groups
- Configurações

---

## 1. Listagem de Atlas

### Endpoint

`GET /api/v1/atlas`

### Headers

`Authorization: Bearer <accessToken>`

### Response (200)

```json
{
  "data": [
    {
      "id": "atlas-uuid-1",
      "name": "Operação Alfa",
      "description": "Atlas da operação",
      "is_public": false,
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z",
      "user_permission": "owner"
    },
    {
      "id": "atlas-uuid-2",
      "name": "Projeto Compartilhado",
      "description": "Atlas de outro usuário",
      "is_public": false,
      "created_at": "2024-01-10T08:00:00.000Z",
      "updated_at": "2024-01-14T16:45:00.000Z",
      "user_permission": "write"
    }
  ]
}
```

A lista inclui:
- Atlas próprios (`user_permission: 'owner'`)
- Atlas compartilhados (`user_permission: 'read'`, `'comment'`, `'write'` ou `'manage'`)

### Fluxo

```
Cliente                          Backend
   |                                |
   |-- GET /atlas ----------------->|
   |   Authorization: Bearer token  |
   |                                |
   |<-- 200 -----------------------|
   |   { data: [                    |
   |     { id, name, description,   |
   |       is_public, created_at,   |
   |       user_permission },       |
   |     ...                        |
   |   ]}                           |
   |                                |
   [Cliente exibe lista de atlas]   |
```

---

## 2. Criar Atlas

### Endpoint

`POST /api/v1/atlas`

### Headers

`Authorization: Bearer <accessToken>`

### Request

```json
{
  "name": "Operação Beta",
  "description": "Descrição opcional"
}
```

### Response (201)

```json
{
  "data": {
    "id": "novo-atlas-uuid",
    "name": "Operação Beta",
    "description": "Descrição opcional",
    "owner_id": "user-uuid",
    "is_public": false,
    "public_link": null,
    "settings": {
      "features": {
        "map_3d": true,
        "panoramic_images": true,
        "terrain_3d": true
      },
      "basemaps": [],
      "default_basemap": null,
      "bounds_2d": null,
      "min_zoom": null,
      "max_zoom": null,
      "available_analysis_layers": [],
      "available_data_layers": [],
      "available_3d_models": [],
      "available_360_views": []
    },
    "map_order": [],
    "version": 1,
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## 3. Obter Atlas

### Endpoint

`GET /api/v1/atlas/:atlasId`

### Headers

`Authorization: Bearer <accessToken>`

### Permissão Mínima

`read`

### Response (200)

```json
{
  "data": {
    "id": "atlas-uuid",
    "name": "Operação Alfa",
    "description": "Atlas da operação",
    "owner_id": "user-uuid",
    "is_public": false,
    "public_link": null,
    "settings": {
      "features": {
        "map_3d": true,
        "panoramic_images": true,
        "terrain_3d": true
      },
      "basemaps": ["carta-topografica", "satelite"],
      "default_basemap": "carta-topografica"
    },
    "map_order": ["map-uuid-1", "map-uuid-2"],
    "version": 42,
    "maps": [
      { "id": "map-uuid-1", "name": "Mapa 1", "created_at": "2024-01-15T10:30:00.000Z", "updated_at": "2024-01-15T10:30:00.000Z" }
    ],
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T14:20:00.000Z"
  }
}
```

> **Nota:** O GET de um atlas sempre inclui um array `maps` com o resumo (`id`, `name`, `created_at`, `updated_at`) dos mapas não deletados.

---

## 4. Atualizar Atlas

### Endpoint

`PUT /api/v1/atlas/:atlasId`

### Headers

`Authorization: Bearer <accessToken>`

### Permissão Mínima

`write`

### Request

```json
{
  "name": "Operação Alfa - Atualizado",
  "description": "Nova descrição",
  "map_order": ["map-uuid-2", "map-uuid-1"]
}
```

> Todos os campos são opcionais. Envie apenas os que deseja alterar. O campo `map_order` permite reordenar os mapas.

### Response (200)

```json
{
  "data": {
    "id": "atlas-uuid",
    "name": "Operação Alfa - Atualizado",
    "description": "Nova descrição",
    "owner_id": "user-uuid",
    "is_public": false,
    "public_link": null,
    "settings": { "..." },
    "map_order": ["map-uuid-1", "map-uuid-2"],
    "version": 43,
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T16:00:00.000Z"
  }
}
```

> **Nota:** Retorna o objeto atlas completo, não apenas os campos atualizados.

---

## 5. Deletar Atlas

### Endpoint

`DELETE /api/v1/atlas/:atlasId`

### Headers

`Authorization: Bearer <accessToken>`

### Permissão Mínima

`owner`

### Response

204 No Content

> **Nota:** Apenas o owner pode deletar um atlas. A deleção é um soft-delete (marca `deleted_at` no atlas e incrementa `version`); o atlas deixa de aparecer nas listagens e o WebSocket é encerrado (`atlas_deleted`). Os mapas, features e briefings associados permanecem no banco (não há hard-delete em cascata).

---

## 6. Configurações do Atlas

### Obter Configurações

`GET /api/v1/atlas/:atlasId/settings`

**Permissão:** `read`

```json
{
  "data": {
    "features": {
      "map_3d": true,
      "panoramic_images": true,
      "terrain_3d": true
    },
    "basemaps": ["carta-topografica", "satelite", "osm"],
    "default_basemap": "carta-topografica",
    "bounds_2d": [[-74.0, -33.7], [-28.8, 5.3]],
    "min_zoom": 4,
    "max_zoom": 18,
    "available_analysis_layers": ["declividade", "elevacao"],
    "available_data_layers": ["hidrografia", "rodovias"],
    "available_3d_models": ["model-uuid-1", "model-uuid-2"],
    "available_360_views": ["photo-uuid-1", "photo-uuid-2"]
  }
}
```

### Atualizar Configurações

`PATCH /api/v1/atlas/:atlasId/settings`

**Permissão:** `manage`

```json
{
  "features": {
    "map_3d": false
  },
  "max_zoom": 15
}
```

> **Nota:** PATCH permite atualização parcial - apenas os campos enviados serão alterados.

### Campos de Settings

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `features.map_3d` | boolean | Habilita visualização 3D (Cesium) |
| `features.panoramic_images` | boolean | Habilita imagens 360° |
| `features.terrain_3d` | boolean | Habilita terreno 3D |
| `basemaps` | string[] | Mapas base disponíveis |
| `default_basemap` | string | Mapa base padrão |
| `bounds_2d` | [[lng,lat],[lng,lat]] | Limites de navegação 2D |
| `min_zoom` / `max_zoom` | number | Limites de zoom |
| `available_analysis_layers` | string[] | Camadas de análise disponíveis |
| `available_data_layers` | string[] | Camadas de dados disponíveis |
| `available_3d_models` | string[] | Modelos 3D disponíveis |
| `available_360_views` | string[] | Fotos 360° disponíveis |

---

## 7. Clonar Atlas

### Endpoint

`POST /api/v1/atlas/:atlasId/clone`

### Headers

`Authorization: Bearer <accessToken>`

### Permissão Mínima

`read`

### Request (opcional)

```json
{
  "name": "Cópia de Operação Alfa"
}
```

### Response (201)

```json
{
  "data": {
    "id": "novo-atlas-uuid",
    "name": "Cópia de Operação Alfa",
    "description": "Descrição original",
    "owner_id": "user-uuid",
    "is_public": false,
    "created_at": "2024-01-15T16:30:00.000Z"
  }
}
```

O clone inclui:
- Todos os mapas (com viewport, notas, camadas do catálogo)
- Todas as features, layers, groups
- Todos os dados Cesium 3D e StreetView 360
- Todos os briefings e slides (com remapeamento de map_id)
- Configurações do atlas

O clone **não** inclui:
- Compartilhamentos (o usuário se torna owner)
- Link público
- Histórico de operações CRDT
- Imagens (referências são mantidas mas os arquivos não são duplicados)

---

## 8. Sistema de Permissões

### Hierarquia

```
owner > manage > write > comment > read
```

### Resolução de Permissão

```
1. userId === atlas.owner_id     → 'owner'
2. atlas_shares.permission       → 'read', 'comment', 'write' ou 'manage'
3. atlas.is_public              → 'read'
4. Nenhum (atlas existe, mas sem acesso) → 403 Forbidden
   (atlas inexistente ou deletado       → 404 Not Found)
```

### Matriz de Permissões

| Ação | read | comment | write | manage | owner |
|------|------|---------|-------|--------|-------|
| Visualizar atlas | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pull de sync | ✅ | ✅ | ✅ | ✅ | ✅ |
| Conectar WebSocket | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ver cursores/presença | ✅ | ✅ | ✅ | ✅ | ✅ |
| Broadcast da própria seleção | ❌ | ❌ | ✅ | ✅ | ✅ |
| Escrever comentários espaciais | ❌ | ✅ | ✅ | ✅ | ✅ |
| Push de operações (não-comentário) | ❌ | ❌ | ✅ | ✅ | ✅ |
| Upload de imagens | ❌ | ❌ | ✅ | ✅ | ✅ |
| Atualizar atlas | ❌ | ❌ | ✅ | ✅ | ✅ |
| Clonar atlas | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gerenciar compartilhamento | ❌ | ❌ | ❌ | ✅ | ✅ |
| Alterar configurações do atlas | ❌ | ❌ | ❌ | ✅ | ✅ |
| Travar/destravar mapa · deletar mapa | ❌ | ❌ | ❌ | ❌ | ✅ |
| Transferir posse · deletar atlas | ❌ | ❌ | ❌ | ❌ | ✅ |

> `owner` é sintetizado de `atlas.owner_id` e nunca aparece em `atlas_shares` (CHECK:
> `read|comment|write|manage`). `manage` está **acima** de `write` — um gate escrito como
> `permission === 'write' || permission === 'owner'` exclui o co-Gestor silenciosamente.

### Verificando Permissão no Frontend

```javascript
// A permissão é retornada na conexão WebSocket
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'connected') {
    const canEdit = ['write', 'owner'].includes(msg.permission);
    const isOwner = msg.permission === 'owner';

    // Atualizar UI baseado nas permissões
    setEditingEnabled(canEdit);
    setSettingsVisible(isOwner);
    setShareButtonVisible(isOwner);
  }
};
```

---

## 9. Tratamento de Erros

### Formato de Erro

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Atlas not found"
  }
}
```

### Códigos Comuns

| Código | HTTP | Descrição |
|--------|------|-----------|
| `VALIDATION_ERROR` | 422 | Dados inválidos |
| `UNAUTHORIZED` | 401 | Token ausente ou inválido |
| `FORBIDDEN` | 403 | Sem permissão |
| `NOT_FOUND` | 404 | Atlas não encontrado |
| `INTERNAL_ERROR` | 500 | Erro interno do servidor |

### Tratamento no Frontend

```javascript
async function handleApiResponse(response) {
  if (!response.ok) {
    const errorData = await response.json();
    const error = errorData.error;

    switch (response.status) {
      case 401:
        // Token expirado - tentar refresh
        const refreshed = await refreshTokens();
        if (!refreshed) redirectToLogin();
        break;

      case 403:
        showNotification('Você não tem permissão para esta ação', 'error');
        break;

      case 404:
        showNotification('Atlas não encontrado', 'error');
        break;

      default:
        showNotification('Erro inesperado. Tente novamente.', 'error');
    }

    throw new ApiError(error.code, error.message);
  }

  return response.json();
}
```

---

## Diagrama de Entidades

```
Atlas (REST: CRUD, settings, clone)
  │
  ├── Map (via sync)
  │     ├── Feature (via sync)
  │     ├── Group (via sync)
  │     │     └── group_feature (via sync)
  │     ├── Layer (via sync)
  │     ├── Cesium3D Data (via sync)
  │     └── StreetView360 Data (via sync)
  │
  ├── Briefing (via sync)
  │     └── Slide (via sync)
  │
  └── Image (REST: upload/download, referência via sync)
```

---

## Checklist de Implementação

- [ ] Listagem de atlas do usuário
- [ ] Criação de novo atlas
- [ ] Visualização de detalhes do atlas
- [ ] Atualização de nome/descrição
- [ ] Deleção de atlas (somente owner)
- [ ] Visualização de configurações
- [ ] Edição de configurações (somente owner)
- [ ] Clone de atlas
- [ ] Verificação de permissão para UI
- [ ] Tratamento de erros

---

## Próximo Documento

[03 - Sync Inicial](./03-sync-inicial.md) - Pull inicial e Snapshot
