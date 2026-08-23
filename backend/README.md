# EBGeo Backend

API REST + WebSocket (Node 20, ES Modules) do app de mapeamento geoespacial militar **EBGeo**.
Adiciona ao frontend local-first: autenticação JWT, persistência PostgreSQL/PostGIS, colaboração em
tempo real e sincronização offline-first.

> **Constraint fundamental:** o backend é **aditivo**. A aplicação funciona idêntica para usuário
> **não autenticado** (dados locais no IndexedDB), e nenhuma mudança pode quebrar o caminho anônimo
> nem os contratos congelados do frontend. Isso vale para o LOGIN, não para a disponibilidade: o boot
> do frontend é fail-fast em `GET /api/config`, sem fallback estático.

Este arquivo é o que se precisa para **subir, migrar e testar** o servidor. O resto mora em outro
lugar de propósito, porque referência copiada apodrece:

| Você quer | Vá para |
|-----------|---------|
| rotas, permissões, protocolo WS, envelope de sync, contratos congelados, limites conhecidos | a wiki: [../docs/wiki/index.md](../docs/wiki/index.md) |
| o contrato de comportamento (o que não violar, e por quê) | [CLAUDE.md](CLAUDE.md) |
| variáveis de ambiente e como colocar em produção | [../docs/wiki/deploy-backend.md](../docs/wiki/deploy-backend.md) e o `.env.example` anotado |
| o que uma rota faz | o próprio módulo: `src/modules/<nome>/<nome>.routes.js` |

Até 2026-08-14 este README tentava ser a "referência completa" e duplicava a wiki em rotas, env,
permissões, protocolo WS e gaps conhecidos. Duas cópias da mesma verdade divergem, e a que ninguém
testa é a que mente: a tabela de migrações daqui parou em `009` enquanto o disco já tinha `014`.

---

## Visão Geral

```
  ebgeo_web (SPA local-first, IndexedDB)
        │  REST (metadados, sharing, imagens) · Sync API (operações) · WebSocket (colaboração)
        ▼
  Backend único, Express + pg-promise + ws (JS puro)
        ▼
  PostgreSQL + PostGIS (UM banco, schemas isolados)
   public/atlas:  JSONB   (atlas, maps, features.geometry, operations)
   ng:            PostGIS (nomes_geograficos, edificacoes, catalogo_3d, zonas)
   sv360:         PostGIS (projects, photos[geom], targets) + {slug}.db (BLOBs WebP)
```

A divisão que decide onde escrever cada coisa:

| Tipo de dado | API |
|--------------|-----|
| Atlas metadata, compartilhamento, imagens | REST |
| Features, layers, groups, maps, briefings, slides, 3D, 360 | **Sync / WebSocket**. Escrita INCREMENTAL só via sync; as três exceções de entidade inteira estão em [CLAUDE.md](CLAUDE.md) |
| Nomes geográficos, catálogo 3D, panoramas 360 | REST read-only (PostGIS) |

`Express 4` · `pg-promise` (SQL direto, sem ORM) · `ws` · `jsonwebtoken`+`bcrypt` · `joi` · `pino` ·
`better-sqlite3` (BLOBs 3D/360). Node 20 LTS, ES Modules.

```
src/
├── index.js            # boot (HTTP + WS + validateEnvVariables fail-fast)
├── app.js              # factory createApp() (testável por supertest)
├── config.js           # env: required() / optional(), Object.freeze
├── database/           # index.js (query/tx), migrate.js, migrations/
├── middleware/         # auth, flexible-auth, permissions, validate, error-handler, ...
├── modules/<nome>/     # um `ls src/modules/` é a lista autoritativa
└── utils/              # errors, logger, async-handler, audit, sqlite-blob-pool, ...
```

---

## Subir

```bash
cp .env.example .env     # leia o cabeçalho: em dev o backend é :8080 e o Vite :3000
npm run db:setup         # cria o banco com o DONO certo + extensões (PostGIS exige superusuário)
npm run db:migrate
npm run db:seed          # dados de teste
npm run dev              # node --watch
```

`db:setup` existe porque no Postgres 15+ só o dono do banco cria no schema `public`: um `createdb`
feito pelo superusuário deixa o dono errado e as migrações falham com "permissão negada para
esquema public", sem pista do porquê. O racional inteiro está no cabeçalho de
`scripts/dev-db.js`.

Credenciais após `npm run db:seed`: `admin` / `admin123` (role admin) e `cap.silva` / `test123`
(role user).

---

## Testes

```bash
npm test                 # cria DB ebgeo_test → migra → roda (unit+integration+ws) → dropa
npm run test:unit | test:integration | test:ws
npm run test:keep-db     # mantém o DB após os testes (debug)
npm run test:coverage    # c8 explícito (o piso já é verificado pelo `npm test` sem argumento)
npm run lint             # o probe das regras próprias e DEPOIS o eslint --max-warnings 0
npm run format           # prettier
```

Os testes batem no `app` exportado via **supertest**, sem subir servidor. `npm test` é hermético
(cria e dropa `ebgeo_test`). **PostGIS é extensão untrusted**: o runner pré-cria as extensões via
`SUPERUSER_DATABASE_URL` (default `postgres:postgres@localhost`). Overrides do banco de teste:
`TEST_DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`.

- **Máquina sem o papel `ebgeo`** (Postgres local só com `postgres:postgres`):
  `DB_USER=postgres DB_PASSWORD=postgres npm test`.
- **Subconjunto:** o runner usa **um** padrão só (`args.find(a => !a.startsWith('--'))`), então
  passar dois arquivos roda o primeiro e devolve verde sobre metade do que você pediu. Use chaves:
  `node scripts/run-tests.js "tests/integration/{a,b}.test.js"`.
- **Com paralelismo**, dê um `TEST_DB_NAME` por execução: duas execuções no mesmo banco derrubam
  uma à outra no drop e produzem falha em massa que não é do código.

### Piso de cobertura (`.c8rc.json`)

JSON não aceita comentário, então a justificativa dos números mora aqui: statements 96 · lines 96 ·
branches 85 · functions 93, com `check-coverage` ligado.

O piso fica **logo abaixo** do medido de propósito: ele existe para impedir REGRESSÃO, não para
reprovar o estado atual. Folga grande demais não prende nada (um módulo novo inteiro sem teste
passaria); folga pequena demais reprova trabalho legítimo e acaba sendo afrouxada, que é como um
guarda morre. Cerca de 1 ponto foi o meio-termo: derrubar um arquivo de teste ou somar um módulo sem
cobertura estoura, refatorar não. **Ao subir a cobertura, suba o piso junto**, senão piso vira teto.

`src/database/seed.js` está **fora** do `include`: é script operacional (`npm run db:seed`, senhas
fixas), nunca importado pela aplicação. Testá-lo seria afirmar que um fixture insere linhas, e só
maquiaria o percentual.

**O piso alcança quem esquece.** Ele era avaliado só no `test:coverage`, ou seja, pegava quem o
rodava e não quem esquecia, enquanto o comando do Definition of Done é `npm test`. Hoje o
`scripts/run-tests.js` se auto-eleva: sem padrão (suíte completa) ele re-executa sob `c8` e o piso é
verificado; com padrão (`npm test -- <arquivo>`), não. A assimetria é obrigatória, não conveniência:
medido, um arquivo só contra o piso GLOBAL dá ~50% de linha contra piso de 96, então elevar o loop
de trabalho reprovaria todo trabalho legítimo. A trava de recursão é o `NODE_V8_COVERAGE` que o
próprio `c8` define.

> Cobertura medida com **a árvore parada**. Com vários agentes escrevendo, cada suíte que não
> carrega derruba a cobertura das linhas que ela exercitaria, e o número mente para baixo, que é
> justamente a direção que parece alarme legítimo.

### Regras de lint próprias

`eslint-rules/` traz três regras que vigiam **cobertura vazia em teste**: `no-conditional-assert`,
`no-disjunctive-assert` e `no-unasserted-loop-assert`. Na primeira execução acharam 46 violações
reais em 28 arquivos. O `npm run lint` roda `eslint-rules/probe.js` ANTES do eslint, e o probe
verifica as regras contra fixtures de deve-pegar e não-deve-pegar, porque regra de lint também é
verificador e verificador quebra calado.

---

## Template de módulo

Um arquivo por responsabilidade. Referência viva: `src/modules/atlas/`.

| Arquivo | Responsabilidade |
|---------|------------------|
| `<nome>.routes.js` | **Só** rotas. Ordem dos middlewares `[auth, requireAtlasPermission(...), validate({...}), ctrl.X]`. Export nomeado. |
| `<nome>.controller.js` | Camada HTTP. Cada handler é `asyncHandler(async (req, res) => …)`; lê `req`, chama o service, escreve `res.json({ data })` / `201` / `204`. Mutação colaborativa **broadcasta WS** após a escrita, antes do `res`. |
| `<nome>.service.js` | **Toda** a lógica de negócio. Importa `{ query, tx }` e `* as Q`. Lança erros de domínio. |
| `<nome>.queries.js` | Constantes SQL em maiúsculas com `$1,$2`. Sem lógica. |
| `<nome>.schemas.js` | Schemas Joi, com `.custom()` para regra cross-field. |
| `index.js` | Re-export (`export { atlasRoutes } …; export * as atlasService …`). |

As convenções de código que governam o conteúdo desses arquivos (erros por `AppError`, validação na
borda, os dois retornos do pg-promise, SQL parametrizado, broadcast) estão em [CLAUDE.md](CLAUDE.md),
em um lugar só.

### Definition of Done

- [ ] Segue o template de módulo e a convenção de nomes.
- [ ] Rota de escrita tem `validate()` Joi; erros usam `AppError`/`asyncHandler`.
- [ ] Multi-query atômica via `tx()`; SQL 100% parametrizado.
- [ ] Migração aditiva, numerada; filtro de acesso com teste NEGATIVO (usuário sem permissão).
- [ ] Mutação colaborativa faz broadcast WS; contratos congelados intactos.
- [ ] `npm run lint` limpo e `npm test` verde; a wiki atualizada se o comportamento documentado mudou.

---

## Migrações

`src/database/migrations/NNN_*.sql`, ordem alfabética, tracking em `_migrations` (cada arquivo numa
`tx`), **forward-only** (sem rollback) e **aditivas** (`ADD COLUMN DEFAULT`, `CREATE TABLE/INDEX`).

- Use o **próximo número livre**, conferido com `ls src/database/migrations/`. Nenhum documento diz
  qual é o head: número fixo em prosa envelhece a cada migração.
- `gen_random_uuid()` para PK (não `uuid_generate_v4`). `CHECK` em todo enum textual. Soft-delete via
  `deleted_at`/`is_active`. Índice parcial para a fatia quente.
- Migração que mexe em PostGIS exige superusuário.
- **A migração é rastreada por NOME de arquivo, não por conteúdo**, e o histórico já foi esmagado
  DUAS vezes, sempre antes de haver produção: 19 arquivos incrementais viraram 5 baselines, e em
  2026-08-19 os 22 de então viraram **8 baselines por DOMÍNIO**, escritas no ESTADO FINAL do
  schema (sem um único `ALTER` que desfaça o que o próprio lote criou). Um banco criado antes do
  último esmagamento **não é alcançável por upgrade** e precisa ser recriado. A guarda que detectava
  os nomes antigos em `_migrations` e levantava com a instrução foi REMOVIDA em 2026-08-23, a pedido
  do dono: um banco assim falha com o `relation already exists` do primeiro `CREATE TABLE`, que é
  verdadeiro e pouco explicativo. Conserto em dev: `node scripts/dev-db.js recreate`.
- **Migração roda por `t.none()`, que LANÇA se o arquivo devolver qualquer linha.** Uma migração
  que precise chamar função usa `PERFORM` dentro de um bloco `DO`, nunca um `SELECT` solto: o
  `SELECT` aborta a transação com "No return data was expected", que não aponta para o SQL culpado
  e não registra a migração em `_migrations`.
- **Carga do gazetteer:** depois de cada carga, rode `SELECT ng.refresh_busca();` (DBSCAN e re-fire
  do peso de tipo). Sem isso o `cluster_id` fica nulo e a busca degrada em silêncio. Para absorver o
  banco do serviço antigo use o `dev/import-gazetteer.mjs` da raiz do monorepo, que já faz esse
  passo.

## Acervo 3D (modelos convertidos e cena caminhável)

O serviço 3D publica DUAS formas de conteúdo. O **modelo** (árvore de 3D Tiles ou GLB isolado) é
servido de UM arquivo SQLite por modelo, sob o prefixo `m/` da rota `/api/v1/assets3d`. A **cena**
caminhável (Gaussian splatting) NÃO é 3D Tiles: ela abre por outro visualizador, é lida em faixa e
por isso mora numa PASTA, servida pela mesma rota. O porquê da conversão, o token de geração, a
assinatura que confere a cena e as armadilhas que já puseram modelo deitado e a 3,6 km do lugar
estão em [../docs/wiki/acervo-3d-convertido.md](../docs/wiki/acervo-3d-convertido.md).

Os roteiros (todos por `npm run`, que é o que passa o `.env`):

| comando | o que faz |
|---|---|
| `models3d:importar` | converte uma ÁRVORE de 3D Tiles para `.3dtiles` (Draco + KTX2) e registra |
| `models3d:importar-glb` | o mesmo para um GLB solto, que precisa de `--lon` e `--lat` |
| `models3d:importar-cena` | instala e registra uma cena caminhável (Gaussian splatting) |
| `models3d:adotar` | registra um `.3dtiles` que já está em disco, lendo o cabeçalho `meta` |
| `models3d:verificar` | confere UM modelo publicado (abrindo o arquivo como o serviço abre) ou UMA cena (recomputando a assinatura do manifesto) |
| `models3d:verificar-lote` | confere todos os arquivos de um diretório, contra a origem quando ela responde |
| `models3d:remedir` | refaz a medida do ponto e das alturas sem reconverter |
| `models3d:lote` | converte o acervo inteiro, um modelo por vez, com estado em arquivo |
| `models3d:cleanup-wal` | tira os arquivos do WAL (num volume `:ro`, o `-shm` derruba o serviço) |

Três coisas que mordem quem opera:

- **A importação exige o `ktx`** do KTX-Software 4.4+ (`KTX_BIN`), e só ela: o serviço não precisa.
  Ele é conferido depois do inventário e antes da primeira escrita, porque um binário ausente
  viraria "textura pulada" em cada um dos milhares de tiles, sem um erro.
- **No Windows, o serviço no ar segura o arquivo publicado.** A troca falha com `EBUSY`, o
  `.parcial` é preservado e a saída manda rodar `--promover` depois de parar o serviço.
- **Quem escreve o catálogo é a adoção, sempre.** Os importadores gravam o cabeçalho e chamam
  `adotarModelo`; nenhum deles tem lista de campos própria, porque uma segunda lista é o que
  fica para trás quando a primeira muda (já custou quatro modelos e 40 minutos de conversão).

---

## O que este README deliberadamente não repete

Cada item abaixo tem uma página que é mantida e verificada; ler duas versões é como o modelo de
permissões acabou documentado com três níveis quando o banco tem cinco.

- **Permissões por atlas:** cinco níveis, `read < comment < write < manage < owner`
  (`PERMISSION_LEVELS` em `src/middleware/permissions.js`). Gate sempre pela hierarquia ou por
  `requireAtlasPermission`; lista fechada exclui o `manage` em silêncio. Detalhe e o mapeamento para
  os papéis de UI em [../docs/wiki/permissoes-atlas.md](../docs/wiki/permissoes-atlas.md).
- **Rotas e envelope de resposta:** [../docs/wiki/api-rest-atlas.md](../docs/wiki/api-rest-atlas.md)
  e [../docs/wiki/erros-api.md](../docs/wiki/erros-api.md). As duas exceções de envelope (`sv360`
  responde nu com erro plano; `/nomes/busca` responde array nu) estão em
  [../docs/wiki/sintese-contratos-congelados.md](../docs/wiki/sintese-contratos-congelados.md).
- **Sync e conflito:** [../docs/wiki/envelope-operacao.md](../docs/wiki/envelope-operacao.md),
  [../docs/wiki/modelo-conflito-lww.md](../docs/wiki/modelo-conflito-lww.md) e
  [../docs/wiki/snapshot-e-pull-incremental.md](../docs/wiki/snapshot-e-pull-incremental.md).
- **WebSocket, presença e os limites conhecidos** (sala por atlas, sem replay, estado efêmero em
  instância única, lock fino advisory):
  [../docs/wiki/canal-collab-websocket.md](../docs/wiki/canal-collab-websocket.md) e
  [../docs/wiki/sintese-limites-collab.md](../docs/wiki/sintese-limites-collab.md).
- **Módulos fora do sync** (gazetteer, zonas, assets 3D, sv360), incluindo a ausência de broadcast
  após escrita de calibração:
  [../docs/wiki/sintese-modulos-fora-do-sync.md](../docs/wiki/sintese-modulos-fora-do-sync.md).
- **Segurança de borda** (rate limits, login timing-safe, rotação de refresh, corte de sessão,
  upload sem SVG, helmet): [../docs/wiki/hardening-borda-api.md](../docs/wiki/hardening-borda-api.md)
  e [../docs/wiki/upload-imagens-seguranca.md](../docs/wiki/upload-imagens-seguranca.md).
- **SyncLedger** (tracing test/dev, `GET/DELETE /api/v1/debug/trace`, montado só com `EBGEO_TRACE=1`
  ou `NODE_ENV=test`): [../docs/wiki/syncledger.md](../docs/wiki/syncledger.md).

Não há CI: `npm run lint` e `npm test` rodam à mão, em comandos separados e antes do commit.
