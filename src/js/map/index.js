// Path: js/map/index.js

/**
 * @fileoverview Public API for map module.
 * Provides map control panel, manager, drag rotate handler, and animation services.
 * Note: Map notes functionality is now handled by SidebarControl.
 */

export { default as MapControl } from './map.control.js';
export { default as MapManager } from './map.manager.js';
export { default as DragRotateHandler } from './drag-rotate.handler.js';

// Animation service
export {
    ANIMATION_DURATION,
    capturePosition,
    capturePositionExtended,
    flyTo,
    restorePosition,
    easeTo,
    zoomTo,
    zoomIn,
    zoomOut,
    fitBounds,
    rotateTo,
    resetNorth
} from './animation.service.js';
