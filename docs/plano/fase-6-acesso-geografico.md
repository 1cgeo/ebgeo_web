# Fase 6 — Controle de acesso geográfico e permissões de modelo

> **✅ STATUS: IMPLEMENTADA (núcleo de segurança).** Migração `017_geographic_access.sql`
> (`ng.groups` entidade; `geographic_access_zones`[4674] + `zone_permissions`/`zone_group_permissions`;
> `access_level` em `nomes`/`edificacoes`; predicado único `ng.fn_user_zone_geoms`; índices parciais +
> STATISTICS; FK física de `model_group_permissions`). Autorização **embutida no SQL** da busca de nomes
> (`BUSCA`) e do identify (`FEICOES`, com `ST_Transform` 4674→4326) e do catálogo 3D (Fase 4); **teste
> negativo obrigatório verde** (privado oculto sem zona). Admin de zonas `/api/v1/zones` (CRUD +
> replace-set de permissões + auditoria `PERMISSION_GRANT` transacional). Suite verde (635).
> **Reconciliação:** `ng.user_groups` permanece a tabela de **membresia** (criada na Fase 4 e usada pela
> query do catálogo); `ng.groups` é a entidade de grupo desta fase. **Follow-ups:** endpoints de admin de
> permissão de modelo 3D (`PUT /catalogo3d/:id/permissions`) e um módulo de grupos/membresia completo (a
> infra de tabelas/FK e o filtro já existem; permissão direta de modelo já testada em `catalogo3d-access`).
> **Depende de:** fase-3 (PostGIS + schema `ng` + gazetteer), fase-5 (multi-org + `audit_trail`/`createAudit`), fase-4 (model_permissions).
> **Esforço:** Alto.
> **Leia antes:** [`_padroes.md`](_padroes.md) e [`00-visao-geral.md`](00-visao-geral.md). Material verbatim de referência em [`99-referencia.md`](99-referencia.md).

---

## 1. Objetivo & contexto

O gazetteer (fase-3) e o catálogo 3D (fase-4) tornam-se **fontes de verdade de dados geoespaciais
read-only** servidas a múltiplas organizações. Nem todo nome geográfico ou modelo 3D é público:
parte do acervo é sensível e só pode aparecer para quem tem permissão. Esta fase implementa o
**controle de acesso geográfico** sobre esses dados imutáveis.

Há **dois eixos de acesso**, com a **mesma mecânica**:

1. **Acesso geográfico por zona espacial** — em vez de cadastrar permissão linha a linha para cada
   topônimo/edificação, define-se **zonas-polígono** (`geographic_access_zones`). Um usuário com
   permissão sobre uma zona enxerga **toda feição cuja geometria esteja contida** na zona
   (`ST_Contains(zona.geom, feicao.geom)`). Feições novas que caiam dentro da zona herdam o acesso
   automaticamente — **sem cadastro incremental**.
2. **Permissão de modelo 3D** — cada modelo (`ng.catalogo_3d`, fase-4) tem `access_level`
   (`public`/`private`) na própria linha, mais junções usuário-modelo e grupo-modelo.

**Decisão de arquitetura central (defesa em profundidade): a autorização é EMBUTIDA na própria
query SQL.** O predicado de acesso (`public OR admin OR direto OR via-grupo`) entra na cláusula
`WHERE`/`JOIN` da busca. O dado **não vaza nem que a app tenha um bug** na camada de controller —
não existe caminho onde uma linha privada chega ao `SELECT` final e depois é filtrada em JS. O
protótipo `ebgeo_web_2_backend` validou essa abordagem, mas duplicou o CTE de autorização em 4
lugares (risco de divergência quando uma regra muda). **Aqui o predicado é encapsulado numa
função/view SQL única** e reusado.

Esta fase **não** altera o domínio colaborativo (atlas/JSONB/sync). O `atlas_shares`
(`002_atlas.sql:54-66`) continua sendo a ACL por-atlas, ortogonal e intocada. O controle aqui é
sobre o schema `ng` (PostGIS, read-only).

---

## 2. Pré-requisitos / dependências de outras fases

| Pré-requisito | Origem | Por quê |
|---------------|--------|---------|
| Extensão `postgis` + schema `ng` | **fase-3** | Zonas usam `GEOMETRY(POLYGON, ...)` + índice GIST e `ST_Contains`. Sem PostGIS nada disto compila. |
| `ng.nomes_geograficos` (`geom`, `search_vector`) e `SEARCH_GEOGRAPHIC_NAMES` | **fase-3** | O filtro de zona é injetado **dentro** da query de busca de 7 critérios já existente. |
| `ng.catalogo_3d` (`access_level`, `search_vector`, `data_carregamento`) + `ng.model_permissions` + `ng.model_group_permissions` | **fase-4** (`009_model_permissions.sql`) | A **fase-4 é dona** dessas tabelas/coluna (criadas com `IF NOT EXISTS` + stub `user_groups`). A Tarefa 6 desta fase **não as recria**: só adiciona a FK física de grupo + o predicado SQL. Se a fase-4 ainda não rodou, a Tarefa 6 fica pendente até lá (as zonas — Tarefas 1–5 — não dependem do 3D). |
| `ng.users` (ou `users`) com coluna `role` | **fase-1 (`001_core.sql`)** / **fase-5** | O bypass de admin lê `role='admin'`. **Atenção ao schema:** hoje a tabela é `users` (schema default). A fase-3/5 pode movê-la para `ng.users` ou criar synonym. **Antes de escrever as FKs/queries, confirme o nome qualificado real** (`\dt ng.users` vs `\dt public.users`) e use o que existir. Os blocos verbatim abaixo usam `ng.users` — ajuste para `users` se a tabela não foi movida. |
| `user_groups` + `user_group_members` | **fase-5** se já existirem; **senão, Tarefa 0 desta fase as cria** | As junções `*_group_permissions` referenciam grupos de usuários. Ver Tarefa 0. |
| `createAudit(req, params, t?)` + `audit_trail` | **fase-5** | A escrita de permissões audita o diff na mesma transação. |
| `gen_random_uuid()` (pgcrypto) | **fase-1 (`001_core.sql:7`)** | PKs. Não usar `uuid_generate_v4`. |

> **Ordem de migração** (conforme `_padroes.md` §7): `... → organizations + user_groups → zones/permissions → model_permissions → audit_trail/api_keys`. Esta fase escreve as migrações de **zones/permissions** (Tarefas 1–7); as tabelas de **model_permissions** já são da **fase-4** (`009_model_permissions.sql`) — aqui só se acrescenta a FK física de grupo + o predicado SQL (Tarefa 6), sem recriá-las. Se `user_groups` não veio da fase-5, a Tarefa 0 a antecede.

---

## 3. Decisões de arquitetura aplicáveis

1. **Autorização embutida na query (defesa em profundidade).** O predicado de acesso vive no SQL,
   não no controller. Nenhuma linha privada chega ao resultado para ser filtrada depois.
2. **Predicado único, não duplicado.** O CTE de autorização é encapsulado numa **função SQL**
   (`ng.fn_user_can_see_model(...)` / `ng.fn_user_zone_geoms(...)`) ou **view parametrizada por
   `set_config`** — escolha em Tarefa 6, com recomendação. Toda query (busca + count) chama o mesmo
   predicado. Quando uma regra muda, muda **num lugar**.
3. **Acesso por conteinência espacial, não por linha.** Zona = polígono. Permissão é sobre a zona;
   a feição é alcançada por `ST_Contains`. Escala sem cadastro incremental.
4. **`access_level` na própria linha** como flag de 1ª alavanca (`public`/`private`), `CHECK`
   constraint. Bypass de admin por `role`. Duas junções (usuário-recurso, grupo-recurso) como 2ª e
   3ª alavancas.
5. **Count alinhado ao filtro.** O `COUNT_*` **repete exatamente** o mesmo predicado de acesso da
   busca, sempre antes do `LIMIT`. Paginação não mente: `total` reflete só o que o usuário pode ver.
6. **Anônimo é caso natural, não exceção.** Quando `$userId IS NULL`, a CTE de zonas/permissões
   retorna vazia e **só sobram os `public`**. Nenhum ramo especial em JS.
7. **Índices parciais para a fatia quente.** `WHERE access_level='public'` (a maioria das leituras)
   + `ALTER COLUMN access_level SET STATISTICS 1000` para o planner estimar bem a seletividade.
8. **Escrita de permissões transacional com replace-set.** Substituir o conjunto de permissões =
   `DELETE` total + `INSERT...SELECT`, dentro de `tx()`, com auditoria do **diff** (adicionados /
   removidos) via `createAudit(req, ..., t)`. Reconciliação de membros de grupo via CTE `EXCEPT`.
9. **Aditivo e read-only.** Tudo aqui é leitura de `ng` + administração de ACL. Não toca atlas,
   sync nem o caminho anônimo do frontend colaborativo.

---

## 4. Tarefas

### Tarefa 0: Garantir `user_groups` + `user_group_members` (pré-dependência)

**Objetivo:** As junções `zone_group_permissions` e `model_group_permissions` referenciam grupos de
usuários. Se a fase-5 já criou `user_groups`/`user_group_members`, **pular esta tarefa**. Caso
contrário, criá-las aqui antes das migrações de permissão.

**Arquivos afetados:**
- `src/database/migrations/0NN_user_groups.sql` (criar — **só se ausente**; numerar conforme head atual)

**Padrão de código:** `_padroes.md` §7 (junções N:N: PK composta + `ON DELETE CASCADE` + índice no outro sentido).

**Implementação:**
1. Verificar no banco se já existem (`\dt user_groups`). Se sim, **não criar migração** — apenas documentar a dependência satisfeita.
2. Se ausente, criar:
```sql
-- 0NN_user_groups.sql
CREATE TABLE IF NOT EXISTS ng.user_groups (
    group_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    created_by  UUID REFERENCES ng.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ng.user_group_members (
    group_id UUID NOT NULL REFERENCES ng.user_groups(group_id) ON DELETE CASCADE,
    user_id  UUID NOT NULL REFERENCES ng.users(id)             ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_group_members_user ON ng.user_group_members(user_id);
```
> O CTE verbatim de catálogo usa `JOIN ng.user_groups ug ON mgp.group_id = ug.group_id WHERE ug.user_id = $4`. Isso pressupõe que **`ng.user_groups` carregue a membresia** ou que a junção seja com `user_group_members`. **Padronize:** o membership está em `user_group_members`; os CTEs verbatim que escrevem `ng.user_groups ug ON ... WHERE ug.user_id` devem ser ajustados para `ng.user_group_members ugm ON mgp.group_id = ugm.group_id WHERE ugm.user_id = $4`. Documente a escolha no topo da migração de permissões.

**Critérios de aceitação:**
- [ ] `user_groups` e `user_group_members` existem (criadas aqui ou pela fase-5).
- [ ] Membresia consultável por `user_id` com índice dedicado.

**Testes:** coberto indiretamente pelos testes de via-grupo das Tarefas 4 e 6.

**Dependências:** fase-5 (preferencial). Bloqueia Tarefas 2, 4, 6.

---

### Tarefa 1: Migração das zonas geográficas e tabelas de permissão de zona

**Objetivo:** Criar `geographic_access_zones` (polígono + GIST) e as duas junções de permissão de
zona (usuário e grupo), com PK composta, FK `ON DELETE CASCADE` e índice nos dois sentidos.

**Arquivos afetados:**
- `src/database/migrations/0NN_geographic_zones.sql` (criar)

**Padrão de código:** `_padroes.md` §7 (junções N:N; índices parciais; SRID explícito). Migração aditiva forward-only.

**Implementação (SQL — preservar verbatim o núcleo):**
```sql
-- 0NN_geographic_zones.sql

-- Zonas de acesso (polígono). SRID 4674 (SIRGAS 2000), alinhado a ng.nomes_geograficos.
CREATE TABLE ng.geographic_access_zones (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100),
    description TEXT,
    geom        GEOMETRY(POLYGON, 4674) NOT NULL,
    created_by  UUID REFERENCES ng.users(id),
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_zones_geom ON ng.geographic_access_zones USING GIST (geom);

-- Permissão direta usuário -> zona
CREATE TABLE ng.zone_permissions (
    zone_id UUID NOT NULL REFERENCES ng.geographic_access_zones(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES ng.users(id)                   ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (zone_id, user_id)
);
CREATE INDEX idx_zone_permissions_user ON ng.zone_permissions(user_id);

-- Permissão grupo -> zona
CREATE TABLE ng.zone_group_permissions (
    zone_id  UUID NOT NULL REFERENCES ng.geographic_access_zones(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES ng.user_groups(group_id)       ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (zone_id, group_id)
);
CREATE INDEX idx_zone_group_permissions_group ON ng.zone_group_permissions(group_id);
```

> **Por que `4674`?** É o SRID dos nomes geográficos (`GEOMETRY(POINT,4674)`, ver glossário em
> `00-visao-geral.md`). `ST_Contains` exige **mesmo SRID** entre zona e ponto. Se a fase-3 tiver
> definido os pontos em **4326**, troque o tipo da zona para `GEOMETRY(POLYGON, 4326)` ou aplique
> `ST_Transform`. **Confirme o SRID real de `ng.nomes_geograficos.geom` na fase-3 antes de fixar.**

**Critérios de aceitação:**
- [ ] As três tabelas existem com PK composta nas junções e `ON DELETE CASCADE`.
- [ ] Índice GIST em `geom`; índice no sentido `user_id`/`group_id` em cada junção.
- [ ] SRID da zona idêntico ao SRID de `ng.nomes_geograficos.geom` (validado).
- [ ] Deletar uma zona remove em cascata suas permissões; deletar um usuário/grupo remove suas permissões.

**Testes:**
- `tests/integration/zones-schema.test.js`: inserir zona + permissão; deletar zona → permissões somem; `ST_Contains` retorna `true` para ponto dentro e `false` para fora.

**Dependências:** fase-3 (PostGIS/`ng`), Tarefa 0 (`user_groups`).

---

### Tarefa 2: Predicado de zonas reutilizável (CTE de zonas do usuário)

**Objetivo:** Encapsular "as geometrias de zona que o usuário pode ver" num fragmento SQL único
(`user_zones`), combinando permissões diretas e via-grupo, para que a busca de nomes e o count usem
**a mesma** definição.

**Arquivos afetados:**
- `src/modules/nomes/nomes.queries.js` (modificar — adicionar o CTE ao SQL de busca e count)
- (opcional) `src/database/migrations/0NN_zone_access_fn.sql` (criar — se optar por função SQL; ver recomendação)

**Padrão de código:** `_padroes.md` §1 (queries nomeadas), §8 (SQL parametrizado).

**Implementação — CTE `user_zones` (verbatim a embutir):**
```sql
-- Resolve as geometrias de zona visíveis para o usuário $4 (NULL = anônimo).
-- Combina permissão direta (zone_permissions) e via-grupo (zone_group_permissions).
WITH user_zones AS (
    SELECT z.id, z.geom
    FROM ng.geographic_access_zones z
    WHERE $4::UUID IS NOT NULL AND (
        EXISTS (SELECT 1 FROM ng.zone_permissions zp
                WHERE zp.zone_id = z.id AND zp.user_id = $4)
        OR EXISTS (SELECT 1 FROM ng.zone_group_permissions zgp
                   JOIN ng.user_group_members ugm ON ugm.group_id = zgp.group_id
                   WHERE zgp.zone_id = z.id AND ugm.user_id = $4)
    )
)
-- ... query principal usa: LEFT JOIN user_zones uz ON ST_Contains(uz.geom, n.geom)
```
> Para `$4 IS NULL` (anônimo) o `WHERE $4::UUID IS NOT NULL AND (...)` é sempre falso → `user_zones`
> vazia → no `LEFT JOIN`, `uz.id` é sempre `NULL` → o ramo de zona não admite nenhuma linha privada,
> e só os `public` (admitidos pelo outro ramo do `WHERE`, ver Tarefa 3) sobrevivem.

**Recomendação — função vs CTE inline:**
- **Recomendado: função SQL** `ng.fn_user_zone_geoms(p_user UUID) RETURNS TABLE(id UUID, geom geometry)` contendo o `SELECT` acima. As queries fazem `LEFT JOIN ng.fn_user_zone_geoms($4) uz ON ST_Contains(uz.geom, n.geom)`. **Vantagem:** uma só definição, impossível divergir entre busca e count. **Custo:** uma migração a mais.
- **Alternativa: CTE inline** repetido em `SEARCH_GEOGRAPHIC_NAMES` e `COUNT_GEOGRAPHIC_NAMES`. **Vantagem:** zero objeto novo no banco. **Custo:** o fragmento aparece em 2 lugares — exatamente o anti-padrão de duplicação que esta fase combate. Se escolher esta via, mantenha o fragmento numa **constante JS compartilhada** (`USER_ZONES_CTE`) concatenada em ambas as queries, nunca copiada à mão.

**Critérios de aceitação:**
- [ ] Existe **uma** fonte do predicado de zona (função SQL ou constante JS), referenciada por busca **e** count.
- [ ] Para usuário com permissão direta e para usuário só via-grupo, as zonas corretas aparecem.
- [ ] Para anônimo, `user_zones`/`fn_user_zone_geoms` retorna vazio.

**Testes:**
- `tests/integration/zone-predicate.test.js`: 3 usuários (direto, via-grupo, sem nada) + anônimo; verificar conjunto de zonas resolvidas.

**Dependências:** Tarefa 1, Tarefa 0.

---

### Tarefa 3: Filtro espacial de acesso na busca de nomes geográficos

**Objetivo:** Injetar o filtro de zona na busca de 7 critérios (`SEARCH_GEOGRAPHIC_NAMES`, fase-3),
de modo que um nome **privado** só apareça se estiver contido numa zona do usuário, e que `public`
sempre apareça. Sem alterar o contrato de resposta (shape congelado, ver `99-referencia.md`).

**Arquivos afetados:**
- `src/modules/nomes/nomes.queries.js` (modificar — `SEARCH_GEOGRAPHIC_NAMES`)
- `src/modules/nomes/nomes.service.js` (modificar — passar `userId` como parâmetro)
- `src/modules/nomes/nomes.controller.js` (modificar — `req.user?.id ?? null` → service)
- `src/modules/nomes/nomes.routes.js` (modificar — usar `optionalAuth` em vez de `auth`, se a busca é pública para `public`)

**Padrão de código:** `_padroes.md` §8 (filtro de acesso embutido + teste de usuário sem permissão); `optional-auth.js` para o caminho anônimo.

**Implementação:**
1. A busca passa a receber `$userId` (novo placeholder — renumere os `$n` existentes com cuidado; o CTE verbatim usa `$4` para o usuário, mantenha consistência com o resto da query da fase-3).
2. Acrescentar o ramo de zona ao `WHERE` (verbatim do material de referência):
```sql
WITH user_zones AS ( ... )  -- (Tarefa 2; ou LEFT JOIN ng.fn_user_zone_geoms($userId))
SELECT n.*, ...
FROM ng.nomes_geograficos n
LEFT JOIN user_zones uz ON ST_Contains(uz.geom, n.geom)
WHERE
  -- ramo de acesso: público OU dentro de uma zona do usuário
  (n.access_level = 'public' OR uz.id IS NOT NULL)
  -- ... os 7 critérios de busca da fase-3 continuam aqui (AND ...) ...
ORDER BY ...
LIMIT $limit OFFSET $offset;
```
> **Pré-requisito de dado:** `ng.nomes_geograficos` precisa de uma coluna `access_level VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (access_level IN ('public','private'))`. Se a fase-3 não a criou, **adicione-a numa migração desta fase** (`ALTER TABLE ng.nomes_geograficos ADD COLUMN access_level ...`) + índice parcial (Tarefa 7). Sem essa coluna, todo nome é tratado como público (degradação segura, mas não atende o requisito de não-vazamento).
3. **Nenhum filtro em JS.** O service só repassa `userId` e os critérios; o controller não filtra resultado.

**Critérios de aceitação:**
- [ ] Nome `private` dentro de zona do usuário **aparece**; mesmo nome para usuário sem a zona **não aparece**.
- [ ] Nome `public` aparece para qualquer um, inclusive anônimo.
- [ ] Anônimo (`userId NULL`) nunca vê `private`.
- [ ] Admin (`role='admin'`) vê tudo (ramo de admin — ver nota abaixo).
- [ ] O shape de resposta da busca é idêntico ao da fase-3 (contrato congelado).

> **Bypass de admin na busca de nomes:** o CTE verbatim de catálogo (Tarefa 6) já tem o ramo
> `ur.is_admin`. Para os nomes, adicione um ramo equivalente: `($4 IS NOT NULL AND EXISTS(SELECT 1
> FROM ng.users WHERE id=$4 AND role='admin'))` no `WHERE` de acesso, ou inclua a CTE `user_role`.
> **Recomendação:** unificar — uma única função `ng.fn_user_can_see(...)` por recurso é o ideal;
> no mínimo, mesma estrutura de ramos (`public OR admin OR direto OR via-grupo`) nos dois recursos.

**Testes:**
- `tests/integration/nomes-access.test.js`: usuário-com-zona vê privado dentro / não vê fora; anônimo só público; admin vê tudo; **caso negativo obrigatório** (`_padroes.md` §9): usuário sem permissão NÃO recebe a linha privada no JSON.

**Dependências:** Tarefa 2; fase-3 (busca + `access_level` em nomes).

---

### Tarefa 4: Count alinhado ao filtro de acesso

**Objetivo:** Garantir que o `COUNT_GEOGRAPHIC_NAMES` (paginação `total`) aplique **exatamente** o
mesmo predicado de acesso da busca — antes do `LIMIT`. Paginação não pode contar linhas que o
usuário não verá.

**Arquivos afetados:**
- `src/modules/nomes/nomes.queries.js` (modificar — `COUNT_GEOGRAPHIC_NAMES`)
- `src/modules/nomes/nomes.service.js` (modificar — passar `userId` ao count)

**Padrão de código:** `_padroes.md` §8/§9.

**Implementação:**
1. O count reusa o **mesmo** predicado (mesma função `fn_user_zone_geoms`/`fn_user_can_see` ou mesma constante `USER_ZONES_CTE`):
```sql
WITH user_zones AS ( ... )  -- idêntico ao da busca
SELECT COUNT(*) AS total
FROM ng.nomes_geograficos n
LEFT JOIN user_zones uz ON ST_Contains(uz.geom, n.geom)
WHERE (n.access_level = 'public' OR uz.id IS NOT NULL)
  AND ( /* mesmos 7 critérios */ );
-- SEM LIMIT/OFFSET
```
2. Se a Tarefa 2 escolheu **função SQL**, busca e count chamam a mesma função — divergência impossível.

**Critérios de aceitação:**
- [ ] `total` do count == número de linhas que a busca retornaria sem `LIMIT`, para o mesmo usuário/critérios.
- [ ] Para anônimo, `total` conta só os `public` que casam os critérios.
- [ ] Não há ramo de acesso no count diferente do da busca.

**Testes:**
- `tests/integration/nomes-count.test.js`: inserir N públicas + M privadas (parte dentro da zona do usuário); assert `total` por usuário/anônimo bate com a contagem visível.

**Dependências:** Tarefa 3.

---

### Tarefa 5: Endpoints de administração de zonas

**Objetivo:** CRUD de zonas + atribuição de permissões de zona (usuário e grupo), restrito a admin.
Estes endpoints são consumidos pela **UI de admin** (projeto frontend separado — ver
`99-referencia.md`; aqui só provemos a API).

**Arquivos afetados:**
- `src/modules/zones/zones.routes.js` (criar)
- `src/modules/zones/zones.controller.js` (criar)
- `src/modules/zones/zones.service.js` (criar)
- `src/modules/zones/zones.queries.js` (criar)
- `src/modules/zones/zones.schemas.js` (criar)
- `src/modules/zones/index.js` (criar)
- `src/app.js` (modificar — montar `/api/v1/zones` com `auth` + `requireAdmin`)

**Padrão de código:** template canônico `_padroes.md` §1; `require-admin.js` existente; `asyncHandler`; escrita transacional `_padroes.md` §4/§8.

**Endpoints (contrato para a UI de admin):**

| Método | Rota | Descrição | Auth |
|--------|------|-----------|------|
| GET | `/api/v1/zones` | Listar zonas (sem `geom` pesada; ou GeoJSON sob `?geometry=true`) | Admin |
| POST | `/api/v1/zones` | Criar zona (`{name, description, geom}` GeoJSON Polygon) | Admin |
| GET | `/api/v1/zones/:id` | Obter zona (com `geom` GeoJSON) | Admin |
| PUT | `/api/v1/zones/:id` | Atualizar `name`/`description`/`geom` | Admin |
| DELETE | `/api/v1/zones/:id` | Remover zona (cascata nas permissões) | Admin |
| GET | `/api/v1/zones/:id/permissions` | Listar usuários + grupos com acesso | Admin |
| PUT | `/api/v1/zones/:id/permissions` | **Replace-set** de `{users:[uuid], groups:[uuid]}` | Admin |

**Implementação:**
1. `geom` entra/sai como **GeoJSON**; converter na borda do SQL com `ST_GeomFromGeoJSON($1)` na escrita e `ST_AsGeoJSON(geom)` na leitura. Validar SRID e fechamento do anel no Joi (`zones.schemas.js`) o quanto possível; rejeitar geometria inválida com `ST_IsValid`.
2. `PUT /:id/permissions` é o replace-set transacional (ver Tarefa abaixo de escrita; reusar o mesmo padrão):
```javascript
// zones.service.js
export async function setZonePermissions(req, zoneId, { users, groups }) {
  return tx(async (t) => {
    const before = await t.any(Q.GET_ZONE_PERMS, [zoneId]);
    await t.none(Q.DELETE_ZONE_USER_PERMS, [zoneId]);
    await t.none(Q.DELETE_ZONE_GROUP_PERMS, [zoneId]);
    if (users?.length)  await t.none(Q.INSERT_ZONE_USER_PERMS,  [zoneId, users]);   // INSERT...SELECT unnest($2::uuid[])
    if (groups?.length) await t.none(Q.INSERT_ZONE_GROUP_PERMS, [zoneId, groups]);
    const after = await t.any(Q.GET_ZONE_PERMS, [zoneId]);
    await createAudit(req, { action: 'zone.permissions.replace', target: zoneId,
                             diff: computeDiff(before, after) }, t);  // mesma tx
    return after;
  });
}
```
3. `INSERT...SELECT unnest($2::uuid[])` evita N round-trips:
```sql
-- INSERT_ZONE_USER_PERMS
INSERT INTO ng.zone_permissions (zone_id, user_id)
SELECT $1, u FROM unnest($2::uuid[]) AS u
ON CONFLICT DO NOTHING;
```

**Critérios de aceitação:**
- [ ] Não-admin recebe 403 em todas as rotas (`requireAdmin`).
- [ ] `POST`/`PUT` validam GeoJSON Polygon e rejeitam geometria inválida (`ST_IsValid`).
- [ ] `PUT /:id/permissions` substitui o conjunto inteiro (replace-set) e **audita o diff** na mesma transação.
- [ ] `DELETE` da zona remove suas permissões em cascata.
- [ ] Toda rota de escrita tem `validate()` Joi.

**Testes:**
- `tests/integration/zones-admin.test.js`: CRUD; replace-set (adiciona, remove, idempotente); 403 para não-admin; audit_trail registra o diff; geometria inválida → 422.

**Dependências:** Tarefa 1; fase-5 (`createAudit`/`require-admin`).

---

### Tarefa 6: Permissões de modelo 3D + CTE de autorização do catálogo

**Objetivo:** Implementar o controle de acesso do catálogo 3D: `access_level` na linha +
`model_permissions`/`model_group_permissions`, com a **autorização embutida na query** (CTE canônica
`public OR admin OR direto OR via-grupo`), encapsulada num predicado único.

**Arquivos afetados:**
- `src/database/migrations/0NN_model_permissions_fase6.sql` (criar — **só** a FK física de grupo + a função predicado; **NÃO** recria `access_level`/`model_permissions`/`model_group_permissions`)
- `src/modules/catalogo3d/catalogo3d.queries.js` (modificar — busca + count)
- `src/modules/catalogo3d/catalogo3d.service.js` (modificar — passar `userId`)
- `src/modules/catalogo3d/catalogo3d.controller.js` (modificar — `req.user?.id ?? null`)
- (opcional) `src/database/migrations/0NN_model_access_fn.sql` (criar — função predicado único; pode ser o mesmo arquivo acima)

**Padrão de código:** `_padroes.md` §7 (junções), §8 (filtro embutido + teste negativo).

> **Dono único das tabelas de permissão de modelo: a fase-4.** A migração `009_model_permissions.sql`
> (**fase-4, Tarefa 1**) **já cria** `ng.catalogo_3d.access_level` (`ADD COLUMN IF NOT EXISTS` +
> `CHECK (access_level IN ('public','private'))`), `ng.model_permissions` (PK composta
> **`(user_id, model_id)`**), `ng.model_group_permissions` (PK **`(group_id, model_id)`**), os índices
> no sentido `model_id`, o índice parcial de públicos e o **stub** `ng.user_groups`. **Esta fase NÃO
> recria nenhuma dessas tabelas/colunas** — isso causaria colisão de DDL (a fase-4 depende da fase-3, e
> esta fase também roda após fase-3/fase-5; a ordem real entre fase-4 e fase-6 é ambígua, então
> recriar sem `IF NOT EXISTS` quebraria num banco onde a fase-4 já rodou). Aqui apenas (a) tornamos a
> FK de grupo **física** quando o `user_groups` real (fase-5) existir e (b) adicionamos a função
> predicado de autorização. **Alinhamento de PK:** as junções usam a **mesma ordem de colunas da
> fase-4** — `model_permissions(user_id, model_id)` e `model_group_permissions(group_id, model_id)`.
> Se, por algum motivo, esta fase precisar rodar **sem** a fase-4, criar as tabelas com
> `CREATE TABLE IF NOT EXISTS` e **exatamente** essas PKs (nunca `(model_id, user_id)`).

**Implementação (migração — só o que a fase-4 NÃO fez):**
```sql
-- 0NN_model_permissions_fase6.sql
-- Pré-existentes da fase-4 (009_model_permissions.sql): access_level, ng.model_permissions
-- (PK user_id, model_id), ng.model_group_permissions (PK group_id, model_id), stub ng.user_groups.
-- Esta migração NÃO os recria.

-- (a) Promover a referência de grupo a FK física, agora que o user_groups real (fase-5/Tarefa 0)
--     existe. Idempotente: só adiciona a constraint se ainda não houver.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'ng' AND constraint_name = 'fk_model_group_perms_group'
  ) THEN
    ALTER TABLE ng.model_group_permissions
      ADD CONSTRAINT fk_model_group_perms_group
      FOREIGN KEY (group_id) REFERENCES ng.user_groups(group_id) ON DELETE CASCADE;
  END IF;
END $$;

-- (b) índice no sentido group_id (a fase-4 indexa só model_id) — útil ao predicado via-grupo.
CREATE INDEX IF NOT EXISTS idx_model_group_permissions_group
  ON ng.model_group_permissions(group_id);
```
> **Nota sobre o stub `user_groups`:** se a fase-5 substituiu o stub da fase-4 por um `ng.user_groups`
> com `group_id` real (Tarefa 0 desta fase), a FK acima fecha o laço. Se o `user_groups` ainda for o
> stub `(user_id, group_id)` da fase-4, **rode a Tarefa 0 antes** desta migração para ter a chave
> `group_id` que a FK referencia. A FK é a **única** mudança de DDL de modelo nesta fase.

**Implementação (CTE de autorização canônica — VERBATIM, defesa em profundidade):**
```sql
WITH user_role AS (
  SELECT EXISTS(SELECT 1 FROM ng.users WHERE id = $4 AND role = 'admin') AS is_admin
),
user_model_permissions AS (
  SELECT DISTINCT model_id FROM (
    SELECT model_id FROM ng.model_permissions WHERE user_id = $4
    UNION
    SELECT mgp.model_id FROM ng.model_group_permissions mgp
      JOIN ng.user_group_members ugm ON mgp.group_id = ugm.group_id
      WHERE ugm.user_id = $4
  ) perms
)
SELECT c.*,
  CASE WHEN $1 IS NOT NULL
       THEN ts_rank(search_vector, plainto_tsquery('portuguese', $1))
       ELSE 0 END AS rank
FROM ng.catalogo_3d c
CROSS JOIN user_role ur
LEFT JOIN user_model_permissions ump ON ump.model_id = c.id
WHERE (
    c.access_level = 'public'
    OR ($4::UUID IS NOT NULL AND (ur.is_admin OR ump.model_id IS NOT NULL))
  )
  AND ($1::text IS NULL OR search_vector @@ plainto_tsquery('portuguese', $1))
ORDER BY rank DESC, data_carregamento DESC
LIMIT $2 OFFSET $3;
```
> **Ajuste vs. verbatim original:** o original junta `ng.user_groups ug ... WHERE ug.user_id`. A
> membresia vive em `ng.user_group_members` (Tarefa 0), então a junção correta é `ng.user_group_members ugm
> ON mgp.group_id = ugm.group_id WHERE ugm.user_id = $4`. Mantida a semântica idêntica.

**Predicado único (recomendação):** extrair o `WHERE` de acesso (`public OR admin OR direto OR
via-grupo`) para **uma função** `ng.fn_user_can_see_model(p_model UUID, p_user UUID) RETURNS boolean`
e usá-la na busca **e** no count:
```sql
-- 0NN_model_access_fn.sql
CREATE OR REPLACE FUNCTION ng.fn_user_can_see_model(p_model UUID, p_user UUID)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM ng.catalogo_3d c WHERE c.id = p_model AND (
      c.access_level = 'public'
      OR (p_user IS NOT NULL AND (
            EXISTS(SELECT 1 FROM ng.users WHERE id = p_user AND role = 'admin')
         OR EXISTS(SELECT 1 FROM ng.model_permissions mp
                   WHERE mp.model_id = c.id AND mp.user_id = p_user)
         OR EXISTS(SELECT 1 FROM ng.model_group_permissions mgp
                   JOIN ng.user_group_members ugm ON ugm.group_id = mgp.group_id
                   WHERE mgp.model_id = c.id AND ugm.user_id = p_user)
      ))
    )
  );
$$;
```
> Trade-off: a **função `STABLE`** é a opção anti-divergência (uma regra, dois usos), mas pode
> impedir o planner de usar o índice parcial tão bem quanto o CTE inline com `LEFT JOIN`. **Recomendação:**
> usar a CTE verbatim acima na **busca** (planeja bem, índice parcial efetivo) e a **função** no
> **count** e no **GET /:id** (onde a clareza importa mais que o plano). Garanta por teste que
> ambos os caminhos retornam o **mesmo conjunto**.

**Count alinhado (verbatim do predicado):**
```sql
WITH user_role AS (...), user_model_permissions AS (...)
SELECT COUNT(*) AS total
FROM ng.catalogo_3d c
CROSS JOIN user_role ur
LEFT JOIN user_model_permissions ump ON ump.model_id = c.id
WHERE (c.access_level='public' OR ($4::UUID IS NOT NULL AND (ur.is_admin OR ump.model_id IS NOT NULL)))
  AND ($1::text IS NULL OR search_vector @@ plainto_tsquery('portuguese',$1));
```

**Endpoints de admin de permissões de modelo** (espelham a Tarefa 5, replace-set transacional + audit diff):
| Método | Rota | Descrição | Auth |
|--------|------|-----------|------|
| GET | `/api/v1/catalogo3d/:id/permissions` | Listar usuários+grupos com acesso | Admin |
| PUT | `/api/v1/catalogo3d/:id/permissions` | Replace-set `{users:[], groups:[]}` + audit diff | Admin |
| PATCH | `/api/v1/catalogo3d/:id/access-level` | `{access_level:'public'\|'private'}` | Admin |

**Critérios de aceitação:**
- [ ] Esta fase **não** recria `access_level`/`model_permissions`/`model_group_permissions` (donas da fase-4); só adiciona a FK física de grupo + a função predicado.
- [ ] As PKs das junções batem com a fase-4: `model_permissions(user_id, model_id)` e `model_group_permissions(group_id, model_id)`.
- [ ] Modelo `private` só aparece na busca/count para admin, dono de permissão direta ou via-grupo.
- [ ] Modelo `public` aparece para todos, inclusive anônimo (`$4 NULL`).
- [ ] Busca e count retornam conjuntos consistentes para o mesmo usuário/critérios.
- [ ] `PUT /:id/permissions` é replace-set transacional com audit do diff.
- [ ] Predicado de acesso existe em **uma** definição reutilizada (função/constante), não copiado.

**Testes:**
- `tests/integration/catalogo3d-access.test.js`: matriz {public, private} × {admin, direto, via-grupo, sem-acesso, anônimo}; **caso negativo obrigatório** (sem-acesso não recebe a linha privada); `total` == itens visíveis; replace-set + audit.

**Dependências:** **fase-4** (`009_model_permissions.sql`: `ng.catalogo_3d.access_level`, `model_permissions`, `model_group_permissions`, `search_vector`), Tarefa 0 (`user_groups` real, para a FK física), fase-5 (`createAudit`).

---

### Tarefa 7: Índices parciais para a fatia quente + estatísticas

**Objetivo:** Otimizar a leitura dominante (`access_level='public'`) com índices parciais e dar ao
planner estatística suficiente sobre `access_level`.

**Arquivos afetados:**
- `src/database/migrations/0NN_access_indexes.sql` (criar)

**Padrão de código:** `_padroes.md` §7 (índices parciais para a fatia quente).

**Implementação:**
```sql
-- Fatia quente: a maioria das buscas só toca registros públicos.
CREATE INDEX idx_catalogo3d_public ON ng.catalogo_3d (id)
  WHERE access_level = 'public';
CREATE INDEX idx_nomes_public ON ng.nomes_geograficos (id)
  WHERE access_level = 'public';

-- Full-text só do subconjunto público (acelera o ramo anônimo)
CREATE INDEX idx_catalogo3d_public_fts ON ng.catalogo_3d USING GIN (search_vector)
  WHERE access_level = 'public';

-- Planner: melhor estimativa de seletividade de access_level
ALTER TABLE ng.catalogo_3d       ALTER COLUMN access_level SET STATISTICS 1000;
ALTER TABLE ng.nomes_geograficos ALTER COLUMN access_level SET STATISTICS 1000;
ANALYZE ng.catalogo_3d;
ANALYZE ng.nomes_geograficos;
```

**Critérios de aceitação:**
- [ ] Índices parciais criados sobre a condição `access_level='public'`.
- [ ] `SET STATISTICS 1000` aplicado em `access_level` das duas tabelas.
- [ ] `EXPLAIN` de uma busca anônima usa o índice parcial (verificação manual documentada no PR).

**Testes:**
- Não há teste funcional novo (otimização). Os testes de acesso das Tarefas 3/4/6 garantem que os índices não mudaram resultados.

**Dependências:** Tarefa 3 (coluna `access_level` em nomes), Tarefa 6 (em catálogo).

---

### Tarefa 8: Identify 3D (`/feicoes`) com filtro de acesso geográfico por zona

**Objetivo:** A busca de "identify" da fase-3 (`GET /api/v1/nomes/feicoes`, query `FEICOES` verbatim
em `fase-3` §4.3) consulta **`ng.edificacoes`** — a única tabela de feições 3D que existe (criada na
**fase-3**, `006_postgis_ng.sql`, com `altitude_base`/`altitude_topo`). Esta tarefa injeta nela o
**mesmo filtro de acesso geográfico por zona** aplicado aos nomes (Tarefa 3): uma edificação só é
identificável se for **pública** ou se sua geometria estiver contida numa zona do usuário.

> **Reconciliação de nome de tabela (importante):** versões anteriores deste plano citavam uma tabela
> `ng.feicoes_3d` com coluna `model_id`, herdando acesso do **modelo** dono via
> `fn_user_can_see_model`. **Essa tabela não existe** — nem a fase-3 nem a fase-4 a criam. A fase-3
> cria `ng.edificacoes` (`006_postgis_ng.sql`), e é ela que o endpoint `/feicoes` da fase-3 já
> consulta. `ng.edificacoes` **não tem `model_id`** (não há modelo dono), então o controle de acesso
> aqui é o **mesmo das zonas geográficas** (`ST_Contains`), não herança de modelo. O SRID é **4326**
> (edificações), diferente dos nomes (4674) — usar `ST_MakePoint(...)` em 4326, como o verbatim §4.3
> da fase-3.

**Arquivos afetados:**
- `src/modules/nomes/nomes.queries.js` (modificar — `FEICOES`)
- `src/modules/nomes/nomes.service.js` (modificar — passar `userId`)
- `src/modules/nomes/nomes.controller.js` (modificar — `req.user?.id ?? null`)

**Padrão de código:** `_padroes.md` §8. Reusa o predicado de zona da Tarefa 2 (`user_zones` /
`fn_user_zone_geoms`) — mesma fonte única usada na busca de nomes.

> **Pré-requisito de dado:** `ng.edificacoes` precisa da mesma coluna `access_level VARCHAR(20) NOT
> NULL DEFAULT 'public' CHECK (access_level IN ('public','private'))` que a Tarefa 3 adiciona a
> `ng.nomes_geograficos`. Se a fase-3 não a criou em `ng.edificacoes`, adicioná-la na **mesma
> migração** desta fase que cria `access_level` em nomes (Tarefa 3) + índice parcial (Tarefa 7).

**Implementação (estende o verbatim §4.3 da fase-3 com o ramo de zona; preserva a ordenação por
"prisma vertical" + horizontal):**
```sql
-- $1 = lon, $2 = lat, $3 = z (altitude do clique), $4 = userId (uuid|null)
WITH user_zones AS ( ... )  -- (Tarefa 2; ou LEFT JOIN ng.fn_user_zone_geoms($4))
SELECT e.id, e.nome, e.municipio, e.estado, e.tipo, e.altitude_base, e.altitude_topo,
  CASE
    WHEN $3 BETWEEN e.altitude_base AND e.altitude_topo THEN 0
    WHEN $3 < e.altitude_base THEN e.altitude_base - $3
    ELSE $3 - e.altitude_topo
  END AS z_distance,                                                       -- prisma vertical
  ST_Distance(e.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS xy_distance
FROM ng.edificacoes e
LEFT JOIN user_zones uz ON ST_Contains(uz.geom, e.geom)
WHERE
  -- ramo de acesso: público OU dentro de uma zona do usuário OU admin (ver nota)
  (e.access_level = 'public' OR uz.id IS NOT NULL)
  AND ST_DWithin(e.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 3)
ORDER BY z_distance ASC, xy_distance ASC
LIMIT 1;
```
> Sem `ST_3DDistance` — usa-se o "prisma vertical" (CASE de distância ao intervalo
> `altitude_base`/`altitude_topo`), idêntico ao verbatim §4.3 da fase-3, por ser mais barato e
> adequado ao caso. O **único acréscimo** é o ramo de acesso (`access_level` + `user_zones`).
> **Bypass de admin:** se o SRID da zona (4674, Tarefa 1) divergir do de `ng.edificacoes` (4326), o
> `ST_Contains` exige `ST_Transform` da zona para 4326 (ou definir a zona em 4326); confirmar conforme
> a nota de SRID da Tarefa 1. Para admin, acrescentar o mesmo ramo `EXISTS(... role='admin')` da
> Tarefa 3.

**Critérios de aceitação:**
- [ ] Identify nunca retorna edificação `private` fora de qualquer zona do usuário.
- [ ] Edificação `private` dentro de zona do usuário **é** identificada; mesma edificação para usuário sem a zona **não**.
- [ ] Anônimo (`userId NULL`) só identifica edificações `public`.
- [ ] Admin identifica qualquer edificação.
- [ ] Ordenação prioriza acerto vertical no intervalo, depois proximidade horizontal (contrato §4.3 da fase-3 preservado).

**Testes:**
- `tests/integration/identify-3d-access.test.js`: edificação `private` dentro/fora de zona; **caso negativo obrigatório** (sem-acesso recebe `{ message: ... }`, não a linha privada); anônimo só `public`; admin vê tudo.

**Dependências:** fase-3 (`ng.edificacoes` + query `FEICOES`), Tarefa 2 (predicado de zona), Tarefa 3 (`access_level`).

---

## 5. Riscos & cuidados

| Risco | Mitigação |
|-------|-----------|
| **Vazar nomes/modelos privados** (risco central) | Autorização **na query**, não em JS. Teste negativo obrigatório por recurso (`_padroes.md` §9). Nenhum `SELECT` sem o ramo de acesso. Revisar `EXPLAIN` para confirmar que o filtro não é aplicado só "no fim". |
| **Predicado duplicado divergindo** | Encapsular em função SQL (`fn_user_can_see_model`/`fn_user_zone_geoms`) ou constante JS compartilhada. **Proibido** copiar o CTE à mão em busca e count. |
| **SRID incompatível em `ST_Contains`** | Zona e ponto **mesmo SRID**. Validar o SRID real de `ng.nomes_geograficos` (fase-3) antes de fixar `POLYGON(...,4674)`; usar `ST_Transform` se preciso. |
| **Schema da tabela de usuários** (`users` vs `ng.users`) | Confirmar o nome qualificado antes de escrever FKs e CTEs. Ajustar os blocos verbatim ao que existir. |
| **Membresia de grupo: `user_groups` vs `user_group_members`** | A junção via-grupo é com `user_group_members` (membership). Os verbatim que dizem `ng.user_groups ug WHERE ug.user_id` foram ajustados para `user_group_members`. |
| **Count que mente** | Count reusa o **mesmo** predicado, sempre antes do `LIMIT`. Teste compara `total` vs linhas visíveis. |
| **SQL dinâmico / injeção** | 100% parametrizado (`$n`). GeoJSON entra via `ST_GeomFromGeoJSON($1)` — nunca concatenar. `ST_IsValid`/Joi rejeitam geometria malformada (`_padroes.md` §8). |
| **Custo da função `STABLE` no planner** | Usar CTE inline na busca quente; função no count/GET. Validar plano com `EXPLAIN`; índices parciais (Tarefa 7) cobrem a fatia pública. |
| **Replace-set apagando tudo se o cliente mandar `[]`** | Comportamento **intencional** (`[]` = "remover todos"). Documentar no contrato da UI de admin para evitar surpresa; audit do diff deixa rastro. |
| **Performance de `ST_Contains` em massa** | Índice GIST na zona (`idx_zones_geom`). `user_zones` filtra primeiro as zonas do usuário (poucas) e só então cruza com pontos. |
| **Não quebrar o contrato congelado da busca** | O shape de resposta da busca de nomes e do catálogo é congelado (`99-referencia.md`). O filtro só remove linhas; não muda colunas nem formato. Teste de contrato. |

---

## 6. Definition of Done da fase

Além do **DoD universal** de `_padroes.md` §10, esta fase só está concluída quando:

- [ ] `geographic_access_zones` + `zone_permissions` + `zone_group_permissions` existem com GIST, PK composta, FK CASCADE e índice nos dois sentidos (Tarefa 1).
- [ ] `model_permissions` + `model_group_permissions` + `access_level` em `ng.catalogo_3d` existem (**criados na fase-4**, `009_model_permissions.sql`); esta fase apenas tornou a FK de grupo física e adicionou o predicado SQL — sem recriar (Tarefa 6).
- [ ] `access_level` existe em `ng.nomes_geograficos` (criada aqui se a fase-3 não criou) (Tarefa 3).
- [ ] A busca de nomes e o catálogo 3D **embutem** a autorização na query; **nenhum** filtro de acesso em JS.
- [ ] O predicado de acesso existe em **uma** definição reutilizada (função SQL ou constante JS) por recurso — não duplicado entre busca e count.
- [ ] Busca de nomes filtra por `ST_Contains` de zona; anônimo só vê `public`; admin vê tudo (Tarefa 3).
- [ ] Count repete **exatamente** o predicado da busca, antes do `LIMIT`; `total` == itens visíveis (Tarefas 4, 6).
- [ ] Identify 3D (`/feicoes` sobre `ng.edificacoes`) aplica o filtro de acesso por zona; `private` fora de zona não vaza; anônimo só `public` (Tarefa 8).
- [ ] Endpoints de admin de zona e de permissão de modelo: replace-set transacional + audit diff via `createAudit` na mesma `tx()` (Tarefas 5, 6).
- [ ] Índices parciais `WHERE access_level='public'` + `SET STATISTICS 1000` aplicados (Tarefa 7).
- [ ] **Teste negativo por recurso** (usuário sem permissão NÃO recebe a linha privada no JSON) verde para nomes, catálogo e identify (`_padroes.md` §9).
- [ ] `CLAUDE.md`/docs atualizados com o novo modelo de acesso `ng` e os endpoints de admin de zona/modelo.
- [ ] `atlas_shares` e o caminho anônimo do atlas colaborativo permanecem intocados (aditivo).

---

## 7. Nota sobre a UI de admin (consumidor downstream)

A administração de zonas e de permissões de modelo será operada por uma **UI de admin que é um
projeto frontend SEPARADO** (scaffold a partir de `ebgeo_web_2_admin`, ver decisão D5 em
`00-visao-geral.md`). **Esta fase só entrega os endpoints de backend** listados nas Tarefas 5 e 6;
nenhuma tela é construída aqui. O contrato desses endpoints (e a spec da UI como consumidor) é
material de referência preservado em `99-referencia.md`. Mantenha os endpoints estáveis e
documentados para que o frontend de admin os consuma sem retrabalho.
