// Path: js/briefing/index.js

/**
 * @fileoverview Public API for briefing module.
 * Only exports symbols consumed outside briefing/.
 * Internal modules (transition, text panel, validation, PDF export)
 * are imported directly by their consumers.
 */

// Keyboard service for presentation mode (used by map_sig.js)
export { initKeyboardServiceBriefing } from './services/keyboard-service-briefing.js';

// Editor control (used by map_sig.js)
export { BriefingEditorControl } from './editor/briefing-editor.control.js';

// Presenter control (used by map_sig.js)
export { BriefingPresenterControl } from './presentation/briefing-presenter.control.js';
