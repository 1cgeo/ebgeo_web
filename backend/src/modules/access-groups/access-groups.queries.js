// Path: src/modules/access-groups/access-groups.queries.js
// O SQL do grupo de acesso.
//
// TODA CONSULTA DAQUI EXIGE `deleted_at IS NULL`, e a razão não é higiene: a
// exclusão é SOFT porque `fn_user_group_ids` (008_acesso_a_recurso.sql) já usa esse
// mesmo predicado para decidir se o grupo ainda concede. Ou seja, apagar o grupo
// revoga o que ele dava sem escrever uma linha em `resource_grants` — e uma consulta
// aqui que esqueça o predicado devolve, na tela, um grupo que o banco já não
// reconhece em nenhum caminho de acesso.

/**
 * Os grupos VIVOS, com a contagem de membros e a de concessões vivas.
 *
 * AS DUAS CONTAGENS SÃO A TELA INTEIRA. "Quantas pessoas" responde se o grupo faz
 * alguma coisa, e "quantos recursos" responde o que se perde ao apagá-lo — que é a
 * consequência que ninguém adivinha, pela mesma razão que a poda de concessão
 * precisa do aviso que `grant-tree.js` monta.
 *
 * A concessão viva inclui o PRAZO (`expires_at > NOW()`) porque uma concessão
 * expirada continua com `revoked_at IS NULL`: contá-la aqui prometeria um acesso que
 * o predicado já não entrega. É a mesma leitura que `LIVE_GRANTS_OF_ACTOR` faz.
 *
 * As duas subconsultas são escalares e não `LEFT JOIN` + `GROUP BY`, de propósito: um
 * join com duas tabelas de cardinalidade diferente multiplica as linhas e faz as duas
 * contagens mentirem uma sobre a outra. É o erro clássico do relatório de dois
 * agregados.
 */
export const LIST_GROUPS = `
  SELECT g.id, g.name, g.description, g.created_at,
         g.created_by, cu.username AS created_by_username, cu.nome AS created_by_nome,
         (SELECT COUNT(*) FROM access_group_members m WHERE m.group_id = g.id)::int
           AS member_count,
         (SELECT COUNT(*) FROM resource_grants rg
           WHERE rg.grantee_group_id = g.id
             AND rg.revoked_at IS NULL
             AND rg.expires_at > NOW())::int AS grant_count
    FROM access_groups g
    LEFT JOIN users cu ON cu.id = g.created_by
   WHERE g.deleted_at IS NULL
   ORDER BY LOWER(g.name)
`;

/** Um grupo VIVO por id. $1 = id. */
export const GET_GROUP = `
  SELECT id, name, description, created_by, created_at
    FROM access_groups
   WHERE id = $1::uuid AND deleted_at IS NULL
`;

/**
 * Cria o grupo.
 *
 * `ON CONFLICT DO NOTHING` sobre `uq_access_groups_nome_vivo` (o índice único
 * PARCIAL de `LOWER(name)` entre os vivos), e não um SELECT antes do INSERT: o
 * SELECT deixa uma janela entre ler e escrever, e duas criações simultâneas do
 * mesmo nome passariam as duas pela leitura. Zero linha de volta significa nome
 * tomado, e o serviço traduz para 409.
 *
 * O índice ser PARCIAL é o que faz um nome apagado poder voltar — o beco documentado
 * em `catalog-soft-delete-resurrect.repro`.
 *   $1 = name, $2 = description, $3 = created_by
 */
export const INSERT_GROUP = `
  INSERT INTO access_groups (name, description, created_by)
  VALUES ($1, $2, $3::uuid)
  ON CONFLICT (LOWER(name)) WHERE deleted_at IS NULL DO NOTHING
  RETURNING id, name, description, created_by, created_at
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
  RETURNING id, name, description, created_by, created_at
`;

/**
 * Apaga o grupo (SOFT).
 *
 * ELE NÃO TOCA EM `resource_grants`, e essa ausência é a decisão. `fn_user_group_ids`
 * exige `deleted_at IS NULL`, então marcar a data aqui já corta o braço de grupo da
 * resolução: o acesso morre no mesmo instante, sem uma segunda escrita que precise
 * concordar com esta. Revogar as concessões junto destruiria a resposta de auditoria
 * ("por que o grupo X tinha acesso ao recurso Y"), pela mesma razão que a revogação
 * de concessão é soft e não um DELETE em cascata.
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

/** Um usuário ATIVO por id, com o nome para a trilha. $1 = id. */
export const GET_ACTIVE_USER = `
  SELECT id, username, nome FROM users WHERE id = $1::uuid AND is_active = true
`;
