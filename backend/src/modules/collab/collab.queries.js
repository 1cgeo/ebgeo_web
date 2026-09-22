// Path: src/modules/collab/collab.queries.js
// The ONLY SQL of the collaboration module, and every statement here is a READ.
//
// Presence stays in memory and never writes (tests/ws/collab-presenca-sem-banco.test.js counts the
// writes of a socket cycle and demands zero). What changed on 2026-09-22 is that the VIEWER CONTEXT
// (which 3D model, walkable scene or 360 photo a person has open) names a catalog resource, and a
// name of a private resource may only reach who can see it (CONSTITUICAO.md, section 2). Deciding
// that is `fn_can_see_resource`, in the database, the same composed predicate every other surface
// asks; nothing in this module re-spells the rule.

import { RESOLVE_SV360_REFS } from '../resource-access/resource-access.queries.js';

/**
 * The 3D model (or walkable scene, which is a row of the same table) a viewer frame points at.
 *
 * `active = true` is part of the lookup on purpose, mirroring `canSeeCatalogResource` of the sync
 * write gate: a deactivated row is a resource nobody opens, and resolving its name for the roster
 * would publish a label the catalog itself no longer shows.
 *   $1 = tileset id
 */
export const RESOLVE_VIEWER_TILESET = `
  SELECT t.id, t.name AS nome, t.access_level AS nivel
    FROM tilesets t
   WHERE t.id = $1 AND t.active = true
`;

/**
 * The 360 PROJECT a photo key belongs to, plus the label of the photo itself.
 *
 * THE PHOTO KEY IS NOT THE ID `fn_can_see_resource` JUDGES: the predicate is about the project.
 * The translation is `RESOLVE_SV360_REFS`, COMPOSED here and never re-written, because a second
 * copy of its tie-break would name one project in the roster while the photo server delivered
 * another (the defect `CAN_SEE_SV360_REF` in `../sync/sync.queries.js` documents for the write gate).
 *
 * A DISABLED project is judged as PRIVATE. `fn_can_see_resource` does not read `status`, and the
 * catalog hides a disabled project from whoever does not maintain it; publishing its name to the
 * whole room because its `access_level` still says public would be the one presence surface where
 * a disabled project stayed visible.
 *
 * The photo label prefers `display_name` and falls back to `original_name`, skipping tombstoned
 * photos exactly as `RESOLVE_SV360_REFS` does.
 *   $1 = the photo key, as a one-element text[]; $2 = the SENDER's user id (uuid|null), which is
 *   the tie-break input of `RESOLVE_SV360_REFS` (the sender's own organization wins).
 */
export const RESOLVE_VIEWER_360 = `
  WITH resolvido AS (
${RESOLVE_SV360_REFS}
  )
  SELECT p.id::text AS id, p.name AS nome,
         CASE WHEN p.status = 'enabled' THEN p.access_level ELSE 'private' END AS nivel,
         (SELECT COALESCE(NULLIF(ph.display_name, ''), ph.original_name)
            FROM sv360.photos ph
           WHERE ph.project_id = p.id
             AND (ph.original_name = r.ref OR ph.id = r.ref)
             AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = ph.id)
           ORDER BY ph.sequence_number
           LIMIT 1) AS foto
    FROM resolvido r
    JOIN sv360.projects p ON p.id = r.project_id::uuid
`;

/**
 * Which of these recipients may see this PRIVATE resource, in the scope of THIS atlas, in ONE trip.
 *
 * The atlas of the room goes in, so the LOAN counts: a colleague who sees the model only because
 * the atlas lends it is entitled to read its name in the roster of that atlas, and the anonymous
 * public-link visitor (passed as NULL) sees exactly what the atlas lends and nothing else
 * (CONSTITUICAO.md, clause 6.3).
 *
 * `WITH ORDINALITY` is what maps each answer back to its recipient: NULL principals repeat, so the
 * uuid alone cannot be the join key.
 *   $1 = recipients (uuid|null)[]; $2 = atlas id; $3 = resource type; $4 = resource id;
 *   $5 = access level (the caller only asks for private rows, public ones need no question).
 */
export const WHO_SEES_VIEWER_RESOURCE = `
  SELECT x.i::int AS i,
         fn_can_see_resource(x.u, $2::uuid, $3::text, $4::text, $5::text) AS ok
    FROM unnest($1::uuid[]) WITH ORDINALITY AS x(u, i)
`;
