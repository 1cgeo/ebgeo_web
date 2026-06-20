# CLAUDE.md - EBGeo Backend

Este arquivo contém o contexto e instruções para o Claude Code trabalhar neste projeto.

## Visão Geral do Projeto

EBGeo Backend é a API REST + WebSocket para o aplicativo de mapeamento geoespacial militar EBGeo. O backend adiciona:
- Autenticação JWT para rede militar interna
- Persistência em PostgreSQL
- Colaboração em tempo real via WebSocket
- Sincronização offline-first com resolução de conflitos CRDT

**Constraint fundamental:** A aplicação DEVE funcionar identicamente para usuários não autenticados. O backend é aditivo.

## Stack Tecnológica

| Componente | Tecnologia |
|------------|------------|
| Runtime | Node.js 20 LTS (ES Modules) |
| Framework | Express.js 4.x |
| Database | PostgreSQL 16.x |
| DB Driver | `pg-promise` - SQL direto, sem ORM |
| WebSocket | `ws` |
| Auth | `jsonwebtoken` + `bcrypt` |
| Validação | `joi` |
| Logging | `pino` |

## Estrutura do Projeto

```
src/
├── index.js              # Entry point (HTTP server + WS)
├── app.js                # Express app factory
├── config.js             # Configuração via .env
├── database/
│   ├── index.js          # Conexão pg-promise (query, tx, one, etc)
│   ├── migrate.js        # Runner de migrações
│   └── migrations/       # Arquivos SQL (001-004)
├── middleware/           # Auth, permissions, validate, error-handler, require-admin, optional-auth, request-logger
├── modules/
│   ├── auth/             # Login, logout, refresh, me
│   ├── users/            # Perfil do usuário + gerenciamento admin
│   ├── atlas/            # CRUD + settings + clone + public link + import
│   ├── maps/             # Leitura de mapas (read-only, escrita via sync)
│   ├── briefings/        # Leitura de briefings (read-only, escrita via sync)
│   ├── resources/        # Recursos disponíveis (basemaps, layers, etc)
│   ├── sharing/          # Links públicos + compartilhamento
│   ├── images/           # Upload/download de imagens
│   ├── sync/             # Push/pull de operações CRDT
│   └── collab/           # WebSocket (gateway, rooms, handlers)
├── crdt/                 # Resolução LWW, merger
└── utils/                # Errors, logger, async-handler
```

## Arquitetura de Sync

Todas as entidades colaborativas são gerenciadas **exclusivamente via sync**:
- `POST /atlas/:id/sync` - Push de operações CRDT
- `GET /atlas/:id/sync/:version` - Pull desde versão (híbrido: snapshot ou operações)
- WebSocket `operation`/`operations` - Real-time sync

**Sistema Híbrido de Sync:**
- `versão == 0` ou `versão < min_version` → Retorna **snapshot** (estado materializado)
- `versão >= min_version` → Retorna **operações incrementais**
- Administradores podem limpar operações antigas via `POST /sync/admin/cleanup`

**Entidades via sync (não há rotas REST de escrita separadas):**
- `feature` - Feições geoespaciais (18 tipos: point, line, polygon, text, image, circle, rectangle, ellipse, brush, arrow, boundary, occupied_front, military_symbol, coordination_measure, los, visibility, processed_los, processed_visibility)
- `group` - Grupos de feições (suporta hierarquia via parent_id)
- `layer` - Camadas organizacionais
- `map` - Mapas (viewport, camadas base, locked)
- `briefing` - Briefings
- `slide` - Slides de briefing
- `group_feature` - Associação grupo-feição
- `cesium3d` - Dados 3D do Cesium (marker, measurement, viewshed, camera_position)
- `streetview360` - Dados de panoramas 360 (orientation, marker)

**Sub-entidades de mapa (operações via sync):**
- `mapPosition` - Viewport (center_lat, center_long, zoom, bearing, pitch) ✅
- `baseLayer` - Camada base do mapa (coluna `base_layer`) ✅
- `mapNotes` - Notas do mapa (`notes_title`/`notes_description`) ✅
- `gridStyle` - Estilo de grade ✅ **persiste** em `maps.grid_style` (JSONB); payload `{format, visible}`. (Fase 1)
- `mapTemporal` - Config temporal do mapa ✅ persiste em `maps.temporal_config` (JSONB) `{ativo, unidade, inicio, fim, modo, origem}` — **gated** (aguarda o frontend emitir a op). (Fase 1)
- `catalogLayer` - Camadas do catálogo ✅ **entidade por-camada** na tabela `catalog_layers` (id/map_id/data/version/soft-delete) com create/update/delete; aparece no snapshot como `map.catalogLayers`. **Dual-mode:** se a op trouxer o array inteiro (`data.catalog_layers`), grava na coluna legada `maps.catalog_layers` (compat). (Fase 1)

**Módulos read-only:**
- `maps` e `briefings` possuem apenas rotas GET (listagem e detalhes)
- Todas as operações de escrita são gerenciadas via sync API

**Compatibilidade com Frontend:**

O backend foi projetado para ser 100% compatível com a estrutura de dados do frontend. Os seguintes mapeamentos são aplicados automaticamente:

1. **Campos de Operação** - O backend aceita AMBOS os formatos:
   - Frontend: `entityType`, `operationType`, `entityId`
   - Legacy: `target`, `type`, `targetId`

2. **EntityTypes de 3D/360** - Mapeamento automático:
   - `marker3d` ↔ `cesium3d` (data_type: marker)
   - `measurement3d` ↔ `cesium3d` (data_type: measurement)
   - `viewshed3d` ↔ `cesium3d` (data_type: viewshed)
   - `cameraPosition3d` ↔ `cesium3d` (data_type: camera_position)
   - `orientation360` ↔ `streetview360` (data_type: orientation)
   - `marker360` ↔ `streetview360` (data_type: marker)

3. **Snapshot** - Retorna estrutura idêntica ao IndexedDB do frontend:
   - Features organizadas por tipo (`points`, `lines`, `polygons`, etc.)
   - Cesium3D hierárquico (`cameraPositions`, `markers`, `measurements`, `viewsheds`)
   - StreetView360 hierárquico (`orientations`, `markers`)
   - SyncMetadata em cada entidade

## Padrões de Código

### Convenção de Arquivos por Módulo
- `.routes.js` - Apenas definição de rotas, sem lógica
- `.controller.js` - Camada HTTP: lê `req`, chama service, escreve `res`
- `.service.js` - Toda lógica de negócio
- `.queries.js` - Constantes SQL nomeadas
- `.schemas.js` - Schemas Joi para validação
- `index.js` - Re-exporta para imports limpos

### Exemplo de Controller
```javascript
export const createAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.createAtlas(req.user.id, req.body);
  res.status(201).json({ data: atlas });
});
```

### Exemplo de Service
```javascript
export async function createAtlas(userId, data) {
  const { rows } = await query(Q.INSERT_ATLAS, [data.name, data.description, userId]);
  return rows[0];
}
```

### Transações com pg-promise
```javascript
import { tx } from '../../database/index.js';

await tx(async (t) => {
  await t.none(Q.INSERT_SOMETHING, [params]);
  await t.one(Q.GET_SOMETHING, [params]);
  // Commit automático, rollback automático em erro
});
```

## Comandos Úteis

```bash
# Desenvolvimento
npm run dev              # Inicia com --watch
npm run db:migrate       # Aplica migrações
npm run db:seed          # Cria dados de teste

# Testes (automatizado: cria DB → migra → testa → dropa DB)
npm test                 # Todos os testes (cria/dropa DB automaticamente)
npm run test:coverage    # Com cobertura de código
npm run test:keep-db     # Mantém o banco após os testes (para debug)
npm run test:unit        # Apenas unit tests
npm run test:integration # Apenas integration tests
npm run test:ws          # Apenas WebSocket tests

# Gerenciamento manual do banco de teste
npm run db:test:create   # Cria banco ebgeo_test
npm run db:test:drop     # Remove banco ebgeo_test
npm run db:test:reset    # Recria banco ebgeo_test
npm run test:quick       # Executa testes sem gerenciar DB (requer .env.test)
```

### Configuração do Banco de Teste

O script de testes (`npm test`) gerencia automaticamente o banco de teste:
1. Cria banco `ebgeo_test` (ou reseta se existir)
2. Executa todas as migrações
3. Roda os testes
4. Dropa o banco ao final

**Variáveis de ambiente (opcionais):**
- `TEST_DB_NAME` - Nome do banco de teste (default: `ebgeo_test`)
- `DB_USER` - Usuário PostgreSQL (default: `ebgeo`)
- `DB_PASSWORD` - Senha (default: `ebgeo_secret`)
- `DB_HOST` - Host (default: `localhost`)
- `DB_PORT` - Porta (default: `5432`)

## Database

- Geometria armazenada como **JSONB** (mesmo formato do IndexedDB/frontend)
- Sem PostGIS - não há queries espaciais no servidor
- Soft-delete via `deleted_at` em todas as entidades principais
- `version` para CRDT, incrementado a cada update
- **Idempotência de operações** (Fase 0): coluna `operations.op_id` (id do cliente) + índice `UNIQUE (atlas_id, op_id)`; o push usa `ON CONFLICT DO NOTHING` (reenvio não duplica nem reaplica)

### Migrações
Arquivos em `src/database/migrations/` executados em ordem alfabética.
Tracking via tabela `_migrations`. **Forward-only** (sem rollback). Ao adicionar, use o próximo número livre.

| Migração | Descrição |
|----------|-----------|
| 001_core.sql | Extensão pgcrypto, tabela users (campos militares BR), refresh_tokens |
| 002_atlas.sql | Atlas, maps, layers, groups, features (18 tipos), group_features, cesium3d_data, streetview360_data, images, briefings, slides, trigger mark_slides_broken_on_map_delete |
| 003_sync.sql | Operations (CRDT log), active_sessions, resources, trigger update_atlas_current_version, seed de recursos |
| 004_map_locked.sql | Adiciona campo `locked` (BOOLEAN DEFAULT FALSE) à tabela maps |
| 005_client_id_text.sql | Converte `operations.client_id` de UUID para TEXT |
| 006_operations_idempotency.sql | Adiciona `operations.op_id` (TEXT) + índice `UNIQUE (atlas_id, op_id)` para idempotência |
| 007_map_grid_style.sql | Adiciona `maps.grid_style` (JSONB) — gridStyle |
| 008_catalog_layers.sql | Cria tabela `catalog_layers` (entidade por-camada com soft-delete) |
| 009_map_temporal_config.sql | Adiciona `maps.temporal_config` (JSONB) — mapTemporal (gated) |
| 010_config_resources.sql | Backfill de `resources.config` (basemaps/tileset) para o endpoint `GET /api/v1/config` |
| 011_postgis_ng.sql | **PostGIS** + schema `ng` (nomes_geograficos[4674], edificacoes[4326], catalogo_3d), `f_unaccent`, triggers `tipo_peso`/`search_vector`, `ng.refresh_busca()` (Fase 3) |
| 012_organizations.sql | Tabela `organizations` + org default (`slug='default'`) (Fase 5) |
| 013_users_org_and_roles.sql | `users.organization_id` (FK, backfill) + `org_role` + CHECK em `role` (Fase 5) |
| 014_api_keys.sql | `users.api_key` + tabela `api_key_history` (rotação) (Fase 5) |
| 015_audit_trail.sql | Tabela `audit_trail` (auditoria de negócio, CHECK fechado de action/target) (Fase 5) |
| 016_model_permissions.sql | `ng.catalogo_3d.access_level` + `ng.model_permissions`/`model_group_permissions` + stub `ng.user_groups` (Fase 4) |
| 017_geographic_access.sql | `ng.groups` + `geographic_access_zones`(4674) + zone permissions + `access_level` em nomes/edificacoes + `ng.fn_user_zone_geoms` + índices parciais (Fase 6) |

## Configuração (config.js)

| Variável | Default | Descrição |
|----------|---------|-----------|
| `PORT` | 3000 | Porta do servidor |
| `NODE_ENV` | development | Ambiente |
| `LOG_LEVEL` | info | Nível de log Pino |
| `DATABASE_URL` | *required* | URL de conexão PostgreSQL |
| `DATABASE_POOL_MIN` | 2 | Mínimo de conexões no pool |
| `DATABASE_POOL_MAX` | 10 | Máximo de conexões no pool |
| `JWT_SECRET` | *required* | Segredo para assinar JWTs |
| `JWT_ACCESS_EXPIRY` | 15m | Validade do access token |
| `JWT_REFRESH_EXPIRY` | 7d | Validade do refresh token |
| `CORS_ORIGIN` | http://localhost:8080 | Origem permitida para CORS |
| `IMAGES_DIR` | ./data/images | Diretório de armazenamento de imagens |
| `MAX_IMAGE_SIZE_MB` | 10 | Tamanho máximo de upload de imagem |
| `WS_HEARTBEAT_INTERVAL_MS` | 30000 | Intervalo de heartbeat WebSocket |
| `WS_HEARTBEAT_TIMEOUT_MS` | 5000 | Timeout de heartbeat WebSocket |
| `ALLOW_SELF_REGISTRATION` | (prod: false, dev/test: true) | Habilita `POST /auth/register`; desligado em produção por padrão |
| `RATE_LIMIT_AUTH_WINDOW_MS` | 900000 | Janela do rate limit das rotas de credencial (15 min) |
| `RATE_LIMIT_AUTH_MAX` | 10 | Máx. tentativas por janela em `/auth/login\|refresh\|register` (chave: IP+username) |
| `RATE_LIMIT_PUBLIC_WINDOW_MS` | 60000 | Janela do rate limit do link público (1 min) |
| `RATE_LIMIT_PUBLIC_MAX` | 30 | Máx. requisições por janela em `/atlas/public/:link` (por IP) |

> **Boot fail-fast:** `validateEnvVariables()` (chamado em `src/index.js`) valida o ambiente agrupando
> erros (DATABASE_URL, JWT_SECRET ≥ 32 chars em prod, PORT, CORS_ORIGIN) e aborta com mensagem clara.
> `JWT_SECRET` em teste/dev é livre; em produção exige ≥ 32 caracteres.

## Sistema de Permissões

Hierarquia: `owner` > `write` > `read`

```javascript
// Resolução (waterfall):
1. userId === atlas.owner_id → 'owner'
2. atlas_shares.permission   → 'read' ou 'write'
3. atlas.is_public          → 'read'
4. Nenhum                   → 403 Forbidden
```

### Roles de Usuário
- `user` (default) - Pode criar atlas, acessar recursos
- `admin` - Pode gerenciar recursos do sistema e usuários

### Gerenciamento de Usuários (Admin)

Administradores podem:
- Listar todos os usuários (ativos e inativos)
- Criar usuários com qualquer role
- Atualizar perfil, role e status de usuários
- Resetar senha de usuários
- Desativar usuários (soft-delete via `is_active = false`)
- Reativar usuários desativados

**Política de deleção de usuários:**
- Usuários são **desativados** (soft-delete), nunca removidos do banco
- Se o usuário possui atlas, o admin pode transferir a propriedade via `?transferTo=<userId>`
- Sem `transferTo`, retorna erro informando quantos atlas o usuário possui
- Admin não pode desativar a si mesmo

## WebSocket (Colaboração)

### Usuários Autenticados
- URL: `ws://host/api/v1/collab?atlasId=X&token=JWT`
- Token obtido via login (`POST /auth/login`)

### Usuários Públicos
- URL: `ws://host/api/v1/collab?atlasId=X&token=PUBLIC_TOKEN`
- Token obtido via `GET /atlas/public/:link` (campo `publicToken`)
- Permissão: somente leitura (`read`)
- Expiração: 1 hora

### Tipos de Mensagem
- `ping`/`pong` - Heartbeat
- `cursor`, `selection` - Presença
- `operation`, `operations` - CRDT ops (ack/`ack_batch` carregam `results[]` com `{success, operationId, idempotent, currentVersion}`)
- `connection-quality` → `adaptive-settings` - Monitor de qualidade adaptativo (Fase 1)
- `sync_request`/`sync_response` - Sync via WS
- `user_joined`, `user_left` - Eventos de sala
- `atlas_updated`, `atlas_deleted`, `atlas_settings_updated` - Mutações REST broadcast
- `sharing_updated` - Alterações de compartilhamento broadcast
- `maps_merged` - Merge de mapas broadcast (Fase 1)
- `connected` - Inclui `permission` (owner/write/read) **e** `role` (owner/editor/viewer/admin) (Fase 1); handshake aceita `?clientId=` estável (idempotência/presença na reconexão, Fase 8)
- `briefing_edit_start`/`briefing_edit_end` → `briefing_edit_started`/`briefing_edit_ended` - Awareness

## CRDT / Modelo de conflito

> **Estado real do código (verificado):** a resolução de conflito é **LWW por ordem de chegada ao
> servidor**, NÃO por timestamp. O `applyOperation` aplica todo UPDATE incondicionalmente
> (`version = version + 1`, `updated_at = NOW()`) sem comparar `client_timestamp`. O módulo
> `src/crdt` (resolver/merger LWW por timestamp+clientId) existe mas **não é plugado** no caminho de
> escrita (código morto). Decisão registrada em `docs/plano/fase-1-sync-multiusuario.md` (D2): manter
> LWW-por-chegada + idempotência por `op_id` (já implementada na Fase 0); plugar o `crdt` só se
> LWW-por-timestamp virar requisito de produto.

- **Last-Writer-Wins (LWW)** por entidade, **por ordem de chegada** (não por timestamp)
- **Idempotência** por `op_id` do cliente (reenvio não duplica/reaplica) — Fase 0
- Delete (soft-delete) vence updates subsequentes para a mesma entidade na ordem de chegada

## Credenciais de Teste (após seed)

- Admin: `admin` / `admin123` (role: admin)
- Usuário: `cap.silva` / `test123` (role: user)

## API Response Format

```json
// Sucesso
{ "data": { ... } }

// Erro
{ "error": { "code": "NOT_FOUND", "message": "Atlas not found" } }
```

## Rotas da API (50 endpoints)

### Health Check & Config
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/health` | Health check (readiness com `SELECT 1`) | Não | - |
| GET | `/api/v1/config` (+ alias `/api/config`) | Config dinâmico do frontend (shape do `config.js`); dados de `resources` + URLs por env (Fase 2) | Não | - |

### Auth
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| POST | `/api/v1/auth/register` | Auto-cadastro (gateado por `ALLOW_SELF_REGISTRATION`; 404 se off) | Não | - |
| POST | `/api/v1/auth/login` | Login | Não | - |
| POST | `/api/v1/auth/refresh` | Refresh token | Não | - |
| POST | `/api/v1/auth/logout` | Logout | Sim | User |
| GET | `/api/v1/auth/me` | Usuário atual | Sim | User |

### Users (próprio perfil)
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/users/me` | Perfil do usuário | Sim | User |
| PUT | `/api/v1/users/me` | Atualizar perfil | Sim | User |
| PUT | `/api/v1/users/me/password` | Alterar senha | Sim | User |
| GET | `/api/v1/users/search` | Buscar usuários | Sim | User |

### Users (admin - gerenciamento)
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/users` | Listar todos usuários | Sim | Admin |
| POST | `/api/v1/users` | Criar usuário | Sim | Admin |
| GET | `/api/v1/users/:userId` | Obter usuário | Sim | Admin |
| PUT | `/api/v1/users/:userId` | Atualizar usuário | Sim | Admin |
| POST | `/api/v1/users/:userId/reset-password` | Resetar senha | Sim | Admin |
| DELETE | `/api/v1/users/:userId` | Desativar usuário | Sim | Admin |
| POST | `/api/v1/users/:userId/reactivate` | Reativar usuário | Sim | Admin |

### Atlas
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/atlas` | Listar atlas do usuário | Sim | User |
| POST | `/api/v1/atlas` | Criar atlas | Sim | User |
| POST | `/api/v1/atlas/import` | Import bulk (offline) | Sim | User |
| GET | `/api/v1/atlas/public/:link` | Atlas público + token WS | Não | - |
| GET | `/api/v1/atlas/:atlasId` | Obter atlas | Sim | Read |
| PUT | `/api/v1/atlas/:atlasId` | Atualizar atlas | Sim | Write |
| DELETE | `/api/v1/atlas/:atlasId` | Deletar atlas | Sim | Owner |
| GET | `/api/v1/atlas/:atlasId/settings` | Obter configurações | Sim | Read |
| PATCH | `/api/v1/atlas/:atlasId/settings` | Atualizar configurações | Sim | Owner |
| POST | `/api/v1/atlas/:atlasId/clone` | Clonar atlas | Sim | Read |

### Maps
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/atlas/:atlasId/maps` | Listar mapas | Sim | Read |
| GET | `/api/v1/atlas/:atlasId/maps/:mapId` | Obter mapa | Sim | Read |
| POST | `/api/v1/atlas/:atlasId/maps/:mapId/duplicate` | Duplicar mapa | Sim | Write |
| POST | `/api/v1/atlas/:atlasId/maps/:mapId/merge` | Combinar mapas (move sub-entidades dos `sourceMapIds` para `:mapId`, atômico) | Sim | Write |

### Briefings (read-only, escrita via sync)
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/atlas/:atlasId/briefings` | Listar briefings | Sim | Read |
| GET | `/api/v1/atlas/:atlasId/briefings/:briefingId` | Obter briefing | Sim | Read |

### Sharing
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/atlas/:atlasId/sharing` | Config de compartilhamento | Sim | Owner |
| POST | `/api/v1/atlas/:atlasId/sharing/public` | Habilitar link público | Sim | Owner |
| DELETE | `/api/v1/atlas/:atlasId/sharing/public` | Desabilitar link público | Sim | Owner |
| POST | `/api/v1/atlas/:atlasId/sharing/users` | Compartilhar com usuário | Sim | Owner |
| PUT | `/api/v1/atlas/:atlasId/sharing/users/:userId` | Alterar permissão | Sim | Owner |
| DELETE | `/api/v1/atlas/:atlasId/sharing/users/:userId` | Remover compartilhamento | Sim | Owner |

### Images
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/atlas/:atlasId/images` | Listar imagens | Sim | Read |
| POST | `/api/v1/atlas/:atlasId/images` | Upload de imagem | Sim | Write |
| POST | `/api/v1/atlas/:atlasId/images/bulk` | Bulk upload (base64, offline import) | Sim | Write |
| GET | `/api/v1/atlas/:atlasId/images/:imageId` | Download de imagem | Sim | Read |
| DELETE | `/api/v1/atlas/:atlasId/images/:imageId` | Deletar imagem | Sim | Write |

**Bulk Upload de Imagens:**
- Aceita até 50 imagens por requisição em formato base64
- Retorna mapeamento `localId → serverId` para atualizar referências
- Suporta falhas parciais (imagens válidas são salvas mesmo se outras falharem)
- Formato: `{ images: [{ localId, filename, mimeType, data }] }`
- Resposta: `{ uploaded: [...], failed: [...], mapping: {...} }`

### Sync (CRDT)
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| POST | `/api/v1/atlas/:atlasId/sync` | Push de operações | Sim | Write |
| GET | `/api/v1/atlas/:atlasId/sync/:version` | Pull desde versão (snapshot ou ops) | Sim | Read |
| GET | `/api/v1/atlas/:atlasId/sync/admin/stats` | Estatísticas de operações | Sim | Admin |
| POST | `/api/v1/atlas/:atlasId/sync/admin/cleanup` | Limpar operações antigas | Sim | Admin |

**Sistema Híbrido:**
- `versão == 0` ou `< min_version` → Retorna snapshot (estado materializado)
- `versão >= min_version` → Retorna operações incrementais
- Resposta inclui `isSnapshot: true|false` para indicar o tipo

**Targets suportados:**
`feature`, `group`, `layer`, `group_feature`, `map`, `briefing`, `slide`, `cesium3d`, `streetview360`

### Multi-org / Identidade / Auditoria (Fase 5)
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/organizations` | Listar organizações (OMs) | Sim | User |
| GET | `/api/v1/organizations/:id` | Obter organização | Sim | User |
| POST | `/api/v1/organizations` | Criar org (auditado `ORG_CREATE`) | Sim | Admin |
| PUT | `/api/v1/organizations/:id` | Atualizar org | Sim | Admin |
| DELETE | `/api/v1/organizations/:id` | Desativar org (soft-delete) | Sim | Admin |
| POST | `/api/v1/users/me/api-key/rotate` | Rotacionar minha API key (atômico) | Sim | User |
| POST | `/api/v1/users/:userId/api-key/rotate` | Rotacionar API key de usuário | Sim | Admin |
| GET | `/api/v1/audit` | Consultar trilha de auditoria (filtros action/actor/target) | Sim | Admin |

> **Identidade:** JWT agora carrega `organization_id` (tenant) e `org_role ∈ {owner,editor,viewer,admin}`
> além do `role` global `{user,admin}` — payload de **emissor único** (web/nomes/360). Tokens legados
> (sem o claim) ainda validam (`org_role→viewer`, `organization_id→null`). **Auth flexível**
> (`flexibleAuth`, global não-bloqueante): popula `req.user` via `Authorization: Bearer`, cookie `token`
> ou `x-api-key`; o caminho anônimo é preservado e rotas estritas (`auth`) continuam exigindo credencial.
> **Auditoria** (`audit_trail`, banco, consultável, transacional via `createAudit(req, params, t?)`) é
> **distinta** do logging operacional. `EnvironmentManager` (`src/utils/environment.js`) é a fonte única
> de cookie/cors/pool/useHttps. **`atlas.owner_id`/`images.uploaded_by`/`atlas_shares.added_by`** são
> `REFERENCES users(id)` **sem `ON DELETE`** → reatribuir (via `?transferTo`) antes de qualquer hard-delete.

### Nomes Geográficos (Gazetteer — PostGIS, read-only, Fase 3)
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/nomes/busca` | Busca de topônimos (7 critérios; `?q=&lat=&lon=&zoom=`); responde **array nu** (contrato congelado) | Sim | User |
| GET | `/api/v1/nomes/feicoes` | Clique 3D em edificação (`?lat=&lon=&z=`); desempate por altitude | Sim | User |
| GET | `/api/v1/nomes/catalogo3d` | Catálogo 3D full-text PT-BR (`?q=&page=&nr_records=`); **filtro de acesso embutido no SQL** (public/admin/permissão); envelope `{total,page,nr_records,data}` | Sim | User |
| GET | `/api/v1/assets3d/*` | Servir assets 3D imutáveis (tileset.json/b3dm/glb/terrain) com ETag O(1)/304/Range/cache; **dual-mode: store SQLite primeiro, filesystem como fallback**; descoberta gateada pelo catálogo (Fase 4) | Não (público) | - |

> **Controle de acesso geográfico (Fase 6):** a autorização é **embutida na query SQL** (defesa em
> profundidade — o dado não vaza nem com bug na camada de app). `ng.nomes_geograficos`/`ng.edificacoes`/
> `ng.catalogo_3d` têm `access_level` (public/private); um privado só aparece para **admin**, **permissão
> direta** ou se sua geometria estiver **contida numa zona do usuário** (`ST_Contains` via
> `ng.fn_user_zone_geoms`, predicado único reusado por busca/feicoes/count). Admin de zonas em
> `/api/v1/zones` (CRUD + replace-set de permissões com auditoria `PERMISSION_GRANT`).
> **Endpoints de permissão de modelo 3D e o módulo de grupos são follow-ups** (a infra de tabelas/FK e o
> filtro já existem; permissões de modelo testadas via `catalogo3d-access`).

> **PostGIS:** extensão **untrusted** — exige superusuário para `CREATE EXTENSION postgis`. Em prod, o DBA cria
> postgis no banco (ou o role do app é privilegiado); a imagem `postgis/postgis` já o habilita em `template1`.
> Localmente, `scripts/run-tests.js` pré-cria via `SUPERUSER_DATABASE_URL` (default `postgres:postgres@localhost`).
> **Carga de nomes (FME):** após cada carga, rodar **`SELECT ng.refresh_busca();`** (DBSCAN + `tipo_peso`) —
> sem isso, `cluster_id` fica nulo e a busca degrada silenciosamente. O `criterio_busca.md` do serviço
> original está desatualizado (6 critérios); o código (7 critérios, pesos somam 1.00) é a fonte de verdade.

### Resources (admin)
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/resources` | Listar recursos | Sim | User |
| GET | `/api/v1/resources/:id` | Obter recurso | Sim | User |
| POST | `/api/v1/resources` | Criar recurso | Sim | Admin |
| PUT | `/api/v1/resources/:id` | Atualizar recurso | Sim | Admin |
| DELETE | `/api/v1/resources/:id` | Deletar recurso | Sim | Admin |

### Legenda de Permissões
- **User**: Qualquer usuário autenticado
- **Admin**: Usuário com role `admin`
- **Read**: Acesso de leitura ao atlas (owner, write, shared read, ou público)
- **Write**: Acesso de escrita ao atlas (owner ou write)
- **Owner**: Apenas o dono do atlas

## Segurança (Hardening — Fase 0)

- **Rate limiting** (`express-rate-limit`, `src/middleware/rate-limit.js`) em `/auth/login|refresh|register` (chave IP+username) e `/atlas/public/:link` (por IP). Pulado em teste (a menos de `RATE_LIMIT_FORCE=1`).
- **Login timing-safe**: bcrypt sempre roda (hash dummy quando o usuário não existe); mensagem genérica `Invalid credentials` para usuário inexistente e senha errada.
- **Refresh tokens**: rotação + **detecção de reuso** (reapresentar token revogado revoga toda a família); **revogados na troca/reset de senha e na desativação** do usuário.
- **JWT**: `jwt.verify(..., { algorithms: ['HS256'] })` no REST e no gateway WS (rejeita `none`/forja).
- **Upload de imagem**: allowlist `png/jpeg/webp` (**SVG removido**, vetor de XSS), **validação de magic bytes** (`file-type`) em multipart e base64; download servido como `attachment` com `ETag`/`Cache-Control: immutable`/`Range`.
- **`POST /sync`**: validação Joi (`pushSchema`, máx. 500 ops, aceita ambos os vocabulários) no REST e no WS.
- **helmet** com CSP/HSTS explícitos (HSTS só em prod); **handler 404** padronizado; **health** com `SELECT 1` (503 se o banco cair).
- **Self-registration gateada** por `ALLOW_SELF_REGISTRATION` (off em prod).
- **Pool** `poolMin/poolMax` aplicado na conexão pg-promise.

## Distribuição 3D (assets em SQLite ou filesystem)

Os binários 3D (`tileset.json`/`.b3dm`/`.glb`/`.pnts`/`.terrain`) podem ser servidos de **duas fontes**
(o controller tenta o SQLite primeiro, depois o filesystem):
- **SQLite** (`better-sqlite3`): store em `ASSETS_3D_SQLITE` (default `./data/assets3d.sqlite`), tabela
  `assets(rel_path PK, data BLOB, size_bytes, content_type, etag)`. ETag O(1) (coluna, sem ler o BLOB)
  na thread principal; **304 antes de qualquer leitura de BLOB**. O `SELECT data` (BLOB pesado) roda num
  **pool de worker threads** (`src/utils/sqlite-blob-pool.js` + `sqlite-blob-worker.js`, `SQLITE_BLOB_WORKERS`
  workers) — tira o read síncrono do event loop. Range 206/416 sobre o Buffer; **semáforo**
  `ASSETS_3D_MAX_INFLIGHT` (default 8) limita buffers vivos no heap. Carga: `node scripts/assets3d-import.js <dir>`.
- **Filesystem** (`ASSETS_3D_DIR`, default `./data/assets3d`): stream via `createReadStream` (sem
  semáforo). É o fallback quando o asset não está no SQLite.

> Os **metadados** (descoberta/posição) ficam sempre em `ng.catalogo_3d` (Postgres). Só o **binário**
> é que tem as duas opções de store. (Mesmo modelo de BLOB-em-SQLite previsto para o 360 na Fase 9.)

## DevOps

- `Dockerfile` (multi-stage, node:20-slim, non-root) + `docker-compose.yml` (app + `postgis/postgis:16`).
- Dependência nativa `better-sqlite3` (store SQLite de assets 3D; binário pré-compilado, sem build no slim).
- Lint/format: `eslint.config.js` (flat) + `.prettierrc.json`; `npm run lint` / `npm run format`.
- `package-lock.json` é commitado.
- **Sem CI no GitHub** (removido por opção). Rodar `npm run lint` e `npm test` localmente/no hook de pré-commit.

## Testes

**637 casos** organizados em 3 categorias (todos passam via `npm test`). O módulo morto `src/crdt`
e seus 4 testes foram removidos na Fase 1 (D2: LWW-por-chegada). Cobertura inclui as Fases 0–6
(hardening, sync multiusuário, config, gazetteer PostGIS, catálogo 3D, multi-org/auditoria, acesso
geográfico) + peças de backend das Fases 7–8 (JWT emissor único, handshake clientId).

| Categoria | Cobertura | Comando |
|-----------|-----------|---------|
| Unit | errors, middleware-*, permission-resolver, require-admin, **config**, **collab-quality** | `npm run test:unit` |
| Integration | atlas*, auth*, features*, images*, maps-briefings, permissions, resources, sharing, sync*, users-admin · **Fase 0**: auth-hardening, rate-limit, sync-validation, images-hardening, health · **Fase 1**: sync-catalog-layer, sync-map-grid-temporal, maps-merge | `npm run test:integration` |
| WebSocket | collab, collab-advanced, collab-broadcasts · **Fase 0**: collab-validation · **Fase 1**: collab-roles, collab-quality | `npm run test:ws` |

**Testes de hardening (Fase 0):** rate limit (429), login timing-safe + mensagem genérica, JWT `alg:none`
rejeitado, reuso de refresh token, revogação de token na troca de senha, validação Joi do `/sync`,
idempotência por `op_id`, rejeição de SVG + magic bytes, cache/304/Range no download de imagem,
health com `SELECT 1`, 404 handler.

**Testes de sync multiusuário (Fase 1):** gridStyle/temporal persistem + snapshot, catalogLayer
por-camada (create/update/delete/snapshot) + dual-mode legado, merge atômico de mapas + caso
negativo cross-atlas, ack `results[]` idempotente, vocabulário de papéis no `connected`, monitor de
qualidade adaptativo.

## Documentação Adicional

- **[README.md](README.md)** - Índice da documentação (raiz do repositório)
- **docs/implementado/01-autenticacao.md** a **docs/implementado/10-config.md** - Guias de integração passo-a-passo
- **[docs/plano/00-visao-geral.md](docs/plano/00-visao-geral.md)** - Plano de implementação consolidado por fases (backend único); comece por `00-visao-geral.md` + `_padroes.md`. **Fases 0–6 implementadas; 7–8 com backend pronto** (gateway/cliente são infra/frontend).
- **[docs/deploy/gateway-360.md](docs/deploy/gateway-360.md)** - Config NGINX do gateway + contrato JWT de emissor único + integração do `ebgeo_360`

## Notas para Desenvolvimento

1. **Sempre use `asyncHandler`** para controllers - evita try/catch repetitivo
2. **Validação com Joi** no middleware, não no controller
3. **Transações** via `tx()` para operações multi-query
4. **Soft-delete** - nunca DELETE real em entidades principais
5. **JSONB** para geometry e properties - mantém formato idêntico ao frontend
6. **Logs estruturados** com Pino - sempre inclua contexto relevante

## Compatibilidade com Frontend

O backend foi adaptado para ser 100% compatível com a estrutura do frontend existente.

### Campos de Mapa
- Usa `center_long` (não `center_lng`) para coordenada de longitude
- Campo `locked` (boolean) - permite travar mapas para edição (assim como layers e groups)

### Operações CRDT
O frontend envia operações no formato:
```javascript
{
  id: UUID,
  entityType: 'feature' | 'map' | 'marker3d' | ...,
  operationType: 'create' | 'update' | 'delete',
  entityId: UUID,
  mapId: UUID | null,
  data: {...},
  timestamp: number,
  clientId: string
}
```

### Snapshot
O snapshot retorna estrutura idêntica ao IndexedDB do frontend:
```javascript
{
  atlas: { id, name, settings, mapOrder, sync: {...} },
  maps: [{
    id, name, center_lat, center_long, zoom, locked, ...,
    features: {
      points: [GeoJSON Feature, ...],
      lines: [...],
      polygons: [...],
      // ... 18 tipos
    },
    cesium3d: {
      cameraPositions: { [tilesetId]: {...} },
      markers: [...],
      measurements: [...],
      viewsheds: [...]
    },
    streetview360: {
      orientations: { [photoName]: {...} },
      markers: [...]
    },
    layers: [...],
    groups: [...],
    sync: {...}
  }],
  briefings: [...],
  currentVersion: number
}
```

### Infraestrutura do Frontend (já preparada)
- `SyncMetadata` em toda entidade
- `OperationFactory` cria operações com `clientId` e `timestamp`
- `OperationDispatcher` com toggle enable/disable
- `EventBus` emite eventos granulares

## Limitações Conhecidas e Gaps para Multiusuário

Baseado na análise completa do documento `docs/acoes-interface-multiusuario.md` do frontend
(**~313 ações em 29 seções** da interface — revisão que adicionou a §29 Módulo Temporal e o
modelo de 4 papéis Owner/Admin/Editor/Viewer). O backend suporta **~95%** das funcionalidades
multiusuário. Plano de resolução dos gaps abertos em **[docs/plano/fase-1-sync-multiusuario.md](docs/plano/fase-1-sync-multiusuario.md)** (e o plano completo do "backend único" em **[docs/plano/00-visao-geral.md](docs/plano/00-visao-geral.md)**).

### Resolvidos (confirmados no código)

| Gap | Solução |
|-----|---------|
| **P0: Atlas delete notifica WS** | `closeRoom()` em `collab.rooms.js` — broadcast `atlas_deleted` + fecha conexões com code 4001 |
| **P0: Mutações REST com broadcast WS** | `updateAtlas` → `atlas_updated`, `updateSettings` → `atlas_settings_updated`, sharing → `sharing_updated`, sync push → `operations`, duplicar mapa → `map_duplicated` |
| **P1: Mover feição entre mapas** | `map_id` adicionado a `UPDATE_FIELDS.feature` em `sync.service.js` |
| **P1: Duplicar mapa individual** | `POST /atlas/:atlasId/maps/:mapId/duplicate` — clona mapa com sub-entidades (layers, groups, features, group_features, cesium3d, streetview360) |
| **P1: Map reorder via WS** | Coberto por `atlas_updated` broadcast no `updateAtlas` (inclui `map_order`) |
| **P2: Awareness de briefing** | Mensagens WS `briefing_edit_start`/`briefing_edit_end` → broadcast `briefing_edit_started`/`briefing_edit_ended` |
| **Exagero de terreno (§24 item 8)** | Persiste em `atlas.settings.terrainExaggeration` (JSONB) — coberto por `PATCH /settings` + broadcast `atlas_settings_updated` |
| **Dados temporais por feição (§29 items 13-20)** | `temporalInicio`, `temporalFim`, `trajetoria`, flags `autoDtg`/`autoDirection`/`autoSpeed`, `dateTimeGroup`, `gdhIni`/`gdhFim` viajam dentro de `properties` (JSONB) numa op `feature` normal — armazenados verbatim, sem mudança no backend |
| **P1: `gridStyle` (§26)** ✅ Fase 1 | Persiste em `maps.grid_style` (migração 007) + `MAP_UPDATE_FIELDS` + snapshot |
| **P1: `catalogLayer` por-camada (§19/§2)** ✅ Fase 1 | Tabela dedicada `catalog_layers` (migração 008) com create/update/delete por id + snapshot `map.catalogLayers`; dual-mode com a coluna legada |
| **P2: Config temporal por mapa (§29)** ✅ Fase 1 (gated) | `maps.temporal_config` (migração 009) + sub-entidade `mapTemporal` + snapshot; aguarda o frontend emitir a op |
| **P3: Combinar mapas / merge (§1.14, §24.3)** ✅ Fase 1 | `POST /atlas/:id/maps/:mapId/merge` — move sub-entidades em transação única |
| **Idempotência de sync** ✅ Fase 0 | `op_id` + `UNIQUE (atlas_id, op_id)` + `ON CONFLICT`; ack `results[]` com `idempotent` |

### Gaps abertos — exigem mudança no backend

| Prioridade | Gap | Ref. Frontend | Descrição |
|-----------|-----|---------------|-----------|
| **P3** | **Sub-canais por mapa** | §Resumo, item 2 | Todas as mensagens WS são broadcast para a room inteira (atlas). Cursor/seleção vão para todos, mesmo quem está em outro mapa. Frontend sugere sub-canais por mapa para reduzir tráfego. |
| **P3** | **Viewport loading no atlas** | §1 | Filtro espacial server-side **indisponível** no schema atlas (feições são JSONB, sem PostGIS). Plano: bbox materializado (colunas + índice) **sob demanda de performance** — ver `docs/plano/fase-1-sync-multiusuario.md` Tarefa 8. Não introduzir PostGIS no schema atlas. |

### Divergências de contrato (documentar/alinhar com frontend)

| Tema | Frontend (`acoes-...`/código) | Backend atual | Implicação |
|------|-------------------------------|---------------|------------|
| **Papéis** | `UserRole = {owner, admin, editor, viewer}` (`session-context.js`); JWT deve carregar `role`; default `viewer` | JWT `role ∈ {user, admin}` (global) + permissão por-atlas `owner/write/read` resolvida à parte (campo `permission` no `connected` do WS e `req.atlasPermission`) | Backend **não** emite `role: editor/viewer`. Mapear: `owner→owner`, `write→editor`, `read→viewer`, `admin (global)→admin`. O frontend deve derivar o papel da `permission` por-atlas, ou o backend passar a expor o vocabulário editor/viewer. |
| **`locked` (mapa/camada/grupo/feição)** | Bloqueio desabilita edição; vários itens "Respeita bloqueio de mapa" / "Permissão de admin ou owner do mapa" | `locked` é só uma coluna mutável; **o sync nunca bloqueia escrita** numa entidade travada | Bloqueio é **advisory (frontend-only)**. Não há tier "admin do mapa" — permissão é por-atlas (`write`). |

### Não requer mudança no backend

| Item | Ref. Frontend | Justificativa |
|------|---------------|---------------|
| **Undo/Redo (Ctrl+Z/Y)** | §16 items 1,2 | 100% no frontend. Gera operações inversas e envia via sync normal. Backend já suporta create↔delete e update com dados anteriores. Pilha de undo/redo é local por usuário. |
| **Operações locais (~144 ações, 46%)** | Todas as seções | Zoom, pan, seleção, ferramentas, exportação, navegação, deep-link/URL (§27), Garmin KMZ (§6 items 9-10), cursor/reprodução temporal (§29 items 2-7), configurações locais — sem impacto no servidor. |
| **Operações batch** | §2 items 13-14,19,23 | Multi-seleção (ocultar/bloquear), deletar feições de tileset/foto — múltiplas ops sync individuais. Backend já suporta array de operações. |
| **Reagendamento temporal (§29 item 12)** | §29 | Shift temporal em massa = batch de ops `feature` (atualiza `temporalInicio`/`temporalFim`/`trajetoria` em `properties`). O frontend calcula os deltas e envia o batch. *Obs.:* a parte de limites/origem do mapa depende da config temporal por mapa (gap P2 acima). |
| **Operações de split/merge de geometrias** | §14 items 10,11,12 | Combinar/separar setas, cortar linha — frontend gera ops CRDT (create+delete). |
| **Importação de arquivos geoespaciais** | §5 items 1-8 | GeoJSON, Shapefile, KML/KMZ, GPX, CSV, pontos por coordenadas — parsing no frontend, que envia ops sync com as feições resultantes (tracks com tempo viram pontos móveis). |

### Estatísticas do Frontend (Ref: acoes-interface-multiusuario.md, rev. 29 seções)

| Categoria | Total | Local | Sync Simples | Destrutivo |
|-----------|-------|-------|--------------|------------|
| **TOTAL** | **~313** | **~144 (46%)** | **~154 (49%)** | **~15 (5%)** |

**~46% das ações são puramente locais** (sem sync) · **~49% precisam de sync simples** (broadcast + LWW) · **~5% são destrutivas** (soft-delete + permissão + broadcast).

**Nenhuma ação requer lock.** Toda resolução de conflito é last-write-wins com timestamp.
