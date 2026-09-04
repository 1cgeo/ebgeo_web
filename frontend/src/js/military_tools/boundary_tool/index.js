// Path: js/military_tools/boundary_tool/index.js
export { default as AddBoundaryControl } from './add_boundary_control.js';
export { default as AddBoundaryGeometry } from './add_boundary_geometry.js';
export { addBoundaryAttributesToPanel } from './boundary_attributes_panel.js';

// Split (cut in two). Only the ORCHESTRATION is re-exported: the pure model lives in
// `tool_manager/helpers/boundary-split.model.js` and is imported from there, exactly as
// `boundary-zoom.model.js` already is, because re-exporting it here would offer a path
// into a core leaf through a barrel that drags the whole tool.
export { splitBoundaryAtPoint, activateBoundarySplitMode } from './boundary-split.js';
