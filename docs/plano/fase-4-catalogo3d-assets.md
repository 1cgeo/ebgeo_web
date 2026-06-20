# Fase 4 — Catálogo 3D fonte única + distribuição de assets 3D

> **✅ STATUS: IMPLEMENTADA (backend).** T1 migração `016_model_permissions.sql` (`access_level` +
> `model_permissions`/`model_group_permissions` + stub `ng.user_groups` + índice parcial); T2
> `GET /api/v1/assets3d/*` (público) com ETag O(1)/304/Range 206/416/`immutable`/anti-traversal
> (`src/modules/nomes/assets3d.*`); T3 filtro de acesso **embutido no SQL** do `/catalogo3d`
> (public/admin/permissão direta/por grupo, count alinhado, **gancho de zona da fase-6 comentado**);
> T4 `style` JSONB íntegro (Cesium3DTileStyle). **Atualização:** os binários agora são servidos
> **dual-mode** — store **SQLite** (`better-sqlite3`, BLOB + ETag O(1) + semáforo) **primeiro**, e o
> filesystem como fallback (`assets3d.store.js` + `scripts/assets3d-import.js`); mesmo padrão de BLOB
> previsto para o 360 (Fase 9). Suite verde (641). **Externo/docs:** T5 (rastrear
> origem do terrain — investigação no `ebgeo_web`, não no backend) e T6 (desligar `config.tilesets` no
> frontend) ficam para o repo do front; `assets3dBaseUrl` deve entrar no `GET /api/config` (fase-2).
> **Esforço:** Médio · **Depende de:** fase-3 (PostGIS + Gazetteer) · **Baseline:** branch `main`, migração head atual `005_client_id_text.sql`.
> Leia **`_padroes.md`** e **`00-visao-geral.md`** antes desta fase. As tarefas seguem o template de TAREFA e o Definition of Done de `_padroes.md` §10.

---

## 1. Objetivo & contexto

Hoje a distribuição de modelos 3D do ecossistema EBGeo está **fragmentada em duas trilhas que não conversam**:

- **(A) Trilha estática hardcoded do frontend.** Os 3D Tiles (`tileset.json` + `.b3dm`) e GLB são arquivos estáticos no repo do front (`public/3d/`), e o **catálogo de descoberta/posicionamento é hardcoded** no array `config.tilesets` do `config.js`.
- **(B) Trilha do gazetteer.** A tabela `ng.catalogo_3d` (criada na **fase-3**, com busca full-text PT-BR via `search_vector`/`ts_rank`) existe e já é exposta por `GET /api/v1/nomes/catalogo3d`, **mas o frontend nunca a consome** — e suas `url` usam prefixo diferente do front.
- **Terrain (quantized-mesh):** vem de um **host externo desconhecido** (`localhost/terrain/...`); origem ainda **não rastreada**.

Esta fase **promove `ng.catalogo_3d` a fonte única** de descoberta e posicionamento dos modelos 3D, faz o **backend servir os assets 3D estáticos** (tileset.json / b3dm / glb / terrain) com CORS / Range 206/416 / `Cache-Control: immutable` / **ETag O(1)**, faz o **frontend consumir a API** em vez do `config.tilesets` hardcoded, habilita o **`Cesium3DTileStyle` para nuvem de pontos** (hoje sem consumidor) e **liga as permissões de modelo** (`model_permissions` / `model_group_permissions`) — que ligam na fase-6 de acesso geográfico.

**`ng.catalogo_3d` é a fonte de verdade dos metadados de posicionamento e descoberta dos modelos 3D, mas NÃO guarda os binários.** Guarda **onde/como posicionar** (`lon`/`lat`/`height`, `heading`/`pitch`/`roll`, `heightoffset`, `maximumscreenspaceerror`, `type`, `style`) e a **descoberta** (`name`, `palavras_chave`, `thumbnail`, `search_vector`). O campo `url` aponta o artefato servido **separadamente**, com **caminho relativo** (`/aman/tileset.json`, `/estatua/estatua.glb`).

**Fluxo alvo:** Cesium chama `GET /api/v1/nomes/catalogo3d` → recebe a lista com `url` + pose → busca o `tileset.json`/`.glb`/terrain no endpoint de assets do backend → renderiza.

Os campos de `ng.catalogo_3d` já **batem quase 1:1** com o `config.tilesets` do frontend (`lon`/`lat`/`height`, `heading`/`pitch`/`roll`, `heightoffset`, `maximumscreenspaceerror`, `type`, `style`), o que torna a migração do front de "array hardcoded" para "API" majoritariamente um remapeamento de campos.

### Fora de escopo desta fase

- A criação da tabela `ng.catalogo_3d`, do schema `ng`, da extensão PostGIS e do endpoint `GET /api/v1/nomes/catalogo3d` (full-text + paginação) — **tudo isso é da fase-3**. Aqui **consolidamos o consumo** desse endpoint e **acrescentamos** servir os binários + permissões.
- A **autorização espacial por zona** (`geographic_access_zones`, `ST_Contains`) e a integração completa de `model_permissions` na CTE da busca — isso é da **fase-6**. Aqui criamos as **tabelas de permissão de modelo** e a coluna `access_level`, e ligamos o filtro **mínimo** (public vs. autenticado-com-permissão) deixando o ramo de zona como gancho para a fase-6.
- A UI de administração do catálogo (cadastro de modelos, upload de thumbnails) — é **projeto frontend separado** (`ebgeo_web_2_admin` como scaffold). Aqui o backend só **provê os endpoints** consumidos por ela. Ver spec downstream em `99-referencia.md`.

---

## 2. Pré-requisitos / dependências

| Pré-requisito | Origem | Por quê |
|---|---|---|
| Schema `ng` + extensões `postgis`, `pg_trgm`, `unaccent` criados | **fase-3** | `ng.catalogo_3d` vive no schema `ng`; as permissões e `access_level` estendem essa tabela. |
| Tabela `ng.catalogo_3d` com `search_vector tsvector` + trigger + índice GIN | **fase-3** | Full-text PT-BR de descoberta. Esta fase apenas consome e estende. |
| Endpoint `GET /api/v1/nomes/catalogo3d` (full-text + paginação) | **fase-3** | Esta fase consolida o consumo pelo frontend e adiciona o filtro de acesso. |
| Módulo `src/modules/nomes/` (routes/controller/service/queries/schemas) | **fase-3** | O endpoint de assets 3D e o de catálogo vivem aqui (ou em submódulo). |
| Middleware de auth de leitura (qualquer autenticado) sobre `/nomes/*` | **fase-3** | Catálogo exige autenticação; assets têm política própria (ver Tarefa 2). |
| `config.js` com helpers `required`/`optional` e hardening da **fase-0** | fase-0 | `ASSETS_3D_DIR`, `ASSETS_3D_BASE_URL` entram via os mesmos helpers. |

> **Se a fase-3 ainda não estiver concluída, NÃO inicie esta fase.** As tarefas abaixo presumem `ng.catalogo_3d` populada (seed `er/insert_teste.sql` da fase-3, ~40 registros reais de OMs) e o endpoint de catálogo no ar.

### Contrato de `ng.catalogo_3d` (herdado da fase-3, referência)

Colunas relevantes para esta fase (não recriar — apenas referência de leitura):

```
ng.catalogo_3d (
  id uuid PK,
  name, description TEXT, municipio, estado, thumbnail,
  palavras_chave TEXT[],
  url,                              -- caminho RELATIVO do artefato (/aman/tileset.json)
  lon, lat, height NUMERIC,
  heading, pitch, roll NUMERIC,
  type VARCHAR(50),                 -- 'Tiles 3D' | 'Modelos 3D' | 'Nuvem de Pontos'
  heightoffset NUMERIC,
  maximumscreenspaceerror NUMERIC,
  data_criacao,
  search_vector tsvector,
  style JSONB                       -- Cesium3DTileStyle (usado p/ Nuvem de Pontos)
)
```

Resposta atual de `GET /api/v1/nomes/catalogo3d` (contrato congelado da fase-3):

```json
{ "total": N, "page": P, "nr_records": K, "data": [ {
  "id","name","description","thumbnail","url","lon","lat","height","heading","pitch","roll",
  "type","heightoffset","maximumscreenspaceerror","data_criacao","municipio","estado",
  "palavras_chave","style" } ] }
```

---

## 3. Decisões de arquitetura aplicáveis

### D-4.1 — Quem serve os binários: caminho relativo (host de estáticos = o próprio backend) **[recomendado]** vs. reescrever para URL absoluta

`ng.catalogo_3d.url` guarda **caminho relativo** (`/aman/tileset.json`). Há dois ramos:

- **Ramo A (recomendado): o backend serve os binários sob um prefixo fixo, e a `url` continua relativa.** O backend expõe `GET /api/v1/assets3d/*` (ou `/3d/*`) servindo de um diretório raiz (`ASSETS_3D_DIR`). O frontend resolve `url` contra uma **base configurável** (`config.assets3dBaseUrl`, vinda do `GET /api/config` da fase-2). Vantagem: a `url` no banco fica **portável entre ambientes** (dev/homolog/prod), o NGINX pode reescrever, e nada quebra se o host mudar. É o que o §3.5 e §7 dos docs-fonte recomendam.
- **Ramo B: reescrever `url` para absoluta no servidor.** O service de catálogo concatena `ASSETS_3D_BASE_URL + url` antes de devolver. Mais simples no front, mas **acopla o banco a um host** e dificulta multi-ambiente; só faz sentido se o front não puder ser tocado.

**Decisão:** adotar o **Ramo A**. O backend serve sob um prefixo fixo; a `url` permanece relativa no banco; a resolução final é responsabilidade do cliente usando `config.assets3dBaseUrl`. Documentar `assets3dBaseUrl` como campo do `GET /api/config` (coordenar com a **fase-2**).

### D-4.2 — Terrain (quantized-mesh): **rastrear a origem ANTES de assumir o serve** **[bloqueante para a Tarefa 5]**

O terrain hoje vem de `localhost/terrain/...` (host externo **desconhecido**). **Não assuma** que o backend deve servi-lo. A Tarefa 5 é **dividida em duas etapas**: (1) **rastrear/levantar** de onde vem o quantized-mesh (formato, layout `layer.json` + `{z}/{x}/{y}.terrain`, tamanho total, se é Cesium ion, ctb-tile, ou um tile server interno da DGEO); (2) **só então** decidir entre servir pelo backend (reusando o servidor de assets estáticos) ou reapontar o front para um tile server dedicado. **Não migrar terrain cegamente.**

### D-4.3 — ETag O(1) sem ler o BLOB (reaproveitado do `ebgeo_360`)

O padrão de servir artefato imutável do `ebgeo_360` (`src/routes/photos.js`) é **reaproveitável para qualquer asset 3D imutável** (tilesets, b3dm, glb, terrain):

- **ETag derivado de tamanho persistido, sem ler o conteúdo.** No 360 é `"{uuid}-{quality}-{sizeBytes}"`. Para assets de filesystem, o equivalente O(1) é o `fs.stat` (que **não lê** o arquivo): `ETag = "{size}-{mtimeMs}"` (weak ETag aceitável). Para assets versionados/imutáveis por convenção de path, pode-se até dispensar o `stat` e derivar do path.
- **Short-circuit do 304 (`If-None-Match`) ANTES de qualquer I/O pesado** (antes de abrir/ler o arquivo). Cache-hit O(1).
- **`Cache-Control: public, max-age=31536000, immutable`** em respostas 200/206.
- **Range 206:** parse de `bytes=start-end` (intervalo único, inclusive sufixo `-N`); responde **206** com `Content-Range: bytes start-end/len`; **416** com `Content-Range: bytes */len` quando o range é inválido; **200** inteiro sem header `Range`. **`Accept-Ranges: bytes` em 200/206/304.**

> **Importante:** ao contrário do 360 (que materializa o Buffer inteiro), aqui usamos **`fs.createReadStream(path, { start, end })`** — streaming incremental real do filesystem. Logo **não precisamos do semáforo `MAX_INFLIGHT`** do 360 (aquele protege RSS por carregar WebP multi-MB no heap). Não copiar o semáforo.

### D-4.4 — Permissões de modelo agora, autorização espacial na fase-6

Criamos `ng.model_permissions` e `ng.model_group_permissions` + coluna `access_level` em `ng.catalogo_3d` **nesta fase** (mesma estrutura que as zonas geográficas usarão na fase-6). O **filtro de acesso embutido na query SQL** (CTE de `user_role` + `user_model_permissions`) é a melhor prática herdada (`catalog3d.queries.ts` do `ebgeo_web_2_backend`): **o dado não vaza nem com bug na camada de aplicação**. Nesta fase ligamos o ramo **public vs. autenticado-com-permissão**; o ramo de **zona espacial** (`ST_Contains`) fica como **gancho documentado** para a fase-6 não reescrever a query.

---

## 4. TAREFAS

### Tarefa 1: Migração — `access_level` + tabelas de permissão de modelo

**Objetivo:** Adicionar a coluna `access_level` a `ng.catalogo_3d` e criar `ng.model_permissions` e `ng.model_group_permissions`, preparando o filtro de acesso embutido na query (ramo public vs. permissão direta/por grupo). Estrutura espelha a que as zonas geográficas usarão na fase-6.

**Arquivos afetados:**
- `src/database/migrations/009_model_permissions.sql` (criar) — numeração conforme a ordem recomendada em `_padroes.md` §7 (`...postgis+ng → ... → model_permissions → audit_trail/api_keys`). **Ajuste o número** para o próximo livre após as migrações da fase-3.

**Padrão de código:** `_padroes.md` §7 (migração aditiva, numerada, `gen_random_uuid()`, `CHECK` em enum textual, junções N:N com PK composta + `ON DELETE CASCADE` + índice no outro sentido).

**Implementação (SQL — preservar verbatim):**
```sql
-- 009_model_permissions.sql
-- Acesso por modelo do catálogo 3D. Espelha a estrutura das zonas geográficas (fase-6).

-- 1) Nível de acesso do modelo (default public preserva o comportamento atual: tudo visível)
ALTER TABLE ng.catalogo_3d
  ADD COLUMN IF NOT EXISTS access_level VARCHAR(20) NOT NULL DEFAULT 'public'
    CHECK (access_level IN ('public', 'private'));

-- 2) Permissão direta usuário -> modelo
CREATE TABLE IF NOT EXISTS ng.model_permissions (
  user_id    UUID NOT NULL,
  model_id   UUID NOT NULL REFERENCES ng.catalogo_3d(id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_model_permissions_model ON ng.model_permissions(model_id);

-- 3) Permissão por grupo -> modelo (user_groups é da fase-5/6; FK fica lógica até existir)
CREATE TABLE IF NOT EXISTS ng.model_group_permissions (
  group_id   UUID NOT NULL,
  model_id   UUID NOT NULL REFERENCES ng.catalogo_3d(id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_model_group_permissions_model ON ng.model_group_permissions(model_id);

-- 4) Índice parcial da fatia quente: modelos públicos
CREATE INDEX IF NOT EXISTS idx_catalogo_3d_public
  ON ng.catalogo_3d(id) WHERE access_level = 'public';
```

> **Nota sobre `user_groups`:** a tabela de grupos vem da fase-5/6. Não criar FK física para ela aqui (a migração quebraria se a tabela não existir). A coluna `group_id` fica como referência lógica; a FK física é adicionada (ou não) na fase-6 quando `user_groups` existir. Documentar isso no topo do arquivo.

**Critérios de aceitação:**
- [ ] `ng.catalogo_3d.access_level` existe, `NOT NULL DEFAULT 'public'`, `CHECK` em `{public,private}`.
- [ ] Modelos pré-existentes (seed da fase-3) continuam **públicos** após a migração (não-regressão de visibilidade).
- [ ] `ng.model_permissions` e `ng.model_group_permissions` existem com PK composta e `ON DELETE CASCADE` para `catalogo_3d`.
- [ ] A migração é idempotente a nível de tracking (`_migrations`) e usa `IF NOT EXISTS`.

**Testes:**
- `tests/integration/catalogo3d-permissions.test.js`: após migrar, verificar que `SELECT access_level` dos seeds é `'public'`; inserir uma permissão direta e confirmar PK composta rejeita duplicata.

**Dependências:** fase-3 concluída (`ng.catalogo_3d` existe). Nenhuma outra tarefa desta fase.

---

### Tarefa 2: Servir assets 3D estáticos com Range / ETag O(1) / cache imutável / CORS

**Objetivo:** Expor `GET /api/v1/assets3d/*` servindo `tileset.json`, `.b3dm`, `.glb` (e, condicionalmente, terrain — ver Tarefa 5) de um diretório local, com `Cache-Control: immutable`, ETag O(1) por `fs.stat`, suporte a `Range` (206/416), `Accept-Ranges: bytes` e CORS apropriado para o consumo do Cesium.

**Arquivos afetados:**
- `src/modules/nomes/assets3d.controller.js` (criar)
- `src/modules/nomes/assets3d.routes.js` (criar)
- `src/modules/nomes/assets3d.service.js` (criar) — resolução segura de path + `fs.stat` + stream com Range
- `src/modules/nomes/index.js` (modificar) — re-exportar `assets3dRoutes`
- `src/app.js` (modificar) — montar `app.use('/api/v1/assets3d', assets3dRoutes)`
- `src/config.js` (modificar) — `assets3d: { dir: optional('ASSETS_3D_DIR','./data/assets3d'), baseUrl: optional('ASSETS_3D_BASE_URL','/api/v1/assets3d') }`

**Padrão de código:** `_padroes.md` §1 (módulo), §2 (`asyncHandler`/`AppError`), §6 (montagem em `app.js`, antes do `errorHandler`); D-4.3 (ETag O(1) + Range, reaproveitado de `ebgeo_360 src/routes/photos.js`). Diferentemente das imagens de atlas (`src/modules/images/images.controller.js:16-17`, que usa `Content-Disposition: inline`), assets 3D são consumidos por XHR/fetch do Cesium e **não** levam `Content-Disposition`.

**Implementação:**

1. **Resolução de path segura (anti path-traversal).** O `*` da rota é o `url` relativo do catálogo. Resolver contra `config.assets3d.dir` com `path.resolve` e **rejeitar** qualquer resultado fora da raiz:
```javascript
// assets3d.service.js
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { NotFoundError, ForbiddenError } from '../../utils/errors.js';
import config from '../../config.js';

const statAsync = promisify(fs.stat);
const ROOT = path.resolve(config.assets3d.dir);

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.b3dm': 'application/octet-stream',
  '.glb':  'model/gltf-binary',
  '.terrain': 'application/octet-stream', // quantized-mesh (ver Tarefa 5)
};

export async function resolveAsset(relUrl) {
  // relUrl ex.: "aman/tileset.json" (sem barra inicial)
  const target = path.resolve(ROOT, '.' + path.posix.normalize('/' + relUrl));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    throw new ForbiddenError('Path traversal detectado');
  }
  let st;
  try {
    st = await statAsync(target);
  } catch {
    throw new NotFoundError('Asset 3D não encontrado');
  }
  if (!st.isFile()) throw new NotFoundError('Asset 3D não encontrado');
  return {
    path: target,
    size: st.size,
    etag: `"${st.size}-${Math.floor(st.mtimeMs)}"`,           // ETag O(1) — só fs.stat, sem ler o arquivo
    contentType: CONTENT_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
  };
}
```

2. **Controller: 304 short-circuit ANTES do I/O + Range 206/416.**
```javascript
// assets3d.controller.js
import { createReadStream } from 'node:fs';
import { asyncHandler } from '../../utils/async-handler.js';
import * as assets3dService from './assets3d.service.js';

const ONE_YEAR = 'public, max-age=31536000, immutable';

export const serveAsset = asyncHandler(async (req, res) => {
  const rel = req.params[0]; // o '*' da rota
  const meta = await assets3dService.resolveAsset(rel);

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', ONE_YEAR);
  res.setHeader('ETag', meta.etag);
  res.setHeader('Content-Type', meta.contentType);

  // 304 short-circuit ANTES de abrir o arquivo
  if (req.headers['if-none-match'] === meta.etag) {
    return res.status(304).end();
  }

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', meta.size);
    return createReadStream(meta.path).pipe(res);
  }

  // Range: "bytes=start-end" (intervalo único, inclui sufixo "-N")
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = m && m[1] !== '' ? parseInt(m[1], 10) : null;
  let end   = m && m[2] !== '' ? parseInt(m[2], 10) : null;
  if (!m || (start === null && end === null)) {
    res.status(416).setHeader('Content-Range', `bytes */${meta.size}`);
    return res.end();
  }
  if (start === null) { start = meta.size - end; end = meta.size - 1; }   // sufixo "-N"
  if (end === null || end >= meta.size) end = meta.size - 1;
  if (start > end || start < 0 || start >= meta.size) {
    res.status(416).setHeader('Content-Range', `bytes */${meta.size}`);
    return res.end();
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${meta.size}`);
  res.setHeader('Content-Length', end - start + 1);
  return createReadStream(meta.path, { start, end }).pipe(res);
});
```

3. **CORS para Cesium.** O CORS global em `app.js:25` (`cors({ origin: config.cors.origin, credentials: true })`) já cobre a origem do front. Para o Cesium ler bytes via XHR, confirmar que a origem do app está em `CORS_ORIGIN` e que `Accept-Ranges`/`Content-Range` não são bloqueados (são headers de resposta seguros). **Não** abrir wildcard (`*`) — viola `_padroes.md` §8.

4. **Política de auth dos assets.** Recomendação: assets 3D montam-se **com o mesmo middleware de auth de leitura** do módulo `nomes` (qualquer autenticado), espelhando que o catálogo já exige auth. **Decisão aberta menor:** se o Cesium não conseguir injetar `Authorization` no fetch de tiles, considerar **token na query** (`?token=`) ou deixar os assets **públicos** mas com a `url` só descoberta via catálogo autenticado. Documentar a escolha; default = **autenticado**.

**Critérios de aceitação:**
- [ ] `GET /api/v1/assets3d/aman/tileset.json` devolve 200 com `Content-Type: application/json`, `Accept-Ranges: bytes`, `Cache-Control: public, max-age=31536000, immutable`, `ETag`.
- [ ] Reenvio com `If-None-Match: <etag>` devolve **304** sem corpo e **sem ler o arquivo** (verificável: nenhum `createReadStream`).
- [ ] `Range: bytes=0-99` devolve **206** com `Content-Range: bytes 0-99/<size>` e corpo de 100 bytes.
- [ ] Range inválido (ex. `bytes=999999-`) devolve **416** com `Content-Range: bytes */<size>`.
- [ ] `GET /api/v1/assets3d/../config.js` (ou `%2e%2e`) devolve **403/404** (path traversal bloqueado).
- [ ] `.glb` servido com `Content-Type: model/gltf-binary`.

**Testes:**
- `tests/integration/assets3d.test.js`: criar fixtures em `IMAGES_DIR`-style temp dir; cobrir 200 inteiro, 304 por ETag, 206 por Range, 416 por Range inválido, 403/404 por traversal, content-type por extensão, 404 por arquivo inexistente.

**Dependências:** Tarefa 1 não é pré-requisito direto, mas a montagem do módulo `nomes` (fase-3) é. Pode correr em paralelo à Tarefa 1.

---

### Tarefa 3: Filtro de acesso embutido na query de `catalogo3d` (public vs. permissão)

**Objetivo:** Tornar o `GET /api/v1/nomes/catalogo3d` (e seu `COUNT`) sensível a `access_level` + `model_permissions`/`model_group_permissions`, com o filtro **dentro do SQL** (defesa em profundidade), preservando o contrato de resposta da fase-3. Deixar o **ramo de zona espacial como gancho documentado** para a fase-6.

**Arquivos afetados:**
- `src/modules/nomes/nomes.queries.js` (modificar) — substituir/estender a query de catálogo
- `src/modules/nomes/nomes.service.js` (modificar) — passar `userId` (pode ser `null` para anônimo) e role
- `src/modules/nomes/nomes.controller.js` (modificar) — extrair `req.user?.id` / `req.user?.role`

**Padrão de código:** `_padroes.md` §8 (SQL parametrizado, filtro de acesso com teste de usuário sem permissão), §4 (`COUNT` e `SELECT` **alinhados** — o count repete EXATAMENTE o predicado de acesso). Padrão herdado de `catalog3d.queries.ts` do `ebgeo_web_2_backend` (IDEIAS §1.3 itens 20, 22).

**Implementação (SQL — preservar verbatim, adaptar nomes de coluna de `data_criacao`):**
```sql
-- SELECT do catálogo com filtro de acesso embutido.
-- $1 = q (text|null), $2 = limit, $3 = offset, $4 = userId (uuid|null)
WITH user_role AS (
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = $4::uuid AND role = 'admin'
  ) AS is_admin
),
user_model_permissions AS (
  SELECT DISTINCT model_id FROM (
    SELECT model_id FROM ng.model_permissions WHERE user_id = $4::uuid
    UNION
    SELECT mgp.model_id
      FROM ng.model_group_permissions mgp
      JOIN ng.user_groups ug ON mgp.group_id = ug.group_id
     WHERE ug.user_id = $4::uuid
  ) perms
)
SELECT c.id, c.name, c.description, c.thumbnail, c.url,
       c.lon, c.lat, c.height, c.heading, c.pitch, c.roll,
       c.type, c.heightoffset, c.maximumscreenspaceerror,
       c.data_criacao, c.municipio, c.estado, c.palavras_chave, c.style,
       CASE WHEN $1::text IS NOT NULL
            THEN ts_rank(c.search_vector, plainto_tsquery('portuguese', $1))
            ELSE 0 END AS rank
FROM ng.catalogo_3d c
CROSS JOIN user_role ur
LEFT JOIN user_model_permissions ump ON ump.model_id = c.id
WHERE ( c.access_level = 'public'
        OR ($4::uuid IS NOT NULL AND (ur.is_admin OR ump.model_id IS NOT NULL)) )
  AND ($1::text IS NULL OR c.search_vector @@ plainto_tsquery('portuguese', $1))
ORDER BY rank DESC, c.data_criacao DESC
LIMIT $2 OFFSET $3;
```
E o `COUNT` com o **mesmo predicado de acesso** (sem `ORDER BY`/`LIMIT`):
```sql
WITH user_role AS (...),                 -- idêntico ao SELECT
     user_model_permissions AS (...)     -- idêntico ao SELECT
SELECT COUNT(*) AS total
FROM ng.catalogo_3d c
CROSS JOIN user_role ur
LEFT JOIN user_model_permissions ump ON ump.model_id = c.id
WHERE ( c.access_level = 'public'
        OR ($4::uuid IS NOT NULL AND (ur.is_admin OR ump.model_id IS NOT NULL)) )
  AND ($1::text IS NULL OR c.search_vector @@ plainto_tsquery('portuguese', $1));
```

> **Gancho fase-6 (NÃO implementar agora, deixar comentado no `.queries.js`):** a fase-6 acrescenta uma CTE `user_zones` e um ramo `OR uz.id IS NOT NULL` (via `LEFT JOIN ... ON ST_Contains(uz.geom, c.geom_ponto)`) para acesso espacial. **Estruturar a query já com o `WHERE` em forma de disjunção de ramos** para que a fase-6 só **adicione um `OR`**, sem reescrever. Documentar isso num comentário no SQL.

> **Atenção a `ng.user_groups`:** essa tabela é da fase-5/6. Enquanto não existir, a CTE `user_model_permissions` quebraria por referência a tabela inexistente. **Mitigação nesta fase:** ou (a) criar `ng.user_groups` vazia como stub na migração 009 (preferível, alinhado com a fase-6 que a popula), ou (b) condicionar o ramo de grupo (deixar só permissão direta) até a fase-6. **Recomendado: stub vazio** — `CREATE TABLE IF NOT EXISTS ng.user_groups (user_id UUID, group_id UUID, PRIMARY KEY(user_id, group_id))` na migração 009, documentado como "preenchida na fase-6".

**Critérios de aceitação:**
- [ ] Sem `access_level='private'` no banco, o resultado é **idêntico** ao da fase-3 (não-regressão do contrato).
- [ ] Modelo `private` **não aparece** para usuário sem permissão (nem direta nem por grupo) nem para anônimo.
- [ ] Modelo `private` **aparece** para: admin global; usuário com `model_permissions` direta; usuário em grupo com `model_group_permissions`.
- [ ] `total` (count) bate com o número de linhas que a busca realmente retorna (count não conta o que a busca esconde).
- [ ] A query continua **100% parametrizada**; `userId` chega como `$4` (nunca concatenado).

**Testes:**
- `tests/integration/catalogo3d-access.test.js`: **caso negativo obrigatório** — usuário sem permissão NÃO vê modelo privado; admin vê; permissão direta vê; count alinhado com a página. Cobrir anônimo (se a rota permitir `userId` null).

**Dependências:** Tarefa 1 (coluna `access_level` + tabelas de permissão + stub `user_groups`). fase-3 (query base de catálogo).

---

### Tarefa 4: `Cesium3DTileStyle` para nuvem de pontos (consumir `style` JSONB)

**Objetivo:** Garantir que o campo `style JSONB` de `ng.catalogo_3d` (Cesium3DTileStyle) trafega íntegro no `GET /api/v1/nomes/catalogo3d` e é consumível pelo frontend para modelos `type = 'Nuvem de Pontos'` (hoje sem consumidor). Validar o shape na escrita (endpoint admin de cadastro, se existir) sem alterar o contrato de leitura.

**Arquivos afetados:**
- `src/modules/nomes/nomes.queries.js` (verificar) — confirmar que `c.style` está no SELECT (já incluído na Tarefa 3).
- `src/modules/nomes/nomes.schemas.js` (modificar, **se** houver endpoint de escrita de catálogo) — schema Joi para `style`.

**Padrão de código:** `_padroes.md` §3 (Joi na borda), §1 (JSONB preservado verbatim como já se faz com `geometry`/`properties` no atlas).

**Implementação:**
1. **Leitura:** `style` é JSONB; pg-promise já desserializa para objeto JS. Confirmar que o controller devolve `style` **como objeto** (não string). Não transformar — é um `Cesium3DTileStyle` (ex.: `{ "pointSize": 3, "color": "color('white')" }`) consumido literalmente pelo Cesium.
2. **Escrita (se aplicável a esta fase ou à UI de admin):** validar que `style` é um objeto JSON (Joi `Joi.object().unknown(true)` — não impor o vocabulário completo do Cesium, que é vasto e versionado). Para `type = 'Nuvem de Pontos'`, `style` é o caminho recomendado de estilização; não obrigatório.
3. **Frontend (fora deste repo):** documentar que ao migrar do `config.tilesets` o front deve aplicar `new Cesium.Cesium3DTileStyle(model.style)` aos point clouds — registrar como nota de contrato na Tarefa 6.

**Critérios de aceitação:**
- [ ] `style` é devolvido como **objeto JSON** (não string) no `GET /catalogo3d`.
- [ ] Um modelo `Nuvem de Pontos` com `style` no seed atravessa a API íntegro (round-trip JSONB).
- [ ] Se houver endpoint de escrita, `style` inválido (não-objeto) é rejeitado com 422.

**Testes:**
- `tests/integration/catalogo3d-style.test.js`: seed de um modelo `Nuvem de Pontos` com `style` aninhado; assert de igualdade profunda do `style` retornado.

**Dependências:** Tarefa 3 (SELECT já inclui `style`). fase-3 (trigger/coluna).

---

### Tarefa 5: Rastrear a origem do terrain (quantized-mesh) e decidir o serve

**Objetivo:** **Antes de servir terrain**, levantar a origem real do quantized-mesh (`localhost/terrain/...`), seu layout e volume, e só então decidir entre (a) servi-lo pelo endpoint de assets 3D da Tarefa 2 ou (b) reapontar o front para um tile server dedicado. **Esta tarefa começa como investigação, não como código.**

**Arquivos afetados (dependem do resultado da investigação):**
- `docs/plano/fase-4-catalogo3d-assets.md` (atualizar com o achado) — ou um ADR curto.
- (Se decidir servir pelo backend) reuso de `src/modules/nomes/assets3d.*` da Tarefa 2 — terrain é só mais um tipo de arquivo estático (`layer.json` + `{z}/{x}/{y}.terrain`), já coberto pelo content-type `.terrain` e pela lógica de Range/ETag.

**Padrão de código:** D-4.2 (rastrear antes de assumir). Reuso da Tarefa 2.

**Implementação:**
1. **Investigar** de onde o front busca terrain hoje: grep no `config.js`/bootstrap do `ebgeo_web` por `terrain`, `CesiumTerrainProvider`, `localhost/terrain`, `layer.json`. Identificar: é Cesium ion? `ctb-tile`/`cesium-terrain-builder`? Um tile server interno da DGEO? Um diretório de arquivos `.terrain`?
2. **Medir** o volume (terrain quantized-mesh de uma área grande pode ser dezenas de GB — relevante para decidir se cabe no backend ou exige tile server dedicado).
3. **Decidir e registrar:**
   - **Ramo A (cabe no backend / é um diretório de arquivos):** o terrain é servido como assets estáticos pela Tarefa 2 (já suporta `layer.json` JSON + `.terrain` octet-stream + Range/ETag). O front aponta `CesiumTerrainProvider` para `config.assets3dBaseUrl + '/terrain'`.
   - **Ramo B (volume grande / é um serviço externo):** **não absorver**; reapontar o front para o tile server interno via `GET /api/config` (fase-2). Documentar a URL do serviço.
4. **Não migrar terrain cegamente** — se a origem não for identificável, registrar como **risco aberto** e manter o front no host atual até esclarecer.

**Critérios de aceitação:**
- [ ] A origem do terrain está **documentada** (formato, layout, volume, serviço).
- [ ] Decisão A vs. B registrada com justificativa.
- [ ] Se A: `GET /api/v1/assets3d/terrain/layer.json` e um `.terrain` servem com Range/ETag/cache (reusa testes da Tarefa 2).
- [ ] Se B: a URL do tile server está no `GET /api/config` e o front a consome (coordenar com fase-2).

**Testes:**
- Se Ramo A: estender `tests/integration/assets3d.test.js` com fixtures de `layer.json` + um `.terrain` (Range/ETag).
- Se Ramo B: nenhum teste de backend novo; documentar o reaponte.

**Dependências:** Tarefa 2 (infra de assets, caso A). Investigação no repo do `ebgeo_web` (externo a este repo).

---

### Tarefa 6: Frontend consome a API — desligar `config.tilesets` hardcoded (nota de contrato)

**Objetivo:** Documentar e validar pelo lado do backend o contrato necessário para o `ebgeo_web` **deixar de usar `config.tilesets` hardcoded** e passar a consumir `GET /api/v1/nomes/catalogo3d` + `GET /api/v1/assets3d/*`. A mudança de código é **no frontend** (repo separado); aqui garantimos que o contrato do backend suporta o mapeamento 1:1.

**Arquivos afetados:**
- `docs/plano/fase-4-catalogo3d-assets.md` (esta seção) — tabela de mapeamento `config.tilesets` → `catalogo3d`.
- `src/modules/nomes/nomes.controller.js` (verificar) — confirmar que **todos** os campos do `config.tilesets` têm equivalente na resposta.
- Coordenação com **fase-2** (`GET /api/config`) para expor `assets3dBaseUrl`.

**Padrão de código:** `_padroes.md` §5 (contrato de frontend congelado — `config.js`). A migração do front é um **remapeamento de campos**, não mudança de semântica.

**Mapeamento `config.tilesets[i]` → item de `/catalogo3d` (1:1, referência):**

| `config.tilesets` (frontend hardcoded) | `ng.catalogo_3d` / resposta API | Observação |
|---|---|---|
| `name` | `name` | direto |
| `url` (caminho do `tileset.json`/`.glb`) | `url` (relativo) | resolver contra `config.assets3dBaseUrl` |
| `type` | `type` | `'Tiles 3D'` / `'Modelos 3D'` / `'Nuvem de Pontos'` |
| `lon`/`lat`/`height` | `lon`/`lat`/`height` | pose |
| `heading`/`pitch`/`roll` | `heading`/`pitch`/`roll` | orientação |
| `heightOffset` | `heightoffset` | nome em minúsculas no banco |
| `maximumScreenSpaceError` | `maximumscreenspaceerror` | idem |
| `style` (point cloud) | `style` (JSONB) | Tarefa 4 |
| (descoberta) | `palavras_chave`, `municipio`, `estado`, `thumbnail`, `description` | extras que o hardcoded não tinha |

**Implementação:**
1. Confirmar que **todo** campo consumido pelo front existe na resposta (já garantido pela Tarefa 3). Se faltar algum (ex. um flag de `show`/`enabled`), decidir: adicionar coluna em `ng.catalogo_3d` (migração aditiva) ou tratar no front.
2. Coordenar com a **fase-2** para `GET /api/config` expor `assets3dBaseUrl` (e, se Ramo B da Tarefa 5, a URL do terrain).
3. **Não** remover nada do backend por causa do front; o `config.tilesets` é deletado **no repo do front**, fora deste plano.

**Critérios de aceitação:**
- [ ] Para cada entrada de `config.tilesets` existe equivalente na resposta de `/catalogo3d` (tabela acima validada).
- [ ] `assets3dBaseUrl` documentado como campo do `GET /api/config` (fase-2).
- [ ] Nenhuma regressão: usuário anônimo/sem-token continua sem ver catálogo (catálogo exige auth — fase-3), mas isso **não** quebra o caminho local-first do atlas (o front cai no comportamento anterior se a chamada falhar — registrar como nota).

**Testes:**
- `tests/integration/catalogo3d-contract.test.js`: snapshot do shape da resposta cobrindo todos os campos da tabela de mapeamento.

**Dependências:** Tarefa 3 (resposta completa), Tarefa 4 (`style`), fase-2 (`GET /api/config`, para `assets3dBaseUrl`).

---

## 5. Riscos & cuidados

| Risco | Mitigação |
|---|---|
| **Servir terrain cegamente.** O `localhost/terrain/...` é host desconhecido; pode ser serviço externo de dezenas de GB. | **Tarefa 5 começa por investigação.** Não absorver antes de rastrear formato/volume. Se não identificável, manter o front no host atual e registrar risco. |
| **Path traversal no endpoint de assets.** `*` da rota vem do `url` do catálogo (e potencialmente de input). | `path.resolve` + checagem `startsWith(ROOT + sep)` (Tarefa 2). Teste obrigatório com `../` e `%2e%2e`. |
| **Vazamento de modelo privado.** Filtro de acesso só no middleware vaza com bug de app. | Filtro **embutido no SQL** (CTE), count alinhado, **teste com usuário sem permissão** (Tarefa 3). |
| **`ng.user_groups` ainda não existe** (é da fase-5/6) e a CTE referencia. | Stub vazio na migração 009 (`CREATE TABLE IF NOT EXISTS ng.user_groups ...`), documentado como preenchido na fase-6. |
| **Quebrar o contrato congelado de `/catalogo3d`** (fase-3). | Sem `private` no banco, resposta idêntica à fase-3 (teste de não-regressão). `style` como objeto, não string. |
| **CORS/Range bloqueando o Cesium.** | Confirmar origem em `CORS_ORIGIN`, `Accept-Ranges`/`Content-Range` expostos; **nunca wildcard** (`_padroes.md` §8). |
| **Copiar o semáforo `MAX_INFLIGHT` do 360 sem necessidade.** | Aqui usamos `createReadStream` (streaming do FS, sem materializar Buffer). Não copiar o semáforo — ele protege RSS de Buffers WebP no heap, inexistente aqui. |
| **`url` absoluta acoplada a host.** | D-4.1 Ramo A: `url` relativa no banco, resolução por `config.assets3dBaseUrl` no cliente. |

---

## 6. Definition of Done da fase

Além do DoD universal de `_padroes.md` §10, esta fase está concluída quando:

- [ ] Migração `009_model_permissions.sql` aplicada: `access_level` em `ng.catalogo_3d` (default `public`), `ng.model_permissions`, `ng.model_group_permissions`, stub `ng.user_groups`, índice parcial de públicos. Seeds da fase-3 permanecem públicos.
- [ ] `GET /api/v1/assets3d/*` serve `tileset.json`/`.b3dm`/`.glb` com ETag O(1) (`fs.stat`, sem ler o arquivo), **304** por `If-None-Match` antes do I/O, **Range 206**, **416** por range inválido, `Cache-Control: immutable`, `Accept-Ranges: bytes`, e **path traversal bloqueado**.
- [ ] `GET /api/v1/nomes/catalogo3d` aplica filtro de acesso **embutido no SQL** (public vs. admin/permissão direta/por grupo), com **count alinhado**; modelo privado não vaza para usuário sem permissão (teste negativo passa).
- [ ] Query de catálogo estruturada para a fase-6 só **adicionar** o ramo de zona espacial (gancho comentado), sem reescrever.
- [ ] `style` (Cesium3DTileStyle) trafega como objeto JSON íntegro; modelos `Nuvem de Pontos` consumíveis.
- [ ] **Origem do terrain documentada** e decisão (servir pelo backend vs. tile server externo) registrada; se servido, coberto pela infra de assets.
- [ ] Tabela de mapeamento `config.tilesets` → `/catalogo3d` validada (1:1); `assets3dBaseUrl` coordenado com a fase-2 (`GET /api/config`).
- [ ] Testes de integração novos (`assets3d`, `catalogo3d-access`, `catalogo3d-style`, `catalogo3d-contract`, `catalogo3d-permissions`) passam via `npm test`, com **caso negativo** de acesso coberto.
- [ ] `CLAUDE.md` atualizado: novo módulo de assets 3D, fonte única do catálogo 3D, e a nota de que `config.tilesets` é desligado no frontend.

---

## Apêndice — material preservado verbatim

> Os documentos-fonte serão apagados. O conteúdo abaixo é a referência canônica desta fase.

**Fonte de verdade do catálogo 3D (SERVICO-NOMES §7):**
> `ng.catalogo_3d` é a fonte de verdade dos metadados de posicionamento e descoberta dos modelos 3D mas NÃO guarda os binários. Guarda onde/como posicionar (`lon/lat/height`, `heading/pitch/roll`, `heightoffset`, `maximumscreenspaceerror`, `type`, `style`) e descoberta (`name`, `palavras_chave`, `thumbnail`, `search_vector`). `url` aponta o artefato servido separadamente, caminho relativo (`/aman/tileset.json`, `/estatua/estatua.glb`). Fluxo: Cesium chama `/catalogo3d` → recebe lista com `url` + pose → busca `tileset.json`/`.glb` e renderiza.

**Padrão ETag O(1) (EBGEO-360 §2 e §8 item 2 — reaproveitável p/ assets 3D imutáveis):**
> ETag = derivado de tamanho persistido, **sem ler o BLOB**; `Cache-Control: public, max-age=31536000, immutable`; short-circuit do **304** (`If-None-Match`) **ANTES** de qualquer I/O pesado; **Range 206** (parse `bytes=start-end`), **416** com `Content-Range: bytes */len`, `Accept-Ranges: bytes` em 200/206/304.

**Decisão pendente ao absorver (SERVICO-NOMES §7 / AVALIACAO §3.5):**
> Quem serve os binários (host de estáticos com URLs relativas, ou reescrever para absolutas). **Rastrear a origem do terrain antes de assumir o serve.**

**Filtro de acesso embutido na query (IDEIAS §1.3 item 20, `catalog3d.queries.ts`):**
> O filtro de acesso não vive em middleware, vive **dentro do SQL** via CTEs (`user_role` + `user_model_permissions`), decidindo linha a linha. Defesa em profundidade: o dado não vaza nem com bug na camada de aplicação. O `COUNT_*` repete EXATAMENTE o mesmo predicado de acesso (count não conta o que a busca esconde). Ver SQL embutido na Tarefa 3.

**Nota:** a **UI de administração do catálogo 3D** (cadastro de modelos, gestão de `model_permissions`, upload de thumbnails) é um **projeto FRONTEND separado** (scaffold `ebgeo_web_2_admin`, React/MUI). Esta fase **não** a implementa; apenas garante os **endpoints** que ela consome (catálogo, permissões de modelo, assets). A spec downstream da UI de admin está em `99-referencia.md`.
