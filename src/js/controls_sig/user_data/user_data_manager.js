// Path: js/controls_sig/user_data/user_data_manager.js

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

import { getMapData, updateMapData } from '../store/repository.js';
import { getCurrentMapNameSync, getStorageTypeFromSource, FEATURE_TYPE_MAPPINGS } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import { getEventBus } from '../services.js';
import { EventTypes, FeatureUpdateProperty } from '../events/event_types.js';

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

/**
 * Configuration for image handling.
 * @constant {Object}
 */
const IMAGE_CONFIG = {
    maxSizeBytes: 10 * 1024 * 1024,  // 10MB max upload
    compressionThreshold: 2 * 1024 * 1024,  // Compress above 2MB
    compressionQuality: 0.8,
    thumbnailSize: 150,
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
};

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
        const validation = this.validateImageFile(file);
        if (!validation.valid) {
            console.warn(`UserDataManager: Invalid image file - ${validation.reason}`);
            return null;
        }

        try {
            const processedImage = await this._processImageFile(file);
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

    // ===== IMAGE PROCESSING =====

    /**
     * Processes an image file - compresses if needed and generates thumbnail.
     * @private
     * @param {File} file - Image file
     * @returns {Promise<Object>} Object with data (base64) and thumbnail (base64)
     */
    async _processImageFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    let imageData = e.target.result;

                    // Compress if above threshold
                    if (file.size > IMAGE_CONFIG.compressionThreshold) {
                        imageData = await this._compressImage(imageData);
                    }

                    // Generate thumbnail
                    const thumbnail = await this._createThumbnail(imageData);

                    resolve({
                        data: imageData,
                        thumbnail: thumbnail,
                    });
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    },

    /**
     * Compresses an image using canvas.
     * @private
     * @param {string} base64Data - Base64 encoded image
     * @returns {Promise<string>} Compressed base64 image
     */
    async _compressImage(base64Data) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    // Maintain aspect ratio, limit max dimension to 2048px
                    const maxDimension = 2048;
                    let { width, height } = img;

                    if (width > maxDimension || height > maxDimension) {
                        if (width > height) {
                            height = (height / width) * maxDimension;
                            width = maxDimension;
                        } else {
                            width = (width / height) * maxDimension;
                            height = maxDimension;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);

                    const compressed = canvas.toDataURL('image/jpeg', IMAGE_CONFIG.compressionQuality);
                    resolve(compressed);
                } catch (error) {
                    // Fallback to original on compression failure
                    console.warn('UserDataManager: Compression failed, using original');
                    resolve(base64Data);
                }
            };

            img.onerror = () => {
                // Fallback to original on load failure
                console.warn('UserDataManager: Image load failed for compression');
                resolve(base64Data);
            };

            img.src = base64Data;
        });
    },

    /**
     * Creates a thumbnail from an image.
     * @private
     * @param {string} base64Data - Base64 encoded image
     * @returns {Promise<string>} Thumbnail as base64
     */
    async _createThumbnail(base64Data) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const size = IMAGE_CONFIG.thumbnailSize;

                    // Create square thumbnail (crop to center)
                    const minDimension = Math.min(img.width, img.height);
                    const sx = (img.width - minDimension) / 2;
                    const sy = (img.height - minDimension) / 2;

                    canvas.width = size;
                    canvas.height = size;
                    ctx.drawImage(img, sx, sy, minDimension, minDimension, 0, 0, size, size);

                    const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
                    resolve(thumbnail);
                } catch (error) {
                    // Return original as fallback
                    console.warn('UserDataManager: Thumbnail creation failed');
                    resolve(base64Data);
                }
            };

            img.onerror = () => {
                console.warn('UserDataManager: Image load failed for thumbnail');
                resolve(base64Data);
            };

            img.src = base64Data;
        });
    },

    // ===== IMPORT UTILITIES =====

    /**
     * Extracts custom attributes from imported GeoJSON properties.
     * Filters out system properties and converts values to strings.
     * @param {Object} importedProperties - Properties from imported GeoJSON feature
     * @returns {Object} Extracted user attributes
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
                extracted['attributes_imported'] = String(value);
                continue;
            }

            // Skip nested objects/arrays (not supported as attribute values)
            if (typeof value === 'object') {
                continue;
            }

            // Convert to string and store
            extracted[key] = String(value);
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
     * @param {File} file - File to validate
     * @returns {Object} Validation result with valid (boolean) and reason (string)
     */
    validateImageFile(file) {
        if (!file) {
            return { valid: false, reason: 'Nenhum arquivo selecionado' };
        }

        if (file.size > IMAGE_CONFIG.maxSizeBytes) {
            const maxMB = IMAGE_CONFIG.maxSizeBytes / (1024 * 1024);
            return { valid: false, reason: `Arquivo muito grande (máximo ${maxMB}MB)` };
        }

        if (!IMAGE_CONFIG.allowedTypes.includes(file.type)) {
            return { valid: false, reason: 'Tipo de arquivo não suportado (use JPEG, PNG, GIF ou WebP)' };
        }

        return { valid: true };
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
