// Path: js\controls_sig\tool_manager\clipboard_manager.js

import { addFeatures, imageStore, getCurrentMapNameSync } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import ToastService from '../utilities/toast_service.js';

/**
 * Types that cannot be copied/pasted
 */
const BLACKLISTED_TYPES = ['los', 'visibility'];

/**
 * Feature types that have image resources that need duplication
 */
const FEATURE_TYPES_WITH_IMAGE_RESOURCES = ['image', 'military_symbol'];

/**
 * Mapping from source type to storage type in the store
 */
const SOURCE_TO_STORAGE_TYPE = {
    'point': 'points',
    'line': 'lines',
    'polygon': 'polygons', 
    'text': 'texts',
    'image': 'images',
    'rectangle': 'rectangles',
    'circle': 'circles',
    'ellipse': 'ellipses',
    'brush': 'brushes',
    'arrow': 'arrows',
    'boundary': 'boundarys',
    'occupied_front': 'occupied_fronts',
    'military_symbol': 'military_symbols'
};

class ClipboardManager {
    constructor(selectionManager, map) {
        this.selectionManager = selectionManager;
        this.map = map;
        
        // Clipboard em memória - persiste entre mapas
        this.clipboard = {
            features: [],           // Array de {type, feature}
            copiedAt: null,         // Timestamp
            sourceMapName: null,    // Mapa origem
            pixelOffset: 30         // Offset fixo em pixels
        };

        // Grouped paste strategies
        this.pasteStrategies = {
            simpleCoordinateOffset: this.applySimpleCoordinateOffset.bind(this),
            centerBasedOffset: this.applyCenterBasedOffset.bind(this),
            allCoordinatesOffset: this.applyAllCoordinatesOffset.bind(this),
            baseCoordinatesOffset: this.applyBaseCoordinatesOffset.bind(this)
        };

        // Strategy mapping for each feature type
        this.typeStrategyMapping = {
            'point': 'simpleCoordinateOffset',
            'text': 'simpleCoordinateOffset', 
            'image': 'simpleCoordinateOffset',
            'military_symbol': 'simpleCoordinateOffset',
            'circle': 'centerBasedOffset',
            'ellipse': 'centerBasedOffset',
            'rectangle': 'centerBasedOffset',
            'line': 'allCoordinatesOffset',
            'brush': 'allCoordinatesOffset',
            'polygon': 'baseCoordinatesOffset',
            'arrow': 'baseCoordinatesOffset',
            'boundary': 'baseCoordinatesOffset',
            'occupied_front': 'baseCoordinatesOffset'
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

        // Filter copyable features (blacklist approach)
        const copyableFeatures = this.filterCopiableFeatures(allSelectedFeatures);
        
        if (copyableFeatures.length === 0) {
            ToastService.showWarning('Nenhuma feição válida para copiar');
            return;
        }

        // Clean and store features
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
            
            // ===== PHASE 1: Collect resource operations WITHOUT changing feature IDs =====
            const idMapping = new Map();
            const resourceDuplicationTasks = [];
            
            for (const clipboardItem of this.clipboard.features) {
                const { type, feature } = clipboardItem;
                const oldId = feature.properties.id;
                const newId = IDUtils.generateUniqueId();
                
                // Map IDs for later application
                idMapping.set(oldId, newId);
                
                // Schedule image resource duplication if needed
                if (this.hasImageResource(type)) {
                    resourceDuplicationTasks.push(
                        IDUtils.duplicateImageResource(oldId, newId, this.getFeatureStorageType(type))
                    );
                }
            }
            
            // ===== PHASE 2: Duplicate resources using original IDs =====
            if (resourceDuplicationTasks.length > 0) {
                await Promise.allSettled(resourceDuplicationTasks);
            }
            
            // ===== PHASE 3: Process features and apply new IDs =====
            const newFeaturesByType = {};
            
            for (const clipboardItem of this.clipboard.features) {
                const { type, feature } = clipboardItem;
                const oldId = feature.properties.id;
                const newId = idMapping.get(oldId);
                const newGeoJSONId = IDUtils.generateGeoJSONId();
                
                // Apply appropriate paste strategy
                const strategyName = this.typeStrategyMapping[type];
                const strategy = this.pasteStrategies[strategyName];
                
                let pastedFeature;
                if (strategy) {
                    pastedFeature = strategy(feature, offset, type);
                } else {
                    console.warn(`No strategy found for type: ${type}`);
                    pastedFeature = { ...feature };
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
            
            // ===== PHASE 4: Load duplicated images into MapLibre for immediate rendering =====
            await this.loadPastedImages(newFeaturesByType);
            
            // Add features to map using existing system (automatically handles undo/redo)
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

    // ===== FEATURE FILTERING AND CLEANING =====

    /**
     * Filter features that can be copied (blacklist approach)
     */
    filterCopiableFeatures(features) {
        return features.filter(feature => {
            const featureType = feature.properties?.source;
            return featureType && !BLACKLISTED_TYPES.includes(featureType);
        });
    }

    /**
     * Clean feature for copying by removing UI metadata
     */
    cleanFeatureForCopy(feature) {
        const cleaned = JSON.parse(JSON.stringify(feature));
        
        // Remove UI metadata only
        delete cleaned.properties.isSelected;
        delete cleaned.properties.isPreview;
        delete cleaned.properties.user_isEditingHandle;
        
        // Preserve ALL other properties including:
        // - Visual: lineColor, fillColor, opacity, lineWidth, lineStyle
        // - Geometric: center, radius, baseCoordinates, width, height, bearing
        // - Descriptive: nome, descricao, visivel, bloqueado
        // - Specific: coordinationPoint, measure, etc.
        
        return cleaned;
    }

    // ===== OFFSET CALCULATION =====

    /**
     * Convert pixel offset to geographic coordinate offset
     */
    calculatePixelToMetersOffset(pixelOffset = 30) {
        const zoom = this.map.getZoom();
        const center = this.map.getCenter();
        
        // MapLibre formula: meters per pixel
        const metersPerPixel = 156543.03392 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, zoom);
        const offsetMeters = pixelOffset * metersPerPixel;
        
        // Convert to geographic coordinates
        return {
            dx: offsetMeters / 111320 / Math.cos(center.lat * Math.PI / 180),
            dy: offsetMeters / 111320
        };
    }

    // ===== GROUPED PASTE STRATEGIES =====

    /**
     * Strategy 1: Simple coordinate offset for point-like features
     * Used by: point, text, image, military_symbol
     */
    applySimpleCoordinateOffset(feature, offset, type) {
        const newCoordinates = [
            feature.geometry.coordinates[0] + offset.dx,
            feature.geometry.coordinates[1] + offset.dy
        ];

        const updatedFeature = {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            }
        };

        // Recalculate selectionBox for features that have it
        if (type === 'text' || type === 'image' || type === 'military_symbol') {
            const control = this.selectionManager.controls.get(type);
            if (control && control.calculateSelectionBoxGeometry) {
                updatedFeature.properties.selectionBox = control.calculateSelectionBoxGeometry(
                    newCoordinates,
                    type === 'text' ? updatedFeature.properties.text : updatedFeature.properties.width,
                    type === 'text' ? updatedFeature.properties.size : updatedFeature.properties.height,
                    type === 'text' ? updatedFeature.properties.size : updatedFeature.properties.size,
                    updatedFeature.properties.rotation,
                    updatedFeature.properties.createdAtZoom
                );
            }
        }

        return updatedFeature;
    }

    /**
     * Strategy 2: Center-based offset for geometric shapes
     * Used by: circle, ellipse, rectangle
     */
    applyCenterBasedOffset(feature, offset, type) {
        const oldCenter = this.normalizeCenter(feature.properties.center);
        const newCenter = [oldCenter[0] + offset.dx, oldCenter[1] + offset.dy];
        
        const control = this.selectionManager.controls.get(type);
        let newGeometry = feature.geometry;
        
        // Recalculate geometry using control methods
        if (control) {
            switch (type) {
                case 'circle':
                    newGeometry = control.generateCircleGeometry(newCenter, feature.properties.radius);
                    break;
                case 'ellipse':
                    newGeometry = control.generateEllipseGeometry(
                        newCenter,
                        feature.properties.majorRadius,
                        feature.properties.minorRadius,
                        feature.properties.bearing
                    );
                    break;
                case 'rectangle':
                    // For rectangle, recalculate corners based on new center
                    const width = feature.properties.width;
                    const height = feature.properties.height;
                    const halfWidthDeg = (width / 2) / 111320 / Math.cos(newCenter[1] * Math.PI / 180);
                    const halfHeightDeg = (height / 2) / 111320;
                    
                    const newCorner1 = [newCenter[0] - halfWidthDeg, newCenter[1] + halfHeightDeg];
                    const newCorner2 = [newCenter[0] + halfWidthDeg, newCenter[1] - halfHeightDeg];
                    
                    newGeometry = control.generateRectangleGeometry(newCorner1, newCorner2);
                    
                    return {
                        ...feature,
                        properties: {
                            ...feature.properties,
                            center: newCenter,
                            corner1: newCorner1,
                            corner2: newCorner2
                        },
                        geometry: newGeometry
                    };
            }
        }
        
        return {
            ...feature,
            properties: {
                ...feature.properties,
                center: newCenter
            },
            geometry: newGeometry
        };
    }

    /**
     * Strategy 3: All coordinates offset for line-like features
     * Used by: line, brush
     */
    applyAllCoordinatesOffset(feature, offset, type) {
        if (type === 'line') {
            // Lines use baseCoordinates
            const baseCoords = this.normalizeCoordinates(feature.properties.baseCoordinates || feature.geometry.coordinates);
            const newBaseCoords = baseCoords.map(coord => [
                coord[0] + offset.dx,
                coord[1] + offset.dy
            ]);
            
            return {
                ...feature,
                properties: {
                    ...feature.properties,
                    baseCoordinates: newBaseCoords
                },
                geometry: {
                    type: 'LineString',
                    coordinates: newBaseCoords
                }
            };
        } else {
            // Brush - direct coordinate offset
            const newCoordinates = feature.geometry.coordinates.map(coord => [
                coord[0] + offset.dx,
                coord[1] + offset.dy
            ]);
            
            return {
                ...feature,
                geometry: {
                    ...feature.geometry,
                    coordinates: newCoordinates
                }
            };
        }
    }

    /**
     * Strategy 4: Base coordinates offset for complex features
     * Used by: polygon, arrow, boundary, occupied_front
     */
    applyBaseCoordinatesOffset(feature, offset, type) {
        const baseCoords = this.normalizeCoordinates(feature.properties.baseCoordinates);
        
        if (!baseCoords || baseCoords.length === 0) {
            console.warn(`No baseCoordinates found for ${type} feature`);
            return feature;
        }
        
        const newBaseCoords = baseCoords.map(coord => [
            coord[0] + offset.dx,
            coord[1] + offset.dy
        ]);
        
        const control = this.selectionManager.controls.get(type);
        let newGeometry = feature.geometry;
        
        // Recalculate geometry using control methods
        if (control) {
            const updatedProperties = {
                ...feature.properties,
                baseCoordinates: newBaseCoords
            };
            
            switch (type) {
                case 'polygon':
                    // Create closed coordinates for geometry
                    const closedCoords = [...newBaseCoords, newBaseCoords[0]];
                    newGeometry = {
                        type: 'Polygon',
                        coordinates: [closedCoords]
                    };
                    break;
                case 'arrow':
                    newGeometry = control.generateArrowGeometry(updatedProperties);
                    break;
                case 'boundary':
                    newGeometry = control.generateBoundaryGeometry(updatedProperties);
                    break;
                case 'occupied_front':
                    newGeometry = control.createOccupiedFrontGeometry(newBaseCoords);
                    break;
            }
        }
        
        return {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newBaseCoords
            },
            geometry: newGeometry
        };
    }

    // ===== FEATURE PROCESSING =====

    /**
     * Clone feature with new IDs and apply offset
     */
    cloneFeatureWithNewIds(feature, offset, type) {
        // Apply appropriate paste strategy
        const strategyName = this.typeStrategyMapping[type];
        const strategy = this.pasteStrategies[strategyName];
        
        let clonedFeature;
        if (strategy) {
            clonedFeature = strategy(feature, offset, type);
        } else {
            console.warn(`No strategy found for type: ${type}`);
            clonedFeature = { ...feature };
        }
        
        // Generate new IDs
        const newId = IDUtils.generateUniqueId();
        const newGeoJSONId = IDUtils.generateGeoJSONId();
        
        // Update IDs and name
        clonedFeature.id = newGeoJSONId;
        clonedFeature.properties.id = newId;
        clonedFeature.properties.nome = this.generateUniqueFeatureName(
            feature.properties.nome,
            type
        );
        
        return clonedFeature;
    }

    /**
     * Generate unique feature name
     */
    generateUniqueFeatureName(originalName, featureType) {
        // If original name is empty, use default generator
        if (!originalName || !originalName.trim()) {
            return IDUtils.generateFeatureName(featureType, this.map);
        }
        
        // If original name exists, add "- Cópia" suffix
        if (!originalName.includes('- Cópia')) {
            return `${originalName} - Cópia`;
        }
        
        // If already has "- Cópia", increment number
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
        return FEATURE_TYPES_WITH_IMAGE_RESOURCES.includes(featureType);
    }

    /**
     * Load pasted images into MapLibre for immediate rendering
     * Same structure as setImages from layer setup
     */
    async loadPastedImages(newFeaturesByType) {
        const imagePromises = [];

        // Collect all image features from pasted data
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
     * Same structure as loadSingleImage from layer setup
     */
    async loadSingleImageForPaste(imageId) {
        try {
            const blob = await imageStore.getItem(imageId);
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
                
                // Update special feature dependencies
                const sourceType = this.getSourceTypeFromStorage(storageType);
                this.updateSpecialFeatures(sourceType, features);
            }
        }
    }

    /**
     * Update special features that have dependencies
     */
    updateSpecialFeatures(sourceType, features) {
        // Update X marks for circles
        if (sourceType === 'circle') {
            const circleControl = this.selectionManager.controls.get('circle');
            if (circleControl && circleControl.updateXMarks) {
                circleControl.updateXMarks();
            }
        }
        
        // Update dependent features for boundary
        if (sourceType === 'boundary') {
            const boundaryControl = this.selectionManager.controls.get('boundary');
            features.forEach(feature => {
                if (boundaryControl && boundaryControl.updateDependentFeatures) {
                    // Use requestAnimationFrame to avoid conflicts
                    requestAnimationFrame(() => {
                        boundaryControl.updateDependentFeatures(feature);
                    });
                }
            });
        }
    }

    /**
     * Auto-select pasted features
     */
    autoSelectPastedFeatures(newFeaturesByType) {
        // Clear current selection
        this.selectionManager.deselectAllFeatures();
        
        // Select all pasted features
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
        return SOURCE_TO_STORAGE_TYPE[sourceType] || `${sourceType}s`;
    }

    /**
     * Get source type from storage type (reverse mapping)
     */
    getSourceTypeFromStorage(storageType) {
        for (const [sourceType, storage] of Object.entries(SOURCE_TO_STORAGE_TYPE)) {
            if (storage === storageType) {
                return sourceType;
            }
        }
        return storageType.slice(0, -1); // Remove 's' as fallback
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
            sourceMap: this.clipboard.sourceMapName
        };
    }
}

export default ClipboardManager;