// Path: src/modules/streetview360/sv360.admin.schemas.js
// Joi schemas for the StreetView 360 ADMIN / INGESTION path (Fase 9, stage 3a).
// Kept SEPARATE from sv360.schemas.js (read params) and sv360.write.schemas.js
// (calibration bodies). Validation errors are translated to the FROZEN flat
// { error: '...' } envelope by the router-level sv360ErrorHandler.
//
// The manifest is the project's FULL state (not a delta) — the studio re-exports
// the whole project each time and ingestion is "last upload wins" by
// (organization_id, slug). The exact studio format is an assumption flagged in
// the SPEC (docs/plano/fase-9-absorver-360.md); this schema maps 1:1 onto the
// real §4.3 / 007_sv360.sql columns.
//
// What it rejects (the contract the SPEC's validateManifest must enforce):
//   - NaN / Infinity in ANY numeric (Joi.number() rejects non-finite);
//   - lat ∉ [-90,90] / lon ∉ [-180,180];
//   - missing required NOT NULL columns (id, original_name, sequence_number,
//     lat, lon, full_size_bytes, preview_size_bytes);
//   - db_filename containing a path separator (basename only — traversal guard);
//   - duplicate sequence_number within photos[] (UNIQUE(project_id, seq));
//   - a target whose source_id/target_id is not a photo id present in photos[]
//     (referential integrity INSIDE the bundle) — enforced by .custom() below;
//   - a capture_date without an explicit zone (see §capture_date below): the
//     column is TIMESTAMPTZ, and a zoneless string resolves against the ambient
//     zone, so the same bundle would land on two different instants on two hosts.
import Joi from 'joi';
import { slugParamSchema } from './sv360.schemas.js';
import {
  isZonedInstant,
  isNaiveIso,
  captureDateZoneMessage,
  captureDateFormatMessage,
} from './sv360.merge.js';

// Re-export the shared :slug param schema so the admin routes/controller have a
// single import surface (params validation for status/delete/get).
export { slugParamSchema };

// Photo id — the studio's deterministic uuidv5 (D9.6), OR the v4 that the legacy
// index.db corpus carries. The backend validates the FORMAT and trusts the id; it
// does NOT recompute it. A v5-only guard here would 422 the ingestion of every
// legacy bundle, i.e. block the migration itself. See sv360.schemas.js.
const photoId = Joi.string()
  .trim()
  .guid({ version: ['uuidv4', 'uuidv5'] });

// A finite number (Joi.number() already rejects NaN/Infinity/non-numeric).
const finiteNumber = Joi.number();

// db_filename: OPTIONAL and IGNORED (FIX-1). The {slug}.db filename is DERIVED
// server-side from (organization_id, slug) in sv360.merge.js (deriveDbFilename),
// so a malicious manifest cannot point the store at another OM's file. We still
// accept the field for backward-compat (older bundles include it) but only
// validate it as a harmless basename when present — it is never written.
const dbFilename = Joi.string()
  .trim()
  .min(1)
  .max(255)
  .pattern(/[/\\]/, { invert: true })
  .messages({
    'string.pattern.invert.base': 'db_filename deve ser um nome de arquivo, sem separador de caminho.',
  });

// capture_date — the photo's capture INSTANT (sv360.photos.capture_date is
// TIMESTAMPTZ). The zone is REQUIRED, and this is deliberately NOT `isoDate()`:
// Joi's isoDate coercion pipes the string through `new Date()`, which reads a
// zoneless value in the Node process TZ, so `2025-03-17T09:58:14` became
// `...T12:58:14Z` on a UTC-3 server and `...T09:58:14Z` on a UTC one — the same
// manifest, two instants, no error either way. Rationale, and why rejecting beats
// assuming, in sv360.merge.js (§capture instant); mergeProject re-checks it because
// the ETL CLI never passes through Joi.
//
// The value is passed through VERBATIM (no normalization): once the zone is
// explicit the string is already an unambiguous instant for TIMESTAMPTZ, and not
// re-parsing it is what keeps any ambient zone out of the pipeline.
const captureDate = Joi.string()
  .trim()
  .custom((value, helpers) => {
    if (isZonedInstant(value)) return value;
    return helpers.error(isNaiveIso(value) ? 'sv360.captureDateZone' : 'sv360.captureDateFormat');
  })
  .messages({
    'sv360.captureDateZone': captureDateZoneMessage('{{#label}}'),
    'sv360.captureDateFormat': captureDateFormatMessage('{{#label}}'),
  });

// --- project ---------------------------------------------------------------

const projectSchema = Joi.object({
  // Charset matches `sanitizeSlug` (sv360.merge.js), UNDERSCORE INCLUDED: the real
  // corpus slugs are `27o_gac`, `ponta_grossa_1`, `santana_livramento`. Kebab-only
  // here would 422 the upload of a project the ETL can already import, so the two
  // ingestion paths would disagree about what a valid project is.
  slug: Joi.string()
    .trim()
    .pattern(/^[a-z0-9_-]+$/)
    .min(1)
    .max(255)
    .required()
    .messages({
      'string.pattern.base': 'Identificador do projeto aceita apenas letras minúsculas, números, hífen e sublinhado.',
    }),
  name: Joi.string().trim().min(1).max(512).required(),
  // OPTIONAL: resolved to organization_id by the service (global admin may set any
  // OM; a PRODUCER is forced to its own `producer_org_id`, and a slug resolving to a
  // different OM is a 403 in `resolveUploadOrgId`). Default org if omitted. This note
  // said `om_data_admin`, an axis removed with its column in 2026-08-20.
  orgSlug: Joi.string().trim().min(1).max(255).allow(null),
  center_lat: finiteNumber.min(-90).max(90).allow(null),
  center_long: finiteNumber.min(-180).max(180).allow(null),
  // Optional LOGICAL ref to a photos.id (NOT a DB FK); the photo need not exist.
  entry_photo_id: Joi.string().trim().max(255).allow(null),
  // OPTIONAL + IGNORED (FIX-1) — derived server-side from (org, slug). Still
  // validated as a harmless basename when present, but never used.
  db_filename: dbFilename.optional().allow(null),
}).unknown(true);

// --- photo -----------------------------------------------------------------

const photoSchema = Joi.object({
  id: photoId.required(),
  original_name: Joi.string().trim().min(1).max(512).required(),
  display_name: Joi.string().trim().max(512).allow(null),
  sequence_number: Joi.number().integer().required(),
  lat: finiteNumber.min(-90).max(90).required(),
  lon: finiteNumber.min(-180).max(180).required(),
  ele: finiteNumber.allow(null),
  heading: finiteNumber.allow(null),
  mesh_rotation_x: finiteNumber.allow(null),
  mesh_rotation_y: finiteNumber.allow(null),
  mesh_rotation_z: finiteNumber.allow(null),
  floor_level: Joi.number().integer().allow(null),
  // The floor's NAME on screen. A separate column from floor_level because two
  // spaces on the SAME level can be named differently ('Externo' and 'Campo' are
  // both level 0 in the Beira-Rio survey), so the label is not derivable from the
  // number. Null for a flat project, which has no floor to name.
  floor_label: Joi.string().trim().max(255).allow(null, ''),
  // The O(1) ETag source — a non-negative integer matching the images.db BLOB byte
  // length (the cross-check against the actual BLOB is done by the service's
  // validateImagesDb, not here).
  //
  // OPCIONAIS COM DEFAULT 0 desde 2026-08-20, e a mudanca e de CONTRATO CONGELADO,
  // tomada de proposito. A origem aposentou `full_webp`/`preview_webp` e o acervo
  // passou a ser so piramide de tiles: um manifesto desses simplesmente NAO TEM
  // tamanho de blob para declarar. Enquanto os dois campos eram `.required()`, o
  // manifesto novo morria na borda Joi, antes de qualquer leitura de arquivo, com
  // uma mensagem sobre campo ausente que nao diz nada sobre o formato do acervo.
  //
  // Afrouxar aqui NAO afrouxa a exigencia de pixel: quem cobra passou a ser
  // `validateImagesDb`, que ao ver `images` sem as colunas de blob EXIGE o
  // `{slug}_tiles.db` com piramide cobrindo toda foto viva. A guarda foi TROCADA,
  // e o zero significa "esta foto nao tem blob", nunca "nao conferimos".
  full_size_bytes: Joi.number().integer().min(0).optional().default(0),
  preview_size_bytes: Joi.number().integer().min(0).optional().default(0),
  calibration_reviewed: Joi.boolean().allow(null),
  capture_date: captureDate.allow(null),
}).unknown(true);

// --- target ----------------------------------------------------------------

const targetSchema = Joi.object({
  source_id: photoId.required(),
  target_id: photoId.required(),
  distance_m: finiteNumber.allow(null),
  bearing_deg: finiteNumber.allow(null),
  is_next: Joi.boolean().allow(null),
  is_original: Joi.boolean().allow(null),
  override_bearing: finiteNumber.allow(null),
  hidden: Joi.boolean().allow(null),
}).unknown(true);

// --- tombstone -------------------------------------------------------------

// `deleted_at` keeps `isoDate()` (zone optional) ON PURPOSE, unlike capture_date.
// It is not an oversight of the same defect: the ETL carries this value verbatim
// out of the legacy index.db, where the column is TEXT and zoneless, so demanding
// a zone here would reject the very corpus the ETL already imports while the ETL
// path itself (which never sees this schema) kept writing it. Nothing READS the
// column either — every visibility query is `NOT EXISTS(deleted_photos)`, never a
// comparison against the time — so a shifted tombstone instant costs nothing,
// whereas a shifted capture instant reorders capture runs and rotates the solar
// calibration. Revisit together with the ETL, not alone.
const tombstoneSchema = Joi.object({
  photo_id: photoId.required(),
  deleted_at: Joi.string().isoDate().allow(null),
}).unknown(true);

// --- capture track ---------------------------------------------------------

// One capture-run segment: a [lon, lat] polyline. A project is MANY runs (the
// legacy corpus averages ~115 per project), so this is source data, not something
// derivable from the photo sequence. >= 2 points, because a 1-point LINESTRING is
// rejected by PostGIS. Ranges match the photo lat/lon bounds.
const trackSchema = Joi.object({
  coords: Joi.array()
    .items(
      Joi.array()
        .ordered(finiteNumber.min(-180).max(180).required(), finiteNumber.min(-90).max(90).required())
        .length(2)
    )
    .min(2)
    .required(),
  source: Joi.string().trim().max(64).allow(null),
}).unknown(true);

// --- floor -----------------------------------------------------------------

// One floor of a project (sv360.project_floors, `007_sv360.sql`). The LIST of these
// rows is what declares "this project has floors" and makes the interface draw the
// floor selector, so an empty floors[] is the normal shape of a street-level
// survey, never a defect.
//
// `level` is an ordered INTEGER, negative allowed: 0 is the ground, 1 the first
// indoor floor above it, -1 the first basement (see
// ebgeo_360 scripts/lib/floors.js). `label` is REQUIRED and not derived from the
// level, because two spaces at the same level can carry different names.
//
// `plan_coords` is the floor plan: a list of LineStrings, [[[lon,lat],...],...],
// the same shape project_tracks.coords uses. Null for a level that exists but has
// no plan drawn. >= 2 points per line, like a track: a 1-point line is not a line.
const floorSchema = Joi.object({
  level: Joi.number().integer().required(),
  label: Joi.string().trim().min(1).max(255).required(),
  plan_coords: Joi.array()
    .items(
      Joi.array()
        .items(
          Joi.array()
            .ordered(
              finiteNumber.min(-180).max(180).required(),
              finiteNumber.min(-90).max(90).required()
            )
            .length(2)
        )
        .min(2)
    )
    .allow(null),
}).unknown(true);

// --- aggregate manifest ----------------------------------------------------

// .custom() enforces the two cross-array invariants Joi cannot express
// field-locally: duplicate sequence_number within photos[], and a target whose
// source_id/target_id does not reference a photo id present in photos[].
export const manifestSchema = Joi.object({
  schemaVersion: Joi.number().integer().min(1).default(1),
  project: projectSchema.required(),
  photos: Joi.array().items(photoSchema).min(1).required(),
  targets: Joi.array().items(targetSchema).default([]),
  deleted_photos: Joi.array().items(tombstoneSchema).default([]),
  // Optional: a bundle without tracks leaves the project with none, and the tile
  // falls back to synthesizing the line from the photo sequence.
  tracks: Joi.array().items(trackSchema).default([]),
  // Optional: a bundle without floors leaves the project with none, which is what
  // a street-level survey is. The merge PURGES and reinserts the whole list, so an
  // EXPLICIT empty array is how a project drops its floors.
  floors: Joi.array().items(floorSchema).default([]),
})
  .unknown(true)
  .custom((value, helpers) => {
    const photoIds = new Set();
    const seqs = new Set();
    for (const p of value.photos) {
      if (seqs.has(p.sequence_number)) {
        return helpers.message(
          `Duplicate sequence_number ${p.sequence_number} within photos[]`
        );
      }
      seqs.add(p.sequence_number);
      photoIds.add(p.id);
    }
    for (const tg of value.targets || []) {
      if (!photoIds.has(tg.source_id)) {
        return helpers.message(`Target source_id ${tg.source_id} not present in photos[]`);
      }
      if (!photoIds.has(tg.target_id)) {
        return helpers.message(`Target target_id ${tg.target_id} not present in photos[]`);
      }
    }
    // sv360.project_floors is keyed PK(project_id, level), so a repeated level
    // would abort the whole merge on a constraint violation, an opaque 500 for
    // what is a plain malformed bundle. Caught here as a 422 naming the level.
    const levels = new Set();
    for (const fl of value.floors || []) {
      if (levels.has(fl.level)) {
        return helpers.message(`Duplicate floor level ${fl.level} within floors[]`);
      }
      levels.add(fl.level);
    }
    return value;
  }, 'manifest referential integrity');

// --- request schemas (params / body / query) -------------------------------

// PATCH /admin/projects/:slug/status — { status: 'enabled' | 'disabled' }.
// Mirrors the sv360.projects.status CHECK constraint.
export const statusBodySchema = Joi.object({
  status: Joi.string().valid('enabled', 'disabled').required(),
}).unknown(false);

// PATCH /admin/projects/:slug — METADADO editável do projeto. Hoje um campo só.
//
// `.unknown(false)` E `.min(1)` SÃO OS DOIS LADOS DA MESMA CERCA: o objeto fechado faz
// uma chave inventada morrer em 422 na borda em vez de ser ignorada em silêncio (que é
// como um cliente acredita ter gravado algo), e o `.min(1)` recusa o PATCH vazio, que
// escreveria `updated_at` e uma linha de trilha sem ter mudado nada.
//
// AS BORDAS DO ENDEREÇO SÃO AS MESMAS DO CATÁLOGO (`catalog.schemas.js`) e precisam
// continuar sendo, `.trim()` e `/i` inclusive: um `DATA:` recusado numa tabela e aceito na
// outra é a mesma chave com duas regras, e foi assim que a primeira versão desta borda saiu
// (o padrão era `/^(?!data:)/`, que a caixa alta e o espaço à esquerda contornam, os dois
// medidos contra o Joi real). O teto de tamanho é o `max(2048)`; esta regra recusa mídia
// EMBUTIDA, de qualquer tamanho. A duplicação é literal e pequena de propósito —
// importar o schema do catálogo aqui acoplaria o módulo 360 (que tem envelope de erro
// PRÓPRIO, plano) ao módulo de catálogo.
//
// `allow('', null)` porque esvaziar o campo é como o painel REMOVE o vídeo; o serviço
// normaliza os dois para NULL na coluna, e o `.trim()` faz um `'   '` chegar lá como `''`
// em vez de virar um endereço de três espaços.
export const projectMetadataBodySchema = Joi.object({
  previewVideo: Joi.string()
    .trim()
    .max(2048)
    .pattern(/^(?!\s*data:)/i)
    .allow('', null)
    .messages({
      'string.pattern.base': 'O vídeo de prévia é um endereço, não um arquivo embutido (data URL).',
    }),
  // O NOME é o display, não o slug: renomear não toca `slug`, `db_filename` nem os arquivos
  // SQLite, que continuam chaveados por `{orgId}__{slug}`. Por isso é editável sem risco. Não
  // aceita vazio (a coluna é NOT NULL); a ausência do campo mantém o nome atual.
  name: Joi.string().trim().min(1).max(255),
  // A DESCRIÇÃO aceita vazio: a coluna é NULL-ável, e `''` é como o formulário diz "sem
  // descrição". A ausência do campo mantém a atual (atualização parcial, como o vídeo).
  description: Joi.string().trim().max(5000).allow('', null),
  // OS CAMPOS DO CARTÃO DE CATÁLOGO (paralelo do 3D): palavra-chave, local, data de captura e o
  // centro (longitude/latitude do marcador). Todos NULL-áveis e parciais. `keywords` é ARRAY de
  // texto (o cartão itera sobre ela); `[]` e null viram "sem palavra-chave".
  keywords: Joi.array().items(Joi.string().trim().max(100)).max(50).allow(null),
  location: Joi.string().trim().max(255).allow('', null),
  captureDate: Joi.string().trim().max(100).allow('', null),
  centerLat: Joi.number().min(-90).max(90).allow(null),
  centerLong: Joi.number().min(-180).max(180).allow(null),
}).min(1).unknown(false);

// PATCH /admin/projects/:slug/owner-org — a OM dona NOVA. Não aceita null: projeto 360
// não tem estado institucional (a OM entra no upload e é obrigatória). A transferência é
// TROCA DE COLUNA: o arquivo em disco não é renomeado, porque as leituras o resolvem pela
// coluna `db_filename` gravada, nunca por (orgId, slug) recalculado. Só administrador.
export const ownerOrgBodySchema = Joi.object({
  owner_org_id: Joi.string().guid().required(),
}).unknown(false);

// GET /admin/projects — optional ?orgId filter (a global admin may scope the list
// to a single OM). Non-admins ignore it (forced to their own org in the service).
export const listAdminQuerySchema = Joi.object({
  // L9 — ANY uuid version, not just v4: the seeded default organization is
  // `00000000-0000-0000-0000-000000000001`, which is not a v4, so pinning v4
  // made `?orgId=<default org>` 422 — rejecting the single most likely value.
  orgId: Joi.string().guid(),
}).unknown(true);

// PATCH/DELETE /admin/projects/:slug[/status] — optional ?orgId / ?orgSlug used by
// a global admin to disambiguate a slug owned by ≥2 OMs (FIX-5). Validated so a
// MALFORMED ?orgId yields a clean 422 (Joi → frozen { error }) via the generic
// `validate` middleware + sv360 error handler, instead of a 500 when the value
// reaches the SQL uuid cast in the service. orgSlug is a free token.
export const orgScopeQuerySchema = Joi.object({
  // Any uuid version — same reason as listAdminQuerySchema (L9): the default org
  // id is not a v4, so a v4-only rule 422s the most common scoping value.
  orgId: Joi.string().guid(),
  orgSlug: Joi.string().trim().min(1).max(255),
}).unknown(true);
