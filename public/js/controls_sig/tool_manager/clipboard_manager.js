// Path: js\controls_sig\tool_manager\clipboard_manager.js

import {
    addFeatures,
    getImage,
    getCurrentMapNameSync,
    getStorageTypeFromSource,
    getSourceTypeFromStorage,
    isUncopyableFeatureType,
    hasImageResource,
    getAllSourceTypes
} from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import ToastService from '../utilities/toast_service.js';

class ClipboardManager {
    constructor(selectionManager, map) {
        this.selectionManager = selectionManager;
        this.map = map;

        // Clipboard em memória
        this.clipboard = {
            features: [],
            copiedAt: null,
            sourceMapName: null,
            pixelOffset: 30
        };
    }

    // ===== CORE METHODS =====

    /**
     * Copy selected features to clipboard
     */
    copy() {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (allSelectedFeatures.length === 0) {
            ToastService.showWarning('Nenhuma feição selecionada para copiar');
            return;
        }

        // Filter copyable features using tool-centric approach only
        const copyableFeatures = this.filterCopiableFeatures(allSelectedFeatures);

        if (copyableFeatures.length === 0) {
            ToastService.showWarning('Nenhuma feição válida para copiar');
            return;
        }

        // Clean and store features using tool-centric approach only
        this.clipboard.features = copyableFeatures.map(feature => ({
            type: feature.properties.source,
            feature: this.cleanFeatureForCopy(feature)
        }));

        this.clipboard.copiedAt = Date.now();
        this.clipboard.sourceMapName = getCurrentMapNameSync();
    }

    /**
     * Paste features from clipboard
     */
    async paste() {
        if (!this.hasClipboardData()) {
            ToastService.showWarning('Nenhuma feição copiada');
            return;
        }

        try {
            // Calculate offset based on current zoom
            const offset = this.calculatePixelToMetersOffset(this.clipboard.pixelOffset);

            // Phase 1: Collect resource operations
            const idMapping = new Map();
            const resourceDuplicationTasks = [];

            for (const clipboardItem of this.clipboard.features) {
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

            // Phase 2: Duplicate resources
            if (resourceDuplicationTasks.length > 0) {
                await Promise.allSettled(resourceDuplicationTasks);
            }

            // Phase 3: Process features using tool-centric approach only
            const newFeaturesByType = {};

            for (const clipboardItem of this.clipboard.features) {
                const { type, feature } = clipboardItem;
                const oldId = feature.properties.id;
                const newId = idMapping.get(oldId);
                const newGeoJSONId = IDUtils.generateGeoJSONId();

                // Apply tool-centric paste strategy ONLY
                let pastedFeature = this.prepareFeatureForPaste(feature, offset, type);

                if (!pastedFeature) {
                    console.warn(`Failed to prepare feature for paste: ${type}`);
                    continue;
                }

                // Update IDs and name
                pastedFeature.id = newGeoJSONId;
                pastedFeature.properties.id = newId;
                pastedFeature.properties.nome = this.generateUniqueFeatureName(
                    feature.properties.nome,
                    type
                );

                // Group by storage type
                const storageType = this.getFeatureStorageType(type);
                if (!newFeaturesByType[storageType]) {
                    newFeaturesByType[storageType] = [];
                }
                newFeaturesByType[storageType].push(pastedFeature);
            }

            // Phase 4: Load duplicated images
            await this.loadPastedImages(newFeaturesByType);

            // Add features to map
            await addFeatures(newFeaturesByType);

            // Update map sources and UI
            this.updateMapSources(newFeaturesByType);
            this.autoSelectPastedFeatures(newFeaturesByType);

            const totalFeatures = Object.values(newFeaturesByType)
                .reduce((sum, features) => sum + features.length, 0);

            ToastService.showSuccess(`${totalFeatures} feição(ões) colada(s) com sucesso`);

        } catch (error) {
            console.error('Erro ao colar feições:', error);
            ToastService.showError('Erro ao colar feições');
        }
    }

    /**
     * Check if clipboard has data
     */
    hasClipboardData() {
        return this.clipboard.features.length > 0;
    }

    /**
     * Clear clipboard data
     */
    clearClipboard() {
        this.clipboard.features = [];
        this.clipboard.copiedAt = null;
        this.clipboard.sourceMapName = null;
    }

    // ===== TOOL-CENTRIC FEATURE PROCESSING =====

    /**
     * Filter features that can be copied using tool-centric approach only
     */
    filterCopiableFeatures(features) {
        return features.filter(feature => {
            const featureType = feature.properties?.source;
            if (!featureType || isUncopyableFeatureType(featureType)) {
                return false;
            }

            // Check with tool if it supports copy operation
            const control = this.selectionManager.controls.get(featureType);
            if (control && typeof control.canCopy === 'function') {
                return control.canCopy(feature);
            }

            console.warn(`Tool ${featureType} does not implement canCopy interface`);
            return false;
        });
    }

    /**
     * Clean feature for copying using tool-centric approach only
     */
    cleanFeatureForCopy(feature) {
        const control = this.selectionManager.controls.get(feature.properties.source);

        // Use tool-centric approach only
        if (control && typeof control.prepareForCopy === 'function') {
            return control.prepareForCopy(feature);
        }

        // No fallback - log warning and return null
        console.warn(`Tool ${feature.properties.source} does not implement prepareForCopy interface`);
        return null;
    }

    /**
     * Prepare feature for pasting using tool-centric approach only
     */
    prepareFeatureForPaste(feature, offset, type) {
        const control = this.selectionManager.controls.get(type);

        // Use tool-centric approach only
        if (control && typeof control.prepareForPaste === 'function') {
            return control.prepareForPaste(feature, offset);
        }

        // No fallback - log warning and return null
        console.warn(`Tool ${type} does not implement prepareForPaste interface`);
        return null;
    }

    // ===== OFFSET CALCULATION =====

    /**
     * Convert pixel offset to geographic coordinate offset
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

    // ===== FEATURE NAME GENERATION =====

    /**
     * Generate unique feature name
     */
    generateUniqueFeatureName(originalName, featureType) {
        if (!originalName || !originalName.trim()) {
            return IDUtils.generateFeatureName(featureType, this.map);
        }

        if (!originalName.includes('- Cópia')) {
            return `${originalName} - Cópia`;
        }

        const match = originalName.match(/^(.+) - Cópia( (\d+))?$/);
        if (match) {
            const baseName = match[1];
            const currentNum = parseInt(match[3] || '1');
            return `${baseName} - Cópia ${currentNum + 1}`;
        }

        return `${originalName} - Cópia`;
    }

    // ===== IMAGE RESOURCE MANAGEMENT =====

    /**
     * Check if feature type has image resources
     */
    hasImageResource(featureType) {
        return hasImageResource(featureType);
    }

    /**
     * Load pasted images into MapLibre for immediate rendering
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
     * Load single image into MapLibre
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

    // ===== MAP SOURCE UPDATES =====

    /**
     * Update map sources with pasted features
     */
    updateMapSources(newFeaturesByType) {
        for (const [storageType, features] of Object.entries(newFeaturesByType)) {
            const mapSource = this.map.getSource(storageType);

            if (mapSource && mapSource._data) {
                const data = JSON.parse(JSON.stringify(mapSource._data));
                data.features.push(...features);
                mapSource.setData(data);

                // Update special feature dependencies using tool-centric approach
                const sourceType = this.getSourceTypeFromStorage(storageType);
                this.updateSpecialFeaturesToolCentric(sourceType, features);
            }
        }
    }

    /**
     * Update special features using tool-centric approach
     */
    updateSpecialFeaturesToolCentric(sourceType, features) {
        const control = this.selectionManager.controls.get(sourceType);

        if (control) {
            // Check for special update methods in tool-centric controls
            if (typeof control.updateXMarks === 'function' && sourceType === 'circle') {
                control.updateXMarks();
            }

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
     * Auto-select pasted features
     */
    autoSelectPastedFeatures(newFeaturesByType) {
        this.selectionManager.deselectAllFeatures();

        for (const [storageType, features] of Object.entries(newFeaturesByType)) {
            const sourceType = this.getSourceTypeFromStorage(storageType);

            features.forEach(feature => {
                this.selectionManager.toggleFeatureSelection(
                    sourceType,
                    feature.properties.id,
                    feature,
                    false
                );
            });
        }

        this.selectionManager.updateUI();
    }

    // ===== UTILITY METHODS =====

    /**
     * Get storage type from source type
     */
    getFeatureStorageType(sourceType) {
        return getStorageTypeFromSource(sourceType);
    }

    /**
     * Get source type from storage type (reverse mapping)
     */
    getSourceTypeFromStorage(storageType) {
        return getSourceTypeFromStorage(storageType);
    }

    /**
     * Normalize center coordinates (handle string format)
     */
    normalizeCenter(center) {
        if (typeof center === 'string') {
            try {
                center = JSON.parse(center);
            } catch (e) {
                console.error('Erro ao parsear center:', center, e);
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
     * Normalize coordinates (handle string format)
     */
    normalizeCoordinates(coords) {
        if (typeof coords === 'string') {
            try {
                coords = JSON.parse(coords);
            } catch (e) {
                console.warn('Erro ao parsear coordenadas:', coords);
                return [];
            }
        }
        return Array.isArray(coords) ? coords : [];
    }

    // ===== VALIDATION =====

    /**
     * Validate if feature can be pasted
     */
    isValidForPaste(feature) {
        return feature &&
            feature.type === 'Feature' &&
            feature.properties &&
            feature.properties.source &&
            feature.geometry &&
            !BLACKLISTED_TYPES.includes(feature.properties.source);
    }

    // ===== DEBUG METHODS =====

    /**
     * Get clipboard info for debugging
     */
    getClipboardInfo() {
        return {
            hasData: this.hasClipboardData(),
            featureCount: this.clipboard.features.length,
            types: this.clipboard.features.map(item => item.type),
            copiedAt: this.clipboard.copiedAt,
            sourceMap: this.clipboard.sourceMapName,
            toolCentricStatus: this.getToolCentricStatus()
        };
    }

    /**
     * Get tool-centric implementation status for debugging
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