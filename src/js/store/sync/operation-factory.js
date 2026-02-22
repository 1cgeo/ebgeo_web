// Path: js/store/sync/operation-factory.js

/**
 * @fileoverview Factory for creating sync operations.
 * Provides standardized operation creation for the sync system.
 */

import { generateUUID } from '../../utilities/uuid.js';
import { isValidEntityType, isValidOperationType } from './operation-types.js';

/**
 * Client ID for this browser session.
 * Persisted to localStorage for consistency across page reloads.
 * @type {string}
 */
let clientId = null;

/**
 * Gets or creates the client ID for this session.
 * @returns {string} Client ID
 */
export function getClientId() {
    if (clientId) {
        return clientId;
    }

    // Try to get from localStorage
    const stored = localStorage.getItem('ebgeo_client_id');
    if (stored) {
        clientId = stored;
        return clientId;
    }

    // Generate new client ID
    clientId = generateUUID();
    localStorage.setItem('ebgeo_client_id', clientId);
    return clientId;
}

/**
 * Resets the client ID (for testing).
 */
export function resetClientId() {
    clientId = null;
    localStorage.removeItem('ebgeo_client_id');
}

// ============================================================================
// LAMPORT CLOCK
// ============================================================================

/**
 * Logical clock for causal ordering of operations across clients.
 * Incremented on every local operation. When receiving remote operations,
 * call advanceLamportClock(remoteTimestamp) to synchronize.
 * @type {number}
 */
let _lamportClock = 0;

/**
 * Gets the current Lamport clock value (without incrementing).
 * @returns {number} Current clock value
 */
export function getLamportClock() {
    return _lamportClock;
}

/**
 * Advances the Lamport clock after receiving a remote operation.
 * Sets clock to max(local, remote) + 1 to maintain causal ordering.
 * @param {number} remoteTimestamp - Lamport timestamp from the remote operation
 */
export function advanceLamportClock(remoteTimestamp) {
    _lamportClock = Math.max(_lamportClock, remoteTimestamp) + 1;
}

/**
 * @typedef {Object} Operation
 * @property {string} id - Unique operation ID
 * @property {string} entityType - Type of entity affected
 * @property {string} operationType - Type of operation (create/update/delete)
 * @property {string} entityId - ID of the affected entity
 * @property {string|null} mapId - ID of the map context (null for atlas-level)
 * @property {Object|null} data - New/updated data (null for deletes)
 * @property {Object|null} previousData - Previous data (for undo support)
 * @property {number} timestamp - Wall clock timestamp in milliseconds (Date.now())
 * @property {number} lamportTimestamp - Logical clock for causal ordering across clients
 * @property {string} clientId - ID of the client that created this operation
 */

/**
 * Creates a sync operation object.
 *
 * @param {string} entityType - Type of entity (from EntityType)
 * @param {string} operationType - Operation type (from OperationType)
 * @param {string} entityId - ID of the affected entity
 * @param {string|null} mapId - Map context (null for atlas-level operations)
 * @param {Object|null} data - New/updated data
 * @param {Object|null} previousData - Previous data for undo support
 * @returns {Operation} Created operation
 * @throws {Error} If entity or operation type is invalid
 */
export function createOperation(entityType, operationType, entityId, mapId, data = null, previousData = null) {
    if (!isValidEntityType(entityType)) {
        throw new Error(`Invalid entity type: ${entityType}`);
    }
    if (!isValidOperationType(operationType)) {
        throw new Error(`Invalid operation type: ${operationType}`);
    }
    if (!entityId) {
        throw new Error('Entity ID is required');
    }

    return {
        id: generateUUID(),
        entityType,
        operationType,
        entityId,
        mapId: mapId || null,
        data,
        previousData,
        timestamp: Date.now(),
        lamportTimestamp: ++_lamportClock,
        clientId: getClientId()
    };
}

/**
 * Creates a batch of operations.
 *
 * @param {Array<{entityType: string, operationType: string, entityId: string, mapId?: string, data?: Object, previousData?: Object}>} operations - Operations to create
 * @returns {Operation[]} Array of created operations
 */
export function createBatchOperations(operations) {
    const batchId = generateUUID();
    const timestamp = Date.now();
    const client = getClientId();

    return operations.map((op, index) => ({
        id: generateUUID(),
        entityType: op.entityType,
        operationType: op.operationType,
        entityId: op.entityId,
        mapId: op.mapId || null,
        data: op.data || null,
        previousData: op.previousData || null,
        timestamp,
        lamportTimestamp: ++_lamportClock,
        clientId: client,
        batchId,
        batchIndex: index
    }));
}
