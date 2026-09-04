// Path: js/terrain/index.js

/**
 * @fileoverview Public API for terrain module.
 * Handles terrain control, hillshade, and analysis layers.
 */

export { default as TerrainControl, setProjectionKeepingHillshade } from './terrain.control.js';
// DO MÓDULO FOLHA, e não do controle: as leituras de elevação são puras de store e de DOM,
// e é isso que deixa a geometria de análise ser testada contra um mapa falso em node.
export { getTerrainElevation, createTerrainSampler, resolveTerrainLookupZoom } from './terrain-elevation.js';
export { default as AnalysisLayersManager } from './analysis-layers.manager.js';
export { default as DataLayersManager } from './data-layers.manager.js';
export { getLayerFailureNotice } from './layer-failure-notice.js';
