// Path: js/temporal/index.js

/**
 * @fileoverview Public barrel for the Temporal Module.
 */

export * from './temporal.constants.js';
export * from './temporal-model.js';
export * from './temporal.utils.js';
export { applyTemporalState, updateTrajectoryPositions } from './temporal-render.service.js';
export { createTemporalController, TemporalController } from './temporal-controller.js';
export {
    createTemporalAttributesSection,
    createTemporalValiditySection,
    createTrajectorySection,
} from './temporal-attributes-section.js';
export { createTrajectoryEditControl } from './trajectory-tool/trajectory-edit-control.js';
export {
    extractTemporalProperties,
    extractGpxTimes,
    buildTrajectoryFromGpxFeature,
} from './temporal-import.js';
