// Path: src/modules/atlas/atlas.queries.js

export const INSERT_ATLAS = `
  INSERT INTO atlas (name, description, owner_id)
  VALUES ($1, $2, $3)
  RETURNING *
`;

export const FIND_ATLAS_BY_ID = `
  SELECT * FROM atlas
  WHERE id = $1 AND deleted_at IS NULL
`;

// `user_permission` MUST resolve exactly like `resolvePermission` (middleware/permissions.js),
// which is the single source of the five-level hierarchy read < comment < write < manage < owner:
// it checks OWNERSHIP FIRST, then the share row. This query used to invert that
// (`COALESCE(s.permission, CASE WHEN a.owner_id = $1 THEN 'owner' END)`), so a share row won over
// ownership. Nothing forbids such a row — addUserShare has no guard against atlas.owner_id — and
// the owner then appeared as a plain reader OF THEIR OWN ATLAS: this projection is what gates the
// project-picker UI ('Meus atlas' tab, canWrite, canOwn), so the owner silently lost rename /
// trash / share while keeping the underlying rights (server-side authz checks the owner first and
// was never affected).
//
// `owner` is the TOP of the hierarchy, so it dominates every share level by construction; the
// CHECK on atlas_shares.permission caps a share at 'manage'. Every other level is surfaced
// VERBATIM — never collapse this into a closed list ('write'|'owner'), which is exactly how the
// co-Gestor ('manage', above 'write') was silenced before.
//
// O ALCANCE VEM DE `fn_user_atlas_shares` desde 2026-08-21, e não de um JOIN sobre
// `atlas_shares`: um share pode ter como alvo uma PESSOA ou um GRUPO, e o join cru lia só o
// primeiro braço — o membro por grupo abriria o atlas por URL e não o veria nesta lista. A função
// também é o que impede a DUPLICATA de cartão: ela já agrega por atlas, então estar em DOIS grupos
// que compartilham o MESMO atlas continua sendo uma linha (um join cru devolveria duas).
export const LIST_USER_ATLAS = `
  SELECT a.*, u.nome as owner_nome, u.username as owner_username,
         CASE WHEN a.owner_id = $1 THEN 'owner' ELSE us.permission END as user_permission
  FROM atlas a
  JOIN users u ON u.id = a.owner_id
  LEFT JOIN fn_user_atlas_shares($1::uuid) us ON us.atlas_id = a.id
  WHERE a.deleted_at IS NULL
    AND (
      a.owner_id = $1
      OR us.atlas_id IS NOT NULL
    )
  ORDER BY a.updated_at DESC
`;

// Nullable text columns use a "provided" FLAG (see UPDATE_USER_PROFILE, which solved
// this first and documents why: "COALESCE alone could never clear to NULL"). COALESCE
// collapses the two meanings of null — "field absent from the PATCH" and "clear this
// field" — into one, so the API accepted null (the Joi schemas say .allow(null, ''))
// and silently kept the old value, answering 200 with the un-cleared row. The client
// then confirms a deletion that never happened.
export const UPDATE_ATLAS = `
  UPDATE atlas
  SET name = COALESCE($2, name),
      description = CASE WHEN $5 THEN $3 ELSE description END,
      map_order = COALESCE($4::uuid[], map_order),
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND deleted_at IS NULL
  RETURNING *
`;

// RETURNING inclui o NOME: `ATLAS_DELETE` é a única linha que ainda diz o que era
// aquele UUID depois que o atlas saiu de todas as listagens, e um id nu na trilha
// obriga quem investiga a ir buscar a linha que a exclusão acabou de esconder.
export const SOFT_DELETE_ATLAS = `
  UPDATE atlas
  SET deleted_at = NOW(),
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND deleted_at IS NULL
  RETURNING id, name, owner_id
`;

// The caller's OWN trashed atlases (only the owner soft-deletes, so only the owner sees/restores).
export const LIST_DELETED_USER_ATLAS = `
  SELECT a.*, u.nome as owner_nome, u.username as owner_username, 'owner' as user_permission
  FROM atlas a
  JOIN users u ON u.id = a.owner_id
  WHERE a.deleted_at IS NOT NULL
    AND a.owner_id = $1
  ORDER BY a.deleted_at DESC
`;

// Every trashed atlas, for a global admin (bugs-backend #95). A restore path nobody can SEE is
// not a path: the atlases this exists for are precisely the ones whose owner is deactivated, so
// they appear in no user's bin. `user_permission` is 'owner' because that is what
// `requireAtlasPermission` already grants an admin on every atlas — the listing must not claim
// less access than the gate gives, which is the mistake LIST_USER_ATLAS documents above.
// `owner_nome`/`owner_username` are what makes another user's atlas identifiable in the list.
export const LIST_ALL_DELETED_ATLAS = `
  SELECT a.*, u.nome as owner_nome, u.username as owner_username, 'owner' as user_permission
  FROM atlas a
  JOIN users u ON u.id = a.owner_id
  WHERE a.deleted_at IS NOT NULL
  ORDER BY a.deleted_at DESC
`;

// Restore is scoped to (id, owner, soft-deleted) so the ownership check is atomic: a non-owner or a
// non-deleted/absent atlas matches zero rows → the service raises 404.
//
// The `owner_id = $2` scope IS the access control of POST /:atlasId/restore — the one route of the
// module with no `requireAtlasPermission`, because that middleware only sees live atlases. It has
// been loosened by accident before. Never widen THIS query; the admin path below is a separate
// statement, chosen by an explicit branch in the service.
export const RESTORE_ATLAS = `
  UPDATE atlas
  SET deleted_at = NULL,
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL
  RETURNING *
`;

// Global-admin restore (bugs-backend #95, owner's decision). Deliberately a SECOND statement
// rather than a nullable `($2 IS NULL OR owner_id = $2)` on the one above: an anti-IDOR predicate
// that can be switched off by passing null is one bad argument away from being off, and the
// argument comes from a controller. Two statements make "no owner scope" a thing you have to
// write down. The caller is `req.user.role === 'admin'`, which `auth` re-reads from the database
// on every request, so a demoted admin cannot reach it with a stale claim.
//
// It exists because a trashed atlas was otherwise UNREACHABLE: the deactivation queries
// (users.queries.js COUNT_USER_ATLAS / TRANSFER_ATLAS_OWNERSHIP) both filter `deleted_at IS NULL`,
// so an atlas in the bin is neither counted nor transferred when its owner is deactivated. It stays
// owned by an inactive account that the `auth` middleware refuses, and the owner scope here meant
// nobody at all could bring it back.
export const RESTORE_ATLAS_ADMIN = `
  UPDATE atlas
  SET deleted_at = NULL,
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND deleted_at IS NOT NULL
  RETURNING *
`;

export const UPDATE_ATLAS_SETTINGS = `
  UPDATE atlas
  SET settings = settings || $2::jsonb,
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND deleted_at IS NULL
  RETURNING *
`;

export const FIND_ATLAS_BY_PUBLIC_LINK = `
  SELECT a.*, u.nome as owner_nome, u.username as owner_username
  FROM atlas a
  JOIN users u ON u.id = a.owner_id
  WHERE a.public_link = $1 AND a.deleted_at IS NULL AND a.is_public = true
`;

export const UPDATE_PUBLIC_LINK = `
  UPDATE atlas
  SET is_public = $2,
      public_link = $3,
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND deleted_at IS NULL
  RETURNING *
`;

// ============================================================================
// Cartão do atlas: quem participa e se há capa.
//
// SEPARADA de LIST_USER_ATLAS de propósito. Aquela lista é chamada por quatro superfícies do
// cliente (controle de conta, aba Mapas, nome do atlas, tela de projetos) e três delas só querem
// id e nome; agregar participante ali faria toda troca de mapa pagar dois subselects por atlas.
// Esta roda uma vez, na tela que desenha os cartões.
//
// QUEM VÊ A LISTA DE PARTICIPANTES: todo mundo que já tem acesso ao atlas, em qualquer dos cinco
// níveis. É mais frouxo que `GET /sharing`, que exige `manage`, e a diferença é deliberada: aquela
// rota ENTREGA o controle (adicionar, promover, remover) e esta responde "com quem eu divido este
// projeto", que qualquer membro descobre no primeiro instante de colaboração, quando os avatares
// aparecem no mapa. Não devolve e-mail nem username: nome, posto, id e NÍVEL.
//
// O NÍVEL ENTROU EM 2026-08-23, por decisão do dono, e ele muda o que esta consulta responde: até
// aqui "quem tem acesso e com que nível" só era respondível a quem tem `manage`, então um Leitor ou
// um Editor não tinha COMO saber a quem pedir permissão, nem por que um vizinho consegue apagar o
// que ele não consegue. A alternativa recusada, por extenso, está em `docs/decisions/decisions-2026.md`.
//
// ELE É O NÍVEL EFETIVO, resolvido por `fn_user_atlas_shares`, e não a coluna de `atlas_shares`.
// São coisas diferentes desde que o share ganhou o eixo de grupo: quem tem `read` direto e `manage`
// por um coletivo aparece com o `manage` que o servidor de fato aplica. É a mesma escolha do
// `effectivePermission` de `GET /sharing`, e ela é o ponto todo — um nível que não é o aplicado
// seria pior que nenhum nível.
//
// O DONO NÃO TEM LINHA DE SHARE, então o nível dele é literal (`'owner'`), sintetizado como
// `resolvePermission` faz. Sem isso a metade do dono viria com o campo NULO, que é exatamente a
// forma de "vazio" que a decisão manda não produzir.
//
// O QUE ESTA CONSULTA CONTINUA NÃO DIZENDO é POR QUAL CAMINHO cada pessoa chega (o `effectiveVia`
// de `GET /sharing`), e a omissão é deliberada: dizer "por grupo" a todo membro de leitura revela
// que aquela pessoa está num coletivo, dedução sobre COMPOSIÇÃO que as cláusulas 4.5 e 5.3 reservam
// a quem administra o grupo e a quem tem `manage` no atlas. O nível responde a pergunta que a
// decisão abriu; o caminho não faz parte dela.
//
// O dono entra na lista SEMPRE e em primeiro lugar (`ord = 0`), porque ele não tem linha em
// `atlas_shares`. O teto de dez existe para o payload; a contagem verdadeira vai em `member_count`,
// e é ela que o cartão soma no "+N".
//
// A LISTA E A CONTAGEM VÊM DE `fn_atlas_member_ids` desde 2026-08-21, e a razão é aritmética: com
// o eixo de grupo, somar LINHAS de `atlas_shares` faria um coletivo de quarenta pessoas contar
// como UM membro, e as quarenta não apareceriam na lista onde elas próprias deveriam estar. A
// função expande em pessoas e deduplica (quem tem share direto E está num grupo compartilhado é
// uma pessoa só).
//
// Os DOIS `<> a.owner_id` (um na contagem, um na lista) não são higiene: o dono PODE estar num
// grupo compartilhado do próprio atlas, e ele já entra pela outra metade da união, com `ord = 0`.
// Sem eles, seria contado e listado duas vezes.
export const LIST_USER_ATLAS_MEMBERS = `
  SELECT a.id,
         1 + (SELECT COUNT(*) FROM fn_atlas_member_ids(a.id) mc
               WHERE mc.user_id <> a.owner_id)::int AS member_count,
         COALESCE((
           SELECT json_agg(
                    json_build_object('id', m.id, 'nome', m.nome,
                                      'posto_graduacao', m.posto_graduacao,
                                      'permission', m.permission)
                    ORDER BY m.ord, m.nome
                  )
           FROM (
             SELECT ow.id, ow.nome, orank.nome AS posto_graduacao,
                    'owner'::text AS permission, 0 AS ord
             FROM users ow
             LEFT JOIN ranks orank ON orank.id = ow.rank_id
             WHERE ow.id = a.owner_id
             UNION ALL
             SELECT mu.id, mu.nome, mrank.nome AS posto_graduacao,
                    ef.permission, 1 AS ord
             FROM fn_atlas_member_ids(a.id) ms
             JOIN users mu ON mu.id = ms.user_id
             LEFT JOIN ranks mrank ON mrank.id = mu.rank_id
             LEFT JOIN LATERAL fn_user_atlas_shares(ms.user_id, a.id) ef ON true
             WHERE ms.user_id <> a.owner_id
             ORDER BY ord, nome
             LIMIT 10
           ) m
         ), '[]'::json) AS members,
         (c.atlas_id IS NOT NULL) AS has_cover,
         c.updated_at AS cover_updated_at
  FROM atlas a
  LEFT JOIN atlas_covers c ON c.atlas_id = a.id
  LEFT JOIN fn_user_atlas_shares($1::uuid) us ON us.atlas_id = a.id
  WHERE a.deleted_at IS NULL
    AND (
      a.owner_id = $1
      OR us.atlas_id IS NOT NULL
    )
`;

// As capas dos atlas que o chamador alcança, num pedido só. O escopo é o MESMO predicado de
// LIST_USER_ATLAS (dono ou compartilhado com ele, direto ou por grupo vivo): sem isso a rota
// entregaria a capa de qualquer atlas a quem soubesse o id, que é o vazamento clássico de rota de
// listagem sem filtro. "O MESMO predicado" é literal — as três listagens deste arquivo chamam
// `fn_user_atlas_shares`, e divergir aqui faria o cartão aparecer sem capa (ou a capa aparecer sem
// cartão) para quem entra por grupo.
export const LIST_USER_ATLAS_COVERS = `
  SELECT c.atlas_id, c.mime_type, c.bytes, c.updated_at
  FROM atlas_covers c
  JOIN atlas a ON a.id = c.atlas_id
  LEFT JOIN fn_user_atlas_shares($1::uuid) us ON us.atlas_id = a.id
  WHERE a.deleted_at IS NULL
    AND (
      a.owner_id = $1
      OR us.atlas_id IS NOT NULL
    )
`;

export const UPSERT_ATLAS_COVER = `
  INSERT INTO atlas_covers (atlas_id, mime_type, bytes, width, height, updated_by)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (atlas_id) DO UPDATE
    SET mime_type = EXCLUDED.mime_type,
        bytes = EXCLUDED.bytes,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
  RETURNING atlas_id, mime_type, width, height, updated_at
`;

export const DELETE_ATLAS_COVER = `
  DELETE FROM atlas_covers
  WHERE atlas_id = $1
  RETURNING atlas_id
`;

export const GET_ATLAS_MAPS_SUMMARY = `
  SELECT id, name, created_at, updated_at
  FROM maps
  WHERE atlas_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;

/**
 * Todas as REFERÊNCIAS a recurso de catálogo que este atlas carrega, distintas, numa
 * consulta só.
 *
 * A LISTA DE SUPERFÍCIES é `resource-reference.registry.js`, e esta consulta é a
 * materialização dela do lado do servidor: uma perna por linha do registro, exceto as duas
 * que não são referência (`maps.analysis_layers`) ou que não têm coluna própria.
 *
 * O CUSTO É CONSTANTE NO TAMANHO DO ATLAS: uma ida ao banco, `DISTINCT` no servidor. A
 * alternativa (colher em JS a partir das linhas que o clone já lê) obrigaria a reordenar
 * `cloneMapSubEntities`, que é COMPARTILHADO com `duplicateMap` — e duplicar um mapa não
 * cruza fronteira nenhuma, então não pode ganhar poda por tabela.
 *
 * A referência de camada de catálogo NÃO é resolvida aqui: o prefixo (`analysis-`,
 * `data-`) e as duas formas legadas (`originalId`, `config.id`) têm UMA definição, em
 * `catalog-layer.ref.js`, e reescrevê-la em SQL seria a segunda cópia da regra. O que sai
 * daqui é o par (id, type) cru, e quem o resolve é o JS.
 *   $1 = atlasId
 */
export const COLLECT_ATLAS_RESOURCE_REFS = `
  SELECT DISTINCT origem, ref, tipo, payload FROM (
    SELECT 'mapa.baseLayer'::text AS origem, m.base_layer AS ref, NULL::text AS tipo,
           NULL::jsonb AS payload
      FROM maps m WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND m.base_layer IS NOT NULL
    UNION ALL
    -- A quarta coluna (o documento inteiro) NAO e conforto: sem ela a coleta e a
    -- aplicacao resolviam a MESMA entrada de formas diferentes. catalogLayerReference le o
    -- prefixo do id e, na falta dele, originalId/config.id, que so existem dentro de data.
    -- Colher sem o documento devolvia null para toda entrada LEGADA (nada classificado),
    -- enquanto manterCatalogLayer, que recebe data, ACHAVA a referencia e perguntava por
    -- uma chave nunca classificada: fecha-fechado, e a camada morria no clone MESMO SENDO
    -- PUBLICA. Perda de dado silenciosa num caminho irreversivel.
    SELECT 'mapa.catalogLayers', cl.id, cl.data->>'type', cl.data
      FROM catalog_layers cl
      JOIN maps m ON m.id = cl.map_id
     WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND cl.deleted_at IS NULL
    UNION ALL
    -- tileset_id e a COLUNA, e data->>'tilesetId' e o que o snapshot deixa vencer
    -- (sync.service.js monta {tilesetId: item.tileset_id, ...item.data}). O caminho normal
    -- do app grava os dois iguais; um .ebgeo escrito a mao, nao, e e para ele que a poda
    -- de import existe.
    SELECT 'cesium3d', COALESCE(c.tileset_id, c.data->>'tilesetId'), NULL, NULL
      FROM cesium3d_data c
      JOIN maps m ON m.id = c.map_id
     WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND c.deleted_at IS NULL
       AND COALESCE(c.tileset_id, c.data->>'tilesetId') IS NOT NULL
    UNION ALL
    SELECT 'sv360', COALESCE(s.photo_name, s.data->>'photoName'), NULL, NULL
      FROM streetview360_data s
      JOIN maps m ON m.id = s.map_id
     WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND s.deleted_at IS NULL
       AND COALESCE(s.photo_name, s.data->>'photoName') IS NOT NULL
    UNION ALL
    SELECT 'briefing.slide.modelId', sl.model_id, NULL, NULL
      FROM slides sl
      JOIN briefings b ON b.id = sl.briefing_id
     WHERE b.atlas_id = $1 AND b.deleted_at IS NULL AND sl.deleted_at IS NULL
       AND sl.model_id IS NOT NULL
    UNION ALL
    SELECT 'briefing.slide.photoId', sl.photo_id, NULL, NULL
      FROM slides sl
      JOIN briefings b ON b.id = sl.briefing_id
     WHERE b.atlas_id = $1 AND b.deleted_at IS NULL AND sl.deleted_at IS NULL
       AND sl.photo_id IS NOT NULL
    UNION ALL
    -- A FAMILIA DE atlas.settings, a que o inventario por NOME DE CAMPO nao enxergava:
    -- cinco allowlists e um padrao, todos ids de catalogo, todos copiados verbatim pelo
    -- clone ate esta onda. jsonb_typeof guarda cada perna porque jsonb_array_elements_text
    -- levanta erro sobre o que nao e array, e o documento pode ter chegado por import.
    SELECT 'settings.basemaps', v, NULL, NULL
      FROM atlas a
      CROSS JOIN LATERAL jsonb_array_elements_text(a.settings->'basemaps') AS v
     WHERE a.id = $1 AND jsonb_typeof(a.settings->'basemaps') = 'array'
    UNION ALL
    SELECT 'settings.available_data_layers', v, NULL, NULL
      FROM atlas a
      CROSS JOIN LATERAL jsonb_array_elements_text(a.settings->'available_data_layers') AS v
     WHERE a.id = $1 AND jsonb_typeof(a.settings->'available_data_layers') = 'array'
    UNION ALL
    SELECT 'settings.available_analysis_layers', v, NULL, NULL
      FROM atlas a
      CROSS JOIN LATERAL jsonb_array_elements_text(a.settings->'available_analysis_layers') AS v
     WHERE a.id = $1 AND jsonb_typeof(a.settings->'available_analysis_layers') = 'array'
    UNION ALL
    SELECT 'settings.available_3d_models', v, NULL, NULL
      FROM atlas a
      CROSS JOIN LATERAL jsonb_array_elements_text(a.settings->'available_3d_models') AS v
     WHERE a.id = $1 AND jsonb_typeof(a.settings->'available_3d_models') = 'array'
    UNION ALL
    SELECT 'settings.available_360_views', v, NULL, NULL
      FROM atlas a
      CROSS JOIN LATERAL jsonb_array_elements_text(a.settings->'available_360_views') AS v
     WHERE a.id = $1 AND jsonb_typeof(a.settings->'available_360_views') = 'array'
    UNION ALL
    SELECT 'settings.default_basemap', a.settings->>'default_basemap', NULL, NULL
      FROM atlas a
     WHERE a.id = $1 AND jsonb_typeof(a.settings->'default_basemap') = 'string'
  ) todas
`;
