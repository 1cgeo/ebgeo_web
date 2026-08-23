// Path: src/modules/sharing/sharing.queries.js
//
// O SQL do compartilhamento de atlas. DESDE 2026-08-21 O ALVO DE UM SHARE É UMA PESSOA
// **OU** UM GRUPO, nunca os dois (`atlas_shares_alvo_unico_check`), e as consultas daqui
// são as ÚNICAS que escrevem na tabela pelo caminho de compartilhamento.
//
// O QUE NÃO MORA AQUI, e a ausência é contrato: a RESOLUÇÃO de nível. "Quem alcança este
// atlas, e em que nível" é `fn_user_atlas_shares` (008_acesso_a_recurso.sql),
// chamada pelo gate REST, pelo gate do WebSocket e pelas três listagens de
// `atlas.queries.js`. Uma consulta de resolução escrita aqui seria a segunda definição da
// precedência, e a segunda é a que envelhece.

/**
 * A configuração de compartilhamento de UM atlas: link público, dono, as pessoas e os
 * GRUPOS.
 *
 * O `FILTER` DE `shares` OLHA PARA `s.user_id`, E NÃO PARA `s.id`. Enquanto olhava para
 * `s.id` ele só perguntava "existe linha de share?", o que era a mesma pergunta enquanto
 * toda linha tinha pessoa. Com o alvo coletivo, cada linha de GRUPO entraria no array
 * `shares` como um membro de `userId`/`username`/`nome` nulos — uma pessoa fantasma na
 * lista de membros do modal, nascida no instante em que a coluna passou a existir.
 *
 * O AGREGADO `groups` NOMEIA O DONO DO GRUPO, e isso é mitigação, não enfeite (decisão do
 * dono, 2026-08-20): um share por grupo chega a `manage`, então quem administra a
 * COMPOSIÇÃO do grupo passa a distribuir co-Gestão de um atlas que não é dele. O gestor do
 * atlas precisa ver DE QUEM é a composição que ele está aceitando; sem o nome do dono a
 * amplificação de autoridade fica invisível na única tela que a mostraria.
 *
 * `ag.deleted_at IS NULL` no FILTER é o que faz a TELA concordar com a RESOLUÇÃO: um grupo
 * apagado deixa a linha inerte em `atlas_shares` (a exclusão é soft e não dispara o
 * CASCADE), e `fn_user_group_ids` já o ignora. Mostrá-lo aqui prometeria um acesso que o
 * banco não entrega.
 *   $1 = atlas
 */
/**
 * O QUE O MODAL DE COMPARTILHAMENTO MOSTRA, e desde 2026-08-23 ele mostra os DOIS números.
 *
 * A LINHA E O EFEITO SÃO COISAS DIFERENTES, e enquanto esta consulta devolvia só a linha, a
 * tela mentia. `fn_user_atlas_shares` resolve o acesso pelo MAIOR nível entre o
 * compartilhamento nominal e o de grupo (o direto só desempata), que é o princípio de
 * caminhos independentes da constituição aplicado ao atlas. Consequência: rebaixar alguém
 * de edição para leitura NÃO o rebaixa se um grupo daquele atlas o mantém em edição. O
 * gestor via o `<select>` virar "leitura", e a pessoa continuava editando.
 *
 * `permission` continua sendo a da LINHA, porque é ela que o `<select>` edita; ao lado vai
 * `effectivePermission`, o que o servidor de fato aplica.
 *
 * `effectiveVia` DIZ "group" E NÃO QUAL GRUPO, de propósito. A cláusula 5.3 dá ao gestor o
 * NOME DO DONO do grupo, não a composição dele, e nomear o grupo aqui revelaria que aquela
 * pessoa é membro daquele grupo — dedução sobre composição que o gestor não tem direito de
 * fazer. O que ele precisa saber para não se enganar é que o rebaixamento não teve efeito, e
 * isso "group" já diz.
 */
export const GET_SHARING_CONFIG = `
  SELECT a.is_public, a.public_link, a.owner_id,
         owner.username AS owner_username, owner.nome AS owner_nome,
         (
           SELECT COALESCE(json_agg(
                    json_build_object(
                      'userId', s.user_id,
                      'username', u.username,
                      'nome', u.nome,
                      'permission', s.permission,
                      'effectivePermission', ef.permission,
                      'effectiveVia', CASE WHEN fn_permission_rank(ef.permission)
                                                > fn_permission_rank(s.permission::text)
                                           THEN 'group' ELSE 'direct' END,
                      'addedAt', s.added_at
                    ) ORDER BY s.added_at
                  ), '[]')
             FROM atlas_shares s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN LATERAL fn_user_atlas_shares(s.user_id, a.id) ef ON true
            WHERE s.atlas_id = a.id AND s.user_id IS NOT NULL
         ) AS shares,
         (
           SELECT COALESCE(json_agg(
                    json_build_object(
                      'groupId', s.group_id,
                      'name', ag.name,
                      'permission', s.permission,
                      'addedAt', s.added_at,
                      'memberCount', (SELECT COUNT(*)::int FROM access_group_members gm
                                       WHERE gm.group_id = s.group_id),
                      'ownerId', ag.owner_id,
                      'ownerUsername', gow.username,
                      'ownerNome', gow.nome
                    ) ORDER BY s.added_at
                  ), '[]')
             FROM atlas_shares s
             JOIN access_groups ag ON ag.id = s.group_id AND ag.deleted_at IS NULL
             LEFT JOIN users gow ON gow.id = ag.owner_id
            WHERE s.atlas_id = a.id AND s.group_id IS NOT NULL
         ) AS groups
  FROM atlas a
  JOIN users owner ON owner.id = a.owner_id
  WHERE a.id = $1 AND a.deleted_at IS NULL
`;

export const INSERT_USER_SHARE = `
  INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (atlas_id, user_id) DO UPDATE SET permission = EXCLUDED.permission
  RETURNING *
`;

// Returns the PREVIOUS permission alongside the new row: a permission change is only
// auditable if the record says what it changed FROM. The self-join reads the pre-UPDATE
// snapshot (Postgres evaluates the FROM against the rows as they were), which keeps it
// a single atomic statement instead of a read-then-write pair.
export const UPDATE_USER_SHARE = `
  UPDATE atlas_shares s
  SET permission = $3
  FROM atlas_shares prev
  WHERE s.atlas_id = $1 AND s.user_id = $2
    AND prev.atlas_id = s.atlas_id AND prev.user_id = s.user_id
  RETURNING s.*, prev.permission AS previous_permission
`;

export const DELETE_USER_SHARE = `
  DELETE FROM atlas_shares
  WHERE atlas_id = $1 AND user_id = $2
  RETURNING id
`;

export const FIND_USER_BY_ID = `
  SELECT id FROM users WHERE id = $1 AND is_active = true
`;

// ---------------------------------------------------------------------------
// O EIXO DE GRUPO. As três escritas espelham as de pessoa, statement por statement,
// e a simetria é deliberada: uma forma diferente aqui seria uma segunda semântica de
// "compartilhar" mantida por acidente.
// ---------------------------------------------------------------------------

/**
 * O grupo VIVO, para o 404 do serviço. Não gateia autoridade: quem gateia é
 * `assertCanAdministerGroup` (módulo de grupos), e ele responde 404 pelo mesmo motivo.
 *   $1 = grupo
 */
export const FIND_LIVE_GROUP_BY_ID = `
  SELECT id, name FROM access_groups WHERE id = $1 AND deleted_at IS NULL
`;

/**
 * O NOME de um grupo, VIVO OU MORTO, só para a trilha de auditoria.
 *
 * Ele ignora `deleted_at` de propósito, e o irmão acima existe justamente para NÃO ser
 * usado aqui: revogar o vínculo de um grupo já apagado é o caso comum de limpeza, e uma
 * linha de trilha que gravasse só o UUID mandaria quem auditar meses depois resolver um id
 * contra uma linha morta — que é onde a trilha para de servir. No eixo de PESSOA o problema
 * não existe porque `users` nunca some (soft-delete por `is_active`); `access_groups` some
 * da vista, e é essa assimetria que esta consulta paga.
 *   $1 = grupo
 */
export const FIND_GROUP_NAME_ANY = `
  SELECT name FROM access_groups WHERE id = $1
`;

// `ON CONFLICT (atlas_id, group_id)` casa `atlas_shares_atlas_id_group_id_key`, o irmão do
// UNIQUE de pessoa. A inferência precisa casar a constraint EXATAMENTE, senão o INSERT
// morre em 42P10 (um 500) em vez de atualizar o nível.
export const INSERT_GROUP_SHARE = `
  INSERT INTO atlas_shares (atlas_id, group_id, permission, added_by)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (atlas_id, group_id) DO UPDATE SET permission = EXCLUDED.permission
  RETURNING *
`;

// Mesmo auto-join de `UPDATE_USER_SHARE`, e pelo mesmo motivo: sem `previous_permission` a
// trilha registra para onde a permissão foi e não de onde ela veio, que é metade do fato.
export const UPDATE_GROUP_SHARE = `
  UPDATE atlas_shares s
  SET permission = $3
  FROM atlas_shares prev
  WHERE s.atlas_id = $1 AND s.group_id = $2
    AND prev.atlas_id = s.atlas_id AND prev.group_id = s.group_id
  RETURNING s.*, prev.permission AS previous_permission
`;

export const DELETE_GROUP_SHARE = `
  DELETE FROM atlas_shares
  WHERE atlas_id = $1 AND group_id = $2
  RETURNING id
`;

/**
 * Quem está no grupo, para o fan-out do controller. Não é roster de tela: o destino é a
 * interseção com quem está NA SALA, para recalcular a permissão EFETIVA de cada um.
 *   $1 = grupo
 */
export const LIST_GROUP_MEMBER_IDS = `
  SELECT user_id FROM access_group_members WHERE group_id = $1
`;

/**
 * A permissão EFETIVA de um punhado de pessoas neste atlas, resolvida pela MESMA função
 * dos dois gates.
 *
 * ELA EXISTE PARA QUE A FRAME NÃO MINTA, e este é o ponto mais delicado do eixo de grupo.
 * `sync-engine.js` faz `sessionContext.updateRole(msg.role)` cru: uma frame que carregasse
 * o nível do GRUPO rebaixaria no cliente quem tem share direto MAIOR — a barra de
 * ferramentas some sem motivo e volta no F5, que é a forma mais cara de defeito de UI
 * (irreproduzível para quem reporta, invisível para quem investiga). O servidor nunca
 * rebaixou ninguém; quem rebaixaria é a frame.
 *
 * O `LEFT JOIN LATERAL` (e não uma subconsulta escalar) porque a função devolve zero ou uma
 * linha por pessoa: quem perdeu todo caminho vem com `permission` NULL, e é o chamador que
 * decide se isso vira `user_removed` ou nada.
 *
 * OS TRÊS RAMOS SÃO OS TRÊS DE `resolvePermission` (middleware/permissions.js), NA MESMA
 * ORDEM: dono, share (direto ou por grupo vivo, resolvido pela função única), atlas
 * público. Nenhum é decorativo:
 *
 * - o DONO PODE estar num grupo compartilhado do próprio atlas, e sem o primeiro ramo a
 *   frame o anunciaria com o nível do grupo;
 * - o ATLAS PÚBLICO dá `read` a QUALQUER autenticado, então tirar o share de alguém num
 *   atlas publicado NÃO o remove — anunciar `user_removed` ali seria a mesma mentira, na
 *   direção oposta. O ramo entrou em 2026-08-21, medido: sem ele, `effectiveRolesFor`
 *   devolvia `null` para quem os dois gates continuavam deixando entrar como leitor.
 *
 * O QUE ELA DELIBERADAMENTE NÃO TEM é o atalho de papel GLOBAL (`users.role = 'admin'`,
 * que os dois gates aplicam antes de tudo). O motivo é o consumidor: `sync-engine.js`
 * (`sharingUpdated`) faz `if (sessionContext.isAdmin()) return` antes de olhar `msg.role`,
 * então um administrador global ignora TODA frame deste tipo. Escrevê-lo aqui seria uma
 * segunda cópia do atalho global — o eixo que a constituição proíbe comparar por ordem —
 * dentro de uma consulta que nenhum administrador lê.
 *   $1 = atlas   $2 = uuid[] de pessoas
 */
export const EFFECTIVE_PERMISSIONS = `
  SELECT m.uid AS user_id,
         CASE WHEN m.uid = a.owner_id THEN 'owner'
              WHEN us.permission IS NOT NULL THEN us.permission
              WHEN a.is_public THEN 'read'
         END AS permission
  FROM unnest($2::uuid[]) AS m(uid)
  CROSS JOIN (SELECT owner_id, is_public FROM atlas WHERE id = $1::uuid) a
  LEFT JOIN LATERAL (SELECT permission FROM fn_user_atlas_shares(m.uid, $1::uuid)) us ON true
`;
