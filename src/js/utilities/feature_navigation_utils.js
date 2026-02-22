// Path: js/utilities/feature_navigation_utils.js

/**
 * Utility for map feature navigation and zoom operations
 * Centralizes zoom, selection, and navigation logic
 */
import { getSourceTypeFromStorage } from '../store';

export class FeatureNavigationUtils {
    /**
     * Zooms to a feature with contextual padding
     * @param {Object} feature - GeoJSON feature
     * @param {Object} mapInstance - Map instance
     * @param {Object} options - Zoom options
     */
    static async zoomToFeature(feature, mapInstance, options = {}) {
        if (!feature?.geometry) {
            console.warn('Invalid feature for zoom');
            return;
        }

        const {
            paddingPercent = 0.2,
            minZoom = 10,
            maxZoom = 18,
            duration = 800
        } = options;

        try {
            const useSelectionBox = this._shouldUseSelectionBox(feature);
            const geometryToUse = useSelectionBox ? feature.properties.selectionBox : feature.geometry;

            switch (geometryToUse.type) {
                case 'Point':
                    await this._zoomToPoint(geometryToUse.coordinates, mapInstance, {
                        minZoom: Math.max(mapInstance.getZoom(), 15),
                        duration
                    });
                    break;

                case 'LineString':
                case 'Polygon':
                case 'MultiLineString':
                case 'MultiPolygon':
                    await this._zoomToBounds(geometryToUse, mapInstance, {
                        paddingPercent,
                        minZoom,
                        maxZoom,
                        duration
                    });
                    break;

                default:
                    console.warn('Unsupported geometry type:', geometryToUse.type);
            }
        } catch (error) {
            console.error('Error zooming to feature:', error);
        }
    }

    /**
     * Determines if selectionBox should be used instead of main geometry
     * @param {Object} feature - GeoJSON feature
     * @returns {boolean} True if should use selectionBox
     */
    static _shouldUseSelectionBox(feature) {
        const selectionBoxTypes = ['text', 'image', 'military_symbol'];
        const featureType = feature.properties?.source;
        const hasSelectionBox = feature.properties?.selectionBox?.type === 'Polygon';
        return selectionBoxTypes.includes(featureType) && hasSelectionBox;
    }

    /**
     * Zooms to a specific point
     * @param {Array} coordinates - [lng, lat] coordinates
     * @param {Object} mapInstance - Map instance
     * @param {Object} options - Zoom options
     * @returns {Promise} Promise that resolves when zoom completes
     */
    static async _zoomToPoint(coordinates, mapInstance, options) {
        return new Promise((resolve) => {
            mapInstance.flyTo({
                center: coordinates,
                zoom: options.minZoom,
                duration: options.duration
            });

            setTimeout(resolve, options.duration);
        });
    }

    /**
     * Zooms to bounds of a geometry
     * @param {Object} geometry - GeoJSON geometry
     * @param {Object} mapInstance - Map instance
     * @param {Object} options - Zoom options
     * @returns {Promise} Promise that resolves when zoom completes
     */
    static async _zoomToBounds(geometry, mapInstance, options) {
        const coordinates = this.extractAllCoordinates(geometry);

        if (coordinates.length === 0) {
            console.warn('No coordinates found in geometry');
            return;
        }

        const bounds = new maplibregl.LngLatBounds();
        coordinates.forEach(coord => bounds.extend(coord));

        if (bounds.isEmpty()) {
            console.warn('Empty bounds for feature');
            return;
        }

        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const width = Math.abs(ne.lng - sw.lng);
        const height = Math.abs(ne.lat - sw.lat);

        const bboxSize = Math.max(width, height);
        const paddingMeters = this._calculatePaddingFromBbox(bboxSize, options.paddingPercent);

        return new Promise((resolve) => {
            mapInstance.fitBounds(bounds, {
                padding: paddingMeters,
                duration: options.duration,
                maxZoom: options.maxZoom
            });

            setTimeout(resolve, options.duration);
        });
    }

    /**
     * Calculates padding in pixels based on bbox size
     * @param {number} bboxSize - Bounding box size
     * @param {number} paddingPercent - Padding percentage
     * @returns {number} Padding in pixels
     */
    static _calculatePaddingFromBbox(bboxSize, paddingPercent) {
        const basePixelSize = bboxSize * 100000;
        const padding = Math.max(50, Math.min(200, basePixelSize * paddingPercent));
        return Math.round(padding);
    }

    /**
     * Extracts all coordinates from a geometry
     * @param {Object} geometry - GeoJSON geometry
     * @returns {Array} Array of [lng, lat] coordinates
     */
    static extractAllCoordinates(geometry) {
        const coords = [];

        function extract(coordArray) {
            if (Array.isArray(coordArray)) {
                if (typeof coordArray[0] === 'number' && coordArray.length >= 2) {
                    coords.push(coordArray);
                } else {
                    coordArray.forEach(extract);
                }
            }
        }

        extract(geometry.coordinates);
        return coords;
    }

    /**
     * Gets center point of a feature
     * @param {Object} feature - GeoJSON feature
     * @returns {Array|null} [lng, lat] coordinates or null
     */
    static getFeatureCenterPoint(feature) {
        if (!feature?.geometry) return null;

        const geometry = feature.geometry;

        switch (geometry.type) {
            case 'Point':
                return geometry.coordinates;

            case 'LineString':
            case 'Polygon':
            case 'MultiLineString':
            case 'MultiPolygon': {
                const coordinates = this.extractAllCoordinates(geometry);
                if (coordinates.length === 0) return null;

                const sumLng = coordinates.reduce((sum, coord) => sum + coord[0], 0);
                const sumLat = coordinates.reduce((sum, coord) => sum + coord[1], 0);

                return [sumLng / coordinates.length, sumLat / coordinates.length];
            }

            default:
                return null;
        }
    }

    /**
     * Converts feature type from store format to SelectionManager format
     * @param {string} storeType - Feature type in store format
     * @returns {string} Feature type in SelectionManager format
     */
    static mapFeatureType(storeType) {
        return getSourceTypeFromStorage(storeType);
    }

    /**
     * Integrates zoom with feature selection
     * @param {Object} feature - Feature for zoom and selection
     * @param {Object} mapInstance - Map instance
     * @param {Object} selectionManager - Selection manager
     * @param {string} featureType - Feature type (store format)
     * @param {string} featureId - Feature ID
     */
    static async zoomAndSelectFeature(feature, mapInstance, selectionManager, featureType, featureId) {
        try {
            selectionManager.deselectAllFeatures();

            const selectionManagerType = getSourceTypeFromStorage(featureType);
            selectionManager.selectFeature(selectionManagerType, featureId, feature);

            await this.zoomToFeature(feature, mapInstance, {
                paddingPercent: 0.25,
                minZoom: 12,
                maxZoom: 18
            });

        } catch (error) {
            console.error('Error zooming and selecting feature:', error);
        }
    }
}
