# Fase 7 — Gateway e integração do `ebgeo_360` (separado, JWT unificado)

> **✅ STATUS: PRONTA (lado backend).** Esta fase **não escreve código de domínio** — é infra (NGINX) +
> alinhamento de claims (Fase 5) + docs. **Entregue:** (a) o token de emissor único já carrega
> `sub/role/organization_id/org_role/username` e ganhou **aliases `org`/`login`** para o 360 consumir
> sem mudar (`issueAccessToken`); (b) **config de gateway NGINX + contrato do 360 + dualidade de
> backup** documentados em [`docs/deploy/gateway-360.md`](../../docs/deploy/gateway-360.md); (c) padrões
> de engenharia do 360 (ETag O(1)/304/Range/immutable; dummy-hash anti-timing) já carregados nas
> Fases 0/4. **Externo:** subir o NGINX, backfill de `projects.organization_id` (org-legacy→UUID) e
> apontar `SV360_SERVICE_URL` para o gateway são tarefas de deploy.
> **Leia antes:** [`_padroes.md`](_padroes.md) (template de módulo, DoD, segurança) e
> [`00-visao-geral.md`](00-visao-geral.md) (arquitetura-alvo, decisão D3).
> **Depende de:** **fase-5** (multi-org / identidade única) concluída.
> **Esforço:** Médio. **Risco:** Médio (mexe em infra de deploy e contrato com o `ebgeo_web`).

---

## 1. Objetivo e contexto

Manter o `ebgeo_360` como **microsserviço autônomo** (Fastify 5 + better-sqlite3 + Sharp,
container 512 MB) **atrás de um gateway NGINX**, unificando **apenas o JWT** (mesmo emissor,
mesmo segredo, mesmos claims) com o backend único da fase-5. **Não absorver** os 41 GB de BLOB
WebP para o Postgres. **Não mudar o schema do 360.** Preservar o contrato de API que o
`ebgeo_web` já consome (viewer Three.js, calibração, ETag de imagem).

**Por que separado (decisão D3 já tomada, ver `00-visao-geral.md` §4):**

- **41 GB de WebP imutável** servidos com `mmap` + `Range 206` + `Cache-Control: immutable` a
  partir de SQLite readonly. Mover para `bytea`/Large Object no Postgres só adiciona overhead
  (TOAST, WAL inchado, `VACUUM`, replicação de 41 GB) **sem ganho**: BLOB imutável servido por
  chave não precisa de transação relacional, junção nem consulta. SQLite com `page_size 65536` +
  `mmap` é mais rápido e mais barato em RAM que o mesmo em Postgres.
- **Acoplamento de domínio fraco.** O 360 só precisa saber **"quem é o usuário e a que OM
  pertence"** — exatamente o que o JWT carrega. Nada mais.
- **O ecossistema já é multi-serviço de fato.** O `ebgeo_web` já consome 3 endereços distintos:
  `search.apiUrl` (:3001), `streetView360.serviceUrl` (:8081) e PMTiles (:3000). O gateway só
  **formaliza** esse padrão; não o cria.

**Estado real do 360 em produção (volume medido, fonte de verdade):** 22 projetos (todos
`enabled`, todos em `org-legacy`), 1 OM, **0 usuários** (multi-org migrado mas ainda operado
como operador único), 72.098 fotos, 461.453 targets, ~41 GB somados em 22 `{slug}.db` (maiores:
`alegrete.db` 8,6 GB, `santana_livramento.db` 8,4 GB, `uruguaiana.db` 5,7 GB, `aman.db` 3,4 GB),
`index.db` = 208 MB. Auth do 360: `@fastify/jwt`, payload `{sub, org, role, login}`, expiração
12h, senha `scrypt` com dummy-hash anti-timing, rate-limit de login 10/min.

> **Nota importante de escopo:** esta fase **não escreve código de domínio no monólito**. O grosso
> do trabalho é **configuração** (NGINX, docker-compose, `.env`), **alinhamento de claims** (que o
> token emitido na fase-5 case com o que o 360 espera) e **documentação** (backup, contrato a não
> quebrar). A única produção de código de aplicação possível está nas Tarefas 6–7 (carregar os
> padrões de engenharia do 360 para o resto do backend — opcional e desacoplável). O documento é
> deliberadamente prescritivo nos artefatos de infra para que um agente sem acesso aos docs-fonte
> consiga implementar.

---

## 2. Pré-requisitos / dependências de outras fases

| Pré-requisito | Vem de | O que precisa estar pronto |
|---------------|--------|----------------------------|
| **Claim de org no JWT** | fase-5 | O token de acesso emitido pelo backend único carrega `organization_id` (ou equivalente) no payload, além de `sub` e `role`. |
| **Emissor único de token** | fase-5 | Há **um** provedor de identidade (o backend único) que assina todos os tokens com **um** `JWT_SECRET`. O 360 deixa de emitir seus próprios tokens de usuário no fluxo unificado (ver Tarefa 3, ramo recomendado). |
| **Entidade `organizations` + mapeamento de OMs** | fase-5 | Existe a tabela `organizations` com `slug`/`id` por OM. É a base para mapear `org` (slug usado pelo 360) ↔ `organization_id` (UUID do backend único). |
| **`JWT_SECRET` com entropia validada** | fase-0 + fase-5 | Segredo HS256 ≥ 32 chars em produção, validado no boot (`validateEnvVariables`). |

**Bloqueio:** sem a fase-5, não há claim de org nem emissor único — esta fase **não pode**
começar de forma significativa. O gateway NGINX (Tarefa 4) pode ser prototipado antes, mas o
alinhamento de identidade (Tarefas 1–3) exige a fase-5.

---

## 3. Decisões de arquitetura aplicáveis

### 3.1 Unificar SÓ o JWT (não fundir processos, não mover BLOB)

O 360 e o backend único compartilham exatamente **um** artefato: o JWT. O 360 **só verifica**
o token com a mesma chave/claims; não emite token de usuário no fluxo unificado.

```
  ebgeo_web (SPA)
        |  Authorization: Bearer <jwt emitido pelo backend único>
        v
  [ NGINX gateway ]
   /api/v1/atlas..., /api/config, /api/v1/nomes...  --> backend único  (:3000)
   /api/v1/photos, /projects, /tiles, /pmtiles,
   /admin, /calibration                            --> ebgeo_360       (:8081)
        (repassa o header Authorization sem reescrever)
```

### 3.2 Mapeamento de claims (o coração da fase)

O 360 espera o payload `{sub, org, role, login}`. O backend único (fase-5) emite
`{sub, username, nome, posto, role, organization_id, ...}` (ver `auth.service.js:34-46`,
`generateAccessToken`). O alinhamento:

| Claim que o 360 lê | Origem no token do backend único | Regra de mapeamento |
|--------------------|-----------------------------------|---------------------|
| `sub` | `sub` (user id) | Idêntico. |
| `org` | `organization_id` (UUID da fase-5) | **O 360 usa `org` = `organization_id` do projeto** (`canWriteProject`: `user.org === project.organization_id`). O 360 deve passar a comparar `org` contra o `organization_id` que ele guarda. **Decisão de mapeamento abaixo.** |
| `role` | `role` (`user`/`admin` global) | Mapear: `admin` (global) → `system_admin`; `user` com permissão de escrita na OM → `om_data_admin`; demais → leitura (auth opcional). |
| `login` | `username` | Renomear `username` → `login`, **ou** o 360 passa a ler `username`. |

**Decisão de mapeamento de `org` (recomendação):** alinhar o **identificador**. Hoje o `org`
do 360 e o `organization_id` do projeto são valores próprios do SQLite (`index.db`). Para o JWT
unificado funcionar, o `organization_id` que o 360 grava em `projects.organization_id` **deve ser
o mesmo identificador** que o backend único coloca no claim `org`/`organization_id`. Há dois
ramos:

- **(A) Reusar o UUID do backend único como `organization_id` do 360 (recomendado).** Na ingestão/
  migração do 360, gravar em `projects.organization_id` o **UUID da `organizations` da fase-5**
  (mapeado por `slug`). O claim `org` passa a ser esse UUID. Zero tradução em runtime, sem mudança
  de tipo de coluna (SQLite é dinâmico). **Custo:** um backfill único de `org-legacy` → UUID real.
- **(B) Tabela de tradução no 360 (`org_slug` ↔ `organization_id` externo).** Mais flexível, mas
  adiciona uma indireção e um ponto de divergência. **Só se** o 360 precisar manter seus próprios
  ids por motivo de deploy offline.

> **Princípio:** a fase deve preferir (A). O `EBGEO-360.md` é explícito: *"Zero mudança de schema
> do 360"* — (A) respeita isso (só altera **valores** de `organization_id`, não a estrutura).

### 3.3 Roles: vocabulários diferentes, mapeamento explícito

- Backend único: `role ∈ {user, admin}` (global) + permissão por-atlas resolvida à parte.
- 360: `role ∈ {system_admin, om_data_admin}` + posse por OM (`canWriteProject`/`canReadProject`).
- O 360 trata **leitura como auth opcional** (`tryAuthenticate`): catálogo `enabled` é público.
  Logo, o mapeamento de role só importa para **escrita/calibração/admin**.

| `role` (backend único) | `role` para o 360 | Capacidade no 360 |
|------------------------|-------------------|-------------------|
| `admin` | `system_admin` | Escreve em qualquer OM, gere OMs/usuários. |
| `user` (com escrita na própria OM) | `om_data_admin` | Escreve só na própria OM (`user.org === project.organization_id`). |
| `user` (sem escrita) / anônimo | — (sem token de escrita) | Só leitura do catálogo `enabled`. |

### 3.4 Não absorver — e o que fazer se um dia absorver

**Plano firme: não mover BLOB para o Postgres em nenhum cenário previsível.** Se um dia houver
necessidade de **busca cruzada** sobre metadados (catálogo de fotos junto com nomes/atlas):

- Absorver **só os metadados** (`organizations/users/projects/photos/targets/deleted_photos` viram
  tabelas; `photos_rtree`/`photos_rowid` → `geometry(Point, 4326)` + GiST). Esforço moderado; o
  grafo de 461 mil targets importa em minutos via `COPY`.
- **Deixar os BLOBs como arquivos/object storage** (S3/MinIO ou nos próprios SQLite), com o
  Postgres guardando **só o ponteiro**.
- **Riscos da absorção** (documentar antes de tentar): (a) reescrever o caminho quente — ETag O(1)
  + `mmap` + semáforo é específico de "Buffer do SQLite"; em `bytea` perde-se o `mmap` e regride
  latência/RSS; (b) better-sqlite3 é **síncrono**, `pg` é **async** — toda a `queries.js` muda de
  assinatura; (c) o **swap atômico de arquivo** (`.tmp`/`.bak`) não existe em Postgres (re-upload
  vira `DELETE`+`INSERT` grande com bloat); (d) R-tree → GiST exige reescrever `nearbyPhotos`;
  (e) juntar o working set no mesmo processo provavelmente exige **subir o limite de 512 MB**;
  (f) **perda do modelo offline-first** (bundle por missão).

---

## 4. Contrato do 360 a NÃO quebrar (congelado)

> Este é um **contrato de frontend congelado** (`_padroes.md` §4, princípio 4). Qualquer mudança
> no 360 ou no gateway que altere estes shapes exige teste de contrato e alinhamento com o
> `ebgeo_web`. Reproduzido verbatim aqui porque os docs-fonte (`EBGEO-360.md`) serão apagados.
> A versão canônica também vive em [`99-referencia.md`](99-referencia.md) (apêndice "Contrato 360").

**Shape do metadado de foto** (consumido pelo viewer Three.js — `GET /api/v1/photos/:uuid`):

```json
{
  "camera": {
    "id", "img", "display_name", "lon", "lat", "ele", "heading", "height",
    "mesh_rotation_y", "mesh_rotation_x", "mesh_rotation_z",
    "distance_scale", "marker_scale", "floor_level", "calibration_reviewed"
  },
  "projectSlug": "...",
  "captureDate": "...",
  "targets": [
    {
      "id", "img", "lon", "lat", "ele", "display_name", "icon": "next",
      "next", "is_original", "distance", "bearing",
      "override_bearing", "override_distance", "override_height"
    }
  ]
}
```

**Pontos sensíveis a quebra (manter estáveis):**

1. **Campos PLANOS em `camera`** — não aninhar em `position`/`orientation`. Nomes exatos:
   `mesh_rotation_y`, `mesh_rotation_x`, `mesh_rotation_z`, `distance_scale`, `marker_scale`,
   `floor_level`, `calibration_reviewed`.
2. **`previewThumbnail` relativo SEM `/api/v1`** — o cliente concatena com `serviceUrl`. O gateway
   **não pode** reescrever esse path nem o prefixo retornado no corpo.
3. **Em `targets`:** `bearing`/`distance` (**não** `bearing_deg`/`distance_m`, que são o shape
   interno do banco); `override_*` é número **ou** `null`; `next`/`is_original` são booleanos;
   `icon: "next"`.
4. **Faixas de validação de calibração** — mudar uma faixa rejeita valores antes aceitos.
5. **ETag de imagem** `"{uuid}-{quality}-{sizeBytes}"` e o contrato `206`/`416`/`304` com
   `Accept-Ranges`/`Content-Range`. O gateway **deve preservar** `If-None-Match`, `Range`, `ETag`,
   `Content-Range`, `Accept-Ranges` e `Cache-Control: public, max-age=31536000, immutable`.
6. **Envelope de erro** `{ "error": "..." }` e os códigos `401`/`403`/`404`/`409`/`416`. O gateway
   não pode trocar o corpo de erro do 360 pelo envelope `{ "error": { "code", "message" } }` do
   backend único.

**Viewer Three.js:** depende da ordem de rotação **Euler ZXY** e do **modelo de chão plano**
(`ele` é informativo; overrides projetam no plano de chão). Isso é responsabilidade do 360/viewer —
o gateway só não pode interferir nos campos acima.

---

## 5. Tarefas

### Tarefa 1: Definir o payload de JWT compartilhado e validar o segredo único

**Objetivo:** garantir que o token emitido pelo backend único (fase-5) contém **todos** os claims
que o 360 precisa (`sub`, `org`/`organization_id`, `role`, `login`/`username`) e que ambos os
serviços usam o **mesmo** `JWT_SECRET` (HS256). Esta tarefa **não muda o schema do 360**; ela
fixa o contrato de token entre os dois serviços.

**Arquivos afetados:**
- `src/modules/auth/auth.service.js` (verificar/ajustar `generateAccessToken`, hoje `:34-46`)
- `src/config.js` (garantir `jwt.secret` único e validado — base já em `:24-28`)
- `docs/plano/99-referencia.md` (registrar o contrato de payload — apêndice)
- *(no repo do 360, fora deste backend)* `config.jwtSecret` e a leitura de claims em
  `src/auth/authz.js` — **documentar a mudança**, não implementar aqui se o repo do 360 não estiver
  neste workspace.

**Padrão de código:** `_padroes.md` §8 (auth: `algorithms: ['HS256']`); exemplo real de emissão em
`auth.service.js:34-46`; verificação em `middleware/auth.js:23-39`.

**Implementação:**
1. Confirmar que `generateAccessToken` (pós-fase-5) inclui `organization_id` no payload. Se a
   fase-5 nomeou o claim `org` em vez de `organization_id`, registrar o nome canônico no apêndice
   e fazer **o 360** ler esse nome. Recomendação: emitir **ambos** os apelidos não — escolher
   **um** nome canônico (`organization_id`) e fazer o 360 lê-lo; evitar duplicidade de claim.
2. Confirmar que o payload carrega `username` (o 360 chama de `login`). Decisão: o 360 passa a ler
   `username`; **não** renomear no token do backend único (não quebrar o `ebgeo_web`).
3. Garantir `jwt.verify(token, secret, { algorithms: ['HS256'] })` no backend único
   (`middleware/auth.js:25` — adicionar `{ algorithms: ['HS256'] }` se a fase-0 não o fez) e que o
   360 usa o **mesmo** segredo via env `JWT_SECRET` (mesma string em ambos os containers).
4. Registrar no apêndice de `99-referencia.md` a tabela de mapeamento de claims (§3.2/§3.3 deste
   doc) como contrato congelado.

**Critérios de aceitação:**
- [ ] O payload do token de acesso do backend único contém `sub`, `role`, `organization_id` e
  `username` (verificável decodificando o JWT de um login real).
- [ ] `jwt.verify` no backend único restringe `algorithms: ['HS256']`.
- [ ] A tabela de mapeamento de claims está em `99-referencia.md`, marcada como contrato congelado.
- [ ] Nenhuma mudança no shape de resposta de `POST /auth/login` que quebre o `ebgeo_web`.

**Testes:**
- `tests/integration/auth.test.js`: caso que decodifica o token de `POST /auth/login` e assere a
  presença de `sub`, `role`, `organization_id`, `username`. Caso negativo: token assinado com
  algoritmo `none` ou outro segredo é rejeitado (401).

**Dependências:** fase-5 concluída (claim de org no token).

---

### Tarefa 2: Mapear OMs e roles entre backend único e 360

**Objetivo:** estabelecer a correspondência de **valores** (não estrutura) entre `organizations`
do backend único e `projects.organization_id`/`role` do 360, conforme decisão §3.2 ramo (A):
reusar o UUID da `organizations` da fase-5 como `organization_id` do 360.

**Arquivos afetados:**
- `docs/plano/99-referencia.md` (registrar a tabela de mapeamento OM ↔ org)
- `docs/plano/fase-7-gateway-360.md` (este doc; manter §3.2/§3.3 como fonte)
- *(no repo do 360)* backfill de `index.db`: `UPDATE projects SET organization_id = :uuid WHERE
  organization_id = 'org-legacy'` — **script de migração operacional do 360**, executado uma vez.

**Padrão de código:** migração idempotente no startup do 360 (padrão §5 do `EBGEO-360.md`:
`ADD COLUMN` condicionado a `pragma table_info`, rebuild fora de transação, backup
`_backup/*.pre-multiorg.bak` antes de migração estrutural). **Não** é migração Postgres do backend
único — é operação no SQLite do 360.

**Implementação:**
1. Listar as OMs reais do 360 (hoje só `org-legacy`) e mapear cada uma para uma linha de
   `organizations` no backend único (criar as faltantes na fase-5).
2. Script de backfill idempotente no 360 que troca `projects.organization_id` (`org-legacy` →
   UUID real), preservando `status`/`created_at`. **Fazer backup do `index.db` antes** (disciplina
   operacional do 360).
3. Mapear roles conforme §3.3 (`admin`→`system_admin`; `user`+escrita→`om_data_admin`).
4. Documentar a tabela de mapeamento em `99-referencia.md`.

**Critérios de aceitação:**
- [ ] Toda OM consumida pelo 360 tem uma linha correspondente em `organizations` (backend único),
  com `id` (UUID) usado como `organization_id` no 360.
- [ ] O backfill é idempotente (rodar 2× não altera o resultado) e preserva `status`/`created_at`.
- [ ] Backup do `index.db` registrado antes do backfill estrutural.
- [ ] A tabela de mapeamento OM↔org e role↔role está em `99-referencia.md`.

**Testes:**
- Operacional (não unit do backend): após o backfill, um token com `organization_id = <uuid>`
  consegue escrever (`canWriteProject` passa) num projeto daquela OM; um token de outra OM recebe
  403/404. Cobrir num teste de fumaça do 360 (fora da suite do backend único).

**Dependências:** Tarefa 1; fase-5 (entidade `organizations`).

---

### Tarefa 3: O 360 verifica o token do emissor único (sem emitir token próprio no fluxo unificado)

**Objetivo:** fazer o `ebgeo_360` **confiar** no token emitido pelo backend único — mesmo
`JWT_SECRET`, mesmos claims — em vez de emitir seus próprios tokens de usuário. **Zero mudança de
schema do 360.**

**Arquivos afetados:**
- *(no repo do 360)* `src/auth/authz.js` (leitura de claims), `src/config.js` (`jwtSecret`),
  e o registro de rotas de auth do 360.
- `docs/plano/99-referencia.md` (registrar a decisão e o ramo escolhido).

**Padrão de código:** o 360 já usa `@fastify/jwt` com payload `{sub, org, role, login}`; a mudança
é só a **fonte** do segredo e o **mapeamento de claim** (ler `organization_id` e `username` em vez
de `org`/`login`, ou aceitar ambos).

**Implementação (decisão aberta — recomendação + ramos):**

- **Ramo recomendado (SSO puro):** o `ebgeo_web` obtém o token **só** do backend único
  (`POST /auth/login`) e o usa em **todas** as chamadas, inclusive ao 360. O 360 **mantém**
  `POST /auth/login`/`/auth/me`/`/auth/logout` apenas para compatibilidade/fallback, mas o fluxo
  primário não os usa. O 360 só **verifica** com o `JWT_SECRET` compartilhado e lê os claims
  mapeados (§3.2/§3.3). Vantagem: um único login, um único ponto de revogação lógica. Custo:
  o 360 precisa aceitar o vocabulário de claim do backend único.

- **Ramo alternativo (dois emissores, mesmo segredo):** ambos emitem tokens, mas com o **mesmo**
  `JWT_SECRET` e claims compatíveis, de modo que um token de qualquer um vale no outro. Mais
  permissivo, porém **dois pontos de emissão** e maior risco de divergência de claim/expiração
  (12h do 360 vs 15m+refresh do backend único). **Não recomendado** — escolher o ramo SSO puro.

1. Apontar `jwtSecret` do 360 para a env `JWT_SECRET` compartilhada (mesma string).
2. Em `authz.js`, ler `organization_id` (ou o nome canônico fixado na Tarefa 1) como `org` e
   `username` como `login`; manter o resto da lógica de posse (`canWriteProject`/`canReadProject`)
   intacta.
3. Manter as rotas `/auth/*` do 360 ativas como fallback, mas documentar que o fluxo primário usa
   o token do backend único.

**Critérios de aceitação:**
- [ ] Um token emitido por `POST /auth/login` do **backend único** é aceito pelo 360 em rota de
  escrita (ex.: `PUT calibration`) para a OM correta.
- [ ] O mesmo token é **rejeitado** (403/404) numa OM diferente da do usuário.
- [ ] O contrato de API do 360 (§4) permanece inalterado (shapes, ETag, envelope de erro).
- [ ] `JWT_SECRET` é idêntico em ambos os containers (verificável por env do compose).

**Testes:**
- Teste de fumaça do 360 (fora da suite do backend): token do backend único → 200 em leitura, 200
  em escrita na própria OM, 403/404 em escrita de outra OM, 401 com token de segredo diferente.

**Dependências:** Tarefas 1 e 2.

---

### Tarefa 4: Gateway NGINX roteando para backend único e 360

**Objetivo:** colocar um reverse proxy NGINX na frente, roteando por path para o backend único
(:3000) ou para o 360 (:8081), repassando `Authorization`, preservando os headers de cache/Range
do 360 e aplicando CORS configurável.

**Arquivos afetados:**
- `deploy/nginx/gateway.conf` (criar)
- `docker-compose.yml` (criar/editar: serviços `gateway`, `backend`, `ebgeo_360`, `postgres`)
- `.env.example` (criar/editar: `GATEWAY_PORT`, `CORS_ORIGIN`, `JWT_SECRET`, portas internas)

**Padrão de código:** infra; sem código de aplicação. Seguir `_padroes.md` §6 (rotas públicas vs
autenticadas) e §8 (CORS por origin, não wildcard).

**Implementação:**
1. Criar `deploy/nginx/gateway.conf` com `location` por prefixo. Roteamento:
   - `/api/v1/photos`, `/projects`, `/thumbnails`, `/tiles`, `/pmtiles`, `/admin`, `/calibration`,
     `/auth` **do 360** → `ebgeo_360:8081`. **Atenção ao conflito de `/auth`:** o `ebgeo_web` usa o
     `/auth` do **backend único**. Resolver com prefixo dedicado para o 360 (ex.: `/api/360/...`
     no gateway → reescrito para `/api/v1/...` no upstream do 360) **OU** manter os paths do 360 e
     mapear só os que não colidem. **Recomendação:** prefixar o 360 sob `/api/360/` no gateway e
     fazer o `ebgeo_web` apontar `streetView360.serviceUrl` para `<gateway>/api/360`. Isso elimina
     a colisão de `/auth`, `/projects`, etc., sem tocar no contrato interno do 360. **Cuidado com o
     ponto 2 do contrato (§4):** o `previewThumbnail` é relativo **sem `/api/v1`**; o cliente o
     concatena com `serviceUrl` — se `serviceUrl = <gateway>/api/360`, o 360 deve continuar
     retornando o path relativo como hoje (o gateway reescreve `/api/360/...` → `/api/v1/...` no
     upstream, mas **não** mexe no corpo da resposta).
   - Demais (`/api/v1/atlas`, `/api/v1/auth`, `/api/config`, `/api/v1/nomes`, `/api/v1/health`,
     WebSocket `/api/v1/collab`) → `backend:3000`.
2. **Repassar `Authorization`** sem reescrever: `proxy_set_header Authorization $http_authorization;`
   (NGINX repassa por padrão, mas tornar explícito).
3. **Preservar headers de cache/Range do 360:** não habilitar `proxy_cache` que reescreva `ETag`;
   garantir `proxy_set_header Range $http_range;` e `proxy_set_header If-None-Match
   $http_if_none_match;`; **não** ligar `gzip` sobre `image/webp` (o 360 já não recomprime WebP).
   Não tocar em `Content-Range`/`Accept-Ranges`/`Cache-Control` da resposta.
4. **WebSocket:** para `/api/v1/collab`, adicionar `proxy_http_version 1.1`, `Upgrade`/`Connection`
   headers.
5. **CORS configurável:** preferir que cada upstream emita seu próprio CORS (o 360 já tem CORS
   configurável; o backend único usa `cors({ origin, credentials:true })` em `app.js`). O gateway
   **não** deve duplicar headers CORS (risco de header duplicado → browser rejeita). Se centralizar
   no gateway, **remover** o CORS dos upstreams. **Recomendação:** manter CORS nos upstreams,
   gateway transparente.
6. `docker-compose.yml`: serviços com `JWT_SECRET` compartilhado via env; bind do volume de
   `{slug}.db` (41 GB) só no container do 360; `mem_limit: 512m` no 360 (paridade com produção).

**Exemplo (esqueleto de `gateway.conf`):**
```nginx
upstream backend  { server backend:3000; }
upstream ebgeo360 { server ebgeo_360:8081; }

server {
  listen 80;

  # 360 sob prefixo dedicado para evitar colisão de /auth, /projects
  location /api/360/ {
    rewrite ^/api/360/(.*)$ /api/v1/$1 break;
    proxy_pass http://ebgeo360;
    proxy_set_header Authorization   $http_authorization;
    proxy_set_header Range           $http_range;
    proxy_set_header If-None-Match   $http_if_none_match;
    proxy_set_header Host            $host;
    # NAO recomprimir webp; NAO cachear/reescrever ETag
    gzip off;
  }

  # WebSocket de colaboração (backend único)
  location /api/v1/collab {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Authorization $http_authorization;
  }

  # Backend único (default)
  location / {
    proxy_pass http://backend;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Host          $host;
  }
}
```

**Critérios de aceitação:**
- [ ] `GET <gateway>/api/360/photos/:uuid/image` retorna o mesmo `ETag`, `Accept-Ranges`,
  `Content-Range` (em `Range`) e `Cache-Control: ...immutable` que o 360 direto (diff byte-a-byte
  dos headers relevantes).
- [ ] `If-None-Match` casando retorna **304** através do gateway (não 200).
- [ ] `Range: bytes=0-100` retorna **206** com `Content-Range` correto através do gateway.
- [ ] Não há colisão de path: `/auth` do `ebgeo_web` vai ao backend único; o login do 360 (se
  usado) está sob `/api/360/auth`.
- [ ] WebSocket `/api/v1/collab` faz upgrade através do gateway.
- [ ] Não há header CORS duplicado em nenhuma resposta.
- [ ] O corpo de erro do 360 continua `{ "error": "..." }` (gateway não reescreve corpo).

**Testes:**
- Teste de fumaça de integração (script `deploy/smoke-gateway.sh` ou caso manual documentado):
  `curl -I` em foto via gateway vs direto comparando `ETag`/`Accept-Ranges`/`Cache-Control`;
  `curl -H 'Range: bytes=0-99'` esperando 206; `curl -H 'If-None-Match: <etag>'` esperando 304.

**Dependências:** Tarefa 3 (token unificado funcionando); fase-5.

---

### Tarefa 5: Apontar o `ebgeo_web` para o gateway e documentar backup dual

**Objetivo:** atualizar a config consumida pelo frontend para que `streetView360.serviceUrl`
(e demais URLs) apontem para o gateway, e documentar no docker-compose a **dualidade de backup**
(`pg_dump` do núcleo vs cópia de arquivo `.db` por missão via rsync).

**Arquivos afetados:**
- `docs/plano/99-referencia.md` (shape do `config.js` — confirmar `streetView360.serviceUrl`)
- `docker-compose.yml` (comentários + serviço/volume de backup)
- `deploy/BACKUP.md` (criar: procedimento de backup dual)
- *(no `ebgeo_web`, fora deste repo)* `config.js` / `GET /api/config` da fase-2:
  `streetView360.serviceUrl = <gateway>/api/360`.

**Padrão de código:** o `config.js`/`GET /api/config` (fase-2) é **contrato de frontend congelado**
(`_padroes.md` §4). O bloco `streetView360.serviceUrl` deve ser **URL de ambiente injetada**, não
hardcoded (ver fase-2). **Lembrete do contrato §4 ponto 2:** `previewThumbnail` é relativo sem
`/api/v1`; o cliente concatena com `serviceUrl` — portanto `serviceUrl` deve apontar para a **base**
do 360 atrás do gateway (`<gateway>/api/360`), não para `/api/v1` interno.

**Implementação:**
1. Garantir que a fase-2 (`GET /api/config`) injeta `streetView360.serviceUrl =
   <gateway>/api/360` por ambiente.
2. Documentar em `deploy/BACKUP.md`:
   - **Núcleo (Postgres):** `pg_dump`/`pg_restore` do banco único (atlas JSONB + schema `ng` +
     org/audit). Frequência conforme política; é o estado mutável crítico.
     ```bash
     pg_dump --format=custom --file=/backup/ebgeo_core_$(date +%F).dump "$DATABASE_URL"
     ```
   - **360 (SQLite, 41 GB):** **cópia de arquivo por projeto/missão via rsync** — não passa pelo
     `pg_dump`. Cada `{slug}.db` é imutável pós-ingestão; o `index.db` (208 MB) é o catálogo.
     ```bash
     rsync -a --info=progress2 /data/360/ /backup/360/   # index.db + {slug}.db
     ```
   - Deixar explícito **por que** o backup é dual: BLOB imutável em SQLite não cabe no fluxo de
     `pg_dump` e não deve (41 GB inflariam o dump do núcleo).
3. No `docker-compose.yml`, comentar os volumes: `pgdata` (backup via `pg_dump`) e `data360`
   (backup via rsync de arquivo).

**Critérios de aceitação:**
- [ ] `streetView360.serviceUrl` (no payload de `GET /api/config` / `config.js`) aponta para o
  gateway e é injetado por ambiente, não hardcoded.
- [ ] `deploy/BACKUP.md` descreve os dois fluxos (`pg_dump` do núcleo; rsync do `.db` do 360) e
  justifica a dualidade.
- [ ] O viewer 360 carrega fotos via gateway sem regressão de contrato (§4): metadado plano,
  `previewThumbnail` relativo, ETag/Range preservados.

**Testes:**
- Manual/fumaça documentado: abrir o `ebgeo_web` apontando `serviceUrl` ao gateway e confirmar que
  uma foto + targets carregam e o cache (304) funciona no reload.

**Dependências:** Tarefa 4; fase-2 (config dinâmico, para a URL injetada).

---

### Tarefa 6 (opcional, desacoplável): Carregar padrões de engenharia do 360 — ETag O(1) + 304 + immutable no download de imagem

**Objetivo:** aplicar ao módulo `images` do backend único o padrão de servir artefato imutável do
360: **ETag O(1) derivado de tamanho persistido** + short-circuit 304 + `Cache-Control: immutable`,
sem ler o conteúdo. (A fase-0 já prevê "cache no download de imagem" — esta tarefa especifica o
padrão e pode ser absorvida pela fase-0 se ainda não feito.)

**Arquivos afetados:**
- `src/modules/images/images.service.js` (modificar)
- `src/modules/images/images.controller.js` (modificar — emitir ETag/304/Cache-Control)
- `src/modules/images/images.queries.js` (garantir que o tamanho em bytes é persistido/consultável)

**Padrão de código:** padrão do 360 (`computeImageETag`: `"{id}-{sizeBytes}"`); `_padroes.md` §1
(controller HTTP). Exemplo de controller em `_padroes.md` §1.

**Implementação:**
1. Persistir/expor `size_bytes` da imagem no metadado (se a fase-0 não o fez).
2. No controller de download, calcular `ETag = '"' + imageId + '-' + sizeBytes + '"'` **sem ler o
   blob**; se `If-None-Match` casar, responder **304** com headers e **sem** carregar o arquivo.
3. Emitir `Cache-Control: public, max-age=31536000, immutable` (imagens de atlas são imutáveis por
   id; se houver re-upload, o id muda).
4. Manter `Content-Disposition: attachment` (segurança, `_padroes.md` §8).

**Critérios de aceitação:**
- [ ] `GET /atlas/:id/images/:imageId` emite `ETag` estável derivado de id+tamanho.
- [ ] `If-None-Match` casando retorna 304 sem ler o arquivo do disco.
- [ ] `Cache-Control: ...immutable` presente.
- [ ] Contrato de download não quebra (corpo/headers de 200 inalterados além do cache).

**Testes:**
- `tests/integration/images.test.js`: upload → GET captura `ETag` → segundo GET com `If-None-Match`
  retorna 304. Caso negativo: `If-None-Match` com ETag errado retorna 200.

**Dependências:** nenhuma estrita; sobrepõe-se à fase-0 ("cache no download de imagem"). Se a
fase-0 já entregou, **pular**.

---

### Tarefa 7 (opcional, desacoplável): Documentar os demais padrões do 360 como guia de engenharia

**Objetivo:** registrar, como referência reaproveitável, os padrões de engenharia do 360 que valem
para o resto do backend, mesmo mantendo o 360 separado. Documentação, não código de aplicação.

**Arquivos afetados:**
- `docs/plano/99-referencia.md` (apêndice "Padrões de engenharia do 360")
- `CLAUDE.md` (referência curta, se pertinente)

**Padrões a registrar (verbatim, ver §6 deste doc):**
1. **Separar metadados de BLOB** em dois bancos com tuning distinto (metadados em página pequena +
   cache em RAM; BLOB em página 64 KB + `mmap` + readonly). 208 MB de metadados governam 41 GB.
2. **ETag O(1) sem ler conteúdo** (deriva de tamanho persistido) + `immutable` + **304
   short-circuit antes de qualquer I/O pesado**. Reaproveitável em qualquer servidor de artefato
   imutável (cartas, GeoTIFF, PDF, modelos 3D da fase-4).
3. **Semáforo de concorrência por endpoint de memória** (`MAX_INFLIGHT_IMAGE_REQUESTS = 8`) como
   proteção explícita de RSS sob teto fixo — mais legível que tuning de GC. Aquire só no caminho
   200/206 (após o 304); libera uma vez no `close`/`error` (`releaseOnce`).
4. **UUID v5 determinístico namespaceado por tenant** `uuidv5("{orgSlug}/{slug}/{originalName}")`
   (só `node:crypto`) — re-upload idempotente e deeplink estável. Aplicável à ingestão de assets
   3D (fase-4) e ao import de atlas.
5. **Bundle + swap atômico `.tmp`/`.bak` + merge transacional** como protocolo offline-first: o
   produtor gera SQLite pronto e sobe; o hub só reconcilia. Encaixa no fluxo de campo do CGEO.
6. **Dummy-hash anti-timing** no login (já previsto na fase-0) + **anti-lockout** (não remover o
   último `system_admin`/`admin`).
7. **Migração idempotente no startup** com rebuild de constraint controlado (FK off + `finally`) e
   **backup antes de migração estrutural**.

**Critérios de aceitação:**
- [ ] Os 7 padrões estão registrados em `99-referencia.md` com onde cada um se aplica no backend
  único (ex.: padrão 2 → fase-4 assets 3D + Tarefa 6; padrão 4 → ingestão 3D/import atlas).

**Testes:** N/A (documentação).

**Dependências:** nenhuma.

---

## 6. Riscos e cuidados

| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| **Gateway reescreve `ETag`/`Content-Range`/`Cache-Control` do 360** (cache do NGINX, normalização) | Alta | Gateway **transparente** no path do 360: sem `proxy_cache`, sem `gzip` em webp, repassar `Range`/`If-None-Match`. Teste comparando headers via gateway vs direto. |
| **Colisão de path** (`/auth`, `/projects` existem nos dois serviços) | Alta | Prefixar o 360 sob `/api/360/` no gateway (reescrita → `/api/v1/...` no upstream). |
| **`previewThumbnail` quebra** (cliente concatena com `serviceUrl`) | Alta | `serviceUrl` = base do 360 atrás do gateway; gateway **não** mexe no corpo da resposta; o 360 continua retornando path relativo sem `/api/v1`. |
| **Header CORS duplicado** (gateway + upstream) | Média | CORS só nos upstreams; gateway transparente. |
| **Divergência de `JWT_SECRET`** entre containers | Alta | Mesma env `JWT_SECRET` no compose; falhar o boot do 360 se ausente; teste de fumaça com token cruzado. |
| **Mismatch de claim de org** (`org` slug vs `organization_id` UUID) | Alta | Ramo (A): backfill do `organization_id` do 360 para o UUID da `organizations`; teste de escrita por OM. |
| **Expiração divergente** (12h do 360 vs 15m+refresh do backend único) | Média | Ramo SSO puro: o `ebgeo_web` usa só o token do backend único (com refresh); o 360 só verifica. |
| **Backup do 360 entrar no `pg_dump`** | Média | Documentar e separar fisicamente: rsync do `.db`, `pg_dump` só do núcleo. |
| **Tentação de absorver os 41 GB** | Alta | Decisão D3 firme: não mover BLOB. §3.4 lista os riscos da absorção como dissuasão. |

---

## 7. Definition of Done da fase

Além do DoD universal de `_padroes.md` §10 (no que se aplica — esta fase é majoritariamente infra):

- [ ] O payload de JWT do backend único contém `sub`, `role`, `organization_id`, `username`;
  `jwt.verify` usa `algorithms: ['HS256']`; contrato de payload registrado em `99-referencia.md`
  (Tarefa 1).
- [ ] OMs e roles mapeados entre backend único e 360; `organization_id` do 360 = UUID da
  `organizations`; backfill idempotente com backup prévio (Tarefa 2).
- [ ] O 360 aceita o token do emissor único (mesmo `JWT_SECRET`, claims mapeados), escreve só na
  OM do usuário, e seu schema **não** mudou (Tarefa 3).
- [ ] Gateway NGINX roteia backend único vs 360 sem colisão de path, preserva ETag/Range/304/CORS
  do 360 e faz upgrade de WebSocket (Tarefa 4).
- [ ] `ebgeo_web` aponta `streetView360.serviceUrl` ao gateway (via `GET /api/config`); backup dual
  documentado em `deploy/BACKUP.md` (Tarefa 5).
- [ ] Contrato do 360 (§4) **preservado e testado**: metadado plano, `previewThumbnail` relativo,
  ETag `"{uuid}-{quality}-{sizeBytes}"`, 206/416/304, envelope de erro `{ "error": "..." }`.
- [ ] (Opcional) Padrões do 360 carregados: ETag O(1)+304+immutable no download de imagem do
  backend único (Tarefa 6); 7 padrões registrados em `99-referencia.md` (Tarefa 7).
- [ ] **41 GB de BLOB permanecem em SQLite no 360** — nenhum byte de imagem foi para o Postgres.
- [ ] `docker-compose.yml` sobe gateway + backend + 360 + postgres com `JWT_SECRET` compartilhado e
  `mem_limit: 512m` no 360.
