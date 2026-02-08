// Path: js/attribute_table/services/table-data.service.js

/**
 * @fileoverview Service for fetching, filtering, and sorting attribute table data.
 */

import { getLayerFeatures } from '../../store/feature.operations.js';
import { EMPTY_CELL_PLACEHOLDER } from '../attribute-table.constants.js';

/**
 * @typedef {Object} FilterOptions
 * @property {string} [search] - Search query string
 * @property {Set<string>} [types] - Feature types to include (empty = all)
 * @property {boolean} [selectedOnly] - Show only selected features
 * @property {Set<string>} [selectedIds] - IDs of selected features
 */

/**
 * @typedef {Object} SortOptions
 * @property {string|null} column - Column key to sort by
 * @property {'asc'|'desc'|null} direction - Sort direction
 */

/**
 * Service class for managing attribute table data operations.
 */
export class TableDataService {
    /**
     * Gets all features for a specific layer.
     * @param {string} layerId - Layer ID
     * @returns {Promise<Array>} Array of GeoJSON features
     */
    async getLayerFeatures(layerId) {
        try {
            const features = await getLayerFeatures(layerId);
            return features || [];
        } catch (error) {
            console.error('Error fetching layer features:', error);
            return [];
        }
    }

    /**
     * Extracts unique attribute column keys from features.
     * @param {Array} features - Array of GeoJSON features
     * @returns {string[]} Sorted array of unique attribute keys
     */
    getAttributeColumns(features) {
        const keys = new Set();

        for (const feature of features) {
            const attrs = feature.properties?.attributes;
            if (attrs && typeof attrs === 'object') {
                Object.keys(attrs).forEach((key) => keys.add(key));
            }
        }

        return Array.from(keys).sort((a, b) =>
            a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
        );
    }

    /**
     * Gets unique feature types present in the features array.
     * @param {Array} features - Array of GeoJSON features
     * @returns {string[]} Array of unique source types
     */
    getFeatureTypes(features) {
        const types = new Set();

        for (const feature of features) {
            const sourceType = feature.properties?.source;
            if (sourceType) {
                types.add(sourceType);
            }
        }

        return Array.from(types).sort((a, b) =>
            a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
        );
    }

    /**
     * Filters features based on filter options.
     * @param {Array} features - Array of GeoJSON features
     * @param {FilterOptions} options - Filter options
     * @returns {Array} Filtered array of features
     */
    filterFeatures(features, options = {}) {
        const { search = '', types = new Set(), selectedOnly = false, selectedIds = new Set() } = options;

        let filtered = features;

        // Filter by selected only
        if (selectedOnly && selectedIds.size > 0) {
            filtered = filtered.filter((f) => selectedIds.has(f.properties?.id));
        } else if (selectedOnly && selectedIds.size === 0) {
            return [];
        }

        // Filter by feature type
        if (types.size > 0) {
            filtered = filtered.filter((f) => types.has(f.properties?.source));
        }

        // Filter by search query
        if (search.trim()) {
            const query = search.toLowerCase().trim();
            filtered = filtered.filter((f) => {
                // Search in name
                const name = f.properties?.nome || '';
                if (name.toLowerCase().includes(query)) {
                    return true;
                }

                // Search in description
                const desc = f.properties?.descricao || '';
                if (desc.toLowerCase().includes(query)) {
                    return true;
                }

                // Search in all attribute values
                const attrs = f.properties?.attributes || {};
                for (const value of Object.values(attrs)) {
                    if (value != null && String(value).toLowerCase().includes(query)) {
                        return true;
                    }
                }

                return false;
            });
        }

        return filtered;
    }

    /**
     * Sorts features based on sort options.
     * @param {Array} features - Array of GeoJSON features
     * @param {SortOptions} options - Sort options
     * @returns {Array} Sorted array of features (new array)
     */
    sortFeatures(features, options = {}) {
        const { column, direction } = options;

        if (!column || !direction) {
            return [...features];
        }

        const sorted = [...features];

        sorted.sort((a, b) => {
            let valueA, valueB;

            if (column === 'nome') {
                valueA = a.properties?.nome || '';
                valueB = b.properties?.nome || '';
            } else if (column === 'descricao') {
                valueA = a.properties?.descricao || '';
                valueB = b.properties?.descricao || '';
            } else if (column === 'type') {
                valueA = a.properties?.source || '';
                valueB = b.properties?.source || '';
            } else {
                // Custom attribute column
                valueA = a.properties?.attributes?.[column];
                valueB = b.properties?.attributes?.[column];
            }

            // Handle null/undefined (push to end)
            const aIsEmpty = valueA == null || valueA === '';
            const bIsEmpty = valueB == null || valueB === '';

            if (aIsEmpty && bIsEmpty) return 0;
            if (aIsEmpty) return 1;
            if (bIsEmpty) return -1;

            // Compare values
            const comparison = String(valueA).localeCompare(String(valueB), 'pt-BR', {
                sensitivity: 'base',
                numeric: true,
            });

            return direction === 'asc' ? comparison : -comparison;
        });

        return sorted;
    }

    /**
     * Gets the display value for a cell.
     * @param {Object} feature - GeoJSON feature
     * @param {string} columnKey - Column key ('nome', 'type', or attribute key)
     * @returns {string} Display value
     */
    getCellValue(feature, columnKey) {
        if (columnKey === 'nome') {
            return feature.properties?.nome || EMPTY_CELL_PLACEHOLDER;
        }

        if (columnKey === 'descricao') {
            return feature.properties?.descricao || EMPTY_CELL_PLACEHOLDER;
        }

        if (columnKey === 'type') {
            return feature.properties?.source || EMPTY_CELL_PLACEHOLDER;
        }

        // Custom attribute
        const value = feature.properties?.attributes?.[columnKey];
        if (value == null || value === '') {
            return EMPTY_CELL_PLACEHOLDER;
        }

        return String(value);
    }

    /**
     * Checks if a cell value is empty (placeholder).
     * @param {string} value - Cell value
     * @returns {boolean} True if empty
     */
    isEmptyValue(value) {
        return value === EMPTY_CELL_PLACEHOLDER || value == null || value === '';
    }
}

// Export singleton instance
export const tableDataService = new TableDataService();
