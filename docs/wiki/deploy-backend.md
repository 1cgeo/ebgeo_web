# Deploy do backend único

Um processo Node 20 (HTTP + WebSocket no mesmo servidor) atrás de NGINX, com PostgreSQL/PostGIS em quatro schemas, binários fora do banco e migrações forward-only rodadas como passo separado do CMD.

## Uma instância, não por acaso

`backend/src/index.js` anexa o WebSocket ao mesmo servidor HTTP. Isso não é só economia de porta: o estado de salas/presença é um `Map` em memória por processo, **sem backplane**, então 2+ réplicas quebram o broadcast cross-instância ([[canal-collab-websocket]], [[presenca-colaborativa]]). O rate limiting (`express-rate-limit`) também é in-memory por instância, então com réplicas o limite efetivo multiplica pelo número delas.

Em produção: **uma instância** (scaling vertical). Horizontalizar exige sticky sessions + pub/sub antes, não depois. Custo aceito: os caminhos quentes de BLOB 3D/360 dividem event loop, heap e CPU com atlas/sync/WS.

Não existe upstream `:8081`: o módulo 360 foi absorvido em `/api/v1/sv360` ([[streetview-360]]).

## Banco: um cluster, quatro schemas

`public` (atlas), `ng` (gazetteer PostGIS), `sv360` (metadados do 360) e `a3d` (registro de produção do acervo 3D, desde a absorção do serviço em 2026-08-22) num cluster só. Cada um nasce no `CREATE SCHEMA` da baseline do seu domínio, e um `grep` por ele nas migrações é a lista autoritativa. Ver [[atlas-modelo-de-dados]], [[gazetteer-nomes-geograficos]], [[resources-catalogo]], [[tabela-operations]], [[acervo-3d-convertido]].

O `a3d` é o único **sem** PostGIS, e a ausência é decisão escrita na própria baseline (`backend/src/database/migrations/009_a3d.sql`): a posição do modelo já viaja no `config` JSONB de `tilesets`, e uma geometria aqui seria uma segunda resposta para "onde está o modelo".

PostGIS **nunca** entra no schema do atlas, e é decisão deliberada: a geometria do atlas mora em **JSONB** e o filtro espacial é bbox em JS, não `ST_Intersects`.

## Migrações: o que quebra

Runner `node src/database/migrate.js` (`npm run db:migrate`), forward-only, tracking por **nome de arquivo** em `_migrations`, cada arquivo numa transação junto com o `INSERT` de tracking (`backend/src/database/migrate.js`).

- **Nunca renomeie nem renumere** migração já aplicada: o tracking é por nome, renomear reaplica o DDL.
  A ÚNICA exceção é o esmagamento deliberado do histórico enquanto nenhum banco de produção o aplicou, e ele já ocorreu DUAS vezes (a última em 2026-08-19, quando os arquivos incrementais viraram uma baseline por domínio). Depois de um esmagamento, banco pré-existente **tem de ser recriado**: não há caminho de upgrade. O schema chegou a recusar a tentativa com mensagem própria, por uma guarda no topo de `backend/src/database/migrations/001_identidade.sql`, removida em 2026-08-23 a pedido do dono; hoje o sintoma é o "relation already exists" que o runner produz no primeiro `CREATE TABLE`, verdadeiro e pouco explicativo.
- **Editar o CONTEÚDO de uma migração já aplicada não faz nada e não avisa.** Esta é a terceira forma da regra, e é a única que de fato ocorreu aqui. O tracking guarda só o nome, sem checksum (`backend/src/database/migrate.js`), então a edição é indetectável por construção: quem já aplicou o arquivo nunca a verá. Foi assim que a tabela `comments` entrou, editando um baseline in-place: um banco que tivesse aplicado aquele arquivo antes da edição não teria a tabela, nada futuro o corrigiria (forward-only, o nome já consta em `_migrations`) e a falha só apareceria no primeiro uso, como `42P01` em `GET_ATLAS_COMMENTS` (`backend/src/modules/sync/sync.queries.js`). O esmagamento de 2026-08-19 fechou ESTA instância do problema por outro caminho, e não a classe: as baselines nascem no estado final e o banco antigo é recusado na entrada, mas a próxima migração incremental que alguém editar depois de aplicada volta a ser indetectável.
- Baseline de **um arquivo por DOMÍNIO** desde 2026-08-19, numerados na ordem de **dependência de FK** (identidade primeiro, porque tudo referencia `users`; acesso a recurso e acervo 3D por último, porque referenciam o catálogo). Correção é sempre um **novo** número, nunca uma edição do baseline. Quantos são e como se chamam se descobre com `ls`, nunca por esta linha: ela já carregou uma contagem que envelheceu no primeiro domínio novo.
- **Advisory lock database-wide** (`SELECT pg_advisory_lock(0x4d494752)`, `backend/src/database/migrate.js`). Sem ele, dois containers subindo juntos aplicavam o mesmo DDL duas vezes antes de o `UNIQUE(name)` falhar, ou seja, o efeito colateral já tinha rodado quando o erro apareceu. Rolling deploy é seguro, mas o perdedor **espera**, não falha.
- **PostGIS é extensão untrusted** e exige superusuário (`backend/src/database/migrations/006_ng.sql`, e desde 2026-08-19 também `backend/src/database/migrations/007_sv360.sql`, que passou a criar a extensão por conta própria para deixar de depender da ordem). Como as duas rodam incondicionalmente, PostGIS é pré-requisito de **qualquer** deploy, mesmo um deploy só de atlas. Resolva antes: imagem `postgis/postgis` (habilita no `template1`) ou DBA pré-criando a extensão em managed DB.
- **Tipo de feição novo tem ordem de implantação, e ela é a única regra desta página sem guarda mecânico.** A lista de tipos vive em quatro cópias (cliente, Joi, o CHECK `valid_feature_type` e o `typeToCollection` do snapshot; ver [[atlas-import-offline]]), e as do backend chegam por caminhos diferentes: o CHECK vem por migração, as outras duas vêm na imagem. **Migre primeiro, publique depois.** Publicar o cliente (ou a imagem) antes da migração deixa a feição nova recusada pelo banco; migrar antes é sempre seguro, porque alargar o CHECK não quebra cliente antigo. `backend/tests/integration/tipos-feicao-constraint-viva.test.js` pergunta ao catálogo do Postgres em vez de ler o `.sql`, então flagra o desalinhamento no ambiente em que roda, mas nenhum teste deste repositório alcança produção: a troca de symlink ([[deploy-web]]), a imagem que não roda migração e o compose fora do repositório são três decisões operacionais fora do alcance da suíte.
- O `CMD` da imagem (`backend/Dockerfile`) **só inicia o servidor**. Quem espera o comportamento do compose se engana: é o `backend/docker-compose.yml` que encadeia `migrate.js && index.js`. Fora do compose, rode a migração como init-container/job/hook.
- Pós-carga em massa de topônimos, `SELECT ng.refresh_busca();` (`backend/src/database/migrations/006_ng.sql`) é **obrigatório e manual**, e o motivo é o `cluster_id`: **nenhum trigger o calcula**, só `ng.recomputar_clusters()`. Sem o refresh a busca degrada **em silêncio**, porque a dedup por `(nome, tipo, cluster_id)` trata NULLs como iguais e colapsa homônimos legítimos numa linha só ([[gazetteer-nomes-geograficos]], [[ranking-busca-toponimos]]). O racional que esta linha deu até 2026-07-24, "`COPY` bypassa o trigger `BEFORE INSERT`", é **falso** e foi medido contra esta instalação: `COPY` dispara trigger de linha, o que ele não dispara são RULES. Importa porque quem testar essa metade e vê-la falhar conclui que o refresh é dispensável, remove a chamada e perde os clusters, que é justamente a parte que nada mais recompõe.

## Imagem

`node:20-bookworm-slim` (debian, não alpine) de propósito (`backend/Dockerfile`): `bcrypt` e `better-sqlite3` publicam prebuilds **glibc/x64** e o Dockerfile não instala toolchain. Em ARM, air-gapped ou sem prebuild, o `npm ci` tenta compilar e falha por falta de gcc/python/make; nesse caso adicione `build-essential` + `python3` ao estágio `deps`.

Runtime roda como uid/gid **1001** (`backend/Dockerfile`) e o `chown` do build cobre `/app/data` (`backend/Dockerfile`), mas um volume montado ali chega com a dono do host e **sobrescreve** esse chown. Só `/app/data/images` é pré-criado; os diretórios de assets 3D e 360 nascem em runtime pelo app. Volume não gravável por 1001 dá `EACCES` na primeira escrita, não no boot.

O `HEALTHCHECK` (`backend/Dockerfile`) bate em `/api/v1/health`, que executa `SELECT 1` e responde 503 (`backend/src/app.js`). É **readiness real**, não liveness: se o Postgres cai o container fica unhealthy com o processo vivo. Não martele com intervalo curto, cada probe toca o pool.

O piso é **Node 20.19.0** (`backend/package.json`), não 20.0.0: o boot usa `--env-file-if-exists`, que só existe a partir dessa versão. Um 20.12 ou 20.18 satisfaz "Node 20 LTS" e mesmo assim morre na flag desconhecida.

## Boot fail-fast: por que a validação existe

`validateEnvVariables()` roda em `backend/src/index.js`, **antes** de qualquer conexão, e deliberadamente **não** em `backend/src/app.js` (a suíte importa o app via supertest e não deve exigir env completa). Acumula os erros que alcança e lança um único `Configuração inválida:`.

Não alcança `DATABASE_URL` (`backend/src/config.js`) nem `JWT_SECRET`: as duas passam por `required()`, que lança na **avaliação do módulo**, e `index.js` importa `app.js` → `config.js` antes de chamar a validação. Faltando uma delas, a saída é `Missing required env var: X`, em inglês e uma por vez, não a lista. O acumulador governa o que é `optional()` (como `CORS_ORIGIN`) e as regras condicionais de produção. Ver [[hardening-borda-api]].

Cada regra existe por um estrago observado, não por higiene (`config.js`):

- **Faixas numéricas de todo knob inteiro** (`NUMERIC_ENV_RULES`, `config.js`): `parseInt` falha em silêncio. `MAX_BULK_UPLOAD_MB=abc` virava `limit: 'NaNmb'`, ou seja, **sem limite de body**; `WS_HEARTBEAT_INTERVAL_MS=abc` virava `setInterval(NaN)`, quase 1ms, uma tempestade de queries. Só variáveis **setadas** são checadas, os defaults são known-good.
- **Gramática de expiração JWT** `^\d+[smhd]$` (`config.js`): `1w` é a armadilha clássica, natural de escrever e não aceita. O parser retornaria 0 e **todo refresh token nasceria expirado**.
- `CORS_ORIGIN` é obrigatória em produção (`config.js`) justamente porque o default é placeholder de dev. São **três** as obrigatórias em prod, não duas: `DATABASE_URL`, `JWT_SECRET` e `CORS_ORIGIN`. O default é `http://localhost:3000`, a origem do **Vite**, e não a porta do backend.

**Armadilha do `optional()`** (`config.js`): é `process.env[key] || fallback`, então **string vazia cai no fallback**. Não existe caminho por env vazia para "desabilitar" uma URL cujo default é não-vazio.

**A topologia de porta inverte entre dev e compose**, e isso já derrubou o boot uma vez. Em dev o backend é **:8080** e o Vite **:3000**, que faz proxy de `/api` (`backend/.env.example`). No `backend/docker-compose.yml` o app escuta **:3000** e o `CORS_ORIGIN` aponta para :8080. Cada um é coerente consigo, mas ler um e aplicar no outro produz um CORS que recusa exatamente a origem certa. Confira de qual dos dois mundos veio o valor antes de copiá-lo.

`NODE_ENV=production` é o **interruptor único de segurança**: liga HSTS 180 dias (`backend/src/app.js`), cookies `Secure`/`SameSite=strict`, exige `JWT_SECRET` >= 32 e desliga self-registration por default (`config.js`). `COOKIE_SECRET` e `USE_HTTPS` **não existem no código**, configurá-las é no-op. TLS termina no NGINX.

**O bloco de e-mail e confirmação de conta** está em `backend/.env.example` desde que o auto-cadastro passou a exigir e-mail (esta página dizia que ele não estava lá, e a ausência era o achado: o operador não tinha como descobrir que precisava de relay).

- **Auto-cadastro sem relay não sobe em produção.** Com `ALLOW_SELF_REGISTRATION` ligado e `NODE_ENV=production`, `validateEnvVariables` exige `SMTP_HOST` **e** `APP_BASE_URL`. É falha ruidosa no lugar da silenciosa: e-mail é obrigatório no cadastro, a conta nasce pendente, e sem canal de entrega a porta cria contas que ninguém consegue ativar enquanto o `deliver()` degrada para `logger.error`. A exigência é **condicional** ao auto-cadastro, então instalação fechada que nunca precisou de relay continua bootando. Ordem de implantação: relay e `APP_BASE_URL` primeiro, subir, e só então mexer na flag.
- `APP_BASE_URL` (default vazio) constrói o link `?verify=`. Vazia, o link sai **relativo**, e não apontando para a origem da requisição: `resolveVerificationBase` (`backend/src/utils/mailer.js`) só honra uma origem vinda do cliente quando ela é igual à de `CORS_ORIGIN`, justamente para que um `Origin` forjado não vire link de verificação para o host do atacante. Em produção com o app noutro host, configure-a.
- `SMTP_HOST` ausente (o default) deixa o mailer em no-op que **loga o link** em vez de enviá-lo. É o modo esperado em dev e em rede fechada sem relay, e é silencioso: ninguém recebe e-mail e nada falha. `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `MAIL_FROM` completam o bloco (`backend/src/config.js`).
- `AUTH_VERIFICATION_TTL_HOURS`, default 48 (`backend/src/config.js`).
- **Não existe knob de "modo de verificação".** Existiu um, lido na própria definição e em nenhum outro ponto de `backend/src`, e ele saiu junto com a obrigatoriedade do e-mail: um interruptor que promete escolher o regime de ativação e não escolhe nada é pior que ausente, porque convida a próxima pessoa a esperar um fluxo de aprovação que não existe. O auto-cadastro confirma por link de e-mail, e só.

## Config servido em runtime

`GET /api/v1/config` (alias `/api/config`) é público e montado antes das rotas autenticadas (`backend/src/app.js`). O frontend é **fail-fast** nele: sem esse endpoint o app não sobe, não há fallback estático ([[config-dinamico]], [[config-runtime-urls-relativas]]).

Os defaults de URL são placeholders DEV-only (OSM, Google, BDGEx, demotiles) e não funcionam em rede isolada. Dois foram trocados de propósito para "vazio ou relativo", que é o comportamento correto de quem não configurou:

- `MAP3D_TERRAIN_URL` default `''` (`config.js`): vazio faz o `config.service` publicar `enabled: false` (elipsoide plano) em vez de pedir ao Cesium um provider inalcançável.
- `SV360_SERVICE_URL` default `/api/v1/sv360` (`config.js`), relativo, porque o 360 é módulo deste mesmo backend. O default absoluto anterior só funcionava por acidente, via proxy do Vite.

Não existe tabela única `resources`: o catálogo tem uma tabela **por tipo**, com whitelist em `backend/src/modules/catalog/catalog.tables.js`. Ver [[resources-catalogo]].

## Stores binários e volumes

Tudo que é binário fica **fora** do Postgres, que guarda só metadados e ponteiro: `IMAGES_DIR` ([[imagens-atlas]]), `ASSETS_3D_SQLITE` (servido primeiro) com `ASSETS_3D_DIR` de fallback ([[assets3d-distribuicao]]), `MODELS_3D_DIR` (um `.3dtiles` por modelo do acervo convertido, ponteiro em `a3d.models`), `SV360_DB_DIR` (~41 GB reais de WebP) e `SV360_TMP_DIR`.

O acervo 3D tem **duas** formas de armazenamento e uma só rota, e confundi-las custa um restore incompleto: o modelo é arquivo único em `MODELS_3D_DIR` e a cena caminhável é **pasta** sob `ASSETS_3D_DIR`. A decisão está na baseline (`backend/src/database/migrations/009_a3d.sql`) e o detalhe em [[acervo-3d-convertido]].

Armadilhas que custam dados:

- **`SV360_TMP_DIR` e `SV360_DB_DIR` precisam estar no MESMO volume.** O multer streama o `images.db` multi-GB para o tmp e depois faz `rename`. Em filesystems diferentes o rename vira cópia cross-device e o swap **perde a atomicidade** ([[ingestao-projetos-360]]).
- O `backend/docker-compose.yml` só persiste `ebgeo_pgdata` e `ebgeo_images`. `assets3d*` e `sv360*` são **efêmeros** nesse stack e somem no recreate. Adicione volumes antes de produção.
- O `db_filename` do 360 é **derivado no servidor** de `(orgId, slug)`. Restaurar arquivos com o nome legado `{slug}.db` quebra o serving mesmo com o Postgres íntegro.

**Controle de RSS:** `better-sqlite3` materializa o BLOB inteiro como `Buffer` no heap, sem stream incremental. O `SELECT` roda num pool de worker threads (`SQLITE_BLOB_WORKERS`, default `min(4, cpus-1)`, `backend/src/utils/sqlite-blob-pool.js`) e o ETag O(1) com 304 acontece **antes** de qualquer leitura de BLOB ([[sintese-cache-http-imutavel]]). Os semáforos `ASSETS_3D_MAX_INFLIGHT` e `SV360_MAX_INFLIGHT` (default 8) são o controle direto de memória: subi-los em container apertado estoura o heap.

## NGINX: quatro itens não negociáveis

1. `proxy_set_header Authorization $http_authorization`, senão o `flexibleAuth` não vê o Bearer ([[autenticacao-jwt]]).
2. `proxy_http_version 1.1` + `Upgrade` + `Connection "upgrade"`, senão o WS não conecta. O handler de upgrade responde **404** para qualquer pathname diferente de `/api/v1/collab` e 400 sem `atlasId`/`token` na query ([[canal-collab-websocket]]).
3. `client_max_body_size` casando com `SV360_MAX_UPLOAD_BYTES` (default 2 GiB), senão o NGINX dá 413 antes de o backend ver o corpo. O body JSON do app é 10 MB (`backend/src/app.js`), exceto `/images/bulk`, com parser dedicado de `MAX_BULK_UPLOAD_MB` (`backend/src/app.js`).
4. Cache de borda diferenciado: tiles MVT do 360 são `max-age=60` (mudam a cada ingestão), imagens/assets/thumbnails são imutáveis com `max-age=31536000`. Não recomprima binários imutáveis nem quebre `Range` no proxy.

O mesmo NGINX serve o bundle web a partir de um symlink trocado a cada publicação, com uma armadilha própria: [[deploy-web]].

`trust proxy` **não** é configurado no código. Atrás do NGINX, `req.ip` é o IP do proxy, o que degrada a parte IP da chave do rate limiter e agrupa todo o tráfego do link público sob um único IP ([[hardening-borda-api]], [[link-publico]]).

## Superfície anônima herdada da ordem de montagem

Tudo sob `/api/v1/atlas/:atlasId/**` (sharing, images, sync, maps, briefings) é **sub-montado** em `backend/src/modules/atlas/atlas.routes.js` e por isso herda a resolução de atlas e o gate de permissão da rota pai. É por isso que não existe `app.use('/api/v1/sync')` de topo.

A consequência é o inverso: `config`, `assets3d` e a leitura do `sv360` estão **fora** dessa árvore e são alcançáveis anonimamente por construção ([[auth-flexivel]], [[hardening-borda-api]], [[modos-operacao]]). Mover uma rota para dentro ou para fora de `/atlas/:atlasId` muda a autorização sem tocar em nenhum middleware.

Três desalinhamentos entre o diagrama de arquitetura e o disco custam tempo de navegação: `assets3d` mora em `modules/nomes/`, que é o módulo do gazetteer; o diretório do 360 chama-se `streetview360/` mas monta em `/api/v1/sv360`; e `features`/`layers`/`groups`/`slides` **não têm diretório algum** (são dispatch do `sync`). O mapa completo é `backend/src/app.js`.

## Segurança operacional

Baseline em [[hardening-borda-api]] e [[upload-imagens-seguranca]]. Do ponto de vista de deploy:

- `jwt.verify` com allowlist `['HS256']` (`config.js`), em REST e no gateway WS.
- `POST /auth/register` responde 404 em produção por default; liberar exige `ALLOW_SELF_REGISTRATION=true` explícito.
- `EBGEO_TRACE` liga o [[syncledger]] e monta `/api/v1/debug/trace`. É test/dev; há um cross-check `!config.isProd` (`backend/src/app.js`) que não monta a rota mesmo com a env ligada, mas **deixe a env ausente em produção** de qualquer forma.
- O `JWT_SECRET` do compose é placeholder de dev. Trocar não é opcional: o boot falha com menos de 32 chars em produção.

## Shutdown: a ordem é o ponto

`SIGTERM`/`SIGINT` disparam `shutdown()` (`backend/src/index.js`), que fecha **primeiro** os sockets de collab, depois `server.close()`, depois `blobPool.closeAll()` e `pgp.end()`.

Os sockets de colaboração são long-lived por design, então `server.close()` (que espera toda conexão terminar) nunca chamava o callback enquanto houvesse um aberto: `blobPool.closeAll()` e `pgp.end()` eram simplesmente pulados. No Windows isso deixava handles SQLite abertos e **quebrava o start seguinte**. O force-exit de 10s (`SHUTDOWN_TIMEOUT_MS`, `backend/src/index.js`) usa `unref()` para o próprio timer não segurar o processo.

Defina `terminationGracePeriodSeconds` acima dos 10s, senão o orquestrador mata antes do force-exit e o ganho da ordem se perde.

## Windows: dois erros que parecem corrupção e não são

Só aparecem em ambiente de desenvolvimento local, e os dois se manifestam como falha de I/O sem causa aparente:

- **`fsync` retorna `EPERM`/`ENOTSUP`** em handle readonly ou FS sem suporte, e o código é engolido de propósito. É benigno: a integridade vem do size-check do manifest, não do fsync. Só importa se houver queda de energia logo após a ingestão, e aí basta reexecutar (é idempotente).
- **`mv`/`rm` manual de um `{orgId}__{slug}.db` dá `EBUSY`/`EPERM`.** Um worker do pool segura o handle readonly cacheado. Não mexa à mão num `.db` enquanto o backend serve: pare o serviço, ou delete pela API, que evicta o handle antes.

## Backup e restore

Duas fontes precisam ficar **consistentes entre si**: o Postgres (metadados, incluindo `db_filename` e os `*_size_bytes` que ancoram o ETag O(1)) e os arquivos binários. Backup de um só deixa o outro órfão, e o sintoma é 404 por arquivo, não erro de restore.

`pg_dump` cobre os quatro schemas num dump só; rsync de `SV360_DB_DIR` (thumbnails no mesmo diretório), `ASSETS_3D_SQLITE`/`ASSETS_3D_DIR`, `MODELS_3D_DIR` e `IMAGES_DIR`.

No restore, na ordem: habilitar PostGIS **antes** de aplicar `ng`; garantir que cada `db_filename` anunciado pelo Postgres exista no disco, como `{orgId}__{slug}.db` para o 360 e como o nome guardado em `a3d.models` para o acervo 3D (ele é **guardado, não derivado do id**, justamente para que renomear no catálogo não obrigue a renomear o arquivo); rodar `SELECT ng.refresh_busca();` se recarregou nomes em massa; reconstruir o SQLite 3D com `node scripts/assets3d-import.js <dir>` se necessário.

Um restore que leve o Postgres e esqueça `MODELS_3D_DIR` não falha: o catálogo lista o modelo, a rota responde 404 por tile, e o sintoma chega na tela como cena que não carrega. Ver [[acervo-3d-convertido]].

## Carga de dados

Ambos os importadores são invocação direta de `node`, sem npm script (`backend/scripts/`).

- `assets3d-import.js <sourceDir>`: árvore inteira numa única transação, upsert por `rel_path`, offline e idempotente. Ele carrega **bytes**, nunca descoberta: os metadados que fazem um modelo aparecer moram na tabela de tilesets do catálogo ([[resources-catalogo]]), populada pela aba de catálogo do Painel do Administrador ou por `dev/import-config-catalog.mjs`. Importar sem popular o catálogo entrega BLOBs invisíveis, e o inverso entrega item de catálogo apontando para 404.
- `sv360-import.js <index.db> [src] [dest]`: um `tx()` por projeto, projeto corrompido vai para `skipped[]` sem abortar o resto. **Exit code 2 significa import parcial**, trate como alerta e não como sucesso. `orgSlug` inexistente e não-legado dá 409, crie a OM antes ([[organizacoes-om]]).

## Seed de desenvolvimento: nunca em produção

`npm run db:seed` (`backend/src/database/seed.js`) cria `admin`/`admin123` (role `admin`) e `cap.silva`/`test123`, mais o "Atlas de Exemplo" pertencente ao **admin** e compartilhado com `cap.silva` em `write`, o que dá um par pronto para exercitar [[compartilhamento-atlas]] e [[presenca-colaborativa]].

O "nunca em produção" não é higiene genérica: é uma conta administrativa com senha em texto no repositório. E o seed é idempotente por `ON CONFLICT (username) DO UPDATE SET password_hash`, então rodar de novo **reseta as senhas** para o valor de fábrica, mesmo que alguém as tenha trocado (`backend/src/database/seed.js`). A parte do atlas é pulada se já existir com `deleted_at IS NULL`, mas as senhas caem do mesmo jeito.

Uma armadilha ao montar ambiente: nenhum dos dois usuários tem `email`, então o portão de confirmação nunca dispara e ambos logam de imediato ([[autenticacao-jwt]], [[gestao-usuarios]]).
