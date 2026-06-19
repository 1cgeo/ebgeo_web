# 11 — Gaps Multiusuário (Interface × Backend)

Cruzamento seção a seção do documento do frontend
`ebgeo_web/docs/acoes-interface-multiusuario.md` (**~313 ações em 29 seções**, revisão que
adicionou a **§29 Módulo Temporal** e o modelo de 4 papéis **Owner/Admin/Editor/Viewer**)
contra o suporte real do backend (verificado em `src/modules/sync/sync.service.js`,
`src/middleware/permissions.js` e nas migrações).

**Cobertura geral: ~95%.** A grande maioria das ações é puramente local (~46%) ou cai em
sync simples (broadcast + last-write-wins, ~49%) que o backend já atende. Os gaps abertos são
pontuais e estão detalhados ao final.

> **Princípio mantido:** o backend é **aditivo** e **sem locks**. Toda resolução de conflito é
> last-write-wins com timestamp. O `locked` de mapa/camada/grupo/feição é **advisory** — ver
> [Bloqueio (locking)](#bloqueio-locking-é-advisory).

---

## Legenda de status

- ✅ **Coberto** — backend já suporta (sync, REST ou broadcast existente).
- 🟢 **Local** — ação puramente local, sem necessidade de backend.
- ⚠️ **Parcial** — a maior parte é coberta, mas há item(ns) com gap (ver coluna Observações).
- ❌ **Gap** — não suportado hoje; exige mudança no backend.

---

## Modelo de papéis (4 papéis do frontend × backend)

O frontend define `UserRole = { owner, admin, editor, viewer }` (`session-context.js`), lê `role`
do JWT e assume `viewer` na ausência. O backend tem **dois eixos ortogonais**:

| Papel (frontend) | Equivalente no backend | Origem |
|------------------|------------------------|--------|
| `owner` | permissão por-atlas `owner` | `userId === atlas.owner_id` |
| `editor` | permissão por-atlas `write` | `atlas_shares.permission = 'write'` |
| `viewer` | permissão por-atlas `read` | share `read`, `is_public`, ou token público |
| `admin` | role **global** `users.role = 'admin'` | JWT `role` (gerencia usuários/recursos) |

**Divergência:** o JWT do backend carrega `role ∈ {user, admin}` (global), **não** `editor`/`viewer`.
A permissão por-atlas (`owner`/`write`/`read`) é resolvida à parte e exposta no campo `permission`
da mensagem `connected` do WebSocket (e em `req.atlasPermission` no REST). **Alinhamento sugerido:**
o frontend deriva o papel a partir desse `permission` (`write→editor`, `read→viewer`,
`owner→owner`), reservando `admin` para o `role` global. Não existe um tier "admin do mapa" — onde
o frontend diz "permissão de admin ou owner do mapa", o backend só conhece `write` no atlas.

---

## Matriz de cobertura por seção

| § | Seção | Ações | Status | Observações |
|---|-------|------:|--------|-------------|
| 1 | Barra Lateral — Mapas | 19 | ⚠️ | CRUD/duplicate/reorder ✅. **Item 14** (puxar/combinar mapas) → gap P3. **Item 19** (controle temporal do mapa) → gap P2 (config temporal). |
| 2 | Barra Lateral — Camadas | 33 | ⚠️ | layer/group/feature CRUD via sync ✅. **Itens 15,16,25** (catálogo/análise persistidos por mapa) → gap `catalogLayer`. `locked` advisory. |
| 3 | Barra Lateral — Briefings | 9 | ✅ | briefing/slide via sync + awareness `briefing_edit_*`. |
| 4 | Barra Lateral — Processamento | 5 | ✅ | resultados = `layer`/`feature` create via sync. |
| 5 | Barra Lateral — Importar | 8 | ✅ | batch `feature` create; imagens via REST. |
| 6 | Barra Lateral — Exportar | 10 | 🟢 | tudo local (PDF, PNG, Garmin KMZ). |
| 7 | Toolbar — Desenho | 8 | ✅ | `feature` create ao completar. |
| 8 | Toolbar — Militar | 7 | ✅ | `feature` create (símbolo, medida, seta, limite, frente, declinação). |
| 9 | Toolbar — Análise | 2 | ✅ | LOS/Viewshed = `feature` create. |
| 10 | Toolbar — Utilitários | 6 | ✅ | efêmero local; "salvar como feição" = `feature` create. |
| 11 | Controles Inferiores | 8 | 🟢 | navegação/visualização local. |
| 12 | Barra de Busca | 10 | ✅ | busca local; "criar feição/ponto" = `feature` create. |
| 13 | Seletor de Camada Base | 2 | ✅ | sub-entidade `baseLayer` → coluna `base_layer`. |
| 14 | Menu de Contexto | 13 | ✅ | group/feature ops; mover p/ mapa (`map_id` ✅); split/merge = create+delete. |
| 15 | Interação Direta com o Mapa | 12 | ✅ | mover/editar vértices = `feature` update (LWW). |
| 16 | Atalhos de Teclado | 6 | ✅ | undo/redo no frontend; delete = soft-delete via sync. |
| 17 | Painel de Feição | 20 | ✅ | atributos/estilo/etiqueta = `feature` update; fotos via REST images. |
| 18 | Tabela de Atributos | 14 | ✅ | edição inline = `feature` update; add/del coluna = batch. |
| 19 | Catálogo de Camadas Externas | 5 | ⚠️ | **Item 4** (persistir camada de análise/dados/sombreamento) → gap `catalogLayer`. Itens 3D/360 abrem viewer (local). |
| 20 | Viewer 3D (Cesium) | 25 | ✅ | `cesium3d` (marker/measurement/viewshed/camera_position) via aliases. |
| 21 | Street View 360 | 15 | ✅ | `streetview360` (marker/orientation) via aliases. |
| 22 | Editor de Briefing | 10 | ✅ | slides via sync; importar slides = clone com novos UUIDs (frontend). |
| 23 | Apresentação de Briefing | 11 | 🟢 | navegação/validação/lock temporário local. |
| 24 | Modais | 10 | ⚠️ | **Item 3** (combinar mapas) → gap P3. Item 8 (exagero de terreno) ✅ `settings`. Itens 9,10 ✅. |
| 25 | Display de Coordenadas | 4 | 🟢 | preferências locais. |
| 26 | Grade UTM | 3 | ❌ | **`gridStyle` é no-op** — sem coluna de grade em `maps`. |
| 27 | Deep-link / URL | 4 | 🟢 | hash de viewer local. |
| 28 | Layout Mobile | 14 | ✅ | espelha o desktop (mapas, camadas, feições, base layer). |
| 29 | Módulo Temporal | 20 | ⚠️ | **Por feição** (`temporalInicio`/`temporalFim`/`trajetoria`/`auto*`/`dateTimeGroup`/`gdh*`) ✅ em `properties`. **Config por mapa** (itens 1,8-11) → gap P2. Cursor/reprodução local 🟢. |

---

## Gaps abertos — detalhe técnico

### P1 — `gridStyle` é no-op (§26 Grade UTM)

**Frontend emite** (`settings.operations.js`, `grid.control.js`), mesmo envelope do `baseLayer`:

```js
{ entityType: 'gridStyle', operationType: 'create' | 'update',
  entityId: <mapId>, mapId: <mapId>,
  data: { format: 'latlong' | 'utm', visible: true } }
```

**Backend** mapeia `gridStyle → { target: 'map', subType: 'grid' }` (`sync.service.js`
`ENTITY_TYPE_MAP`), mas:
- `MAP_UPDATE_FIELDS` **não tem** nenhuma coluna de grade;
- não existe coluna `grid`/`grid_style` na tabela `maps`;
- `normalizeMapChanges` não define alias para `format`/`visible`.

Resultado: `buildDynamicUpdate('maps', {format, visible}, ...)` não gera SET clause → retorna
`null` → **no-op silencioso**. A grade nunca persiste nem entra no snapshot.

**Fix sugerido:**
1. Migração: `ALTER TABLE maps ADD COLUMN grid_style JSONB NOT NULL DEFAULT '{}'`.
2. Adicionar `{ column: 'grid_style', jsonb: true }` a `MAP_UPDATE_FIELDS` e alias
   `grid_style ← {format, visible}` em `normalizeMapChanges` (ou aceitar o objeto inteiro).
3. Incluir `grid_style` em `GET_ATLAS_MAPS` e no objeto de mapa do snapshot.

---

### P1 — `catalogLayer` incompatível (§19 item 4; §2 itens 15,16,25)

**Frontend emite ops por camada** (`catalog.operations.js`, via `createEntityLogger`):

```js
// create / update / delete — uma op por camada do catálogo
{ entityType: 'catalogLayer', operationType: 'create' | 'update' | 'delete',
  entityId: <layerId UUID>, mapId: <mapId>,
  data: { id, type, name, visible, opacity, status, config, styleOverrides, sync } }
```

**Backend** mapeia `catalogLayer → { target: 'map', subType: 'catalog' }` e tenta um UPDATE no
**array inteiro** `maps.catalog_layers`. O payload (um objeto de camada, sob `entityId` = id da
camada) não corresponde a nenhuma coluna de `MAP_UPDATE_FIELDS` (não há alias
`catalogLayer`/`catalogLayers → catalog_layers`) → **no-op**. Além disso, `create`/`delete` de
camada não têm caminho no fluxo de sub-entidade de mapa (que é update-only).

**Fix sugerido (escolher um modelo):**
- **A.** Tratar `catalogLayer` como entidade própria: merge por `id` dentro do array JSONB
  `maps.catalog_layers` em create/update e remoção em delete; ou
- **B.** Tabela dedicada `catalog_layers (id, map_id, ...)` com soft-delete, espelhando o padrão
  das demais entidades de sync.

Em qualquer caso, incluir o resultado no snapshot (já existe `catalog_layers` no `GET_ATLAS_MAPS`).

---

### P2 — Config temporal por mapa (§29 itens 1, 8–11)

A config é **estado compartilhado do mapa** (broadcast + LWW), escopo `temporal_<mapa>`:

```js
{ ativo: false, unidade: 'MINUTO'|'HORA'|'DIA'|'SEMANA',
  inicio: <epoch ms|null>, fim: <epoch ms|null>,
  modo: 'absoluto'|'relativo', origem: <epoch ms|null> }
```

**Estado atual (dois lados):**
- **Frontend:** `temporal.operations.js` é **local-only** — persiste em `temporal_<mapName>` e emite
  apenas eventos de EventBus (`MAP_TEMPORAL_CHANGED`, `TEMPORAL_CONFIG_CHANGED`). **Nenhuma op de
  sync é emitida** (não há valor temporal no enum `EntityType`).
- **Backend:** não há coluna para a config; o whitelist de `map` a descartaria.

**Fix sugerido (quando o frontend ligar o sync):**
1. Migração: `ALTER TABLE maps ADD COLUMN temporal_config JSONB NOT NULL DEFAULT '{}'`.
2. Nova sub-entidade `mapTemporal → { target: 'map', subType: 'temporal' }` +
   `{ column: 'temporal_config', jsonb: true }` em `MAP_UPDATE_FIELDS`.
3. Incluir no snapshot e fazer broadcast (já coberto pelo broadcast `operations` do push).

> **Cursor, reprodução, velocidade e "modo revelar" são estado local por usuário** (itens 2–7) —
> nunca vão ao servidor (análogo a pan/zoom). Awareness do instante temporal é opcional.

---

### P3 — Sub-canais WS por mapa

Hoje toda mensagem WS (cursor, seleção, operações) é broadcast para a room inteira (atlas).
Otimização: filtrar cursor/seleção por mapa ativo. Não afeta corretude — só tráfego.

### P3 — Combinar mapas / merge atômico (§1 item 14; §24 item 3)

Não há endpoint que mova feições de múltiplos mapas para um destino **atomicamente**. Contornável
hoje por um batch de ops `feature` com `map_id` novo (já suportado em `UPDATE_FIELDS.feature`), mas
sem garantia transacional única. Um `POST /atlas/:id/maps/:mapId/merge` resolveria com atomicidade.

---

## Bloqueio (locking) é advisory

`locked` existe em `maps` (004), `layers` e `groups` (002) e é um **campo mutável comum** no sync —
o backend **nunca rejeita** uma escrita/delete por a entidade estar travada (`applyOperation` não tem
nenhuma checagem de `locked`). Onde o frontend diz "respeita bloqueio de mapa" / "desabilitado com
mapa bloqueado" (§1.5, §2.5/12/27, §21.12/13, §29.1), a regra é **enforçada só no cliente**. Se for
necessário enforcement no servidor, adicionar checagem de `locked` antes do UPDATE/soft-delete no
`applyOperation` (rejeitando com erro de sync). Decisão consciente: hoje é advisory por design.

---

## O que já funciona "de graça" (sem mudança no backend)

| Item | Por quê |
|------|---------|
| **Dados temporais por feição** (`temporalInicio`, `temporalFim`, `trajetoria` `[{t,lng,lat}]`, flags `autoDtg`/`autoDirection`/`autoSpeed`, `dateTimeGroup`, `gdhIni`/`gdhFim`) | Viajam dentro de `data.properties.*` de uma op `feature` normal; `properties` é JSONB e é gravado verbatim (§29 itens 13–20). |
| **Reagendamento temporal em massa** (§29 item 12) | Batch de ops `feature` (o frontend calcula os deltas). *Depende* da config temporal por mapa para limites/origem (gap P2). |
| **Exagero de terreno** (§24 item 8) | `atlas.settings.terrainExaggeration` (JSONB) via `PATCH /settings` + broadcast `atlas_settings_updated`. |
| **Undo/Redo** (§16) | Frontend gera ops inversas; backend já suporta create↔delete e update com `previousData`. |
| **Split/merge de geometrias** (§14 itens 10–12) | Frontend gera create+delete. |
| **Importação geoespacial** (§5; GeoJSON/SHP/KML/GPX/CSV/coords) | Parsing no frontend → batch de `feature` create (tracks com tempo viram pontos móveis). |
| **Deep-link / Garmin KMZ / exportações** (§6, §27) | Puramente local. |

---

## Resumo de ações recomendadas no backend

| Prioridade | Ação | Esforço |
|-----------|------|--------|
| P1 | Coluna `maps.grid_style` + `MAP_UPDATE_FIELDS` + snapshot (`gridStyle`) | Baixo |
| P1 | Tratar `catalogLayer` por-camada (merge no JSONB ou tabela dedicada) | Médio |
| P2 | Coluna `maps.temporal_config` + sub-entidade `mapTemporal` + snapshot | Baixo (aguardar frontend emitir op) |
| P3 | Endpoint de merge de mapas atômico | Médio |
| P3 | Sub-canais WS por mapa | Médio |
| — | Alinhar vocabulário de papéis (`editor`/`viewer`) ou documentar mapeamento | Baixo |
| — | (Opcional) Enforcement server-side de `locked` | Baixo |

> Referência cruzada: resumo em `CLAUDE.md` › "Limitações Conhecidas e Gaps para Multiusuário" e
> em [README.md](../../README.md) › "Gaps Conhecidos do Backend".
