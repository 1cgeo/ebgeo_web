// Path: js/attribute_table/services/table-config.service.js

/**
 * @fileoverview Service for persisting attribute table configuration to localStorage.
 */

import { ATTRIBUTE_TABLE } from '../attribute-table.constants.js';

/**
 * @typedef {Object} LayerTableConfig
 * @property {number} height - Panel height in pixels
 * @property {Object<string, number>} columnWidths - Column widths by key
 * @property {string[]} hiddenColumns - Array of hidden column keys
 * @property {string|null} sortColumn - Current sort column key
 * @property {'asc'|'desc'|null} sortDirection - Current sort direction
 */

/**
 * @typedef {Object} MapTableConfig
 * @property {Object<string, LayerTableConfig>} layers - Config per layer ID
 */

/**
 * Service class for managing attribute table configuration persistence.
 */
export class TableConfigService {
    /**
     * Gets the localStorage key for a map.
     * @param {string} mapName - Map name
     * @returns {string} Storage key
     * @private
     */
    _getStorageKey(mapName) {
        return `${ATTRIBUTE_TABLE.STORAGE_KEY_PREFIX}${mapName}`;
    }

    /**
     * Gets all configurations for a map.
     * @param {string} mapName - Map name
     * @returns {MapTableConfig} Map configuration object
     * @private
     */
    _getMapConfig(mapName) {
        try {
            const key = this._getStorageKey(mapName);
            const stored = localStorage.getItem(key);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.warn('Error reading table config from localStorage:', error);
        }
        return { layers: {} };
    }

    /**
     * Saves all configurations for a map.
     * @param {string} mapName - Map name
     * @param {MapTableConfig} config - Map configuration object
     * @private
     */
    _setMapConfig(mapName, config) {
        try {
            const key = this._getStorageKey(mapName);
            localStorage.setItem(key, JSON.stringify(config));
        } catch (error) {
            console.warn('Error saving table config to localStorage:', error);
        }
    }

    /**
     * Gets the default configuration for a layer.
     * @returns {LayerTableConfig} Default configuration
     */
    getDefaultConfig() {
        return {
            height: Math.round(window.innerHeight * (ATTRIBUTE_TABLE.DEFAULT_HEIGHT_PERCENT / 100)),
            columnWidths: {},
            hiddenColumns: [],
            sortColumn: null,
            sortDirection: null,
        };
    }

    /**
     * Gets configuration for a specific layer.
     * @param {string} mapName - Map name
     * @param {string} layerId - Layer ID
     * @returns {LayerTableConfig} Layer configuration
     */
    getConfig(mapName, layerId) {
        const mapConfig = this._getMapConfig(mapName);
        const layerConfig = mapConfig.layers[layerId];

        if (layerConfig) {
            // Merge with defaults to ensure all properties exist
            return {
                ...this.getDefaultConfig(),
                ...layerConfig,
            };
        }

        return this.getDefaultConfig();
    }

    /**
     * Saves configuration for a specific layer.
     * @param {string} mapName - Map name
     * @param {string} layerId - Layer ID
     * @param {Partial<LayerTableConfig>} config - Configuration to save (partial)
     */
    saveConfig(mapName, layerId, config) {
        const mapConfig = this._getMapConfig(mapName);

        // Merge with existing config
        mapConfig.layers[layerId] = {
            ...(mapConfig.layers[layerId] || this.getDefaultConfig()),
            ...config,
        };

        this._setMapConfig(mapName, mapConfig);
    }

    /**
     * Updates a single configuration property for a layer.
     * @param {string} mapName - Map name
     * @param {string} layerId - Layer ID
     * @param {keyof LayerTableConfig} property - Property name
     * @param {*} value - Property value
     */
    updateConfig(mapName, layerId, property, value) {
        const config = this.getConfig(mapName, layerId);
        config[property] = value;
        this.saveConfig(mapName, layerId, config);
    }

    /**
     * Updates panel height configuration.
     * @param {string} mapName - Map name
     * @param {string} layerId - Layer ID
     * @param {number} height - Height in pixels
     */
    saveHeight(mapName, layerId, height) {
        this.updateConfig(mapName, layerId, 'height', height);
    }

    /**
     * Updates column width configuration.
     * @param {string} mapName - Map name
     * @param {string} layerId - Layer ID
     * @param {string} columnKey - Column key
     * @param {number} width - Width in pixels
     */
    saveColumnWidth(mapName, layerId, columnKey, width) {
        const config = this.getConfig(mapName, layerId);
        config.columnWidths[columnKey] = width;
        this.saveConfig(mapName, layerId, { columnWidths: config.columnWidths });
    }

    /**
     * Updates sort configuration.
     * @param {string} mapName - Map name
     * @param {string} layerId - Layer ID
     * @param {string|null} column - Sort column key
     * @param {'asc'|'desc'|null} direction - Sort direction
     */
    saveSortConfig(mapName, layerId, column, direction) {
        this.saveConfig(mapName, layerId, {
            sortColumn: column,
            sortDirection: direction,
        });
    }

    /**
     * Removes configuration for a specific layer.
     * @param {string} mapName - Map name
     * @param {string} layerId - Layer ID
     */
    removeConfig(mapName, layerId) {
        const mapConfig = this._getMapConfig(mapName);
        delete mapConfig.layers[layerId];
        this._setMapConfig(mapName, mapConfig);
    }

    /**
     * Removes all configurations for a map.
     * @param {string} mapName - Map name
     */
    removeAllConfigsForMap(mapName) {
        try {
            const key = this._getStorageKey(mapName);
            localStorage.removeItem(key);
        } catch (error) {
            console.warn('Error removing table configs from localStorage:', error);
        }
    }

    /**
     * Cleans up configurations for layers that no longer exist.
     * @param {string} mapName - Map name
     * @param {string[]} existingLayerIds - Array of layer IDs that still exist
     */
    cleanupOrphanedConfigs(mapName, existingLayerIds) {
        const mapConfig = this._getMapConfig(mapName);
        const existingSet = new Set(existingLayerIds);

        let modified = false;
        for (const layerId of Object.keys(mapConfig.layers)) {
            if (!existingSet.has(layerId)) {
                delete mapConfig.layers[layerId];
                modified = true;
            }
        }

        if (modified) {
            this._setMapConfig(mapName, mapConfig);
        }
    }
}

// Export singleton instance
export const tableConfigService = new TableConfigService();
