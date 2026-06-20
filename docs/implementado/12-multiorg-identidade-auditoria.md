# 12 - Multi-org, Identidade e Auditoria

Este documento cobre a camada de **identidade e tenant** do backend: organizações (OMs) de primeira
classe, o JWT de **emissor único** (com claims de organização e papel), a autenticação flexível
(Bearer / cookie / API key), a rotação de API keys e a trilha de auditoria de negócio.

Tudo é **aditivo**: o caminho anônimo e o contrato de autenticação existente (ver
[01 - Autenticação](./01-autenticacao.md)) permanecem intactos. Tokens antigos continuam válidos.

---

## Visão Geral

| Subsistema | O que entrega ao frontend |
|------------|---------------------------|
| **Organizações** | CRUD de OMs sob `/api/v1/organizations` (leitura para qualquer usuário; escrita só admin) |
| **JWT emissor único** | O mesmo token serve web, gazetteer e 360; carrega `organization_id` e `org_role` (papel org-scoped) além do `role` global |
| **Auth flexível** | Credencial aceita via `Authorization: Bearer`, cookie `token` ou `x-api-key` — não-bloqueante (anônimo segue adiante) |
| **API keys** | Chave de máquina por usuário, rotacionável atomicamente (`/users/me/api-key/rotate`) |
| **Auditoria** | Trilha de eventos de negócio consultável por admin (`GET /api/v1/audit`) |

---

## Parte 1: Organizações (OMs)

Uma organização representa a OM (Organização Militar) dona dos dados. Todo usuário pertence a uma
org (`organization_id`); quando não informado, cai na **org default**
(`id = 00000000-0000-0000-0000-000000000001`, `slug = "default"`).

### Shape da organização

```json
{
  "id": "uuid",
  "nome": "Centro de Imagens e Informações Geográficas do Exército",
  "slug": "cigex",
  "sigla": "CIGEx",
  "is_active": true,
  "created_at": "2026-01-15T10:30:00.000Z",
  "updated_at": "2026-01-15T10:30:00.000Z"
}
```

---

### 1. Listar organizações

#### Endpoint

`GET /api/v1/organizations`

#### Headers

`Authorization: Bearer <accessToken>`

#### Permissão

Qualquer usuário autenticado.

#### Response (200)

```json
{
  "data": [
    {
      "id": "00000000-0000-0000-0000-000000000001",
      "nome": "Organização Padrão",
      "slug": "default",
      "sigla": "DEFAULT",
      "is_active": true,
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "uuid",
      "nome": "Centro de Imagens e Informações Geográficas do Exército",
      "slug": "cigex",
      "sigla": "CIGEx",
      "is_active": true,
      "created_at": "2026-01-15T10:30:00.000Z",
      "updated_at": "2026-01-15T10:30:00.000Z"
    }
  ]
}
```

> A lista é ordenada por `nome` e inclui orgs inativas (`is_active = false`). Filtre no frontend se
> precisar exibir apenas ativas.

---

### 2. Obter organização

#### Endpoint

`GET /api/v1/organizations/:id`

#### Permissão

Qualquer usuário autenticado.

#### Response (200)

```json
{
  "data": {
    "id": "uuid",
    "nome": "Centro de Imagens e Informações Geográficas do Exército",
    "slug": "cigex",
    "sigla": "CIGEx",
    "is_active": true,
    "created_at": "2026-01-15T10:30:00.000Z",
    "updated_at": "2026-01-15T10:30:00.000Z"
  }
}
```

#### Erros

- `404 Not Found`: organização inexistente
- `422`: `:id` não é um UUID válido

---

### 3. Criar organização

#### Endpoint

`POST /api/v1/organizations`

#### Permissão

`admin` (role global).

#### Request

```json
{
  "nome": "Centro de Imagens e Informações Geográficas do Exército",
  "slug": "cigex",
  "sigla": "CIGEx"
}
```

#### Validações

- `nome`: obrigatório, máx. 255 caracteres
- `slug`: obrigatório, máx. 100, padrão `^[a-z0-9-]+$` (apenas minúsculas, números e hífen)
- `sigla`: opcional, máx. 50 (aceita `null` ou `""`)

#### Response (201)

```json
{
  "data": {
    "id": "uuid",
    "nome": "Centro de Imagens e Informações Geográficas do Exército",
    "slug": "cigex",
    "sigla": "CIGEx",
    "is_active": true,
    "created_at": "2026-01-15T10:30:00.000Z",
    "updated_at": "2026-01-15T10:30:00.000Z"
  }
}
```

#### Erros

- `409 Conflict`: `slug` já existe
- `422`: `slug` fora do padrão (`"slug can only contain lowercase letters, numbers and hyphens"`) ou `nome` ausente
- `403 Forbidden`: usuário não-admin

> A criação é **auditada** (ação `ORG_CREATE`) — ver Parte 5.

---

### 4. Atualizar organização

#### Endpoint

`PUT /api/v1/organizations/:id`

#### Permissão

`admin`.

#### Request

Todos os campos são opcionais; só os enviados são alterados (`COALESCE`). O `slug` **não** é
editável por esta rota.

```json
{
  "nome": "Novo nome da OM",
  "sigla": "NOVA",
  "is_active": true
}
```

#### Response (200)

```json
{
  "data": {
    "id": "uuid",
    "nome": "Novo nome da OM",
    "slug": "cigex",
    "sigla": "NOVA",
    "is_active": true,
    "created_at": "2026-01-15T10:30:00.000Z",
    "updated_at": "2026-01-15T11:00:00.000Z"
  }
}
```

#### Erros

- `404 Not Found`: organização inexistente
- `403 Forbidden`: usuário não-admin

> A atualização é **auditada** (ação `ORG_UPDATE`).

---

### 5. Desativar organização

A deleção é **soft-delete** (`is_active = false`), nunca remoção física.

#### Endpoint

`DELETE /api/v1/organizations/:id`

#### Permissão

`admin`.

#### Response

`204 No Content`

#### Erros

- `404 Not Found`: organização inexistente
- `403 Forbidden`: usuário não-admin

> A desativação é **auditada** (ação `ORG_DELETE`). Para reativar, use `PUT` com `is_active: true`.

---

## Parte 2: JWT de Emissor Único

O mesmo `JWT_SECRET` (algoritmo **HS256**) e o mesmo payload servem **três consumidores**: a aplicação
web, o gazetteer (nomes geográficos) e o módulo 360. O backend **adiciona** claims de organização
**sem remover** os claims existentes.

### Payload do access token

```json
{
  "sub": "user-uuid",
  "username": "cap.silva",
  "nome": "Capitão Silva",
  "posto": "Cap",
  "role": "user",
  "organization_id": "org-uuid",
  "org_role": "editor",
  "org": "org-uuid",
  "login": "cap.silva",
  "iat": 1705312200,
  "exp": 1705313100
}
```

| Claim | Descrição |
|-------|-----------|
| `sub` | ID do usuário |
| `role` | Papel **global**: `user` ou `admin` |
| `organization_id` | Tenant do usuário (UUID da OM) ou `null` |
| `org_role` | Papel **org-scoped**: `owner`, `admin`, `editor` ou `viewer` |
| `org` | **Alias** de `organization_id` (lido as-is pelo módulo 360) |
| `login` | **Alias** de `username` (lido as-is pelo módulo 360) |

> **Contrato congelado**: os aliases `org` (= `organization_id`) e `login` (= `username`) existem para
> que o token seja consumível **sem alteração** pelo módulo 360. Não os renomeie nem os remova.

### Dois eixos de papel ortogonais

| Eixo | Valores | Onde mora |
|------|---------|-----------|
| `role` (global) | `user`, `admin` | Acesso a recursos do sistema, gerenciamento de usuários/orgs |
| `org_role` (org-scoped) | `owner`, `admin`, `editor`, `viewer` | Capacidade de escrita dentro da OM (espelha o `UserRole` do frontend) |

Estes são **independentes** da permissão **por-atlas** (`owner` / `write` / `read`), que continua
resolvida à parte (ver [07 - Compartilhamento](./07-compartilhamento.md) e o campo `permission` do
WebSocket em [04 - WebSocket e Colaboração](./04-websocket-collab.md)).

### Tokens legados degradam graciosamente

Tokens emitidos **antes** do claim de org continuam válidos. Na verificação, o backend aplica
fallback:

| Claim ausente | Valor assumido |
|---------------|----------------|
| `organization_id` | `null` |
| `org_role` | `viewer` |

Assim, a base instalada não é invalidada quando os claims de org são introduzidos.

### Onde o `org_role`/`organization_id` aparecem nas respostas

O objeto `user` retornado por `POST /auth/login` e por `POST /auth/refresh` já inclui os campos:

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "550e8400-...-abc123...",
    "user": {
      "id": "uuid",
      "username": "cap.silva",
      "nome": "Capitão Silva",
      "posto_graduacao": "Cap",
      "organizacao_militar": "CIGEx",
      "organization_id": "org-uuid",
      "org_role": "editor",
      "role": "user"
    }
  }
}
```

> `organizacao_militar` (texto livre legado) é **preservado** junto com o novo `organization_id`
> (FK estruturada). Os dois coexistem durante a transição.

---

## Parte 3: Autenticação Flexível

O backend instala um middleware **global e não-bloqueante** (`flexibleAuth`) que tenta popular
`req.user` a partir de três fontes, **nesta ordem**:

```
1. x-api-key   (header OU query ?api_key=)   → req.authVia = 'api_key'
2. cookie `token`                            → req.authVia = 'jwt'
3. Authorization: Bearer <token>             → req.authVia = 'jwt'
```

Pontos-chave para quem integra:

- **Nunca bloqueia.** Se nenhuma credencial é válida, a requisição segue **anônima**
  (`req.user` indefinido). Quem decide barrar é a rota — as rotas estritas (`auth` / `requireAdmin`)
  retornam `401`/`403` quando `req.user` está ausente.
- **API key tem precedência.** Se `x-api-key` (ou `?api_key=`) estiver presente, é ela que vale —
  o cookie/Bearer são ignorados nessa requisição. Uma API key com **formato inválido** (não-UUID) é
  tratada como anônima (não consulta o banco).
- **Cookie tem precedência sobre Bearer.** Quando ambos estão presentes, o cookie `token` é lido
  primeiro.
- **Sliding session.** Quando o JWT do cookie está a menos de 5 minutos da expiração, o backend
  reemite e reescreve o cookie `token` automaticamente na resposta (`Set-Cookie`). O frontend não
  precisa fazer nada — o cookie é renovado de forma transparente.

### Fluxo de autenticação flexível

```
Requisição                       flexibleAuth (global)
   |                                |
   |  x-api-key presente? ----------|--> SIM: valida UUID + busca user → req.user
   |                                |
   |  cookie `token`? --------------|--> SIM: verifica JWT → req.user
   |                                |          (renova cookie se < 5min p/ expirar)
   |                                |
   |  Authorization: Bearer? -------|--> SIM: verifica JWT → req.user
   |                                |
   |  nenhum/ inválido -------------|--> segue ANÔNIMO (req.user indefinido)
   |                                |
   v                                v
[rota decide]  auth/requireAdmin → 401/403 se req.user ausente
               rotas flexíveis    → atendem anônimo
```

### Notas de integração no frontend

- Para chamadas de **usuário** (SPA), continue enviando `Authorization: Bearer <accessToken>` como em
  [01 - Autenticação](./01-autenticacao.md). É a forma recomendada.
- O cookie `token` é útil para fluxos server-rendered / cross-tab; quando usado, a sessão desliza
  sozinha.
- A `x-api-key` é para **integração máquina-a-máquina** (scripts, serviços), não para o browser.

---

## Parte 4: API Keys

Cada usuário pode ter **uma** API key viva (UUID), guardada na linha quente de `users`. A rotação
arquiva a chave antiga em histórico e gera uma nova **na mesma transação** — não há janela com duas
chaves válidas; a chave antiga deixa de autenticar imediatamente.

### Como usar a API key

Envie no header (ou query) em qualquer rota:

```
x-api-key: 550e8400-e29b-41d4-a716-446655440000
```

O `flexibleAuth` resolve `req.user` a partir dela. A chave só autentica se o usuário estiver ativo
(`is_active = true`).

---

### 1. Rotacionar a própria API key

#### Endpoint

`POST /api/v1/users/me/api-key/rotate`

#### Headers

`Authorization: Bearer <accessToken>`

#### Permissão

Qualquer usuário autenticado (rotaciona a própria chave).

#### Request

Sem corpo.

#### Response (200)

```json
{
  "data": {
    "apiKey": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

> **Importante:** a resposta é a **única** vez em que a chave nova é devolvida. Armazene-a com
> segurança — ela não é recuperável depois (a chave antiga já foi invalidada).

---

### 2. Rotacionar a API key de outro usuário (admin)

#### Endpoint

`POST /api/v1/users/:userId/api-key/rotate`

#### Permissão

`admin`.

#### Response (200)

```json
{
  "data": {
    "apiKey": "novo-uuid-de-api-key"
  }
}
```

#### Erros

- `403 Forbidden`: usuário não-admin
- `422`: `:userId` não é UUID

> Toda rotação (própria ou por admin) é **auditada** (ação `API_KEY_ROTATE`) na mesma transação.
> A chave anterior fica registrada em `api_key_history` com `revoked_at`/`revoked_by`.

### Fluxo de rotação

```
Cliente                          Backend
   |                                |
   |-- POST /users/me/api-key/rotate>|
   |   Authorization: Bearer token   |
   |                                |  [tx: arquiva chave antiga + gera nova
   |                                |       + audita API_KEY_ROTATE]
   |<-- 200 { apiKey } -------------|
   |                                |
   [Cliente troca x-api-key armazenada]
```

---

## Parte 5: Auditoria

A trilha de auditoria registra **eventos de negócio** (quem fez o quê, quando, de qual IP) numa tabela
consultável. É **distinta** do logging operacional (arquivos/pino): a auditoria é evento de domínio,
no banco, e pode participar da **mesma transação** da operação auditada (se a operação reverte, o
registro de auditoria reverte junto).

### Shape do evento de auditoria

```json
{
  "id": "uuid",
  "action": "ORG_CREATE",
  "actor_id": "user-uuid",
  "target_type": "ORG",
  "target_id": "org-uuid",
  "target_name": "CIGEx",
  "details": { "atlasTransferred": 2 },
  "ip": "10.0.0.5",
  "user_agent": "Mozilla/5.0 ...",
  "created_at": "2026-01-15T10:30:00.000Z"
}
```

| Campo | Descrição |
|-------|-----------|
| `action` | Ação executada (lista fechada — ver abaixo) |
| `actor_id` | Quem executou (UUID, **sem FK** — sobrevive a delete do usuário) |
| `target_type` | Tipo do alvo: `USER`, `GROUP`, `MODEL`, `ZONE`, `SYSTEM`, `ATLAS`, `ORG` |
| `target_id` | ID do alvo (opcional) |
| `target_name` | Snapshot do nome do alvo no momento do evento (opcional) |
| `details` | JSON livre com contexto extra (ex.: `{ atlasTransferred }`) |
| `ip` / `user_agent` | Origem da requisição |

### Ações registradas (CHECK fechado)

O schema aceita estas ações: `LOGIN`, `LOGOUT`, `USER_CREATE`, `USER_UPDATE`, `USER_DELETE`,
`PASSWORD_RESET`, `API_KEY_ROTATE`, `ROLE_CHANGE`, `ORG_CREATE`, `ORG_UPDATE`, `ORG_DELETE`,
`ATLAS_DELETE`, `SHARING_CHANGE`, `PERMISSION_GRANT`, `PERMISSION_REVOKE`.

> **Hoje, o código efetivamente grava** apenas um subconjunto: `ORG_CREATE` / `ORG_UPDATE` /
> `ORG_DELETE` (orgs), `USER_DELETE` e `API_KEY_ROTATE` (usuários), e `PERMISSION_GRANT` (zonas de
> acesso geográfico). As demais ações constam no CHECK mas ainda **não** são emitidas pelos
> controllers correspondentes — não conte com `LOGIN`/`LOGOUT`/`ATLAS_DELETE` etc. aparecendo na
> trilha por enquanto.

---

### Consultar a trilha de auditoria

#### Endpoint

`GET /api/v1/audit`

#### Headers

`Authorization: Bearer <accessToken>`

#### Permissão

`admin`.

#### Query params

| Param | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `action` | string (máx. 50) | — | Filtra por ação (ex.: `ORG_CREATE`) |
| `actorId` | uuid | — | Filtra por quem executou |
| `targetType` | string (máx. 20) | — | Filtra por tipo de alvo (ex.: `ORG`) |
| `page` | int ≥ 1 | `1` | Página (1-based) |
| `limit` | int 1–200 | `50` | Itens por página |

Exemplo:

```
GET /api/v1/audit?action=API_KEY_ROTATE&page=1&limit=50
```

#### Response (200)

```json
{
  "data": {
    "total": 12,
    "page": 1,
    "limit": 50,
    "data": [
      {
        "id": "uuid",
        "action": "ORG_CREATE",
        "actor_id": "user-uuid",
        "target_type": "ORG",
        "target_id": "org-uuid",
        "target_name": "CIGEx",
        "details": null,
        "ip": "10.0.0.5",
        "user_agent": "Mozilla/5.0 ...",
        "created_at": "2026-01-15T10:30:00.000Z"
      }
    ]
  }
}
```

> **Atenção ao envelope aninhado:** a resposta é `{ data: { total, page, limit, data: [...] } }`. O
> array de eventos está em `response.data.data`; os metadados de paginação (`total`/`page`/`limit`)
> ficam em `response.data`. Os registros vêm ordenados por `created_at DESC` (mais recentes primeiro).

#### Erros

- `403 Forbidden`: usuário não-admin
- `422`: `actorId` não é UUID, ou `limit` > 200

#### Notas de integração no frontend

- Esta rota é **server-side paginated**. Converta a página 0-based da sua tabela para 1-based ao
  chamar a API.
- Para filtros tipo "todos", **omita** o param em vez de enviar `"all"`.

---

## Tratamento de Erros (consolidado)

Todas as rotas desta camada usam o envelope de erro padrão do backend:

```json
{ "error": { "code": "FORBIDDEN", "message": "..." } }
```

| Situação | Status | Código típico |
|----------|--------|---------------|
| Sem credencial em rota estrita | 401 | `UNAUTHORIZED` |
| Usuário autenticado mas sem role exigido | 403 | `FORBIDDEN` |
| Org/usuário inexistente | 404 | `NOT_FOUND` |
| `slug` de org duplicado | 409 | `CONFLICT` |
| Corpo/params inválidos (Joi) | 422 | `VALIDATION_ERROR` |

---

## Checklist de Implementação

- [ ] Tela de listagem/CRUD de organizações (escrita só para admin)
- [ ] Leitura de `organization_id` e `org_role` do `user` no login/refresh
- [ ] Derivar capacidades de UI a partir de `role` (global) + `org_role` (org-scoped)
- [ ] Suporte a tokens legados (sem claim de org → tratar `org_role` como `viewer`)
- [ ] Fluxo de rotação de API key (exibir a chave **uma única vez**)
- [ ] Envio de `x-api-key` em integrações máquina-a-máquina (não no browser)
- [ ] Tela de auditoria (admin): paginação 1-based, filtros opcionais, ler `data.data`

---

## Documentos Relacionados

- [01 - Autenticação](./01-autenticacao.md) - Login, refresh, registro e o JWT base
- [09 - Administração](./09-admin.md) - Gerenciamento de usuários e resources (roles, transferência de atlas)
- [11 - Segurança e Hardening](./11-seguranca-hardening.md) - Hardening, rate limiting, validação e política de tokens
- [../deploy/deploy.md](../deploy/deploy.md) - Variáveis de ambiente, JWT de emissor único, stores/volumes
