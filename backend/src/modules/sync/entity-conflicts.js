// Path: src/modules/sync/entity-conflicts.js
/**
 * @fileoverview Base-and-revision checking for EVERY collaborative entity, not only `feature`.
 *
 * WHAT THIS FILE IS. Until 2026-09-13 the observed-base check lived entirely inside
 * `prepareFeatureMutation` (`feature-conflicts.js`) and was reached through a LITERAL gate in
 * `pushOperations` (`rawOp.protocolVersion === 2 && op.target === 'feature'`). Every other
 * collaborative entity went straight to its statement, so LWW-by-arrival was not a policy there,
 * it was the absence of one: a map rename that left a client at version 3 landed on a server
 * already at version 7 and won, with an ack reading `applied`. This module is the frame the
 * feature path was already an instance of — read the row, resolve the declared base, read the
 * per-unit frontier, refuse naming the disputed units, record the new frontier — with the target
 * table as data instead of a literal.
 *
 * TWO REGIMES, AND THE TRANSITION IS THE POINT. A push op is base-checked when, and only when,
 * it DECLARES a base (`baseVersion`, or a `baseOperationId` whose receipt proves one). Today the
 * client declares one only for features (`featureMutationContract`, `frontend/src/js/store/sync/
 * feature-patch.js`), so every other entity keeps exactly the behaviour it had: arrival order
 * wins. The day the client starts stamping a base on a map or a layer op, the check switches
 * itself on for that entity, with no server change and no version negotiation. That is why the
 * gate is "has a base" and not "is target X": a flag day across two packages is the one thing a
 * frozen wire contract cannot afford.
 *
 * THE UNIT OF DISPUTE IS DECLARED PER ENTITY, and it is the whole point of the exercise. Two
 * people renaming the same map from the same base is a conflict; one renaming it while the other
 * pans it is not. The table below says, per target, which COLUMNS move together as one unit. Two
 * properties of it are load-bearing:
 *   - EVERY column a write path can touch belongs to exactly one unit. A column with no unit
 *     would be written without ever being compared, which is the silent overwrite this file
 *     exists to stop, so `unitsForColumns` answers `'*'` (dispute everything) for a column it
 *     does not know: unknown input widens the refusal instead of narrowing it. The invariant is
 *     asserted structurally, per target, in `revisao-por-entidade.repro.test.js`.
 *   - A SINGLE-UNIT ENTITY KEEPS NO FRONTIER ROW, and that is not an optimisation. With one
 *     unit, "some unit moved past your base" is arithmetically identical to "the row's version
 *     moved past your base", so the frontier row would be a second copy of `version` — and a
 *     second copy is what drifts. It also settles `catalog_layer`, whose id is TEXT ('hillshade',
 *     a catalogue-wide constant) while `sync_entity_fields.entity_id` is UUID (`004_sync.sql`):
 *     the entity that could not have a frontier row is exactly the one that needs none.
 *
 * WHAT A DECLARED BASE ALSO BUYS: THE WRITE IS NARROWED TO THE UNITS IT CLAIMS. For the targets
 * that go through `buildDynamicUpdate` this is already true (it only SETs columns present in the
 * payload). Two paths in `sync.service.js` write a column the payload never declared, and under
 * this regime both stop: a `comment` update writes the whole `data` blob (so resolving a thread
 * would clobber a concurrent text edit it swore not to touch), and a `slide` update assigns
 * `map_id` unconditionally through `resolveSlideMapId`. Both read `op._unitScope`, which is only
 * ever stamped here. Outside the regime they behave exactly as before, so no existing client
 * loses anything.
 *
 * WHAT IS DELIBERATELY NOT HERE. `create` is never base-checked: there is no observed version of
 * a row that does not exist yet, and create policy per target (revive as the undo path, or refuse
 * a duplicate id) is owned by `tombstoneConflict` in `sync.service.js`. `group_feature` has no
 * unit at all: it is a junction whose create and delete are idempotent, so there is nothing for
 * two writers to disagree about. `setting` is out because atlas settings are merged per key, not
 * replaced, and a merge has no loser. And an ABSENT row is still acked as applied, unchanged from
 * the decision recorded in `docs/reviews/fechamento/03-conflitos.md`: the operations log is
 * purgeable, so absence does not prove a deletion, and refusing on it would make every
 * out-of-order create/update pair a permanent rejection.
 */

import { findReceipt } from './sync-receipts.js';

/**
 * THE THREE PHRASES FOR "YOUR WRITE LOST TO THE ROW THE SERVER ALREADY HOLDS". They live here,
 * and not next to the feature path that first spoke them, because three layers now speak them:
 * the feature command layer (`feature-conflicts.js`), the tombstone guard (`tombstoneConflict`,
 * `sync.service.js`) and this frame. Two copies of one outcome drift into two wordings, and the
 * client shows the reason verbatim, so the same defeat would reach the user under two names
 * depending on which entity it happened to. `feature-conflicts.js` re-exports them so its
 * importers do not have to care where they moved.
 *
 * No accents, matching every other server reason on this path: they are logged and filtered from
 * the terminal (`npm run diag -- linhas --filtro`), where a cedilla is a liability.
 */
export const RAZAO_EXCLUIDO_NO_SERVIDOR = 'O item foi excluido no servidor.';
export const RAZAO_CRIACAO_NAO_RESTAURA = `${RAZAO_EXCLUIDO_NO_SERVIDOR} A criacao antiga nao pode restaura-lo.`;
export const RAZAO_IDENTIFICADOR_EM_USO = 'Ja existe um item com este identificador.';

/**
 * The two phrases the feature path already used for a lost base, now shared verbatim with every
 * other entity for the same reason the three above are shared.
 */
export const RAZAO_SEM_BASE = 'Esta edição não possui uma versão-base confirmada.';
export const RAZAO_CAMPOS_DISPUTADOS = 'Os mesmos campos foram alterados no servidor.';
export const RAZAO_ALTERADO_ANTES_DA_EXCLUSAO = 'O item foi alterado após a versão que você pretende excluir.';
export const RAZAO_BASE_NAO_CONFIRMADA = 'A alteração da qual esta edição depende não foi confirmada.';
export const RAZAO_RECIBO_SEM_VERSAO = 'O recibo anterior não comprova uma versão da entidade.';

/**
 * Same shape as `FEATURE_UUID_RE` in `sync.service.js`. Exported so `asUuidOrNull` there reads
 * the same definition instead of keeping a third copy of the literal.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The single unit of an entity whose document is disputed whole. */
export const DOCUMENTO = 'documento';

/**
 * Unit of dispute per target: which columns move together, so that an edit to one unit never
 * refuses an edit to another. Column names are the BACKEND columns the update statements write
 * (`UPDATE_FIELDS` / `MAP_UPDATE_FIELDS`, `sync.service.js`), never the client's aliases: the
 * aliases are resolved before this table is consulted, by the very normalizers the statement
 * uses, so the unit and the write cannot disagree about what a payload means.
 *
 * WHERE THE SPLIT DIVERGES FROM THE PLAN'S SKETCH, and why:
 *   - `layer` gained `estilo`. The plan listed name/visible/locked/opacity/order, but `style` is
 *     a writable column of `UPDATE_FIELDS.layer`, and a writable column with no unit escapes the
 *     comparison entirely. Same reasoning gave `briefing` a `descricao` unit.
 *   - `slide` has no `ordem`. Slide order is not a slide column: it is `briefings.slide_order`,
 *     so a reordering disputes with another reordering under the briefing's `ordemDosSlides`
 *     unit, and a slide's own units are about its content. That is what "a lista de slides é dos
 *     slides" means once you look at where the column lives.
 *   - `map` keeps POSITION AS ONE UNIT over five columns, because a pan is one gesture: refusing
 *     a zoom against a concurrent bearing change would be true to the columns and false to the
 *     user. Its unit names match the `_subType` vocabulary of `ENTITY_TYPE_MAP` on purpose, so a
 *     `mapPosition` op declares exactly one unit and reads as what it is.
 */
export const DISPUTE_UNITS = {
  map: {
    units: [
      { unit: 'nome', columns: ['name'] },
      { unit: 'posicao', columns: ['center_lat', 'center_long', 'zoom', 'bearing', 'pitch'] },
      { unit: 'mapaBase', columns: ['base_layer'] },
      { unit: 'notas', columns: ['notes_title', 'notes_description'] },
      { unit: 'grade', columns: ['grid_style', 'analysis_layers'] },
      { unit: 'temporal', columns: ['temporal_config'] },
      { unit: 'travado', columns: ['locked'] },
    ],
  },
  layer: {
    units: [
      { unit: 'nome', columns: ['name'] },
      { unit: 'visivel', columns: ['visible'] },
      { unit: 'travado', columns: ['locked'] },
      { unit: 'opacidade', columns: ['opacity'] },
      { unit: 'ordem', columns: ['sort_order'] },
      { unit: 'estilo', columns: ['style'] },
    ],
  },
  group: {
    units: [
      { unit: 'nome', columns: ['name'] },
      { unit: 'visivel', columns: ['visible'] },
      { unit: 'travado', columns: ['locked'] },
      { unit: 'estilo', columns: ['style'] },
      { unit: 'pai', columns: ['parent_id'] },
    ],
  },
  briefing: {
    units: [
      { unit: 'nome', columns: ['name'] },
      { unit: 'descricao', columns: ['description'] },
      { unit: 'settings', columns: ['settings'] },
      { unit: 'ordemDosSlides', columns: ['slide_order'] },
    ],
  },
  slide: {
    units: [
      { unit: 'titulo', columns: ['title'] },
      { unit: 'conteudo', columns: ['content'] },
      { unit: 'alvo', columns: ['mode', 'map_id', 'model_id', 'photo_id'] },
      { unit: 'camera', columns: ['position', 'orientation', 'temporal_cursor'] },
      { unit: 'defeito', columns: ['is_broken', 'broken_reason'] },
    ],
  },
  comment: {
    // `texto` is the whole `data` blob (the comment body plus its cosmetic identity fields) and
    // `resolvido` is the `status` column. They are genuinely independent gestures: writing a
    // reply and resolving a thread are done by different people for different reasons.
    units: [
      { unit: 'texto', columns: ['data'] },
      { unit: 'resolvido', columns: ['status'] },
    ],
  },
  // Whole-document entities. The client replaces the item wholesale (there is no per-field op
  // for any of the three), so any two edits from the same base really are the same dispute.
  catalog_layer: { wholeDocument: true },
  cesium3d: { wholeDocument: true },
  streetview360: { wholeDocument: true },
};

/** @param {string} target @returns {boolean} Does this target have a declared unit of dispute? */
export function isRevisionTarget(target) {
  return Object.hasOwn(DISPUTE_UNITS, target);
}

/**
 * Does this envelope DECLARE an observed base? This is the whole gate of the second regime, so it
 * asks about the wire fields and nothing else.
 *
 * `baseVersion: null` is what the client sends for a non-update feature op
 * (`featureMutationContract`), and the schema allows it (`sync.schemas.js`), so a null is the
 * absence of a base and not a base of zero.
 *
 * @param {Object} rawOp - The operation as it arrived.
 * @returns {boolean}
 */
export function hasDeclaredBase(rawOp) {
  return Number.isSafeInteger(rawOp?.baseVersion)
    || (typeof rawOp?.baseOperationId === 'string' && rawOp.baseOperationId.length > 0);
}

/**
 * The id the durable revision of this op is keyed by. A sub-typed `map` op (position, baseLayer,
 * notes, grid, temporal) addresses its map through `mapId`; everything else through `targetId`.
 * Same split `buildUpdateQuery` and `guardedEntityRow` make, and it has to be the same one: the
 * frontier row and the receipt's `entity_id` must name the row that actually changed.
 *
 * @param {Object} op - Normalized operation.
 * @returns {string}
 */
export function revisionKeyOf(op) {
  return op.target === 'map' && op._subType ? op.mapId : op.targetId;
}

/**
 * Which units does a set of written columns claim? Ordered by the table so the refusal names them
 * the same way every time, and deduplicated because one unit spans several columns.
 *
 * A COLUMN WITH NO UNIT WIDENS TO EVERYTHING (`'*'`), never to nothing. A write that reached the
 * statement without belonging to a unit would be compared against no frontier at all, which is
 * the silent overwrite of F8; answering `'*'` makes the op dispute the entire entity instead, so
 * the failure mode of a forgotten table entry is an over-eager refusal that someone notices.
 *
 * @param {string} target - Normalized target.
 * @param {string[]} columns - Backend columns this operation writes.
 * @returns {string[]} Unit names, or `['*']`.
 */
export function unitsForColumns(target, columns) {
  const spec = DISPUTE_UNITS[target];
  if (!spec || spec.wholeDocument) return [DOCUMENTO];
  const claimed = new Set();
  for (const column of columns) {
    const owner = spec.units.find((entry) => entry.columns.includes(column));
    if (!owner) return ['*'];
    claimed.add(owner.unit);
  }
  return spec.units.filter((entry) => claimed.has(entry.unit)).map((entry) => entry.unit);
}

/**
 * Resolves the base version this operation observed, from `baseVersion` and/or the receipt named
 * by `baseOperationId`. Extracted verbatim from `prepareFeatureMutation`, where it was the only
 * copy: a dependent edit sent before its predecessor's ack is a client behaviour, not a feature
 * one, so every entity needs the same resolution.
 *
 * @param {Object} t - Transaction context.
 * @param {string} atlasId
 * @param {Object} rawOp - The operation as it arrived.
 * @param {string} userId
 * @param {string} entityId - The row the base is claimed about (see `revisionKeyOf`).
 * @param {number} currentVersion - The row's version right now, under the atlas write lock.
 * @returns {Promise<{base: number}|{reason: string}>}
 */
export async function resolveObservedBase(t, atlasId, rawOp, userId, entityId, currentVersion) {
  let base = rawOp.baseVersion;
  if (rawOp.baseOperationId) {
    const receipt = await findReceipt(t, atlasId, rawOp.baseOperationId);
    if (!receipt || String(receipt.user_id) !== String(userId)
        || String(receipt.entity_id) !== String(entityId) || receipt.result.rejected) {
      return { reason: RAZAO_BASE_NAO_CONFIRMADA };
    }
    const predecessorVersion = receipt.result.entityVersion;
    if (!Number.isSafeInteger(predecessorVersion)) return { reason: RAZAO_RECIBO_SEM_VERSAO };
    base = Number.isSafeInteger(base) ? Math.max(base, predecessorVersion) : predecessorVersion;
  }
  if (!Number.isSafeInteger(base) || base < 1 || base > currentVersion) {
    return { reason: RAZAO_SEM_BASE };
  }
  return { base };
}

/**
 * Reads the durable per-unit frontier, degrading to "everything is at the current version" when
 * the saved row does not describe the row as it stands now.
 *
 * THE DEGRADATION IS THE SAFETY PROPERTY, not a fallback for missing data: a version reached
 * outside sync (a REST import, a merge, a migration) leaves a frontier that describes a state
 * nobody can reconstruct, and inheriting it would hand a stale client a base it never observed.
 * Conservative here means `{'*': currentVersion}`, which refuses every base below the current
 * version.
 *
 * @param {Object} t - Transaction context.
 * @param {string} atlasId
 * @param {string} entityType - The target, used verbatim as `sync_entity_fields.entity_type`.
 * @param {string} entityId
 * @param {number} currentVersion
 * @returns {Promise<Object>} unit → version at which it was last written.
 */
export async function readFieldFrontier(t, atlasId, entityType, entityId, currentVersion) {
  const saved = await t.oneOrNone(`SELECT entity_version, field_versions FROM sync_entity_fields
    WHERE atlas_id=$1 AND entity_type=$2 AND entity_id=$3`, [atlasId, entityType, entityId]);
  return saved && Number(saved.entity_version) === currentVersion
    ? saved.field_versions : { '*': currentVersion };
}

/**
 * Stores the per-unit frontier of an entity at the version it now holds.
 *
 * @param {Object} t - Transaction context.
 * @param {string} atlasId
 * @param {string} entityType
 * @param {string} entityId
 * @param {number} entityVersion
 * @param {Object} fieldVersions - unit → version.
 * @returns {Promise<void>}
 */
export async function writeFieldFrontier(t, atlasId, entityType, entityId, entityVersion, fieldVersions) {
  await t.none(`INSERT INTO sync_entity_fields (atlas_id, entity_type, entity_id, entity_version, field_versions)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    ON CONFLICT (atlas_id, entity_type, entity_id) DO UPDATE
      SET entity_version=EXCLUDED.entity_version, field_versions=EXCLUDED.field_versions`,
  [atlasId, entityType, entityId, entityVersion, JSON.stringify(fieldVersions)]);
}

/**
 * The row-state lookup for one operation, scoped to THIS atlas by the same join each target's
 * statement uses (so a guard can never read a row the write could not reach, or the reverse).
 *
 * @param {string} target
 * @param {string} atlasId
 * @param {Object} op - Normalized operation.
 * @returns {{sql: string, values: Array}|null} null when this op does not address a row this
 *   lookup can ask about, which is NOT the same as "no such row" (see `readEntityRow`).
 */
function entityRowQuery(target, atlasId, op) {
  if (target === 'map') {
    const mapId = revisionKeyOf(op);
    if (!UUID_RE.test(mapId)) return null;
    return {
      sql: 'SELECT version, deleted_at FROM maps WHERE id = $1 AND atlas_id = $2',
      values: [mapId, atlasId],
    };
  }
  if (target === 'briefing') {
    if (!UUID_RE.test(op.targetId)) return null;
    return {
      sql: 'SELECT version, deleted_at FROM briefings WHERE id = $1 AND atlas_id = $2',
      values: [op.targetId, atlasId],
    };
  }
  if (target === 'slide') {
    if (!UUID_RE.test(op.targetId)) return null;
    return {
      sql: `SELECT s.version, s.deleted_at FROM slides s JOIN briefings b ON b.id = s.briefing_id
            WHERE s.id = $1 AND b.atlas_id = $2`,
      values: [op.targetId, atlasId],
    };
  }
  if (target === 'comment') {
    if (!UUID_RE.test(op.targetId)) return null;
    return {
      sql: 'SELECT version, deleted_at FROM comments WHERE id = $1 AND atlas_id = $2',
      values: [op.targetId, atlasId],
    };
  }
  if (target === 'catalog_layer') {
    // The id here is a catalogue-wide TEXT constant, so there is no UUID test to make; the row
    // is keyed by (map_id, id). The legacy whole-array form addresses no single row at all, so
    // it is unaskable and keeps its old path.
    const isArrayForm = Array.isArray(op.data?.catalog_layers) || Array.isArray(op.changes?.catalog_layers);
    if (isArrayForm || typeof op.targetId !== 'string' || !op.targetId || !UUID_RE.test(op.mapId ?? '')) return null;
    return {
      sql: `SELECT c.version, c.deleted_at FROM catalog_layers c JOIN maps m ON m.id = c.map_id
            WHERE c.id = $1 AND c.map_id = $2 AND m.atlas_id = $3`,
      values: [op.targetId, op.mapId, atlasId],
    };
  }
  // group, layer, cesium3d, streetview360: a row of a map of this atlas.
  const table = MAP_SCOPED_TABLES[target];
  if (!table) return null;
  if (!UUID_RE.test(op.targetId ?? '') || !UUID_RE.test(op.mapId ?? '')) return null;
  return {
    sql: `SELECT e.version, e.deleted_at FROM ${table} e JOIN maps m ON m.id = e.map_id
          WHERE e.id = $1 AND e.map_id = $2 AND m.atlas_id = $3`,
    values: [op.targetId, op.mapId, atlasId],
  };
}

/**
 * Targets whose row hangs off a map. Safe to interpolate into SQL: the values are literals of
 * this object, never client input, and a target absent from it gets no query at all.
 *
 * It is a SUBSET of `TARGET_TABLE_MAP` (`sync.service.js`) written out rather than imported, and
 * that is the lesser of two evils: importing it would make this module depend on the 3000-line
 * service it is meant to serve, and a cycle between them is worse than four names. The census in
 * `revisao-por-entidade.repro.test.js` compares the two tables so the copy cannot drift.
 */
export const MAP_SCOPED_TABLES = {
  group: 'groups',
  layer: 'layers',
  cesium3d: 'cesium3d_data',
  streetview360: 'streetview360_data',
};

/**
 * Reads the current row state of the entity an operation names.
 *
 * THREE OUTCOMES, AND THE THIRD IS THE ONE THAT MATTERS. A row object means "this is the state";
 * `null` means "there is no such row"; `undefined` means "this operation does not address a row
 * in a shape this lookup can ask about", and the caller must then behave exactly as it did before
 * any of this existed. That third case is not hypothetical: the local default map is name-keyed
 * ("Principal"), so a non-UUID id reaches here in normal operation, and casting it raises 22P02 —
 * inside the per-op savepoint that becomes a NAMED integrity refusal of an operation that would
 * otherwise have applied. A guard that invents refusals is worse than the hole it closes.
 *
 * @param {Object} t - Transaction context.
 * @param {string} atlasId
 * @param {Object} op - Normalized operation.
 * @returns {Promise<{version: number, deleted_at: Date|null}|null|undefined>}
 */
export async function readEntityRow(t, atlasId, op) {
  const q = entityRowQuery(op.target, atlasId, op);
  if (!q) return undefined;
  return t.oneOrNone(q.sql, q.values);
}

/**
 * Prepares a base-checked mutation of a NON-feature entity, under the caller's atlas write lock
 * and before any write. Mirrors `prepareFeatureMutation`, whose patch-level precision this cannot
 * have (the client sends documents for these entities, not patches) and does not need: the unit
 * of dispute is coarser than a field, by declaration.
 *
 * @param {Object} t - Transaction context.
 * @param {string} atlasId
 * @param {Object} op - Normalized operation.
 * @param {Object} rawOp - The operation as it arrived.
 * @param {string} userId
 * @param {(op: Object) => string[]} declaredColumns - Backend columns this update writes,
 *   computed by the caller with the SAME normalizers and field tables the statement uses.
 * @returns {Promise<null|{conflict: Object}|{op: Object, previous: Object,
 *   versions: Object|null, fields: string[]}>} `null` means "not a base-checked mutation": keep
 *   today's path.
 */
export async function prepareEntityMutation(t, atlasId, op, rawOp, userId, declaredColumns) {
  const spec = DISPUTE_UNITS[op.target];
  // A create observes nothing, and its policy per target belongs to `tombstoneConflict`.
  if (!spec || (op.type !== 'update' && op.type !== 'delete')) return null;

  const current = await readEntityRow(t, atlasId, op);
  if (current === undefined) return null;
  const currentVersion = Number(current?.version ?? 0);
  const conflict = (reason, fields = []) => ({ conflict: {
    reason, fields, entityVersion: currentVersion, deleted: Boolean(current?.deleted_at),
    // Null until every entity has a canonical serializer (step 3 of B5). The version is what a
    // retry actually needs, and it is the one thing a purged log cannot take away.
    serverData: null,
  } });

  // An absent row keeps being acked as applied: see the fileoverview.
  if (!current) return null;
  if (current.deleted_at) return conflict(RAZAO_EXCLUIDO_NO_SERVIDOR, ['*']);

  const resolved = await resolveObservedBase(t, atlasId, rawOp, userId, revisionKeyOf(op), currentVersion);
  if (resolved.reason) return conflict(resolved.reason);
  const base = resolved.base;

  // A delete claims the WHOLE entity: nothing about it may have moved since the version the user
  // was looking at when they decided to remove it. Same rule the feature path applies.
  if (op.type === 'delete') {
    if (base !== currentVersion) return conflict(RAZAO_ALTERADO_ANTES_DA_EXCLUSAO, ['*']);
    return { op, previous: current, versions: null, fields: ['*'] };
  }

  if (spec.wholeDocument) {
    if (base !== currentVersion) return conflict(RAZAO_CAMPOS_DISPUTADOS, [DOCUMENTO]);
    return { op, previous: current, versions: null, fields: [DOCUMENTO] };
  }

  const units = unitsForColumns(op.target, declaredColumns(op));
  // Declaring no column means writing no column: `buildDynamicUpdate` returns null for that and
  // the op is a no-op either way, so there is nothing to compare and nothing to record.
  if (units.length === 0) return null;

  const entityId = revisionKeyOf(op);
  const versions = await readFieldFrontier(t, atlasId, op.target, entityId, currentVersion);
  const disputed = units.filter((unit) => Number(versions[unit] ?? versions['*'] ?? 0) > base);
  if (disputed.length) return conflict(RAZAO_CAMPOS_DISPUTADOS, disputed);

  // `_unitScope` is the narrowing licence described in the fileoverview, and it exists ONLY on a
  // base-checked op, so the two paths that read it leave every other operation alone.
  return { op: { ...op, _unitScope: units }, previous: current, versions, fields: units };
}

/**
 * Records the per-unit frontier after a base-checked mutation and returns the version the entity
 * actually committed, which is what the author's next edit uses as its base.
 *
 * A ROW THAT IS NO LONGER THERE DOES NOT THROW. It cannot happen inside the same transaction that
 * just read it, but a throw here would leave the per-op savepoint by the non-integrity path and
 * take the whole batch with it — the poison-pill failure mode this file's neighbours were rebuilt
 * to prevent. Nothing is recorded and no version is claimed, which is honest about what happened.
 *
 * @param {Object} t - Transaction context.
 * @param {string} atlasId
 * @param {Object} op - Normalized operation.
 * @param {Object} prepared - What `prepareEntityMutation` returned.
 * @returns {Promise<{entityVersion: number|null}>}
 */
export async function finishEntityMutation(t, atlasId, op, prepared) {
  const row = await readEntityRow(t, atlasId, op);
  const entityVersion = row ? Number(row.version) : null;
  if (entityVersion === null || !prepared.versions) return { entityVersion };
  const fieldVersions = { ...prepared.versions };
  for (const unit of prepared.fields) fieldVersions[unit] = entityVersion;
  await writeFieldFrontier(t, atlasId, op.target, revisionKeyOf(op), entityVersion, fieldVersions);
  return { entityVersion };
}
