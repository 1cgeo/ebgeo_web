// Path: js/terrain/index.js

/**
 * @fileoverview Public API for terrain module.
 * Handles terrain control, hillshade, and analysis layers.
 */

export { default as TerrainControl } from './terrain.control.js';
export { getTerrainElevation, createTerrainSampler, resolveTerrainLookupZoom } from './terrain-elevation.js';
export { default as AnalysisLayersManager } from './analysis-layers.manager.js';
export { default as DataLayersManager } from './data-layers.manager.js';
