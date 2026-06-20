# 00 - Visão Geral (arquitetura as-built)

Este documento é o **mapa de entrada** da integração frontend-backend do EBGeo. Descreve, em alto
nível, o que o backend único entrega ao frontend, como os subsistemas se encaixam e onde encontrar o
detalhe de cada um. Os contratos concretos (request/response por endpoint) ficam nos docs numerados a
seguir.

---

## O que o backend entrega

O `ebgeo_backend` é o **backend único** do ecossistema EBGeo: um monólito modular Express +
PostgreSQL/PostGIS (JS puro) que adiciona, ao app de mapeamento local-first, tudo que precisa de
servidor:

- **Autenticação** JWT (access + refresh) de emissor único, com identidade org-scoped.
- **Atlas colaborativo** — atlas/maps/features (18 tipos) em JSONB, layers, groups, briefings, slides.
- **Sincronização** offline-first: snapshot + operações CRDT (LWW por ordem de chegada) com log.
- **Colaboração em tempo real** via WebSocket (presença, cursores, ops, awareness).
- **Imagens** (upload/download com magic-bytes, ETag, Range) e **compartilhamento** (links públicos + sharing por usuário).
- **Config dinâmico** (`GET /api/config`) — o `config.js` do frontend servido pelo servidor.
- **Gazetteer PostGIS** (nomes geográficos), **catálogo 3D + distribuição de assets**, **multi-org/identidade/auditoria**, **controle de acesso geográfico** e **StreetView 360** (módulo `sv360`).

> **Constraint fundamental:** o backend é **aditivo**. A aplicação funciona **idêntica** para o
> usuário não autenticado (offline, IndexedDB local), e os contratos que o frontend já consome
> (`config.js`, busca de nomes, metadado de foto 360, envelope de operação de sync) permanecem
> **congelados**. Onde houver contrato congelado, o doc específico marca com um aviso.

---

## Arquitetura

```
  ebgeo_web (SPA, local-first IndexedDB)
        |  REST (metadados, sharing, imagens) · Sync API (ops CRDT) · WebSocket (colaboração)
        v
  [ NGINX (reverse proxy + TLS) ]   ← um único upstream
        |
        v
  +-------------------------------------------------------------+
  | BACKEND ÚNICO — Express + pg-promise + ws (JS puro)         |
  |  auth (JWT emissor único + refresh)  users/organizations    |
  |  atlas/maps/features  layers/groups  briefings/slides       |
  |  sync (LWW + log)  collab (WebSocket)  resources/images     |
  |  config (GET /api/config)                                   |
  |  nomes (gazetteer PostGIS)                                  |
  |  catalogo3d + assets3d (BLOB SQLite/FS)                     |
  |  zones (acesso geográfico)                                  |
  |  sv360 (StreetView 360, BLOB SQLite por projeto)           |
  +----------------------------+--------------------------------+
                               |
                               v
        PostgreSQL + PostGIS (UM banco, schemas isolados)
          public/atlas:  JSONB   (atlas, maps, features.geometry, operations)
          ng:            PostGIS  (nomes_geograficos, edificacoes, catalogo_3d, zonas)
          sv360:         PostGIS  (projects, photos[geom], targets) + {slug}.db (BLOBs WebP)
```

A maioria das caixas de módulo é um diretório em `src/modules/<nome>/` com fronteiras rígidas (rotas →
controller → service → queries → schemas). Algumas caixas lógicas do diagrama vivem dentro de um módulo maior (ex.: `catalogo3d`/`assets3d` ficam em `nomes/`; `features`/`layers`/`groups`/`slides` são manipulados via `sync`/`atlas`, sem diretório próprio). O diretório do 360 chama-se `streetview360/` (montado em `/api/v1/sv360`). O detalhe das convenções está no
[README §Convenções de Engenharia](../../README.md#convenções-de-engenharia).

### Quem fala com o quê

| Tipo de dado | API |
|--------------|-----|
| Atlas (metadados), compartilhamento, imagens | REST |
| Features, layers, groups, maps, briefings, slides, 3D, 360 (do atlas) | **Sync / WebSocket** (escrita só via sync) |
| Nomes geográficos, catálogo 3D, panoramas 360 | REST read-only (PostGIS) |

### Modos de operação (do ponto de vista do frontend)

1. **Offline** — sem backend; dados locais no IndexedDB. Tudo funciona.
2. **Autenticado** — login, sync com o servidor, colaboração em tempo real.
3. **Público** — link público, somente leitura, token temporário (1h) para REST e WebSocket.

---

## Decisões de arquitetura

Estas decisões moldam o que o frontend pode (e não pode) esperar do backend.

| # | Decisão | Como ficou |
|---|---------|------------|
| **D1** | Colaboração em tempo real | **Disponível.** Motor de sync + idempotência + ack + monitor de qualidade + handshake `clientId` + presença `away`/`back` implementados e testados. O cliente WebSocket é responsabilidade do frontend. Ver [04 - WebSocket Colaboração](./04-websocket-collab.md). |
| **D2** | Modelo de conflito do sync | **LWW por ordem de chegada ao servidor** (NÃO por timestamp) + idempotência por `op_id` do cliente. Delete (soft) vence updates subsequentes na ordem de chegada. Ver [05 - Sync CRDT](./05-sync-crdt.md). |
| **D3** | StreetView 360 | **Absorvido** como módulo `sv360` (não é mais microsserviço separado; não há upstream `:8081`). BLOBs WebP em SQLite por projeto, com ETag O(1)/304/Range/semáforo. Ver [16 - StreetView 360](./16-streetview-360.md). |
| **D4** | Stack | **JS puro** (Node 20, ES Modules) — aproveita a suíte de testes existente. |
| **D5** | UI de administração | **Projeto frontend separado** (`ebgeo_web_2_admin`); o backend só **provê os endpoints** (multi-org, auditoria, zonas, ingestão 360, gerência de usuários/resources). Ver [12 - Multi-org / Identidade](./12-multiorg-identidade-auditoria.md). |

**Princípios mantidos:** JSONB (atlas) e PostGIS (`ng`/`sv360`) coexistem **isolados por schema** —
PostGIS é aditivo e não converteu o schema do atlas; **identidade única** (um emissor de JWT com
`sub`/`role`/`organization_id`/`org_role`); **BLOB pesado** (3D, 360) vive em SQLite/arquivo, com o
Postgres guardando metadados/ponteiro.

---

## Índice da documentação

Comece pelo guia que cobre o subsistema que você vai integrar. Cada doc traz endpoint, request,
response e notas de integração.

| # | Documento | O que cobre |
|---|-----------|-------------|
| 01 | [Autenticação](./01-autenticacao.md) | Login, registro, refresh token, logout, JWT |
| 02 | [Atlas Básico](./02-atlas-basico.md) | CRUD de atlas, listagem, permissões por atlas |
| 03 | [Sync Inicial](./03-sync-inicial.md) | Pull inicial, snapshot vs operações, carregamento no IndexedDB |
| 04 | [WebSocket Colaboração](./04-websocket-collab.md) | Conexão WS, mensagens, presença, cursores |
| 05 | [Sync CRDT](./05-sync-crdt.md) | Push/pull de operações, envelope, resolução LWW |
| 06 | [Presença e Imagens](./06-presenca-imagens.md) | Cursor/seleção; upload/download de imagens |
| 07 | [Compartilhamento](./07-compartilhamento.md) | Links públicos, sharing com usuários |
| 08 | [Offline e Import](./08-offline-import.md) | Modo offline, reconexão, import bulk de atlas |
| 09 | [Administração](./09-admin.md) | Gerência de usuários e resources (admin) |
| 10 | [Configuração (`config.js`)](./10-config.md) | `GET /api/config` — config dinâmico do frontend |
| 11 | [Segurança e Hardening](./11-seguranca-hardening.md) | Rate limit, JWT, validação de upload, helmet, health |
| 12 | [Multi-org / Identidade / Auditoria](./12-multiorg-identidade-auditoria.md) | Organizações, API keys, auditoria, identidade org-scoped |
| 13 | [Nomes Geográficos (Gazetteer)](./13-nomes-geograficos.md) | Busca de topônimos, clique 3D em edificação, catálogo 3D |
| 14 | [Catálogo 3D e Assets](./14-catalogo3d-assets.md) | Distribuição de assets 3D imutáveis + integração Cesium |
| 15 | [Acesso Geográfico](./15-acesso-geografico.md) | Zonas de acesso, `access_level`, filtro embutido no SQL |
| 16 | [StreetView 360](./16-streetview-360.md) | Projetos/fotos/targets, imagem WebP, calibração, tiles, ingestão |
| 99 | [Pendências e Desvios](./99-pendencias-e-desvios.md) | Gaps abertos, divergências de contrato e follow-ups (por criticidade) |

> Os padrões de engenharia (template de módulo, erro/validação/transação, migração, segurança,
> testes/DoD) ficam no [README §Convenções de Engenharia](../../README.md#convenções-de-engenharia).
> O guia operacional completo está em [../deploy/deploy.md](../deploy/deploy.md).

---

## Convenções de contrato (válidas para todos os docs)

Antes de mergulhar num subsistema, conheça as três regras transversais:

**1. Envelope de resposta.** A maioria das rotas responde:

```json
{ "data": { "..." } }                                    // sucesso
{ "error": { "code": "NOT_FOUND", "message": "..." } }   // erro
```

Exceções (contrato congelado): as rotas do **`sv360`** respondem **nuas** (objeto/array, sem `data`) e
usam envelope de erro **plano** `{ "error": "..." }`; `GET /nomes/busca` responde um **array nu**.

**2. Autenticação.** O access token vai no header `Authorization: Bearer <accessToken>`. Quando a
resposta for `401`, renove via `POST /auth/refresh` e repita. Rotas públicas (`GET /api/config`,
`GET /atlas/public/:link`, gazetteer/assets/360 de leitura) aceitam o caminho anônimo. Ver
[01 - Autenticação](./01-autenticacao.md).

**3. Permissões.** Por atlas, a hierarquia é `owner` > `write` > `read` (resolvida em waterfall:
owner → share → público → 403). Roles globais são `user` e `admin`. A identidade org-scoped do JWT
(`organization_id` + `org_role ∈ {owner, editor, viewer, admin}`) governa os subsistemas multi-org
(13/14/15). Para acesso a dados geográficos, a autorização é **embutida na query SQL** (um privado só
aparece para admin, permissão direta ou geometria contida numa zona do usuário).

---

## Referências

- [README.md](../../README.md) — referência completa: rotas, env, migrações, permissões, protocolo WS, convenções de engenharia.
- [../deploy/deploy.md](../deploy/deploy.md) — guia de deploy do backend único (build, env, migrações, stores/volumes, NGINX, health, backup) + contrato JWT de emissor único.
- `CLAUDE.md` (raiz) — contexto curto para agentes: mapa do código, rotas, migrações e decisões correntes.
