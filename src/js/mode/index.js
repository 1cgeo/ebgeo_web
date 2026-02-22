// Path: js/mode/index.js

/**
 * @fileoverview Public API for the mode module.
 * Provides application and viewer mode management.
 */

export {
    ApplicationMode,
    ViewerMode,
    ApplicationModeEvents,
    getApplicationModeManager,
    createApplicationModeManager,
    default as ApplicationModeManager
} from './application-mode.manager.js';
