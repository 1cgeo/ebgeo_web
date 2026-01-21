// Path: js/tool_manager/helpers/index.js

/**
 * @fileoverview Public API for attribute panel helpers.
 * Re-exports all helper modules.
 */

// Common configuration
export {
    DEFAULT_SLIDER_CONFIG,
    COMPACT_STYLES,
    COMMON_CONFIGS,
    getCommonConfig
} from './common-config.helpers.js';

// Slider components (modern + legacy)
export {
    createModernSlider,
    createModernNumericInput,
    createNumericInput,
    createSliderWithInput
} from './slider.helpers.js';

// Color picker (modern + legacy)
export {
    createModernColorPicker,
    createColorPicker
} from './color-picker.helpers.js';

// Form controls (modern + legacy)
export {
    createModernToggle,
    createModernSelect,
    createModernTextarea,
    createModernTabs,
    createModernInfoBox,
    createCheckbox,
    createAttributeRow,
    createLineStyleSelect
} from './form-controls.helpers.js';

// Section divider
export {
    createSectionDivider
} from './section-divider.helpers.js';

// Line style selector
export {
    createModernLineStyleSelect,
    getLineDashArray,
    getLineStyles
} from './line-style.helpers.js';

// Hatch control
export {
    createModernHatchControl,
    getHatchPatterns
} from './hatch-control.helpers.js';

// Text alignment
export {
    createModernTextAlignment,
    getAlignments
} from './text-alignment.helpers.js';

// Coordinate editor
export {
    createCoordinateEditor
} from './coordinate-editor.helpers.js';

// Feature header
export {
    createEditableFeatureName,
    createFeatureHeaderWithOptions,
    createFeatureOptionsButton,
    cleanupFeatureDropdownListeners
} from './feature-header.helpers.js';

// Buttons (modern + legacy)
export {
    createModernButtons,
    createStandardButtons
} from './buttons.helpers.js';
