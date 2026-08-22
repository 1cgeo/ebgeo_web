// Path: src/modules/access-groups/access-groups.queries.js
// O SQL do grupo de acesso.
//
// TODA CONSULTA DAQUI EXIGE `deleted_at IS NULL`, e a razão não é higiene: a
// exclusão é SOFT porque `fn_user_group_ids` (008_acesso_a_recurso.sql) usa esse mesmo
// predicado para decidir se o grupo ainda concede. Uma consulta aqui que esqueça o
// predicado devolve, na tela, um grupo que o banco já não reconhece em nenhum caminho
// de acesso.
//
// A AUTORIDADE É POSSE, E ELA MORA NUMA FUNÇÃO SQL. Desde 2026-08-20 quem administra
// um grupo é o DONO dele (ou o administrador do sistema), e a pergunta tem UMA
// definição: `fn_can_administer_group` (008_acesso_a_recurso.sql). Ela é
// chamada daqui, do gate das rotas e do `GET_ADDRESSABLE_LIVE_GROUP` do módulo de
// concessão — três portas, um predicado. Escrever `owner_id = $1 OR ...` à mão em
// qualquer uma delas seria a segunda definição, e a segunda é a que envelhece.

/**
 * Os grupos que ESTE chamador administra, com a contagem de membros e a de concessões
 * vivas.
 *
 * A LISTAGEM PASSOU A SER RECORTADA POR DONO, e é ela a metade visível da mudança: o
 * modal de compartilhar recurso se alimenta desta consulta, então "conceder a um
 * coletivo" passa a oferecer só os coletivos de quem concede. O administrador vê
 * todos, pelo ramo curinga da função.
 *
 * `owner_username` viaja junto porque o administrador é o único que vê grupo alheio, e
 * a unicidade de nome agora é POR DONO: sem o nome do dono, a lista dele mostraria N
 * grupos homônimos de gente diferente.
 *
 * AS TRÊS CONTAGENS SÃO A TELA INTEIRA. "Quantas pessoas" responde se o grupo faz
 * alguma coisa, e as outras duas respondem o que se perde ao apagá-lo — que é a
 * consequência que ninguém adivinha.
 *
 * `atlas_share_count` ENTROU EM 2026-08-21, com o eixo de grupo de `atlas_shares` (D2,
 * 008_acesso_a_recurso.sql), e este bloco afirmava "as DUAS contagens são a
 * tela inteira" enquanto o grupo já carregava acesso a ATLAS. A frase virou falsa no
 * commit da decisão e a tela herdou a cegueira: o aviso de exclusão contava recurso e
 * omitia atlas, isto é, avisava de MENOS sobre um ato irreversível. Apagar o grupo é
 * soft, e soft não dispara o `ON DELETE CASCADE` da coluna — quem mata o share do grupo
 * apagado é `fn_user_group_ids`, no predicado. A linha de `atlas_shares` fica inerte, o
 * acesso morre na hora, e é por isso que ele precisa ser CONTADO antes do clique.
 *
 * A concessão viva inclui o PRAZO (`expires_at > NOW()`) porque uma concessão expirada
 * continua com `revoked_at IS NULL`: contá-la aqui prometeria um acesso que o
 * predicado já não entrega. `a.deleted_at IS NULL` no eixo de atlas existe pela MESMA
 * razão, do outro lado: um atlas na lixeira já não é alcançável por ninguém, e contá-lo
 * prometeria uma perda que não vai acontecer.
 *
 * As três subconsultas são escalares e não `LEFT JOIN` + `GROUP BY`, de propósito: um
 * join com tabelas de cardinalidade diferente multiplica as linhas e faz as contagens
 * mentirem umas sobre as outras.
 *   $1 = o chamador
 */
export const LIST_GROUPS = `
  SELECT g.id, g.name, g.description, g.created_at,
         g.created_by, cu.username AS created_by_username, cu.nome AS created_by_nome,
         g.owner_id, ou.username AS owner_username, ou.nome AS owner_nome,
         (SELECT COUNT(*) FROM access_group_members m WHERE m.group_id = g.id)::int
           AS member_count,
         (SELECT COUNT(*) FROM resource_grants rg
           WHERE rg.grantee_group_id = g.id
             AND rg.revoked_at IS NULL
             AND rg.expires_at > NOW())::int AS grant_count,
         (SELECT COUNT(*) FROM atlas_shares s
            JOIN atlas a ON a.id = s.atlas_id
           WHERE s.group_id = g.id
             AND a.deleted_at IS NULL)::int AS atlas_share_count
    FROM access_groups g
    LEFT JOIN users cu ON cu.id = g.created_by
    LEFT JOIN users ou ON ou.id = g.owner_id
   WHERE g.deleted_at IS NULL
     AND fn_can_administer_group($1::uuid, g.id)
   ORDER BY LOWER(g.name)
`;

/**
 * Os grupos de que ESTA pessoa PARTICIPA, com o nome do DONO e NADA MAIS.
 *
 * POR QUE ELA EXISTE (decisão do dono, 2026-08-20): com a listagem acima recortada por
 * posse, quem foi posto num grupo por outra pessoa deixaria de ver aquele grupo em
 * lugar nenhum — embora ele decida o acesso dela a recurso privado. Um mecanismo de
 * autorização invisível para quem ele governa é regressão de transparência, e o preço
 * de fechá-la é esta consulta.
 *
 * O ROSTER NÃO SAI POR AQUI, e essa é a linha exata: quem participa vê QUE participa e
 * DE QUEM é o grupo (é a quem reclamar), não quem mais está dentro. Nome de pessoa
 * continua sendo do lado fechado, com `LIST_MEMBERS`.
 *
 * TAMBÉM NÃO SAEM AS CONTAGENS. "Quantos recursos este grupo recebeu" é informação de
 * gestão e diria, ao membro, o TAMANHO de um acervo que ele não pode enumerar.
 *
 * NEM A DESCRIÇÃO. Ela saiu em 2026-08-21, por revisão: a consulta a trazia enquanto
 * este mesmo bloco prometia "nome do dono e NADA MAIS", e a tela a renderizava. É texto
 * livre escrito pelo dono do grupo, e a decisão do dono do produto enumera o que o
 * participante vê (nome, dono). Um bloco que descreve o oposto do `SELECT` logo abaixo
 * é a documentação que engana em dobro de que a constituição fala.
 *
 * `fn_user_group_ids` e não um JOIN à mão: ela é quem sabe que grupo apagado e grupo
 * de dono morto não valem, e é a mesma resposta que a resolução de acesso usa. Sem
 * isto, a tela listaria um grupo que já não concede nada.
 *   $1 = a pessoa
 */
export const LIST_GROUPS_OF_MEMBER = `
  SELECT g.id, g.name,
         g.owner_id, ou.username AS owner_username, ou.nome AS owner_nome
    FROM access_groups g
    LEFT JOIN users ou ON ou.id = g.owner_id
   WHERE g.id IN (SELECT group_id FROM fn_user_group_ids($1::uuid))
   ORDER BY LOWER(g.name)
`;

/** Um grupo VIVO por id. $1 = id. */
export const GET_GROUP = `
  SELECT id, name, description, created_by, owner_id, created_at
    FROM access_groups
   WHERE id = $1::uuid AND deleted_at IS NULL
`;

/**
 * "Este principal manda neste grupo?" — o predicado ÚNICO, chamado do JS.
 *
 * A função responde tudo: grupo vivo, dono vivo, ou administrador do sistema. O
 * chamador só traduz `false` em `NotFoundError`, e nunca em 403 — com a listagem
 * recortada, um 403 sobre grupo alheio contaria que aquele id existe.
 *   $1 = o ator, $2 = o grupo
 */
export const CAN_ADMINISTER_GROUP = `
  SELECT fn_can_administer_group($1::uuid, $2::uuid) AS ok
`;

/**
 * O ALCANCE de UM grupo: quantas pessoas, quantas concessões vivas e quantos atlas.
 *
 * A GÊMEA DE `LIST_GROUPS` DO LADO DO ATO, e as duas precisam contar as MESMAS coisas:
 * a listagem alimenta o aviso ANTES do clique e esta alimenta a trilha DEPOIS dele. Um
 * eixo que exista só de um lado produz um aviso que promete menos (ou mais) do que o
 * registro do ato diz ter acontecido. `atlas_share_count` entrou nas duas no mesmo
 * commit, por isso.
 *
 * Existe porque `deleteGroup` lia o alcance com `listGroups().find(...)` — uma
 * varredura da tabela inteira para achar uma linha — e, depois que a listagem passou a
 * ser recortada pelo chamador, aquela varredura nem serviria mais: o administrador
 * apagando grupo alheio o encontraria, e o dono também, mas a leitura dependeria de um
 * predicado de LISTAGEM para responder uma pergunta de CONTAGEM.
 *
 * Ele NÃO gateia nada: quem gateia é `requireGroupAuthority`, antes.
 *   $1 = id
 */
export const GET_GROUP_REACH = `
  SELECT g.id, g.name,
         (SELECT COUNT(*) FROM access_group_members m WHERE m.group_id = g.id)::int
           AS member_count,
         (SELECT COUNT(*) FROM resource_grants rg
           WHERE rg.grantee_group_id = g.id
             AND rg.revoked_at IS NULL
             AND rg.expires_at > NOW())::int AS grant_count,
         (SELECT COUNT(*) FROM atlas_shares s
            JOIN atlas a ON a.id = s.atlas_id
           WHERE s.group_id = g.id
             AND a.deleted_at IS NULL)::int AS atlas_share_count
    FROM access_groups g
   WHERE g.id = $1::uuid AND g.deleted_at IS NULL
`;

/**
 * Cria o grupo, com DONO.
 *
 * `ON CONFLICT DO NOTHING` sobre `uq_access_groups_nome_vivo_do_dono` (o índice único
 * PARCIAL de `(owner_id, LOWER(name))` entre os vivos), e não um SELECT antes do
 * INSERT: o SELECT deixa uma janela entre ler e escrever, e duas criações simultâneas
 * do mesmo nome passariam as duas pela leitura. Zero linha de volta significa nome
 * tomado, e o serviço traduz para 409.
 *
 * A INFERÊNCIA PRECISA CASAR O ÍNDICE EXATAMENTE, senão o INSERT morre em 42P10
 * (`there is no unique or exclusion constraint matching the ON CONFLICT
 * specification`) em vez de virar 409 — um erro de servidor onde deveria haver uma
 * recusa explicada.
 *
 * A UNICIDADE É POR DONO desde 2026-08-20: com todo usuário criando grupo, um único
 * global produziria um 409 sobre um grupo que o chamador não pode ver, que é recusa e
 * vazamento na mesma resposta.
 *
 * O índice ser PARCIAL é o que faz um nome apagado poder voltar — o beco documentado
 * em `catalog-soft-delete-resurrect.repro`.
 *   $1 = name, $2 = description, $3 = created_by / owner_id
 */
export const INSERT_GROUP = `
  INSERT INTO access_groups (name, description, created_by, owner_id)
  VALUES ($1, $2, $3::uuid, $3::uuid)
  ON CONFLICT (owner_id, LOWER(name)) WHERE deleted_at IS NULL DO NOTHING
  RETURNING id, name, description, created_by, owner_id, created_at
`;

/**
 * Renomeia e/ou reescreve a descrição.
 *
 * COALESCE por campo: ausente no corpo chega NULL e mantém o valor. A descrição
 * precisa poder ser LIMPA, e "limpar" e "não mexer" são dois pedidos diferentes que
 * um NULL sozinho não distingue — daí `$4` como bandeira de "veio no corpo",
 * exatamente como `UPDATE_ORGANIZATION` faz com a sigla.
 *   $1 = id, $2 = name|null, $3 = description|null, $4 = description veio no corpo?
 */
export const UPDATE_GROUP = `
  UPDATE access_groups
     SET name = COALESCE($2, name),
         description = CASE WHEN $4::boolean THEN $3 ELSE description END
   WHERE id = $1::uuid AND deleted_at IS NULL
  RETURNING id, name, description, created_by, owner_id, created_at
`;

/**
 * Apaga o grupo (SOFT).
 *
 * ELE CONTINUA SEM TOCAR EM `resource_grants`, e agora por uma razão diferente: quem
 * revoga as concessões do grupo é `podarPorRaizes`, na MESMA transação, porque a
 * exclusão passou a PODAR (a subárvore que os membros alimentaram através do grupo cai
 * junto, e ela não morre pelo predicado). O que este statement faz é uma coisa só.
 *
 * A LINHA DO GRUPO SOBREVIVE, e é o que responde "de quem era e como se chamava o
 * grupo X" depois do ato: `resource_grants.grantee_group_id` referencia
 * `access_groups(id)` sem `ON DELETE`, então um hard delete só passaria destruindo as
 * concessões (que é a resposta de auditoria que a decisão manda preservar) ou anulando
 * a coluna (que apaga QUAL grupo).
 *
 * `deleted_at IS NULL` no WHERE torna a operação idempotente: apagar duas vezes não
 * reescreve a data, e a data da PRIMEIRA exclusão é a que vale.
 *   $1 = id
 */
export const SOFT_DELETE_GROUP = `
  UPDATE access_groups SET deleted_at = NOW()
   WHERE id = $1::uuid AND deleted_at IS NULL
  RETURNING id, name
`;

/**
 * Quem está neste grupo. Só usuário ATIVO, porque só ele é alcançado pelo predicado
 * de acesso (`fn_principal_vivo`): listar um desativado aqui prometeria um acesso
 * que o banco não entrega.
 *
 * `posto_graduacao` é DERIVADO (`ranks.nome`), não coluna de `users` — a mesma junção
 * que `users.queries.js` faz, e pela mesma razão: a tela mostra o posto ao lado do
 * nome, e sem ele dois homônimos ficam indistinguíveis na lista.
 *   $1 = group_id
 */
export const LIST_MEMBERS = `
  SELECT u.id, u.username, u.nome, r.nome AS posto_graduacao,
         m.added_at, m.added_by, au.username AS added_by_username
    FROM access_group_members m
    JOIN users u ON u.id = m.user_id AND u.is_active = true
    LEFT JOIN ranks r ON r.id = u.rank_id
    LEFT JOIN users au ON au.id = m.added_by
   WHERE m.group_id = $1::uuid
   ORDER BY LOWER(COALESCE(u.nome, u.username))
`;

/**
 * Põe alguém no grupo. `ON CONFLICT DO NOTHING` sobre a PK `(group_id, user_id)`:
 * pôr duas vezes é o mesmo estado, e o serviço trata zero linha como "já estava",
 * não como erro — a operação é idempotente por desenho, porque a tela pode repetir
 * o clique e o resultado desejado é o mesmo.
 *   $1 = group_id, $2 = user_id, $3 = added_by
 */
export const INSERT_MEMBER = `
  INSERT INTO access_group_members (group_id, user_id, added_by)
  VALUES ($1::uuid, $2::uuid, $3::uuid)
  ON CONFLICT (group_id, user_id) DO NOTHING
  RETURNING group_id, user_id, added_at
`;

/** Tira alguém do grupo. $1 = group_id, $2 = user_id. */
export const DELETE_MEMBER = `
  DELETE FROM access_group_members
   WHERE group_id = $1::uuid AND user_id = $2::uuid
  RETURNING group_id, user_id
`;

/**
 * Esvazia o grupo, devolvendo quem saiu — TODO MUNDO, inclusive o desativado.
 *
 * O `RETURNING` é o produto: os membros são apagados FISICAMENTE (a tabela de
 * composição não tem soft-delete), então este é o último instante em que "quem estava
 * dentro quando o grupo morreu" existe em algum lugar. O serviço copia esta lista para
 * os detalhes da trilha antes do COMMIT.
 *
 * O `JOIN` COM `users` NÃO FILTRA `is_active`, e é a diferença que importa em relação a
 * `LIST_MEMBERS`. As duas consultas parecem intercambiáveis e não são: `LIST_MEMBERS`
 * alimenta a TELA e só pode mostrar quem o predicado de acesso alcança, então ela corta
 * o desativado; esta alimenta a TRILHA, que registra o que existia. Enquanto o serviço
 * montava os detalhes com `LIST_MEMBERS`, a mesma linha de auditoria trazia
 * `memberCount: 2` ao lado de `membros: [um]`, e a pessoa desativada tinha a linha de
 * composição apagada sem ficar registrada em lugar nenhum.
 *
 * `LEFT JOIN` e não `JOIN` por defesa: a FK garante a correspondência, mas a lista da
 * trilha não pode encolher em silêncio se um dia ela não garantir.
 *   $1 = group_id
 */
export const DELETE_ALL_MEMBERS = `
  WITH saiu AS (
    DELETE FROM access_group_members WHERE group_id = $1::uuid
    RETURNING user_id
  )
  SELECT s.user_id AS id, u.username
    FROM saiu s
    LEFT JOIN users u ON u.id = s.user_id
`;

/** Um usuário ATIVO por id, com o nome para a trilha. $1 = id. */
export const GET_ACTIVE_USER = `
  SELECT id, username, nome FROM users WHERE id = $1::uuid AND is_active = true
`;
