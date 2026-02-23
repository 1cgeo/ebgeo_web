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

// Editor control
export { BriefingEditorControl } from './editor/briefing-editor.control.js';

// Presenter control
export { BriefingPresenterControl } from './presentation/briefing-presenter.control.js';

// Transition service
export { createTransitionService } from './presentation/transition.service.js';

// Presentation components
export { createPresentationTextPanel } from './components/presentation-text-panel.js';
export { createPresentationControls } from './components/presentation-controls.js';

// Validation
export {
    validateBriefing,
    createReferenceValidator,
    ValidationErrorType,
    ErrorSeverity,
    ValidationError,
    ValidationResult
} from './validation/reference-validator.js';

// PDF export
export { exportBriefingToPdf } from './export/briefing-pdf-export.js';
