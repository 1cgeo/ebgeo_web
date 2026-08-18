# Organizações (OMs) como Tenant

A OM é um tenant de alcance estreito: particiona usuários e projetos 360, nunca atlas. Desativá-la não esconde, expulsa: derruba login, refresh e sockets abertos dos membros em segundos.

CRUD em `backend/src/modules/organizations/`, DDL em `backend/src/database/migrations/001_core.sql`. Envelope de erro padrão de [[erros-api]] / [[sintese-contrato-erros-http]].

## O que a org NÃO escopa (a expectativa errada)

A frase que circula, "uma organização representa a OM dona dos dados" (origem: guia *12-multiorg-identidade-auditoria*, absorvido), é **intenção de projeto e não comportamento**. `atlas` tem só `owner_id` e nenhum `organization_id` (`backend/src/database/migrations/002_atlas.sql`); nem mapas, nem camadas, nem feições são escopados por org, e nenhuma consulta de atlas filtra por ela. O acesso vem de `atlas_shares`. Quem parte dessa frase desenha isolamento que o banco não entrega. Ver [[atlas-modelo-de-dados]] e [[permissoes-atlas]].

Nomes geográficos também não: são gated por concessão de zona por usuário e por grupo, resolvida em `ng.fn_user_zone_geoms` (`backend/src/database/migrations/004_ng.sql`) e consumida pelas queries de `backend/src/modules/nomes/nomes.queries.js`. Ver [[zonas-acesso-geografico]] e [[gazetteer-nomes-geograficos]].

A org de fato particiona dados em `sv360.projects.organization_id`, com `UNIQUE (organization_id, slug)` (`backend/src/database/migrations/005_sv360.sql`), e desde 2026-08-17 também em `owner_org_id` nas quatro tabelas de catálogo. Essas colunas dizem **quem produziu**; elas não são consultadas contra a lotação de ninguém.

## São DUAS colunas de OM no usuário, e só uma autoriza

`users.organization_id` é **lotação e exibição, sem poder nenhum**. `users.producer_org_id` é o escopo de PRODUÇÃO, escrito só por administrador, e é ele que autoriza manter o catálogo e o acervo 360 daquela OM. `org_role` **não decide nada** em nenhum arquivo do backend.

Isso é uma inversão recente, e conhecê-la evita diagnóstico errado: até 2026-08-17 a lotação era auto-declarada no cadastro anônimo e **autorizava** a leitura dos projetos 360 ocultos e privados da OM escolhida, com `org_role` autorizando a escrita. Era escalação de privilégio por formulário, e o `CHECK` bicondicional de 018 (`(role='producer') = (producer_org_id IS NOT NULL)`) existe para que crachá sem escopo e escopo sem crachá sejam estados impossíveis. Ver [[acesso-a-recurso-privado]], [[streetview-360]] e [[ingestao-projetos-360]].

**Consequência prática:** `org_role` não serve para decidir coisa nenhuma. No frontend ele ainda vira o papel de sessão no login e no restore de boot, mas o papel **por atlas** do payload do WS o sobrescreve ao conectar (`frontend/src/js/store/sync/sync-engine.js`), então ele é só o default de UI enquanto não há atlas conectado. Ver [[sessao-boot-e-ciclo-de-vida]] e [[sintese-eixos-de-permissao]].

## Por que o gate roda contra o banco, e não contra o JWT

A claim de org no access token fica até `JWT_ACCESS_EXPIRY`=15min desatualizada. Confiar nela faria um membro de OM desativada continuar trabalhando pela janela inteira e, com a renovação deslizante de [[auth-flexivel]], indefinidamente. Por isso toda checagem consulta o banco ao vivo (`backend/src/utils/org-status.js`), e o custo foi mantido em **uma** leitura: `getLiveAuthState` faz `LEFT JOIN organizations` e devolve usuário e org juntos, substituindo a consulta org-only anterior.

Duas escolhas contraintuitivas, ambas deliberadas e comentadas no cabeçalho de `backend/src/utils/org-status.js`:

- **Linha de org ausente conta como ativa** (`COALESCE(o.is_active, true)`). Ausência é anomalia, não desativação; trancar todo mundo para fora por causa de uma FK órfã seria pior.
- **Linha de usuário ausente também não revoga** (`auth`, `backend/src/middleware/auth.js`). O sistema só faz soft-delete, então sumiço de linha é anomalia. A revogação real vem de `is_active = false`.

Pontos onde o gate roda: middleware `auth` (`backend/src/middleware/auth.js`), login e refresh (`backend/src/modules/auth/auth.service.js`, e no refresh ele mata também a rotação de [[refresh-token-rotacao]]), sessão deslizante (`backend/src/middleware/flexible-auth.js`), e o WebSocket de [[canal-collab-websocket]] (403 no upgrade, e socket já aberto fechado com código `4003` por `reconcileAuthorization`, `backend/src/modules/collab/collab.gateway.js`).

O `4003` **não** tem uma lista fixa de três gatilhos, e enumerá-lo como lista fechada é a forma de erro que a constituição proíbe para nível de permissão: o socket cai quando `getLiveAuthState` reprova (conta inativa ou org inativa) **ou** quando a permissão do atlas deixa de resolver (share revogado, atlas despublicado). O papel global vivo é adotado antes dessa reresolução, então rebaixar um admin também derruba socket. A janela é a do sweep de heartbeat, ~30s.

**Fura o gate por design:** principais de [[link-publico]]. O `auth` estrito faz early-return para qualquer `sub` que não seja UUID (guarda `PRINCIPAL_UUID_RE`, `backend/src/middleware/auth.js`), porque o token público sintético não tem linha em `users`. A autoridade dele vem do token assinado mais a flag `is_public` do atlas, e desde 2026-07-24 o visitante ainda é confinado ao atlas que emitiu o token, antes da isenção.

**Não fura, mas escapa:** o mesmo middleware adota ao vivo o `role` **global** e o `producer_org_id` (`backend/src/middleware/auth.js`, no bloco que atribui `req.user.role = live.role`), mas deliberadamente **não** sobrescreve `org_role`/`organization_id`. Ou seja, tirar o crachá de produtor vale no pedido seguinte; mover alguém de OM só aparece depois do próximo refresh, e não muda autorização nenhuma enquanto isso.

## Armadilhas do CRUD

- **`slug` é imutável por contrato**: ausente do `updateOrganizationSchema` de propósito, porque é chave de resolução em outros módulos (`backend/src/modules/streetview360/sv360.admin.queries.js` resolve `orgSlug` para id). A UI reforça: deriva o slug de `slugify(nome)` só na criação e nunca o reenvia no update (`frontend/src/js/admin/personnel-tab.js`). Renomear a OM não muda o slug. Escolha bem.
- **Limpar a `sigla` funciona, e passou a funcionar em 2026-07-24.** `UPDATE_ORGANIZATION` usa a mesma flag de presença que `users` (`sigla = CASE WHEN $5 THEN $3 ELSE sigla END`, `backend/src/modules/organizations/organizations.queries.js`), e o service converte `''` em `null` e passa `data.sigla !== undefined` como flag. Omitido é inalterado; `null` ou `""` explícito limpa. Antes disso era `COALESCE($3, sigla)` com `data.sigla ?? null`, e a página prescrevia enviar `""` como saída, o que a UI nunca fez: o painel admin manda `v.sigla || null` (`frontend/src/js/admin/personnel-tab.js`), justamente no gesto de limpar o campo, então o único cliente que existe caía na armadilha toda vez. O conserto foi no lado do servidor, o que também alinhou os dois módulos num padrão só. Ver [[gestao-usuarios]].
- **As listas controladas têm duas fontes, com filtros diferentes, e isso vale para postos e OMs igualmente.** `GET /api/v1/organizations` e `GET /api/v1/ranks` exigem `auth` e **não** filtram `is_active` (`LIST_ORGANIZATIONS` e `LIST_RANKS`), então uma OM ou um posto "excluído" continua aparecendo vivo no painel admin, que lista sem filtro (`frontend/src/js/admin/personnel-tab.js`); filtre no cliente. Já o dropdown **anônimo** do signup vem do `GET /api/config`, com SQL inline em outro módulo e `WHERE is_active = true` (`backend/src/modules/config/config.service.js`). Consequência: um item desativado some do cadastro e permanece na tela de administração. Ver [[config-dinamico]] e [[resources-catalogo]].
- **Conflito de slug é check-then-insert**, não atômico (`createOrganization`, `backend/src/modules/organizations/organizations.service.js`). Sob concorrência, o perdedor bate na `UNIQUE` do banco e vira erro genérico em vez de 409 limpo.
- **Reativar é `PUT` com `is_active: true`**: não existe rota de "undelete".
- **Desativar a OM expulsa também quem desativou, e não há volta pela API.** O gate de org precede qualquer checagem de papel: o `auth` estrito devolve 403 `Organization is inactive` sem olhar `role` (`backend/src/middleware/auth.js`) e o login idem (`backend/src/modules/auth/auth.service.js`). Como reativar é `PUT`/`DELETE` sob `auth` mais `requireAdmin` (`backend/src/modules/organizations/organizations.routes.js`), o admin que desativou a própria OM não chega nem ao `requireAdmin`, e não existe admin de bootstrap: a saída é SQL direto no banco. Nada no módulo guarda contra isso, nem em `deactivateOrganization` nem no `PUT` com `is_active: false` (`backend/src/modules/organizations/organizations.service.js`), ao contrário do módulo irmão, que implementa a guarda análoga contra lockout do último admin (`backend/src/modules/users/users.service.js`). O admin do seed só escapa por acidente, porque nasce com OM nula (`backend/src/database/seed.js`) e `orgIsActive` isenta quem não tem org (`backend/src/utils/org-status.js`). Numa instalação de OM única sobre a org default, desativá-la derruba a API inteira. Ver [[gestao-usuarios]].

## Contratos congelados

- **O UUID da org default `00000000-0000-0000-0000-000000000001`** está escrito literalmente em três lugares independentes: o seed (`backend/src/database/migrations/001_core.sql`), o `COALESCE` do autocadastro (`backend/src/modules/auth/auth.queries.js`) e o `DEFAULT_ORG_ID` do ETL 360 (`backend/src/modules/streetview360/sv360.merge.js`). Só o terceiro é uma constante nomeada; os outros dois são literais soltos, e mudar o id quebra os três em silêncio. Ver [[sintese-contratos-congelados]].
- **Trocar de OM é ação de admin, nunca self-service**, e o mesmo vale com muito mais força para `producer_org_id`: `updateProfileSchema` omite os dois (`backend/src/modules/users/users.schemas.js`). A justificativa mudou de peso, o que importa para quem for mexer no schema: a lotação é recusada porque alimenta o gate de liveness e é identidade institucional, não porque compre acesso (não compra mais); o escopo de produção é recusado porque **é** autorização, e aceitá-lo ali seria auto-cadastro de crachá. Ver [[gestao-usuarios]].
- **Aliases `org` e `login`** no access token são consumidos as-is pelo módulo 360 (`issueAccessToken`, `backend/src/modules/auth/auth.service.js`). Ver [[jwt-emissor-unico]], [[autenticacao-jwt]] e [[api-keys]].
- `organization_id` é **nullable** e o fallback de token legado é `?? null` (`verifyAndMapUser`, `backend/src/middleware/auth.js`). Só o autocadastro garante org; contas por outros caminhos podem ficar sem OM. Não presuma a default.
- OMs são **lista plana**: não há coluna de hierarquia. Subordinação militar não é representável.

## Auditoria fora da transação

`ORG_CREATE`/`ORG_UPDATE`/`ORG_DELETE` chamam `createAudit` **sem** o terceiro argumento de transação (`backend/src/modules/organizations/organizations.controller.js`), e `createAudit` só entra em `t.none` quando esse argumento existe (`backend/src/utils/audit.js`). Se o insert de auditoria falhar, a org já foi criada ou desativada e a trilha não registra. É o último módulo que audita fora de uma transação **que existe**, e a distinção importa desde que o catálogo passou a auditar: lá as três escritas são uma query cada, então não há transação a que aderir e a chamada no controller é a única forma possível ([[resources-catalogo]]). Aqui há, e `users` e `zones` já migraram para dentro do `tx` do service; é para lá que uma auditoria nova de OM deve ir. No `ORG_DELETE` o `targetName` nem é preenchido, então a trilha guarda só o UUID. Ver [[auditoria]].

Ver [[api-rest-atlas]] para o padrão do cliente REST.
