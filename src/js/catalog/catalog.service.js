// Path: js/catalog/catalog.service.js

/**
 * @fileoverview Service for aggregating and normalizing catalog data.
 * Unifies data from different sources (tilesets, streetview, hillshade, analysis)
 * into a common structure for the catalog.
 */

import config from '../config.js';
import { CATALOG_ITEM_TYPES, DEFAULT_THUMBNAILS } from './catalog.constants.js';

/**
 * @typedef {Object} CatalogItem
 * @property {string} id - Unique identifier
 * @property {string} type - Item type (CATALOG_ITEM_TYPES)
 * @property {string} name - Display name
 * @property {string} [description] - Optional description
 * @property {string} thumbnail - Thumbnail URL
 * @property {string} [date] - Capture date (DD/MM/YYYY)
 * @property {string} [local] - Location (city, state) e.g. "Porto Alegre, RS"
 * @property {Object} [location] - Coordinates for zoom
 * @property {Object} originalData - Original config data
 */

/**
 * Catalog service for data aggregation.
 */
export class CatalogService {
    /**
     * Returns all catalog items normalized and sorted by date (descending).
     * Items without dates are placed at the end.
     * @returns {CatalogItem[]}
     */
    static getAllItems() {
        const items = [
            ...this._getModels3D(),
            ...this._getPanoramic360(),
            ...this._getHillshade(),
            ...this._getAnalysisLayers()
        ];

        // Sort by date descending (most recent first)
        // Items without dates go to the end
        return items.sort((a, b) => {
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;

            // Parse DD/MM/YYYY format
            const parseDate = (dateStr) => {
                const [day, month, year] = dateStr.split('/').map(Number);
                return new Date(year, month - 1, day);
            };

            const dateA = parseDate(a.date);
            const dateB = parseDate(b.date);

            return dateB - dateA; // Descending order
        });
    }

    /**
     * Returns items filtered by types.
     * @param {string[]} types - Array of types to filter
     * @returns {CatalogItem[]}
     */
    static getItemsByTypes(types) {
        return this.getAllItems().filter(item => types.includes(item.type));
    }

    /**
     * Searches items by name, description, and location.
     * @param {string} query - Search term
     * @param {CatalogItem[]} items - Items to filter
     * @returns {CatalogItem[]}
     */
    static searchItems(query, items) {
        if (!query || query.trim() === '') return items;

        const normalizedQuery = this._normalizeText(query);

        return items.filter(item => {
            const name = this._normalizeText(item.name || '');
            const description = this._normalizeText(item.description || '');
            const local = this._normalizeText(item.local || '');

            return name.includes(normalizedQuery) ||
                   description.includes(normalizedQuery) ||
                   local.includes(normalizedQuery);
        });
    }

    /**
     * Checks if there are any catalog items available.
     * @returns {boolean}
     */
    static hasItems() {
        return this.getAllItems().length > 0;
    }

    /**
     * Gets counts by type.
     * @returns {Object<string, number>}
     */
    static getCountsByType() {
        const items = this.getAllItems();
        const counts = {};

        Object.values(CATALOG_ITEM_TYPES).forEach(type => {
            counts[type] = items.filter(item => item.type === type).length;
        });

        return counts;
    }

    // === Private Methods ===

    /**
     * Normalizes text for search (lowercase, removes accents).
     * @private
     * @param {string} text - Text to normalize
     * @returns {string}
     */
    static _normalizeText(text) {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    /**
     * Gets 3D models from config.
     * @private
     * @returns {CatalogItem[]}
     */
    static _getModels3D() {
        if (!config.hasTilesets()) return [];

        return config.tilesets.map(tileset => ({
            id: `3d-${tileset.id}`,
            type: CATALOG_ITEM_TYPES.MODEL_3D,
            name: tileset.name,
            description: tileset.description || null,
            thumbnail: tileset.previewThumbnail || DEFAULT_THUMBNAILS[CATALOG_ITEM_TYPES.MODEL_3D],
            date: tileset.data_captura || null,
            local: tileset.local || null,
            location: tileset.locate,
            originalData: tileset
        }));
    }

    /**
     * Gets panoramic 360 images from config.
     * @private
     * @returns {CatalogItem[]}
     */
    static _getPanoramic360() {
        if (!config.hasStreetViewMarkers()) return [];

        return config.streetViewMarkers.map(marker => ({
            id: `360-${marker.id}`,
            type: CATALOG_ITEM_TYPES.PANORAMIC_360,
            name: marker.name,
            description: marker.description || null,
            thumbnail: marker.previewThumbnail || DEFAULT_THUMBNAILS[CATALOG_ITEM_TYPES.PANORAMIC_360],
            date: marker.data_captura || null,
            local: marker.local || null,
            location: marker.locate,
            originalData: marker
        }));
    }

    /**
     * Gets hillshade from config.
     * @private
     * @returns {CatalogItem[]}
     */
    static _getHillshade() {
        const hillshade = config.map2d?.hillshade;
        if (!hillshade?.enabled) return [];

        return [{
            id: 'hillshade',
            type: CATALOG_ITEM_TYPES.HILLSHADE,
            name: hillshade.name || 'Sombreamento',
            description: hillshade.description || 'Relevo sombreado do terreno',
            thumbnail: hillshade.thumbnail || DEFAULT_THUMBNAILS[CATALOG_ITEM_TYPES.HILLSHADE],
            date: null,
            location: null,
            originalData: hillshade
        }];
    }

    /**
     * Gets analysis layers from config.
     * @private
     * @returns {CatalogItem[]}
     */
    static _getAnalysisLayers() {
        const analysisConfig = config.analysisLayers;
        if (!analysisConfig?.enabled || !analysisConfig.layers?.length) return [];

        return analysisConfig.layers.map(layer => ({
            id: `analysis-${layer.id}`,
            type: CATALOG_ITEM_TYPES.ANALYSIS_LAYER,
            name: layer.name,
            description: layer.description || null,
            thumbnail: layer.thumbnail || DEFAULT_THUMBNAILS[CATALOG_ITEM_TYPES.ANALYSIS_LAYER],
            date: null,
            local: layer.local || null,
            location: layer.bounds ? { bounds: layer.bounds } : null,
            originalData: layer
        }));
    }
}
