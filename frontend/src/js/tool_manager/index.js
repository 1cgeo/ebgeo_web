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

// Group manager exports (factory, holder, class)
export {
    GroupManager,
    createGroupManager,
    groupManagerHolder
} from './group_manager.js';

// Hatch utilities
export { HatchPatternGenerator, getHatchPatternGenerator } from './hatch_pattern_generator.js';

// Tabbed attribute panel
export { injectTabbedPanelStyles } from './tabbed_attribute_panel.js';

// Re-export helpers
export * from './helpers/index.js';
