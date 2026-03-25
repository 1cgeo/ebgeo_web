// Path: js/store/services.js

/**
 * @fileoverview Service container for dependency injection.
 * Centralizes creation and wiring of application services, solving
 * circular dependencies and global singletons.
 *
 * Usage:
 *   import { initServices } from './store/services.js';
 *   initServices(); // once at startup
 *
 *   import { getEventBus, getLayerManager } from './store/services.js';
 *   const eventBus = getEventBus();
 */

import { createEventBus } from '../events';
import { createGroupManager, groupManagerHolder, initColorPickerEvents } from '../tool_manager';
import { createLayerManager, layerManagerHolder } from '../layers';
import { createStateManager } from '../state';
import { initStoreEvents } from './store.js';
import { mapResolver, setResolverInitPromise } from './services/map-resolver.service.js';
import { getRepository } from './repositories/index.js';
import { sessionContext } from './sync/session-context.js';
import { connectionState } from './sync/connection-state.js';
import { syncGateway } from './sync/sync-gateway.js';
import { enableOperationLogging } from './sync/operation-dispatcher.js';
import { operationQueue } from './sync/operation-queue.js';
import { initSessionEventBridge, initConnectionEventBridge } from './sync/event-bridges.js';
import { applyRemoteOperation, setRemoteHandlerEventBus } from './sync/remote-operation-handler.js';
import { initSyncScheduler } from './sync/sync-scheduler.js';

/**
 * @typedef {Object} Services
 * @property {import('../events/event_bus.js').EventBus} eventBus
 * @property {import('../state/state_manager.js').StateManager} stateManager
 * @property {import('../tool_manager/group_manager.js').GroupManager} groupManager
 * @property {import('../layers/layer.manager.js').LayerManager} layerManager
 * @property {import('./services/map-resolver.service.js').MapResolverService} mapResolver
 * @property {import('./sync/session-context.js').SessionContext} sessionContext
 * @property {import('./sync/connection-state.js').ConnectionState} connectionState
 * @property {import('./sync/sync-gateway.js').SyncGateway} syncGateway
 */

/** @type {Services|null} */
let services = null;

/**
 * Initialize all application services.
 * Must be called once at startup before any service is used.
 * @throws {Error} If called more than once
 * @returns {Services}
 */
export function initServices() {
    if (services !== null) {
        throw new Error('Services already initialized. initServices() must be called only once.');
    }

    const eventBus = createEventBus();

    const stateManager = createStateManager();
    stateManager.setEventBus(eventBus);

    const groupManager = createGroupManager(eventBus);
    const layerManager = createLayerManager(eventBus);

    // Populate holders for backward-compatible default exports
    groupManagerHolder.instance = groupManager;
    layerManagerHolder.instance = layerManager;

    initStoreEvents(eventBus, groupManager, layerManager);
    initColorPickerEvents();

    // Map resolver init is async; awaited before first use in store.js
    const initPromise = mapResolver.initialize(getRepository());
    initPromise.catch(err => {
        console.warn('MapResolver initialization error:', err);
    });
    setResolverInitPromise(initPromise);

    enableOperationLogging();
    operationQueue.startAutoPurge();

    // Wire event bridges and sync infrastructure
    initSessionEventBridge(eventBus);
    initConnectionEventBridge(eventBus);
    setRemoteHandlerEventBus(eventBus);
    syncGateway.setRemoteOperationHandler(applyRemoteOperation);
    initSyncScheduler(eventBus);

    services = Object.freeze({
        eventBus,
        stateManager,
        groupManager,
        layerManager,
        mapResolver,
        sessionContext,
        connectionState,
        syncGateway,
    });

    if (typeof window !== 'undefined') {
        window.eventBus = eventBus;
        window.stateManager = stateManager;
    }

    return services;
}

/**
 * @throws {Error} If services not initialized
 * @returns {Services}
 */
export function getServices() {
    if (services === null) {
        throw new Error('Services not initialized. Call initServices() first.');
    }
    return services;
}

/** @returns {import('../events/event_bus.js').EventBus} */
export function getEventBus() {
    return getServices().eventBus;
}

/** @returns {import('../state/state_manager.js').StateManager} */
export function getStateManager() {
    return getServices().stateManager;
}

/** @returns {import('../layers/layer.manager.js').LayerManager} */
export function getLayerManager() {
    return getServices().layerManager;
}

/** @returns {import('../tool_manager/group_manager.js').GroupManager} */
export function getGroupManager() {
    return getServices().groupManager;
}

/** @returns {import('./services/map-resolver.service.js').MapResolverService} */
export function getMapResolver() {
    return getServices().mapResolver;
}
