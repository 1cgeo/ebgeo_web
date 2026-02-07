// Path: js/store/services/map-resolver.service.js

/**
 * @fileoverview Map Name/ID Resolution Service.
 *
 * This service provides transparent resolution between map names and UUIDs.
 * It maintains an in-memory bidirectional mapping that allows the application
 * to work with either names or IDs during the transition period.
 *
 * Key features:
 * - Bidirectional name ↔ ID resolution
 * - Auto-detection of whether input is name or UUID
 * - Lazy initialization from Atlas and map data
 * - Supports legacy name-based access and new UUID-based access
 */

import { isValidUUID } from '../../utilities/uuid.js';

/**
 * Map Resolver Service class.
 * Provides resolution between map names and UUIDs.
 */
class MapResolverService {
    constructor() {
        /** @type {Map<string, string>} Map name -> map ID */
        this._nameToId = new Map();

        /** @type {Map<string, string>} Map ID -> map name */
        this._idToName = new Map();

        /** @type {boolean} Whether the resolver has been initialized */
        this._initialized = false;
    }

    /**
     * Initializes the resolver from repository data.
     * @param {import('../repositories/local.repository.js').LocalRepository} repository - Repository instance
     * @returns {Promise<void>}
     */
    async initialize(repository) {
        this._nameToId.clear();
        this._idToName.clear();

        try {
            // Load from Atlas first (authoritative source for map order)
            const atlas = await repository.getAtlas();
            if (atlas && atlas.mapOrder) {
                // Atlas contains UUIDs, need to load each map to get names
                for (const mapId of atlas.mapOrder) {
                    const mapData = await repository.getMap(mapId);
                    if (mapData && mapData.name) {
                        this.registerMap(mapData.name, mapId);
                    }
                }
            }

            // Also scan all maps in storage (handles legacy data without Atlas)
            const allMapIds = await repository.getAllMapIds();
            for (const mapId of allMapIds) {
                // Skip if already registered from Atlas
                if (this._idToName.has(mapId)) continue;

                const mapData = await repository.getMap(mapId);
                if (mapData) {
                    // Determine the name - could be from 'name' field or the key itself (legacy)
                    const mapName = mapData.name || mapId;
                    this.registerMap(mapName, mapId);
                }
            }

            this._initialized = true;
        } catch (error) {
            console.warn('MapResolver: Error during initialization', error);
            this._initialized = true; // Mark as initialized even on error
        }
    }

    /**
     * Registers a name/ID mapping.
     * @param {string} name - Map display name
     * @param {string} id - Map UUID
     */
    registerMap(name, id) {
        this._nameToId.set(name, id);
        this._idToName.set(id, name);
    }

    /**
     * Unregisters a map by ID.
     * @param {string} id - Map UUID
     */
    unregisterMapById(id) {
        const name = this._idToName.get(id);
        if (name) {
            this._nameToId.delete(name);
        }
        this._idToName.delete(id);
    }

    /**
     * Updates a map's name.
     * @param {string} oldName - Old map name
     * @param {string} newName - New map name
     */
    renameMap(oldName, newName) {
        const id = this._nameToId.get(oldName);
        if (id) {
            this._nameToId.delete(oldName);
            this._nameToId.set(newName, id);
            this._idToName.set(id, newName);
        }
    }

    /**
     * Resolves input to a map UUID.
     * If input is already a UUID, returns it as-is.
     * If input is a name, returns the corresponding UUID.
     * @param {string} nameOrId - Map name or UUID
     * @returns {string} Map UUID (or original input if not found)
     */
    resolveToId(nameOrId) {
        if (!nameOrId) return nameOrId;

        // If it's already a valid UUID and we know it, return it
        if (isValidUUID(nameOrId)) {
            // Check if it's a known ID
            if (this._idToName.has(nameOrId)) {
                return nameOrId;
            }
            // It's a UUID format but we don't know it - could be new or legacy
            // Check if there's a name mapping for it
            const idFromName = this._nameToId.get(nameOrId);
            if (idFromName) {
                return idFromName;
            }
            // Return as-is (assume it's a valid ID we haven't seen)
            return nameOrId;
        }

        // It's not a UUID, treat as name
        const id = this._nameToId.get(nameOrId);
        return id || nameOrId; // Return name as fallback (legacy mode)
    }

    /**
     * Resolves input to a map name.
     * If input is a UUID, returns the corresponding name.
     * If input is already a name, returns it as-is.
     * @param {string} nameOrId - Map name or UUID
     * @returns {string} Map name (or original input if not found)
     */
    resolveToName(nameOrId) {
        if (!nameOrId) return nameOrId;

        // If it's a UUID format
        if (isValidUUID(nameOrId)) {
            const name = this._idToName.get(nameOrId);
            return name || nameOrId; // Return ID as fallback if name not found
        }

        // It's not a UUID, assume it's already a name
        // But verify it's a known name
        if (this._nameToId.has(nameOrId)) {
            return nameOrId;
        }

        // Unknown - return as-is
        return nameOrId;
    }

    /**
     * Checks if a name or ID is known to the resolver.
     * @param {string} nameOrId - Map name or UUID
     * @returns {boolean} True if known
     */
    isKnown(nameOrId) {
        if (!nameOrId) return false;

        if (isValidUUID(nameOrId)) {
            return this._idToName.has(nameOrId);
        }
        return this._nameToId.has(nameOrId);
    }

    /**
     * Gets the ID for a name.
     * @param {string} name - Map name
     * @returns {string|undefined} Map ID or undefined
     */
    getIdForName(name) {
        return this._nameToId.get(name);
    }

    /**
     * Gets the name for an ID.
     * @param {string} id - Map ID
     * @returns {string|undefined} Map name or undefined
     */
    getNameForId(id) {
        return this._idToName.get(id);
    }

    /**
     * Gets all known map names.
     * @returns {string[]} Array of map names
     */
    getAllNames() {
        return Array.from(this._nameToId.keys());
    }

    /**
     * Gets all known map IDs.
     * @returns {string[]} Array of map IDs
     */
    getAllIds() {
        return Array.from(this._idToName.keys());
    }

    /**
     * Clears all mappings.
     */
    clear() {
        this._nameToId.clear();
        this._idToName.clear();
        this._initialized = false;
    }

    /**
     * Whether the resolver has been initialized.
     * @returns {boolean}
     */
    get isInitialized() {
        return this._initialized;
    }

    /**
     * Gets the number of registered maps.
     * @returns {number}
     */
    get size() {
        return this._idToName.size;
    }
}

/**
 * Singleton instance of MapResolverService.
 */
export const mapResolver = new MapResolverService();

/** @type {Promise<void>|null} */
let _initPromise = null;

/**
 * Stores the initialization promise so it can be awaited later.
 * Called by services.js during startup.
 * @param {Promise<void>} promise - The initialization promise
 */
export function setResolverInitPromise(promise) {
    _initPromise = promise;
}

/**
 * Awaits map resolver initialization.
 * Call this before any operation that depends on name↔ID resolution being ready.
 * @returns {Promise<void>}
 */
export function awaitMapResolverReady() {
    return _initPromise || Promise.resolve();
}

/**
 * Factory function to create a new MapResolverService instance.
 * Useful for testing.
 * @returns {MapResolverService} New instance
 */
export function createMapResolver() {
    return new MapResolverService();
}

export { MapResolverService };
