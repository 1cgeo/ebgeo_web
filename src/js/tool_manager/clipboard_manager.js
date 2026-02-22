// Path: js/tool_manager/clipboard_manager.js

/**
 * @fileoverview Clipboard manager for copy/paste operations on features.
 * Delegates clipboard state to StateManager.
 */

import {
    addFeatures,
    getImage,
    getCurrentMapNameSync,
    getStorageTypeFromSource,
    getSourceTypeFromStorage,
    isUncopyableFeatureType,
    hasImageResource,
    getAllSourceTypes,
    getStateManager,
    isCurrentMapLockedSync
} from '../store';
import { IDUtils, ToastService } from '../utilities';

class ClipboardManager {
    constructor(selectionManager, map) {
        this.selectionManager = selectionManager;
        this.map = map;

        // Pixel offset is local config, not state
        this._pixelOffset = 30;
    }

    // =========================================================================
    // STATE MANAGER INTEGRATION
    // =========================================================================

    /**
     * Get clipboard data from StateManager.
     * @returns {Object}
     */
    get clipboard() {
        try {
            const data = getStateManager().getClipboard();
            return {
                features: data.features || [],
                copiedAt: data.copiedAt,
                sourceMapName: data.sourceMapName,
                pixelOffset: this._pixelOffset
            };
        } catch (_e) {
            return {
                features: [],
                copiedAt: null,
                sourceMapName: null,
                pixelOffset: this._pixelOffset
            };
        }
    }

    // =========================================================================
    // CORE METHODS
    // =========================================================================

    /**
     * Copy selected features to clipboard.
     */
    copy() {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (allSelectedFeatures.length === 0) {
            ToastService.showWarning('Nenhuma feição selecionada para copiar');
            return;
        }

        const copyableFeatures = this.filterCopiableFeatures(allSelectedFeatures);

        if (copyableFeatures.length === 0) {
            ToastService.showWarning('Nenhuma feição válida para copiar');
            return;
        }

        const features = copyableFeatures.map(feature => ({
            type: feature.properties.source,
            feature: this.cleanFeatureForCopy(feature)
        }));

        try {
            getStateManager().setClipboard(features, getCurrentMapNameSync());
        } catch (_e) {
            console.warn('StateManager not available for clipboard');
        }
    }

    /**
     * Paste features from clipboard.
     * Applies offset only when pasting on the same map.
     */
    async paste() {
        if (isCurrentMapLockedSync()) return;

        if (!this.hasClipboardData()) {
            ToastService.showWarning('Nenhuma feição copiada');
            return;
        }

        try {
            const currentMapName = getCurrentMapNameSync();
            const clipboardData = this.clipboard;
            const isSameMap = clipboardData.sourceMapName === currentMapName;
            const offset = isSameMap ?
                this.calculatePixelToMetersOffset(clipboardData.pixelOffset) :
                { dx: 0, dy: 0 };

            const idMapping = new Map();
            const resourceDuplicationTasks = [];

            for (const clipboardItem of clipboardData.features) {
                const { type, feature } = clipboardItem;
                const oldId = feature.properties.id;
                const newId = IDUtils.generateUniqueId();

                idMapping.set(oldId, newId);

                if (this.hasImageResource(type)) {
                    resourceDuplicationTasks.push(
                        IDUtils.duplicateImageResource(oldId, newId, this.getFeatureStorageType(type))
                    );
                }
            }

            if (resourceDuplicationTasks.length > 0) {
                await Promise.allSettled(resourceDuplicationTasks);
            }

            const newFeaturesByType = {};

            for (const clipboardItem of clipboardData.features) {
                const { type, feature } = clipboardItem;
                const oldId = feature.properties.id;
                const newId = idMapping.get(oldId);
                const newGeoJSONId = IDUtils.generateGeoJSONId();

                const pastedFeature = this.prepareFeatureForPaste(feature, offset, type);

                if (!pastedFeature) {
                    console.warn(`Failed to prepare feature for paste: ${type}`);
                    continue;
                }

                pastedFeature.id = newGeoJSONId;
                pastedFeature.properties.id = newId;
                pastedFeature.properties.nome = await this.generateUniqueFeatureName(
                    feature.properties.nome,
                    type
                );

                const storageType = this.getFeatureStorageType(type);
                if (!newFeaturesByType[storageType]) {
                    newFeaturesByType[storageType] = [];
                }
                newFeaturesByType[storageType].push(pastedFeature);
            }

            await this.loadPastedImages(newFeaturesByType);

            await addFeatures(newFeaturesByType);

            await this.updateMapSources(newFeaturesByType);
            await this.autoSelectPastedFeatures(newFeaturesByType);

            const totalFeatures = Object.values(newFeaturesByType)
                .reduce((sum, features) => sum + features.length, 0);

            ToastService.showSuccess(`${totalFeatures} feição(ões) colada(s) com sucesso`);

        } catch (error) {
            console.error('Erro ao colar feições:', error);
            ToastService.showError('Erro ao colar feições');
        }
    }

    /**
     * Check if clipboard has data.
     * @returns {boolean}
     */
    hasClipboardData() {
        try {
            return getStateManager().hasClipboardData();
        } catch (_e) {
            return false;
        }
    }

    /**
     * Clear clipboard data.
     */
    clearClipboard() {
        try {
            getStateManager().clearClipboard();
        } catch (_e) {
            // StateManager not available
        }
    }

    // =========================================================================
    // TOOL-CENTRIC FEATURE PROCESSING
    // =========================================================================

    /**
     * Filter features that can be copied using tool-centric approach.
     * @param {Array<Object>} features
     * @returns {Array<Object>}
     */
    filterCopiableFeatures(features) {
        return features.filter(feature => {
            const featureType = feature.properties?.source;
            if (!featureType || isUncopyableFeatureType(featureType)) {
                return false;
            }

            const control = this.selectionManager.controls.get(featureType);
            if (control && typeof control.canCopy === 'function') {
                return control.canCopy(feature);
            }

            console.warn(`Tool ${featureType} does not implement canCopy interface`);
            return false;
        });
    }

    /**
     * Clean feature for copying using tool-centric approach.
     * @param {Object} feature
     * @returns {Object|null}
     */
    cleanFeatureForCopy(feature) {
        const control = this.selectionManager.controls.get(feature.properties.source);

        if (control && typeof control.prepareForCopy === 'function') {
            return control.prepareForCopy(feature);
        }

        console.warn(`Tool ${feature.properties.source} does not implement prepareForCopy interface`);
        return null;
    }

    /**
     * Prepare feature for pasting using tool-centric approach.
     * @param {Object} feature
     * @param {Object} offset
     * @param {string} type
     * @returns {Object|null}
     */
    prepareFeatureForPaste(feature, offset, type) {
        const control = this.selectionManager.controls.get(type);

        if (control && typeof control.prepareForPaste === 'function') {
            return control.prepareForPaste(feature, offset);
        }

        console.warn(`Tool ${type} does not implement prepareForPaste interface`);
        return null;
    }

    // =========================================================================
    // OFFSET CALCULATION
    // =========================================================================

    /**
     * Convert pixel offset to geographic coordinate offset.
     * @param {number} pixelOffset
     * @returns {{dx: number, dy: number}}
     */
    calculatePixelToMetersOffset(pixelOffset = 30) {
        const zoom = this.map.getZoom();
        const center = this.map.getCenter();

        const metersPerPixel = 156543.03392 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, zoom);
        const offsetMeters = pixelOffset * metersPerPixel;

        return {
            dx: offsetMeters / 111320 / Math.cos(center.lat * Math.PI / 180),
            dy: offsetMeters / 111320
        };
    }

    // =========================================================================
    // FEATURE NAME GENERATION
    // =========================================================================

    /**
     * Generate unique feature name.
     * @param {string} originalName
     * @param {string} featureType
     * @returns {Promise<string>}
     */
    async generateUniqueFeatureName(originalName, featureType) {
        if (!originalName || !originalName.trim()) {
            return await IDUtils.generateFeatureName(featureType, this.map);
        }

        if (!originalName.includes('- Cópia')) {
            return `${originalName} - Cópia`;
        }

        const match = originalName.match(/^(.+) - Cópia( (\d+))?$/);
        if (match) {
            const baseName = match[1];
            const currentNum = parseInt(match[3] || '1', 10);
            return `${baseName} - Cópia ${currentNum + 1}`;
        }

        return `${originalName} - Cópia`;
    }

    // =========================================================================
    // IMAGE HANDLING
    // =========================================================================

    /**
     * Check if feature type has image resources.
     * @param {string} featureType
     * @returns {boolean}
     */
    hasImageResource(featureType) {
        return hasImageResource(featureType);
    }

    /**
     * Load pasted images into MapLibre for immediate rendering.
     * @param {Object} newFeaturesByType
     */
    async loadPastedImages(newFeaturesByType) {
        const imagePromises = [];

        const allImageFeatures = [
            ...(newFeaturesByType.images || []),
            ...(newFeaturesByType.military_symbols || [])
        ];

        for (const feature of allImageFeatures) {
            const imageId = feature.properties.id;
            if (!imageId) continue;

            if (this.map.hasImage(imageId)) continue;

            const imagePromise = this.loadSingleImageForPaste(imageId);
            imagePromises.push(imagePromise);
        }

        await Promise.allSettled(imagePromises);
    }

    /**
     * Load single image into MapLibre.
     * @param {string} imageId
     */
    async loadSingleImageForPaste(imageId) {
        try {
            const blob = await getImage(imageId);
            if (!blob) {
                console.warn(`Imagem ${imageId} não encontrada no store`);
                return;
            }

            const url = URL.createObjectURL(blob);

            return new Promise((resolve, reject) => {
                const image = new Image();

                image.onload = () => {
                    try {
                        if (!this.map.hasImage(imageId)) {
                            this.map.addImage(imageId, image);
                        }
                        URL.revokeObjectURL(url);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };

                image.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error(`Falha ao carregar imagem ${imageId}`));
                };

                setTimeout(() => {
                    URL.revokeObjectURL(url);
                    reject(new Error(`Timeout ao carregar imagem ${imageId}`));
                }, 10000);

                image.src = url;
            });

        } catch (error) {
            console.warn(`Erro ao processar imagem ${imageId}:`, error);
        }
    }

    // =========================================================================
    // MAP SOURCE UPDATES
    // =========================================================================

    /**
     * Update map sources with pasted features.
     * @param {Object} newFeaturesByType
     */
    async updateMapSources(newFeaturesByType) {
        for (const [storageType, features] of Object.entries(newFeaturesByType)) {
            const mapSource = this.map.getSource(storageType);

            if (mapSource) {
                const data = await mapSource.getData();
                data.features.push(...features);
                mapSource.setData(data);

                const sourceType = this.getSourceTypeFromStorage(storageType);
                this.updateSpecialFeaturesToolCentric(sourceType, features);
            }
        }
    }

    /**
     * Update special features using tool-centric approach.
     * @param {string} sourceType
     * @param {Array<Object>} features
     */
    updateSpecialFeaturesToolCentric(sourceType, features) {
        const control = this.selectionManager.controls.get(sourceType);

        if (control) {
            if (typeof control.updateDependentFeatures === 'function' && sourceType === 'boundary') {
                features.forEach(feature => {
                    requestAnimationFrame(() => {
                        control.updateDependentFeatures(feature);
                    });
                });
            }
        }
    }

    /**
     * Auto-select pasted features.
     * @param {Object} newFeaturesByType
     */
    async autoSelectPastedFeatures(newFeaturesByType) {
        this.selectionManager.deselectAllFeatures();

        for (const [storageType, features] of Object.entries(newFeaturesByType)) {
            const sourceType = this.getSourceTypeFromStorage(storageType);

            for (const feature of features) {
                await this.selectionManager.toggleFeatureSelection(
                    sourceType,
                    feature.properties.id,
                    feature,
                    false
                );
            }
        }

        this.selectionManager.updateUI();
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    /**
     * Check if pasting on the same map where features were copied.
     * @returns {boolean}
     */
    isSameMapPaste() {
        const currentMapName = getCurrentMapNameSync();
        return this.clipboard.sourceMapName === currentMapName;
    }

    /**
     * Get storage type from source type.
     * @param {string} sourceType
     * @returns {string}
     */
    getFeatureStorageType(sourceType) {
        return getStorageTypeFromSource(sourceType);
    }

    /**
     * Get source type from storage type (reverse mapping).
     * @param {string} storageType
     * @returns {string}
     */
    getSourceTypeFromStorage(storageType) {
        return getSourceTypeFromStorage(storageType);
    }

    /**
     * Normalize center coordinates (handle string format).
     * @param {*} center
     * @returns {Array<number>}
     */
    normalizeCenter(center) {
        if (typeof center === 'string') {
            try {
                center = JSON.parse(center);
            } catch (_e) {
                console.error('Erro ao parsear center:', center, _e);
                return [0, 0];
            }
        }

        if (!Array.isArray(center) || center.length < 2) {
            console.error('Center inválido:', center);
            return [0, 0];
        }

        return center;
    }

    /**
     * Normalize coordinates (handle string format).
     * @param {*} coords
     * @returns {Array}
     */
    normalizeCoordinates(coords) {
        if (typeof coords === 'string') {
            try {
                coords = JSON.parse(coords);
            } catch (_e) {
                console.warn('Erro ao parsear coordenadas:', coords);
                return [];
            }
        }
        return Array.isArray(coords) ? coords : [];
    }

    /**
     * Validate if feature can be pasted.
     * @param {Object} feature
     * @returns {boolean}
     */
    isValidForPaste(feature) {
        const BLACKLISTED_TYPES = [];
        return feature &&
            feature.type === 'Feature' &&
            feature.properties &&
            feature.properties.source &&
            feature.geometry &&
            !BLACKLISTED_TYPES.includes(feature.properties.source);
    }

    // =========================================================================
    // DEBUG METHODS
    // =========================================================================

    /**
     * Get clipboard info for debugging.
     * @returns {Object}
     */
    getClipboardInfo() {
        const currentMapName = getCurrentMapNameSync();
        const clipboardData = this.clipboard;
        return {
            hasData: this.hasClipboardData(),
            featureCount: clipboardData.features.length,
            types: clipboardData.features.map(item => item.type),
            copiedAt: clipboardData.copiedAt,
            sourceMap: clipboardData.sourceMapName,
            currentMap: currentMapName,
            isSameMap: clipboardData.sourceMapName === currentMapName,
            willApplyOffset: clipboardData.sourceMapName === currentMapName,
            toolCentricStatus: this.getToolCentricStatus()
        };
    }

    /**
     * Get tool-centric implementation status for debugging.
     * @returns {Object}
     */
    getToolCentricStatus() {
        const status = {};

        for (const type of getAllSourceTypes()) {
            const control = this.selectionManager.controls.get(type);
            const hasToolCentricInterface = control &&
                typeof control.prepareForPaste === 'function' &&
                typeof control.canCopy === 'function' &&
                typeof control.prepareForCopy === 'function';

            status[type] = hasToolCentricInterface ? 'implemented' : 'missing';
        }

        return status;
    }
}

export default ClipboardManager;
