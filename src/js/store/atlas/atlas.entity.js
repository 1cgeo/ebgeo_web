// Path: js/store/atlas/atlas.entity.js

/**
 * @fileoverview Atlas entity - top-level project container (one Atlas = one .ebgeo file).
 * Contains metadata, map ordering, and sync data for a project.
 */

import { createSyncMetadata, isValidSyncMetadata } from '../sync/sync-metadata.js';
import { generateUUID } from '../../utilities/uuid.js';

/** Current Atlas schema version. Increment on breaking changes to Atlas structure. */
export const ATLAS_SCHEMA_VERSION = '2.0';

/** @type {number} Default terrain exaggeration multiplier */
export const DEFAULT_TERRAIN_EXAGGERATION = 1.5;

/**
 * @typedef {Object} AtlasSettings
 * @property {number} [terrainExaggeration] - Terrain height multiplier (1-3)
 */

/**
 * @typedef {Object} Atlas
 * @property {string} id - UUID of the Atlas
 * @property {string} name - Display name of the Atlas
 * @property {import('../sync/sync-metadata.js').SyncMetadata} sync - Sync metadata
 * @property {string} schemaVersion - Schema version for migration support
 * @property {string[]} mapOrder - Ordered list of map IDs
 * @property {string|null} lastActiveMapId - UUID of last active map
 * @property {AtlasSettings} [settings] - Atlas-wide settings
 */

/**
 * Creates a new Atlas with default values.
 * @param {string} [name='Meu Atlas'] - Display name for the Atlas
 * @returns {Atlas} New Atlas object
 */
export function createAtlas(name = 'Meu Atlas') {
    return {
        id: generateUUID(),
        name,
        sync: createSyncMetadata(null),
        schemaVersion: ATLAS_SCHEMA_VERSION,
        mapOrder: [],
        lastActiveMapId: null,
        settings: { terrainExaggeration: DEFAULT_TERRAIN_EXAGGERATION },
    };
}

/**
 * Validates if an object is a valid Atlas.
 * @param {Object} atlas - Object to validate
 * @returns {boolean} True if valid Atlas
 */
export function isValidAtlas(atlas) {
    if (!atlas || typeof atlas !== 'object') return false;

    const hasValidSettings = atlas.settings === undefined ||
        (typeof atlas.settings === 'object' && atlas.settings !== null);

    return (
        typeof atlas.id === 'string' &&
        typeof atlas.name === 'string' &&
        isValidSyncMetadata(atlas.sync) &&
        typeof atlas.schemaVersion === 'string' &&
        Array.isArray(atlas.mapOrder) &&
        atlas.mapOrder.every(id => typeof id === 'string') &&
        (atlas.lastActiveMapId === null || typeof atlas.lastActiveMapId === 'string') &&
        hasValidSettings
    );
}

/**
 * Adds a map ID to the Atlas map order.
 * @param {Atlas} atlas - Atlas to modify
 * @param {string} mapId - Map ID to add
 * @param {number} [position] - Position to insert at (defaults to end)
 * @returns {Atlas} New Atlas object with map added
 */
export function addMapToAtlas(atlas, mapId, position) {
    const newOrder = [...atlas.mapOrder];
    if (position !== undefined && position >= 0 && position <= newOrder.length) {
        newOrder.splice(position, 0, mapId);
    } else {
        newOrder.push(mapId);
    }
    return {
        ...atlas,
        mapOrder: newOrder,
    };
}

/**
 * Removes a map ID from the Atlas map order.
 * @param {Atlas} atlas - Atlas to modify
 * @param {string} mapId - Map ID to remove
 * @returns {Atlas} New Atlas object with map removed
 */
export function removeMapFromAtlas(atlas, mapId) {
    return {
        ...atlas,
        mapOrder: atlas.mapOrder.filter(id => id !== mapId),
        lastActiveMapId: atlas.lastActiveMapId === mapId ? null : atlas.lastActiveMapId,
    };
}

/**
 * Reorders maps in the Atlas.
 * @param {Atlas} atlas - Atlas to modify
 * @param {string[]} newOrder - New ordered list of map IDs
 * @returns {Atlas} New Atlas object with reordered maps
 */
export function reorderAtlasMaps(atlas, newOrder) {
    const currentSet = new Set(atlas.mapOrder);
    const hasSameIds = newOrder.length === currentSet.size &&
        newOrder.every(id => currentSet.has(id));
    if (!hasSameIds) {
        throw new Error('New order must contain exactly the same map IDs');
    }
    return {
        ...atlas,
        mapOrder: newOrder,
    };
}

/**
 * Sets the last active map ID.
 * @param {Atlas} atlas - Atlas to modify
 * @param {string|null} mapId - Map ID to set as active
 * @returns {Atlas} New Atlas object
 */
export function setAtlasActiveMap(atlas, mapId) {
    return {
        ...atlas,
        lastActiveMapId: mapId,
    };
}

/**
 * Updates the Atlas name.
 * @param {Atlas} atlas - Atlas to modify
 * @param {string} name - New name
 * @returns {Atlas} New Atlas object
 */
export function renameAtlas(atlas, name) {
    return {
        ...atlas,
        name,
    };
}

/**
 * Gets terrain exaggeration from an Atlas, with fallback to default.
 * @param {Atlas|null} atlas - Atlas object (may be null or missing settings)
 * @returns {number} Terrain exaggeration value
 */
export function getAtlasTerrainExaggeration(atlas) {
    return atlas?.settings?.terrainExaggeration ?? DEFAULT_TERRAIN_EXAGGERATION;
}
