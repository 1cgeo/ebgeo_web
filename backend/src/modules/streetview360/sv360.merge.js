// Path: src/modules/streetview360/sv360.merge.js
// SHARED CORE of the StreetView 360 ingestion (Fase 9, stage 3a): the ONLY place
// that upserts a project + purges + reinserts its child rows. Reused by BOTH the
// admin multipart upload (sv360.admin.service.js) and the ETL CLI
// (scripts/sv360-import.js), so "last upload wins" semantics and the cross-OM
// collision guard are defined exactly once.
//
// Contract (per the stage-3a SPEC):
//   mergeProject(t, manifest, { orgId, source })
//     - runs ENTIRELY inside a pg-promise transaction task `t` (received, never
//       created here): it does NOT commit/rollback and does NOT touch the
//       filesystem — pure Postgres. The CALLER owns the tx() and the {slug}.db
//       file swap.
//     - "último upload manda" por (organization_id, slug): the bundle is the
//       project's FULL state (not a delta), so purge+reinsert is safe and
//       idempotent (rerunning the same manifest reproduces the same state).
//     - returns { projectId, dbFilename, photoCount } for the caller to drive the
//       tx commit + atomic file swap.
//
// Real columns: see src/database/migrations/007_sv360.sql. The geom of a
// photo is filled by trg_sv360_photos_geom from lon/lat — never written here.
import * as AQ from './sv360.admin.queries.js';
import { ConflictError, ValidationError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

// Deterministic default org id, semeado em `001_identidade.sql` (INSERT INTO organizations
// com o UUID fixo). Esta linha já apontou para uma migração que nunca existiu neste
// repositório, resíduo de um esmagamento anterior que sobreviveu por meses sem nada ficar
// vermelho; quem cobra hoje é `tests/unit/citacao-de-migracao.test.js`. Used by the ETL backfill
// when a project's orgSlug is absent or the legacy 'org-legacy' marker (D9.x).
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const LEGACY_ORG_SLUGS = new Set(['', 'default', 'org-legacy']);

/**
 * Normalize a project slug to a filesystem-safe token: lowercase, keep only
 * [a-z0-9_-], collapse any other run into a single '-', and trim leading/trailing
 * '-'. Used ONLY to DERIVE the {slug}.db filename server-side — the Joi schemas
 * constrain the slug to this same charset, so this is defense in depth (the ETL
 * backfill slug bypasses those schemas entirely).
 * @param {string} slug
 * @returns {string}
 */
export function sanitizeSlug(slug) {
  const s = String(slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'project';
}

/**
 * DERIVE the per-project {slug}.db filename from (organization_id, slug) — the
 * SERVER is the single authority for this name; the client-supplied
 * manifest.project.db_filename is IGNORED (FIX-1, cross-OM BLOB-overwrite guard).
 * The orgId prefix guarantees two organizations sharing the same slug never map
 * to the same file. Format: `${orgId}__${sanitizeSlug(slug)}.db`.
 * @param {string} orgId - resolved target organization_id (uuid)
 * @param {string} slug  - project slug
 * @returns {string} the derived basename (no path separator)
 */
export function deriveDbFilename(orgId, slug) {
  return `${orgId}__${sanitizeSlug(slug)}.db`;
}

// --- capture instant: the zone is not optional ------------------------------
//
// `photos[].capture_date` lands in sv360.photos.capture_date, which is
// TIMESTAMPTZ: an INSTANT, not a wall clock. A zoneless ISO string is NOT an
// instant, and every layer that could turn it into one does so using the
// AMBIENT zone: `new Date('2025-03-17T09:58:14')` uses the Node process TZ (so
// Joi's own `isoDate()` coercion does too), and a bare string handed to
// TIMESTAMPTZ uses the Postgres session TimeZone. The same bundle uploaded on
// two machines would then land on two different instants, with no error on
// either.
//
// The ETL side of this house already refuses that: `scripts/sv360-survey-clock.js`
// exists precisely because the origin stores LOCAL wall clock, and it converts
// with an offset that is DATA (measured per project, `SURVEY_OFFSET_BY_SLUG`),
// never an ambient default. At the upload door the server has no such datum for
// an arbitrary project, so the coherent move is the same one, one step earlier:
// whoever exports the bundle knows where the survey happened and states the zone.
// Rejecting here is cheap; a silently shifted instant is not, and it is the
// failure ebgeo_360 e2fb591 chased down through a solar fit (a wrong hour rotates
// each session differently, so the sessions disagree with low residual).
//
// Accepted: `2025-03-17T09:58:14-03:00`, `2025-03-17T12:58:14Z`, seconds and
// fraction optional. Rejected: zoneless, date-only, anything unparseable.
export const ZONED_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

// An ISO date or date-time with NO zone: the shape that gets diagnosed as a
// missing zone instead of as garbage, so the message names the real defect.
const NAIVE_ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?)?$/;

/**
 * True when the value is a complete ISO 8601 date-time with an EXPLICIT zone
 * AND names a real instant (the regex alone would accept month 13).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isZonedInstant(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  return ZONED_INSTANT_RE.test(s) && Number.isFinite(Date.parse(s));
}

/**
 * True when the value looks like an ISO date/date-time that simply lacks the
 * zone, as opposed to an unrecognizable string.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isNaiveIso(value) {
  return typeof value === 'string' && NAIVE_ISO_RE.test(value.trim());
}

/**
 * The two pt-BR rejection messages, shared with the Joi manifest schema so the
 * upload door and this last guard cannot drift apart. `subject` is the Joi label
 * template (`{{#label}}`) on the schema side and `capture_date da foto <id>` here.
 * @param {string} subject
 * @returns {string}
 */
export function captureDateZoneMessage(subject) {
  return (
    `${subject} sem fuso horário: informe o instante com fuso explícito, ` +
    'como "2025-03-17T09:58:14-03:00" ou "2025-03-17T12:58:14Z".'
  );
}

/**
 * @param {string} subject
 * @returns {string}
 */
export function captureDateFormatMessage(subject) {
  return (
    `${subject} em formato não reconhecido: use ISO 8601 com fuso explícito, ` +
    'como "2025-03-17T09:58:14-03:00" ou "2025-03-17T12:58:14Z".'
  );
}

/**
 * LAST guard before a capture instant reaches TIMESTAMPTZ. The Joi manifest
 * schema already rejects the same values at the upload door, but `mergeProject`
 * is ALSO called by the ETL CLI (`scripts/sv360-import.js`), which never goes
 * through Joi — so the rule lives here too, where the write happens.
 *
 * Absent/null/empty is legitimate (the corpus is full of photos with no known
 * time, and the run derivation falls back to the PIC_ filename).
 *
 * @param {unknown} value - the manifest's photos[].capture_date
 * @param {string} [photoId] - only used to name the offending photo
 * @returns {string|null} the value verbatim (never re-parsed), or null
 * @throws {ValidationError} 422 when the value carries no explicit zone
 */
export function captureInstantOrNull(value, photoId) {
  if (value === undefined || value === null) return null;
  const s = typeof value === 'string' ? value.trim() : value;
  if (s === '') return null;
  if (isZonedInstant(s)) return s;
  const subject = `capture_date da foto ${photoId ?? '(sem id)'}`;
  throw new ValidationError(
    isNaiveIso(s) ? captureDateZoneMessage(subject) : captureDateFormatMessage(subject)
  );
}

/**
 * Resolve an organization_id from a slug (ETL backfill path). When the slug is
 * absent or a known legacy marker, the fixed default org id is used; otherwise
 * the slug is looked up in public.organizations. The lookup runs on the passed
 * tx task `t` so it participates in the same transaction as the merge.
 * @param {Object} t - pg-promise transaction task
 * @param {string} [orgSlug]
 * @returns {Promise<string>} organization_id (uuid)
 * @throws {ConflictError} when a non-default slug does not resolve to an org
 */
export async function resolveOrgIdBySlug(t, orgSlug) {
  const slug = (orgSlug ?? '').trim();
  if (LEGACY_ORG_SLUGS.has(slug)) return DEFAULT_ORG_ID;
  const row = await t.oneOrNone(AQ.RESOLVE_ORG_BY_SLUG, [slug]);
  if (!row) throw new ConflictError(`Unknown organization slug: ${slug}`);
  return row.id;
}

/**
 * Photo-id collision guard. For the manifest's photo ids, fail if ANY id already
 * belongs to a project OTHER than the upload's TARGET (orgId, slug). This covers
 * BOTH a cross-OM collision AND a same-org cross-project collision (FIX-6):
 * sv360.photos.id is a GLOBAL PK, so an id owned by a sibling project — even in the
 * same org — would otherwise blow the INSERT with an opaque 500. The UUID v5 is
 * deterministic per tenant, so any such collision is anomalous. The normal
 * re-upload (SAME org AND slug = the target project) is NOT flagged, so a project
 * re-uploading its own ids is always allowed. MUST run before any write.
 * @param {Object} t - pg-promise transaction task
 * @param {string[]} photoIds
 * @param {string} orgId - the target organization_id
 * @param {string} slug - the target project slug
 * @throws {ConflictError} 409 when ≥1 id belongs to a different project
 */
export async function collisionGuard(t, photoIds, orgId, slug) {
  if (!photoIds || photoIds.length === 0) return;
  const clashes = await t.any(AQ.CHECK_PHOTO_IDS_IN_OTHER_PROJECT, [photoIds, orgId, slug]);
  if (clashes.length > 0) {
    const ids = clashes.map((r) => r.id).join(', ');
    throw new ConflictError(`Photo id(s) belong to another project: ${ids}`);
  }
}

// Coerce an optional numeric field to a value or null (the schemas already
// reject NaN/Infinity, so this only normalizes absent/undefined to null).
function num(v) {
  return v === undefined || v === null ? null : v;
}

// Coerce an optional boolean to a concrete value (DB columns are NOT NULL with
// their own DEFAULTs, but we pass explicit values from the manifest).
function bool(v, dflt = false) {
  return v === undefined || v === null ? dflt : v;
}

/**
 * Idempotent "last upload wins" merge of ONE project's full state, inside the
 * caller's transaction. Steps (per SPEC mergeSemantics):
 *   1. collision guard (cross-OM) BEFORE any write -> 409;
 *   2. UPSERT project by (organization_id, slug) — PRESERVE status/created_at;
 *   3. PURGE the project's child rows (targets -> photos -> tombstones);
 *   4. REINSERT photos[] (geom via trigger), then targets[] (FKs now satisfied),
 *      then deleted_photos[] tombstones;
 *   5. PURGE + REINSERT tracks[] (the capture trajectory segments);
 *   6. PURGE + REINSERT floors[] (sv360.project_floors, the floor selector list);
 *   7. return { projectId, dbFilename, photoCount }.
 * Does NOT commit/rollback and does NOT touch the filesystem.
 *
 * @param {Object} t - pg-promise transaction task (REQUIRED)
 * @param {Object} manifest - { project, photos[], targets[], deleted_photos[], tracks[], floors[] }
 * @param {Object} opts
 * @param {string} opts.orgId - the resolved target organization_id (uuid)
 * @param {string} [opts.source] - free-form provenance tag ('upload' | 'etl'), informational
 * @returns {Promise<{projectId:string, dbFilename:string, photoCount:number}>}
 */
export async function mergeProject(t, manifest, { orgId, source } = {}) {
  void source; // provenance tag is informational only (no audit write here)
  const project = manifest.project ?? {};
  const photos = manifest.photos ?? [];
  const targets = manifest.targets ?? [];
  const tombstones = manifest.deleted_photos ?? [];

  // 1) Collision guard BEFORE any write (cross-OM AND same-org cross-project).
  const photoIds = photos.map((p) => p.id);
  // Same "before any write" reasoning for the capture instants: a zoneless one
  // is a malformed bundle, and finding out halfway through the reinsert would
  // roll back a transaction that already did work for no reason.
  const captureInstants = photos.map((p) => captureInstantOrNull(p.capture_date, p.id));
  await collisionGuard(t, photoIds, orgId, project.slug);

  // photo_count = number of photos in the manifest that are actually VISIBLE, i.e.
  // photos[] minus the tombstones this same bundle carries over.
  //
  // It used to be `photos.length` flat, on the premise that "tombstones are a
  // separate list and are not counted as live photos". The premise is wrong, and the
  // tombstone loop a few lines below states the opposite in the same file: a
  // soft-deleted photo STAYS in photos[] (its INSERT still runs) and the tombstone
  // merely re-applies the deletion the purge just cleared — an id NOT present in
  // photos[] is discarded as foreign. So an overlap is not an anomaly, it is the
  // normal shape, and photo_count over-reported by exactly the number of tombstones:
  // /sv360/projects announced N while /photos, /tiles and the MVT served N-k. Drift
  // between what the catalog promises and what the API delivers.
  const idsTombstonados = new Set(
    tombstones.map((tomb) => tomb.photo_id).filter((id) => photos.some((p) => p.id === id))
  );
  const photoCount = photos.length - idsTombstonados.size;

  // 2) UPSERT project by (organization_id, slug) — status/created_at preserved
  //    on conflict (they are NOT in the UPSERT_PROJECT SET list). db_filename is
  //    DERIVED server-side from (orgId, slug) (FIX-1): the client's manifest value
  //    is IGNORED so an OM cannot point its store at another OM's {slug}.db.
  const dbFilename = deriveDbFilename(orgId, project.slug);
  const upserted = await t.one(AQ.UPSERT_PROJECT, [
    orgId,
    project.slug,
    project.name,
    num(project.center_lat),
    num(project.center_long),
    project.entry_photo_id ?? null,
    photoCount,
    dbFilename,
  ]);
  const projectId = upserted.id;

  // 3) PURGE the project's child rows (targets -> photos -> tombstones). Deleting
  //    targets explicitly first avoids relying solely on the photos CASCADE.
  await t.none(AQ.PURGE_PROJECT_TARGETS, [projectId]);
  const removed = await t.any(AQ.PURGE_PROJECT_PHOTOS, [projectId]);
  const oldIds = removed.map((r) => r.id);
  // Purge tombstones for the UNION of the project's CURRENT photo ids and the ids
  // this manifest is about to (re)insert. Scoping it to `oldIds` alone made the
  // merge unable to heal an ORPHAN tombstone — one whose photo/project was already
  // gone (achado 53): the fresh project has no photos yet, so oldIds is empty and
  // the reinserted photo stayed invisible (404) until a SECOND identical upload.
  // The manifest ids are safe to purge here: collisionGuard already proved every
  // one of them belongs to THIS project or to no project at all, and the carried
  // over deleted_photos[] are re-applied a few lines below.
  const purgeIds = [...new Set([...oldIds, ...photoIds])];
  if (purgeIds.length > 0) {
    await t.none(AQ.PURGE_PROJECT_TOMBSTONES, [purgeIds]);
  }

  // 4) REINSERT manifest state: photos first (geom filled by trigger), then
  //    targets (FKs satisfied), then carried-over tombstones.
  for (const [i, p] of photos.entries()) {
    await t.none(AQ.INSERT_PHOTO, [
      p.id,
      projectId,
      p.original_name,
      p.display_name ?? null,
      p.sequence_number,
      p.lat,
      p.lon,
      num(p.ele),
      num(p.heading) ?? 0,
      num(p.camera_height) ?? 0,
      num(p.mesh_rotation_x) ?? 0,
      num(p.mesh_rotation_y) ?? 0,
      num(p.mesh_rotation_z) ?? 0,
      num(p.distance_scale) ?? 1,
      num(p.marker_scale) ?? 1,
      num(p.floor_level) ?? 0,
      num(p.full_size_bytes),
      num(p.preview_size_bytes),
      bool(p.calibration_reviewed),
      // Checked at the top of this function, never here: by the time the row is
      // written the instant is known to carry its own zone, so TIMESTAMPTZ cannot
      // resolve it against the Postgres session TimeZone.
      captureInstants[i],
      p.floor_label ?? null,
    ]);
  }

  for (const tg of targets) {
    await t.none(AQ.INSERT_TARGET, [
      tg.source_id,
      tg.target_id,
      num(tg.distance_m),
      num(tg.bearing_deg),
      bool(tg.is_next),
      bool(tg.is_original),
      num(tg.override_bearing),
      num(tg.override_distance),
      num(tg.override_height),
      bool(tg.hidden),
    ]);
  }

  // Tombstones são CARRY-OVER do próprio projeto: a foto soft-deletada continua em
  // photos[] (o INSERT dela roda acima) e o tombstone apenas repõe a deleção que o
  // purge do passo 3 acabou de limpar. sv360.deleted_photos.photo_id é PK GLOBAL
  // sem FK, e TODA query de leitura filtra por NOT EXISTS(deleted_photos), então
  // aceitar um id ARBITRÁRIO do manifesto deixaria um tenant esconder a foto de
  // outro em todas as superfícies — e o tombstone estrangeiro sobreviveria para
  // sempre (PURGE_PROJECT_TOMBSTONES só limpa os ids do projeto re-uploadado).
  // O caminho legítimo equivalente (softDeletePhoto) faz loadWritablePhoto antes do
  // mesmo INSERT; aqui o guard é o conjunto photos[], que já passou pelo
  // collisionGuard e portanto pertence comprovadamente a ESTE projeto. Ids fora
  // dele são descartados (e não rejeitados: um bundle legado pode carregar
  // tombstone de foto que já saiu de photos[], o que é inócuo pós-purge).
  const ownedIds = new Set(photoIds);
  const foreign = [];
  for (const tomb of tombstones) {
    if (!ownedIds.has(tomb.photo_id)) {
      foreign.push(tomb.photo_id);
      continue;
    }
    await t.none(AQ.INSERT_TOMBSTONE, [tomb.photo_id, tomb.deleted_at ?? null]);
  }
  if (foreign.length > 0) {
    logger.warn(
      { orgId, slug: project.slug, foreignTombstones: foreign.slice(0, 20), count: foreign.length },
      'sv360 merge: descartando tombstone(s) de foto fora do projeto (possível tentativa cross-tenant)'
    );
  }

  // 6) Capture TRACKS — purge + reinsert, same "último upload manda" shape as the
  // other children. Optional: a manifest without `tracks` leaves the project with
  // none, and the MVT tile falls back to synthesizing the line from the photo
  // sequence, which is what every project did before sv360.tracks existed.
  //
  // A track needs >= 2 distinct points to be a LINESTRING; PostGIS rejects a
  // 1-point line outright, and the legacy dump does contain degenerate rows. They
  // are dropped here rather than allowed to abort the whole project's merge.
  await t.none(AQ.PURGE_PROJECT_TRACKS, [projectId]);
  const tracks = manifest.tracks ?? [];
  let skippedTracks = 0;
  for (const tr of tracks) {
    const coords = Array.isArray(tr?.coords) ? tr.coords : [];
    const clean = coords.filter(
      (c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])
    );
    if (clean.length < 2) {
      skippedTracks++;
      continue;
    }
    await t.none(AQ.INSERT_TRACK, [
      projectId,
      JSON.stringify({ type: 'LineString', coordinates: clean.map((c) => [c[0], c[1]]) }),
      tr.source ?? 'geojson',
    ]);
  }
  if (skippedTracks > 0) {
    logger.warn(
      { orgId, slug: project.slug, skippedTracks },
      'sv360 merge: descartando track(s) com menos de 2 pontos válidos'
    );
  }

  // 7) ANDARES: purge + reinsert, o mesmo "último upload manda" dos outros
  // filhos, e idempotente pela mesma razão: a lista inteira é reescrita.
  //
  // O purge NÃO pode virar UPSERT. É a EXISTÊNCIA de linha em
  // sv360.project_floors que declara "este projeto tem andares" (migração 012), e
  // é ela que a interface consulta para decidir se desenha o seletor. Um nível
  // retirado na origem que sobrevivesse aqui deixaria um andar fantasma no
  // seletor, apontando para um andar que ninguém levantou.
  //
  // `plan_coords` sai daqui como TEXTO JSON e o `$4::jsonb` da query valida a
  // forma na escrita; nível sem planta desenhada grava NULL, que é o caso do
  // nível 0 do beira_rio e do museu_cms (área externa).
  //
  // Nível sem `level` inteiro ou sem `label` é descartado, nunca fatal: a PK é
  // (project_id, level) e um label vazio não tem o que imprimir na tela.
  await t.none(AQ.PURGE_PROJECT_FLOORS, [projectId]);
  const floors = manifest.floors ?? [];
  let skippedFloors = 0;
  for (const fl of floors) {
    const level = Number(fl?.level);
    const label = typeof fl?.label === 'string' ? fl.label.trim() : '';
    if (!Number.isInteger(level) || label === '') {
      skippedFloors++;
      continue;
    }
    const plan = Array.isArray(fl?.plan_coords) && fl.plan_coords.length > 0 ? fl.plan_coords : null;
    await t.none(AQ.INSERT_FLOOR, [
      projectId,
      level,
      label,
      plan === null ? null : JSON.stringify(plan),
    ]);
  }
  if (skippedFloors > 0) {
    logger.warn(
      { orgId, slug: project.slug, skippedFloors },
      'sv360 merge: descartando andar(es) sem level inteiro ou sem label'
    );
  }

  // 5) Hand back the handles the caller needs to drive the commit + file swap.
  return { projectId, dbFilename: upserted.db_filename, photoCount };
}
