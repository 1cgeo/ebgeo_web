# 00 — Visão Geral do Plano de Consolidação do EBGeo Backend

> **Status:** plano de implementação por fases.
> **Público-alvo:** agentes de IA que implementarão cada fase no backend atual.
> **Baseline de código:** branch `main`, migração head = `005_client_id_text.sql`.

---

## 1. Propósito e como usar este plano

Este conjunto de documentos consolida **6 documentos de análise/roadmap** (que serão deletados
após esta consolidação) em **um plano de implementação por fases**, escrito para que múltiplos
agentes de IA possam implementar cada fase de forma independente e correta, sem acesso aos
documentos-fonte originais.

**Como um agente deve trabalhar:**

1. **Sempre leia `_padroes.md` primeiro.** Ele define o template canônico de módulo, padrões de
   erro/validação/transação, convenções de migração, baseline de segurança, convenções de teste e
   o formato de "Definition of Done" (DoD) que todas as tarefas usam.
2. **Leia este `00-visao-geral.md`** para entender a arquitetura-alvo, os princípios transversais,
   as decisões abertas e o mapa de dependências entre fases.
3. **Abra o arquivo da sua fase** (`fase-N-*.md`). Cada fase é autocontida: traz o objetivo, o
   escopo, os fatos verificados de código relevantes (`findingsDigest`), o material de referência
   embutido verbatim (`preserveVerbatim`) e tarefas no formato DoD.
4. **Não comece uma fase sem que suas dependências estejam concluídas** (ver Mapa de Fases).
5. **`99-referencia.md`** guarda material que precisa sobreviver verbatim (SQL da busca, schemas de
   controle de acesso, contrato da API 360, shape do `config.js`, spec da UI de admin). Consulte-o
   sempre que uma fase referenciar um apêndice.

**Princípio de verificação:** os documentos-fonte continham afirmações que foram **verificadas
contra o código atual**. Onde os achados de verificação divergem dos docs, **os achados prevalecem**.
Cada fase já embute os achados relevantes — confie neles, mas confirme no código antes de editar.

---

## 2. Sumário executivo

**Decisão fundamental (já tomada): APROVEITAR o `ebgeo_backend` como núcleo. Não reescrever.**

O `ebgeo_backend` é o código server-side mais maduro, limpo e testado do ecossistema EBGeo
(~5.7k linhas de `src`, ~14k de teste, ~600 casos). Ele entrega o núcleo mais difícil e valioso:
autenticação JWT com refresh, o domínio de atlas colaborativo (clone/import/sharing), o motor de
sincronização, o gateway WebSocket e a camada-base de erro/validação/permissões/migração.

**O que ele é hoje:** o **núcleo colaborativo** de um backend, não "o backend único". Foi desenhado
com a constraint explícita "o backend é ADITIVO; a app funciona idêntica para usuário não
autenticado" e tomou decisões deliberadamente opostas ao que os outros serviços exigem: renuncia a
PostGIS por design, guarda geometria em JSONB, não tem conceito de organização/tenant, e serve
imagens pequenas sem as otimizações que o 360 precisa.

**O que falta NÃO é conserto, é construção aditiva:**

- **Hardening** (rate limit, validação de upload, auth timing-safe, idempotência, CI/Docker) —
  pré-requisito de qualquer caminho, independe de decisões.
- **Sync multiusuário completo** (modelo de conflito decidido, idempotência, `gridStyle`,
  `catalogLayer`, config temporal, merge atômico de mapas, viewport loading, monitor de qualidade).
- **Config dinâmico** (`GET /api/config` substituindo o `config.js` do frontend).
- **PostGIS + gazetteer** (busca de nomes geográficos de 7 critérios, `/feicoes`, `/catalogo3d`).
- **Catálogo 3D + distribuição de assets** (fonte única, full-text, servir tiles/glb/terrain).
- **Multi-org / identidade única** (entidade `organizations`, claim de org no JWT, auditoria).
- **Controle de acesso geográfico** (zonas espaciais, permissões de modelo, autorização na query).
- **Gateway + 360** (manter o 360 separado, unificar só o JWT).
- **Colaboração ponta a ponta** (opcional; o grosso é frontend).

**Custo:** o custo não está em refazer o que o backend já faz; está em **construir o que ele
deliberadamente não faz** (espacial, multi-org, BLOB pesado, config dinâmico).

---

## 3. Arquitetura-alvo

**Monólito modular em Express + PostgreSQL/PostGIS como núcleo**, com o `ebgeo_360` mantido como
microsserviço separado atrás de um gateway. **Não fundir tudo num processo só.**

```
  ebgeo_web (SPA, local-first IndexedDB)
        |
        v
  [ Gateway / NGINX (reverse proxy + SSO de JWT) ]
        |                              |
        v                              v
  +---------------------------+   +--------------------------+
  | BACKEND ÚNICO             |   | ebgeo_360 (microsserviço)|
  | Express + pg-promise + ws |   | Fastify + better-sqlite3 |
  |                           |   | serve BLOBs WebP (R-tree)|
  | Módulos:                  |   | mmap / semáforo / Range  |
  |  - auth (JWT + refresh)   |   +--------------------------+
  |  - users / org (OM)       |          |
  |  - atlas/maps/features    |          v
  |  - layers/groups          |   index.db + {slug}.db (SQLite, 41 GB)
  |  - briefings/slides       |
  |  - sync (LWW + log)       |
  |  - collab (WebSocket)     |
  |  - resources/images       |
  |  - config (GET /api/config) <- NOVO
  |  - nomes (gazetteer)        <- ABSORVIDO (PostGIS)
  |  - catalogo3d + assets 3D   <- ABSORVIDO + serve estáticos
  +-------------+-------------+
                |
                v
     PostgreSQL + PostGIS (UM banco, schemas separados)
       schema public/atlas:  JSONB   (atlas, maps, features.geometry JSONB, operations)
       schema ng:            PostGIS (nomes_geograficos, edificacoes, catalogo_3d, zonas)
```

**Princípios de arquitetura:**

- **JSONB e PostGIS coexistem** no mesmo banco, isolados por schema. O atlas continua JSONB
  (decisão correta para o caso de uso); o gazetteer entra como PostGIS no schema `ng`. Adicionar
  PostGIS é **aditivo** — não exige converter o atlas.
- **360 fica separado** (perfil de I/O read-heavy de BLOB e modelo de deploy offline distintos).
  Unifica-se **apenas o JWT** (mesmo emissor, mesmo segredo, claims alinhados).
- **Identidade única**: um emissor de JWT, payload comum (`sub`, `role`, `organization_id`); os três
  consumidores (web, nomes, 360) confiam no mesmo segredo/claims.
- **Fronteiras de módulo rígidas**: domínio colaborativo mutável (atlas, JSONB, CRDT/LWW) vs dado
  geoespacial imutável pesado (nomes, 3D, PostGIS, read-only) não se misturam no mesmo schema.

---

## 4. Decisões abertas (bloqueantes)

> Decisão **já tomada**: o backend único é o `ebgeo_backend`. As tentativas `ebgeo_web_2_backend`
> e `ebgeo_web_2_admin` são legado, usadas só como fonte de ideias (ver `99-referencia.md`).

| # | Decisão | Recomendação | Impacto |
|---|---------|--------------|---------|
| D1 | **Colaboração em tempo real: ativar agora ou depois?** O servidor de sync existe; o cliente é no-op (nenhum `new WebSocket`, `connectionState` nunca vai a ONLINE). | **Depois.** Fazer fase-0/1 (motor + idempotência + gridStyle/catalogLayer) já; ativar o cliente ponta a ponta (fase-8) só quando houver banda de frontend. A infra WS fica latente sem custo. | Muda significativamente o tamanho do projeto. Sem ativar, o atlas é persistência remota REST. |
| D2 | **Modelo de conflito do sync:** ligar o módulo `crdt` (LWW por timestamp+clientId) OU assumir append-only/LWW-por-chegada e remover o `crdt` morto. | **Assumir LWW-por-chegada + idempotência por op_id** (mais simples, suficiente para feições; o protótipo chegou à mesma conclusão). Remover/arquivar `src/crdt` morto OU plugá-lo só se LWW-por-timestamp for requisito real de produto. **Atualizar CLAUDE.md** (hoje afirma "Timestamp como comparador principal" — factualmente incorreto). | Perda de dados em edição concorrente difere entre as opções. Decisão de arquitetura registrada em fase-1. |
| D3 | **360: separado ou absorvido?** | **Separado** (recomendado). Captura 90% do ganho (um login, um gateway) por uma fração do custo. Absorver implica ETL dos 41 GB e paridade de performance (ETag O(1), mmap, semáforo). | Separado = dias (só unificar identidade). Absorvido = 2–4 semanas dominadas pelo ETL. |
| D4 | **Stack: JS ou TypeScript?** | **Manter JS puro** (zero atrito, aproveita a suite de ~600 testes atual). As tentativas antigas `ebgeo_web_2_*` são TS; carregar a IDEIA, não o código literal. | Decide o ponto de partida de todo código novo. |
| D5 | **UI de admin: aproveitar `ebgeo_web_2_admin` (React/MUI) como base?** | **Sim, como scaffold** (auth/layout/DataTable/padrão service+hook), adaptando as telas aos endpoints reais. É **projeto frontend SEPARADO** — o backend só precisa **prover os endpoints** (ver spec em `99-referencia.md`). | O backend tem endpoints de admin sem interface. As telas pressupõem o controle de acesso da fase-6. |

---

## 5. Princípios transversais

Todas as fases respeitam estes princípios (detalhados em `_padroes.md`):

1. **Aditivo.** O backend continua funcionando idêntico para usuário não autenticado. Nenhuma fase
   pode quebrar o caminho anônimo nem o contrato com o frontend existente.
2. **Sem locks reais (LWW).** Toda resolução de conflito é last-write-wins. O `locked` de
   mapa/camada/grupo/feição é **advisory** (enforçado só no cliente), salvo decisão explícita
   contrária em fase-1. Nenhuma ação requer lock.
3. **Schemas isolados.** Domínio colaborativo mutável (JSONB, schema atlas) vs dado geoespacial
   imutável (PostGIS, schema `ng`) não se misturam.
4. **Contratos de frontend congelados.** Os shapes que o frontend já consome (config.js, busca de
   nomes, metadado de foto 360, operação de sync) são **contratos congelados**. Mudá-los exige
   teste de contrato e alinhamento. Ver os contratos verbatim em `99-referencia.md`.
5. **Migrações aditivas e forward-only.** Toda migração nova é additiva (`ADD COLUMN`/`CREATE TABLE`),
   numerada (`006_`, `007_`...), rastreada em `_migrations`, idempotente a nível de tracking.
6. **Segurança como pré-requisito.** Nada vai a produção militar sem o hardening da fase-0.

---

## 6. Mapa de Fases

| Fase | Objetivo | Depende de | Esforço | Arquivo |
|------|----------|-----------|---------|---------|
| 0 ✅ | **Hardening e correções (IMPLEMENTADA)** — rate limit, Joi no /sync, política de upload, auth timing-safe + revogação de token, config endurecido, helmet CSP/HSTS, poolMax, bugs concretos (2.4), CI/Docker/lint, health com SELECT 1, cache no download de imagem | — | Médio | [fase-0-hardening.md](fase-0-hardening.md) |
| 1 ✅ | **Sync multiusuário (IMPLEMENTADA)** — decisão do modelo de conflito (D2), idempotência por op_id, `gridStyle`, `catalogLayer` por-camada, `temporal_config`, merge atômico de mapas, batch+ack, viewport loading (limitação documentada), monitor de qualidade, vocabulário de papéis | fase-0 | Alto | [fase-1-sync-multiusuario.md](fase-1-sync-multiusuario.md) |
| 2 ✅ | **Config dinâmico (IMPLEMENTADA)** — `GET /api/config` espelhando o shape do `config.js`; basemaps/tilesets de `resources`; URLs por ambiente; styles de baselayers | fase-0 | Médio | [fase-2-config-dinamico.md](fase-2-config-dinamico.md) |
| 3 ✅ | **PostGIS + Gazetteer (IMPLEMENTADA)** — extensões postgis/pg_trgm/unaccent + schema `ng`; busca de 7 critérios; `/feicoes`; `/catalogo3d`; módulo `nomes`; auth de leitura; `ng.refresh_busca()` | fase-0 | Alto | [fase-3-postgis-gazetteer.md](fase-3-postgis-gazetteer.md) |
| 4 ✅ | **Catálogo 3D + assets (IMPLEMENTADA, backend)** — `ng.catalogo_3d` fonte única; full-text PT-BR; servir assets 3D (Range/cache/ETag); Cesium3DTileStyle; permissões de modelo + filtro de acesso no SQL | fase-3 | Médio | [fase-4-catalogo3d-assets.md](fase-4-catalogo3d-assets.md) |
| 5 ✅ | **Multi-org / identidade (IMPLEMENTADA)** — entidade `organizations`; `organizacao_militar` → FK; papéis org-scoped; claim de org no JWT; emissor único; auth flexível JWT-ou-APIkey; `api_key_history`; `audit_trail` + `createAudit`; EnvironmentManager (logging multistream deferido) | fase-0 | Alto | [fase-5-multiorg-identidade.md](fase-5-multiorg-identidade.md) |
| 6 ✅ | **Acesso geográfico (IMPLEMENTADA, núcleo)** — `geographic_access_zones` (ST_Contains) + zone permissions; autorização embutida no SQL (nomes/feicoes/catálogo); `ng.fn_user_zone_geoms` único; índices parciais; admin de zonas + auditoria | fase-3, fase-5, fase-4 | Alto | [fase-6-acesso-geografico.md](fase-6-acesso-geografico.md) |
| 7 ✅ | **Gateway + 360 (PRONTA, backend)** — JWT emissor único + aliases org/login; config NGINX + contrato 360 + backup documentados; padrões 360 carregados. NGINX/backfill = deploy | fase-5 | Médio | [fase-7-gateway-360.md](fase-7-gateway-360.md) |
| 8 ✅ | **Colaboração ponta a ponta (backend pronto)** — ack/idempotência/qualidade/papéis (Fase 1) + handshake clientId estável; cliente WebSocket é frontend; Redis opcional | fase-1, fase-5 | Alto | [fase-8-colaboracao-e2e.md](fase-8-colaboracao-e2e.md) |
| 9 ⚠️ | **Absorver o 360 (PLANO)** — REVERTE a D3: serviço + metadados do `ebgeo_360` para dentro do backend (schema `sv360`, PostGIS); **BLOBs permanecem em SQLite** (`{slug}.db` via better-sqlite3). Plano feito, **não implementado**. | fase-3, fase-5, fase-0 | Alto | [fase-9-absorver-360.md](fase-9-absorver-360.md) |
| — | **Referência** — apêndices verbatim (SQL da busca, schema de acesso, audit_trail, contrato 360, shape config.js, spec UI admin, anti-padrões) | — | — | [99-referencia.md](99-referencia.md) |

**Caminho crítico recomendado:** fase-0 → (fase-1 ∥ fase-2 ∥ fase-3 ∥ fase-5) → fase-4 (após 3) →
fase-6 (após 3+5; suas Tarefas 6 e 8 de catálogo 3D/identify exigem também a **fase-4**, que
estende `ng.catalogo_3d` com `access_level`, cria as tabelas de permissão de modelo e o stub
`ng.user_groups`) → fase-7 (após 5) → fase-8 (após 1+5).

> **Nota sobre fase-6 → fase-4:** as Tarefas 1–5 da fase-6 (zonas geográficas + busca de nomes) só
> dependem de fase-3/fase-5. As Tarefas 6 e 8 (permissões de modelo 3D / identify) operam sobre
> `ng.catalogo_3d.access_level`, `ng.model_permissions`/`ng.model_group_permissions` e `ng.feicoes_3d`
> — todos introduzidos/estendidos pela **fase-4** —, logo essas tarefas só iniciam após a fase-4.

**Independências:** fase-0 não depende de nada e é pré-requisito de tudo. Fases 1, 2, 3, 5 podem
correr em paralelo após a fase-0.

> **⚠️ Números de migração são PLACEHOLDERS.** Como fase-0, fase-1, fase-2, fase-3 e fase-5 correm
> em paralelo após a fase-0, **vários arquivos de fase mencionam `006_*.sql` como slot inicial** —
> isso é apenas um placeholder, **não** um número absoluto reservado. **Ao implementar qualquer
> tarefa com migração, use o próximo número livre em `src/database/migrations/`** (independente do
> número escrito no arquivo da fase) **e preserve apenas a ordem relativa** prescrita em
> `_padroes.md §7`: `grid_style` → `idempotência operations` → `catalog_layers` → `postgis+ng` →
> `organizations + user_groups` → `zones/permissions` → `model_permissions` → `audit_trail/api_keys`.
> Nunca crie dois arquivos com o mesmo número. Em caso de colisão entre fases paralelas, **a ordem
> relativa de `_padroes.md §7` é a fonte de verdade** — renumere para o próximo número livre.

---

## 7. Glossário

| Termo | Definição |
|-------|-----------|
| **LWW** | Last-Writer-Wins. Resolução de conflito onde a última escrita vence. No backend atual, é LWW **por ordem de chegada** ao Postgres (não por timestamp — ver D2). |
| **CRDT** | Conflict-free Replicated Data Type. O módulo `src/crdt` existe mas é **código morto** (não plugado no caminho de escrita). |
| **op / operação** | Unidade de sincronização CRDT: `{id, entityType, operationType, entityId, mapId, data, timestamp, clientId}`. |
| **Snapshot** | Estado materializado do atlas retornado pelo pull quando `versão < min_version`, no formato idêntico ao IndexedDB do frontend. |
| **server_version** | Sequence global monotônica (`atlas_version_seq`) que ordena operações; base do pull incremental por atlas. |
| **Sub-entidade de mapa** | Op de sync cujo `entityType` mapeia para colunas da tabela `maps` (mapPosition, baseLayer, mapNotes, gridStyle, catalogLayer). |
| **Gazetteer** | Serviço de busca de topônimos (nomes geográficos). Fonte de verdade: `servico_nomes_geograficos` (`origin/main`). |
| **`ng`** | Schema PostGIS dedicado aos nomes geográficos, edificações e catálogo 3D. |
| **OM** | Organização Militar = tenant/organização. No 360 chama-se `organization`. |
| **EDGV** | Estrutura de Dados Geoespaciais Vetoriais (Topo 1.4); origem dos nomes via FME. |
| **SIRGAS 2000 / 4674** | Datum/SRID usado nos nomes geográficos (`geom GEOMETRY(POINT, 4674)`). |
| **idempotência** | Garantia de que reenviar a mesma operação (mesmo `op.id`) não duplica nem reaplica. Hoje **ausente** no log de operações. |
| **advisory lock** | `locked` é só uma flag; o servidor nunca rejeita escrita por entidade travada (enforçado no cliente). |
| **DoD** | Definition of Done — checklist de conclusão de tarefa (ver `_padroes.md`). |
