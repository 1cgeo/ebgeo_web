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
import { generateUUID } from '../utilities/uuid.js';
import { createSyncMetadata, touchSyncMetadata } from './sync/sync-metadata.js';
import { logBriefingOperation, logOperation, EntityType, OperationType } from './sync/index.js';

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
            heading: null
        },
        modelId: null,
        photoId: null
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

/**
 * Gets all briefings.
 *
 * @returns {Promise<Array>} Array of briefings sorted by updatedAt desc
 */
export async function getAllBriefings() {
    return await localRepository.getAllBriefings();
}

/**
 * Gets a briefing by ID.
 *
 * @param {string} briefingId - Briefing UUID
 * @returns {Promise<Object|null>} Briefing data or null
 */
export async function getBriefingById(briefingId) {
    return await localRepository.getBriefing(briefingId);
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

    if (data.slides && Array.isArray(data.slides)) {
        briefing.slides = data.slides;
    }

    if (data.settings) {
        briefing.settings = { ...DEFAULT_BRIEFING_SETTINGS, ...data.settings };
    }

    await localRepository.saveBriefing(briefing.id, briefing);

    // Log operation for sync
    logBriefingOperation(OperationType.CREATE, briefing.id, briefing);

    return briefing;
}

/**
 * Updates an existing briefing.
 *
 * @param {string} briefingId - Briefing UUID
 * @param {Object} data - Data to update
 * @returns {Promise<Object|null>} Updated briefing or null if not found
 */
export async function updateBriefing(briefingId, data) {
    const existing = await localRepository.getBriefing(briefingId);
    if (!existing) {
        return null;
    }

    // Capture previous state for logging
    const previousData = JSON.parse(JSON.stringify(existing));

    const updated = {
        ...existing,
        ...data,
        id: briefingId, // Ensure ID is not changed
        sync: touchSyncMetadata(existing.sync),
        updatedAt: Date.now()
    };

    // Preserve createdAt
    updated.createdAt = existing.createdAt;

    await localRepository.saveBriefing(briefingId, updated);

    // Log operation for sync
    logBriefingOperation(OperationType.UPDATE, briefingId, updated, previousData);

    return updated;
}

/**
 * Deletes a briefing.
 *
 * @param {string} briefingId - Briefing UUID
 * @returns {Promise<boolean>} True if deleted
 */
export async function deleteBriefing(briefingId) {
    const existing = await localRepository.getBriefing(briefingId);
    if (!existing) {
        return false;
    }

    await localRepository.deleteBriefing(briefingId);

    // Log operation for sync
    logBriefingOperation(OperationType.DELETE, briefingId, null, existing);

    return true;
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
    const briefing = await getBriefingById(briefingId);
    if (!briefing) {
        return null;
    }

    const order = position !== null ? position : briefing.slides.length;
    const slide = {
        ...createEmptySlide(order),
        ...slideData,
        id: slideData.id || generateUUID(),
        sync: createSyncMetadata(null)
    };

    // Insert at position or append
    if (position !== null && position < briefing.slides.length) {
        briefing.slides.splice(position, 0, slide);
        // Reorder subsequent slides
        for (let i = position + 1; i < briefing.slides.length; i++) {
            briefing.slides[i].order = i;
        }
    } else {
        slide.order = briefing.slides.length;
        briefing.slides.push(slide);
    }

    await updateBriefing(briefingId, { slides: briefing.slides });

    // Log slide operation for sync
    logOperation(EntityType.SLIDE, OperationType.CREATE, slide.id, briefingId, slide);

    return slide;
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
    const briefing = await getBriefingById(briefingId);
    if (!briefing) {
        return null;
    }

    const slideIndex = briefing.slides.findIndex(s => s.id === slideId);
    if (slideIndex === -1) {
        return null;
    }

    // Capture previous state for logging
    const previousSlide = { ...briefing.slides[slideIndex] };

    briefing.slides[slideIndex] = {
        ...briefing.slides[slideIndex],
        ...slideData,
        id: slideId, // Ensure ID is not changed
        sync: touchSyncMetadata(briefing.slides[slideIndex].sync || createSyncMetadata(null))
    };

    await updateBriefing(briefingId, { slides: briefing.slides });

    // Log slide operation for sync
    logOperation(EntityType.SLIDE, OperationType.UPDATE, slideId, briefingId, briefing.slides[slideIndex], previousSlide);

    return briefing.slides[slideIndex];
}

/**
 * Removes a slide from a briefing.
 *
 * @param {string} briefingId - Briefing UUID
 * @param {string} slideId - Slide UUID
 * @returns {Promise<boolean>} True if removed
 */
export async function removeSlide(briefingId, slideId) {
    const briefing = await getBriefingById(briefingId);
    if (!briefing) {
        return false;
    }

    const slideIndex = briefing.slides.findIndex(s => s.id === slideId);
    if (slideIndex === -1) {
        return false;
    }

    // Capture slide data before removal for logging
    const removedSlide = { ...briefing.slides[slideIndex] };

    briefing.slides.splice(slideIndex, 1);

    // Reorder remaining slides
    for (let i = 0; i < briefing.slides.length; i++) {
        briefing.slides[i].order = i;
    }

    await updateBriefing(briefingId, { slides: briefing.slides });

    // Log slide operation for sync
    logOperation(EntityType.SLIDE, OperationType.DELETE, slideId, briefingId, null, removedSlide);

    return true;
}

/**
 * Reorders slides in a briefing.
 *
 * @param {string} briefingId - Briefing UUID
 * @param {string[]} slideIds - Array of slide IDs in new order
 * @returns {Promise<boolean>} True if reordered
 */
export async function reorderSlides(briefingId, slideIds) {
    const briefing = await getBriefingById(briefingId);
    if (!briefing) {
        return false;
    }

    // Create a map of slides by ID
    const slideMap = new Map(briefing.slides.map(s => [s.id, s]));

    // Reorder based on slideIds array
    const reorderedSlides = [];
    for (let i = 0; i < slideIds.length; i++) {
        const slide = slideMap.get(slideIds[i]);
        if (slide) {
            slide.order = i;
            reorderedSlides.push(slide);
            slideMap.delete(slideIds[i]);
        }
    }

    // Append any slides not in slideIds (shouldn't happen, but safety)
    for (const slide of slideMap.values()) {
        slide.order = reorderedSlides.length;
        reorderedSlides.push(slide);
    }

    await updateBriefing(briefingId, { slides: reorderedSlides });
    return true;
}

// ============================================================================
// EXPORT/IMPORT HELPERS
// ============================================================================

/**
 * Gets all briefings for export.
 *
 * @returns {Promise<Array>} Array of briefings
 */
export async function getBriefingsForExport() {
    return await getAllBriefings();
}

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

    for (const briefing of briefings) {
        if (!briefing.id || !briefing.name) {
            skipped++;
            continue;
        }

        const existing = await getBriefingById(briefing.id);
        if (existing && !overwrite) {
            skipped++;
            continue;
        }

        // Ensure sync metadata
        if (!briefing.sync) {
            briefing.sync = createSyncMetadata(null);
        }

        await localRepository.saveBriefing(briefing.id, {
            ...briefing,
            updatedAt: Date.now()
        });
        imported++;
    }

    return { imported, skipped };
}
