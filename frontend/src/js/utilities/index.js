// Path: js/utilities/index.js

/**
 * @fileoverview Barrel file for utilities module.
 * Exports ID utilities, coordinate converter, feature navigation, toast service, and event cleanup.
 */

// ID utilities
export { IDUtils } from './id_utils.js';

// UUID utilities
export {
    generateUUID,
    isValidUUID,
    isLegacyId,
    isValidId
} from './uuid.js';

// Coordinate converter
export {
    COORDINATE_FORMATS,
    getPlaceholderForFormat,
    parseCoordinates,
    formatCoordinates,
    getDisplayFormat,
    tryParseCoordinates
} from './coordinate_converter.js';

// Feature navigation utilities
export { zoomToFeature, zoomAndSelectFeature } from './feature_navigation_utils.js';

// Toast service
export {
    default as ToastService,
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInChannel
} from './toast_service.js';

// Event cleanup utilities
export {
    setupCleanup,
    subscribe,
    addDomListener,
    trackTimer,
    cleanup,
    removeElement
} from './event-cleanup.js';

// Blob encoding utilities
export { blobToDataUrl } from './blob-to-data-url.js';

// Image processing utilities
export {
    IMAGE_CONFIG,
    validateImageFile,
    compressImage,
    createThumbnail,
    processImageFile
} from './image_utils.js';

// Geometry utilities
export {
    pixelsToDegrees,
    degreesToPixels,
    expandBboxWithPadding,
    createPointBoundingBox,
    normalizeCoordinates,
    calculateDistance,
    calculateBearing
} from './geometry-utils.js';

// LRU cache utility
export {
    LRUCache
} from './lru-cache.js';

// Deep object utilities
export {
    deepClone,
    getByPath,
    setByPath,
    deepEqual,
    shallowClone
} from './deep-utils.js';

// HTML escape utility
export { escapeHtml } from './html-escape.js';

// Debounced persistence utility
export { DebouncedPersist } from './debounced-persist.js';

// Map image loader
export { loadImageToMap } from './map-image-loader.js';

// Serial task queue (serializes read-modify-write cycles on a GeoJSON source)
export { createSerialQueue } from './serial-queue.js';

// Quill.js helpers are NOT re-exported here to avoid pulling
// dompurify into the core chunk. Import directly from
// '@utils/quill-helpers.js' when needed.
