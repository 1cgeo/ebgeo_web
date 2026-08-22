# CLAUDE.md: EBGeo Backend

API REST + WebSocket (Node 20, ES Modules) do app de mapeamento geoespacial militar EBGeo:
auth JWT, persistência PostgreSQL/PostGIS, colaboração em tempo real e sync offline-first.

**Constraint fundamental:** o backend é **aditivo**, e a app deve funcionar idêntica para usuário
**não autenticado**. Nenhuma mudança pode quebrar o caminho anônimo nem os contratos congelados do
frontend. Isso vale para o LOGIN, não para a disponibilidade: o boot do frontend é **fail-fast** em
`GET /api/config` (fonte única de config/catálogo), então derrubar ou quebrar esse endpoint impede o
app de subir, e não existe fallback estático no cliente.

> Referência completa (rotas, env, migrações, permissões, protocolo WS, convenções detalhadas) está
> no **[README.md](README.md)**. Páginas por entidade e conceito em
> **[../docs/wiki/index.md](../docs/wiki/index.md)**, que não tem índice numérico: procure pelo nome
> da página. Deploy em **[../docs/wiki/deploy-backend.md](../docs/wiki/deploy-backend.md)**. Este
> arquivo é o contrato de comportamento; mantenha-o curto.

## Stack & layout

`Express 4` · `pg-promise` (SQL direto, sem ORM) · `ws` · `jsonwebtoken`+`bcrypt` · `joi` · `pino` ·
`better-sqlite3` (BLOBs 3D/360).

- `src/index.js` boot (HTTP + WS + `validateEnvVariables()` fail-fast) · `src/app.js` factory `createApp()` (testável)
- `src/config.js` env · `src/database/` (`query`/`tx`, `migrate.js`, `migrations/`) · `src/middleware/` · `src/utils/`
- `src/modules/<nome>/`: um `ls src/modules/` é a lista autoritativa, e não reponha aqui a enumeração que já morou nesta linha, porque ela envelheceu errada nos dois sentidos (listava módulo inexistente e omitia um inteiro). O único que não se adivinha: `debug` é o endpoint do SyncLedger e só é montado com o tracer ligado (test/dev).

## Comandos

```bash
npm run dev            # node --watch
npm run db:migrate     # aplica migrações | npm run db:seed
npm test               # cria DB ebgeo_test → migra → roda → dropa (unit+integration+ws). Sem
                       #   argumento auto-eleva para c8 e verifica o PISO de cobertura; com
                       #   argumento não, e o runner usa só o PRIMEIRO pattern que receber:
                       #   `npm test -- a.test.js b.test.js` roda SÓ o `a` e reporta verde
                       #   pelos dois (`args.find(a => !a.startsWith('--'))`). Já recorreu duas
                       #   vezes; passe UM alvo por comando, e um comando por alvo.
npm run test:unit | test:integration | test:ws   # subconjuntos
npm run test:keep-db   # mantém o DB p/ debug
npm run test:fast -- tests/integration/x.test.js  # laço apertado: reaproveita o banco
npm run lint           # probe das regras próprias + eslint (rode antes de finalizar) | npm run format
```

- `npm test` é hermético (cria/dropa `ebgeo_test`). **PostGIS** é extensão *untrusted*: o runner
  pré-cria as extensões via `SUPERUSER_DATABASE_URL` (default `postgres:postgres@localhost`); sem um
  superusuário acessível os testes que usam `ng`/`sv360` falham.
- `test:fast` (`--reuse-db`) **exige um alvo** e recusa rodar a suíte inteira, de propósito: ele
  troca a hermeticidade por tempo, e a rodada que vale antes do commit não pode fazer esse
  câmbio. O banco reaproveitado carrega dado das rodadas anteriores, então **vermelho ali se
  confirma sem a bandeira antes de virar diagnóstico**. Ele ainda aplica migração pendente, que é o
  que impede o atalho de virar "rápido contra o schema velho". Números medidos em 2026-08-16 estão
  no comentário de `scripts/run-tests.js`, e o principal é negativo: o ciclo de banco custa ~1,2 s,
  não os 40 s que a intuição atribuía a ele. Laço lento não se otimiza por palpite.
- Testes batem no `app` exportado via **supertest** (não sobem servidor); WS em `tests/ws/`.

## Decisões de arquitetura: NÃO violar (e o porquê)

- **Escrita INCREMENTAL de entidade colaborativa é só via sync** (`POST /atlas/:id/sync` ou WS
  `operation`). **Não crie rotas REST de escrita** para feature/group/layer/map/briefing/slide/
  cesium3d/streetview360: elas viajam como operações. `briefings` é de fato GET-only; `maps`
  **não é**, e QUATRO exceções estruturais são deliberadas.
  - `POST /maps/:mapId/merge` (`backend/src/modules/maps/maps.routes.js`, `manage`): re-parenteia
    seis tabelas filhas.
  - `POST /atlas/import` (`backend/src/modules/atlas/atlas.routes.js`): cria atlas inteiro a partir
    de um `.ebgeo`.
  - `POST /atlas/:atlasId/maps/:mapId/duplicate` (`backend/src/modules/atlas/atlas.routes.js`, `write`).
  - `POST /atlas/:atlasId/clone` (`backend/src/modules/atlas/atlas.routes.js`, `read` na ORIGEM
    MAIS `requireAccountPrincipal`): `cloneAtlas` copia imagens, mapas, sub-entidades, briefings
    e slides para um atlas NOVO, do chamador. Gate de leitura porque o efeito não toca a origem;
    o destino nasce do requisitante — e é por isso que o segundo gate existe: o visitante ANÔNIMO
    de link público passa nos dois anteriores e não tem linha em `users` para ser dono. A cópia é
    PODADA por destinatário (o que o novo dono não vê não viaja), o que vale também para
    `POST /atlas/import`; as duas regras de poda e por que elas diferem estão em
    [`../docs/wiki/sair-do-servidor.md`](../docs/wiki/sair-do-servidor.md).

    **`atlas.settings` é superfície de referência, e é a que se esquece.** Além das colunas
    óbvias (`maps.base_layer`, `cesium3d_data.tileset_id`, `streetview360_data.photo_name`,
    `slides.model_id`/`photo_id`, `catalog_layers.data`), o documento `settings` carrega SEIS
    ids de catálogo: `basemaps`, `default_basemap` e os quatro `available_*`. Eles passam pelo
    mesmo `ResourcePruner`, e a armadilha é o SENTIDO: lista vazia significa **sem restrição**
    no cliente, então podar uma allowlist até zero e escrever a lista vazia ALARGA a cópia;
    quando ela esvazia, o que se desliga é a categoria em `features`. O inventário das
    superfícies mora em `src/modules/atlas/resource-reference.registry.js`, espelhado no
    cliente, e ele deixou essa família de fora por um bom tempo porque o censo que o cobra
    varre por nome de campo do CLIENTE, e `available_3d_models` não é um deles.

  Esta lista disse "três" e omitiu o `clone` por tempo suficiente para a contagem virar premissa,
  enquanto o `clone` tem método no cliente (`apiClient.cloneAtlas`) e cinco arquivos de teste. E as
  três primeiras eram citadas por `arquivo:linha` sem o caminho, forma que o guarda de doc **não
  consegue** verificar: sua regex de caminho exige ao menos uma barra, então `atlas.routes.js:44`
  escapava da checagem e seguiu apontando para linha em branco depois que a rota andou. Cite o
  caminho inteiro, sem número de linha.

  O que as quatro têm em comum, e é o critério real: são operações de ENTIDADE INTEIRA, cujo efeito
  não é representável como uma sequência de ops incrementais. Duas armadilhas conhecidas: escrita
  por REST não avança `atlas.current_version`, então o peer offline não recebe nada no replay (o
  merge resolve isso emitindo uma op MARCADORA na mesma transação); e o gate do merge protege uma
  rota que **este** cliente não chama, porque ele combina localmente e sincroniza como ops comuns, com o
  gate real em `map.manager.combineSelectedMapsIntoTarget`. Os dois precisam continuar alinhados.
- **Conflito = LWW por ordem de chegada** (NÃO por timestamp); idempotência por `op_id`
  (`ON CONFLICT DO NOTHING`). O módulo `src/crdt` (LWW-por-timestamp) foi **removido**; não religar
  sem requisito de produto.
- **Geometria do atlas é JSONB** (schema `public`, mesmo formato do IndexedDB). **PostGIS vive só nos
  schemas `ng`** (gazetteer) **e `sv360`**. **Nunca** adicione PostGIS ao schema
  do atlas (decisão: filtro espacial do atlas seria bbox em JS, não `ST_Intersects`).
- **Controle de acesso embutido na query SQL** (`ng`, `sv360` e o catálogo): o dado
  privado não vaza nem com bug de app. Toda query com filtro de acesso **exige o par completo**, o
  teste negativo (quem não tem permissão não vê) **e o positivo do mesmo par** (quem tem, vê): o
  negativo sozinho passa idêntico se a fixture não existir, se a rota sumir ou se o filtro passar a
  negar tudo.
- **DOIS eixos de permissão, e eles NÃO compartilham uma palavra.** O eixo GLOBAL (`users.role`) tem
  quatro valores que **não são uma escada**: `user`, `producer`, `credenciado`, `admin`. Nenhum
  contém o outro, então comparar papel global por ordem (`>=`, índice em array, um `ROLE_ORDER`) é
  erro de leitura, não otimização, e `role !== 'user'` num gate de administração promove o
  credenciado em silêncio, que é o risco INVERSO ao da lista fechada por atlas. O eixo POR ATLAS
  (`read < comment < write < manage < owner`) **é** escada e se gateia pela hierarquia. Vocabulário:
  `producer` MANTÉM o que a OM dele produziu (escopo em `users.producer_org_id`, escrito só por
  administrador, com CHECK bicondicional contra `role`, e desde 2026-08-21 valendo só enquanto
  a OM PRODUTORA estiver ATIVA: `fn_can_produce_resource` conferia a conta e a OM de LOTAÇÃO, e
  as duas colunas podem apontar para organizações diferentes), e desde 2026-08-20 isso inclui **marcar
  público/privado** (`requireResourceMaintainer`) e **conceder de RAIZ** o que ele produz;
  `credenciado` LÊ todo recurso privado e concede/revoga no eixo de recurso, e **não** administra
  grupo de acesso (a decisão de 2026-08-19 que lhe dava essa escrita foi SUPERADA: grupo passou a
  ser entidade de usuário, com dono, gateada por `fn_can_administer_group`). Nenhum dos dois é
  administrador do sistema: usuários, organizações, catálogo e configuração continuam fora do
  alcance deles. Censo em `tests/unit/papel-global-censo.test.js`, que reprova sítio novo não
  classificado.
- **`users.organization_id` é LOTAÇÃO e não autoriza nada.** Ele é auto-declarado no
  auto-cadastro (`POST /auth/register` aceita qualquer OM ativa, sem revisão de ninguém), e enquanto
  autorizava era escalação de privilégio por formulário público: escolher a OM
  alheia num `<select>` entregava todo projeto 360 oculto e privado dela. Todo ramo de autorização
  que lia lotação lê hoje o escopo de PRODUÇÃO. Repro em
  `tests/integration/auto-cadastro-om-nao-autoriza.repro.test.js`.
- **Recurso de catálogo: QUATRO tabelas, CINCO tipos concedíveis.** As tabelas são `basemaps`,
  `data_layers`, `analysis_layers` e `tilesets`; os tipos de concessão e de empréstimo somam
  `sv360_project` às quatro. Existiu uma quinta tabela (`streetview_markers`), apagada por nunca ter
  tido leitor, e o schema consolidado simplesmente não a cria: não a recrie por simetria. E existiu
  um SEGUNDO catálogo de modelo 3D, no schema `ng`, com eixo de acesso próprio que nenhuma rota
  alimentava; ele saiu inteiro em 2026-08-19 e `tilesets` é hoje a única descoberta de modelo 3D.
  O predicado de acesso é **uma definição só**, em função SQL (`fn_can_see_resource` e as cinco de
  baixo), chamada de dentro das queries e nunca reimplementada em JS. **Ele também gateia a
  ESCRITA por sync**: uma op que declare referência a recurso que o autor não enxerga é recusada
  POR OPERAÇÃO, e as superfícies são uma TABELA (`RESOURCE_REF_EXTRACTORS`,
  `src/modules/sync/resource-ref.extractors.js`), não um `if` por tipo — foi um `op.target !==
  'catalog_layer'` que deixou 3D, 360, slide e camada de base entrarem sem checagem. Três
  invariantes: `delete` NUNCA é gateado (quem perdeu acesso tira a referência morta), o atlas da
  ROTA vai no predicado (o empréstimo conta, ao contrário do clone, que passa `NULL`), e o gate
  espelha o caminho de ESCRITA, não o payload declarado. **O papel é resolvido no
  BANCO, nunca lido do JWT**: `flexibleAuth` não reconcilia, então um credenciado rebaixado
  carregaria o papel antigo por até 15 min.
- **O beneficiário de uma concessão é uma pessoa OU um grupo, nunca os dois** (`CHECK
  (num_nonnulls(grantee_id, grantee_group_id) = 1)`, com `access_groups`/`access_group_members` no
  schema da aplicação). Gate ou tela que assuma `grantee_id` não-nulo ignora a concessão coletiva
  sem erro, que é a lista fechada da constituição na forma nova.
- **Concessão tem PRAZO obrigatório, teto de um ano, e ele morre no PREDICADO** (`expires_at >
  NOW()` em toda query de concessão viva), nunca por varredura: um sweeper de expiração seria mais
  um verificador quebrando calado. Filho nunca expira depois do pai: o clamp é por `LEAST`, e desde
  2026-08-21 ele mora em DOIS lugares, não um — no INSERT e no repai da poda, que é a primeira
  escrita de `parent_grant_id` fora do INSERT. Mudar o pai sem aparar o prazo (e sem descer o aparo
  pela subárvore) quebra a invariante em silêncio.
  A assimetria com o escopo de produção é deliberada: concessão vence sozinha, `producer_org_id`
  não vence e só sai por ato de administrador (com `PRODUCER_SCOPE_CHANGE` na trilha).
- **Revogar derruba quem perdeu TODA autorização, não tudo o que pende** (D3, 2026-08-21). Um
  descendente cujo concedente ainda tenha `view_share` vivo sobre o mesmo recurso, FORA do alcance
  da poda, é RE-PENDURADO nele (`REVOKE_SUBTREE_PRESERVING_REACH`), e a rota devolve TRÊS listas:
  `revoked`, `reparented`, `trimmed`. Só a primeira significa perda de acesso, e é só ela que o
  aviso ao vivo e o broadcast usam. A semântica de queda tem UMA definição (`podarPorRaizes`) e
  QUATRO chamadores: revogar, apagar grupo, tirar membro e DESATIVAR CONTA. O último é D8(b) — a
  autoridade morre com quem a exercia —, e ele tem um irmão do lado do predicado
  (`fn_principal_vivo(g.granted_by)` em `fn_granted_resource_ids`) que faz outra coisa: esconde na
  hora, alcança a desativação de ORGANIZAÇÃO e é reversível, enquanto a poda é definitiva e é a
  única que alcança descendente. Detalhe e as recusas conservadoras em
  [`../docs/wiki/acesso-a-recurso-privado.md`](../docs/wiki/acesso-a-recurso-privado.md).
- **Permissão por atlas tem CINCO níveis**: `read < comment < write < manage < owner`
  (`PERMISSION_LEVELS` em `middleware/permissions.js`; `owner` é sintetizado de `atlas.owner_id`, o
  CHECK da coluna é `read|comment|write|manage`). Sempre gate pela **hierarquia** ou por
  `requireAtlasPermission`. **Nunca** escreva uma lista fechada tipo
  `permission === 'write' || permission === 'owner'`: isso exclui o `manage` (co-Gestor), que está
  *acima* de `write`, e foi exatamente assim que a presença de seleção do co-Gestor foi silenciada.
- **O share de atlas também tem DOIS alvos** desde 2026-08-21 (`atlas_shares.group_id`, mesmo
  `num_nonnulls` de `resource_grants`), e uma pessoa pode alcançar o atlas pelos dois caminhos ao
  mesmo tempo. **Resolver acesso é chamar `fn_user_atlas_shares`**, que devolve o MÁXIMO entre o
  share direto e os dos grupos vivos: escrever `FROM atlas_shares WHERE user_id = $x` lê metade do
  eixo, compila, devolve linhas e parece certo. O censo estrutural
  `tests/unit/atlas-shares-eixo-de-grupo-censo.test.js` reprova o leitor novo que resolver à mão.
  **Conceder** a um grupo exige **grupo próprio** (`assertCanAdministerGroup`, erro 404) — o `POST`
  sempre, o `PUT` só quando SOBE o nível; tirar (o `DELETE` e o `PUT` que rebaixa) não exige nada
  além de `manage` no atlas, porque tirar acesso nunca pode ser mais difícil que dar. E a lista de
  quem tem acesso **nomeia o dono do grupo**: as duas mitigações são o que tira a amplificação de
  autoridade da invisibilidade, porque um share coletivo chega a `manage`.
- **Soft-delete sempre** (`deleted_at`, ou `is_active` p/ usuários; tombstone p/ fotos 360). **Nunca**
  faça hard-DELETE de entidade principal. `atlas.owner_id`/`images.uploaded_by`/`atlas_shares.added_by`
  são FK **sem `ON DELETE`** → reatribua (`?transferTo`) antes de qualquer hard-delete de usuário.
- **A trilha de auditoria (`audit_trail`) é global e vive FORA do atlas**: ela não é entidade
  colaborativa, não viaja em op de sync e não tem namespace por atlas. Desde a 020 o alvo é coluna
  de primeira classe (`target_id` virou TEXT, porque id de catálogo é slug e gravar slug em coluna
  UUID levanta `22P02`, que a borda traduz num 400 sem relação aparente com o assunto), e `'SYSTEM'`
  voltou a significar sistema em vez de depósito do alvo que não coube. **Ação declarada no CHECK
  sem emissor lê como "isto é auditado" e não é**: `LOGIN`, `LOGOUT` e `ATLAS_DELETE` viveram assim
  desde o primeiro dia. Quem cobra hoje é `tests/unit/auditoria-censo.test.js`, com piso decrescente de
  buracos conhecidos.

  **Ela tem um eixo de ORGANIZAÇÃO desde 2026-08-21, e ele é GRAVADO, nunca resolvido na leitura.**
  `target_org_id` é a OM dona do RECURSO ALVO **na época do ato** (não a OM do ator, não a lotação),
  e todo emissor que tenha recurso em mãos precisa carimbá-la, um que esqueça produz linha que o
  produtor daquela OM nunca vê, sem erro nenhum. Os dois argumentos que fecham a decisão: recurso que
  TROCA de OM não pode ter a história passada reatribuída, e o hard-delete do 360 escreve a trilha
  DEPOIS do DELETE, então na leitura não haveria mais de onde tirar a OM. NULL significa "alvo sem OM
  dona" (USER, ATLAS, ORG, CONFIG) e também acervo INSTITUCIONAL, e o filtro por OM não alcança
  nenhum dos dois, de propósito.

  **`GET /api/v1/audit` deixou de ser só-admin**: `requireAuditReader` tem DOIS ramos (administrador,
  irrestrito; produtor, recortado na própria OM) e o recorte é imposto em UMA linha de
  `listAudit`, a query string do chamador nunca decide o escopo, e `targetOrgId` só ESTREITA, e só
  para quem administra. A liveness dele espelha `fn_can_produce_resource` e tem TRÊS termos, não
  dois: conta, OM de LOTAÇÃO e OM PRODUTORA, com o disjunto `role = 'admin'` no último (sem ele o
  administrador, que não tem OM produtora, seria derrubado pelo próprio predicado). Com só os dois
  primeiros, desativar a OM produtora fechava a escrita e deixava a leitura da trilha aberta. O credenciado leva 403: ler todo recurso privado não é ler o registro de atos
  sobre contas, atlas e configuração, e escrever este gate com `fn_has_global_data_access` o
  promoveria em silêncio.
- **Contratos congelados do frontend**: mudar o *shape* exige teste de contrato e alinhamento:
  `GET /api/config` (config.js), `GET /nomes/busca` (array nu), metadado de foto `sv360` (câmera plana,
  `previewThumbnail` relativo), envelope de operação de sync, e o snapshot (estrutura idêntica ao IndexedDB).
- **Identidade = JWT de emissor único**: `sub`, `role ∈ {user,producer,credenciado,admin}` (global),
  `organization_id` (lotação, só exibição), `producer_org_id` (escopo de produção, `null` = não
  produz) + aliases `org`/`login`. Tokens legados degradam (`organization_id→null`,
  `producer_org_id→null`, que é o valor certo: quem não tem a claim não produz). **Houve uma quarta
  claim, `org_role`** (papel dentro da OM), removida em 2026-08-20 com a coluna: um token já assinado
  continua chegando com ela e os dois mapeadores a IGNORAM, porque claim aposentada se ignora, nunca se
  reage a ela, e a condição de reconciliação da sessão deslizante perdeu o disjunto dela pelo mesmo
  motivo (com ele de pé, um legado que trouxesse só a claim morta promoveria a lotação do banco). **Nenhum ramo de autorização deve LER
  `producer_org_id` do token**: ele alimenta INSERT e pré-filtro, e a garantia fica no SQL.
  `flexibleAuth` é global e **não-bloqueante** (Bearer/cookie/
  `x-api-key`, preserva anônimo); rotas de escrita usam o middleware `auth` **estrito** (401 sem token).
  `flexibleAuth` faz **sliding session**: renova o cookie `token` quando faltam <5 min p/ expirar.
- **Lifecycle de socket de colaboração é CLIENT-DRIVEN** (contrato p/ o frontend): `auth.logout` só revoga o
  refresh token, e **não** fecha sockets de `collab` nem limpa presença. Um socket só cai (a) quando o cliente
  fecha a conexão / envia `leave`, ou (b) quando o sweep de heartbeat (~30s, `reconcileAuthorization`)
  reconcilia **autorização** (share revogado / atlas despublicado / org desativada), e ele **não** reage à
  revogação do refresh token. Há **um socket por `atlasId`** (sem mensagem de "switch"): trocar de atlas =
  abrir nova conexão e fechar a anterior pelo cliente.
- **`sv360` está FORA do sync/CRDT/WS** do atlas: BLOBs WebP em SQLite por projeto (`{slug}.db`, worker
  pool + ETag O(1) + semáforo), erros em envelope **plano** `{ error }` (não `{error:{code,message}}`),
  `db_filename` **derivado no servidor** (`${orgId}__{slug}.db`), ingestão swap-then-commit. Detalhes em
  [[streetview-360]] e [[ingestao-projetos-360]], ambas em [`../docs/wiki/`](../docs/wiki/index.md).
  Ao citar doc, use wikilink ou caminho entre crases: caminho nu em prosa é ponto cego dos DOIS
  guardas de integridade ao mesmo tempo, e foi assim que um ponteiro para uma pasta inexistente
  sobreviveu aqui.

## Convenções de código

- **Um arquivo por responsabilidade** no módulo (referência: `src/modules/atlas/`):
  `.routes.js` (só rotas, ordem `[auth, requireAtlasPermission, validate, ctrl]`) · `.controller.js`
  (HTTP, sempre `asyncHandler`, lê `req`, escreve `res.json({ data })`/`201`/`204`) · `.service.js`
  (toda a lógica) · `.queries.js` (SQL `UPPER_SNAKE`, `$1..$n`) · `.schemas.js` (Joi) · `index.js` (re-export).
- **Validação Joi na borda** (`validate({ body })` na rota), nunca no controller. Toda rota de escrita valida.
- **Erros**: lance subclasses de `AppError` (`NotFoundError`404 · `ForbiddenError`403 ·
  `UnauthorizedError`401 · `ConflictError`409 · `ValidationError`422 · `BadRequestError`400); o
  `errorHandler` (último em `app.js`) mapeia e mascara stack em prod. Sem try/catch por rota (`asyncHandler`).
- **DB**: `query()` retorna `{ rows }`; `one/any/none` e os `t.*` retornam **direto**. Multi-query
  atômica via `tx(async t => …)`, e **passe o `t`** às chamadas internas (inclusive `createAudit(req, p, t)`).
- **SQL 100% parametrizado**; `SET` dinâmico só a partir de **whitelist de colunas**, nunca de input.
- **Mutação colaborativa faz broadcast WS** após a escrita e antes do `res` (`atlas_updated`,
  `operations`, etc.).

## Migrações

`src/database/migrations/NNN_*.sql`, ordem alfabética, tracking em `_migrations`, **forward-only**,
**aditivas** (`ADD COLUMN DEFAULT`/`CREATE TABLE/INDEX`). Use o **próximo número livre**, e descubra
qual é com `ls src/database/migrations/`, nunca por esta linha: ela já afirmou um head duas vezes, e
das duas estava desatualizada, porque número fixo em prosa envelhece a cada migração.
`gen_random_uuid()` para PKs (não `uuid_generate_v4`). Migração que mexe em PostGIS precisa de superusuário.

**A base é um conjunto de BASELINES POR DOMÍNIO, escritas no ESTADO FINAL do schema.** Foram dois
esmagamentos (2026-08-19, de 22 arquivos para 8) e uma dobra (2026-08-22, que trouxe as três
migrações seguintes para dentro das baselines). Descubra a contagem com `ls`, nunca por esta linha.
A ordem entre elas é a de dependência de FK, não cronologia, e a última é pura consumidora (nada
depende dela). Consequências
que mordem quem não sabe: um banco criado antes do esmagamento **não é alcançável por upgrade** e
precisa ser recriado (a guarda no topo da primeira baseline detecta os nomes antigos em `_migrations`
e levanta com a instrução, em vez do enigmático "relation already exists"); e **nenhuma baseline pode
conter um `ALTER` que desfaça o que ela mesma criou** — se o CHECK precisa ser mais largo, ele nasce
largo.

**DDL destrutiva** (`DROP CONSTRAINT`, `DROP TABLE`, `ALTER COLUMN ... TYPE`) exige **uma linha por
ocorrência** em `EXCECOES_DESTRUTIVAS` (`tests/unit/migrations-higiene.test.js`), **no mesmo
commit**; esquecer deixa a suíte vermelha com uma mensagem que não parece ter relação com o assunto
da migração. Alargar um CHECK é compatível para trás (todo valor aceito antes continua aceito), mas
Postgres não tem `ALTER CONSTRAINT` para expressão, então o constraint cai e volta, e isso conta
como destrutivo. **A lista tem DUAS linhas hoje**, as duas da `011_grupo_com_dono_e_producao.sql`:
o `DROP COLUMN` de `org_role` e o CHECK de ação alargado para `PERMISSION_REPARENT`. Não conte por
esta frase antes de acrescentar a sua: a contagem é asserida EXATA, e ela já envelheceu duas vezes.
Ela só discrimina alguma coisa por causa do teste de controle negativo, que roda os mesmos padrões
contra SQL que os contém. **Forward-only vale a partir do momento em que a migração sai daqui**:
reescrever uma baseline só é honesto enquanto nenhum banco fora do branch a aplicou, o que hoje é o
caso porque não há produção; no dia em que houver, alargar um CHECK volta a exigir arquivo novo e
linha nesta lista.

**Migração roda por `t.none()`, que LANÇA se o arquivo devolver qualquer linha.** Chamar função numa
migração é `PERFORM` dentro de um bloco `DO`, nunca um `SELECT` solto: o `SELECT` aborta a transação
com "No return data was expected", mensagem que não aponta para o SQL culpado.

## Segurança (baseline)

SQL parametrizado · rate limit nas rotas sensíveis de `/auth` (um limiter POR ROTA, nunca uma
instância compartilhada: a chave de `authLimiter` inclui o `username`, que só existe no schema de
duas delas) e em `/atlas/public/:link` · bcrypt
custo 12 + login timing-safe + rotação/detecção-de-reuso de refresh · `jwt.verify` **só HS256** · upload
allowlist `png/jpeg/webp` + magic-bytes (**sem SVG**), download como `attachment` · helmet CSP/HSTS ·
self-registration gateada por `ALLOW_SELF_REGISTRATION` (off em prod).

**Auto-cadastro: e-mail é OBRIGATÓRIO e é o que torna a confirmação obrigatória.** `registerSchema`
exige `email`, então a conta nasce pendente e o gate que já existia em `login()`
(`user.email && !user.email_verified`) passa a bater sempre neste caminho, sem gate novo. O gate
continua **condicional ao e-mail** de propósito: `POST /api/v1/users` (caminho administrativo) não tem
campo de e-mail e a conta que ele cria loga na hora, e é ela que se tranca fora se alguém "simplificar"
a condição para `!user.email_verified`. A rota carrega **dois** limitadores, e a ordem importa:
`registerLimiter` (por ENDEREÇO) antes de `authLimiter`, porque num cadastro o `username` da chave
`${ip}:${username}` é escolhido pelo chamador e nunca existe ainda, logo balde novo a cada requisição.
Em produção com auto-cadastro ligado o boot **recusa subir** sem `SMTP_HOST` e `APP_BASE_URL`
(verificação obrigatória sem canal de entrega cria conta que ninguém ativa, e o mailer degrada calado).

## SyncLedger (observabilidade de sync, test/dev)

Camada de tracing **aditiva e gated**, com três invariantes que o código sozinho não anuncia:

- **Nunca em produção**, e a garantia é uma **conjunção** no ponto de montagem (`isTraceEnabled() && !config.isProd`, `src/app.js`). O segundo termo existe para o caso de `EBGEO_TRACE=1` vazar para um ambiente de prod: o tracer liga e as rotas continuam desmontadas.
- **`GET/DELETE /api/v1/debug/trace` é gateado POR ATLAS**, não só por `auth`: o anel é por atlas, e `liftAtlasIdToParams` sobe o `atlasId` do query (400 se faltar) antes de `requireAtlasPermission`. Tratar o anel como recurso global já foi um wipe cross-atlas por qualquer portador de token.
- **O `traceId` sobrevive por duas condições no `sync.schemas`** (Joi `.unknown(true)` **e** campo explícito). Perder qualquer uma degrada o ledger em silêncio: nenhum teste fica vermelho, só a correlação por gesto some.

`utils/sync-trace.js` é o espelho do contrato de estágios do frontend e os dois lados andam em lockstep. Armadilhas de leitura e as fontes: [`../docs/wiki/syncledger.md`](../docs/wiki/syncledger.md).

## Antes de finalizar

`npm run lint` limpo e `npm test` verde (unit+integration+ws). Toda mudança de schema/sync precisa de
teste de regressão; todo filtro de acesso precisa de teste com usuário **sem** permissão. Atualize o
`README.md`/doc as-built relevante se o comportamento documentado mudou.
