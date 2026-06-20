# 15 - Controle de Acesso Geográfico (Zonas)

Este documento cobre o controle de acesso geográfico aplicado aos dados read-only do gazetteer
(nomes geográficos, edificações) e do catálogo 3D. Para o frontend, o subsistema entrega duas
coisas: (1) os endpoints de leitura do gazetteer passam a **mostrar apenas o que o usuário pode
ver** — sem que o cliente precise filtrar nada; e (2) um **CRUD de administração de zonas-polígono**
(`/api/v1/zones`) com o qual um admin recorta áreas no mapa e concede acesso a usuários/grupos.

---

## Visão Geral

O acesso é desenhado como **polígono**. Cada feição do gazetteer carrega um `access_level`
(`public` ou `private`). Uma feição `public` é visível para todos; uma `private` só aparece para
quem tem direito a ela. O direito vem de três fontes, nesta ordem:

1. **Admin global** (usuário com `role = 'admin'`) — enxerga tudo. Nos endpoints de leitura do gazetteer o status de admin é re-verificado na tabela `users` dentro da própria query SQL (não pela claim do JWT); nas rotas `/api/v1/zones` o role do JWT é checado pelo middleware `requireAdmin`.
2. **Permissão direta de modelo** (apenas catálogo 3D — concessão linha a linha).
3. **Zona espacial** — o usuário tem permissão sobre uma **zona-polígono**, e a feição privada cai
   **dentro** dela (`ST_Contains`). Não há cadastro feição a feição: basta o ponto estar contido na
   zona. Uma feição nova já herda automaticamente a regra da zona que a contém.

> **Contrato congelado**: a autorização é **embutida na própria query SQL** (defesa em
> profundidade). Nenhuma linha privada chega ao resultado para ser filtrada no servidor ou no
> cliente — o dado não vaza nem com bug na camada de aplicação. O frontend **não** deve assumir que
> recebe registros privados e tentar escondê-los: eles simplesmente não vêm.

```
                       ┌─────────────────────────────────────────┐
 Usuário pede busca/   │  Predicado de acesso (no WHERE do SQL)   │
 identify/catálogo ───►│  public                                  │
                       │   OR admin global                        │
                       │   OR permissão direta (catálogo 3D)      │
                       │   OR ST_Contains(zona-do-usuário, feição)│
                       └─────────────────────────────────────────┘
                                        │
                                        ▼
                       Resultado já filtrado — só o visível
```

---

## 1. Como isso afeta os endpoints do gazetteer

Os três endpoints de leitura do gazetteer aplicam o filtro automaticamente, com base no usuário
autenticado (`Authorization: Bearer <accessToken>`). O detalhamento de request/response desses
endpoints está no documento de Nomes Geográficos; aqui interessa só **o efeito do acesso**.

| Endpoint | Efeito do controle de acesso |
|----------|------------------------------|
| `GET /api/v1/nomes/busca` | A busca de topônimos só ranqueia/retorna nomes que o usuário pode ver. O filtro entra **antes** do corte de resultados, então um nome `private` fora das zonas do usuário nunca aparece — nem em posições baixas. |
| `GET /api/v1/nomes/feicoes` | O *identify* (clique 3D numa edificação) só retorna a edificação se ela for `public` ou estiver numa zona do usuário. Caso contrário, responde como "nada encontrado" naquele ponto. |
| `GET /api/v1/nomes/catalogo3d` | O catálogo 3D lista só os modelos visíveis (`public`, permissão direta, via grupo, ou admin). O **`total` da paginação reflete apenas o visível** — o count usa exatamente o mesmo predicado da listagem, então a paginação nunca "mente" sobre quantos modelos existem. |

> **Contrato congelado**: o `total` do envelope de paginação do `/catalogo3d`
> (`{ total, page, nr_records, data }`) conta **apenas** os modelos que o usuário pode ver. Não use
> esse número para inferir a existência de modelos ocultos.

### Notas de integração no frontend

- **Nada a filtrar no cliente.** O servidor já entrega o conjunto autorizado. Renderize o que
  receber.
- **A visão depende de quem está logado.** O mesmo ponto do mapa pode retornar uma edificação para
  um usuário com a zona e "nada" para outro. Se o usuário trocar de conta (ou perder/ganhar uma
  permissão de zona), refaça as consultas — não há push de invalidação.
- **Anônimo só vê o público.** Na mecânica do SQL, sem usuário (`userId` nulo) sobram apenas as
  feições `public`. (Os endpoints do gazetteer hoje exigem login; o ramo anônimo existe como defesa
  em profundidade.)

---

## 2. Administração de Zonas (`/api/v1/zones`)

Todas as rotas de zona exigem **autenticação** (`Authorization: Bearer`) **e role `admin`**. Um
usuário comum recebe `403 FORBIDDEN`; sem token, `401 UNAUTHORIZED`.

A geometria da zona é sempre um **GeoJSON `Polygon`**, armazenado em SRID **4674** (mesmo datum dos
nomes geográficos). Antes de gravar, o backend valida a geometria com `ST_IsValid` — geometria
malformada ou topologicamente inválida (anel não-fechado, auto-interseção/"bowtie") é rejeitada com
`422`.

> **Contrato congelado**: `geom` é um GeoJSON `Polygon` em **SIRGAS 2000 / EPSG 4674** — pares
> `[longitude, latitude]`, anel externo fechado (primeiro ponto = último ponto). A orientação do
> anel não é exigida (a validação usa apenas `ST_IsValid`). Não envie `MultiPolygon` nem
> `Feature`/`FeatureCollection`: apenas o objeto de geometria `Polygon`.

---

### 2.1 Listar zonas

#### Endpoint

`GET /api/v1/zones`

#### Headers

`Authorization: Bearer <accessToken>` (admin)

#### Response (200)

A listagem **não** retorna a geometria (campo pesado) — apenas os metadados.

```json
{
  "data": [
    {
      "id": "8f3b1c2a-...",
      "name": "Área de Operações Norte",
      "description": "Zona de acesso restrito da operação",
      "created_at": "2026-06-20T13:45:00.000Z"
    },
    {
      "id": "1a2b3c4d-...",
      "name": "Quartel-General",
      "description": null,
      "created_at": "2026-06-18T09:10:00.000Z"
    }
  ]
}
```

---

### 2.2 Obter uma zona (com geometria)

#### Endpoint

`GET /api/v1/zones/:id`

#### Response (200)

Aqui a geometria vem embutida como GeoJSON (`ST_AsGeoJSON`).

```json
{
  "data": {
    "id": "8f3b1c2a-...",
    "name": "Área de Operações Norte",
    "description": "Zona de acesso restrito da operação",
    "created_at": "2026-06-20T13:45:00.000Z",
    "geom": {
      "type": "Polygon",
      "coordinates": [
        [
          [-47.95, -15.80],
          [-47.85, -15.80],
          [-47.85, -15.70],
          [-47.95, -15.70],
          [-47.95, -15.80]
        ]
      ]
    }
  }
}
```

#### Erros

- `404 NOT_FOUND` — zona inexistente.
- `422 VALIDATION_ERROR` — `:id` não é um UUID válido.

---

### 2.3 Criar zona

#### Endpoint

`POST /api/v1/zones`

#### Request

```json
{
  "name": "Área de Operações Norte",
  "description": "Zona de acesso restrito da operação",
  "geom": {
    "type": "Polygon",
    "coordinates": [
      [
        [-47.95, -15.80],
        [-47.85, -15.80],
        [-47.85, -15.70],
        [-47.95, -15.70],
        [-47.95, -15.80]
      ]
    ]
  }
}
```

| Campo | Obrigatório | Regras |
|-------|-------------|--------|
| `name` | Não | string, máx. 100 caracteres (aceita `null`/vazio) |
| `description` | Não | string (aceita `null`/vazio) |
| `geom` | **Sim** | GeoJSON `Polygon` válido (`ST_IsValid`) |

#### Response (201)

A resposta **não** ecoa a geometria — apenas os metadados criados. Use `GET /zones/:id` se precisar
da geometria de volta.

```json
{
  "data": {
    "id": "8f3b1c2a-...",
    "name": "Área de Operações Norte",
    "description": "Zona de acesso restrito da operação",
    "created_at": "2026-06-20T13:45:00.000Z"
  }
}
```

#### Erros

- `401 UNAUTHORIZED` — sem token.
- `403 FORBIDDEN` — não-admin.
- `422 VALIDATION_ERROR` — corpo fora do schema (Joi) **ou** geometria inválida (`ST_IsValid`).

Exemplo de erro de geometria inválida (anel auto-interseccionante):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid zone geometry (ST_IsValid failed)"
  }
}
```

---

### 2.4 Atualizar zona (substituição completa)

`PUT` substitui **todo** o registro (`name`, `description`, `geom`) — é replace, não merge. Campos
omitidos viram `null` no schema, então envie sempre o estado completo desejado.

#### Endpoint

`PUT /api/v1/zones/:id`

#### Request

```json
{
  "name": "Área de Operações Norte (revisada)",
  "description": "Polígono expandido após reconhecimento",
  "geom": {
    "type": "Polygon",
    "coordinates": [
      [
        [-48.00, -15.85],
        [-47.80, -15.85],
        [-47.80, -15.65],
        [-48.00, -15.65],
        [-48.00, -15.85]
      ]
    ]
  }
}
```

#### Response (200)

```json
{
  "data": {
    "id": "8f3b1c2a-...",
    "name": "Área de Operações Norte (revisada)",
    "description": "Polígono expandido após reconhecimento",
    "created_at": "2026-06-20T13:45:00.000Z"
  }
}
```

#### Erros

- `404 NOT_FOUND` — zona inexistente.
- `422 VALIDATION_ERROR` — corpo fora do schema **ou** geometria inválida (`ST_IsValid`).

> **Nota de integração**: alterar o polígono de uma zona **redefine na hora** quais feições privadas
> caem dentro dela (o filtro é calculado por consulta via `ST_Contains`). Não há reprocessamento nem
> cache a invalidar — a próxima busca já reflete o novo recorte.

---

### 2.5 Deletar zona

#### Endpoint

`DELETE /api/v1/zones/:id`

#### Response

`204 No Content`

Deletar a zona remove em cascata todas as suas permissões (de usuário e de grupo). As feições em si
**não** são tocadas — apenas deixam de estar cobertas por essa zona.

#### Erros

- `404 NOT_FOUND` — zona inexistente.

---

## 3. Permissões de Zona

Cada zona tem um conjunto de **usuários** e de **grupos** que recebem acesso a tudo o que estiver
geograficamente contido nela. Os grupos referenciam a membresia mantida no servidor (ver §5,
follow-up).

### 3.1 Consultar permissões da zona

#### Endpoint

`GET /api/v1/zones/:id/permissions`

#### Response (200)

Arrays de UUIDs — `users` (permissão direta) e `groups` (permissão via grupo).

```json
{
  "data": {
    "users": [
      "u-1111-...",
      "u-2222-..."
    ],
    "groups": [
      "g-aaaa-..."
    ]
  }
}
```

---

### 3.2 Definir permissões da zona (replace-set)

`PUT` faz **substituição completa do conjunto** (replace-set), não incremento. O array enviado passa
a ser a verdade absoluta: usuários/grupos ausentes do array são **removidos**.

> **Contrato congelado**: enviar `[]` (array vazio) significa **"remover todos"** — é intencional.
> Para acrescentar um usuário sem perder os existentes, leia primeiro com
> `GET /zones/:id/permissions`, acrescente ao array, e mande o conjunto inteiro de volta.

A operação roda numa **única transação**: lê o estado anterior, apaga tudo, reinsere o novo conjunto
e registra a auditoria do diff (`before`/`after`) na mesma transação — tudo confirma junto ou nada
confirma.

#### Endpoint

`PUT /api/v1/zones/:id/permissions`

#### Request

```json
{
  "users": [
    "u-1111-...",
    "u-3333-..."
  ],
  "groups": [
    "g-aaaa-..."
  ]
}
```

| Campo | Obrigatório | Regras |
|-------|-------------|--------|
| `users` | Não (default `[]`) | array de UUIDs de usuário |
| `groups` | Não (default `[]`) | array de UUIDs de grupo |

#### Response (200)

Ecoa o conjunto efetivado.

```json
{
  "data": {
    "users": [
      "u-1111-...",
      "u-3333-..."
    ],
    "groups": [
      "g-aaaa-..."
    ]
  }
}
```

#### Fluxo

```
Admin                            Backend
  |                                 |
  |-- GET /zones/:id/permissions -->|  (1) lê o conjunto atual
  |<-- { users, groups } -----------|
  |                                 |
  [edita o conjunto na UI]          |
  |                                 |
  |-- PUT /zones/:id/permissions -->|  (2) replace-set numa transação:
  |   { users, groups }             |       - lê 'before'
  |                                 |       - apaga user/group perms
  |                                 |       - reinsere o novo conjunto
  |                                 |       - audita o diff (before/after)
  |<-- 200 { users, groups } -------|
  |                                 |
  [as buscas dos usuários afetados  |
   já refletem o novo acesso]       |
```

> **Auditoria**: a alteração de permissões gera um registro de auditoria de negócio
> (`action: PERMISSION_GRANT`, `target_type: ZONE`) com o diff `before`/`after`, consultável pelo
> endpoint de auditoria de admin. Veja [09 - Admin](./09-admin.md).

---

## 4. Tratamento de Erros (resumo)

Os endpoints de zona usam o envelope de erro padrão da API: `{ "error": { "code", "message" } }`.

| Status | `code` | Quando |
|--------|--------|--------|
| `401` | `UNAUTHORIZED` | Requisição sem `Authorization: Bearer` válido |
| `403` | `FORBIDDEN` | Usuário autenticado mas sem role `admin` |
| `404` | `NOT_FOUND` | `:id` de zona inexistente (GET/PUT/DELETE) |
| `422` | `VALIDATION_ERROR` | Corpo fora do schema Joi, `:id` não-UUID, **ou** geometria reprovada no `ST_IsValid` |

Erros de schema Joi trazem `details` com `field`/`message` por campo; o erro de `ST_IsValid` é uma
mensagem única (`Invalid zone geometry (ST_IsValid failed)` ou `Invalid GeoJSON geometry`).

---

## 5. Follow-ups (ainda não implementados)

Dois pontos da modelagem têm infraestrutura no banco mas **não** têm endpoints REST ainda:

- **Permissões de modelo 3D por API** — conceder acesso a um modelo específico do catálogo 3D
  (permissão direta / por grupo) e alternar o `access_level` do modelo. Hoje o filtro de leitura já
  respeita essas permissões, mas a concessão é feita direto no banco.
- **Módulo de grupos/membresia** — CRUD de grupos e gestão de quem pertence a cada grupo. O acesso
  via grupo funciona quando as linhas existem no banco, mas não há rotas para gerenciá-las.

Esses itens estão catalogados no documento de pendências e desvios — consulte
[99 - Pendências](./99-pendencias-e-desvios.md).

---

## Checklist de Implementação (frontend)

- [ ] Não filtrar registros privados no cliente (o backend já entrega o conjunto autorizado)
- [ ] Refazer buscas ao trocar de usuário / após mudança de permissão de zona
- [ ] Usar `total` do `/catalogo3d` apenas para paginação do visível
- [ ] Editor de zona desenhando GeoJSON `Polygon` (4674, anel fechado, lon/lat)
- [ ] Tratar `422` de geometria inválida com mensagem ao usuário (polígono auto-interseccionante)
- [ ] Telas de zona/permissões restritas a admin (esconder de não-admin; tratar `403`)
- [ ] Fluxo read-modify-write em permissões (PUT é replace-set; `[]` remove todos)
- [ ] Confirmar exclusão de zona (DELETE remove permissões em cascata)

---

## Documentos Relacionados

- [09 - Admin](./09-admin.md) — gerenciamento de usuários e trilha de auditoria
- [99 - Pendências](./99-pendencias-e-desvios.md) — follow-ups (permissões de modelo 3D, grupos/membresia)
- [../../README.md](../../README.md) — índice da documentação
- [../deploy/deploy.md](../deploy/deploy.md) — PostGIS, schema `ng` e carga de dados
