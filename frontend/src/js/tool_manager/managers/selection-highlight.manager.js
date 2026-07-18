// Path: js/tool_manager/managers/selection-highlight.manager.js

/**
 * @fileoverview Gerenciador de destaque visual de seleção.
 * Renderiza selection boxes ao redor de features selecionadas.
 * Extraído de ui_manager.js para separação de responsabilidades.
 *
 * @module tool_manager/managers/selection-highlight.manager
 */

import { getStateManager } from '@store';
import { pixelsToDegrees } from '@utils/geometry-utils.js';
import { deepClone } from '@utils/deep-utils.js';

// ============================================================================
// SELECTION HIGHLIGHT MANAGER
// ============================================================================

export class SelectionHighlightManager {
    /**
     * @param {maplibregl.Map} map - MapLibre map instance
     * @param {Object} selectionManager - Selection manager instance
     */
    constructor(map, selectionManager) {
        this.map = map;
        this.selectionManager = selectionManager;

        /** @type {Array<Object>} Current selection box features */
        this.selectionBoxes = [];

        /** @type {Map<string, Object>} Cache for selection box calculations */
        this.selectionBoxCache = new Map();

        /** @type {Map<string, string>} Geometry hashes for cache invalidation */
        this.geometryHashes = new Map();

        /** @type {number|null} RAF ID for debounced zoom handling */
        this.rafId = null;

        this._setupEventHandlers();
    }

    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================

    /**
     * Setup map event handlers.
     * @private
     */
    _setupEventHandlers() {
        this.map.on('zoom', this._handleZoomChange);
    }

    /**
     * Handle map zoom changes with debouncing.
     * Recalculates selection boxes on zoom since pixel sizes change.
     * @private
     */
    _handleZoomChange = () => {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        this.rafId = requestAnimationFrame(() => {
            if (this.selectionManager.hasSelectedFeatures()) {
                this.updateSelectionHighlight();
            }
            this.rafId = null;
        });
    }

    // ========================================================================
    // CACHE MANAGEMENT
    // ========================================================================

    /**
     * Get cache key for feature at current zoom level.
     * Zoom level is quantized to 0.5 increments for cache efficiency.
     * @param {string} featureId
     * @returns {string}
     */
    getCacheKey(featureId) {
        const zoom = this.map.getZoom();
        const zoomLevel = Math.round(zoom * 2) / 2;
        return `${featureId}-${zoomLevel}`;
    }

    /**
     * Calculate geometry hash for cache invalidation.
     * Hash includes coordinates and relevant properties that affect selection box.
     * @param {Object} feature - GeoJSON feature
     * @returns {string}
     */
    calculateGeometryHash(feature) {
        const coords = JSON.stringify(feature.geometry.coordinates);
        const props = JSON.stringify({
            center: feature.properties.center,
            radius: feature.properties.radius,
            majorRadius: feature.properties.majorRadius,
            minorRadius: feature.properties.minorRadius,
            bearing: feature.properties.bearing,
            text: feature.properties.text,
            size: feature.properties.size,
            rotation: feature.properties.rotation,
            width: feature.properties.width,
            height: feature.properties.height,
            anchor: feature.properties.anchor,
            selectionBox: feature.properties.selectionBox
                ? JSON.stringify(feature.properties.selectionBox)
                : null
        });

        // Simple hash function for cache invalidation
        let hash = 0;
        const str = coords + props;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    /**
     * Invalidate cache for specific feature.
     * @param {string} featureId
     */
    invalidateCache(featureId) {
        if (featureId) {
            const keysToDelete = [];
            for (const key of this.selectionBoxCache.keys()) {
                if (key.startsWith(`${featureId}-`)) {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(key => this.selectionBoxCache.delete(key));
            this.geometryHashes.delete(featureId);
        }
    }

    /**
     * Invalidate entire selection box cache.
     */
    invalidateAllCache() {
        this.selectionBoxCache.clear();
        this.geometryHashes.clear();
    }

    /**
     * Notify geometry change for cache invalidation.
     * Called by controls when feature geometry is modified.
     * @param {string} featureId
     */
    notifyGeometryChange(featureId) {
        this.invalidateCache(featureId);
    }

    // ========================================================================
    // SELECTION HIGHLIGHTING
    // ========================================================================

    /**
     * Update selection highlight using tool-centric approach.
     * Each tool is responsible for creating its own selection boxes.
     */
    updateSelectionHighlight = () => {
        // Skip during drag to avoid visual lag
        if (this._isDragging()) return;

        const selectionBoxesSource = this.map.getSource('selection-boxes');
        if (!selectionBoxesSource) return;

        const featuresByType = this._groupSelectedFeaturesByType();
        const allSelectionBoxes = [];

        for (const [type, features] of featuresByType.entries()) {
            const selectionBoxes = this._createSelectionBoxesForType(type, features);
            allSelectionBoxes.push(...selectionBoxes);
        }

        this.selectionBoxes = allSelectionBoxes;
        selectionBoxesSource.setData({
            type: 'FeatureCollection',
            features: allSelectionBoxes
        });
    }

    /**
     * Check if currently dragging via StateManager.
     * @private
     * @returns {boolean}
     */
    _isDragging() {
        try {
            return getStateManager().getUnsafe('ui.isDragging') || false;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Group selected features by type for efficient processing.
     * Uses StateManager as source of truth.
     * @private
     * @returns {Map<string, Array<Object>>}
     */
    _groupSelectedFeaturesByType() {
        const featuresByType = new Map();

        try {
            const selectedFeatures = getStateManager().getUnsafe('selection.features') || [];

            for (const item of selectedFeatures) {
                if (!featuresByType.has(item.type)) {
                    featuresByType.set(item.type, []);
                }
                featuresByType.get(item.type).push(item.feature);
            }
        } catch (_e) {
            // StateManager not available
        }

        return featuresByType;
    }

    /**
     * Create selection boxes for features of a specific type.
     * @private
     * @param {string} type - Feature type
     * @param {Array<Object>} features - GeoJSON features
     * @returns {Array<Object>} Selection box features
     */
    _createSelectionBoxesForType(type, features) {
        if (features.length === 0) return [];

        const control = this.selectionManager.controls.get(type);

        if (!this._supportsToolCentricSelectionBoxes(control)) {
            console.warn(`Tool ${type} does not implement selection box interface`);
            return [];
        }

        return this._createSelectionBoxesWithCache(features, control);
    }

    /**
     * Check if control supports tool-centric selection box interface.
     * @private
     * @param {Object} control
     * @returns {boolean}
     */
    _supportsToolCentricSelectionBoxes(control) {
        return control &&
            typeof control.createSelectionBox === 'function' &&
            typeof control.getSelectionBoxStrategy === 'function';
    }

    /**
     * Create selection boxes using tool-centric approach with caching.
     * @private
     * @param {Array<Object>} features
     * @param {Object} control
     * @returns {Array<Object>}
     */
    _createSelectionBoxesWithCache(features, control) {
        const selectionBoxes = [];

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                const currentHash = this.calculateGeometryHash(feature);
                const cacheKey = this.getCacheKey(featureId);
                const cached = this.selectionBoxCache.get(cacheKey);

                let selectionBox;

                if (cached && cached.geometryHash === currentHash) {
                    selectionBox = cached.selectionBox;
                } else {
                    const boxGeometry = control.createSelectionBox(feature);

                    if (boxGeometry) {
                        selectionBox = {
                            type: 'Feature',
                            geometry: boxGeometry.geometry || boxGeometry,
                            properties: {
                                type: 'selection-box',
                                source: feature.properties.source,
                                featureId: featureId
                            }
                        };

                        this.selectionBoxCache.set(cacheKey, {
                            geometryHash: currentHash,
                            selectionBox: selectionBox
                        });
                        this.geometryHashes.set(featureId, currentHash);
                    }
                }

                if (selectionBox) {
                    selectionBoxes.push(selectionBox);
                }
            } catch (error) {
                console.warn(`Error creating selection box for ${feature.properties.source}:`, error);
            }
        }

        return selectionBoxes;
    }

    // ========================================================================
    // DRAG OPERATIONS
    // ========================================================================

    /**
     * Shift selection boxes by delta for visual feedback during drag.
     * @param {number} dx - Delta longitude
     * @param {number} dy - Delta latitude
     * @param {boolean} [save=false] - Whether to persist the shifted positions
     */
    shiftSelectionBoxes(dx, dy, save = false) {
        const shiftedFeatures = this.selectionBoxes.map(feature => {
            return this._translateFeature(feature, dx, dy);
        });

        const selectionBoxesSource = this.map.getSource('selection-boxes');
        if (selectionBoxesSource) {
            selectionBoxesSource.setData({
                type: 'FeatureCollection',
                features: shiftedFeatures
            });
        }

        if (save) {
            this.selectionBoxes = shiftedFeatures;
        }
    }

    /**
     * Translate feature geometry by delta.
     * @private
     * @param {Object} feature - GeoJSON feature
     * @param {number} dx - Delta X (longitude)
     * @param {number} dy - Delta Y (latitude)
     * @returns {Object} Translated feature (deep cloned)
     */
    _translateFeature(feature, dx, dy) {
        const translatedFeature = deepClone(feature);

        const translateCoords = (coords) => {
            if (typeof coords[0] === 'number') {
                return [coords[0] + dx, coords[1] + dy];
            }
            return coords.map(translateCoords);
        };

        const { type, coordinates } = feature.geometry;

        switch (type) {
            case 'Point':
                translatedFeature.geometry.coordinates = translateCoords(coordinates);
                break;
            case 'LineString':
                translatedFeature.geometry.coordinates = coordinates.map(translateCoords);
                break;
            case 'Polygon':
                translatedFeature.geometry.coordinates = coordinates.map(ring => ring.map(translateCoords));
                break;
            case 'MultiLineString':
                translatedFeature.geometry.coordinates = coordinates.map(line => line.map(translateCoords));
                break;
            case 'MultiPolygon':
                translatedFeature.geometry.coordinates = coordinates.map(polygon => polygon.map(ring => ring.map(translateCoords)));
                break;
            default:
                throw new Error(`Unsupported geometry type: ${type}`);
        }

        return translatedFeature;
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    /**
     * Expand bounding box with padding in pixels.
     * Converts pixel padding to geographic degrees based on zoom and latitude.
     * @param {Array<number>} bbox - [minX, minY, maxX, maxY]
     * @param {number} paddingPixels
     * @returns {Array<number>} Expanded bbox
     */
    expandBboxWithPadding(bbox, paddingPixels) {
        const centerLat = (bbox[1] + bbox[3]) / 2;
        const mapCenter = this.map.getCenter();
        const latitude = isNaN(centerLat) ? mapCenter.lat : centerLat;

        const zoom = this.map.getZoom();
        const paddingDegrees = pixelsToDegrees(paddingPixels, latitude, zoom);

        return [
            bbox[0] - paddingDegrees,
            bbox[1] - paddingDegrees,
            bbox[2] + paddingDegrees,
            bbox[3] + paddingDegrees
        ];
    }

    /**
     * Calculate expanded dimensions after rotation.
     * Used for rotated features like text and images.
     * @param {number} originalWidth
     * @param {number} originalHeight
     * @param {number} rotationDegrees
     * @returns {{width: number, height: number}}
     */
    calculateExpandedDimensions(originalWidth, originalHeight, rotationDegrees) {
        if (rotationDegrees === 0) {
            return { width: originalWidth, height: originalHeight };
        }

        const radians = rotationDegrees * (Math.PI / 180);

        const corners = [
            { x: -originalWidth / 2, y: -originalHeight / 2 },
            { x: originalWidth / 2, y: -originalHeight / 2 },
            { x: originalWidth / 2, y: originalHeight / 2 },
            { x: -originalWidth / 2, y: originalHeight / 2 }
        ];

        const rotatedCorners = corners.map(corner => ({
            x: corner.x * Math.cos(radians) - corner.y * Math.sin(radians),
            y: corner.x * Math.sin(radians) + corner.y * Math.cos(radians)
        }));

        const minX = Math.min(...rotatedCorners.map(c => c.x));
        const maxX = Math.max(...rotatedCorners.map(c => c.x));
        const minY = Math.min(...rotatedCorners.map(c => c.y));
        const maxY = Math.max(...rotatedCorners.map(c => c.y));

        return {
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Create selection box polygon.
     * @param {Array<number>} coordinates - [lng, lat]
     * @param {number} width - Width in pixels
     * @param {number} height - Height in pixels
     * @param {number} rotation - Rotation in degrees
     * @returns {Object} GeoJSON Polygon geometry
     */
    createSelectionBox(coordinates, width, height, rotation) {
        const radians = rotation * (Math.PI / 180);
        const point = this.map.project(coordinates);
        const points = [
            [-width / 2, -height / 2],
            [width / 2, -height / 2],
            [width / 2, height / 2],
            [-width / 2, height / 2]
        ];

        const rotatedPoints = points.map(([x, y]) => {
            const nx = x * Math.cos(radians) - y * Math.sin(radians);
            const ny = x * Math.sin(radians) + y * Math.cos(radians);
            return this.map.unproject([point.x + nx, point.y + ny]);
        });

        return {
            type: 'Polygon',
            coordinates: [[
                ...rotatedPoints.map(p => [p.lng, p.lat]),
                [rotatedPoints[0].lng, rotatedPoints[0].lat]
            ]]
        };
    }

    /**
     * Calculate buffer around feature.
     * @param {Object} feature - GeoJSON feature
     * @param {number} bufferSize
     * @returns {Object}
     */
    calculateBuffer(feature, bufferSize) {
        return turf.buffer(feature, bufferSize, { units: 'degrees' });
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    /**
     * Cleanup resources.
     */
    destroy() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }
        this.map.off('zoom', this._handleZoomChange);
        this.selectionBoxCache.clear();
        this.geometryHashes.clear();
    }
}

