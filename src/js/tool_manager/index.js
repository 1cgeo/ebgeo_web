// Path: js/tool_manager/index.js

/**
 * @fileoverview Barrel file for tool_manager module.
 * Exports all managers, base classes, and utilities.
 */

// Base classes
export { default as BaseControl } from './base_control.js';
export { default as BaseGeometry } from './base_geometry.js';

// Managers
export { default as ToolManager } from './tool_manager.js';
export { default as SelectionManager } from './selection_manager.js';
export { default as UIManager } from './ui_manager.js';
export { default as ClipboardManager } from './clipboard_manager.js';
export { default as MoveHandler } from './move_handler.js';

// Group manager exports (includes factory, holder, class and default proxy)
export {
    default as groupManager,
    GroupManager,
    createGroupManager,
    groupManagerHolder
} from './group_manager.js';

// Hatch utilities
export { HatchPatternGenerator } from './hatch_pattern_generator.js';
export { openHatchConfigModal } from './hatch_config_modal.js';

// Tabbed attribute panel
export { createTabbedAttributePanel, injectTabbedPanelStyles, TAB_IDS } from './tabbed_attribute_panel.js';

// Re-export helpers
export * from './helpers/index.js';
