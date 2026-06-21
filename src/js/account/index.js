// Path: js/account/index.js

/**
 * @fileoverview Barrel for the backend-integration account UI controls.
 * Exposes the MapLibre IControls wired into the map in Phase 4 (map_sig.js):
 *  - AccountControl   — login/logout orchestrator button (top-right).
 *  - SyncStatusControl — connection-state badge.
 */

export { AccountControl } from './account.control.js';
export { SyncStatusControl } from './sync-status.control.js';
