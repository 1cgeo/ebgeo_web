// Path: js/briefing/index.js

/**
 * @fileoverview Public API for briefing module.
 * Provides briefing/story map presentation functionality.
 */

// Keyboard service for presentation mode
export {
    initKeyboardServiceBriefing,
    setKeyboardCallbacksBriefing,
    activateKeyboardServiceBriefing,
    deactivateKeyboardServiceBriefing,
    isKeyboardServiceBriefingActive
} from './services/keyboard-service-briefing.js';
