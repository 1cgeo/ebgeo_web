// Path: js/tool_manager/managers/index.js

/**
 * @fileoverview Barrel exports for tool manager specialized managers.
 * @module tool_manager/managers
 */

export { SelectionHighlightManager } from './selection-highlight.manager.js';

// ProfilePanelManager is deliberately NOT re-exported here. It imports Chart.js
// (~195 kB minified) at module level, and this barrel is reached statically from
// ui_manager.js, i.e. from the eager payload of index.html. Re-exporting it puts
// Chart.js in every map session, including the majority that never open a terrain
// profile. Load it with `await import('./managers/profile-panel.manager.js')`
// at the point of use — see ui_manager.js `_ensureProfilePanel()`.
