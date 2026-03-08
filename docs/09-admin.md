# 09 - Administração

Este documento cobre o gerenciamento de usuários e resources por administradores.

---

## Parte 1: Roles de Usuário

| Role | Descrição |
|------|-----------|
| `user` | Usuário padrão - pode criar e gerenciar seus atlas |
| `admin` | Administrador - pode gerenciar recursos e usuários |

---

## Parte 2: Gerenciamento de Usuários

### 2.1 Listar Todos os Usuários

#### Endpoint

`GET /api/v1/users`

#### Query Parameters

- `includeInactive=true` - Incluir usuários desativados

#### Permissão

`admin`

#### Response

```json
{
  "data": [
    {
      "id": "user-uuid",
      "username": "cap.silva",
      "nome": "Capitão Silva",
      "posto_graduacao": "Cap",
      "organizacao_militar": "CIGEx",
      "role": "user",
      "is_active": true,
      "created_at": "2024-01-10T08:00:00.000Z",
      "last_login_at": "2024-01-17T14:30:00.000Z"
    },
    {
      "id": "user-uuid-2",
      "username": "ten.lima",
      "nome": "Tenente Lima",
      "posto_graduacao": "Ten",
      "organizacao_militar": "CIGEx",
      "role": "user",
      "is_active": false,
      "created_at": "2024-01-05T10:00:00.000Z",
      "last_login_at": "2024-01-12T09:15:00.000Z"
    }
  ]
}
```

### 2.2 Obter Usuário Específico

#### Endpoint

`GET /api/v1/users/:userId`

#### Permissão

`admin`

#### Response

```json
{
  "data": {
    "id": "user-uuid",
    "username": "cap.silva",
    "nome": "Capitão Silva",
    "posto_graduacao": "Cap",
    "organizacao_militar": "CIGEx",
    "role": "user",
    "is_active": true,
    "created_at": "2024-01-10T08:00:00.000Z",
    "last_login_at": "2024-01-17T14:30:00.000Z"
  }
}
```

### 2.3 Criar Usuário

#### Endpoint

`POST /api/v1/users`

#### Permissão

`admin`

#### Request

```json
{
  "username": "sgt.lima",
  "password": "Senh@Inicial123",
  "nome": "Sargento Lima",
  "posto_graduacao": "Sgt",
  "organizacao_militar": "CIGEx",
  "role": "user"
}
```

#### Response (201)

```json
{
  "data": {
    "id": "novo-user-uuid",
    "username": "sgt.lima",
    "nome": "Sargento Lima",
    "posto_graduacao": "Sgt",
    "organizacao_militar": "CIGEx",
    "role": "user",
    "is_active": true,
    "created_at": "2024-01-17T16:00:00.000Z"
  }
}
```

### 2.4 Atualizar Usuário

#### Endpoint

`PUT /api/v1/users/:userId`

#### Permissão

`admin`

#### Request

```json
{
  "nome": "Sargento Lima Junior",
  "posto_graduacao": "1º Sgt",
  "organizacao_militar": "CIGEx",
  "role": "admin"
}
```

> **Nota:** Todos os campos são opcionais. O admin pode alterar `username`, `nome`, `posto_graduacao`, `organizacao_militar`, `role` e `is_active`. Se o `username` for alterado, é verificado se já não existe outro usuário com o mesmo username.

#### Response (200)

```json
{
  "data": {
    "id": "user-uuid",
    "username": "sgt.lima",
    "nome": "Sargento Lima Junior",
    "posto_graduacao": "1º Sgt",
    "organizacao_militar": "CIGEx",
    "role": "admin",
    "is_active": true
  }
}
```

### 2.5 Resetar Senha

#### Endpoint

`POST /api/v1/users/:userId/reset-password`

#### Permissão

`admin`

#### Request

```json
{
  "newPassword": "NovaSenha@123"
}
```

#### Response (200)

```json
{
  "data": {
    "success": true
  }
}
```

### 2.6 Desativar Usuário

#### Endpoint

`DELETE /api/v1/users/:userId`

#### Query Parameters

- `transferTo=<outroUserId>` - Transferir atlas para outro usuário

#### Permissão

`admin`

#### Comportamento

- Se o usuário **não tem atlas**: desativado diretamente
- Se o usuário **tem atlas** e `transferTo` não foi informado: retorna erro 409
- Se o usuário **tem atlas** e `transferTo` foi informado: transfere atlas e desativa

#### Response (200)

```json
{
  "data": {
    "success": true,
    "atlasTransferred": 3
  }
}
```

#### Erros

| HTTP | Código | Descrição |
|------|--------|-----------|
| 403 | `FORBIDDEN` | Admin tentando desativar a si mesmo |
| 404 | `NOT_FOUND` | Usuário não encontrado |
| 409 | `CONFLICT` | Usuário tem atlas e `transferTo` não foi informado |

### 2.7 Reativar Usuário

#### Endpoint

`POST /api/v1/users/:userId/reactivate`

#### Permissão

`admin`

#### Response (200)

```json
{
  "data": {
    "id": "user-uuid",
    "username": "ten.lima",
    "is_active": true
  }
}
```

### 2.8 Fluxo de Administração de Usuários

```
1. ADMIN FAZ LOGIN
   └── POST /auth/login
   └── [Verifica role = 'admin']

2. LISTA USUÁRIOS
   └── GET /users?includeInactive=true
   └── [Exibe tabela com todos usuários]

3. CRIA NOVO USUÁRIO
   └── POST /users
   └── [Usuário pode fazer login imediatamente]

4. USUÁRIO ESQUECEU SENHA
   └── Admin recebe solicitação
   └── POST /users/:id/reset-password
   └── [Informa nova senha ao usuário]

5. USUÁRIO SAIU DA ORGANIZAÇÃO
   └── DELETE /users/:id?transferTo=adminId
   └── [Atlas transferidos para admin]
   └── [Usuário não pode mais fazer login]

6. USUÁRIO RETORNOU
   └── POST /users/:id/reactivate
   └── [Usuário pode fazer login novamente]
```

---

## Parte 3: Gerenciamento de Resources

Resources são configurações globais do sistema (mapas base, camadas, modelos 3D, etc.).

### 3.1 Categorias de Resources

| Categoria | Descrição |
|-----------|-----------|
| `basemap` | Mapas base (carta topográfica, satélite, OSM) |
| `analysis_layer` | Camadas de análise (declividade, elevação) |
| `data_layer` | Camadas de dados (hidrografia, rodovias) |
| `tileset` | Tilesets 3D (modelos Cesium) |
| `streetview_marker` | Marcadores de fotos 360° |

### 3.2 Listar Resources

#### Endpoint

`GET /api/v1/resources`

#### Query Parameters

- `category=basemap` - Filtrar por categoria

#### Permissão

Qualquer usuário autenticado

#### Response

```json
{
  "data": [
    {
      "id": "carta-topografica",
      "category": "basemap",
      "name": "Carta Topográfica",
      "description": "Carta topográfica do Brasil",
      "config": {
        "url": "https://tiles.example.com/topo/{z}/{x}/{y}.png",
        "attribution": "© DSG",
        "maxZoom": 18
      },
      "sort_order": 0,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "satelite",
      "category": "basemap",
      "name": "Satélite",
      "description": "Imagens de satélite",
      "config": {
        "url": "https://tiles.example.com/sat/{z}/{x}/{y}.jpg",
        "attribution": "© INPE",
        "maxZoom": 19
      },
      "sort_order": 1,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

> **Nota:** A listagem retorna apenas resources ativos (`active = true`). O campo `active` não é incluído na resposta de listagem.

### 3.3 Obter Resource

#### Endpoint

`GET /api/v1/resources/:id`

#### Permissão

Qualquer usuário autenticado

#### Response

```json
{
  "data": {
    "id": "carta-topografica",
    "category": "basemap",
    "name": "Carta Topográfica",
    "description": "Carta topográfica do Brasil",
    "config": {
      "url": "https://tiles.example.com/topo/{z}/{x}/{y}.png",
      "attribution": "© DSG",
      "maxZoom": 18
    },
    "active": true,
    "sort_order": 0,
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-15T10:00:00.000Z"
  }
}
```

### 3.4 Criar Resource

#### Endpoint

`POST /api/v1/resources`

#### Permissão

`admin`

#### Request

```json
{
  "id": "novo-basemap",
  "category": "basemap",
  "name": "Carta Nova",
  "description": "Nova carta topográfica",
  "config": {
    "url": "https://tiles.example.com/nova/{z}/{x}/{y}.png",
    "attribution": "© DSG 2024",
    "maxZoom": 20
  }
}
```

#### Response (201)

```json
{
  "data": {
    "id": "novo-basemap",
    "category": "basemap",
    "name": "Carta Nova",
    "description": "Nova carta topográfica",
    "config": {
      "url": "https://tiles.example.com/nova/{z}/{x}/{y}.png",
      "attribution": "© DSG 2024",
      "maxZoom": 20
    },
    "active": true,
    "sort_order": 0,
    "created_at": "2024-01-17T16:30:00.000Z",
    "updated_at": "2024-01-17T16:30:00.000Z"
  }
}
```

### 3.5 Atualizar Resource

#### Endpoint

`PUT /api/v1/resources/:id`

#### Permissão

`admin`

#### Request

```json
{
  "name": "Carta Nova Atualizada",
  "config": {
    "url": "https://tiles.example.com/nova-v2/{z}/{x}/{y}.png",
    "attribution": "© DSG 2024",
    "maxZoom": 21
  }
}
```

#### Response (200)

```json
{
  "data": {
    "id": "novo-basemap",
    "name": "Carta Nova Atualizada",
    "config": { ... },
    "updated_at": "2024-01-17T17:00:00.000Z"
  }
}
```

### 3.6 Deletar Resource

#### Endpoint

`DELETE /api/v1/resources/:id`

#### Permissão

`admin`

#### Response

204 No Content

### 3.7 Exemplos de Configuração por Categoria

#### Basemap (mapa de tiles)

```json
{
  "id": "osm",
  "category": "basemap",
  "name": "OpenStreetMap",
  "config": {
    "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    "attribution": "© OpenStreetMap contributors",
    "maxZoom": 19,
    "minZoom": 1
  }
}
```

#### Analysis Layer (camada de análise)

```json
{
  "id": "declividade",
  "category": "analysis_layer",
  "name": "Declividade",
  "description": "Mapa de declividade do terreno",
  "config": {
    "url": "https://analysis.example.com/slope/{z}/{x}/{y}.png",
    "legend": [
      { "range": "0-5%", "color": "#00ff00" },
      { "range": "5-15%", "color": "#ffff00" },
      { "range": ">15%", "color": "#ff0000" }
    ]
  }
}
```

#### Tileset (tileset Cesium 3D)

```json
{
  "id": "modelo-cidade",
  "category": "tileset",
  "name": "Modelo 3D - Cidade",
  "description": "Modelo 3D da área urbana",
  "config": {
    "url": "https://cesium.example.com/tilesets/cidade/tileset.json",
    "heightOffset": 0,
    "maximumScreenSpaceError": 16
  }
}
```

#### StreetView Marker (marcador 360°)

```json
{
  "id": "foto-001",
  "category": "streetview_marker",
  "name": "Ponto de Vista 1",
  "config": {
    "url": "https://photos.example.com/360/foto-001.jpg",
    "position": {
      "lat": -15.7,
      "lng": -47.9
    },
    "initialHeading": 0
  }
}
```

---

## Parte 4: Administração de Sync

### 4.1 Estatísticas de Operações

#### Endpoint

`GET /api/v1/atlas/:atlasId/sync/admin/stats`

#### Permissão

`admin`

#### Response

```json
{
  "data": {
    "atlasId": "atlas-uuid",
    "minVersion": 100,
    "currentVersion": 500,
    "oldestOperationVersion": 100,
    "totalOperations": 400
  }
}
```

| Campo | Descrição |
|-------|-----------|
| `minVersion` | Versão mínima para sync incremental |
| `currentVersion` | Versão atual do atlas |
| `oldestOperationVersion` | Versão da operação mais antiga armazenada |
| `totalOperations` | Total de operações no banco |

### 4.2 Limpar Operações Antigas

#### Endpoint

`POST /api/v1/atlas/:atlasId/sync/admin/cleanup`

#### Permissão

`admin`

#### Request

```json
{
  "keepDays": 7
}
```

Ou:

```json
{
  "keepFromVersion": 250
}
```

#### Response

```json
{
  "data": {
    "deletedCount": 150,
    "newMinVersion": 250
  }
}
```

### 4.3 Impacto do Cleanup

- Operações antigas são deletadas permanentemente
- `min_version` do atlas é atualizado
- Clientes com versão < min_version receberão snapshot
- Recomendado executar periodicamente via cron job

---

## Parte 5: API REST Completa (Referência)

### Health Check

| Método | Endpoint | Auth | Descrição |
|--------|----------|------|-----------|
| GET | `/api/v1/health` | Não | Health check |

### Autenticação

| Método | Endpoint | Auth | Descrição |
|--------|----------|------|-----------|
| POST | `/api/v1/auth/login` | Não | Login |
| POST | `/api/v1/auth/register` | Não | Auto-cadastro |
| POST | `/api/v1/auth/refresh` | Não | Renovar tokens |
| POST | `/api/v1/auth/logout` | Sim | Logout |
| GET | `/api/v1/auth/me` | Sim | Usuário atual |

### Usuários (próprio perfil)

| Método | Endpoint | Auth | Descrição |
|--------|----------|------|-----------|
| GET | `/api/v1/users/me` | User | Perfil |
| PUT | `/api/v1/users/me` | User | Atualizar perfil |
| PUT | `/api/v1/users/me/password` | User | Alterar senha |
| GET | `/api/v1/users/search` | User | Buscar usuários |

### Usuários (admin)

| Método | Endpoint | Auth | Descrição |
|--------|----------|------|-----------|
| GET | `/api/v1/users` | Admin | Listar todos |
| POST | `/api/v1/users` | Admin | Criar usuário |
| GET | `/api/v1/users/:userId` | Admin | Obter usuário |
| PUT | `/api/v1/users/:userId` | Admin | Atualizar |
| POST | `/api/v1/users/:userId/reset-password` | Admin | Resetar senha |
| DELETE | `/api/v1/users/:userId` | Admin | Desativar |
| POST | `/api/v1/users/:userId/reactivate` | Admin | Reativar |

### Atlas

| Método | Endpoint | Auth | Perm | Descrição |
|--------|----------|------|------|-----------|
| GET | `/api/v1/atlas` | User | - | Listar atlas |
| POST | `/api/v1/atlas` | User | - | Criar atlas |
| POST | `/api/v1/atlas/import` | User | - | Import offline |
| GET | `/api/v1/atlas/public/:link` | Não | - | Atlas público |
| GET | `/api/v1/atlas/:id` | User | read | Obter atlas |
| PUT | `/api/v1/atlas/:id` | User | write | Atualizar |
| DELETE | `/api/v1/atlas/:id` | User | owner | Deletar |
| GET | `/api/v1/atlas/:id/settings` | User | read | Settings |
| PATCH | `/api/v1/atlas/:id/settings` | User | owner | Atualizar settings |
| POST | `/api/v1/atlas/:id/clone` | User | read | Clonar |

### Maps (read-only, escrita via sync)

| Método | Endpoint | Auth | Perm | Descrição |
|--------|----------|------|------|-----------|
| GET | `/api/v1/atlas/:id/maps` | User | read | Listar mapas |
| GET | `/api/v1/atlas/:id/maps/:mapId` | User | read | Obter mapa |

### Briefings (read-only, escrita via sync)

| Método | Endpoint | Auth | Perm | Descrição |
|--------|----------|------|------|-----------|
| GET | `/api/v1/atlas/:id/briefings` | User | read | Listar briefings |
| GET | `/api/v1/atlas/:id/briefings/:briefingId` | User | read | Obter briefing |

### Compartilhamento

| Método | Endpoint | Auth | Perm | Descrição |
|--------|----------|------|------|-----------|
| GET | `/api/v1/atlas/:id/sharing` | User | owner | Ver config |
| POST | `/api/v1/atlas/:id/sharing/public` | User | owner | Habilitar público |
| DELETE | `/api/v1/atlas/:id/sharing/public` | User | owner | Desabilitar público |
| POST | `/api/v1/atlas/:id/sharing/users` | User | owner | Compartilhar |
| PUT | `/api/v1/atlas/:id/sharing/users/:userId` | User | owner | Alterar perm |
| DELETE | `/api/v1/atlas/:id/sharing/users/:userId` | User | owner | Remover |

### Imagens

| Método | Endpoint | Auth | Perm | Descrição |
|--------|----------|------|------|-----------|
| GET | `/api/v1/atlas/:id/images` | User | read | Listar |
| POST | `/api/v1/atlas/:id/images` | User | write | Upload |
| POST | `/api/v1/atlas/:id/images/bulk` | User | write | Bulk upload (base64) |
| GET | `/api/v1/atlas/:id/images/:imageId` | User | read | Download |
| DELETE | `/api/v1/atlas/:id/images/:imageId` | User | write | Deletar |

### Sync

| Método | Endpoint | Auth | Perm | Descrição |
|--------|----------|------|------|-----------|
| POST | `/api/v1/atlas/:id/sync` | User | write | Push operações |
| GET | `/api/v1/atlas/:id/sync/:version` | User | read | Pull |
| GET | `/api/v1/atlas/:id/sync/admin/stats` | Admin | - | Estatísticas |
| POST | `/api/v1/atlas/:id/sync/admin/cleanup` | Admin | - | Cleanup |

### Resources

| Método | Endpoint | Auth | Perm | Descrição |
|--------|----------|------|------|-----------|
| GET | `/api/v1/resources` | User | - | Listar |
| GET | `/api/v1/resources/:id` | User | - | Obter |
| POST | `/api/v1/resources` | Admin | - | Criar |
| PUT | `/api/v1/resources/:id` | Admin | - | Atualizar |
| DELETE | `/api/v1/resources/:id` | Admin | - | Deletar |

---

## Checklist de Implementação (Admin)

### Gerenciamento de Usuários
- [ ] Tela de listagem de usuários
- [ ] Filtro para mostrar/ocultar inativos
- [ ] Formulário de criação de usuário
- [ ] Edição de perfil de usuário
- [ ] Reset de senha
- [ ] Modal de confirmação para desativação
- [ ] Seleção de usuário para transferir atlas
- [ ] Reativação de usuário

### Gerenciamento de Resources
- [ ] Listagem de resources por categoria
- [ ] Formulário de criação de resource
- [ ] Edição de resource
- [ ] Deleção de resource
- [ ] Preview de configuração (ex: visualizar mapa base)

### Administração de Sync
- [ ] Visualização de estatísticas
- [ ] Botão de cleanup com confirmação
- [ ] Opção para definir dias/versão a manter

---

## Variáveis de Ambiente

```javascript
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const WS_BASE_URL = process.env.WS_URL || 'ws://localhost:3000';
```

---

## Credenciais de Teste

Após rodar o seed (`npm run db:seed`):

| Usuário | Senha | Role |
|---------|-------|------|
| `admin` | `admin123` | admin |
| `cap.silva` | `test123` | user |

---

## Documentos Relacionados

- [01 - Autenticação](./01-autenticacao.md)
- [02 - Atlas Básico](./02-atlas-basico.md)
- [03 - Sync Inicial](./03-sync-inicial.md)
- [04 - WebSocket Colaboração](./04-websocket-collab.md)
- [05 - Sync CRDT](./05-sync-crdt.md)
- [06 - Presença e Imagens](./06-presenca-imagens.md)
- [07 - Compartilhamento](./07-compartilhamento.md)
- [08 - Offline e Import](./08-offline-import.md)
