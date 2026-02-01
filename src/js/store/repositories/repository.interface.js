// Path: js/store/repositories/repository.interface.js

/**
 * @fileoverview Repository interface definition.
 *
 * The Repository pattern abstracts data persistence, allowing the application
 * to work with data without knowing where it's stored (IndexedDB, REST API, etc.).
 *
 * This interface defines the contract that all repository implementations must follow.
 * Currently, only LocalRepository (IndexedDB) is implemented.
 * Future implementations may include:
 * - RemoteRepository (REST API)
 * - SyncRepository (combines local + remote with conflict resolution)
 */

/**
 * List of required methods for Repository implementations.
 * Used for runtime validation of repository objects.
 */
export const RepositoryMethods = Object.freeze([
    // Atlas operations
    'getAtlas',
    'saveAtlas',
    'ensureAtlas',

    // Map operations
    'getMap',
    'getMapById',
    'getAllMaps',
    'getAllMapIds',
    'saveMap',
    'deleteMap',
    'renameMap',

    // Image operations
    'saveImage',
    'getImage',
    'deleteImage',
    'hasImage',

    // Layer operations
    'getLayers',
    'saveLayers',
    'getActiveLayerId',
    'saveActiveLayerId',

    // Group operations
    'getGroups',
    'saveGroups',

    // Cesium 3D operations
    'getCesium3d',
    'saveCesium3d',

    // Street View 360 operations
    'getStreetview360',
    'saveStreetview360',

    // Settings operations
    'getSetting',
    'saveSetting',
    'deleteSetting',

    // Map notes operations
    'getMapNotes',
    'saveMapNotes',
    'deleteMapNotes',

    // Grid style operations
    'getGridStyle',
    'saveGridStyle',

    // Briefing operations
    'getAllBriefings',
    'getBriefing',
    'saveBriefing',
    'deleteBriefing',

    // Utility operations
    'clearAll',
]);

/**
 * Validates if an object implements the IRepository interface.
 * @param {Object} repository - Object to validate
 * @returns {boolean} True if all required methods are present
 */
export function validateRepository(repository) {
    if (!repository || typeof repository !== 'object') {
        return false;
    }
    return RepositoryMethods.every(
        method => typeof repository[method] === 'function'
    );
}

/**
 * Gets list of missing methods from a repository implementation.
 * Useful for debugging incomplete implementations.
 * @param {Object} repository - Object to check
 * @returns {string[]} List of missing method names
 */
export function getMissingMethods(repository) {
    if (!repository || typeof repository !== 'object') {
        return [...RepositoryMethods];
    }
    return RepositoryMethods.filter(
        method => typeof repository[method] !== 'function'
    );
}

/**
 * @typedef {Object} IRepository
 *
 * Atlas operations:
 * @property {() => Promise<import('../atlas/atlas.entity.js').Atlas|null>} getAtlas
 *   Get the current Atlas (or null if none exists)
 * @property {(atlas: import('../atlas/atlas.entity.js').Atlas) => Promise<void>} saveAtlas
 *   Save the Atlas (creates or updates)
 * @property {(name?: string) => Promise<import('../atlas/atlas.entity.js').Atlas>} ensureAtlas
 *   Get or create Atlas with given name
 *
 * Map operations:
 * @property {(mapIdOrName: string) => Promise<Object|null>} getMap
 *   Get a map by ID or name (with fallback resolution)
 * @property {(mapId: string) => Promise<Object|null>} getMapById
 *   Get a map by its exact ID (no fallback)
 * @property {() => Promise<Map<string, Object>>} getAllMaps
 *   Get all maps as a Map of id -> data
 * @property {() => Promise<string[]>} getAllMapIds
 *   Get list of all map IDs
 * @property {(mapIdOrName: string, data: Object) => Promise<void>} saveMap
 *   Save a map (creates or updates)
 * @property {(mapIdOrName: string) => Promise<void>} deleteMap
 *   Delete a map and all associated data
 * @property {(oldNameOrId: string, newName: string) => Promise<void>} renameMap
 *   Rename a map
 *
 * Image operations:
 * @property {(imageId: string, blob: Blob) => Promise<void>} saveImage
 *   Save an image blob
 * @property {(imageId: string) => Promise<Blob|null>} getImage
 *   Get an image blob by ID
 * @property {(imageId: string) => Promise<void>} deleteImage
 *   Delete an image
 * @property {(imageId: string) => Promise<boolean>} hasImage
 *   Check if an image exists
 *
 * Layer operations:
 * @property {(mapIdOrName: string) => Promise<Array>} getLayers
 *   Get layers for a map
 * @property {(mapIdOrName: string, layers: Array) => Promise<void>} saveLayers
 *   Save layers for a map
 * @property {(mapIdOrName: string) => Promise<string>} getActiveLayerId
 *   Get active layer ID for a map
 * @property {(mapIdOrName: string, layerId: string) => Promise<void>} saveActiveLayerId
 *   Save active layer ID for a map
 *
 * Group operations:
 * @property {(mapIdOrName: string) => Promise<Object>} getGroups
 *   Get groups for a map
 * @property {(mapIdOrName: string, groups: Object) => Promise<void>} saveGroups
 *   Save groups for a map
 *
 * Cesium 3D operations:
 * @property {(mapIdOrName: string) => Promise<Object>} getCesium3d
 *   Get Cesium 3D data for a map
 * @property {(mapIdOrName: string, data: Object) => Promise<void>} saveCesium3d
 *   Save Cesium 3D data for a map
 *
 * Street View 360 operations:
 * @property {(mapIdOrName: string) => Promise<Object>} getStreetview360
 *   Get Street View 360 data for a map
 * @property {(mapIdOrName: string, data: Object) => Promise<void>} saveStreetview360
 *   Save Street View 360 data for a map
 *
 * Settings operations:
 * @property {(key: string) => Promise<any>} getSetting
 *   Get a setting by key
 * @property {(key: string, value: any) => Promise<void>} saveSetting
 *   Save a setting
 * @property {(key: string) => Promise<void>} deleteSetting
 *   Delete a setting
 *
 * Map notes operations:
 * @property {(mapIdOrName: string) => Promise<Object|null>} getMapNotes
 *   Get notes for a map
 * @property {(mapIdOrName: string, notes: Object) => Promise<void>} saveMapNotes
 *   Save notes for a map
 * @property {(mapIdOrName: string) => Promise<void>} deleteMapNotes
 *   Delete notes for a map
 *
 * Grid style operations:
 * @property {(mapIdOrName: string) => Promise<Object|null>} getGridStyle
 *   Get grid style for a map
 * @property {(mapIdOrName: string, gridStyle: Object) => Promise<void>} saveGridStyle
 *   Save grid style for a map
 *
 * Briefing operations:
 * @property {() => Promise<Array>} getAllBriefings
 *   Get all briefings sorted by updatedAt desc
 * @property {(briefingId: string) => Promise<Object|null>} getBriefing
 *   Get a briefing by ID
 * @property {(briefingId: string, data: Object) => Promise<void>} saveBriefing
 *   Save a briefing (creates or updates)
 * @property {(briefingId: string) => Promise<void>} deleteBriefing
 *   Delete a briefing
 *
 * Utility operations:
 * @property {() => Promise<void>} clearAll
 *   Clear all data (for testing/reset)
 */

// ============================================================================
// FUTURE: RemoteRepository Implementation Guide
// ============================================================================
/**
 * @fileoverview RemoteRepository Implementation Guide
 *
 * When implementing a RemoteRepository for backend sync, consider:
 *
 * 1. AUTHENTICATION
 *    - Token-based auth (JWT) in Authorization header
 *    - Handle 401 responses and token refresh
 *
 * 2. CONFLICT RESOLUTION
 *    - Use `version` field for optimistic locking
 *    - On conflict (409), fetch latest version and merge
 *    - Consider Last-Write-Wins (LWW) or user prompt for conflicts
 *
 * 3. OFFLINE SUPPORT
 *    - Queue operations when offline
 *    - Sync when connection restored
 *    - Use `dirty` flag to track pending changes
 *
 * 4. ENTITY SYNC METADATA
 *    Each entity should have:
 *    - id: UUID (primary key)
 *    - createdAt: number (timestamp ms)
 *    - updatedAt: number (timestamp ms)
 *    - version: number (for conflict resolution)
 *    - ownerId: string (user UUID)
 *    - deleted: boolean (soft delete for sync)
 *
 * 5. API ENDPOINTS (suggested structure)
 *    - GET    /api/atlas                  -> getAtlas()
 *    - PUT    /api/atlas                  -> saveAtlas()
 *    - GET    /api/maps                   -> getAllMaps()
 *    - GET    /api/maps/:id               -> getMap()
 *    - PUT    /api/maps/:id               -> saveMap()
 *    - DELETE /api/maps/:id               -> deleteMap()
 *    - GET    /api/maps/:id/layers        -> getLayers()
 *    - PUT    /api/maps/:id/layers        -> saveLayers()
 *    - POST   /api/images                 -> saveImage() (multipart)
 *    - GET    /api/images/:id             -> getImage()
 *    - DELETE /api/images/:id             -> deleteImage()
 *    - GET    /api/briefings              -> getAllBriefings()
 *    - GET    /api/briefings/:id          -> getBriefing()
 *    - PUT    /api/briefings/:id          -> saveBriefing()
 *    - DELETE /api/briefings/:id          -> deleteBriefing()
 *
 * 6. SYNC STRATEGY
 *    SyncRepository should combine Local + Remote:
 *    - Read: Local first, then remote if stale
 *    - Write: Local immediately, then queue remote
 *    - Sync: Batch upload dirty entities, download changes
 *
 * Example RemoteRepository skeleton:
 * ```javascript
 * class RemoteRepository {
 *     constructor(baseUrl, authProvider) {
 *         this.baseUrl = baseUrl;
 *         this.auth = authProvider;
 *     }
 *
 *     async getMap(mapId) {
 *         const response = await fetch(`${this.baseUrl}/maps/${mapId}`, {
 *             headers: { Authorization: `Bearer ${await this.auth.getToken()}` }
 *         });
 *         if (response.status === 404) return null;
 *         if (response.status === 401) throw new AuthError();
 *         return response.json();
 *     }
 *
 *     async saveMap(mapId, data) {
 *         const response = await fetch(`${this.baseUrl}/maps/${mapId}`, {
 *             method: 'PUT',
 *             headers: {
 *                 'Content-Type': 'application/json',
 *                 Authorization: `Bearer ${await this.auth.getToken()}`,
 *                 'If-Match': data.version  // Optimistic locking
 *             },
 *             body: JSON.stringify(data)
 *         });
 *         if (response.status === 409) throw new ConflictError(await response.json());
 *         if (!response.ok) throw new ApiError(response);
 *     }
 * }
 * ```
 */
