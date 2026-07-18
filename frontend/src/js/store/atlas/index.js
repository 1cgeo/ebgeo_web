// Path: js/store/atlas/index.js

/**
 * @fileoverview Barrel file for Atlas module.
 * Exports Atlas entity and related utilities.
 */

export {
    ATLAS_SCHEMA_VERSION,
    createAtlas,
    isValidAtlas,
    addMapToAtlas,
    removeMapFromAtlas,
    reorderAtlasMaps,
    setAtlasActiveMap,
    renameAtlas
} from './atlas.entity.js';
