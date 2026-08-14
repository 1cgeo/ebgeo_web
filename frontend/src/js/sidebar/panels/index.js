// Path: js/sidebar/panels/index.js

/**
 * @fileoverview Public API for sidebar panels.
 * Re-exports all panel modules.
 *
 * @module sidebar/panels
 */

// Notes panel
export {
    createNotesPanelContent,
    cleanQuillContent
} from './notes-panel.js';

// Vector info panel
export {
    createVectorInfoPanelContent
} from './vector-info-panel.js';

// Feature panel content
export {
    createFeaturePanelContent
} from './feature-panel-content.js';
