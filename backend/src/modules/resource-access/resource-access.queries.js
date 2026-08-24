// Path: src/modules/resource-access/resource-access.queries.js
// SQL nomeado do módulo de acesso a recurso. O PREDICADO de acesso não mora aqui:
// ele mora nas funções SQL de `008_acesso_a_recurso.sql`, e estas consultas as CHAMAM. Uma
// definição só, que é a dívida que o schema `ng` já paga por não ter feito assim.
// O do 360 é composto e vem de `sv360.queries.js` pelo mesmo motivo.
import { sv360AccessPredicate } from '../streetview360/sv360.queries.js';
import { catalogAuthorizationPredicate } from '../catalog/catalog.queries.js';

/**
 * Marca um recurso de CATÁLOGO como público ou privado.
 *
 * O nome da tabela é INTERPOLADO pelo chamador a partir de `assertCatalogTableOf`,
 * nunca do request.
 *
 * O GATE FINO MORA NO `WHERE` DA PRÓPRIA ESCRITA, e não numa leitura anterior: é a
 * mesma escada de `updateCatalogItem`/`deleteCatalogItem`. Ler o dono e depois
 * escrever deixa uma janela entre as duas consultas; `fn_can_produce_resource` dentro
 * do `WHERE` fecha a janela e, de quebra, devolve ZERO LINHA para a linha de outra OM
 * — que o serviço traduz em 404, nunca em 403, para que a rota não vire oráculo de
 * inventário.
 *
 * `owner_org_id` viaja no RETURNING para a trilha de auditoria: ela precisa saber de
 * QUAL OM era o recurso cuja visibilidade mudou, e depois do commit essa resposta
 * exigiria uma segunda consulta.
 *   $1 = accessLevel, $2 = id, $3 = ator, $4 = tipo de recurso
 * @param {string} table - Já validado.
 * @returns {string}
 */
export const setCatalogAccessLevel = (table) => `
  UPDATE ${table} SET access_level = $1, updated_at = NOW()
   WHERE id = $2 AND active = true
     AND fn_can_produce_resource($3::uuid, $4::text, $2)
   RETURNING id, name, access_level, owner_org_id
`;

/**
 * Idem para o 360, cuja chave é UUID.
 *
 * O DUPLO CAST DE `$2` NÃO É ENFEITE: ele é usado como `uuid` na chave e como `text`
 * no argumento da função de produção, e sem `$2::uuid::text` o parâmetro chegaria com
 * tipo deduzido de forma inconsistente entre os dois usos.
 *   $1 = accessLevel, $2 = id, $3 = ator
 */
export const SET_360_ACCESS_LEVEL = `
  UPDATE sv360.projects SET access_level = $1, updated_at = NOW()
   WHERE id = $2::uuid
     AND fn_can_produce_resource($3::uuid, 'sv360_project', $2::uuid::text)
   RETURNING id::text AS id, name, access_level, organization_id AS owner_org_id
`;

/**
 * Os FATOS de um recurso de catálogo: o nível de acesso (para o gate pontual) e a OM
 * DONA (para a trilha). $1 = id.
 *
 * A OM VIAJA JUNTO porque este é o ponto único onde o módulo já resolve "qual linha é
 * essa": as quatro escritas de trilha do módulo (visibilidade, conceder, revogar,
 * purgar) precisam carimbar a OM dona do recurso, e reusar esta leitura evita uma
 * consulta a mais por tipo. O alias uniformiza catálogo e 360, que nomeiam a coluna de
 * formas diferentes.
 */
export const getCatalogAccessLevel = (table) => `
  SELECT id, access_level, owner_org_id FROM ${table} WHERE id = $1 AND active = true
`;

/** Idem para o 360, cuja coluna de OM se chama `organization_id`. $1 = id (uuid textual). */
export const GET_360_ACCESS_LEVEL = `
  SELECT id::text AS id, access_level, organization_id AS owner_org_id
    FROM sv360.projects WHERE id = $1::uuid
`;

/** O predicado escalar, para checagem PONTUAL. $1..$5 como fn_can_see_resource. */
export const CAN_SEE_RESOURCE = `
  SELECT fn_can_see_resource($1::uuid, $2::uuid, $3::text, $4::text, $5::text) AS ok
`;

// --- o payload aditivo -----------------------------------------------------

/**
 * A PROCEDÊNCIA de cada linha do payload aditivo, DERIVADA das mesmas funções que
 * decidem se a linha entra.
 *
 * O PROBLEMA QUE ELE RESOLVE, e por que ele não é um segundo predicado. O cliente
 * desenhava UM selo "Privado" para três procedências diferentes (papel global,
 * concessão pessoal e empréstimo do atlas em foco) com uma frase que só é verdadeira
 * para uma delas. Separá-las exigiria saber POR QUAL braço a linha entrou, e o
 * predicado é uma disjunção: ela responde "entra", nunca "por onde".
 *
 * A DECOMPOSIÇÃO É POR PARÂMETRO, NÃO POR REGRA NOVA, e é isso que mantém UMA
 * definição de "quem vê o quê". Os dois primeiros braços já são funções escalares
 * (`fn_has_global_data_access`, `fn_can_produce_resource`) e viram coluna direto. O
 * terceiro se parte usando a MESMA `fn_granted_resource_ids` com `p_atlas_id` NULO:
 * o braço de empréstimo dela exige `p_atlas_id IS NOT NULL`, então com NULL sobram
 * exatamente os dois braços de CONCESSÃO (direta e por grupo). O que restar — linha
 * que entrou no resultado e não casou nenhuma das três colunas — só pode ter vindo do
 * braço de empréstimo, e o serviço a nomeia por eliminação. Escrever um SELECT
 * próprio para "concessão" seria a segunda regra que divergiria da primeira.
 *
 * O VISITANTE ANÔNIMO DE LINK PÚBLICO chega com `$user` NULO: as duas funções de
 * papel devolvem falso e `fn_granted_resource_ids` sai vazia (ela exige
 * `fn_principal_vivo(p_user_id)`), então toda linha dele cai em `emprestimo`, que é o
 * único caminho que ele tem. Não há `undefined` possível: as três colunas são
 * booleanas e não-nulas.
 *
 * CUSTO: três avaliações por linha, sobre conjuntos que são o DELTA privado de um
 * chamador (unidades a dezenas de linhas). A alternativa — três consultas separadas e
 * uma junção em JS — pagaria três viagens ao banco por tipo de recurso.
 *
 * @param {{userParam: string, typeExpr: string, idExpr: string}} params - Fragmentos
 *   já parametrizados ou literais de whitelist, nunca texto de request.
 * @returns {string} Três colunas booleanas, para a lista de SELECT.
 */
const originColumns = ({ userParam, typeExpr, idExpr }) => `fn_has_global_data_access(${userParam}) AS por_papel_global,
         fn_can_produce_resource(${userParam}, ${typeExpr}, ${idExpr}) AS por_producao,
         (${idExpr} IN (SELECT resource_id
                          FROM fn_granted_resource_ids(${userParam}, NULL::uuid, ${typeExpr}))) AS por_concessao`;

/**
 * O PRAZO da concessão VIVA de MAIOR vencimento que este chamador tem sobre a linha.
 *
 * `MAX`, E NÃO `MIN`, E A ESCOLHA É A PERGUNTA DA TELA. O chip do cartão do catálogo diz
 * "depois desta data o item some do seu catálogo", ou seja, a pergunta é QUANDO EU PERCO
 * ISTO. Concessão é DISJUNTIVA (D3: a estrutura é um DAG, e a mesma pessoa pode ter
 * concessão direta e por grupo, de concedentes diferentes), então o acesso sobrevive
 * enquanto QUALQUER uma estiver viva — o instante da perda é o MAIOR `expires_at`, nunca o
 * menor. Com `MIN`, a tela anunciaria o sumiço numa data em que o item demonstravelmente
 * continua lá, e o preço não é o susto: é a pessoa aprender que o chip mente, e ignorar o
 * aviso no dia em que ele estiver certo.
 *
 * O DE FORA É QUEM MANDA NO NULO, e não esta consulta: o serviço só publica este valor
 * quando a procedência é `concessao` (ver `prazoDeAcesso`). Quem enxerga por PAPEL (papel
 * global ou produção) não perde nada quando uma concessão vence, então mostrar o prazo dela
 * seria prometer um vencimento que não existe.
 *
 * OS TERMOS DE VIDA SÃO OS DOIS BRAÇOS DE CONCESSÃO DE `fn_granted_resource_ids`, termo a
 * termo, exatamente como em `LIST_GRANTS_RECEIVED_BY_ACTOR`: `revoked_at`, `expires_at`, a
 * vida do CONCEDENTE (D8(b)) e `fn_user_group_ids` para o coletivo. Esta É uma segunda
 * escrita daqueles termos, e vale dizer o que ela custa se divergir: ela não decide acesso
 * nenhum (quem decide é o `WHERE` da consulta que a hospeda), então uma divergência custa
 * uma DATA errada num rótulo, nunca uma linha a mais no resultado. Reusar a função não era
 * possível sem mexer nela: `fn_granted_resource_ids` devolve só `resource_id`, e alargar a
 * assinatura dela é mudança de baseline.
 *
 * O ID PRECISA CHEGAR QUALIFICADO, e este é o único jeito de a correlação estar certa:
 * `resource_grants` TEM uma coluna `id`, então um `id::text` nu dentro deste subselect
 * resolveria para `g.id` (o escopo interno vence), a comparação viraria `g.resource_id =
 * g.id`, e o resultado seria NULL para todas as linhas — sem erro, sem vermelho, com o chip
 * simplesmente nunca aparecendo. `originColumns` escapa disso por acidente (o subselect dela
 * é sobre uma função que só expõe `resource_id`), e é por isso que o aviso mora aqui.
 *
 * @param {{userParam: string, typeExpr: string, idExpr: string}} params - `idExpr` PRECISA
 *   ser qualificado pela tabela externa (`t.id`, `projects.id::text`).
 * @returns {string} Uma coluna `timestamptz|null`, para a lista de SELECT.
 */
const expiryColumn = ({ userParam, typeExpr, idExpr }) => `(SELECT MAX(g.expires_at)
            FROM resource_grants g
           WHERE g.revoked_at IS NULL
             AND g.expires_at > NOW()
             AND g.resource_type = ${typeExpr}
             AND g.resource_id = ${idExpr}
             AND fn_principal_vivo(${userParam})
             AND (g.granted_by IS NULL OR fn_principal_vivo(g.granted_by))
             AND ( g.grantee_id = ${userParam}
                OR g.grantee_group_id IN (SELECT group_id FROM fn_user_group_ids(${userParam})) )
         ) AS concessao_expira_em`;

/**
 * The PRIVATE resources of one catalog type that this principal can see.
 *
 * Semi-join against `fn_granted_resource_ids`, never `fn_can_see_resource` per row: one
 * query instead of one per row (R8). The table name is INTERPOLATED by the caller from
 * `assertCatalogTableOf`, never from the request.
 *
 * THE THREE AUTHORISATION ARMS come from `catalogAuthorizationPredicate`
 * (`catalog/catalog.queries.js`) since F11, and are no longer written here: the same
 * composition already existed in `catalog.service.js` and was about to get a third copy in
 * the snapshot rehydration. What THIS query still decides is the absence of the `public`
 * term, right below.
 *
 * `access_level = 'private'` is not an optimisation, it is the endpoint's contract: what it
 * returns is the DELTA over the public `/api/config`, and the client ADDS it. Bringing the
 * public rows in here would duplicate every item in the client's baseline.
 *
 * THE PRODUCTION ARM BELONGS HERE FOR THE SAME REASON IT BELONGS IN `catalog.service.js`, and
 * its absence was an inconsistency between two READ paths over the same data: a producer saw
 * their own private layer in `GET /api/v1/analysis-layers` (which already had the arm) and did
 * NOT see it here — so it existed in the panel that edits it and was missing from the additive
 * payload the map boots with, with no error anywhere. It is the exact mirror of what the
 * comment on `LIST_VISIBLE_PRIVATE_360` (just below) describes as already fixed for the 360.
 *
 * `$3` FEEDS BOTH PREDICATES on purpose: for the FOUR catalog tables the vocabulary of
 * `resource_grants.resource_type` and that of `fn_can_produce_resource` coincide word for word
 * (`basemap`, `tileset`, `data_layer`, `analysis_layer`). Should they ever diverge, this
 * parameter has to split in two — and the coincidence is written here so the divergence does
 * not go unnoticed. It is not guaranteed by construction: they are two maps in different files
 * (`PRODUCTION_TYPE_BY_TABLE` and `TYPE_BY_TABLE`), and `catalog-tabelas-paridade.test.js` is
 * what compares them.
 * AS TRÊS COLUNAS DE PROCEDÊNCIA (`originColumns`, logo acima) viajam com a linha e são
 * DERIVADAS destes mesmos braços; elas não decidem nada aqui e não entram no item que o
 * cliente recebe (o serviço projeta explicitamente). A QUARTA coluna (`expiryColumn`) viaja
 * pelo mesmo motivo e sai pelo mesmo caminho, no mapa irmão `expirations`.
 *   $1 = userId (uuid|null), $2 = atlasId (uuid|null), $3 = resource type (text)
 * @param {string} table - Already validated by assertCatalogTableOf.
 * @returns {string}
 */
export const listVisiblePrivate = (table) => `
  SELECT t.id, t.name, t.description, t.config, t.sort_order,
         ${originColumns({ userParam: '$1::uuid', typeExpr: '$3::text', idExpr: 't.id' })},
         ${expiryColumn({ userParam: '$1::uuid', typeExpr: '$3::text', idExpr: 't.id' })}
    FROM ${table} t
   WHERE t.active = true
     AND t.access_level = 'private'
     AND ${catalogAuthorizationPredicate({
    alias: 't',
    userParam: '$1::uuid',
    produceTypeExpr: '$3::text',
    atlasParam: '$2::uuid',
    grantTypeExpr: '$3::text',
  })}
   ORDER BY t.sort_order, t.name
`;

/**
 * Projetos 360 privados visíveis. Separado das quatro de catálogo porque
 * `sv360.projects` tem chave UUID, coluna `status` e `organization_id`, e nenhum
 * `active`/`sort_order`.
 *
 * O PREDICADO É O MESMO DO MÓDULO 360, importado e não copiado. Enquanto ele morava
 * aqui escrito à mão, corrigir um lado e esquecer o outro dava um produtor que via o
 * projeto em `/sv360/projects` e não via em `/resource-access/visible`, com as duas
 * suítes verdes. O ramo da OM dona virou o de PRODUÇÃO (a OM deixou de ser
 * auto-declarada), e `status = 'disabled'` continua sendo o eixo de ocultação,
 * inclusive para quem tem concessão.
 *
 * AS TRÊS COLUNAS DE PROCEDÊNCIA são as mesmas do catálogo, com o tipo em LITERAL de
 * whitelist (o predicado do 360 já o escreve assim) e o id em `::text`, porque aqui a
 * chave é UUID e `resource_grants.resource_id` é TEXT.
 *
 * A QUARTA COLUNA RECEBE O ID QUALIFICADO (`projects.id`), e a diferença para a linha de
 * cima não é estilo: `expiryColumn` correlaciona contra um subselect sobre
 * `resource_grants`, que TEM coluna `id` própria, então um `id::text` nu ali dentro
 * resolveria para a linha da concessão e a coluna devolveria NULL para sempre, calada. O
 * qualificador é o nome implícito da tabela do FROM, sem alias novo.
 *   $1 = userId, $2 = atlasId
 */
export const LIST_VISIBLE_PRIVATE_360 = `
  SELECT id::text AS id, slug, name, center_lat, center_long, entry_photo_id,
         photo_count, status, capture_date,
         ${originColumns({ userParam: '$1::uuid', typeExpr: `'sv360_project'`, idExpr: 'id::text' })},
         ${expiryColumn({ userParam: '$1::uuid', typeExpr: `'sv360_project'`, idExpr: 'projects.id::text' })}
    FROM sv360.projects
   WHERE access_level = 'private'
     AND ${sv360AccessPredicate(1, 2)}
   ORDER BY name
`;

/**
 * Os recursos que ESTE ator pode repassar adiante: aqueles em que ele tem uma
 * concessão VIVA de nível `view_share`.
 *
 * Existe para a INTERFACE, e é a razão de ele viajar no payload aditivo em vez de
 * ser perguntado por recurso. O cartão do catálogo precisa decidir se mostra a
 * ação "Compartilhar" ANTES de qualquer clique, e as duas alternativas eram
 * piores: uma chamada por cartão (dezenas de requisições ao abrir o catálogo), ou
 * oferecer o botão a todo mundo e deixar o 403 explicar depois — que é oferecer um
 * formulário que responde 403, exatamente o que o modal de configuração do atlas
 * já recusa fazer por escrito.
 *
 * NÃO cobre o papel global: quem é administrador ou credenciado concede de RAIZ, sem
 * concessão nenhuma, e o cliente já sabe disso por `hasGlobalDataAccess()`. Somar
 * o papel aqui seria uma segunda definição da mesma regra.
 *
 * A PRODUÇÃO, ESSA SIM, ENTROU (2026-08-20), e a assimetria com o papel global não é
 * incoerência: o cliente TEM como saber que é administrador e NÃO tem como saber de
 * qual OM é cada item — o payload aditivo não carrega `owner_org_id`, de propósito.
 * Sem este braço o produtor teria a permissão de repassar o que a OM dele mantém e
 * nenhuma porta para ela, que na tela é indistinguível de não ter a permissão. É a
 * mesma "capacidade sem porta" que o braço de grupo desta consulta já pagou uma vez.
 *   $1 = grantee_id
 */
// O BRAÇO DE GRUPO ENTROU AQUI JUNTO COM O DE `LIVE_GRANTS_OF_ACTOR`, e os dois
// precisam concordar: esta consulta decide se a interface OFERECE o botão
// "Compartilhar", e aquela decide se o servidor ACEITA a escrita. Enquanto só a
// segunda conhecesse grupo, quem recebeu `view_share` através de um grupo teria
// permissão de repassar e nenhum botão para isso — uma capacidade sem porta, que na
// tela é indistinguível de não ter a permissão.
// D8(b) ENTROU NO BRAÇO DE CONCESSÃO em 2026-08-21, pelo mesmo motivo e no mesmo commit
// que em `LIVE_GRANTS_OF_ACTOR`: sem ele a interface ofereceria o botão "Compartilhar"
// para um recurso que o servidor recusa repassar (e que o dono do botão já nem enxerga),
// que é a divergência que o parágrafo acima existe para impedir, na direção oposta. O
// braço de PRODUÇÃO não leva o termo: `fn_produced_private_resource_ids` já confere a
// vida da conta e a da OM produtora, e ali não existe concedente de quem herdar morte.
export const LIST_SHAREABLE_OF_ACTOR = `
  SELECT DISTINCT resource_type, resource_id FROM (
    SELECT resource_type, resource_id
      FROM resource_grants
     WHERE revoked_at IS NULL
       AND expires_at > NOW()
       AND grant_level = 'view_share'
       AND (granted_by IS NULL OR fn_principal_vivo(granted_by))
       AND ( grantee_id = $1::uuid
          OR grantee_group_id IN (SELECT group_id FROM fn_user_group_ids($1::uuid)) )
    UNION
    SELECT resource_type, resource_id FROM fn_produced_private_resource_ids($1::uuid)
  ) s
`;

// --- concessões ------------------------------------------------------------

/**
 * As concessões VIVAS de um recurso, com quem recebeu e quem concedeu (a tela
 * "quem tem acesso"). $1 = resource_type, $2 = resource_id
 *
 * AS DUAS JUNÇÕES DE BENEFICIÁRIO SÃO `LEFT`, E A DE USUÁRIO PRECISOU MUDAR. Ela era
 * `JOIN users gu ON gu.id = g.grantee_id`, um INNER, e numa concessão a grupo o
 * `grantee_id` é NULL por CHECK: a linha inteira sumia da resposta. O sintoma seria o
 * pior possível para uma tela de permissão — conceder a um grupo devolveria 201, e a
 * lista "quem tem acesso" continuaria sem mostrar ninguém, sem erro em lugar nenhum.
 *
 * O DONO DO GRUPO BENEFICIÁRIO É NOMEADO, e não é enfeite de tela: conceder a um
 * coletivo é DELEGAR a quem o compõe o poder de acrescentar beneficiários ao seu
 * recurso, sem passar por `requireResourceShare` e sem criar linha nova em
 * `resource_grants`. Quem lê "quem tem acesso" precisa ver a QUEM delegou, senão a
 * delegação é a única parte do mecanismo que não aparece em lugar nenhum.
 *
 * O GRUPO APAGADO SAI DA LISTA, e é por isso que o filtro está no WHERE e não só na
 * junção. `fn_user_group_ids` exige `deleted_at IS NULL`, então a concessão a um grupo
 * apagado não entrega acesso a ninguém; mantê-la aqui faria a tela chamada "quem tem
 * acesso" listar quem não tem. Não há o que fazer com a linha de qualquer forma: ela
 * já não concede, e revogá-la não mudaria nada.
 *
 * `granted_by_vivo` É COLUNA, E NÃO FILTRO, e a diferença é o que mantém a linha
 * REVOGÁVEL. Desde D8(b) uma concessão cujo concedente morreu (conta ou OM desativada)
 * não entrega mais acesso, mas continua de pé na tabela — reversível, porque reativar a
 * OM a devolve. Filtrá-la daqui tiraria da tela a única linha por onde alguém poderia
 * revogá-la de vez, e a tela "quem tem acesso" passaria a esconder uma aresta que a
 * revogação de outra ainda alcança em cascata. Devolvê-la MARCADA resolve os dois lados:
 * a lista continua completa e o cliente para de contar essa linha como caminho vivo.
 *
 * O CONSUMIDOR É `fallenGrants` (`frontend/src/js/catalog/grant-tree.js`), e sem esta
 * coluna ele SUBESTIMAVA o estrago num ato irreversível: ele resgatava por um segundo
 * `view_share` que o servidor não aceita como pai, então o aviso pré-clique dizia
 * "ninguém cai" e o toast seguinte contava uma queda. Era o defeito exato que a direção
 * de erro documentada naquele arquivo dizia estar impedindo.
 */
export const LIST_GRANTS_FOR_RESOURCE = `
  SELECT g.id, g.resource_type, g.resource_id, g.grant_level, g.parent_grant_id, g.created_at,
         g.expires_at,
         g.grantee_id, gu.username AS grantee_username, gu.nome AS grantee_nome,
         g.grantee_group_id, gg.name AS grantee_group_name,
         gg.owner_id AS grantee_group_owner_id,
         gou.username AS grantee_group_owner_username, gou.nome AS grantee_group_owner_nome,
         (SELECT COUNT(*) FROM access_group_members m WHERE m.group_id = g.grantee_group_id)::int
           AS grantee_group_member_count,
         g.granted_by, bu.username AS granted_by_username, bu.nome AS granted_by_nome,
         (g.granted_by IS NULL OR fn_principal_vivo(g.granted_by)) AS granted_by_vivo
    FROM resource_grants g
    LEFT JOIN users gu ON gu.id = g.grantee_id
    LEFT JOIN access_groups gg ON gg.id = g.grantee_group_id
    LEFT JOIN users gou ON gou.id = gg.owner_id
    LEFT JOIN users bu ON bu.id = g.granted_by
   WHERE g.revoked_at IS NULL
     AND g.expires_at > NOW()
     AND g.resource_type = $1 AND g.resource_id = $2
     AND (g.grantee_group_id IS NULL OR gg.deleted_at IS NULL)
   ORDER BY g.created_at
`;

// --- o inventário de concessões POR ATOR -----------------------------------

/**
 * OS RECURSOS QUE AINDA EXISTEM, nos cinco tipos, com o NOME de cada um.
 *
 * Fragmento de NOME, e nada mais: ele não carrega predicado de acesso nenhum, de
 * propósito, e é por isso que só pode ser usado em JUNÇÃO com uma concessão que já
 * pertence ao chamador (recebida por ele, ou concedida por ele). Pôr o predicado aqui
 * seria uma quarta cópia da regra e, pior, mudaria o assunto: as duas consultas de
 * inventário respondem "o que EU concedi / o que EU recebi", e a autorização delas é a
 * AUTORIA e o BENEFÍCIO da linha, nunca a visibilidade do recurso. Um concedente que
 * perdeu o acesso ao recurso continua precisando ver — e poder revogar — o que deu.
 *
 * A JUNÇÃO É INTERNA, e isso é o filtro de recurso MORTO. O catálogo é soft-delete
 * (`active = false`) e o 360 é hard-delete, então a concessão sobrevive ao recurso nos
 * dois casos: sem o `JOIN`, a tela listaria acesso a coisas que não existem mais como
 * se estivessem vivas (e no caso do 360 nem nome haveria para mostrar). A direção do
 * erro é ESCONDER uma linha morta, nunca mostrar uma viva a mais.
 *
 * O `::text` UNIFORMIZA A CHAVE: as quatro tabelas de catálogo têm id textual (slug) e
 * `sv360.projects` tem UUID, enquanto `resource_grants.resource_id` é TEXT para os
 * cinco. Sem o cast o `UNION ALL` nem tipa.
 */
const RECURSOS_VIVOS = `
    SELECT 'basemap'::text AS resource_type, id::text AS resource_id, name
      FROM basemaps WHERE active = true
     UNION ALL
    SELECT 'tileset'::text, id::text, name
      FROM tilesets WHERE active = true
     UNION ALL
    SELECT 'data_layer'::text, id::text, name
      FROM data_layers WHERE active = true
     UNION ALL
    SELECT 'analysis_layer'::text, id::text, name
      FROM analysis_layers WHERE active = true
     UNION ALL
    SELECT 'sv360_project'::text, id::text, name
      FROM sv360.projects
`;

/**
 * O NOME DE EXIBIÇÃO de uma pessoa, com o mesmo par que o resto do módulo usa.
 *
 * `nome` é o nome de guerra e `username` é o login; o e-mail NUNCA entra, aqui nem em
 * lugar nenhum deste módulo. O `NULLIF` cobre a linha antiga com nome em branco, que
 * mostraria um rótulo vazio na tela em vez de cair no login.
 * @param {string} alias - Apelido da junção com `users`.
 * @returns {string}
 */
const nomeDePessoa = (alias) => `COALESCE(NULLIF(${alias}.nome, ''), ${alias}.username)`;

/**
 * O QUE ESTE ATOR CONCEDEU e ainda está de pé.
 *
 * POR QUE ELA EXISTE: até aqui só havia listagem POR RECURSO
 * (`LIST_GRANTS_FOR_RESOURCE`), o que obrigava quem concede a LEMBRAR o que concedeu
 * para poder revogar. Uma autoridade cujo exercício não é enumerável é uma autoridade
 * que não se consegue desfazer.
 *
 * "VIVA" É O MESMO PREDICADO DE SEMPRE — `revoked_at IS NULL` E `expires_at > NOW()` —,
 * e a segunda metade não é opcional: a morte por vencimento mora no predicado e nunca
 * numa varredura, então uma listagem que só olhasse `revoked_at` mostraria como viva
 * uma concessão que já não entrega acesso nenhum, e ofereceria um botão "revogar" para
 * desfazer o que o relógio já desfez.
 *
 * O GRUPO APAGADO SAI, pela mesma razão de `LIST_GRANTS_FOR_RESOURCE`:
 * `fn_user_group_ids` exige `deleted_at IS NULL`, então a concessão a um grupo apagado
 * não entrega acesso a ninguém e listá-la seria descrever um acesso que não existe.
 *
 * `granted_by` É A ÚNICA CONDIÇÃO DE AUTORIA, e é ela que dispensa gate fino na rota: o
 * conjunto já é, por construção, o que este chamador fez.
 *   $1 = o ator (granted_by)
 */
export const LIST_GRANTS_ISSUED_BY_ACTOR = `
  WITH recurso AS (${RECURSOS_VIVOS})
  SELECT g.id, g.resource_type, g.resource_id, r.name AS resource_name,
         g.grantee_id, ${nomeDePessoa('gu')} AS grantee_nome,
         g.grantee_group_id, gg.name AS grantee_group_name,
         g.grant_level, g.expires_at, g.created_at
    FROM resource_grants g
    JOIN recurso r ON r.resource_type = g.resource_type AND r.resource_id = g.resource_id
    LEFT JOIN users gu ON gu.id = g.grantee_id
    LEFT JOIN access_groups gg ON gg.id = g.grantee_group_id
   WHERE g.granted_by = $1::uuid
     AND g.revoked_at IS NULL
     AND g.expires_at > NOW()
     AND (g.grantee_group_id IS NULL OR gg.deleted_at IS NULL)
   ORDER BY g.created_at DESC, g.id
`;

/**
 * O QUE ESTE ATOR RECEBEU e ainda está de pé, PELOS DOIS CAMINHOS.
 *
 * O BRAÇO DE GRUPO É A RAZÃO DE ELA EXISTIR NESTA FORMA. A delegação por coletivo NÃO
 * cria linha em `resource_grants` para o membro: quem entra num grupo passa a alcançar
 * o que foi concedido AO GRUPO, e uma listagem que só olhasse `grantee_id` responderia
 * "você não recebeu nada" a quem recebeu tudo por essa porta. É a mesma lista fechada
 * que a constituição proíbe, na forma de metade de um eixo.
 *
 * OS DOIS BRAÇOS SÃO OS DE `fn_granted_resource_ids`, TERMO A TERMO, e é isso que faz a
 * resposta desta rota concordar com o que o payload aditivo entrega: `revoked_at`,
 * `expires_at`, a vida do CONCEDENTE (D8(b)) e `fn_user_group_ids` para o coletivo (que
 * já exige grupo vivo e dono vivo). O terceiro braço daquela função, o EMPRÉSTIMO por
 * atlas, fica de fora de propósito: empréstimo não é concessão, não tem linha, não tem
 * concedente e não se revoga — quem o quiser enumerar pergunta ao atlas.
 *
 * `via_group` NOMEIA O CAMINHO, e não é enfeite: a pessoa precisa saber que aquele
 * acesso vem de um coletivo, porque a saída dela do grupo (ou a exclusão dele) o derruba
 * sem que ninguém tenha revogado nada.
 *   $1 = o ator (beneficiário)
 */
export const LIST_GRANTS_RECEIVED_BY_ACTOR = `
  WITH recurso AS (${RECURSOS_VIVOS})
  SELECT g.id, g.resource_type, g.resource_id, r.name AS resource_name,
         g.granted_by AS grantor_id, ${nomeDePessoa('bu')} AS grantor_nome,
         g.grant_level, g.expires_at, g.created_at,
         g.grantee_group_id AS via_group_id, gg.name AS via_group_name
    FROM resource_grants g
    JOIN recurso r ON r.resource_type = g.resource_type AND r.resource_id = g.resource_id
    LEFT JOIN users bu ON bu.id = g.granted_by
    LEFT JOIN access_groups gg ON gg.id = g.grantee_group_id
   WHERE g.revoked_at IS NULL
     AND g.expires_at > NOW()
     AND (g.granted_by IS NULL OR fn_principal_vivo(g.granted_by))
     AND ( g.grantee_id = $1::uuid
        OR g.grantee_group_id IN (SELECT group_id FROM fn_user_group_ids($1::uuid)) )
   ORDER BY g.created_at DESC, g.id
`;

/**
 * ESTENDE O PRAZO de uma concessão VIVA, com o clamp no MESMO statement da escrita.
 *
 * POR QUE A ROTA EXISTE: renovar era impossível. `alreadyGranted` tira da busca quem já
 * tem concessão viva e o servidor devolve 409 na segunda concessão do mesmo par, então
 * o único caminho era revogar antes — e revogar PODA a subárvore, que não volta. Ou
 * seja, a única forma de renovar destruía o que os beneficiários do beneficiário tinham.
 *
 * OS TRÊS TETOS, e o do meio NÃO é o mesmo do `INSERT_GRANT`. Lá o teto da casa é
 * `NOW() + 1 year`; aqui ele é `created_at + 1 year`, e a diferença é imposta pelo
 * `resource_grants_expires_at_check`, que ancora as duas pontas em `created_at` (ele
 * precisa continuar verdadeiro para sempre, e um CHECK ancorado no relógio ficaria falso
 * amanhã e travaria QUALQUER update na linha). A consequência é real e precisa estar
 * escrita: uma linha de concessão nunca dura mais de um ano CONTADO DO NASCIMENTO dela,
 * e estender é gastar o que sobra desse orçamento. Copiar o `NOW() + 1 year` do INSERT
 * aqui produziria 23514 em toda concessão com mais de alguns meses.
 *
 * O TETO DO PAI é o mesmo do INSERT e pela mesma razão: filho nunca sobrevive a quem o
 * autorizou. Ele é lido da linha do pai qualquer que seja o estado dela — o pai revogado
 * ou vencido também limita, o que é a direção conservadora.
 *
 * NÃO DESCE APARO PELA SUBÁRVORE, e não precisa: esta escrita só move a data para
 * FRENTE (o serviço recusa pedido que não passe do prazo atual), e todo filho já estava
 * clampado no prazo ANTIGO, que é menor. A invariante "filho nunca expira depois do pai"
 * sobrevive por construção. Encurtar quebraria isso em silêncio, e é por isso que
 * encurtar não é uma operação desta rota.
 *
 * O `WHERE` COBRA A VIDA DA LINHA, e não só o id: uma concessão revogada que aceitasse
 * extensão seria uma revogação desfeita por uma rota de prazo, e uma vencida
 * ressuscitaria acesso que o predicado já tinha matado. Zero linha é a resposta para as
 * duas, e o serviço a traduz depois de ler o motivo.
 *   $1 = id da concessão, $2 = prazo pedido (timestamptz)
 */
export const EXTEND_GRANT = `
  UPDATE resource_grants g
     SET expires_at = LEAST(
           $2::timestamptz,
           g.created_at + INTERVAL '1 year',
           COALESCE((SELECT p.expires_at FROM resource_grants p WHERE p.id = g.parent_grant_id),
                    'infinity'::timestamptz)
         )
   WHERE g.id = $1::uuid
     AND g.revoked_at IS NULL
     AND g.expires_at > NOW()
   RETURNING g.id, g.resource_type, g.resource_id, g.grantee_id, g.grantee_group_id,
             g.grant_level, g.parent_grant_id, g.created_at, g.expires_at
`;

/**
 * A(s) concessão(ões) VIVA(S) de um ator sobre um recurso, do nível mais alto
 * para o mais baixo. É a fonte do `parent_grant_id` de uma concessão nova e do
 * gate `requireResourceShare`.
 *
 * D3: pode devolver mais de uma linha, de propósito — a estrutura é um DAG. O
 * chamador escolhe a de maior nível, e é isso que faz `view_share` em QUALQUER
 * concessão viva bastar para compartilhar adiante.
 *
 * "VIVA" PASSOU A INCLUIR O PRAZO. Sem `expires_at > NOW()` aqui, quem já não VÊ o
 * recurso (o predicado de leitura mora em `fn_granted_resource_ids`, que conhece o
 * prazo) continuaria podendo REPASSÁ-LO: o gate `requireResourceShare` se alimenta
 * desta consulta, e a concessão nova nasceria pendurada num pai morto.
 *
 * `expires_at` viaja no SELECT porque o INSERT do filho o usa como TETO.
 *
 * O BRAÇO DE GRUPO ENTROU EM 2026-08-19, e sem ele a concessão a grupo seria de
 * segunda classe: quem recebe `view_share` ATRAVÉS de um grupo veria o recurso (o
 * predicado de leitura, `fn_granted_resource_ids`, sempre teve o braço de grupo) e
 * não conseguiria repassá-lo, porque o gate `requireResourceShare` se alimenta desta
 * consulta e ela só olhava `grantee_id`. Os dois níveis significariam a mesma coisa
 * para o membro de grupo, que é justamente a distinção que a fase F3 existe para
 * manter.
 *
 * `fn_user_group_ids` já exige grupo VIVO (`deleted_at IS NULL`), então apagar o
 * grupo tira o repasse na mesma leitura em que tira a visão — não há aqui uma segunda
 * cópia da regra de "grupo apagado não concede".
 *
 * `grantee_group_id` viaja no SELECT porque o serviço precisa dele para recusar o
 * caso degenerado: conceder AO MESMO grupo de onde a própria autoridade veio.
 *
 * D8(b) ENTROU AQUI EM 2026-08-21, E O BURACO QUE ELE FECHA FOI MEDIDO, NÃO DEDUZIDO.
 * Quando `fn_granted_resource_ids` passou a exigir `fn_principal_vivo(g.granted_by)`, o
 * predicado de LEITURA e este gate de ESCRITA deixaram de concordar, e a diferença era
 * para o lado aberto. Medido contra o PostgreSQL real: admin dá `view_share` a A, A dá
 * `view_share` a B, a OM de A é desativada. B deixa de VER o recurso (`visible` não o
 * traz) e mesmo assim `POST .../grants` de B devolvia **201**, e o beneficiário novo
 * PASSAVA A VER — porque a linha nova nasce com `granted_by = B`, que está vivo. Ou
 * seja, a transitividade que D8(b) existe para fechar era reaberta pela porta da
 * escrita, e bastava o beneficiário devolver o repasse para o próprio B voltar a ver.
 *
 * REPARE QUE O CONCEDENTE MORTO NÃO PRECISA DESTE TERMO PARA SI: quem tem a conta ou a
 * OM desativada é barrado no `auth` (reconciliação ao vivo), então ele não chega a rota
 * nenhuma. Quem precisava do termo é o BENEFICIÁRIO VIVO de uma autoridade morta, que
 * autentica normalmente. Foi por isso que a primeira medição (o próprio concedente
 * tentando repassar) devolveu 403 e quase enterrou o achado: o sujeito estava errado.
 *
 * O TERMO É O MESMO DO RESGATE (`REVOKE_SUBTREE_PRESERVING_REACH`, decisão 4) e o mesmo
 * de `LIST_SHAREABLE_OF_ACTOR`. Os três precisam continuar concordando: esta consulta
 * decide se o servidor ACEITA a escrita, aquela decide se a interface OFERECE o botão, e
 * o resgate decide o que a poda mantém de pé. Um `granted_by` NULO passa (concessão sem
 * concedente não tem com quem morrer, e é a forma que os testes de função inserem).
 *   $1 = grantee_id (o ator), $2 = resource_type, $3 = resource_id
 */
export const LIVE_GRANTS_OF_ACTOR = `
  SELECT id, grant_level, expires_at, grantee_id, grantee_group_id
    FROM resource_grants
   WHERE revoked_at IS NULL
     AND expires_at > NOW()
     AND resource_type = $2 AND resource_id = $3
     AND (granted_by IS NULL OR fn_principal_vivo(granted_by))
     AND ( grantee_id = $1::uuid
        OR grantee_group_id IN (SELECT group_id FROM fn_user_group_ids($1::uuid)) )
   ORDER BY (grant_level = 'view_share') DESC, created_at
`;

/**
 * A concessão VIVA que ESTE ator já deu a ESTE beneficiário sobre este recurso.
 *
 * Existe para recusar a segunda concessão IDÊNTICA (mesmo concedente, mesmo
 * beneficiário) sem ferir D3: o que D3 protege é a concessão de OUTRO concedente,
 * que carrega informação (dois caminhos independentes de acesso, e revogar um não
 * derruba o outro). Duas linhas do MESMO concedente não carregam nada, e a
 * segunda só cria uma subárvore irmã que a revogação da primeira não alcança —
 * ou seja, um jeito silencioso de tornar a própria revogação incompleta.
 *
 * O PRAZO ENTRA AQUI PARA QUE A RENOVAÇÃO SEJA POSSÍVEL. Uma concessão EXPIRADA
 * continua com `revoked_at IS NULL`, então sem `expires_at > NOW()` o concedente
 * levaria 409 "já recebeu acesso de você" sobre um acesso que não existe mais — um
 * beco sem saída da mesma classe do id de catálogo soft-deletado.
 *   $1 = granted_by, $2 = grantee_id, $3 = resource_type, $4 = resource_id
 */
export const LIVE_GRANT_FROM_ACTOR_TO_GRANTEE = `
  SELECT id, grant_level FROM resource_grants
   WHERE revoked_at IS NULL
     AND expires_at > NOW()
     AND granted_by = $1::uuid AND grantee_id = $2::uuid
     AND resource_type = $3 AND resource_id = $4
   LIMIT 1
`;

/**
 * O IRMÃO DE GRUPO da consulta acima, e ele precisa ser uma consulta SEPARADA em vez
 * de um `COALESCE` sobre as duas colunas: `grantee_id` e `grantee_group_id` são
 * ALTERNATIVOS por CHECK, então numa linha de grupo o `grantee_id` é NULL, e
 * `grantee_id = $2` com $2 nulo é NULL — nunca verdadeiro. Uma consulta única
 * parametrizada pelos dois devolveria zero linha sempre, e o efeito seria a duplicata
 * passar: o 409 sumiria em silêncio, que é o pior formato deste defeito.
 *   $1 = granted_by, $2 = grantee_group_id, $3 = resource_type, $4 = resource_id
 */
export const LIVE_GRANT_FROM_ACTOR_TO_GROUP = `
  SELECT id, grant_level FROM resource_grants
   WHERE revoked_at IS NULL
     AND expires_at > NOW()
     AND granted_by = $1::uuid AND grantee_group_id = $2::uuid
     AND resource_type = $3 AND resource_id = $4
   LIMIT 1
`;

/** Um usuário ATIVO por id (o beneficiário precisa existir antes do INSERT). $1 = id. */
export const GET_ACTIVE_USER = `
  SELECT id, username, nome FROM users WHERE id = $1::uuid AND is_active = true
`;

/**
 * Um grupo VIVO por id que ESTE ator pode ENDEREÇAR como beneficiário.
 *
 * `deleted_at IS NULL` e não só o id: a FK aceitaria um grupo apagado, e a concessão
 * nasceria morta — `fn_user_group_ids` exige grupo vivo, então ela não devolveria
 * linha para ninguém e a tela mostraria um acesso concedido que não existe.
 *
 * `fn_can_administer_group` É O QUE DÁ DENTES À REGRA DO COLETIVO PRÓPRIO. Restringir
 * só a LISTAGEM de grupos seria obscuridade: o id viaja no corpo do POST, e um
 * chamador que o adivinhe (ou que o tenha visto antes, quando a listagem era aberta)
 * continuaria concedendo a um grupo alheio. E conceder a um coletivo que outra pessoa
 * compõe é delegar a ela o poder de acrescentar beneficiários ao SEU recurso sem
 * passar por você.
 *
 * ZERO LINHA VIRA 404, nunca 403, e as duas causas são indistinguíveis de propósito:
 * "não existe" e "não é seu" precisam ter a mesma resposta, senão a recusa confirma a
 * existência de um grupo que a listagem esconde.
 *   $1 = id do grupo, $2 = o ator
 */
export const GET_ADDRESSABLE_LIVE_GROUP = `
  SELECT id, name, owner_id FROM access_groups
   WHERE id = $1::uuid AND deleted_at IS NULL
     AND fn_can_administer_group($2::uuid, id)
`;

/**
 * As concessões VIVAS feitas AO GRUPO $1 — as RAÍZES da poda que a exclusão do grupo
 * dispara.
 *
 * Devolve só ids, porque quem sabe podar é `podarPorRaizes`: a semântica de
 * descendência tem UMA definição, e escrever um `WITH RECURSIVE` próprio dentro do
 * módulo de grupo seria a segunda.
 *   $1 = group_id
 */
export const LIVE_GRANT_IDS_TO_GROUP = `
  SELECT id, resource_type, resource_id FROM resource_grants
   WHERE grantee_group_id = $1::uuid AND revoked_at IS NULL
   ORDER BY resource_type, resource_id, id
`;

/**
 * As concessões VIVAS que ESTA pessoa fez ALIMENTADA POR ESTE GRUPO — as raízes da
 * poda que a saída de um membro dispara.
 *
 * SEGUIR A ARESTA `parent_grant_id` É A DEFINIÇÃO PRECISA de "o que ele repassou por
 * este grupo", e é o que separa este conjunto de "tudo o que ele concedeu". Quem tem
 * também uma concessão PESSOAL `view_share` sobre o mesmo recurso repassou por
 * autoridade própria, e esse repasse não cai quando ele sai do grupo: a justificativa
 * dele continua de pé.
 *
 * AS RAÍZES DAQUI SÃO AS ÚNICAS DO SISTEMA QUE PODEM SER RESGATADAS (2026-08-21). Elas
 * chegam a `podarPorRaizes` com `resgatarRaiz: true`, porque quem sai de um grupo não
 * mandou revogar concessão nenhuma: mandou fechar um CAMINHO. O efeito é que o repasse
 * cujo autor tem `view_share` próprio VIVO sobre o MESMO recurso é RE-PENDURADO nele em
 * vez de revogado, que é o desfecho que `deleteGroup` já dava para o mesmo fato. Ver a
 * decisão (1) de `REVOKE_SUBTREE_PRESERVING_REACH`. Repare que este SELECT continua sendo
 * o mesmo: a autoridade própria não muda quais linhas são raiz, só o que acontece com
 * elas.
 *   $1 = o membro que saiu, $2 = o grupo
 */
export const GRANT_IDS_FED_BY_MEMBER_VIA_GROUP = `
  SELECT g.id, g.resource_type, g.resource_id
    FROM resource_grants g
    JOIN resource_grants pai ON pai.id = g.parent_grant_id
   WHERE g.revoked_at IS NULL
     AND g.granted_by = $1::uuid
     AND pai.grantee_group_id = $2::uuid
   ORDER BY g.resource_type, g.resource_id, g.id
`;

/**
 * Insere uma concessão.
 *
 * O PRAZO É CALCULADO AQUI, NO MESMO STATEMENT DA ESCRITA, e não no JS. Três tetos
 * incidem sobre ele e o `LEAST` os aplica todos de uma vez:
 *   - o pedido do concedente (`$7`), ou um ano quando ele não pediu nada;
 *   - o TETO DA CASA (um ano), que o CHECK da tabela também cobra — calculá-lo com
 *     o `NOW()` do banco é o que impede um relógio de cliente adiantado de virar
 *     23514 (`Value violates a constraint`) em vez de uma data válida;
 *   - o prazo do PAI (`$8`, nulo na concessão de raiz), porque filho nunca pode
 *     sobreviver a quem o autorizou. `'infinity'` é o neutro do LEAST para a raiz.
 * `GREATEST` não aparece: o piso (`expires_at > created_at`) é cobrado na borda.
 *
 * O BENEFICIÁRIO SÃO DOIS PARÂMETROS E EXATAMENTE UM DELES É NÃO-NULO, o que o
 * `CHECK (num_nonnulls(grantee_id, grantee_group_id) = 1)` cobra. A borda (o `xor` do
 * Joi) recusa antes, para que o pedido malformado volte como 422 com nome de campo em
 * vez do 23514 genérico em que o CHECK se traduz — mas o CHECK continua sendo quem
 * garante, porque INSERT cru existe (os testes de função escrevem direto na tabela).
 *   $1..$4 = tipo, recurso, beneficiário-pessoa, nível
 *   $5, $6 = concedente, pai
 *   $7 = prazo pedido (timestamptz|null), $8 = prazo do pai (timestamptz|null)
 *   $9 = beneficiário-grupo
 */
export const INSERT_GRANT = `
  INSERT INTO resource_grants
    (resource_type, resource_id, grantee_id, grant_level, granted_by, parent_grant_id, expires_at,
     grantee_group_id)
  VALUES ($1, $2, $3::uuid, $4, $5::uuid, $6::uuid,
          LEAST(
            COALESCE($7::timestamptz, NOW() + INTERVAL '1 year'),
            NOW() + INTERVAL '1 year',
            COALESCE($8::timestamptz, 'infinity'::timestamptz)
          ),
          $9::uuid)
  RETURNING id, resource_type, resource_id, grantee_id, grantee_group_id, grant_level, granted_by,
            parent_grant_id, created_at, expires_at
`;

/**
 * Uma concessão por id, viva ou não (para o gate de revogação e para a extensão de
 * prazo). $1 = id.
 *
 * `expires_at` e `created_at` entraram com a extensão de prazo, e é ela quem os lê: o
 * primeiro para recusar o pedido que não passa do prazo atual, o segundo para a mensagem
 * de recusa poder dizer QUAL é o orçamento da linha. Não há uma segunda leitura da mesma
 * linha para isso — dois SELECTs sobre a mesma concessão dentro de uma requisição são
 * duas respostas possíveis para a mesma pergunta.
 */
export const GET_GRANT = `
  SELECT id, resource_type, resource_id, grantee_id, grantee_group_id, grant_level, granted_by,
         parent_grant_id, revoked_at, expires_at, created_at
    FROM resource_grants WHERE id = $1::uuid
`;

/**
 * SERIALIZA AS PODAS DO MESMO RECURSO. $1 = resource_type, $2 = resource_id.
 *
 * A janela que este lock fecha foi CRIADA pela preservação de alcançabilidade: antes,
 * duas revogações concorrentes só se ignoravam (cada uma escrevia `revoked_at` no seu
 * pedaço); agora uma delas pode ESCOLHER como pai novo uma concessão que a outra está
 * derrubando no snapshot dela, e o filho sobreviveria pendurado num pai já revogado.
 * `fn_granted_resource_ids` nunca olha o pai, então esse filho continuaria ENTREGANDO
 * acesso — ou seja, o desenho trocaria um defeito determinístico (D cai sem precisar)
 * por um probabilístico (D sobrevive sem dever), que é a classe pior.
 *
 * A CHAVE É POR (TIPO, RECURSO) e não global: a árvore de uma poda vive inteira dentro
 * de um recurso (o `LATERAL` do resgate casa `resource_type`/`resource_id`), então duas
 * podas de recursos diferentes não podem se cruzar, e uma chave global transformaria a
 * revogação do sistema inteiro numa fila.
 *
 * `pg_advisory_xact_lock` e não `pg_advisory_lock`: ele é solto no fim da transação, sem
 * `unlock` explícito. Um lock de sessão vazaria para a próxima requisição servida pela
 * mesma conexão do pool, e o vazamento só apareceria sob carga.
 *
 * O SEPARADOR ':' NÃO PRECISA SER INJETIVO aqui, e é bom saber por quê: uma colisão de
 * hash entre dois recursos distintos custa serialização desnecessária, nunca correção.
 * Falso positivo é lento; falso negativo seria o defeito. Por isso `hashtextextended`
 * (64 bits, disponível desde o PostgreSQL 11) em vez do par de `int4`.
 */
export const LOCK_RESOURCE_GRANTS = `
  SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0)) AS ok
`;

/**
 * As concessões VIVAS feitas POR esta pessoa — as raízes da poda que a DESATIVAÇÃO da
 * conta dela dispara (D8(b): a autoridade morre com quem a exercia).
 *
 * SÃO TODAS, e não só as de RAIZ, embora a decisão do dono fale em raiz. O motivo é que
 * a raiz não é a única forma de a autoridade sobreviver ao concedente: quem recebeu
 * `view_share` de terceiro e repassou fez uma concessão COM pai, e desativar a conta
 * dele não derruba o repasse por nenhum outro caminho — o pai continua vivo, e o
 * predicado de leitura confere a vida do BENEFICIÁRIO. Restringir a `parent_grant_id IS
 * NULL` fecharia o caso do administrador e deixaria aberto o do usuário comum, que é o
 * mesmo buraco com outro sujeito.
 *
 * `ORDER BY resource_type, resource_id, id` é contrato com `podarPorRaizes`: ela toma um
 * lock consultivo por recurso, e a ordem é o que impede duas desativações concorrentes
 * de se travarem mutuamente.
 *   $1 = a pessoa que está sendo desativada
 */
export const LIVE_GRANT_IDS_BY_GRANTER = `
  SELECT id, resource_type, resource_id FROM resource_grants
   WHERE granted_by = $1::uuid AND revoked_at IS NULL
   ORDER BY resource_type, resource_id, id
`;

/**
 * QUANTAS concessões vivas cada pessoa deu, agregadas de uma vez. É a MESMA pergunta de
 * `LIVE_GRANT_IDS_BY_GRANTER`, contada em vez de listada, e por isso mora ao lado dela: o
 * predicado de "concessão viva feita por" tem UMA definição, e reescrever o
 * `granted_by ... AND revoked_at IS NULL` no módulo consumidor seria a segunda cópia, que
 * é a que envelhece quando a coluna mudar.
 *
 * QUEM PRECISA DISSO É A TELA DE ADMINISTRAÇÃO DE USUÁRIOS. Trocar o papel global, ou a OM
 * produtora, de quem concedeu acesso DERRUBA o que essa pessoa concedeu
 * (`fundamentoDeRaizPerdido` + `podarPorRaizes`), e a aba precisa dizer QUANTAS concessões
 * o salvamento vai revogar ANTES do clique. A listagem de usuários pendura esta consulta
 * como subconsulta juntável, exatamente como a listagem de grupos já carrega `grant_count`.
 *
 * FRAGMENTO SEM `ON`, de propósito: a condição de junção é do consumidor (ele é quem sabe o
 * apelido da sua tabela de usuários), e a alternativa (embutir `ON lg.granted_by = u.id`
 * aqui) amarraria este arquivo ao apelido de quem chama.
 *
 * UM AGREGADO, NÃO UM ESCALAR CORRELACIONADO: `resource_grants` não tem índice por
 * `granted_by` (os quatro de `008_acesso_a_recurso.sql` são por beneficiário, por recurso e
 * por pai), então uma subconsulta por linha seria uma varredura por usuário listado.
 *
 * `::int` porque `COUNT` é bigint e o driver o devolve como STRING, e um plural escolhido
 * com `n === 1` lê "1 concessões" no instante em que o valor chega como `'1'`.
 */
export const LIVE_GRANT_COUNT_BY_GRANTER = `
  SELECT granted_by, COUNT(*)::int AS n
    FROM resource_grants
   WHERE revoked_at IS NULL
   GROUP BY granted_by
`;

/**
 * PODA A SUBÁRVORE DE $1 PRESERVANDO ALCANÇABILIDADE, num statement só.
 *
 * Ela substituiu uma consulta chamada REVOKE_GRANT_SUBTREE, que só revogava. O nome
 * mudou porque a consulta passou a ESCREVER `parent_grant_id` e `expires_at`, e um nome
 * que só diz REVOKE esconde as outras duas escritas.
 *
 * A REGRA NOVA É A DECISÃO D3 DO DONO: "se B não caiu, D não deve cair". Ao descer a
 * subárvore, um filho cujo CONCEDENTE ainda tenha `view_share` vivo sobre o MESMO
 * recurso, fora do alcance da poda, é RE-PENDURADO nesse outro pai em vez de revogado. O
 * que a poda derruba deixou de ser "tudo que pende" e passou a ser "o que perdeu TODA
 * autorização".
 *
 * SEIS DECISÕES QUE O SQL NÃO CONTA SOZINHO:
 *
 * (1) A ÂNCORA NÃO É RESGATADA, A MENOS QUE O CHAMADOR PEÇA (`$3`). Por default
 *     (`$3 = false`) valem o `a.id <> $1` de `resgate` e o `pai_antigo IN podados` de
 *     `salvos`, e a revogação explícita sempre tem efeito: se a âncora pudesse ser
 *     resgatada sempre, revogar a concessão de alguém que tem outro caminho vivo seria um
 *     no-op com 200 na resposta.
 *
 *     O MODO EXISTE PORQUE NEM TODO CHAMADOR ESTÁ REVOGANDO. Os chamadores de
 *     `podarPorRaizes` se dividem em dois grupos, que só agora ficaram distinguíveis (a
 *     lista viva sai de um grep pelo nome, e não desta prosa, que já a contou a menos).
 *     No PRIMEIRO grupo (revogar uma concessão, apagar um grupo, desativar uma conta pela
 *     origem `USER_DELETE`, rebaixar o papel de alguém pela origem `USER_DEMOTION`) a
 *     âncora é PRECISAMENTE o que se mandou derrubar. No SEGUNDO (tirar um membro do grupo) não se
 *     mandou derrubar concessão nenhuma: o que caiu foi um CAMINHO, a participação no
 *     grupo, e as âncoras que aquele chamador passa são os REPASSES DO MEMBRO — linhas que
 *     ninguém pediu para revogar e que só estão ali por serem o ponto em que o caminho
 *     morto toca a árvore. Para elas a pergunta certa é a mesma que a subárvore inteira já
 *     responde: quem concedeu ainda tem `view_share` vivo sobre este recurso? Se tem, o
 *     repasse é RE-PENDURADO nesse outro caminho em vez de revogado.
 *
 *     ISSO É A CONVERGÊNCIA DECIDIDA PELO DONO EM 2026-08-21, e ela fecha uma divergência
 *     que o serviço de grupo descrevia por extenso como conhecida: o membro com autoridade
 *     PRÓPRIA sobre o mesmo recurso MANTINHA o repasse quando o grupo era apagado (lá o
 *     repasse dele é DESCENDENTE da coletiva, logo resgatável) e PERDIA quando era retirado
 *     do grupo (aqui ele é a âncora). Dois atos com o mesmo significado (o membro deixou de
 *     alcançar o recurso PELO grupo) davam desfechos opostos para o mesmo fato. A cláusula
 *     3.7 da constituição — "se B não caiu, o que B concedeu não cai" — decide para o lado
 *     de MANTER, e é o que `$3 = true` implementa.
 *
 *     A ALTERNATIVA RECUSADA foi não tocar nesta consulta e fazer o chamador passar OUTRAS
 *     raízes: a concessão COLETIVA em vez dos repasses do membro. Ela é errada e o erro é
 *     grande: a coletiva viraria a âncora e seria REVOGADA, isto é, tirar UM membro
 *     equivaleria a apagar o grupo para TODO MUNDO. A variante "coletiva restrita ao
 *     membro" precisaria de um filtro na travessia MAIS uma isenção de âncora, ou seja
 *     estritamente mais mudança nesta CTE do que o parâmetro. E a variante em JS (o
 *     chamador conferir antes se o membro tem `view_share` próprio e, se tiver, não podar)
 *     seria uma SEGUNDA definição do predicado de resgate fora do SQL, e ainda deixaria o
 *     repasse pendurado na coletiva: uma revogação futura daquela concessão pessoal não o
 *     alcançaria, porque a aresta continuaria apontando para o grupo. Repai é escrita, e
 *     escrita mora aqui.
 *
 *     O MODO ALCANÇA SÓ AS RAÍZES ORIGINAIS, nunca as reenfileiradas pela `fronteira`
 *     (ver a decisão 2): um nó de fronteira é um descendente cuja cadeia de justificativa
 *     JÁ caiu, e acima do teto de 32 o desenho é fail-closed de propósito. Na prática a
 *     combinação nem ocorre — quando a âncora é resgatada, `podados` fica VAZIO e não há
 *     fronteira —, mas `podarPorRaizes` carimba `false` nas reenfileiradas de qualquer
 *     forma, para que a propriedade não dependa dessa coincidência.
 *
 *     AS DUAS CLÁUSULAS DO MODO SÃO A MESMA CONDIÇÃO, escrita duas vezes de propósito: a
 *     âncora sai de `podados` (`NOT ($3 AND EXISTS resgate com novo_pai)`) exatamente
 *     quando entra em `salvos` (`$3 AND r.id = $1`). Escrever uma delas sem gate, contando
 *     com o `a.id <> $1` de `resgate` para torná-la vácua, faria o par se desacoplar em
 *     silêncio no dia em que aquele filtro mudasse — e o desfecho seria uma âncora que não
 *     cai e também não é re-pendurada, isto é, uma linha viva apontando para um pai
 *     revogado, que é o fail-OPEN que a decisão 2 acabou de fechar.
 *
 *     SAIBA QUE NENHUM TESTE PRENDE ESTAS DUAS LINHAS, e a razão é o que as torna
 *     necessárias. Medido em 2026-08-21: removendo AS DUAS, a suíte inteira continua
 *     VERDE, porque a âncora passa a cair em `podados` E em `salvos`, e o segundo
 *     `UPDATE` da mesma linha no mesmo statement não a toca — hoje `revogados` vem
 *     primeiro e vence. Isso não é garantia: o manual diz que o resultado de duas CTEs
 *     modificadoras sobre a mesma linha é IMPREVISÍVEL, não "a primeira ganha". As duas
 *     linhas existem para que o desfecho seja DECIDIDO em vez de acidental, e o modo de
 *     falha que elas evitam é não-determinismo, que nenhum verde distingue do correto.
 *     Não as remova porque "o teste não muda de cor".
 *
 *     MAS SAIBA QUE `pai_antigo IN podados` FAZ SERVIÇO DUPLO, e só UM dos dois papéis
 *     está sem guarda. Além de travar a âncora, é ele que mantém `salvos` na FRONTEIRA da
 *     poda, e esse papel é o passo 2 da prova de disjunção da decisão (5) — coberto pelo
 *     caso da trilha. Quem ler só o parágrafo acima pode concluir que a linha inteira é
 *     livre para simplificar; não é.
 *
 * (2) O CICLO CONTINUA IMPOSSÍVEL, e esta é a primeira escrita de `parent_grant_id` fora
 *     do INSERT — o argumento antigo ("nenhuma rota expõe UPDATE dele") deixou de valer e
 *     precisa ser substituído, não repetido. A prova: todo descendente VIVO de um nó de
 *     `alcance` está em `alcance`, porque a travessia é exatamente a relação
 *     `parent_grant_id` restrita a `revoked_at IS NULL`. O pai novo é escolhido com
 *     `NOT EXISTS (... alcance ...)`, logo ele NÃO é descendente do nó que está sendo
 *     re-pendurado, logo a aresta nova não fecha ciclo. A implicação só vale se a
 *     travessia não foi TRUNCADA pelo teto de 32 (uma travessia truncada não contém
 *     todos os descendentes), e é por isso que `teto.truncado` desliga o resgate inteiro
 *     nesse caso — fail-closed, degradando para o comportamento anterior. Quem escrever o
 *     SEGUNDO UPDATE desta coluna precisa repetir esta prova; sem ela, o teto de 32 vira
 *     a única barreira entre um ciclo e um laço.
 *
 *     A PROVA REFEITA PARA A ÂNCORA RESGATADA (`$3 = true`, 2026-08-21). O `UPDATE` de
 *     `parent_grant_id` continua sendo UM SÓ (`repaiados`); o que mudou foi o CONJUNTO que
 *     o alimenta, que passou a poder conter a âncora — e um conjunto novo exige a prova de
 *     novo, porque a prova é sobre os elementos, não sobre a escrita. Ela vale, e para a
 *     âncora é o caso mais apertado dos dois: `alcance` é enraizado EM `$1`, então o
 *     conjunto é exatamente a subárvore viva da âncora, nem mais nem menos. O pai novo sai
 *     do `LATERAL` com `NOT EXISTS (SELECT 1 FROM alcance x WHERE x.id = p.id)`, logo está
 *     FORA dessa subárvore, logo não é descendente vivo da âncora; e `p.id <> g.id` impede
 *     o laço de tamanho um. A aresta nova (âncora → pai novo) portanto não fecha ciclo. As
 *     duas condições de contorno da prova geral seguem as mesmas: ela depende de a
 *     travessia não ter sido truncada, e `resgate` continua exigindo `teto.truncado =
 *     false` para TODA linha, âncora inclusive — no modo `$3` o truncamento desliga o
 *     resgate da âncora junto com o do resto, e ela volta a cair. Medida (e não só
 *     afirmada) por `assertSemCiclo` depois de cada poda dos casos de convergência em
 *     `tests/integration/access-groups-exclusao-cascata.test.js`.
 *
 *     "FAIL-CLOSED" AQUI VALE SÓ PARA O RESGATE, e a PODA era o contrário até 2026-08-21.
 *     A poda também trunca em 32 (`podados` tem o mesmo `depth < 32`), então numa cadeia
 *     de 33 elos a revogação da raiz derrubava 32 e DEIXAVA O 33º VIVO, pendurado num pai
 *     revogado — e como `fn_granted_resource_ids` nunca sobe a cadeia de
 *     `parent_grant_id`, essa pessoa continuava com acesso depois de a raiz inteira ter
 *     caído. Era fail-OPEN e era HERDADO (a `REVOKE_GRANT_SUBTREE` anterior tinha o mesmo
 *     teto). O conserto NÃO foi aumentar o teto, que só move a fronteira: é a CTE
 *     `fronteira` devolver as linhas que ficaram penduradas em pai revogado, na ação
 *     `frontier`, e `podarPorRaizes` reenfileirá-las como raízes novas até a lista
 *     esvaziar. Reenfileirar, e não recusar: recusar deixaria a raiz concedida E a
 *     operação falhando, que é o pior dos dois mundos para uma revogação.
 *
 *     A DEGRADAÇÃO QUE SOBRA É DE RESGATE, NÃO DE PODA, e ela é deliberada: acima de 32
 *     níveis `teto.truncado` já desligava o resgate, então os elos da primeira janela caem
 *     sem chance de repai. Trocar acesso a mais por acesso a menos é a direção certa para
 *     uma revogação.
 *
 *     `heranca` TEM O MESMO TETO E NUNCA PODE TRUNCAR, e a prova evita um segundo laço:
 *     ela parte de `salvos`, que é vazio quando `teto.truncado`; logo ela só roda com
 *     `alcance` inteiro, e aí todo descendente vivo está a no máximo 32 do ALVO, portanto
 *     a no máximo 32 - d + 1 de um resgatado em profundidade d. A margem foi refeita para
 *     `d = 1`, que a âncora resgatável (`$3`) tornou possível e antes não era: `truncado =
 *     false` quer dizer que NENHUMA linha de `alcance` tem `depth >= 32`, logo a mais funda
 *     está em 31, logo a cadeia de `heranca` a partir da âncora tem no máximo 31 elos,
 *     dentro do `h.depth < 32` do braço recursivo. Continua sem poder truncar.
 *
 * (3) O PAI NOVO PODE ESTAR DENTRO DA PODA, e aí NÃO há resgate: é o caso de C→B
 *     pendurado em B→C. Excluí-lo é conservador de propósito — um resgate cujo único pai
 *     alternativo é ele mesmo resgatado seria um ponto fixo, e ponto fixo em CTE é laço.
 *     A degradação é revogar, que era o comportamento de antes.
 *
 * (4) O PAI NOVO PRECISA SER `view_share` VIVO, NÃO VENCIDO E DE CONCEDENTE VIVO, que é
 *     exatamente o predicado que `grantResource` cobra para ACEITAR uma concessão nova (o
 *     último termo é o D8(b) que `fn_granted_resource_ids` passou a cobrar). O resgate só
 *     mantém de pé o que uma concessão nova receberia hoje; qualquer relaxamento aqui
 *     inventa autorização que a escrita recusaria.
 *
 *     ESSA FRASE FOI ESCRITA ANTES DE SER VERDADE, e o conserto veio depois dela. Quando
 *     ela foi escrita, `LIVE_GRANTS_OF_ACTOR` — o gate de que `grantResource` de fato se
 *     alimenta — NÃO tinha o termo de concedente vivo, então o resgate era mais estreito
 *     que a escrita e a afirmação de simetria era falsa. Medido: o beneficiário de uma
 *     autoridade morta repassava com 201 e o novo beneficiário via o recurso. O termo
 *     entrou nas duas consultas de ator, e a simetria virou fato; o teste
 *     "quem perdeu leitura por D8(b) não consegue REPASSAR" é o que a prende. Cuidado
 *     com o que se afirma aqui: um docblock de autorização é lido como especificação.
 *
 * (5) TRÊS `UPDATE` NO MESMO STATEMENT SÓ SÃO LEGAIS PORQUE OS CONJUNTOS SÃO DISJUNTOS, e
 *     esta é a propriedade que sustenta a consulta inteira: o Postgres NÃO levanta erro
 *     quando duas CTEs modificadoras tocam a mesma linha, ele dá resultado imprevisível.
 *     A prova, em três passos: `podados` nunca desce por um nó resgatado (o
 *     `NOT EXISTS (... resgate ...)` no braço recursivo), e como a ÚNICA forma de um nó
 *     entrar em `podados` é descendo por essa aresta (a âncora é `$1`, que o resgate
 *     nunca alcança pela decisão 1), `podados ∩ salvos = ∅`; `salvos` exige
 *     `pai_antigo IN podados`, o que o mantém na fronteira e não dentro; e `aparar` é
 *     `heranca` com `depth > 1`, logo nunca um `salvo` (que é `depth = 1`) e nunca
 *     alcançável por `podados`, que não desceu pelo salvo. A GUARDA desta prova é o teste
 *     de trilha: EXATAMENTE UMA linha de auditoria por concessão tocada, somando as três
 *     listas. Um nó em dois conjuntos ganha duas linhas e o caso fica vermelho.
 *
 *     COM `$3 = true` E A ÂNCORA RESGATADA A PROVA FICA TRIVIAL, e vale escrever por quê,
 *     porque o desenho muda de forma: a base de `podados` é só a âncora (`alcance` com
 *     `depth = 1`), então excluí-la deixa `podados` VAZIO — o braço recursivo não tem de
 *     onde descer. Logo `revogados` não toca linha nenhuma, `salvos` é exatamente a âncora
 *     (nenhum outro nó satisfaz `pai_antigo IN podados`, que é o conjunto vazio), e
 *     `aparar` é `heranca` com `depth > 1`, isto é, descendentes ESTRITOS da âncora, nunca
 *     ela. Os três conjuntos continuam disjuntos, agora com um deles vazio. Nada muda
 *     quando a âncora NÃO é resgatada: aí ela está em `podados` como sempre esteve.
 *
 * (6) O PAI NOVO É O DE MAIOR PRAZO (`ORDER BY p.expires_at DESC`), não o mais antigo:
 *     ele minimiza o aparo. O desempate por `created_at, id` existe para o resultado ser
 *     determinístico entre execuções.
 *
 * O PRAZO DO FILHO É APARADO PARA O TETO DO PAI NOVO (`LEAST`), nunca esticado, e o aparo
 * DESCE pela subárvore do resgatado (`heranca`). A invariante "filho não vive mais que o
 * pai" era garantida só pelo `LEAST` do INSERT; como esta é a primeira mudança de pai
 * fora dele, sem a cascata de aparo a invariante quebraria em silêncio. A alternativa
 * (RECUSAR o repai quando o pai novo vence antes) foi rejeitada porque faria D cair no
 * caso exato em que B não caiu, que é o contrário da decisão — e porque o repositório já
 * tem o precedente escrito em `grantResource`: entregar o que dá para entregar e dizer,
 * na resposta e na auditoria, até quando vale.
 *
 * O PREÇO, e ele é real: o aparo ENCURTA acesso de terceiros que não participaram da
 * revogação (a subárvore do resgatado). A trilha (`PERMISSION_REPARENT` com
 * `kind: 'prazo_herdado'`) é o único lugar onde isso aparece.
 *
 * `revoked_at IS NULL` NOS DOIS BRAÇOS DE `alcance`, cada um por uma razão diferente: no
 * âncora ele torna a operação idempotente (revogar duas vezes não reescreve a data, e a
 * data da PRIMEIRA revogação é a que vale para auditoria); no braço recursivo ele impede
 * que a poda atravesse uma concessão JÁ revogada.
 *
 * NÃO troque `UNION ALL` por `UNION` "por segurança": ele deduplica por linha inteira,
 * não impede ciclo, e como cada linha carrega `depth` ele nem deduplicaria.
 *
 * O RETURNING É O PRODUTO, em QUATRO classes: quem caiu, quem mudou de origem, quem só
 * teve o prazo herdado, e a `frontier` — que não é resultado, é TRABALHO QUE SOBROU, e
 * existe para o chamador reenfileirar em vez de parar no meio calado. Um DELETE em cascata devolveria só a raiz, e "por que Fulano
 * perdeu acesso" — e agora também "por que Fulano MANTEVE" — ficaria sem resposta.
 *   $1 = grant id (a âncora), $2 = revoked_by, $3 = resgatar a âncora (ver a decisão 1)
 */
export const REVOKE_SUBTREE_PRESERVING_REACH = `
WITH RECURSIVE alcance AS (
    SELECT g.id, 1 AS depth
      FROM resource_grants g
     WHERE g.id = $1::uuid AND g.revoked_at IS NULL
    UNION ALL
    SELECT c.id, s.depth + 1
      FROM resource_grants c
      JOIN alcance s ON c.parent_grant_id = s.id
     WHERE c.revoked_at IS NULL AND s.depth < 32
),
teto AS (
    SELECT EXISTS (SELECT 1 FROM alcance WHERE depth >= 32) AS truncado
),
resgate AS (
    SELECT a.id,
           g.parent_grant_id AS pai_antigo,
           g.expires_at      AS prazo_antigo,
           alt.id            AS novo_pai,
           LEAST(g.expires_at, alt.expires_at) AS prazo_novo
      FROM alcance a
      JOIN resource_grants g ON g.id = a.id
      CROSS JOIN teto
      LEFT JOIN LATERAL (
          SELECT p.id, p.expires_at
            FROM resource_grants p
           WHERE p.revoked_at IS NULL
             AND p.expires_at > NOW()
             AND p.grant_level = 'view_share'
             AND p.resource_type = g.resource_type
             AND p.resource_id  = g.resource_id
             AND p.id <> g.id
             AND (p.granted_by IS NULL OR fn_principal_vivo(p.granted_by))
             AND (p.grantee_id = g.granted_by
               OR p.grantee_group_id IN (SELECT group_id FROM fn_user_group_ids(g.granted_by)))
             AND NOT EXISTS (SELECT 1 FROM alcance x WHERE x.id = p.id)
           ORDER BY p.expires_at DESC, p.created_at, p.id
           LIMIT 1
      ) alt ON true
     WHERE (a.id <> $1::uuid OR $3::boolean)
       AND g.granted_by IS NOT NULL
       AND g.expires_at > NOW()
       AND teto.truncado = false
),
podados AS (
    SELECT a.id, 1 AS depth FROM alcance a
     WHERE a.depth = 1
       AND NOT ($3::boolean AND EXISTS (
             SELECT 1 FROM resgate r WHERE r.id = a.id AND r.novo_pai IS NOT NULL))
    UNION ALL
    SELECT c.id, p.depth + 1
      FROM resource_grants c
      JOIN podados p ON c.parent_grant_id = p.id
     WHERE c.revoked_at IS NULL AND p.depth < 32
       AND NOT EXISTS (SELECT 1 FROM resgate r WHERE r.id = c.id AND r.novo_pai IS NOT NULL)
),
salvos AS (
    SELECT r.* FROM resgate r
     WHERE r.novo_pai IS NOT NULL
       AND ( r.pai_antigo IN (SELECT id FROM podados)
          OR ($3::boolean AND r.id = $1::uuid) )
),
heranca AS (
    SELECT s.id, s.prazo_novo AS prazo, 1 AS depth FROM salvos s
    UNION ALL
    SELECT c.id, h.prazo, h.depth + 1
      FROM resource_grants c
      JOIN heranca h ON c.parent_grant_id = h.id
     WHERE c.revoked_at IS NULL AND h.depth < 32
),
aparar AS (
    SELECT h.id, h.prazo, g.expires_at AS prazo_antigo, g.parent_grant_id
      FROM heranca h JOIN resource_grants g ON g.id = h.id
     WHERE h.depth > 1 AND g.expires_at > h.prazo
),
fronteira AS (
    SELECT c.id, c.grantee_id, c.grantee_group_id, c.resource_type, c.resource_id
      FROM resource_grants c
      JOIN podados p ON c.parent_grant_id = p.id
     WHERE c.revoked_at IS NULL AND p.depth >= 32
),
revogados AS (
    UPDATE resource_grants g
       SET revoked_at = NOW(), revoked_by = $2::uuid
      FROM podados p
     WHERE g.id = p.id
    RETURNING g.id, g.grantee_id, g.grantee_group_id, g.resource_type, g.resource_id,
              g.parent_grant_id
),
repaiados AS (
    UPDATE resource_grants g
       SET parent_grant_id = s.novo_pai, expires_at = s.prazo_novo
      FROM salvos s
     WHERE g.id = s.id
    RETURNING g.id, g.grantee_id, g.grantee_group_id, g.resource_type, g.resource_id,
              s.pai_antigo, s.novo_pai, s.prazo_antigo, s.prazo_novo
),
aparados AS (
    UPDATE resource_grants g
       SET expires_at = a.prazo
      FROM aparar a
     WHERE g.id = a.id
    RETURNING g.id, g.grantee_id, g.grantee_group_id, g.resource_type, g.resource_id,
              a.parent_grant_id, a.prazo_antigo, a.prazo
)
SELECT 'revoked'::text AS acao, id, grantee_id, grantee_group_id, resource_type, resource_id,
       parent_grant_id AS pai_antigo, NULL::uuid AS novo_pai,
       NULL::timestamptz AS prazo_antigo, NULL::timestamptz AS prazo_novo
  FROM revogados
UNION ALL
SELECT 'reparented', id, grantee_id, grantee_group_id, resource_type, resource_id,
       pai_antigo, novo_pai, prazo_antigo, prazo_novo
  FROM repaiados
UNION ALL
SELECT 'trimmed', id, grantee_id, grantee_group_id, resource_type, resource_id,
       parent_grant_id, NULL::uuid, prazo_antigo, prazo
  FROM aparados
UNION ALL
SELECT 'frontier', id, grantee_id, grantee_group_id, resource_type, resource_id,
       NULL::uuid, NULL::uuid, NULL::timestamptz, NULL::timestamptz
  FROM fronteira
`;

// --- empréstimo por atlas --------------------------------------------------

/** O que este atlas empresta (vivos). $1 = atlas_id. */
export const LIST_ATLAS_RESOURCES = `
  SELECT ar.id, ar.resource_type, ar.resource_id, ar.added_by, ar.added_at,
         u.username AS added_by_username
    FROM atlas_resources ar
    LEFT JOIN users u ON u.id = ar.added_by
   WHERE ar.atlas_id = $1::uuid AND ar.removed_at IS NULL
   ORDER BY ar.resource_type, ar.added_at
`;

/**
 * QUEM EMPRESTA ESTE RECURSO AGORA — o endereço das salas que uma revogação pode
 * ter esvaziado.
 *
 * Não é uma consulta de acesso e não decide conteúdo: devolve só ids de sala, e o
 * frame que sai delas não carrega recurso nenhum. Os dois filtros de vivacidade são
 * o que a torna endereço e não histórico: o empréstimo desfeito (`removed_at`) e o
 * atlas na lixeira (`deleted_at`) já não emprestam nada, e acordar as salas deles
 * seria avisar sobre um vínculo que não existe.
 *   $1 = tipo, $2 = id do recurso
 */
export const ATLASES_LENDING_RESOURCE = `
  SELECT DISTINCT ar.atlas_id
    FROM atlas_resources ar
    JOIN atlas a ON a.id = ar.atlas_id AND a.deleted_at IS NULL
   WHERE ar.removed_at IS NULL
     AND ar.resource_type = $1
     AND ar.resource_id = $2
`;

/**
 * Anexa um recurso ao atlas.
 *
 * `uq_atlas_resources_live` faz a segunda tentativa VIVA colidir; o
 * `ON CONFLICT DO NOTHING` a transforma num retorno vazio em vez de um 500, e o
 * chamador distingue os dois casos por ele. Repare que o índice é PARCIAL
 * (`WHERE removed_at IS NULL`), então reanexar depois de remover volta a passar —
 * sem isso um empréstimo removido ocuparia a vaga para sempre, que é o beco sem
 * saída de catalog-soft-delete-resurrect.
 *   $1 = atlas_id, $2 = type, $3 = resource_id, $4 = added_by
 */
export const ATTACH_ATLAS_RESOURCE = `
  INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
  VALUES ($1::uuid, $2, $3, $4::uuid)
  ON CONFLICT DO NOTHING
  RETURNING id, atlas_id, resource_type, resource_id, added_at
`;

/** Remove (soft) o empréstimo. $1 = atlas_id, $2 = type, $3 = resource_id, $4 = removed_by. */
export const DETACH_ATLAS_RESOURCE = `
  UPDATE atlas_resources
     SET removed_at = NOW(), removed_by = $4::uuid
   WHERE atlas_id = $1::uuid AND resource_type = $2 AND resource_id = $3 AND removed_at IS NULL
   RETURNING id, resource_type, resource_id
`;

// --- higiene ---------------------------------------------------------------

/**
 * Apaga concessões e empréstimos de um recurso (R6).
 *
 * Existe para o ÚNICO hard-delete do sistema, e aqui o DELETE é FÍSICO de
 * propósito: a linha alvo deixou de existir, então a concessão não referencia mais
 * nada e guardá-la só polui a tela "quem tem acesso" com um id que nenhuma
 * listagem devolve. Precisa rodar na transação de quem apaga, senão a concessão
 * sobrevive a um rollback.
 *   $1 = resource_type, $2 = resource_id
 */
// AS DUAS PURGAS TÊM `RETURNING`, e não é conveniência: é o ÚNICO instante em que
// estas linhas ainda existem. Elas são hard-delete (o resto do sistema é soft), então
// depois do COMMIT não há de onde reconstruir quem tinha acesso ao recurso que
// sumiu. Sem o RETURNING, `PERMISSION_PURGE` seria uma linha dizendo "apaguei
// alguma coisa".
//
// O RETURNING traz TAMBÉM as linhas já mortas (`revoked_at`/`removed_at` não nulos):
// o DELETE não filtra, e a trilha precisa contar o que de fato saiu da tabela, não o
// que estava vivo. O estado de cada uma viaja no detalhe.
export const PURGE_GRANTS_OF_RESOURCE = `
  DELETE FROM resource_grants WHERE resource_type = $1 AND resource_id = $2
  RETURNING id, grantee_id, grantee_group_id, granted_by, grant_level, parent_grant_id, revoked_at, expires_at
`;
export const PURGE_ATLAS_LINKS_OF_RESOURCE = `
  DELETE FROM atlas_resources WHERE resource_type = $1 AND resource_id = $2
  RETURNING id, atlas_id, added_by, removed_at
`;

// --- classificação em LOTE das referências de um atlas ----------------------

/**
 * Traduz referências 360 para o id do PROJETO a que pertencem.
 *
 * As referências que o atlas guarda são heterogêneas por herança: `streetview360_data`
 * carrega o NOME ORIGINAL da foto, e `slides.photo_id` aceita id de projeto, slug, nome de
 * projeto e id da foto de entrada (é o que o validador de referência do cliente já tenta).
 * As cinco formas são resolvidas aqui, numa consulta só, e a que não resolver simplesmente
 * não devolve linha — o chamador trata ausência como "não visível", que é a convenção da
 * casa (`NO ROW MEANS REFUSE`, `sync.queries.js`).
 *
 * O DESEMPATE É O MESMO DE `GET_PHOTO_BY_NAME`: um nome de foto pode colidir entre
 * projetos, e o projeto `enabled` vence. Se os dois lados desempatassem diferente, uma
 * referência seria classificada contra um projeto e servida por outro.
 *
 * SEM PREDICADO DE ACESSO AQUI, e é deliberado: esta consulta responde "de qual projeto é
 * esta foto", não "quem pode vê-la". Aplicar o filtro de acesso já nesta etapa faria a
 * referência de projeto invisível desaparecer ANTES da classificação, e o resultado seria
 * indistinguível de "não existe" — o que apagaria a contagem que o relatório precisa dar.
 * Quem decide visibilidade é `CLASSIFY_RESOURCE_REFS`, logo depois.
 * O DESEMPATE ESPELHA `GET_PHOTO_BY_NAME` (`sv360.queries.js`), e o espelho é o ponto: se os
 * dois lados escolhessem projetos diferentes para o mesmo nome de foto, uma referência seria
 * CLASSIFICADA contra um projeto e SERVIDA por outro. São três termos, e os três são de lá:
 * a lápide (`deleted_photos`) exclui a foto apagada, a OM do destinatário vem primeiro, e só
 * então o projeto `enabled`. O `created_at` fecha o determinismo, que aquela consulta não
 * precisa ter (ela tem `LIMIT 1` sobre um índice único na prática) e esta precisa, porque
 * classifica em lote.
 *
 * O QUE NÃO SE ESPELHA É O PREDICADO DE ACESSO, e a ausência continua deliberada: filtrar
 * aqui faria a referência de projeto invisível sumir ANTES da classificação, e o resultado
 * ficaria indistinguível de "não existe" — o que apagaria a contagem do relatório. Quem
 * decide visibilidade é `CLASSIFY_RESOURCE_REFS`.
 *   $1 = text[] das referências distintas, $2 = userId do destinatário (uuid|null)
 */
export const RESOLVE_SV360_REFS = `
  SELECT r.ref, p.id::text AS project_id
    FROM unnest($1::text[]) AS r(ref)
    CROSS JOIN LATERAL (
      SELECT pr.id
        FROM sv360.projects pr
       WHERE (pr.slug = r.ref
          OR pr.name = r.ref
          OR pr.entry_photo_id = r.ref
          OR (r.ref ~ '^[0-9a-fA-F-]{36}$' AND pr.id = r.ref::uuid)
          OR EXISTS (
               SELECT 1 FROM sv360.photos ph
                WHERE ph.project_id = pr.id
                  AND (ph.original_name = r.ref OR ph.id = r.ref)
                  AND NOT EXISTS (
                        SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = ph.id
                      )
             ))
       ORDER BY (pr.organization_id = (SELECT u.organization_id FROM users u WHERE u.id = $2::uuid)) DESC,
                (pr.status = 'enabled') DESC,
                pr.created_at
       LIMIT 1
    ) p
`;

/**
 * A pergunta "este destinatário enxerga cada uma destas referências?", para o ATLAS
 * INTEIRO, numa ida ao banco.
 *
 * UMA DEFINIÇÃO SÓ DO PREDICADO: cada linha é julgada por `fn_can_see_resource`, a mesma
 * função composta que a listagem, o gate pontual e a borda de escrita chamam. Não há
 * segunda cópia da regra em JS, e é por isso que a poda do clone não pode ser a poda de
 * saída: aqui existe destinatário, e o predicado sabe respondê-lo.
 *
 * O ATLAS EM FOCO É NULO, E É DECISÃO DE PROJETO. O braço de empréstimo de
 * `fn_granted_resource_ids` responde pelo que o atlas EM FOCO empresta, e o clone não copia
 * `atlas_resources`: passar o atlas de ORIGEM faria a cópia nascer enxergando o que só a
 * origem emprestava, e deixar de enxergar depois — um atlas que perde recurso sozinho, sem
 * ninguém ter revogado nada.
 *
 * `COALESCE(n.access_level, 'private')` é a convenção de recusa: linha ausente (recurso
 * apagado, id inventado, referência de outra instalação) é tratada como privada, então
 * "não existe" e "não posso ver" continuam indistinguíveis — o contrário abriria um
 * oráculo de existência sobre o acervo privado.
 *   $1 = userId (uuid|null), $2 = text[] dos tipos, $3 = text[] dos ids
 */
export const CLASSIFY_RESOURCE_REFS = `
  WITH ref AS (
    SELECT t.tipo, i.rid
      FROM unnest($2::text[]) WITH ORDINALITY AS t(tipo, ord)
      JOIN unnest($3::text[]) WITH ORDINALITY AS i(rid, ord) USING (ord)
  ), nivel AS (
    SELECT 'basemap'::text AS tipo, id::text AS rid, access_level FROM basemaps WHERE active = true
    UNION ALL
    SELECT 'tileset', id::text, access_level FROM tilesets WHERE active = true
    UNION ALL
    SELECT 'data_layer', id::text, access_level FROM data_layers WHERE active = true
    UNION ALL
    SELECT 'analysis_layer', id::text, access_level FROM analysis_layers WHERE active = true
    UNION ALL
    SELECT 'sv360_project', id::text, access_level FROM sv360.projects
  )
  SELECT ref.tipo, ref.rid,
         fn_can_see_resource($1::uuid, NULL::uuid, ref.tipo, ref.rid,
                             COALESCE(n.access_level, 'private')) AS ok
    FROM ref
    LEFT JOIN nivel n ON n.tipo = ref.tipo AND n.rid = ref.rid
`;
