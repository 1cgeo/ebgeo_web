// Path: src/modules/streetview360/sv360.admin.queries.js
// Named SQL constants for the StreetView 360 ADMIN / INGESTION / ETL path (Fase 9,
// stage 3a). Kept SEPARATE from sv360.queries.js (read) and sv360.write.queries.js
// (calibration) so neither earlier stage is touched.
//
// Conventions (_padroes §8):
//   - 100% parametrized ($1..$N); never string-interpolate input.
//   - All names UPPER_SNAKE_CASE, verb + entity.
//   - Column names are the REAL ones from 007_sv360.sql.
//   - The shared merge core (sv360.merge.js) is the ONLY caller that runs the
//     UPSERT / PURGE / INSERT_* / collision queries, inside a single tx `t`.
//
// Real columns (007_sv360.sql):
//   sv360.projects (id, organization_id, slug, name, center_lat, center_long,
//                   entry_photo_id, photo_count, db_filename, status,
//                   created_at, updated_at)  UNIQUE(slug)
//   sv360.photos   (id TEXT PK, project_id, original_name, display_name,
//                   sequence_number, lat, lon, ele, heading,
//                   mesh_rotation_x/y/z,
//                   floor_level, floor_label, full_size_bytes,
//                   preview_size_bytes,
//                   calibration_reviewed, capture_date, geom (trigger), ...)
//   sv360.project_floors (project_id, level, label, plan_coords JSONB)
//                   PK(project_id, level), migration 007_sv360.sql
//   sv360.targets  (source_id, target_id, distance_m, bearing_deg, is_next,
//                   is_original, override_bearing, hidden)
//                   PK(source_id, target_id)
//   sv360.deleted_photos (photo_id PK, deleted_at)

// -------------------------------------------------------------------------
// Org resolution
// -------------------------------------------------------------------------

// Resolve an organization_id from its slug. Used by the ETL backfill path
// (orgSlug -> public.organizations.id). Returns one row or none.
//   $1 = slug (text)
export const RESOLVE_ORG_BY_SLUG = `
  SELECT id
  FROM public.organizations
  WHERE slug = $1
`;

// -------------------------------------------------------------------------
// Cross-OM collision guard (runs BEFORE any write)
// -------------------------------------------------------------------------

// For the manifest's photo ids, return any id that ALREADY belongs to a project
// OTHER than the upload's TARGET (organization_id, slug) — covering BOTH a
// cross-OM collision AND a same-org cross-project collision (FIX-6). sv360.photos.id
// is a GLOBAL PK, so an id owned by a sibling project of the SAME org would still
// blow the INSERT with an opaque 500; this guard turns it into a clean 409. The
// normal re-upload case (same org AND same slug = the target project) is excluded,
// so a project re-uploading its own ids is never flagged.
//   $1 = photo ids (text[]), $2 = orgId (uuid), $3 = slug (text)
export const CHECK_PHOTO_IDS_IN_OTHER_PROJECT = `
  SELECT p.id, pr.organization_id, pr.slug
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE p.id = ANY($1::text[])
    AND NOT (pr.organization_id = $2::uuid AND pr.slug = $3)
`;

// -------------------------------------------------------------------------
// Project upsert (last-upload-wins by organization_id, slug)
// -------------------------------------------------------------------------

// Read a project by (organization_id, slug) for the admin/merge path. Includes
// the fields a swap-compensation snapshot needs (status/created_at/db_filename).
//   $1 = organization_id (uuid), $2 = slug (text)
export const GET_PROJECT_FOR_ADMIN = `
  SELECT id, organization_id, slug, name, description, location, keywords, capture_date,
         center_lat, center_long,
         entry_photo_id, photo_count, db_filename, status, preview_video,
         created_at, updated_at
  FROM sv360.projects
  WHERE organization_id = $1::uuid AND slug = $2
`;

// Upsert the project row by its UNIQUE(organization_id, slug). On INSERT the
// status defaults to 'enabled' and created_at to now(). On CONFLICT (re-upload)
// status and created_at are PRESERVED (NOT in the SET list); only the mutable
// metadata + updated_at change. Returns the row (id is the captured project_id).
//   $1 = organization_id (uuid), $2 = slug, $3 = name,
//   $4 = center_lat, $5 = center_long, $6 = entry_photo_id,
//   $7 = photo_count, $8 = db_filename
export const UPSERT_PROJECT = `
  INSERT INTO sv360.projects
    (organization_id, slug, name, center_lat, center_long,
     entry_photo_id, photo_count, db_filename)
  VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (slug) DO UPDATE SET
     name           = EXCLUDED.name,
     center_lat     = EXCLUDED.center_lat,
     center_long    = EXCLUDED.center_long,
     entry_photo_id = EXCLUDED.entry_photo_id,
     photo_count    = EXCLUDED.photo_count,
     db_filename    = EXCLUDED.db_filename,
     updated_at     = now()
  WHERE sv360.projects.organization_id = EXCLUDED.organization_id
  RETURNING id, organization_id, slug, name, center_lat, center_long,
            entry_photo_id, photo_count, db_filename, status,
            created_at, updated_at
`;

// -------------------------------------------------------------------------
// Transferência de OM dona (só-admin) — TROCA DE COLUNA, sem tocar o disco.
// -------------------------------------------------------------------------

// A OM destino existe e está ativa? (400 se não, em vez de violar a FK com 500.)
//   $1 = organization_id (uuid)
export const CHECK_ORG_ACTIVE = `
  SELECT id FROM public.organizations WHERE id = $1::uuid AND is_active = true
`;

// A OM destino já tem um projeto com este slug? (o UNIQUE(org, slug) proíbe dois.)
//   $1 = organization_id (uuid destino), $2 = slug
export const CHECK_SLUG_IN_ORG = `
  SELECT id FROM sv360.projects WHERE organization_id = $1::uuid AND slug = $2
`;

// Move a OM dona. `db_filename` NÃO muda: as leituras o resolvem pela coluna gravada,
// então o arquivo `{orgOrig}__{slug}.db` continua sendo achado. Renomear seria trabalho
// de disco sem efeito de leitura, e é o que esta rota EVITA de propósito.
//   $1 = project id (uuid), $2 = nova organization_id (uuid)
export const TRANSFER_PROJECT_OWNER = `
  UPDATE sv360.projects
     SET organization_id = $2::uuid, updated_at = now()
   WHERE id = $1::uuid
  RETURNING id, organization_id, slug, name, description, center_lat, center_long,
            entry_photo_id, photo_count, db_filename, status, preview_video,
            created_at, updated_at
`;

// -------------------------------------------------------------------------
// Purge of a project's CHILD rows (the project row itself is preserved by the
// upsert above). Order: targets -> photos -> tombstones. Deleting targets first
// is explicit (ON DELETE CASCADE on photos would also clear them) so the
// reinsert never trips an FK on a half-cleared adjacency.
// -------------------------------------------------------------------------

// Delete every directed link whose SOURCE photo belongs to the project. Targets
// are keyed off source/target photo ids, so scope by the project's photos.
//   $1 = project_id (uuid)
export const PURGE_PROJECT_TARGETS = `
  DELETE FROM sv360.targets
  WHERE source_id IN (SELECT id FROM sv360.photos WHERE project_id = $1::uuid)
     OR target_id IN (SELECT id FROM sv360.photos WHERE project_id = $1::uuid)
`;

// Delete the project's photos (CASCADE would also clear remaining targets, but
// PURGE_PROJECT_TARGETS already ran). Returns the ids removed so the caller can
// purge their tombstones.
//   $1 = project_id (uuid)
export const PURGE_PROJECT_PHOTOS = `
  DELETE FROM sv360.photos
  WHERE project_id = $1::uuid
  RETURNING id
`;

// Drop tombstones for the project's OLD photo ids (deleted_photos has no FK, so
// it must be cleared explicitly). Carried-over tombstones are re-inserted from
// the manifest's deleted_photos[] afterwards.
//   $1 = photo ids (text[])
export const PURGE_PROJECT_TOMBSTONES = `
  DELETE FROM sv360.deleted_photos
  WHERE photo_id = ANY($1::text[])
`;

// -------------------------------------------------------------------------
// Reinsert of the manifest state
// -------------------------------------------------------------------------

// Insert one photo. geom is filled by trg_sv360_photos_geom from lon/lat — never
// written here. id is the client-supplied deterministic UUID v5 (TEXT, no
// default). Ordered to match the manifest 1:1 with the §4.3 columns.
//   $1  = id (text uuid v5)        $2  = project_id (uuid)
//   $3  = original_name            $4  = display_name
//   $5  = sequence_number          $6  = lat
//   $7  = lon                      $8  = ele
//   $9  = heading                  $10 = mesh_rotation_x
//   $11 = mesh_rotation_y          $12 = mesh_rotation_z
//   $13 = floor_level              $14 = full_size_bytes
//   $15 = preview_size_bytes       $16 = calibration_reviewed
//   $17 = capture_date             $18 = floor_label
//
// $18 (`sv360.photos.floor_label`) was MISSING from this list until the floors
// port. The column exists in sv360.photos and the origin carries a label on every
// photo of a project with floors, so the ingestion accepted the field, dropped it
// and answered 201: a Beira-Rio photo landed with `floor_label` NULL and the
// viewer had no name to print for the floor it was standing on. Nothing failed:
// the write simply ignored a column nobody had listed.
export const INSERT_PHOTO = `
  INSERT INTO sv360.photos
    (id, project_id, original_name, display_name, sequence_number,
     lat, lon, ele, heading,
     mesh_rotation_x, mesh_rotation_y, mesh_rotation_z,
     floor_level, full_size_bytes, preview_size_bytes, calibration_reviewed, capture_date,
     floor_label)
  VALUES
    ($1, $2::uuid, $3, $4, $5,
     $6, $7, $8, $9,
     $10, $11, $12,
     $13, $14, $15, $16, $17,
     $18)
`;

// Insert one directed adjacency link. Same column order/semantics as the stage-2
// write INSERT_TARGET; duplicated here so the merge core has no cross-stage
// coupling. All FKs are satisfied because photos[] are inserted first.
//   $1 = source_id, $2 = target_id, $3 = distance_m, $4 = bearing_deg,
//   $5 = is_next, $6 = is_original, $7 = override_bearing, $8 = hidden
export const INSERT_TARGET = `
  INSERT INTO sv360.targets
    (source_id, target_id, distance_m, bearing_deg, is_next, is_original,
     override_bearing, hidden)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

// Drop the project's capture tracks before reinserting the manifest's (same
// purge-then-reinsert shape as photos/targets — "último upload manda").
//   $1 = project_id (uuid)
export const PURGE_PROJECT_TRACKS = `
  DELETE FROM sv360.tracks WHERE project_id = $1::uuid
`;

// Insert one capture track. The geometry arrives as a GeoJSON LineString string
// (built from the manifest's coordinate array) rather than WKT: ST_GeomFromGeoJSON
// takes the coordinates as DATA in a bind param, so no coordinate is ever
// concatenated into SQL text.
//   $1 = project_id (uuid), $2 = GeoJSON LineString (text), $3 = source (text)
export const INSERT_TRACK = `
  INSERT INTO sv360.tracks (project_id, geom, source)
  VALUES ($1::uuid, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), $3)
`;

// Drop the project's floors before reinserting the manifest's (same purge-then-
// reinsert shape as photos/targets/tracks, "último upload manda"). The rows keyed
// (project_id, level) are the LIST the floor selector reads, so a level removed
// upstream has to disappear here too; an UPSERT alone would leave it behind
// forever.
//   $1 = project_id (uuid)
export const PURGE_PROJECT_FLOORS = `
  DELETE FROM sv360.project_floors WHERE project_id = $1::uuid
`;

// Insert one floor of a project. `plan_coords` is JSONB here and TEXT-with-JSON in
// the origin (SQLite has no better type), so the caller passes an already
// serialized JSON string and the cast validates the FORM on write: a malformed
// plan fails the merge instead of reaching the client as a broken layer.
//   $1 = project_id (uuid), $2 = level (int), $3 = label (text),
//   $4 = plan_coords (json text, nullable)
export const INSERT_FLOOR = `
  INSERT INTO sv360.project_floors (project_id, level, label, plan_coords)
  VALUES ($1::uuid, $2, $3, $4::jsonb)
`;

// Re-insert a carried-over photo tombstone. Idempotent on the PK.
//   $1 = photo_id (text), $2 = deleted_at (timestamptz, nullable -> now())
export const INSERT_TOMBSTONE = `
  INSERT INTO sv360.deleted_photos (photo_id, deleted_at)
  VALUES ($1, COALESCE($2::timestamptz, now()))
  ON CONFLICT (photo_id) DO NOTHING
`;

// -------------------------------------------------------------------------
// Admin lifecycle (status / list / delete) — used by sv360.admin.service.js
// -------------------------------------------------------------------------

// Toggle a project's public visibility. status CHECK ('enabled','disabled') is
// enforced by the schema; the Joi schema mirrors it. Returns the updated row.
//   $1 = organization_id (uuid), $2 = slug, $3 = status
export const UPDATE_PROJECT_STATUS = `
  UPDATE sv360.projects
     SET status = $3, updated_at = now()
   WHERE organization_id = $1::uuid AND slug = $2
  RETURNING id, organization_id, slug, name, center_lat, center_long,
            entry_photo_id, photo_count, db_filename, status,
            created_at, updated_at
`;

// METADADO DO PROJETO, editável no painel como no 3D: `preview_video`, `name`, `description`,
// `keywords`, `location`, `capture_date` e o centro (`center_lat`/`center_long`). Cresceu com o
// "360 paralelo do 3D" (2026-08-29); a versão anterior deste cabeçalho ainda dizia "hoje só
// preview_video", e é o tipo de comentário que mente calado depois que a query dobra de tamanho.
//
// TABELA ALVO É `sv360.projects`, mesma da linha de status logo acima. O `SET` é escrito por
// extenso (uma coluna por linha) e não montado a partir de input: a regra da casa é `SET`
// dinâmico só a partir de whitelist de colunas, e aqui a whitelist é o próprio corpo da query.
//
// ATUALIZAÇÃO PARCIAL POR CAMPO: cada coluna só muda quando o campo foi FORNECIDO (o booleano
// PAR de cada valor — `$4` para `$3`, `$6` para `$5`, e assim por diante), senão fica como está.
// Sem isso, uma renomeação que não mande o vídeo o apagaria, e uma troca de vídeo apagaria o nome.
// O booleano distingue "esvaziar" (valor NULL fornecido) de "não mexa" (não fornecido); e por
// isso o `''`/null do painel para vídeo/descrição/local vira NULL na coluna, "sem valor".
//   $1 = organization_id (uuid), $2 = slug, e daí em diante PARES (valor, fornecido?):
//   $3/$4 preview_video, $5/$6 name, $7/$8 description, $9/$10 keywords (text[]),
//   $11/$12 location, $13/$14 capture_date, $15/$16 center_lat, $17/$18 center_long.
export const UPDATE_PROJECT_METADATA = `
  UPDATE sv360.projects
     SET preview_video = CASE WHEN $4  THEN $3  ELSE preview_video END,
         name          = CASE WHEN $6  THEN $5  ELSE name END,
         description   = CASE WHEN $8  THEN $7  ELSE description END,
         keywords      = CASE WHEN $10 THEN $9::text[]        ELSE keywords END,
         location      = CASE WHEN $12 THEN $11               ELSE location END,
         capture_date  = CASE WHEN $14 THEN $13               ELSE capture_date END,
         center_lat    = CASE WHEN $16 THEN $15::double precision ELSE center_lat END,
         center_long   = CASE WHEN $18 THEN $17::double precision ELSE center_long END,
         updated_at = now()
   WHERE organization_id = $1::uuid AND slug = $2
  RETURNING id, organization_id, slug, name, description, location, keywords, capture_date,
            center_lat, center_long,
            entry_photo_id, photo_count, db_filename, status, preview_video,
            created_at, updated_at
`;

// Drop the tombstones of a project's photos. deleted_photos has NO FK, so the
// photos CASCADE of a project hard-delete does NOT reach it: without this the
// tombstones survive their photos and the next re-upload of the same bundle
// resurrects the rows into a NEW project_id whose PURGE_PROJECT_PHOTOS returns
// nothing — the ingest answers 201 while every read filters the photo out (404).
// MUST run in the SAME transaction as DELETE_PROJECT, BEFORE the CASCADE removes
// the photos this selects from (achado 53).
//   $1 = project_id (uuid)
export const PURGE_TOMBSTONES_BY_PROJECT = `
  DELETE FROM sv360.deleted_photos
  WHERE photo_id IN (SELECT id FROM sv360.photos WHERE project_id = $1::uuid)
`;

// HARD-delete a project row (CASCADE clears photos -> targets). The {slug}.db
// file is removed by the service AFTER blobPool.evict. Returns the deleted row
// (db_filename needed to locate the file on disk).
//   $1 = organization_id (uuid), $2 = slug
export const DELETE_PROJECT = `
  DELETE FROM sv360.projects
  WHERE organization_id = $1::uuid AND slug = $2
  RETURNING id, organization_id, slug, db_filename
`;

// List projects for the admin view INCLUDING disabled. Unlike the public
// LIST_PROJECTS, a global admin sees every OM (optionally filtered by ?orgId); a
// PRODUCER is scoped to the OM it produces for.
//
// O PREDICADO DEIXOU DE SER UM BOOLEANO DO JS (`$1::boolean AND ...`), que era a
// última cópia daquela forma no módulo: TRUE curto-circuitava a disjunção inteira,
// então um erro no cálculo não errava, ABRIA. `fn_can_produce_resource` resolve
// papel e escopo a partir do UUID, no banco, e diz as duas coisas de uma vez —
// administrador em qualquer linha, produtor nas da própria OM.
//
// REPARE QUE ELE NÃO É `fn_has_global_data_access`: esta é a superfície de
// ADMINISTRAÇÃO (devolve `db_filename`, o nome do store em disco), e o credenciado
// é papel de LEITURA de dado, não de administração do acervo.
//   - $1 = userId (uuid): quem pergunta;
//   - $2 = filterOrgId (uuid, nullable): o ?orgId OPCIONAL do administrador, que é
//     refinamento de listagem e nunca autorização.
// `access_level` viaja junto com `status` e é um EIXO DISTINTO dele: `disabled`
// oculta de todo mundo fora da OM dona, `private` restringe quem está de fora
// (D6). O painel do administrador mostra os dois lado a lado, e sem esta coluna
// ele teria de adivinhar um deles — que é como um eixo de acesso vira invisível
// para quem o administra.
export const LIST_PROJECTS_ADMIN = `
  SELECT id, organization_id, slug, name, description, location, keywords, capture_date,
         center_lat, center_long,
         entry_photo_id, photo_count, db_filename, status, access_level,
         preview_video,
         created_at, updated_at
  FROM sv360.projects
  WHERE fn_can_produce_resource($1::uuid, 'sv360_project', id::text)
    AND ($2::uuid IS NULL OR organization_id = $2::uuid)
  ORDER BY name
`;
