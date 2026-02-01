// Path: js/user_data/user_data_manager.js

/**
 * @fileoverview User Data Manager for custom attributes and images on features.
 * Provides CRUD operations for user-defined data that persists with features.
 *
 * Architecture:
 * - Uses repository.js for persistence via getMapData/updateMapData
 * - Emits FEATURE_UPDATED events via EventBus for reactive UI updates
 * - Handles image compression and thumbnail generation client-side
 * - Extracts custom attributes from imported GeoJSON properties
 */

import { getMapData, updateMapData, getCurrentMapNameSync, getStorageTypeFromSource, FEATURE_TYPE_MAPPINGS as _FEATURE_TYPE_MAPPINGS, getEventBus } from '../store';
import { IDUtils } from '../utilities';
import { EventTypes, FeatureUpdateProperty } from '../events';
import {
    IMAGE_CONFIG,
    validateImageFile,
    processImageFile
} from '../utilities/image_utils.js';
import { sanitizeHtml } from '../sidebar/panels/notes-panel.js';

/**
 * System properties that should NOT be extracted as user attributes during import.
 * This list must be comprehensive to avoid polluting user attributes with internal data.
 * @constant {Set<string>}
 */
const SYSTEM_PROPERTIES = new Set([
    // Core identifiers
    'id', 'nome', 'name', 'source', 'layerId', 'groupId',

    // Visual properties - common
    'color', 'outlinecolor', 'outlineColor', 'opacity', 'size', 'lineStyle',
    'fillColor', 'fillOpacity', 'strokeColor', 'strokeOpacity', 'strokeWidth',

    // Visual properties - text
    'text', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'textAlign',
    'textColor', 'textOpacity', 'textHaloColor', 'textHaloWidth',
    'letterSpacing', 'lineHeight', 'textTransform',

    // Hatch pattern
    'hatchEnabled', 'hatchPattern', 'hatchColor', 'hatchAngle', 'hatchSpacing',
    'hatchLineWidth', 'hatchOpacity',

    // Measurement
    'measure', 'showMeasurement', 'measurementUnit',

    // Geometry data
    'baseCoordinates', 'coordinates', 'center', 'radius', 'radiusX', 'radiusY',
    'rotation', 'bearing', 'startAngle', 'endAngle',

    // Line/Arrow specific
    'profileData', 'elevationProfile', 'arrowType', 'arrowSize', 'arrowPosition',
    'startArrow', 'endArrow', 'lineType', 'dashArray',

    // Military symbols
    'symbolCode', 'sidc', 'symbolOptions', 'affiliation', 'echelon',
    'symbolModifiers', 'symbolSize', 'reinforced', 'reduced',

    // Coordination measures
    'measureType', 'measureCategory', 'measureSubtype',

    // Image features
    'imageUrl', 'imageData', 'imageBounds', 'imageOpacity', 'imageRotation',

    // LOS/Visibility
    'observerHeight', 'targetHeight', 'analysisRadius', 'processed',

    // Boundary/Front
    'boundaryType', 'frontType', 'frontStyle',

    // Circle/Ellipse
    'radiusMeters', 'semiMajor', 'semiMinor',

    // User data fields (to avoid recursion)
    'attributes', 'images',

    // GeoJSON standard
    'type', 'geometry', 'properties', 'features', 'bbox',

    // Mapbox/MapLibre internal
    'layer', 'state', 'extent', '_vectorTileFeature', '_pbf', '_geometry',
    '_keys', '_values', '_z', '_x', '_y',
]);

// IMAGE_CONFIG is imported from utilities/image_utils.js

/**
 * User Data Manager - Singleton instance for managing custom attributes and images.
 */
const userDataManager = {
    /**
     * Retrieves a feature from the current map's data.
     * @private
     * @param {string} featureId - Unique feature identifier
     * @param {string} featureType - Feature type in singular form ('polygon', 'point', etc.)
     * @returns {Promise<Object|null>} Feature object or null if not found
     */
    async _getFeature(featureId, featureType) {
        const mapName = getCurrentMapNameSync();
        if (!mapName) {
            console.warn('UserDataManager: No map currently loaded');
            return null;
        }

        const storageType = getStorageTypeFromSource(featureType);
        if (!storageType) {
            console.warn(`UserDataManager: Unknown feature type "${featureType}"`);
            return null;
        }

        const mapData = await getMapData(mapName);
        if (!mapData?.features?.[storageType]) {
            return null;
        }

        return mapData.features[storageType].find(f => f.properties?.id === featureId) || null;
    },

    /**
     * Updates a feature in the current map's data.
     * @private
     * @param {string} featureId - Unique feature identifier
     * @param {string} featureType - Feature type in singular form
     * @param {Function} updateFn - Function that receives feature and returns updated feature
     * @returns {Promise<Object|null>} Updated feature or null on failure
     */
    async _updateFeature(featureId, featureType, updateFn) {
        const mapName = getCurrentMapNameSync();
        if (!mapName) {
            console.warn('UserDataManager: No map currently loaded');
            return null;
        }

        const storageType = getStorageTypeFromSource(featureType);
        if (!storageType) {
            console.warn(`UserDataManager: Unknown feature type "${featureType}"`);
            return null;
        }

        const mapData = await getMapData(mapName);
        if (!mapData?.features?.[storageType]) {
            return null;
        }

        const featureIndex = mapData.features[storageType].findIndex(
            f => f.properties?.id === featureId
        );

        if (featureIndex === -1) {
            console.warn(`UserDataManager: Feature not found - ${featureType}:${featureId}`);
            return null;
        }

        const feature = mapData.features[storageType][featureIndex];
        const updatedFeature = updateFn(feature);
        mapData.features[storageType][featureIndex] = updatedFeature;

        await updateMapData(mapName, mapData);
        return updatedFeature;
    },

    /**
     * Emits a FEATURE_UPDATED event via EventBus.
     * @private
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {string} property - FeatureUpdateProperty value
     * @param {Object} payload - Additional event payload
     */
    _emitUpdate(featureId, featureType, property, payload = {}) {
        try {
            const eventBus = getEventBus();
            eventBus.emit(EventTypes.FEATURE_UPDATED, {
                featureType,
                featureId,
                property,
                ...payload,
            });
        } catch (e) {
            // EventBus may not be initialized in some contexts (e.g., import before app ready)
            console.debug('UserDataManager: EventBus not ready -', e.message);
        }
    },

    // ===== ATTRIBUTES API =====

    /**
     * Gets all custom attributes for a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @returns {Promise<Object>} Attributes object (key-value pairs) or empty object
     */
    async getAttributes(featureId, featureType) {
        const feature = await this._getFeature(featureId, featureType);
        return feature?.properties?.attributes || {};
    },

    /**
     * Sets or updates a custom attribute on a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {string} key - Attribute key
     * @param {*} value - Attribute value (will be converted to string)
     * @returns {Promise<void>}
     */
    async setAttribute(featureId, featureType, key, value) {
        const validation = this.validateAttributeKey(key);
        if (!validation.valid) {
            console.warn(`UserDataManager: Invalid attribute key - ${validation.reason}`);
            return;
        }

        const stringValue = value === null || value === undefined ? '' : String(value);

        await this._updateFeature(featureId, featureType, (feature) => {
            if (!feature.properties.attributes) {
                feature.properties.attributes = {};
            }
            feature.properties.attributes[key] = stringValue;
            return feature;
        });

        this._emitUpdate(featureId, featureType, FeatureUpdateProperty.ATTRIBUTES, {
            key,
            value: stringValue,
            action: 'set',
        });
    },

    /**
     * Removes a custom attribute from a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {string} key - Attribute key to remove
     * @returns {Promise<boolean>} True if attribute was removed
     */
    async removeAttribute(featureId, featureType, key) {
        let removed = false;

        await this._updateFeature(featureId, featureType, (feature) => {
            if (feature.properties.attributes && key in feature.properties.attributes) {
                delete feature.properties.attributes[key];
                removed = true;
            }
            return feature;
        });

        if (removed) {
            this._emitUpdate(featureId, featureType, FeatureUpdateProperty.ATTRIBUTES, {
                key,
                action: 'removed',
            });
        }

        return removed;
    },

    // ===== IMAGES API =====

    /**
     * Gets all images associated with a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @returns {Promise<Array>} Array of image objects
     */
    async getImages(featureId, featureType) {
        const feature = await this._getFeature(featureId, featureType);
        return feature?.properties?.images || [];
    },

    /**
     * Adds an image to a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {File} file - Image file to add
     * @returns {Promise<Object|null>} Created image object or null on failure
     */
    async addImage(featureId, featureType, file) {
        // Use shared validation utility
        const validation = validateImageFile(file);
        if (!validation.valid) {
            console.warn(`UserDataManager: Invalid image file - ${validation.reason}`);
            return null;
        }

        try {
            // Use shared processing utility
            const processedImage = await processImageFile(file);
            const imageId = IDUtils.generateUniqueId();

            const imageData = {
                id: imageId,
                name: file.name,
                type: file.type,
                size: file.size,
                data: processedImage.data,
                thumbnail: processedImage.thumbnail,
                addedAt: Date.now(),
            };

            await this._updateFeature(featureId, featureType, (feature) => {
                if (!feature.properties.images) {
                    feature.properties.images = [];
                }
                feature.properties.images.push(imageData);
                return feature;
            });

            this._emitUpdate(featureId, featureType, FeatureUpdateProperty.IMAGES, {
                imageId,
                action: 'added',
            });

            return imageData;
        } catch (error) {
            console.error('UserDataManager: Error adding image -', error);
            return null;
        }
    },

    /**
     * Removes an image from a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {string} imageId - Image identifier to remove
     * @returns {Promise<boolean>} True if image was removed
     */
    async removeImage(featureId, featureType, imageId) {
        let removed = false;

        await this._updateFeature(featureId, featureType, (feature) => {
            if (feature.properties.images) {
                const initialLength = feature.properties.images.length;
                feature.properties.images = feature.properties.images.filter(
                    img => img.id !== imageId
                );
                removed = feature.properties.images.length < initialLength;
            }
            return feature;
        });

        if (removed) {
            this._emitUpdate(featureId, featureType, FeatureUpdateProperty.IMAGES, {
                imageId,
                action: 'removed',
            });
        }

        return removed;
    },

    /**
     * Updates the name of an image.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {string} imageId - Image identifier
     * @param {string} newName - New name for the image
     * @returns {Promise<Object|null>} Updated image object or null
     */
    async updateImageName(featureId, featureType, imageId, newName) {
        let updatedImage = null;

        await this._updateFeature(featureId, featureType, (feature) => {
            if (feature.properties.images) {
                const image = feature.properties.images.find(img => img.id === imageId);
                if (image) {
                    image.name = newName;
                    updatedImage = { ...image };
                }
            }
            return feature;
        });

        if (updatedImage) {
            this._emitUpdate(featureId, featureType, FeatureUpdateProperty.IMAGES, {
                imageId,
                action: 'updated',
            });
        }

        return updatedImage;
    },

    /**
     * Downloads an image to the user's device.
     * @param {Object} image - Image object with data and name
     */
    downloadImage(image) {
        if (!image?.data || !image?.name) {
            console.warn('UserDataManager: Invalid image for download');
            return;
        }

        const link = document.createElement('a');
        link.href = image.data;
        link.download = image.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    // Image processing is now handled by utilities/image_utils.js

    // ===== IMPORT UTILITIES =====

    /**
     * Extracts custom attributes from imported GeoJSON properties.
     * Filters out system properties, converts values to strings, and sanitizes HTML.
     * @param {Object} importedProperties - Properties from imported GeoJSON feature
     * @returns {Object} Extracted user attributes (sanitized)
     */
    extractAttributesFromImport(importedProperties) {
        if (!importedProperties || typeof importedProperties !== 'object') {
            return {};
        }

        const extracted = {};

        for (const [key, value] of Object.entries(importedProperties)) {
            // Skip system properties
            if (SYSTEM_PROPERTIES.has(key)) {
                continue;
            }

            // Skip properties starting with underscore (internal)
            if (key.startsWith('_')) {
                continue;
            }

            // Skip null/undefined values
            if (value === null || value === undefined) {
                continue;
            }

            // Handle special case: imported property named "attributes" that isn't an object
            if (key === 'attributes' && typeof value !== 'object') {
                // Sanitize to prevent XSS from imported data
                extracted['attributes_imported'] = sanitizeHtml(String(value));
                continue;
            }

            // Skip nested objects/arrays (not supported as attribute values)
            if (typeof value === 'object') {
                continue;
            }

            // Convert to string and sanitize to prevent XSS from imported data
            extracted[key] = sanitizeHtml(String(value));
        }

        return extracted;
    },

    // ===== VALIDATION =====

    /**
     * Validates an attribute key.
     * @param {string} key - Attribute key to validate
     * @returns {Object} Validation result with valid (boolean) and reason (string)
     */
    validateAttributeKey(key) {
        if (!key || typeof key !== 'string') {
            return { valid: false, reason: 'Chave vazia ou inválida' };
        }

        const trimmed = key.trim();
        if (trimmed.length === 0) {
            return { valid: false, reason: 'Chave vazia' };
        }

        if (trimmed.length > 50) {
            return { valid: false, reason: 'Chave muito longa (máximo 50 caracteres)' };
        }

        // Check for system property conflict
        if (SYSTEM_PROPERTIES.has(trimmed.toLowerCase())) {
            return { valid: false, reason: 'Chave reservada pelo sistema' };
        }

        // Allow alphanumeric, underscore, hyphen, space, and accented characters
        const validKeyRegex = /^[\p{L}\p{N}_\- ]+$/u;
        if (!validKeyRegex.test(trimmed)) {
            return { valid: false, reason: 'Chave contém caracteres inválidos' };
        }

        return { valid: true };
    },

    /**
     * Validates an image file.
     * Delegates to shared utility function.
     * @param {File} file - File to validate
     * @returns {Object} Validation result with valid (boolean) and reason (string)
     */
    validateImageFile(file) {
        return validateImageFile(file);
    },

    /**
     * Gets the list of system properties (for debugging/testing).
     * @returns {Set<string>} Set of system property names
     */
    getSystemProperties() {
        return new Set(SYSTEM_PROPERTIES);
    },

    /**
     * Gets image configuration (for UI display).
     * @returns {Object} Image configuration
     */
    getImageConfig() {
        return { ...IMAGE_CONFIG };
    },
};

export default userDataManager;
