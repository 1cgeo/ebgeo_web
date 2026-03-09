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
- `mapPosition` - Viewport (center_lat, center_long, zoom, bearing, pitch)
- `baseLayer` - Camada base do mapa
- `mapNotes` - Notas do mapa
- `gridStyle` - Estilo de grade
- `catalogLayer` - Camadas do catálogo

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

### Migrações
Arquivos em `src/database/migrations/` executados em ordem alfabética.
Tracking via tabela `_migrations`.

| Migração | Descrição |
|----------|-----------|
| 001_core.sql | Extensão pgcrypto, tabela users (campos militares BR), refresh_tokens |
| 002_atlas.sql | Atlas, maps, layers, groups, features (18 tipos), group_features, cesium3d_data, streetview360_data, images, briefings, slides, trigger mark_slides_broken_on_map_delete |
| 003_sync.sql | Operations (CRDT log), active_sessions, resources, trigger update_atlas_current_version, seed de recursos |
| 004_map_locked.sql | Adiciona campo `locked` (BOOLEAN DEFAULT FALSE) à tabela maps |

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
- `operation`, `operations` - CRDT ops
- `sync_request`/`sync_response` - Sync via WS
- `user_joined`, `user_left` - Eventos de sala
- `atlas_updated`, `atlas_deleted`, `atlas_settings_updated` - Mutações REST broadcast
- `sharing_updated` - Alterações de compartilhamento broadcast
- `briefing_edit_start`/`briefing_edit_end` → `briefing_edit_started`/`briefing_edit_ended` - Awareness

## CRDT

- **Last-Writer-Wins (LWW)** por entidade
- Timestamp como comparador principal
- ClientId como tiebreaker
- Delete sempre vence sobre update

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

### Health Check
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| GET | `/api/v1/health` | Health check | Não | - |

### Auth
| Método | Rota | Descrição | Auth | Permissão |
|--------|------|-----------|------|-----------|
| POST | `/api/v1/auth/register` | Auto-cadastro | Não | - |
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

## Testes

25 arquivos de teste organizados em 3 categorias:

| Categoria | Arquivos | Comando |
|-----------|----------|---------|
| Unit (4) | crdt-merger, crdt-resolver, permission-resolver, sync-operations | `npm run test:unit` |
| Integration (19) | atlas, atlas-import, auth, features, images, permissions, resources, sharing, sync, sync-3d-data, sync-advanced, sync-briefing-ops, sync-feature-map-move, sync-feature-ops, sync-frontend-format, sync-group-ops, sync-layer-ops, sync-map-ops, users-admin | `npm run test:integration` |
| WebSocket (2) | collab, collab-broadcasts | `npm run test:ws` |

## Documentação Adicional

- **[docs/README.md](docs/README.md)** - Índice da documentação
- **docs/01-autenticacao.md** a **docs/09-admin.md** - Guias de integração passo-a-passo

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

Baseado na análise completa do documento `docs/acoes-interface-multiusuario.md` do frontend (277 ações em 28 seções da interface). O backend suporta ~97% das funcionalidades multiusuário.

### Resolvidos

| Gap | Solução |
|-----|---------|
| **P0: Atlas delete notifica WS** | `closeRoom()` em `collab.rooms.js` — broadcast `atlas_deleted` + fecha conexões com code 4001 |
| **P0: Mutações REST com broadcast WS** | `updateAtlas` → `atlas_updated`, `updateSettings` → `atlas_settings_updated`, sharing → `sharing_updated`, sync push → `operations` |
| **P1: Mover feição entre mapas** | `map_id` adicionado a `UPDATE_FIELDS.feature` em `sync.service.js` |
| **P1: Duplicar mapa individual** | `POST /atlas/:atlasId/maps/:mapId/duplicate` — clona mapa com sub-entidades (layers, groups, features, group_features, cesium3d, streetview360) |
| **P1: Map reorder via WS** | Coberto por `atlas_updated` broadcast no `updateAtlas` (inclui `map_order`) |
| **P2: Awareness de briefing** | Mensagens WS `briefing_edit_start`/`briefing_edit_end` → broadcast `briefing_edit_started`/`briefing_edit_ended` |

### P3 — Otimizações futuras

| Gap | Ref. Frontend | Descrição | Impacto |
|-----|---------------|-----------|---------|
| **Sub-canais por mapa** | §Resumo, item 2 | Todas as mensagens WS são broadcast para a room inteira (atlas). Cursor e seleção são enviados para todos, mesmo quem está em outro mapa. Frontend sugere sub-canais por mapa para otimizar tráfego. | Tráfego desnecessário em atlas com muitos mapas e usuários. |
| **Combinar mapas (merge)** | §1 item 14; §24 item 3 | Não há endpoint para mover feições de múltiplos mapas para um mapa destino atomicamente. | "Puxar outros mapas" na sidebar e modal de combinação ficam sem backend. |

### Não requer mudança no backend

| Item | Ref. Frontend | Justificativa |
|------|---------------|---------------|
| **Undo/Redo (Ctrl+Z/Y)** | §16 items 1,2 | Implementável 100% no frontend. O frontend gera operações inversas e envia via sync normal. O backend já suporta create↔delete e update com dados anteriores. Pilha de undo/redo é local por usuário. |
| **Operações locais (~137 ações, 49%)** | Todas as seções | Zoom, pan, seleção, ferramentas, exportação, navegação, configurações locais — ações puramente locais sem impacto no servidor. |
| **Operações batch** | §2 items 13-14,19,23 | Multi-seleção (ocultar/bloquear), deletar feições de tileset/foto — resolvidas enviando múltiplas operações sync individuais. Backend já suporta array de operações. |
| **Operações de split/merge de geometrias** | §14 items 10,11,12 | Combinar/separar setas, cortar linha — resolvidas pelo frontend gerando operações CRDT (create+delete). |
| **Importação de arquivos geoespaciais** | §5 items 1-7 | GeoJSON, Shapefile, KML, GPX, CSV — parsing é feito no frontend, que envia operações sync com as feições resultantes. |

### Estatísticas do Frontend (Ref: acoes-interface-multiusuario.md)

| Categoria | Total | Local | Sync Simples | Destrutivo |
|-----------|-------|-------|--------------|------------|
| **TOTAL** | **~277** | **~137 (49%)** | **~125 (45%)** | **~15 (6%)** |

**Nenhuma ação requer lock.** Toda resolução de conflito é last-write-wins com timestamp.
