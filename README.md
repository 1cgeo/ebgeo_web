# Documentação EBGeo Backend

Guia de integração frontend-backend para o EBGeo.

---

## Estrutura da Documentação

A pasta `docs/` está separada em **dois grupos**:

- **`docs/implementado/`** — guias de integração das funcionalidades **já implementadas e verificadas no código**.
- **`docs/pendente/`** — análise de gaps e documentos de **roadmap** (ainda **não** implementados neste backend).

### ✅ Implementado — `docs/implementado/`

Guias de integração frontend-backend, em ordem de implementação recomendada:

| # | Documento | Descrição | Linhas |
|---|-----------|-----------|--------|
| 01 | [Autenticação](./docs/implementado/01-autenticacao.md) | Login, registro, refresh token, logout | ~300 |
| 02 | [Atlas Básico](./docs/implementado/02-atlas-basico.md) | CRUD de atlas, permissões | ~350 |
| 03 | [Sync Inicial](./docs/implementado/03-sync-inicial.md) | Pull inicial, snapshot, carregamento | ~400 |
| 04 | [WebSocket Colaboração](./docs/implementado/04-websocket-collab.md) | Conexão WS, mensagens, presença | ~450 |
| 05 | [Sync CRDT](./docs/implementado/05-sync-crdt.md) | Operações CRDT, push/pull HTTP | ~500 |
| 06 | [Presença e Imagens](./docs/implementado/06-presenca-imagens.md) | Cursores, seleção, upload de imagens | ~400 |
| 07 | [Compartilhamento](./docs/implementado/07-compartilhamento.md) | Links públicos, sharing com usuários | ~450 |
| 08 | [Offline e Import](./docs/implementado/08-offline-import.md) | Modo offline, reconexão, upload de atlas | ~500 |
| 09 | [Administração](./docs/implementado/09-admin.md) | Gerenciamento de usuários e resources | ~550 |
| 10 | [Configuração (config.js)](./docs/implementado/10-config.md) | Cobertura do `config.js` do frontend pelo backend (basemaps, tilesets, config global) | ~280 |

### 🚧 Pendente / Não implementado — `docs/pendente/`

**Gaps da colaboração atual:**

| # | Documento | Descrição |
|---|-----------|-----------|
| 11 | [Gaps Multiusuário](./docs/pendente/11-gaps-multiusuario.md) | Cruzamento §1–§29 das ações da interface vs. backend; gaps abertos (`gridStyle`, `catalogLayer`, config temporal, merge de mapas) |

**Roadmap "backend único"** (análises de 2026-06-14, descrevem trabalho **futuro** — nada implementado neste backend):

| Documento | Descrição |
|-----------|-----------|
| [AVALIACAO-REAPROVEITAMENTO](./docs/pendente/AVALIACAO-REAPROVEITAMENTO.md) | Decisão: aproveitar o `ebgeo_backend` como núcleo vs. reescrever do zero |
| [IDEIAS-EBGEO-WEB-2](./docs/pendente/IDEIAS-EBGEO-WEB-2.md) | Padrões a minerar das tentativas antigas (`ebgeo_web_2_*`) |
| [SERVICO-NOMES-GEOGRAFICOS](./docs/pendente/SERVICO-NOMES-GEOGRAFICOS.md) | Plano de absorção do serviço de nomes geográficos (PostGIS) |
| [EBGEO-360](./docs/pendente/EBGEO-360.md) | Análise/integração do microsserviço de panoramas 360 |
| [PROTOTIPO-COLABORACAO-TEMPO-REAL](./docs/pendente/PROTOTIPO-COLABORACAO-TEMPO-REAL.md) | Ideias do protótipo de colaboração em tempo real |

---

## Visão Geral

### Constraint Fundamental

> A aplicação DEVE funcionar identicamente para usuários não autenticados. O backend é aditivo.

O frontend deve continuar funcionando completamente offline, usando IndexedDB local. O backend adiciona:
- Persistência centralizada
- Colaboração em tempo real
- Compartilhamento entre usuários

### Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │  IndexedDB   │  │  REST Client │  │  WebSocket Client  │    │
│  │  (offline)   │  │  (metadata)  │  │  (real-time sync)  │    │
│  └──────────────┘  └──────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │  REST API    │  │  Sync API    │  │  WebSocket Server  │    │
│  │  (atlas,     │  │  (CRDT ops)  │  │  (collab, presence)│    │
│  │   sharing)   │  │              │  │                    │    │
│  └──────────────┘  └──────────────┘  └────────────────────┘    │
│                              │                                  │
│                       ┌──────────────┐                         │
│                       │  PostgreSQL  │                         │
│                       └──────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

### Divisão de Responsabilidades

| Tipo de Dado | API | Observação |
|--------------|-----|------------|
| Atlas metadata | REST | Nome, descrição, configurações |
| Compartilhamento | REST | Links públicos, permissões |
| Imagens | REST | Upload/download de arquivos |
| Features, Layers, Groups | **Sync/WebSocket** | Dados colaborativos |
| Maps, Briefings, Slides | **Sync/WebSocket** | Dados colaborativos |

---

## Modos de Operação

1. **Modo Offline** - Sem backend, dados locais no IndexedDB
2. **Modo Autenticado** - Login, sync com servidor, colaboração
3. **Modo Público** - Link público, somente leitura, token temporário

---

## Credenciais de Teste

Após rodar `npm run db:seed`:

| Usuário | Senha | Role |
|---------|-------|------|
| `admin` | `admin123` | admin |
| `cap.silva` | `test123` | user |

---

## Variáveis de Ambiente

```javascript
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const WS_BASE_URL = process.env.WS_URL || 'ws://localhost:3000';
```

---

## Checklist Geral de Implementação

### Fase 1: Autenticação
- [ ] Formulário de login
- [ ] Formulário de registro
- [ ] Armazenamento de tokens
- [ ] Refresh automático
- [ ] Logout

### Fase 2: Atlas Básico
- [ ] Listagem de atlas
- [ ] Criação de atlas
- [ ] Edição/deleção

### Fase 3: Sync e WebSocket
- [ ] Pull inicial (snapshot)
- [ ] Conexão WebSocket
- [ ] Envio/recebimento de operações

### Fase 4: Colaboração
- [ ] Cursores remotos
- [ ] Seleção de features
- [ ] Lista de usuários online

### Fase 5: Upload de Imagens
- [ ] Upload de imagem
- [ ] Feature de imagem
- [ ] Download/cache

### Fase 6: Compartilhamento
- [ ] Links públicos
- [ ] Compartilhar com usuários
- [ ] Modo somente leitura

### Fase 7: Offline/Import
- [ ] Operações pendentes
- [ ] Reconexão
- [ ] Upload de atlas offline

### Fase 8: Administração
- [ ] Gerenciamento de usuários
- [ ] Gerenciamento de resources

---

## Gaps Conhecidos do Backend

Gaps identificados ao cruzar as ações da interface do frontend (`acoes-interface-multiusuario.md`,
rev. ~313 ações / 29 seções) com o backend atual. Análise completa em
[docs/pendente/11-gaps-multiusuario.md](./docs/pendente/11-gaps-multiusuario.md) e no `CLAUDE.md`
(seção "Limitações Conhecidas e Gaps para Multiusuário").

### Resolvidos (confirmados no código)

| Prioridade | Gap | Solução |
|-----------|-----|---------|
| **P0** | Atlas delete não desconectava clientes WS | `closeRoom()` → broadcast `atlas_deleted` + close code 4001 |
| **P0** | Mutações REST sem broadcast WS | `atlas_updated`, `atlas_settings_updated`, `sharing_updated`, `operations`, `map_duplicated` |
| **P1** | Mover feição entre mapas via sync | `map_id` em `UPDATE_FIELDS.feature` |
| **P1** | Duplicar mapa individual | `POST /atlas/:id/maps/:mapId/duplicate` + broadcast `map_duplicated` |
| **P1** | Map reorder broadcast via WS | Coberto por `atlas_updated` (inclui `map_order`) |
| **P2** | Awareness de briefing | `briefing_edit_start/end` → `briefing_edit_started/ended` |

### Gaps abertos

| Prioridade | Gap | Status |
|-----------|-----|--------|
| **P1** | `gridStyle` (§26 Grade UTM) é no-op — sem coluna de grade em `maps` | Pendente |
| **P1** | `catalogLayer` (§19/§2) — frontend emite ops por-camada; backend espera array no `maps.catalog_layers` | Pendente |
| **P2** | Config temporal por mapa (§29) — sem coluna `temporal_config`; frontend ainda não emite op de sync | Pendente |
| **P3** | Sub-canais WS por mapa (otimização de tráfego) | Pendente |
| **P3** | Combinar mapas / merge atômico (§1.14, §24.3) | Pendente (contornável por batch) |
| N/A | Undo/Redo (§16) | Frontend (backend já suporta as ops inversas) |
| N/A | Dados temporais por feição (§29 items 13-20) | OK — viajam em `properties` (JSONB) |

**Divergências de contrato:** papéis do frontend (`owner/admin/editor/viewer`) vs. backend
(`owner/write/read` por-atlas + `user/admin` global); `locked` é advisory (não bloqueia escrita no servidor).

**~95% das funcionalidades multiusuário já estão implementadas no backend.**
