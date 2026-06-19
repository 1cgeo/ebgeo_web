# Avaliacao: refazer do zero vs aproveitar o ebgeo_backend

Data: 2026-06-14
Escopo: decidir se o `ebgeo_backend` deve ser reescrito do zero ou aproveitado como base do
"backend unico" do ecossistema EBGeo, que concentraria: login/colaboracao do `ebgeo_web`,
distribuicao de 360 (`ebgeo_360`), busca de nomes geograficos (`servico_nomes_geograficos`),
distribuicao de modelos 3D, e a substituicao total do `ebgeo_web/src/js/config.js`.

Metodo: investigacao multi-agente (14 agentes lendo o codigo-fonte dos quatro repositorios)
cobrindo arquitetura, modelo de dados, autenticacao, sincronizacao, modulos de dominio,
testes/devops, inventario do config.js, requisitos do frontend, plano de absorcao do 360,
plano de absorcao dos nomes, distribuicao 3D, reconciliacao de stacks, revisao de seguranca
e uma refutacao adversarial da hipotese de reuso.

---

## Veredito executivo

**APROVEITAR. Nao refazer do zero.** O `ebgeo_backend` e o codigo server-side mais maduro,
limpo e testado do ecossistema. Reescreve-lo jogaria fora ativos reais e caros: autenticacao
JWT com refresh, o dominio de atlas colaborativo (clone/import/sharing), o motor de
sincronizacao, o gateway WebSocket e uma suite de ~600 testes. O artesanato e bom; o problema
nao e a qualidade, e o **escopo**.

**Reenquadramento necessario:** hoje o `ebgeo_backend` **nao e** "o backend unico". Ele e o
**nucleo colaborativo** de um. Ele foi desenhado com uma constraint explicita ("o backend e
ADITIVO; a app funciona identica para usuario nao autenticado") e tomou decisoes de modelagem
**deliberadamente opostas** ao que os outros servicos exigem: renuncia a PostGIS por design,
guarda geometria em JSONB, nao tem nenhum conceito de organizacao/tenant, e serve imagens
pequenas sem as otimizacoes que o 360 precisa. Logo:

- Para o **atlas colaborativo**: reusar direto (refazer seria desperdicio).
- Para virar **backend unico**: aproveitar o **esqueleto** (estrutura de modulos, auth, camada
  de erro, validacao, runner de migracao) e **adicionar** os outros dominios como modulos novos
  com schema proprio. As partes espacial/360/multi-org/config-dinamico **nao existem** e precisam
  ser construidas, nao retrofitadas no modelo atlas-centrico.

**Sobre as tentativas anteriores (decidido):** existem dois repositorios `ebgeo_web_2_*`
(`ebgeo_web_2_backend`, TypeScript + Express + PostGIS, que chegou a portar os nomes com
controle de acesso por zona; e `ebgeo_web_2_admin`, um dashboard React/MUI completo de admin).
Sao **tentativas antigas, descartadas como destino**: nao sao o backend unico. Servem como
**fonte de ideias** (padroes de schema, controle de acesso geografico, e principalmente a UI de
admin, que o `ebgeo_backend` nao tem). Ver o Apendice no fim deste documento. O destino e o
`ebgeo_backend`.

---

## 1. Mapa do ecossistema hoje

| Projeto | Papel | Stack | Banco | Estado |
|---|---|---|---|---|
| `ebgeo_web` | Frontend SPA (mapa 2D MapLibre, 3D Cesium, 360 Three.js) | Vanilla JS + Vite | IndexedDB (local-first) | Em uso. Toda config em `config.js`. Sync/login escafaldados mas **inertes** (no-op) |
| `ebgeo_backend` | Nucleo de colaboracao (atlas/calcos) | Express 4 + pg-promise + ws | PostgreSQL, geometria **JSONB**, sem PostGIS | Prototipo maduro, parado desde 2026-03-08. ~5.7k linhas de src, ~14k de teste |
| `ebgeo_360` | Distribuicao de panoramas 360 | Fastify 5 + better-sqlite3 + Sharp | SQLite (1 central + 1 por projeto), **41 GB** de WebP | Em producao, multi-org, endurecido |
| `servico_nomes_geograficos` | Busca de toponimos, /feicoes 3D, catalogo 3D | Express + pg-promise | PostgreSQL + **PostGIS** (schema `ng`) | Em uso. Busca evoluiu para ranking de 7 criterios (origin/main). **Fonte de verdade dos nomes** |
| `ebgeo_web_2_backend` | Tentativa ANTIGA (descartada). Portou nomes + controle de acesso por zona | TypeScript, Express + pg-promise + PostGIS | Postgres + PostGIS, schema `ng` | Legado. Minerar ideias (ver Apendice) |
| `ebgeo_web_2_admin` | Tentativa ANTIGA (descartada). Dashboard de admin (usuarios/grupos/zonas/permissoes/logs/auditoria) | React 19 + Vite + MUI v6 + TS | (consome o _2_backend) | Legado. **Melhor ponto de partida para a UI de admin que falta** |

Observacao importante: o frontend ja consome tres enderecos distintos hoje
(`search.apiUrl` em :3001, `streetView360.serviceUrl` em :8081, pontos PMTiles em :3000).
Ou seja, **ja existe um padrao de microsservicos de fato**, que um gateway so precisaria
formalizar.

---

## 2. Diagnostico do `ebgeo_backend`

### 2.1 Pontos fortes (reaproveitaveis quase como estao)

- **Arquitetura por modulos verticais** (`routes/controller/service/queries/schemas/index`),
  rigorosamente consistente nos 10 modulos. Separacao de camadas respeitada de verdade.
  E o melhor candidato a virar o **template oficial** de modulo do backend unico.
- **Camada de erro** (`AppError` tipado com `isOperational` + subclasses semanticas +
  `error-handler` central que distingue Joi/AppError/desconhecido e **mascara stack em
  producao** + `asyncHandler`). Pronta para producao.
- **Config** com `required()/optional()` + `Object.freeze`, fail-fast no boot.
- **Validacao Joi** via middleware generico (`abortEarly:false`, `stripUnknown:true`,
  reatribui o valor coergido).
- **Autenticacao**: bcrypt custo 12, refresh token opaco forte armazenado **so como hash
  SHA-256** com rotacao, JWT assinado. Mais maduro que o 360 (que e JWT stateless puro).
- **Permissoes por recurso** (`resolvePermission` pura e testavel: owner > share > public),
  aplicada de forma consistente nas rotas aninhadas. Solido contra IDOR no caminho REST.
- **Dominio atlas**: `cloneAtlas`/`duplicateMap`/`importAtlas` sao transacionais e nao-triviais
  (remapeamento de IDs em duas passadas, clone de todas as sub-entidades). Nucleo de valor.
- **Modulos prontos**: users (self-service + admin com transferencia de posse), sharing
  (usuarios + link publico), images (single + bulk base64), resources (catalogo).
- **Suite de testes excepcional**: ~39 arquivos, ~600 casos cobrindo HTTP, CRDT e WebSocket,
  com runner que cria/migra/dropa o banco automaticamente. **Este e o maior argumento contra
  reescrever.**
- **Runner de migracao** idempotente (tabela `_migrations`, transacao por arquivo), portavel.
- `pg-promise` e 100% compativel com PostGIS sem troca de driver.

### 2.2 Limitacoes estruturais (o que ele deliberadamente NAO faz)

| Limitacao | Severidade | Impacto no backend unico |
|---|---|---|
| Sem PostGIS (geometria em JSONB por design) | critica | Bloqueia absorver gazetteer/nomes e qualquer consulta espacial server-side. **Mitigavel: JSONB e PostGIS coexistem no mesmo Postgres em schemas separados.** Adicionar PostGIS e aditivo, nao exige converter o atlas |
| Zero multi-org/tenant (`organizacao_militar` e texto livre, sem FK) | critica | Multi-org do 360 e a identidade unica exigem a entidade organizacao de primeira classe e generalizar a autorizacao |
| Servir BLOB 360 nao existe (images = stream simples, sem ETag O(1), sem Range 206, sem cache imutavel, sem semaforo) | alta | Absorver o 360 pelo modulo images seria reescrever pior um servico que ja funciona |
| Config estatico por env (`Object.freeze`) | media | Nao ha endpoint de config dinamico para substituir o `config.js`; precisa ser construido sobre `resources` + app-settings |
| Single-process (sem cluster/tuning de pool) | media | Pool min/max documentado mas nao aplicado; estado de salas WS so em memoria (nao escala horizontal sem Redis) |
| CRDT documentado nao roda | alta | Ver 2.3 |

### 2.3 O CRDT e codigo morto (decisao consciente necessaria)

O modulo `src/crdt` (resolver/merger com LWW por timestamp + clientId) **nao e importado por
nenhuma rota**. O caminho real de escrita (`applyOperation`) aplica todo UPDATE
incondicionalmente (`version = version + 1`, `updated_at = NOW()`), **sem comparar
client_timestamp**. Ou seja, a resolucao de conflito real e **last-write-wins por ordem de
chegada no servidor**, garantia mais fraca que a documentada. O `lamportTimestamp` que o cliente
gera com cuidado e **ignorado** pelo servidor.

Pior: no frontend, o subsistema de sync esta **100% inerte** por design. Nao existe nenhum
`new WebSocket`, o `connectionState` nunca transiciona para ONLINE, e nao ha `RemoteRepository`
implementado. Todo o aparato (fila de operacoes, dispatcher, Lamport clock) esta cabeado mas
nunca rodou de verdade.

Consequencia: quem integrar pode assumir garantias inexistentes. **Antes de promover o sync, e
preciso decidir explicitamente**: (a) ligar o `crdt` no `applyOperation` (guarda LWW por
timestamp + idempotencia por op_id), ou (b) assumir append-only/LWW-por-chegada e remover o
`crdt` morto para nao iludir. Registrar em DECISIONS.

### 2.4 Bugs concretos encontrados (pequenos, localizados)

- `sync.controller.pushOperations` faz broadcast com `result.applied`, mas o service retorna
  `{ acks, serverVersion }`. O broadcast sempre cai no fallback (ops cruas do cliente, sem
  `serverVersion`). Peers nao avancam `lastVersion` de forma confiavel.
- `images.service.uploadImage` calcula um `storagePath` e faz `mkdir`, mas o INSERT grava
  `file.path` (caminho do multer). Codigo morto que funciona por coincidencia.
- `users.service.deleteUser` nao e transacional (transfere posse de atlas e soft-deleta usuario
  em duas queries separadas).
- `INSERT_OPERATION` nao tem idempotencia (reenvio do cliente duplica e reaplica updates/deletes).
- Sessao de visitante publico quebra o INSERT em `active_sessions` (FK para `users`), engolido
  por try/catch.

### 2.5 Seguranca (precisa endurecer antes de producao militar)

| Gap | Severidade |
|---|---|
| **Sem rate limiting** em `/auth/login`, `/refresh`, `/register`, `/atlas/public/:link` (brute-force, enumeracao, flood) | critica |
| `POST /atlas/:id/sync` (caminho de escrita mais poderoso) **sem validacao Joi** no corpo | alta |
| **SVG** aceito como upload e servido **inline** = XSS armazenado no dominio do backend | alta |
| Upload base64 confia no `mimeType` do cliente (sem checar magic bytes) | alta |
| Login vulneravel a enumeracao por **timing** (pula bcrypt quando usuario nao existe) | alta |
| Sem deteccao de reuso de refresh token; troca/reset de senha **nao revoga** tokens existentes | alta |
| helmet com defaults (sem CSP/HSTS), `http` puro (TLS so via proxy nao documentado) | media |
| Self-registration aberto (rede militar normalmente nao deveria ter) | media |
| `JWT_SECRET` so checa presenca (nao forca entropia em producao); `jwt.verify` sem `algorithms:['HS256']` | media |

Nota positiva: **SQL 100% parametrizado** (sem SQLi, incluindo a unica SQL dinamica do sync,
que so interpola identificadores hardcoded), autorizacao por recurso bem feita, error-handler
nao vaza stack em prod.

### 2.6 DevOps (ausente, mas ortogonal ao codigo)

Sem Dockerfile/compose, sem CI (GitHub Actions), sem lint/formatter, sem rollback de migracao,
sem cache HTTP (nem ETag no download de imagem imutavel), health-check raso (nao checa o banco).
Tudo isso e somavel **sem mexer na logica de dominio**, e a suite de testes reduz muito o risco
de regressao ao adiciona-los.

---

## 3. Veredito por requisito do backend unico

### 3.1 Atlas colaborativo + auth + sync (nucleo)
**APROVEITAR INTEGRALMENTE.** E o melhor do repo e nao tem substituto nos outros servicos.
Pendencias: decidir o modelo de conflito (Secao 2.3), corrigir os bugs (2.4), endurecer
seguranca (2.5). Para o loop colaborativo funcionar de fato, falta **implementar no frontend**
a camada de transporte (cliente WebSocket + transicao para ONLINE + `RemoteRepository` + loop
send/ack/dequeue), que hoje nao existe.
Esforco: nucleo ja pronto; ativar colaboracao ponta a ponta = 2 a 3 semanas (o grosso e
frontend).

### 3.2 config.js -> `GET /api/config`
**CONSTRUIR (nao reescrever).** Nao existe endpoint de config; e o item mais claro de trabalho
novo. Estrategia: servir um JSON com **exatamente o mesmo shape** do `config.js` atual (419
linhas, chaves `app/features/services/search/basemaps/analysisLayers/dataLayers/map2d/map3d/
tilesets/streetView360`) para nao quebrar os dezenas de call-sites nem o `config.helpers.js`.
Os blocos que sao **dados** (tilesets, analysis/data layers, basemaps) vem de tabelas; as
**URLs de ambiente** (search, tileServer, 360, terrain) sao injetadas por config de deployment;
preferencias de UI seguem estaticas no payload.
**Pegadinha**: as URLs reais dos tiles dos basemaps **nao estao** no `config.js`, e sim em
`src/js/baselayers/*.js` (5 modulos com OSM/demotiles/BDGEx WMS/Google hardcoded). Para servir
100% da config, esses styles tambem precisam ser absorvidos no endpoint.
Esforco: 3 a 5 dias.

### 3.3 Busca de nomes geograficos (gazetteer PostGIS)
**ABSORVER como modulo PostGIS novo.** A fonte de verdade e o `servico_nomes_geograficos`
(`origin/main`, ranking de 7 criterios: cluster DBSCAN, `tipo_peso`, decaimento por zoom), que e
Express + pg-promise + PostGIS (mesma familia do backend). O codigo e PostGIS idiomatico e vira
um modulo `.queries/.service` direto, sem reescrever do zero. A tentativa antiga
`ebgeo_web_2_backend` ja fez um porte parecido e, melhor ainda, **adicionou controle de acesso
geografico por zona/usuario/grupo** que o microsservico original nao tem: minerar esse padrao
(ver Apendice), mas usar a busca do `origin/main` (a versao portada no _2 usa o ranking antigo).
- Adicionar PostGIS ao backend unico via migracao nova + schema `ng` (coexiste com o JSONB do
  atlas). Tratar nomes como **dado de referencia read-only** (carga em lote, fora do CRDT).
- Endpoint Python+GDAL de PDF georreferenciado: **descartar ou microsservico separado** (nao
  trazer GDAL para dentro do Node; nao tem relacao com nomes).
Esforco: 1 a 2 semanas.

### 3.4 Distribuicao de 360
**MANTER COMO MICROSSERVICO SEPARADO atras de gateway; NAO mover os BLOBs para o Postgres.**
O 360 ja resolveu, com cuidado, exatamente os problemas dificeis: servir WebP de 1-5 MB sob 512
MB de RAM, com Range 206/416, ETag O(1) sem ler o BLOB, cache imutavel de 1 ano, semaforo de
concorrencia. Sao **41 GB** em 22 projetos / 72k fotos. Meter binario grande em `bytea` infla o
banco, complica backup/VACUUM e perde para arquivo/sendfile. O perfil de I/O (read-heavy de BLOB)
e oposto ao CRUD transacional do nucleo; fundir acopla o caminho quente de imagem ao processo de
colaboracao (risco de OOM/contencao no event loop).
O que **unificar**: so o JWT/SSO (o 360 passa a confiar no mesmo emissor de token). O SQLite por
projeto e ate desejavel pelo modelo de deploy offline (um `.db` por missao via rsync).
Esforco: so unificar identidade (dias). Absorver de verdade (se mandatorio) = 2 a 4 semanas,
dominado pelo ETL dos 41 GB.

### 3.5 Distribuicao de modelos 3D + catalogo
**ABSORVER E UNIFICAR.** Hoje a distribuicao 3D esta **fragmentada em duas trilhas que nao
conversam**: (A) os 3D Tiles/GLB sao arquivos estaticos no repo do front (`public/3d/`) com o
catalogo **hardcoded** em `config.tilesets`; (B) a tabela `ng.catalogo_3d` (com busca full-text)
existe mas o frontend **nunca a consome**, e suas URLs usam prefixo diferente do front. Os tiles
de terreno (quantized-mesh) vem de um host externo desconhecido (`localhost/terrain/...`).
Caminho: promover `ng.catalogo_3d` a **fonte unica** (campos ja batem quase 1:1 com
`config.tilesets`), servir os assets estaticos (tileset.json + b3dm + glb + terrain) pelo backend
com CORS/Range/cache, e fazer o front consumir a API em vez do array hardcoded. Implementar
`Cesium3DTileStyle` para nuvem de pontos (hoje sem consumidor). **Rastrear a origem do terrain**
antes de assumir o serve.
Esforco: 1 a 2 semanas.

### 3.6 Multi-org / identidade unica
**CONSTRUIR, usando o 360 como referencia de design.** O `ebgeo_backend` nao tem tenant; o
`ebgeo_360` ja tem (organizations + organization_id + papeis system_admin/om_data_admin). O
proprio plano do 360 (`docs/PLANO-MULTI-ORG.md`, Parte 2) designa essa auth como semente do
backend unico. Acoes: criar a entidade organizacao de primeira classe **antes** de ativar
multiusuario, migrar `organizacao_militar` texto livre para FK, papeis org-scoped, claim de org
no JWT, e um emissor unico de token compartilhado pelos tres consumidores.
Esforco: ~1 a 2 semanas (alem do hardening de auth da Secao 2.5).

### 3.7 Tiles vetoriais / terreno / basemaps internos
**REAPONTAR + servir.** O front ja le tudo de `config.js`; basta o backend (ou um tile server
dedicado tipo Martin/pg_tileserv + terreno quantized-mesh) servir e o config apontar para os
servidores internos da DGEO. Os placeholders atuais (BDGEx publico, OSM, Google, demotiles) nao
podem ir para producao militar.
Esforco: 1 a 2 semanas se os tile servers ja existirem.

---

## 4. Arquitetura alvo recomendada

Monolito modular em Express + PostgreSQL/PostGIS como nucleo, com o 360 mantido como
microsservico atras de um gateway. Nao fundir tudo num processo so.

```
  ebgeo_web (SPA, local-first IndexedDB)
        |
        v
  [ Gateway / NGINX (reverse proxy + SSO de JWT) ]
        |                              |
        v                              v
  +---------------------------+   +--------------------------+
  | BACKEND UNICO             |   | ebgeo_360 (microsservico)|
  | Express + pg-promise      |   | Fastify + better-sqlite3 |
  |                           |   | serve BLOBs WebP (R-tree)|
  | Modulos:                  |   | mmap / semaforo / Range  |
  |  - auth (JWT + refresh)   |   +--------------------------+
  |  - users / org (OM)       |          |
  |  - atlas/maps/features    |          v
  |  - layers/groups          |   index.db + {slug}.db (SQLite, 41 GB)
  |  - briefings/slides       |
  |  - sync (CRDT/LWW)        |
  |  - collab (WebSocket)     |
  |  - resources/images       |
  |  - config (GET /api/config) <- NOVO
  |  - nomes (gazetteer)      <- ABSORVIDO (PostGIS)
  |  - catalogo3d + assets 3D <- ABSORVIDO + serve estaticos
  +-------------+-------------+
                |
                v
     PostgreSQL + PostGIS (UM banco, schemas separados)
       schema atlas:  JSONB   (atlas, maps, features.geometry JSONB, operations)
       schema ng:     PostGIS (nomes_geograficos, catalogo_3d, identify)
```

Principios:
- **JSONB e PostGIS coexistem** no mesmo banco, isolados por schema. O atlas continua JSONB
  (decisao correta para o caso de uso); o gazetteer entra como PostGIS.
- **360 fica separado** (perfil de I/O e modelo de deploy offline distintos).
- **Identidade unica**: um emissor de JWT, payload comum (`sub`, `role`, `organization_id`),
  os tres consumidores confiam no mesmo segredo/JWKS.
- **Fronteiras de modulo rigidas**: dominio colaborativo mutavel (atlas) vs dado geoespacial
  imutavel pesado (nomes, 3D) nao se misturam no mesmo schema.

---

## 5. Decisoes que dependem de voce (bloqueantes)

> Decisao ja tomada: o **backend unico e o `ebgeo_backend`**. As tentativas `ebgeo_web_2_backend`
> e `ebgeo_web_2_admin` sao legado, usadas so como fonte de ideias (ver Apendice). As decisoes
> abaixo continuam abertas.

1. **Colaboracao em tempo real: ativar agora ou depois?** O servidor esta pronto, o cliente e
   no-op. Se nao ativar agora, o atlas vira so persistencia remota REST (a infra WS fica latente
   sem custo). Isso muda o tamanho do projeto significativamente.
2. **360: separado (recomendado) ou absorvido?** Absorver implica ETL dos 41 GB e paridade de
   performance. Separado captura 90% do ganho (um login, um gateway) por uma fracao do custo.
3. **Stack do backend unico: JS ou TypeScript?** O `ebgeo_backend` e JS puro; as tentativas
   antigas `ebgeo_web_2_*` sao TS. Manter JS (zero atrito, aproveita a suite de testes atual) ou
   migrar para TS (mais seguranca de tipos num backend que vai crescer). Decide o ponto de partida.
4. **UI de admin: aproveitar o `ebgeo_web_2_admin` como base?** O backend tem endpoints de admin
   sem nenhuma interface. O dashboard antigo (React/MUI) cobre usuarios, grupos, zonas,
   permissoes, logs e auditoria. Vale como ponto de partida (ver Apendice) ou comecar do zero.

---

## 6. Roteiro por fases

Assumindo o cenario (A) e 360 separado. Estimativas para um dev focado.

**Fase 0 - Hardening e correcoes (independem de tudo, fazer ja): ~1 semana**
- Rate limiting em `/auth/*` e `/atlas/public/:link`.
- Validacao Joi do corpo de `/sync` (REST e WebSocket).
- Politica de upload: remover SVG inline + validar magic bytes (multipart e base64).
- Timing-safe no login, reuse-detection de refresh, revogar tokens na troca de senha.
- Endurecer config (entropia de `JWT_SECRET` em prod, `algorithms:['HS256']`), helmet (CSP/HSTS).
- Corrigir os bugs da Secao 2.4. Aplicar o `poolMax`.
- CI (GitHub Actions com Postgres em service container) + Dockerfile + docker-compose + lint.

**Fase 1 - Decisao do sync + config dinamico: ~1,5 a 2 semanas**
- Decidir e implementar o modelo de conflito (ligar `crdt` ou assumir append-only). Idempotencia.
- `GET /api/config` espelhando o shape do `config.js`; migrar dados de basemaps/baselayers/
  tilesets para tabelas; adaptar o bootstrap do front para buscar a config em runtime.

**Fase 2 - Gazetteer (nomes) + 3D: ~2 a 3 semanas**
- Migracao PostGIS + schema `ng`; portar a busca de 7 criterios fundida com o controle de acesso.
- Promover `ng.catalogo_3d` a fonte unica; servir assets 3D estaticos; front consome a API.
- Carga de dados (FME existentes) + recompute de cluster/tipo_peso. Descartar/isolar o PDF Python.

**Fase 3 - Identidade unica + gateway: ~1 a 2 semanas**
- Entidade organizacao de primeira classe; papeis org-scoped; claim de org no JWT.
- Emissor unico de token; 360 e nomes confiam no mesmo segredo.
- NGINX roteando para backend unico + 360; `config.js` aponta tudo para o gateway.

**Fase 4 (opcional) - Ativar colaboracao ponta a ponta: ~2 a 3 semanas**
- Cliente WebSocket no front, transicao para ONLINE, `RemoteRepository`, loop send/ack/dequeue.
- Testes e2e multiusuario; ajuste fino de conflito.

Total da consolidacao server-side (sem ativar colaboracao): **~6 a 9 semanas**. O custo nao esta
em refazer o que o `ebgeo_backend` ja faz; esta em **construir o que ele deliberadamente nao
faz** (espacial, multi-org, BLOB pesado, config dinamico).

---

## 7. Riscos principais

| Risco | Severidade | Mitigacao |
|---|---|---|
| Portar o gazetteer para o backend errado (confundir os dois backends) | critica | Fixar no plano: gazetteer em PostGIS; SIG colaborativo em JSONB. Decidir a Secao 5.1 primeiro |
| Forcar absorcao do 360/gazetteer na modelagem atlas-centrica gera retrabalho maior que manter separado | alta | Portar como modulos com schema proprio ou manter separados atras do gateway |
| Adicionar multi-org depois do atlas em producao obriga migracao com base instalada | alta | Modelar organizacao ANTES de ativar multiusuario, mesmo com uma org default |
| Perda de dados em edicao concorrente por LWW-por-chegada sem guarda por timestamp | alta | Decidir o modelo de conflito como decisao de arquitetura; cobrir com teste de ops fora de ordem |
| Re-porte da busca quebrar o filtro de acesso (vazar nomes privados) | alta | Manter o WHERE de acesso na CTE de candidatos, antes do LIMIT; testes com usuario sem permissao |
| Expor sem rate limit = brute-force/credential stuffing | critica | Fase 0, antes de qualquer exposicao |
| Quebra de contrato com o front (shapes de 360/busca/config) | media | Tratar os shapes como contratos congelados; testes de contrato; manter 360 antigo como fallback |
| ETL dos 41 GB (se absorver o 360) | alta | Nao absorver; se absorver, script idempotente, verificacao por tamanho, projeto a projeto, rollback |

---

## 8. Conclusao

Refazer do zero seria um erro. O `ebgeo_backend` entrega, com qualidade alta e ~600 testes, o
nucleo mais dificil e mais valioso (auth, atlas colaborativo, clone/import, motor de sync,
WebSocket). Esse nucleo se **reusa direto**, e o esqueleto (modulos, erro, validacao, migracao)
vira a base sobre a qual o resto se constroi.

O que falta para ele ser "o backend unico" nao e conserto, e **construcao aditiva**: PostGIS +
gazetteer, multi-org/identidade unica, endpoint de config dinamico, e a distribuicao 3D. O 360
fica como microsservico atras de um gateway. Os nomes ja existem como servico maduro
(`servico_nomes_geograficos`, fonte de verdade) e ja foram portados uma vez na tentativa antiga,
o que reduz o risco do porte. As tentativas `ebgeo_web_2_*` (descartadas como destino) entram so
como fonte de ideias: o padrao de controle de acesso geografico e a UI de admin (ver Apendice).

Antes de escrever codigo, resolva as quatro decisoes da Secao 5 (colaboracao agora vs depois,
360 separado vs absorvido, JS vs TS, e UI de admin). Em paralelo, a Fase 0 (hardening +
correcoes + CI/Docker) pode comecar ja, porque independe dessas decisoes e e pre-requisito de
qualquer caminho.

---

## Apendice: ideias a minerar das tentativas antigas (`ebgeo_web_2_*`)

Codigo legado e descartado como destino, mas com padroes uteis. Carregar a IDEIA, nao o codigo
literal (TS vs JS, schema diferente).

### Do `ebgeo_web_2_backend` (PostGIS + controle de acesso)

- **Controle de acesso geografico por zona (o item mais valioso):** tabelas
  `geographic_access_zones` (POLYGON), `zone_permissions` (por usuario) e `zone_group_permissions`
  (por grupo). A busca filtra com uma CTE: usuario e admin OU tem permissao direta OU via grupo
  (JOIN com `user_groups`) OU o registro e `public`. Resolve multi-tenant espacial que o
  microsservico de nomes nao tem. **Ao re-portar a busca de 7 criterios, fundir esse WHERE de
  acesso na CTE de candidatos, antes do LIMIT, para nao vazar nomes privados.**
- **Permissoes de modelos 3D:** `model_permissions` e `model_group_permissions` + campo
  `access_level` (public/private). Mesma estrutura das zonas, reaproveitavel para o catalogo 3D.
- **Auditoria estruturada:** tabela `audit_trail` (action, actor, target_type/id/name, details
  JSON, ip, user_agent, created_at) + helper `createAudit()` chamavel em qualquer operacao.
  O `ebgeo_backend` nao tem auditoria; para rede militar e desejavel.
- **API keys com historico:** `api_key_history` (key UUID, user, criado, revogado_em,
  revogado_por) para integracao maquina-a-maquina, complementando o JWT de usuario.
- **Full-text PT-BR:** trigger que mantem `search_vector` (tsvector) com pesos por campo +
  indice GIN + `plainto_tsquery('portuguese')` + `ts_rank()`. Ja presente tambem no
  `servico_nomes_geograficos`; confirma o padrao para o catalogo 3D.
- **Sanitizacao + validacao de coordenadas:** middlewares de limpeza de HTML e de validacao de
  lat/lon, uteis no hardening da Fase 0.

### Do `ebgeo_web_2_admin` (dashboard React/MUI) - ponto de partida da UI de admin

O `ebgeo_backend` tem endpoints de admin (usuarios, reset de senha, resources) mas **nenhuma
interface**. Este dashboard ja cobre o essencial e vale como base:

- **Telas prontas:** usuarios (CRUD + filtro + detalhes com grupos/API keys/permissoes), grupos,
  zonas geograficas (com editor GeoJSON e gestao de permissoes), permissoes de catalogo 3D, logs
  filtraveis, auditoria, dashboard com metricas (Recharts).
- **Padroes de codigo a copiar:** camada `services/<entidade>.ts` (axios centralizado), hooks
  `use<Entidade>` que encapsulam fetch/paginacao/filtro/CRUD, `AuthContext` + `ProtectedRoute`
  com flag `requireAdmin`, tipos em `types/<entidade>.ts` (DTOs + Responses), `DataTable`
  generico com paginacao, lazy loading de rotas, tema MUI com dark mode, toasts via Notistack.
- **Ressalvas:** React 19 + MUI v6 sao recentes (ok); faltam testes e ha alguns `any`. As telas
  pressupoem o schema do `_2_backend` (zonas/permissoes), entao so encaixam de fato apos o
  backend unico ganhar esse controle de acesso. Ate la, aproveitar o scaffold (auth, layout,
  DataTable, padrao service/hook) e adaptar as telas aos endpoints reais do `ebgeo_backend`.

### Prioridade de mineracao

1. Schema de controle de acesso geografico (zonas + permissoes de grupo) e de modelos 3D.
2. Scaffold da UI de admin (auth/layout/DataTable/padrao service+hook) como base do dashboard.
3. Auditoria (`audit_trail` + helper) e API keys com historico.
4. Confirmacao do padrao full-text PT-BR para o catalogo 3D.
