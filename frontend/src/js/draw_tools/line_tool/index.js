// Path: js/draw_tools/line_tool/index.js

// Main control and geometry
export { default as AddLineControl } from './add_line_control.js';
export { default as AddLineGeometry } from './add_line_geometry.js';

// Attribute panel
export { addLineAttributesToPanel } from './line_attributes_panel.js';

// Measurement utilities
export {
    createMeasurementLabel,
    displayMeasurement,
    removeMeasurement,
    setMeasurementLabelSelected,
    updateFeatureMeasurement,
    formatLength,
    calculateLineLength
} from './line_measurement.js';

// Profile utilities
export {
    calculateProfile,
    getTotalElevationGain,
    getTotalElevationLoss,
    getElevationRange,
    getAverageSlope,
    getMaxSlope
} from './line_profile.js';

// Split utilities
export {
    canSplitLine,
    splitLineAtPoint,
    activateSplitMode
} from './line-split.js';
