// Path: js/azimuth_distance_tool/index.js

/**
 * @fileoverview Public exports for Azimuth and Distance tool.
 *
 * @module azimuth_distance_tool
 */

// Control
export { AddAzimuthDistanceControl } from './add_azimuth_distance_control.js';

// Panel
export { AzimuthDistancePanel } from './azimuth_distance_panel.js';

// Attributes panel
export { addAzimuthDistanceAttributesToPanel } from './azimuth_distance_attributes_panel.js';

// Geometry functions
export {
    convertAzimuth,
    convertDistance,
    azimuthToDegrees,
    distanceToMeters,
    applyDeclination,
    normalizeAzimuth,
    calculateContraAzimuth,
    calculateWaypoints,
    calculatePreviewPoints,
    generateGeometry,
    generateFeature,
    generatePointFeatures,
    calculateTotalDistance,
    formatTotalDistance,
    validateLeg,
    canCreateFeature
} from './azimuth_distance_geometry.js';

// Constants
export {
    MILS_PER_CIRCLE,
    DEGREES_PER_CIRCLE,
    MIL_TO_DEG,
    DEG_TO_MIL,
    ANGULAR_UNIT,
    DISTANCE_UNIT,
    NORTH_REFERENCE,
    OUTPUT_MODE,
    OUTPUT_MODE_INFO,
    COMPASS_PRESETS,
    DEFAULT_PROPERTIES,
    VALIDATION,
    UI_CONFIG,
    COLORS,
    MODE_TO_SOURCE,
    MODE_TO_GEOMETRY_TYPE
} from './azimuth_distance_constants.js';

// Components
export {
    createCompassRose,
    createCompassRoseComponent,
    createGeometryPreview,
    createGeometryPreviewComponent,
    createLegRow,
    createLegsTable,
    createReferencePointComponent,
    createSectionLabel
} from './components/index.js';
