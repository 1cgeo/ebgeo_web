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
        // Temporal timeline cursor (epoch ms) captured for 2D slides when the
        // map's temporal control is enabled; null when temporal is off or for
        // non-2D slides. Older slides lack this field and are treated as null.
        temporalCursor: null
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
