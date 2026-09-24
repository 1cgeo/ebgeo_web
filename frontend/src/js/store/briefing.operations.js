// Path: js/store/briefing.operations.js

/**
 * @fileoverview Briefing (Story Map) operations for the store module.
 *
 * Provides CRUD operations for briefings with proper sync metadata.
 * Briefings are persisted independently from maps.
 *
 * @module store/briefing.operations
 */

import { localRepository } from './repositories/local.repository.js';
import { generateUUID, isValidUUID } from '../utilities/uuid.js';
import { deepClone, deepEqual } from '../utilities/deep-utils.js';
import { createSyncMetadata, touchSyncMetadata } from './sync/sync-metadata.js';
import { EntityType, OperationType } from './sync/operation-types.js';
import { runTransaction } from '@store/store-transaction.js';
import { withDocumentLock } from '@store/document-lock.js';
import { getActiveScope } from '@store/atlas-namespace.js';
import { captureRemoteWriteFence } from '@store/remote-write-fence.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default briefing settings.
 * @type {Object}
 */
export const DEFAULT_BRIEFING_SETTINGS = {
    panelPosition: 'left',
    panelWidth: 350,
    panelBackgroundColor: 'rgba(255, 255, 255, 0.95)'
};

/**
 * Slide modes enumeration.
 * @type {Object}
 */
export const SlideMode = Object.freeze({
    MAP_2D: '2d',
    VIEWER_3D: '3d',
    VIEWER_360: '360'
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Reassigns sequential order values to all slides starting from a given index.
 *
 * @param {Object[]} slides - Array of slide objects
 * @param {number} [fromIndex=0] - Index to start reordering from
 */
function reindexSlides(slides, fromIndex = 0) {
    for (let i = fromIndex; i < slides.length; i++) {
        slides[i].order = i;
    }
}

/**
 * Creates an empty slide structure.
 *
 * @param {number} order - Slide order position
 * @returns {Object} Empty slide data
 */
export function createEmptySlide(order = 0) {
    return {
        id: generateUUID(),
        order,
        title: '',
        content: '',
        mode: SlideMode.MAP_2D,
        mapId: null,
        position: {
            longitude: null,
            latitude: null,
            zoom: null,
            altitude: null
        },
        orientation: {
            bearing: 0,
            pitch: 0,
            heading: null,
            lon: null,
            lat: null,
            fov: null
        },
        modelId: null,
        photoId: null,
        // Temporal timeline cursor (epoch ms), captured in ALL THREE modes (2D, 3D, 360)
        // since 2026-09-21 when the map's temporal switch is on; null when temporal is
        // off or the cursor is not finite. The rule is `captureSlideTemporal`
        // (briefing/slide-temporal.js). Older slides lack this field and are treated as null.
        temporalCursor: null,
        // THE VIEW OF A 2D SLIDE (2026-09-20). The base layer and the temporal switch became
        // view state of each person, so the slide says what IT shows. null means "inherit
        // what was saved with the map", which is also what a slide older than these fields
        // reads as, so it keeps presenting exactly as before.
        baseLayer: null,
        temporalEnabled: null,
        // WHICH MAP CONTROLS THE SLIDE SHOWS WHILE PRESENTED. Absent/empty means none, which
        // is the default of the owner for every one of them; the closed list and the reader
        // are in `briefing/slide-controls.js`.
        controls: {}
    };
}

/**
 * Creates an empty briefing structure.
 *
 * @param {string} name - Briefing name
 * @param {string} [description=''] - Briefing description
 * @returns {Object} Empty briefing data
 */
export function createEmptyBriefing(name, description = '') {
    const now = Date.now();
    return {
        id: generateUUID(),
        name,
        description,
        slides: [],
        settings: { ...DEFAULT_BRIEFING_SETTINGS },
        sync: createSyncMetadata(null),
        createdAt: now,
        updatedAt: now
    };
}

// ============================================================================
// BRIEFING OPERATIONS
// ============================================================================

/** Prepare the entire briefing edit before its journal or entity is written. */
async function writeBriefing(id, type, action, label, prepare, missing = null) {
    const perm = checkPermission(action);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: label, reason: perm.reason, required: perm.required });
        return missing;
    }
    let output = missing;
    await withDocumentLock(`briefing:${id}`, label, () => runTransaction(async tx => {
        const repo = localRepository.forScope(tx.scope);
        const previous = await repo.getBriefing(id);
        if (type !== OperationType.CREATE && !previous) return async () => {};
        if (type === OperationType.CREATE && previous) throw new Error('Já existe um briefing com este identificador.');
        const edit = prepare(previous ? deepClone(previous) : null);
        if (!edit) return async () => {};
        const next = type === OperationType.DELETE ? null : {
            ...edit.value, id, slides: edit.value.slides ?? [],
            ...(type === OperationType.UPDATE ? {
                sync: touchSyncMetadata(previous.sync), createdAt: previous.createdAt, updatedAt: Date.now()
            } : {})
        };
        if (next && !Array.isArray(next.slides)) throw new Error('O briefing possui uma lista de slides inválida.');
        if (tx.scope?.kind === 'remote' && (!isValidUUID(id) || next?.slides.some(slide => !isValidUUID(slide.id)))) {
            throw new Error('Os identificadores do briefing e dos slides precisam ser válidos para sincronizar.');
        }
        if (next && new Set(next.slides.map(slide => slide.id)).size !== next.slides.length) {
            throw new Error('Dois slides não podem compartilhar o mesmo identificador.');
        }
        tx.recordOperation(EntityType.BRIEFING, type, id, null, next, previous);
        // The briefing envelope carries order/presentation; the server stores each slide separately.
        // Derive the complete set from the observed parent before either write occurs.
        if (next) {
            const before = new Map((previous?.slides || []).map(slide => [slide.id, slide]));
            for (const slide of next.slides || []) {
                const prior = before.get(slide.id);
                if (!deepEqual(slide, prior)) {
                    tx.recordOperation(EntityType.SLIDE, prior ? OperationType.UPDATE : OperationType.CREATE,
                        slide.id, id, slide, prior ?? null);
                }
                before.delete(slide.id);
            }
            for (const slide of before.values()) {
                tx.recordOperation(EntityType.SLIDE, OperationType.DELETE, slide.id, id, null, slide);
            }
        }
        output = edit.result === undefined ? next : edit.result;
        return () => type === OperationType.DELETE ? repo.deleteBriefing(id) : repo.saveBriefing(id, next);
    }));
    return output;
}

/** Each slide edit shares its parent read, journal and persistence boundary. */
function editSlides(id, prepare) {
    return writeBriefing(id, OperationType.UPDATE, GuardAction.UPDATE_BRIEFING, 'updateBriefing', prepare);
}


/**
 * Gets all briefings.
 *
 * @returns {Promise<Array>} Array of briefings sorted by updatedAt desc
 */
export function getAllBriefings() {
    return localRepository.getAllBriefings();
}

/**
 * Gets a briefing by ID.
 *
 * @param {string} briefingId - Briefing UUID
 * @returns {Promise<Object|null>} Briefing data or null
 */
export function getBriefingById(briefingId) {
    return localRepository.getBriefing(briefingId);
}

/**
 * Creates a new briefing.
 *
 * @param {Object} data - Briefing data
 * @param {string} data.name - Briefing name
 * @param {string} [data.description=''] - Briefing description
 * @param {Array} [data.slides=[]] - Initial slides
 * @param {Object} [data.settings] - Briefing settings
 * @returns {Promise<Object>} Created briefing
 */
export async function createBriefing(data) {
    const briefing = createEmptyBriefing(data.name, data.description || '');
    if (Array.isArray(data.slides)) briefing.slides = deepClone(data.slides).map(slide => ({ ...slide, id: generateUUID() }));
    if (data.settings) briefing.settings = { ...DEFAULT_BRIEFING_SETTINGS, ...data.settings };
    return writeBriefing(briefing.id, OperationType.CREATE, GuardAction.CREATE_BRIEFING,
        'createBriefing', () => ({ value: briefing }));
}

/**
 * Updates an existing briefing.
 *
 * @param {string} briefingId - Briefing UUID
 * @param {Object} data - Data to update
 * @returns {Promise<Object|null>} Updated briefing or null if not found
 */
export async function updateBriefing(briefingId, data) {
    return writeBriefing(briefingId, OperationType.UPDATE, GuardAction.UPDATE_BRIEFING,
        'updateBriefing', existing => ({ value: {
            ...existing, ...deepClone(data),
            settings: data.settings ? { ...existing.settings, ...data.settings } : existing.settings
        } }));
}

/**
 * Applies an editor's PATCH on top of the briefing as it is in the store NOW.
 *
 * The editor keeps its own copy of the briefing and used to save it whole, which is a two-way
 * merge against a document a peer may have changed since: every slide the peer created became a
 * DELETE and every field the peer rewrote went back to the old value. The patch carries only what
 * the person changed ({@link diffBriefingEdits}, below), and it is
 * applied inside the transaction, over the document read there, so what a peer wrote meanwhile
 * survives. A patched slide the store no longer has (a peer deleted it) is skipped: resurrecting
 * it would undo the peer's deletion.
 *
 * @param {string} briefingId - Briefing UUID
 * @param {{fields?: Object, slides?: Object<string, Object>}} patch - Changed briefing fields
 *   (`settings` merged key by key) and changed fields per slide id.
 * @returns {Promise<Object|null>} The briefing as stored, or null if not found or blocked
 */
export async function applyBriefingEdits(briefingId, { fields = {}, slides = {} } = {}) {
    return writeBriefing(briefingId, OperationType.UPDATE, GuardAction.UPDATE_BRIEFING,
        'updateBriefing', existing => {
            const value = { ...existing };
            for (const [key, fieldValue] of Object.entries(fields)) {
                if (BRIEFING_FIXED_KEYS.has(key)) continue;
                value[key] = key === 'settings'
                    ? { ...(existing.settings || {}), ...deepClone(fieldValue) }
                    : deepClone(fieldValue);
            }
            value.slides = existing.slides.map(slide => {
                const patch = slides[slide.id];
                if (!patch) return slide;
                const { id: _id, order: _order, sync: _sync, ...changed } = patch;
                return { ...slide, ...deepClone(changed), id: slide.id, order: slide.order,
                    sync: touchSyncMetadata(slide.sync || createSyncMetadata(null)) };
            });
            return { value };
        });
}

/**
 * Appends copies of slides at the end of the briefing as it is in the store NOW.
 *
 * Same reason as {@link applyBriefingEdits}: the slide import used to save the editor's copy of
 * the list plus the new slides, erasing whatever a peer had added while the picker was open.
 *
 * @param {string} briefingId - Briefing UUID
 * @param {Object[]} newSlides - Slides to append (ids are kept; order is assigned here)
 * @returns {Promise<boolean>} True if appended
 */
export async function appendSlides(briefingId, newSlides) {
    const result = await editSlides(briefingId, briefing => {
        briefing.slides.push(...deepClone(newSlides).map(slide => ({ ...slide, sync: createSyncMetadata(null) })));
        reindexSlides(briefing.slides);
        return { value: briefing, result: true };
    });
    return result === true;
}

/**
 * Deletes a briefing.
 *
 * @param {string} briefingId - Briefing UUID
 * @returns {Promise<boolean>} True if deleted
 */
export async function deleteBriefing(briefingId) {
    return writeBriefing(briefingId, OperationType.DELETE, GuardAction.DELETE_BRIEFING,
        'deleteBriefing', () => ({ result: true }), false);
}

/**
 * Generates a unique briefing name.
 * Handles "Novo Briefing", "Novo Briefing (1)", etc.
 *
 * @param {string} [baseName='Novo Briefing'] - Base name
 * @returns {Promise<string>} Unique name
 */
export async function generateUniqueBriefingName(baseName = 'Novo Briefing') {
    const briefings = await getAllBriefings();
    const existingNames = new Set(briefings.map(b => b.name));

    if (!existingNames.has(baseName)) {
        return baseName;
    }

    let counter = 1;
    let candidateName;
    do {
        candidateName = `${baseName} (${counter})`;
        counter++;
    } while (existingNames.has(candidateName));

    return candidateName;
}

// ============================================================================
// SLIDE OPERATIONS
// ============================================================================

/**
 * Adds a slide to a briefing.
 *
 * @param {string} briefingId - Briefing UUID
 * @param {Object} [slideData] - Slide data (uses defaults if not provided)
 * @param {number} [position] - Insert position (appends if not specified)
 * @returns {Promise<Object|null>} Created slide or null if briefing not found
 */
export async function addSlide(briefingId, slideData = {}, position = null) {
    return editSlides(briefingId, briefing => {
        const slide = { ...createEmptySlide(0), ...deepClone(slideData),
            id: slideData.id || generateUUID(), sync: createSyncMetadata(null) };
        if (position !== null && position >= 0 && position < briefing.slides.length) {
            briefing.slides.splice(position, 0, slide);
            reindexSlides(briefing.slides, position);
        } else {
            slide.order = briefing.slides.length;
            briefing.slides.push(slide);
        }
        return { value: briefing, result: slide };
    });
}

/**
 * Updates a slide in a briefing.
 *
 * @param {string} briefingId - Briefing UUID
 * @param {string} slideId - Slide UUID
 * @param {Object} slideData - Data to update
 * @returns {Promise<Object|null>} Updated slide or null
 */
export async function updateSlide(briefingId, slideId, slideData) {
    return editSlides(briefingId, briefing => {
        const index = briefing.slides.findIndex(slide => slide.id === slideId);
        if (index === -1) return null;
        const previous = deepClone(briefing.slides[index]);
        const slide = { ...previous, ...deepClone(slideData), id: slideId,
            sync: touchSyncMetadata(previous.sync || createSyncMetadata(null)) };
        briefing.slides[index] = slide;
        return { value: briefing, result: slide };
    });
}

/**
 * Removes a slide from a briefing.
 *
 * @param {string} briefingId - Briefing UUID
 * @param {string} slideId - Slide UUID
 * @returns {Promise<boolean>} True if removed
 */
export async function removeSlide(briefingId, slideId) {
    const result = await editSlides(briefingId, briefing => {
        const index = briefing.slides.findIndex(slide => slide.id === slideId);
        if (index === -1) return null;
        briefing.slides.splice(index, 1);
        reindexSlides(briefing.slides);
        return { value: briefing, result: true };
    });
    return result === true;
}

/**
 * Reorders slides in a briefing.
 *
 * @param {string} briefingId - Briefing UUID
 * @param {string[]} slideIds - Array of slide IDs in new order
 * @returns {Promise<boolean>} True if reordered
 */
export async function reorderSlides(briefingId, slideIds) {
    const result = await editSlides(briefingId, briefing => {
        const byId = new Map(briefing.slides.map(slide => [slide.id, slide]));
        const reordered = [];
        for (const id of slideIds) {
            if (!byId.has(id)) continue;
            reordered.push(byId.get(id));
            byId.delete(id);
        }
        if (byId.size) {
            console.warn(`reorderSlides: ${byId.size} slide(s) missing from slideIds array, appending at end`);
            reordered.push(...byId.values());
        }
        reindexSlides(reordered);
        briefing.slides = reordered;
        return { value: briefing, result: true };
    });
    return result === true;
}

// ============================================================================
// EDITOR MERGE (the briefing editor's working copy against the store)
// ============================================================================

/*
 * THE THREE-WAY MERGE between the briefing editor's in-memory copy and the store.
 *
 * WHY THE EDITOR CANNOT SAVE ITS COPY. The editor reads the briefing ONCE when it opens and
 * edits that object in memory. Saving the whole object (the whole `slides` array included) is a
 * two-way merge against a document that a peer may have changed in the meantime: the store
 * derives one slide operation per difference (`writeBriefing`), so a slide the peer created
 * becomes a DELETE and a title the peer rewrote goes back to the old text, and both reach the
 * server. Measured on 2026-09-23 with two real browsers
 * (`frontend/tests/e2e-ui/briefing-editor-copia-velha.repro.spec.js`).
 *
 * THE RULE. The editor keeps a BASELINE: a deep copy of the store document its memory was last
 * reconciled with. A field is the editor's to write only when memory differs from the baseline
 * (the person changed it here). Everything else belongs to whoever wrote the store last, and is
 * adopted from there. Slides are compared field by field, and settings key by key, so an edit to
 * a slide title never carries a stale copy of that slide's content along.
 *
 * `rebaseBriefingEdits` MUTATES the memory copy IN PLACE and keeps every slide object alive. The
 * slide form's input handlers close over the slide OBJECT (`slide.title = input.value`), so
 * replacing it with a fresh one detaches the form: the next keystroke writes into an object that
 * nothing saves. Every refresh of the editor goes through here for that reason.
 */

/** Briefing keys the editor never edits: identity, bookkeeping and the slides (handled apart). */
const BRIEFING_FIXED_KEYS = new Set(['id', 'slides', 'sync', 'createdAt', 'updatedAt']);

/** Slide keys the editor never edits directly: identity, position in the list, bookkeeping. */
const SLIDE_FIXED_KEYS = new Set(['id', 'order', 'sync']);

/** Keys whose value is a flat record merged key by key instead of replaced whole. */
const KEYED_RECORDS = new Set(['settings']);

const keysOf = (...objects) => new Set(objects.flatMap((object) => Object.keys(object ?? {})));

/**
 * The keys of `current` that differ from `base`, with their current values (deep copies).
 *
 * @param {Object|undefined} current
 * @param {Object|undefined} base
 * @param {Set<string>} fixed - Keys never reported.
 * @returns {Object} Changed keys only.
 */
function changedFields(current, base, fixed) {
    const changed = {};
    for (const key of keysOf(current, base)) {
        if (fixed.has(key) || deepEqual(current?.[key], base?.[key])) continue;
        if (KEYED_RECORDS.has(key) && isRecord(current?.[key]) && isRecord(base?.[key])) {
            changed[key] = changedFields(current[key], base[key], new Set());
        } else {
            changed[key] = deepClone(current?.[key]);
        }
    }
    return changed;
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * What the person changed in the editor since the baseline, as a patch the store applies on top
 * of its CURRENT document.
 *
 * Slides are keyed by id and carry only their changed fields. A memory slide absent from the
 * baseline cannot come from the editor (adding goes through the store), so it is not reported.
 *
 * @param {Object} memory - The editor's working copy.
 * @param {Object} baseline - The store document that copy was last reconciled with.
 * @returns {{fields: Object, slides: Object<string, Object>, empty: boolean}}
 */
export function diffBriefingEdits(memory, baseline) {
    const fields = changedFields(memory, baseline, BRIEFING_FIXED_KEYS);
    const baseSlides = new Map((baseline?.slides ?? []).map((slide) => [slide.id, slide]));
    const slides = {};
    for (const slide of memory?.slides ?? []) {
        const base = baseSlides.get(slide?.id);
        if (!base) continue;
        const patch = changedFields(slide, base, SLIDE_FIXED_KEYS);
        if (Object.keys(patch).length) slides[slide.id] = patch;
    }
    return { fields, slides, empty: !Object.keys(fields).length && !Object.keys(slides).length };
}

/**
 * Adopts `fresh[key]` into `target` when the key is NOT dirty (equal to `base`), in place. A dirty
 * keyed record still adopts, key by key, the entries the person did not touch here.
 *
 * @returns {boolean} Whether `target[key]` changed.
 */
function adoptKey(target, base, fresh, key) {
    const dirty = !deepEqual(target[key], base?.[key]);
    if (!dirty) {
        if (deepEqual(target[key], fresh?.[key])) return false;
        setOrDelete(target, key, fresh?.[key]);
        return true;
    }
    if (KEYED_RECORDS.has(key) && isRecord(target[key]) && isRecord(fresh?.[key])) {
        const subBase = isRecord(base?.[key]) ? base[key] : {};
        let changed = false;
        for (const sub of keysOf(target[key], fresh[key])) {
            changed = adoptKey(target[key], subBase, fresh[key], sub) || changed;
        }
        return changed;
    }
    return false;
}

/**
 * Runs {@link adoptKey} over every key of `target` and `fresh`, except `skip`; the `always` keys
 * are bookkeeping the editor never edits, so they take the store's value unconditionally.
 *
 * @returns {string[]} The keys that changed in `target`.
 */
function adoptAll(target, base, fresh, { skip, always }) {
    const changed = [];
    for (const key of keysOf(target, fresh)) {
        if (skip.has(key)) continue;
        if (always.has(key)) {
            if (!deepEqual(target[key], fresh?.[key])) {
                setOrDelete(target, key, fresh?.[key]);
                changed.push(key);
            }
            continue;
        }
        if (adoptKey(target, base, fresh, key)) changed.push(key);
    }
    return changed;
}

function setOrDelete(target, key, value) {
    if (value === undefined) delete target[key];
    else target[key] = deepClone(value);
}

/**
 * Reconciles the editor's working copy with a fresh store document, IN PLACE.
 *
 * Clean fields (equal to the baseline) take the store's value; dirty ones keep the person's. The
 * slide list takes the store's membership and order: a slide a peer deleted leaves, a slide a peer
 * created enters as a copy, and every surviving slide keeps its OBJECT identity (see the module
 * note). The caller must replace its baseline with a copy of `fresh` afterwards.
 *
 * @param {Object} memory - The editor's working copy (mutated).
 * @param {Object} baseline - The store document `memory` was last reconciled with.
 * @param {Object} fresh - The store document now.
 * @returns {{changed: boolean, removedSlideIds: string[], addedSlideIds: string[], updatedSlideIds: string[], updatedFields: string[]}}
 */
export function rebaseBriefingEdits(memory, baseline, fresh) {
    const updatedFields = adoptAll(memory, baseline, fresh,
        { skip: new Set(['id', 'slides']), always: new Set(['sync', 'createdAt', 'updatedAt']) })
        .filter((key) => !BRIEFING_FIXED_KEYS.has(key));

    const memoryById = new Map((memory.slides ?? []).map((slide) => [slide.id, slide]));
    const baseById = new Map((baseline?.slides ?? []).map((slide) => [slide.id, slide]));
    const orderBefore = (memory.slides ?? []).map((slide) => slide.id);
    const next = [];
    const addedSlideIds = [];
    const updatedSlideIds = [];
    for (const freshSlide of fresh?.slides ?? []) {
        const mine = memoryById.get(freshSlide.id);
        if (!mine) {
            next.push(deepClone(freshSlide));
            addedSlideIds.push(freshSlide.id);
            continue;
        }
        memoryById.delete(freshSlide.id);
        const touched = adoptAll(mine, baseById.get(freshSlide.id), freshSlide,
            { skip: new Set(['id']), always: new Set(['order', 'sync']) });
        if (touched.some((key) => !SLIDE_FIXED_KEYS.has(key))) updatedSlideIds.push(freshSlide.id);
        next.push(mine);
    }
    const removedSlideIds = [...memoryById.keys()];
    memory.slides = next;
    const reordered = orderBefore.join('|') !== next.map((slide) => slide.id).join('|');

    return {
        changed: reordered || updatedFields.length > 0 || updatedSlideIds.length > 0,
        removedSlideIds,
        addedSlideIds,
        updatedSlideIds,
        updatedFields,
    };
}

// ============================================================================
// EXPORT/IMPORT HELPERS
// ============================================================================

/**
 * Alias for {@link getAllBriefings} used by the export pipeline.
 *
 * @returns {Promise<Array>} Array of briefings
 */
export const getBriefingsForExport = getAllBriefings;

/**
 * Imports briefings from external data.
 *
 * @param {Array} briefings - Array of briefing data
 * @param {Object} [options] - Import options
 * @param {boolean} [options.overwrite=false] - Overwrite existing briefings with same ID
 * @returns {Promise<{imported: number, skipped: number}>} Import result
 */
export async function importBriefings(briefings, options = {}) {
    const { overwrite = false } = options;
    let imported = 0;
    let skipped = 0;
    let scope = getActiveScope();
    const assertWritable = captureRemoteWriteFence(scope);
    let repo = localRepository.forScope(scope);
    const assertOrigin = () => {
        assertWritable();
        // The initial local bridge may be activated by the first repository read.
        if (scope === null && getActiveScope()?.kind === 'local' && getActiveScope().dbSuffix === '') {
            scope = getActiveScope();
            repo = localRepository.forScope(scope);
        }
        if (getActiveScope() !== scope) throw new DOMException('O atlas mudou durante a importação.', 'AbortError');
    };
    const names = new Set((await repo.getAllBriefings()).map(briefing => briefing.name));
    assertOrigin();
    for (const briefing of briefings) {
        if (!briefing.id || !briefing.name) {
            skipped++;
            continue;
        }
        const toSave = deepClone(briefing);
        const existing = await repo.getBriefing(toSave.id);
        assertOrigin();
        const updating = Boolean(existing && overwrite);
        const copying = (scope?.kind === 'remote' && !updating) || (existing && !overwrite);
        if (copying) {
            toSave.id = generateUUID();
            if (Array.isArray(toSave.slides)) toSave.slides = toSave.slides.map(slide => ({ ...slide, id: generateUUID() }));
            const baseName = toSave.name;
            let number = 0;
            while (names.has(toSave.name)) toSave.name = `${baseName} (${++number})`;
        }
        if (!toSave.sync) toSave.sync = createSyncMetadata(null);
        const result = await writeBriefing(toSave.id, updating ? OperationType.UPDATE : OperationType.CREATE,
            updating ? GuardAction.UPDATE_BRIEFING : GuardAction.CREATE_BRIEFING, 'importBriefings',
            () => ({ value: { ...toSave, updatedAt: Date.now() } }));
        assertOrigin();
        if (result) {
            names.add(result.name);
            imported++;
        } else { skipped++; }
    }
    return { imported, skipped };
}
