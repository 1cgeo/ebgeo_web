// Path: js/catalog/catalog.service.js

/**
 * @fileoverview Service for aggregating and normalizing catalog data.
 * Unifies data from different sources (tilesets, streetview, hillshade, analysis)
 * into a common structure for the catalog.
 */

import config from '@js/config.js';
import { CATALOG_ITEM_TYPES, DEFAULT_THUMBNAILS } from './catalog.constants.js';

/**
 * Parses a catalog date string into a sortable epoch (ms), tolerating the two
 * formats the sources actually emit: 3D models carry `DD/MM/YYYY`
 * (config.data_captura, e.g. "15/03/2024") and 360 projects carry ISO
 * `YYYY-MM-DD` (the service's capture_date, e.g. "2026-02-25").
 *
 * Returns null for anything it cannot parse (including missing dates), so the
 * comparator can push those to the end instead of returning NaN — a NaN from
 * one bad value corrupts the WHOLE sort, which is exactly what mixed formats
 * were doing before.
 *
 * @param {string|null|undefined} dateStr
 * @returns {number|null} Epoch milliseconds, or null when unparseable
 */
export function parseCatalogDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const s = dateStr.trim();

    let year, month, day;
    if (s.includes('/')) {
        // DD/MM/YYYY
        [day, month, year] = s.split('/').map(Number);
    } else if (s.includes('-')) {
        // ISO YYYY-MM-DD (ignore any time component after the date)
        [year, month, day] = s.slice(0, 10).split('-').map(Number);
    } else {
        return null;
    }

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return null;
    }
    const t = new Date(year, month - 1, day).getTime();
    return Number.isNaN(t) ? null : t;
}

/**
 * Formats a catalog date for display as DD/MM/YYYY, whatever format it arrived
 * in. The sources disagree (3D models are DD/MM/YYYY, 360 projects are ISO), so
 * the cards used to show two different formats side by side. Unparseable strings
 * are returned unchanged rather than hidden.
 *
 * @param {string|null|undefined} dateStr
 * @returns {string} DD/MM/YYYY, or the original string when unparseable
 */
export function formatCatalogDate(dateStr) {
    const t = parseCatalogDate(dateStr);
    if (t === null) return dateStr ?? '';
    const d = new Date(t);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Sorts catalog items by date, most recent first, with undated (or unparseable)
 * items last. Stable and NaN-free, so the order is deterministic regardless of
 * which date formats are mixed in. Sorts a copy; the input array is untouched.
 *
 * @param {CatalogItem[]} items
 * @returns {CatalogItem[]}
 */
export function sortByDateDesc(items) {
    return items
        .map((item, index) => ({ item, index, t: parseCatalogDate(item.date) }))
        .sort((a, b) => {
            if (a.t === null && b.t === null) return a.index - b.index; // keep input order
            if (a.t === null) return 1;   // undated goes last
            if (b.t === null) return -1;
            if (b.t !== a.t) return b.t - a.t; // most recent first
            return a.index - b.index;     // tie: stable by original order
        })
        .map(entry => entry.item);
}

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
 * @property {string[]} [keywords] - Optional searchable keywords
 * @property {Object} originalData - Original config data
 */

/**
 * Catalog service for data aggregation.
 */
export class CatalogService {
    /**
     * Returns all catalog items normalized and sorted by date (descending).
     * Items without dates are placed at the end.
     * @returns {Promise<CatalogItem[]>}
     */
    static async getAllItems() {
        const panoramic360 = await this._getPanoramic360();

        const items = [
            ...this._getModels3D(),
            ...panoramic360,
            ...this._getHillshade(),
            ...this._getAnalysisLayers(),
            ...this._getDataLayers()
        ];

        // Sort by date descending (most recent first), undated items last.
        // Robust to the mixed DD/MM/YYYY (models) and ISO (360) formats.
        return sortByDateDesc(items);
    }

    /**
     * Returns items filtered by types.
     * @param {string[]} types - Array of types to filter
     * @returns {Promise<CatalogItem[]>}
     */
    static async getItemsByTypes(types) {
        const items = await this.getAllItems();
        return items.filter(item => types.includes(item.type));
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

            if (name.includes(normalizedQuery) ||
                description.includes(normalizedQuery) ||
                local.includes(normalizedQuery)) {
                return true;
            }

            // Search through optional keywords array
            if (item.keywords?.length) {
                return item.keywords.some(kw =>
                    this._normalizeText(kw).includes(normalizedQuery)
                );
            }

            return false;
        });
    }

    /**
     * Checks if there are any catalog items available.
     * @returns {Promise<boolean>}
     */
    static async hasItems() {
        const items = await this.getAllItems();
        return items.length > 0;
    }

    /**
     * Gets counts by type.
     * @returns {Promise<Object<string, number>>}
     */
    static async getCountsByType() {
        const items = await this.getAllItems();
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
            keywords: tileset.keywords || null,
            thumbnail: tileset.previewThumbnail || DEFAULT_THUMBNAILS[CATALOG_ITEM_TYPES.MODEL_3D],
            date: tileset.data_captura || null,
            local: tileset.local || null,
            location: tileset.locate,
            originalData: tileset
        }));
    }

    /**
     * Gets panoramic 360 projects from the cached data.
     * Never makes a network request — uses only the cache populated by preflight.
     * @private
     * @returns {Promise<CatalogItem[]>}
     */
    static async _getPanoramic360() {
        // If streetview feature is disabled (preflight failed), skip entirely
        if (!config.features.imagens_panoramicas) return [];

        try {
            const { getCachedProjects } = await import('../street_view_tool/streetview-api.service.js');

            const projects = getCachedProjects();
            if (!projects || projects.length === 0) return [];

            const serviceUrl = config.streetView360.serviceUrl;

            return projects.map(p => ({
                id: `360-${p.id}`,
                type: CATALOG_ITEM_TYPES.PANORAMIC_360,
                name: p.name,
                description: p.description || null,
                keywords: p.keywords || null,
                thumbnail: p.previewThumbnail
                    ? `${serviceUrl}${p.previewThumbnail}`
                    : DEFAULT_THUMBNAILS[CATALOG_ITEM_TYPES.PANORAMIC_360],
                date: p.captureDate || null,
                local: p.location || null,
                location: p.center ? { lon: p.center.lon, lat: p.center.lat } : null,
                originalData: p
            }));
        } catch {
            return [];
        }
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

    /**
     * Gets data layers (molduras, etc.) from config.
     * @private
     * @returns {CatalogItem[]}
     */
    static _getDataLayers() {
        const dataConfig = config.dataLayers;
        if (!dataConfig?.enabled || !dataConfig.layers?.length) return [];

        return dataConfig.layers.map(layer => ({
            id: `data-${layer.id}`,
            type: CATALOG_ITEM_TYPES.DATA_LAYER,
            name: layer.name,
            description: layer.description || null,
            thumbnail: layer.thumbnail || DEFAULT_THUMBNAILS[CATALOG_ITEM_TYPES.DATA_LAYER],
            date: null,
            local: null,
            location: null,
            originalData: layer
        }));
    }
}
