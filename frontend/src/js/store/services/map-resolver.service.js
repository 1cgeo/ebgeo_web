// Path: js/store/services/map-resolver.service.js

/**
 * Bidirectional map name/UUID resolution service.
 * Maintains an in-memory mapping that allows the application to work with
 * either display names or UUIDs transparently.
 */

import { isValidUUID } from '../../utilities/uuid.js';

/**
 * Provides resolution between map names and UUIDs.
 */
class MapResolverService {
    constructor() {
        /** @type {Map<string, string>} name -> id */
        this._nameToId = new Map();
        /** @type {Map<string, string>} id -> name */
        this._idToName = new Map();
        this._initialized = false;
    }

    /**
     * Initializes the resolver from repository data.
     * @param {import('../repositories/local.repository.js').LocalRepository} repository
     * @returns {Promise<void>}
     */
    async initialize(repository) {
        this._nameToId.clear();
        this._idToName.clear();

        try {
            const atlas = await repository.getAtlas();
            if (atlas?.mapOrder) {
                for (const mapId of atlas.mapOrder) {
                    const mapData = await repository.getMap(mapId);
                    if (mapData?.name) {
                        this.registerMap(mapData.name, mapId);
                    }
                }
            }

            // Scan all maps in storage to handle legacy data without Atlas
            const allMapIds = await repository.getAllMapIds();
            for (const mapId of allMapIds) {
                if (this._idToName.has(mapId)) continue;

                const mapData = await repository.getMap(mapId);
                if (mapData) {
                    this.registerMap(mapData.name || mapId, mapId);
                }
            }

            this._initialized = true;
        } catch (error) {
            console.warn('MapResolver: Error during initialization', error);
            this._initialized = true;
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
     * Updates a map's name mapping.
     * @param {string} oldName
     * @param {string} newName
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
     * If input is already a known UUID, returns it as-is.
     * If input is a name, returns the corresponding UUID.
     * @param {string} nameOrId - Map name or UUID
     * @returns {string} Map UUID (or original input if not found)
     */
    resolveToId(nameOrId) {
        if (!nameOrId) return nameOrId;

        if (isValidUUID(nameOrId) && this._idToName.has(nameOrId)) {
            return nameOrId;
        }

        return this._nameToId.get(nameOrId) || nameOrId;
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

        if (isValidUUID(nameOrId)) {
            return this._idToName.get(nameOrId) || nameOrId;
        }

        return nameOrId;
    }

    /**
     * Checks if a name or ID is known to the resolver.
     * @param {string} nameOrId - Map name or UUID
     * @returns {boolean}
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
     * @param {string} name
     * @returns {string|undefined}
     */
    getIdForName(name) {
        return this._nameToId.get(name);
    }

    /**
     * Gets the name for an ID.
     * @param {string} id
     * @returns {string|undefined}
     */
    getNameForId(id) {
        return this._idToName.get(id);
    }

    /**
     * Gets all known map names.
     * @returns {string[]}
     */
    getAllNames() {
        return Array.from(this._nameToId.keys());
    }

    /**
     * Gets all known map IDs.
     * @returns {string[]}
     */
    getAllIds() {
        return Array.from(this._idToName.keys());
    }

    /**
     * Clears all mappings and resets initialization state.
     */
    clear() {
        this._nameToId.clear();
        this._idToName.clear();
        this._initialized = false;
    }

    /** @returns {boolean} Whether the resolver has been initialized */
    get isInitialized() {
        return this._initialized;
    }

    /** @returns {number} Number of registered maps */
    get size() {
        return this._idToName.size;
    }
}

/** Singleton instance of MapResolverService. */
export const mapResolver = new MapResolverService();

/** @type {Promise<void>|null} */
let _initPromise = null;

/**
 * Stores the initialization promise so it can be awaited later.
 * Called by services.js during startup.
 * @param {Promise<void>} promise
 */
export function setResolverInitPromise(promise) {
    _initPromise = promise;
}

/**
 * Awaits map resolver initialization.
 * Call this before any operation that depends on name/ID resolution being ready.
 * @returns {Promise<void>}
 */
export function awaitMapResolverReady() {
    return _initPromise || Promise.resolve();
}

/**
 * Factory function to create a new MapResolverService instance (for testing).
 * @returns {MapResolverService}
 */
export function createMapResolver() {
    return new MapResolverService();
}

export { MapResolverService };
