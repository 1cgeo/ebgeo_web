// Path: js/utilities/index.js

/**
 * @fileoverview Barrel file for utilities module.
 * Exports ID utilities, coordinate converter, feature navigation, toast service, and event cleanup.
 */

// ID utilities
export { IDUtils } from './id_utils.js';

// Coordinate converter
export {
    COORDINATE_FORMATS,
    getPlaceholderForFormat,
    parseCoordinates,
    formatCoordinates,
    getDisplayFormat
} from './coordinate_converter.js';

// Feature navigation utilities
export { FeatureNavigationUtils } from './feature_navigation_utils.js';

// Toast service
export {
    default as ToastService,
    showToast,
    showSuccess,
    showError,
    showWarning
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

// Image processing utilities
export {
    IMAGE_CONFIG,
    validateImageFile,
    compressImage,
    createThumbnail,
    processImageFile
} from './image_utils.js';
