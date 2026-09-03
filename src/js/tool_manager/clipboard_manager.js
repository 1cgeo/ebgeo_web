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
    getStateManager,
    isCurrentMapLockedSync,
    buildLayerMappingForMove,
    getLayers
} from '../store';
import { IDUtils, ToastService } from '../utilities';
import { computePasteAnchor, calculateOffsetToTarget } from './clipboard-offset.js';
import { generatePointImage, needsPerFeatureImage } from '../draw_tools/point_tool/point-marker-symbols.js';
import { parseCustomMarker, registerCustomFeatureImage } from '../draw_tools/point_tool/point-custom-icons.js';
import { collectImageResourceIds, collectImageResourceRatios } from '@layers/feature-images.js';

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
     * Copy features to clipboard.
     * @param {Array<Object>|null} [features] - Features to copy; defaults to the
     *   current selection. The context menu passes the feature under the cursor
     *   so copying does not have to change the selection.
     * @returns {number} How many features actually landed on the clipboard.
     */
    copy(features = null) {
        const sourceFeatures = Array.isArray(features)
            ? features
            : this.selectionManager.getAllSelectedFeatures();

        if (sourceFeatures.length === 0) {
            ToastService.showWarning('Nenhuma feição selecionada para copiar');
            return 0;
        }

        const copyableFeatures = this.filterCopiableFeatures(sourceFeatures);

        if (copyableFeatures.length === 0) {
            ToastService.showWarning('Nenhuma feição válida para copiar');
            return 0;
        }

        const clipboardItems = copyableFeatures
            .map(feature => ({
                type: feature.properties.source,
                feature: this.cleanFeatureForCopy(feature)
            }))
            .filter(item => item.feature);

        if (clipboardItems.length === 0) {
            ToastService.showWarning('Nenhuma feição válida para copiar');
            return 0;
        }

        try {
            getStateManager().setClipboard(clipboardItems, getCurrentMapNameSync());
        } catch (_e) {
            console.warn('StateManager not available for clipboard');
            return 0;
        }

        return clipboardItems.length;
    }

    /**
     * Paste features from clipboard.
     * Without a target the legacy behaviour applies: a 30 px nudge when pasting
     * on the same map, no offset across maps. With `targetLngLat` (the context
     * menu's "Colar Aqui") the copied set is anchored so the center of its
     * bounding box lands on that position.
     * @param {{targetLngLat?: {lng: number, lat: number}|Array<number>|null}} [options]
     */
    async paste({ targetLngLat = null } = {}) {
        if (isCurrentMapLockedSync()) {
            ToastService.showWarning('Mapa bloqueado: desbloqueie o mapa para colar');
            return;
        }

        if (!this.hasClipboardData()) {
            ToastService.showWarning('Nenhuma feição copiada');
            return;
        }

        // The destination layer is the ORIGIN layer, and `addFeatures` only guards
        // the MAP lock, so this refusal has to live here: the context menu merely
        // disables its item, while Ctrl+V and "Duplicar Seleção" reach paste()
        // directly and would otherwise write into a locked layer.
        const lockedLayers = this.getLockedDestinationLayers();
        if (lockedLayers.length > 0) {
            ToastService.showWarning(
                `Camada bloqueada: "${lockedLayers.join('", "')}". Desbloqueie a camada para colar`
            );
            return;
        }

        try {
            const currentMapName = getCurrentMapNameSync();
            const clipboardData = this.clipboard;
            const isSameMap = clipboardData.sourceMapName === currentMapName;
            const offset = this._resolvePasteOffset(clipboardData, isSameMap, targetLngLat);

            // Build layer ID mapping for cross-map paste
            let layerIdMapping = null;
            if (!isSameMap) {
                const allFeatures = clipboardData.features.map(item => item.feature);
                layerIdMapping = await buildLayerMappingForMove(
                    allFeatures, clipboardData.sourceMapName, currentMapName
                );
            }

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

                // Remap layerId for cross-map paste
                if (layerIdMapping && pastedFeature.properties.layerId) {
                    const mappedLayerId = layerIdMapping.get(pastedFeature.properties.layerId);
                    if (mappedLayerId) {
                        pastedFeature.properties.layerId = mappedLayerId;
                    }
                }

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
     * Resolve the `{dx, dy}` in degrees applied to every pasted feature.
     * Falls back to the legacy offset when no target was given, or when the
     * clipboard set has no usable coordinate to anchor on.
     * @param {Object} clipboardData
     * @param {boolean} isSameMap
     * @param {{lng: number, lat: number}|Array<number>|null} targetLngLat
     * @returns {{dx: number, dy: number}}
     * @private
     */
    _resolvePasteOffset(clipboardData, isSameMap, targetLngLat) {
        const target = this._toLngLatPair(targetLngLat);

        if (target) {
            const anchor = computePasteAnchor(
                clipboardData.features.map(item => item.feature)
            );
            const offset = calculateOffsetToTarget(anchor, target);
            if (offset) return offset;
        }

        return isSameMap
            ? this.calculatePixelToMetersOffset(clipboardData.pixelOffset)
            : { dx: 0, dy: 0 };
    }

    /**
     * Accept both `{lng, lat}` (what the map's `unproject` returns) and
     * `[lng, lat]`, rejecting anything non-finite.
     * @param {*} value
     * @returns {Array<number>|null}
     * @private
     */
    _toLngLatPair(value) {
        if (!value) return null;
        const lng = Array.isArray(value) ? value[0] : value.lng;
        const lat = Array.isArray(value) ? value[1] : value.lat;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return [lng, lat];
    }

    /**
     * Names of the locked layers the clipboard content would be pasted into.
     * Pasting keeps the ORIGIN layer, so this only resolves for a same-map
     * paste; across maps the destination layers are resolved (and possibly
     * created) by `buildLayerMappingForMove` at paste time, so nothing is
     * reported here.
     * @returns {Array<string>} Locked destination layer names (possibly empty).
     */
    getLockedDestinationLayers() {
        try {
            const clipboardData = this.clipboard;
            if (clipboardData.features.length === 0) return [];
            if (clipboardData.sourceMapName !== getCurrentMapNameSync()) return [];

            const layersById = new Map(getLayers().map(layer => [layer.id, layer]));
            const lockedNames = new Set();

            for (const item of clipboardData.features) {
                const layerId = item.feature?.properties?.layerId;
                if (!layerId) continue;
                const layer = layersById.get(layerId);
                if (layer?.locked) lockedNames.add(layer.name || layerId);
            }

            return Array.from(lockedNames);
        } catch (_e) {
            return [];
        }
    }

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

        const razoes = collectImageResourceRatios(newFeaturesByType);

        for (const imageId of collectImageResourceIds(newFeaturesByType)) {
            if (this.map.hasImage(imageId)) continue;

            const imagePromise = this.loadSingleImageForPaste(imageId, razoes.get(imageId) || 1);
            imagePromises.push(imagePromise);
        }

        await Promise.allSettled(imagePromises);

        // Register per-feature images for non-circle point markers.
        // Custom icons register asynchronously from their stored blob; built-in
        // shapes/icons bake a per-feature canvas image synchronously.
        const customPromises = [];
        for (const feature of (newFeaturesByType.points || [])) {
            const props = feature.properties;
            if (!needsPerFeatureImage(props.markerSymbol)) continue;

            const iconId = parseCustomMarker(props.markerSymbol);
            if (iconId) {
                customPromises.push(registerCustomFeatureImage(this.map, props.id, iconId));
                continue;
            }

            const imageData = generatePointImage(
                props.markerSymbol,
                props.fillColor || '#3f4fb5',
                props.lineColor || '#000000',
                props.lineWidth || 0,
            );
            if (this.map.hasImage(props.id)) {
                this.map.removeImage(props.id);
            }
            this.map.addImage(props.id, imageData, { pixelRatio: 2 });
        }
        await Promise.allSettled(customPromises);
    }

    /**
     * Load single image into MapLibre.
     * @param {string} imageId
     * @param {number} [pixelRatio=1] - Bitmap pixels per screen pixel
     */
    async loadSingleImageForPaste(imageId, pixelRatio = 1) {
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
                            this.map.addImage(imageId, image, { pixelRatio });
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
}

export default ClipboardManager;
