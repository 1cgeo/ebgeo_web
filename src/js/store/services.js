// Path: js/store/services.js

/**
 * @fileoverview Service container for dependency injection.
 * Centralizes creation and wiring of application services.
 *
 * This module solves the problem of circular dependencies and global singletons
 * by providing a single point of initialization where all services are created
 * and wired together.
 *
 * Usage:
 *   // In application entry point (e.g., map_sig.js)
 *   import { initServices, getServices } from './store/services.js';
 *
 *   // Initialize once at startup
 *   initServices();
 *
 *   // Get services anywhere
 *   const { eventBus, stateManager, groupManager, layerManager } = getServices();
 */

import { createEventBus } from '../events';
import { createGroupManager, groupManagerHolder, initColorPickerEvents } from '../tool_manager';
import { createLayerManager, layerManagerHolder } from '../layers';
import { initStoreEvents } from './store.js';
import { createStateManager } from '../state';
import { mapResolver } from './services/map-resolver.service.js';
import { getRepository } from './repositories/index.js';

/**
 * @typedef {Object} Services
 * @property {import('../events/event_bus.js').EventBus} eventBus - Application event bus
 * @property {import('../state/state_manager.js').StateManager} stateManager - Centralized UI state manager
 * @property {import('../tool_manager/group_manager.js').GroupManager} groupManager - Group manager
 * @property {import('../layers/layer.manager.js').LayerManager} layerManager - Layer manager
 * @property {import('./services/map-resolver.service.js').MapResolverService} mapResolver - Map name/ID resolver
 */

/** @type {Services|null} */
let services = null;

/**
 * Initialize all application services.
 * Must be called once at application startup before any service is used.
 * @throws {Error} If called more than once
 * @returns {Services} Initialized services
 */
export function initServices() {
    if (services !== null) {
        throw new Error('Services already initialized. initServices() must be called only once.');
    }

    // Create EventBus first - it has no dependencies
    const eventBus = createEventBus();

    // Create StateManager - centralized UI state
    const stateManager = createStateManager();
    // Wire EventBus to StateManager for UI coordination events
    stateManager.setEventBus(eventBus);

    // Create managers with EventBus dependency
    const groupManager = createGroupManager(eventBus);
    const layerManager = createLayerManager(eventBus);

    // Populate holders for backward-compatible default exports
    groupManagerHolder.instance = groupManager;
    layerManagerHolder.instance = layerManager;

    // Initialize store module with all dependencies
    initStoreEvents(eventBus, groupManager, layerManager);

    // Initialize color picker event subscriptions
    initColorPickerEvents();

    // Initialize map resolver with repository
    // Note: This is async but we don't await it to avoid blocking initialization
    // The resolver will populate itself in the background
    const repository = getRepository();
    mapResolver.initialize(repository).catch(err => {
        console.warn('MapResolver initialization error:', err);
    });

    // Freeze services object to prevent modification
    services = Object.freeze({
        eventBus,
        stateManager,
        groupManager,
        layerManager,
        mapResolver,
    });

    // Expose services globally for debugging in browser console
    if (typeof window !== 'undefined') {
        window.eventBus = eventBus;
        window.stateManager = stateManager;
    }

    return services;
}

/**
 * Get initialized services.
 * @throws {Error} If services not initialized
 * @returns {Services} Initialized services
 */
export function getServices() {
    if (services === null) {
        throw new Error('Services not initialized. Call initServices() first.');
    }
    return services;
}

/**
 * Get EventBus instance.
 * Convenience function for common use case.
 * @throws {Error} If services not initialized
 * @returns {import('../events/event_bus.js').EventBus}
 */
export function getEventBus() {
    return getServices().eventBus;
}

/**
 * Get StateManager instance.
 * Convenience function for common use case.
 * @throws {Error} If services not initialized
 * @returns {import('../state/state_manager.js').StateManager}
 */
export function getStateManager() {
    return getServices().stateManager;
}

/**
 * Get LayerManager instance.
 * Convenience function for common use case.
 * @throws {Error} If services not initialized
 * @returns {import('../layers/layer.manager.js').LayerManager}
 */
export function getLayerManager() {
    return getServices().layerManager;
}

/**
 * Get GroupManager instance.
 * Convenience function for common use case.
 * @throws {Error} If services not initialized
 * @returns {import('../tool_manager/group_manager.js').GroupManager}
 */
export function getGroupManager() {
    return getServices().groupManager;
}

/**
 * Get MapResolver instance.
 * Convenience function for name/ID resolution.
 * @throws {Error} If services not initialized
 * @returns {import('./services/map-resolver.service.js').MapResolverService}
 */
export function getMapResolver() {
    return getServices().mapResolver;
}
