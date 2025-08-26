// Path: js\controls_sig\image_tool\add_image_control.js
import { addFeature, updateFeature, removeFeature, imageStore } from '../store.js';
import { IDUtils } from '../id_utils.js';

class AddImageControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.imageControl = this;
        this.selectionManager = toolManager.selectionManager;
        
        // Core state
        this.isActive = false;
        this.selectedFeature = null;

        // Zoom handling (seguindo padrão do text control)
        this.zoomRafId = null;
        this.pendingZoomUpdate = false;
    }

    static DEFAULT_PROPERTIES = {
        size: 1,
        rotation: 0,
        opacity: 1,
        source: 'image',
        
        // Zoom-invariant properties (seguindo text control)
        createdAtZoom: 0,
        calculatedSize: 1,
        selectionBox: null,  // GeoJSON Polygon geometry
        
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    static MAX_IMAGE_DIMENSION = 800;
    static IMAGE_QUALITY = 0.7;

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl image-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "photo-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_photo_black.svg" alt="PHOTO" />';
        button.title = 'Adicionar imagem (I)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.setupEventListeners();
        this.setupZoomListener();
        this.changeButtonColor();

        return this.container;
    }

    changeButtonColor = () => {
        $("#photo-tool").html(`<img class="icon-sig-tool" src="./images/icon_photo_black.svg" alt="PHOTO" />`);
        if (!this.isActive) return;
        $("#photo-tool").html('<img class="icon-sig-tool" src="./images/icon_photo_red.svg" alt="PHOTO" />');
    }

    onRemove() {
        try {
            this.map.off('zoom', this.handleZoomChange);
            if (this.zoomRafId) {
                cancelAnimationFrame(this.zoomRafId);
                this.zoomRafId = null;
            }
            this.pendingZoomUpdate = false;
            
            this.uiManager.removeControl(this.container);
            this.removeEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddImageControl:', error);
            throw error;
        }
    }

    setupEventListeners = () => {
        // Event listeners básicos se necessário
    }

    removeEventListeners = () => {
        this.removeHoverListeners();
    }

    // ===== ZOOM-INVARIANT SYSTEM (seguindo text control) =====

    setupZoomListener = () => {
        this.map.on('zoom', this.handleZoomChange);
    }

    handleZoomChange = () => {
        if (!this.pendingZoomUpdate) {
            this.pendingZoomUpdate = true;
            this.zoomRafId = requestAnimationFrame(this.updateAllImageSizes);
        }
    }

    applyZoomCorrections = (features) => {
        const currentZoom = this.map.getZoom();

        return features.map(feature => {
            const zoomDifference = currentZoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            feature.properties.calculatedSize = Math.min(feature.properties.size * scaleFactor, 10); // Limite máximo 10x
            return feature;
        });
    }

    updateAllImageSizes = () => {
        if (!this.map.getSource('images')) {
            return;
        }
        
        const currentZoom = this.map.getZoom();
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        let hasChanges = false;

        data.features.forEach(feature => {
            const zoomDifference = currentZoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            const newCalculatedSize = Math.min(feature.properties.size * scaleFactor, 10);
            
            if (feature.properties.calculatedSize !== newCalculatedSize) {
                feature.properties.calculatedSize = newCalculatedSize;
                hasChanges = true;
            }
        });

        if (hasChanges) {
            this.map.getSource('images').setData(data);
        }

        this.pendingZoomUpdate = false;
    }

    // Método para calcular selection box (seguindo text control)
    calculateSelectionBoxGeometry = (coordinates, width, height, size, rotation, createdAtZoom) => {
        // Aplicar size como fator de escala + correção de 62%
        const scaledWidth = width * size * 0.625;
        const scaledHeight = height * size * 0.625;
        const expandedDimensions = this.toolManager.uiManager.calculateExpandedDimensions(scaledWidth, scaledHeight, rotation);
        const padding = 5;
        
        // Usar zoom de criação para conversão
        const centerLat = coordinates[1];
        const widthDegrees = this.toolManager.uiManager.pixelsToDegrees(
            expandedDimensions.width + (padding * 2), 
            centerLat, 
            createdAtZoom
        );
        const heightDegrees = this.toolManager.uiManager.pixelsToDegrees(
            expandedDimensions.height + (padding * 2), 
            centerLat, 
            createdAtZoom
        );
        
        return this.createSelectionBoxFromDegrees(coordinates, widthDegrees, heightDegrees);
    }

    createSelectionBoxFromDegrees = (coordinates, widthDegrees, heightDegrees) => {
        const [lng, lat] = coordinates;
        const halfWidth = widthDegrees / 2;
        const halfHeight = heightDegrees / 2;
        
        return {
            type: 'Polygon',
            coordinates: [[
                [lng - halfWidth, lat - halfHeight],
                [lng + halfWidth, lat - halfHeight],
                [lng + halfWidth, lat + halfHeight],
                [lng - halfWidth, lat + halfHeight],
                [lng - halfWidth, lat - halfHeight]
            ]]
        };
    }

    // Garantir consistência (seguindo text control)
    ensureFeatureConsistency = (feature, currentZoom = null, forceRecalculateSelectionBox = false) => {
        if (!currentZoom) {
            currentZoom = this.map.getZoom();
        }
        
        // Sempre recalcular calculatedSize baseado no zoom atual
        const zoomDifference = currentZoom - feature.properties.createdAtZoom;
        const scaleFactor = Math.pow(2, zoomDifference);
        feature.properties.calculatedSize = Math.min(feature.properties.size * scaleFactor, 10);
        
        // Recalcular selectionBox apenas quando forçado ou se não existir
        if (forceRecalculateSelectionBox || !feature.properties.selectionBox) {
            feature.properties.selectionBox = this.calculateSelectionBoxGeometry(
                feature.geometry.coordinates,
                feature.properties.width,
                feature.properties.height,
                feature.properties.size,
                feature.properties.rotation,
                feature.properties.createdAtZoom
            );
        }
        
        return feature;
    }

    getLatestFeatureData = (featureId) => {
        const data = this.map.getSource('images')._data;
        return data.features.find(f => f.properties.id == featureId);
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.changeButtonColor();
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.changeButtonColor();
        this.deselectFeature();
    }

    handleMapClick = (e) => {
        if (this.isActive) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (event) => {
                const file = event.target.files[0];
                const reader = new FileReader();
                reader.onload = () => {
                    const imageBase64 = reader.result;
                    this.addImageFeature(e.lngLat, imageBase64);
                };
                reader.readAsDataURL(file);
            };
            input.click();
            this.toolManager.deactivateCurrentTool();
        }
    }

    addImageFeature = async (lngLat, imageBase64) => {
        const imageId = IDUtils.generateUniqueId();

        this.resizeImage(imageBase64, async (resizedImageBase64, width, height) => {
            try {
                // Converter para blob e salvar no imageStore
                const response = await fetch(resizedImageBase64);
                const blob = await response.blob();
                await imageStore.setItem(imageId, blob);

                // Criar feature com zoom-invariant properties
                const feature = this.createImageFeature(lngLat, imageId, width, height);
                
                // Definir zoom properties
                const currentZoom = this.map.getZoom();
                feature.properties.createdAtZoom = currentZoom;
                feature.properties.calculatedSize = feature.properties.size;
                
                // Calcular selection box
                feature.properties.selectionBox = this.calculateSelectionBoxGeometry(
                    feature.geometry.coordinates,
                    feature.properties.width,
                    feature.properties.height,
                    feature.properties.size,
                    feature.properties.rotation,
                    feature.properties.createdAtZoom
                );
                
                feature.properties.nome = IDUtils.generateFeatureName('image', this.map);

                // Salvar no IndexedDB
                await addFeature('images', feature);

                // Atualizar layer do MapLibre
                const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
                data.features.push(feature);
                this.map.getSource('images').setData(data);

                // Adicionar imagem ao mapa
                await this.loadImageToMap(imageId, blob);

                // Selecionar a feição criada
                this.selectionManager.toggleFeatureSelection('image', feature.properties.id, feature);
                this.selectionManager.updateUI();

            } catch (error) {
                console.error('Erro ao adicionar imagem:', error);
                alert('Erro ao adicionar imagem');
            }
        });
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        this.selectedFeature = feature;
        this.setupHoverListeners();
    }

    onFeatureDeselected = (feature) => {
        const featureId = feature.properties.id;
        if (this.selectedFeature && this.selectedFeature.properties.id === featureId) {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        if (this.selectedFeature) {
            this.deselectFeature();
        }
    }

    deselectFeature = () => {
        this.selectedFeature = null;
        this.removeHoverListeners();
        this.map.getCanvas().style.cursor = '';
    }

    setupHoverListeners = () => {
        this.map.on('mousemove', this.onHoverMove);
    }

    removeHoverListeners = () => {
        this.map.off('mousemove', this.onHoverMove);
    }

    onHoverMove = (e) => {
        if (!this.selectedFeature) return;
        
        const features = this.map.queryRenderedFeatures(e.point);
        const hasSelectedFeature = features.some(f => 
            f.source === 'images' && 
            f.properties.id === this.selectedFeature.properties.id
        );
        
        this.map.getCanvas().style.cursor = hasSelectedFeature ? 'move' : '';
    }

    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (featureId) => {
        return false;
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        // N/A
    }

    // ===== BLOB STORAGE METHODS =====

    async loadImageToMap(imageId, blob) {
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
    }

    resizeImage = (imageBase64, callback) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            const aspectRatio = width / height;

            if (width > AddImageControl.MAX_IMAGE_DIMENSION || height > AddImageControl.MAX_IMAGE_DIMENSION) {
                if (width > height) {
                    width = AddImageControl.MAX_IMAGE_DIMENSION;
                    height = Math.round(width / aspectRatio);
                } else {
                    height = AddImageControl.MAX_IMAGE_DIMENSION;
                    width = Math.round(height * aspectRatio);
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);

            let imageType = 'image/png';
            if (imageBase64.startsWith('data:image/jpeg')) {
                imageType = 'image/jpeg';
            } else if (imageBase64.startsWith('data:image/gif')) {
                imageType = 'image/gif';
            }

            const resizedImageBase64 = canvas.toDataURL(imageType, AddImageControl.IMAGE_QUALITY);
            callback(resizedImageBase64, width, height);
        };
        img.src = imageBase64;
    }

    createImageFeature = (lngLat, imageId, width, height) => {
        return {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddImageControl.DEFAULT_PROPERTIES,
                width,
                height,
                id: imageId
            },
            geometry: {
                type: 'Point',
                coordinates: [lngLat.lng, lngLat.lat]
            }
        };
    }

    // ===== FEATURE MANAGEMENT METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        
        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // Recalcular selection box se propriedades intrínsecas mudaram
                const shouldRecalculateSelectionBox = ['size', 'rotation'].includes(property);
                
                // Garantir consistência
                this.ensureFeatureConsistency(sourceFeature, null, shouldRecalculateSelectionBox);
                
                // Sincronizar de volta
                feature.properties.calculatedSize = sourceFeature.properties.calculatedSize;
                feature.properties.selectionBox = sourceFeature.properties.selectionBox;
            }
        }
        this.map.getSource('images').setData(data);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
            
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    const sourceFeature = data.features[featureIndex];
                    
                    if (onlyUpdateProperties) {
                        Object.assign(sourceFeature.properties, feature.properties);
                        this.ensureFeatureConsistency(sourceFeature, null, false);
                    } else {
                        // Atualizar geometria = drag operation
                        sourceFeature.geometry = feature.geometry;
                        // Forçar recálculo da selection box para nova posição
                        this.ensureFeatureConsistency(sourceFeature, null, true);
                    }

                    if (save) {
                        await updateFeature('images', sourceFeature);
                    }
                }
            }
            this.map.getSource('images').setData(data);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('images')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('images', featureToSave);
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
        });
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) {
            return;
        }

        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        const idsToDelete = new Set(Array.from(features).map(f => String(f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(f.properties.id.toString()));
        this.map.getSource('images').setData(data);

        for (const f of features) {
            try {
                await imageStore.removeItem(f.properties.id);
                await removeFeature('images', f.properties.id);
            } catch (error) {
                console.error(`Erro ao deletar imagem ${f.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddImageControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.rotation !== initialProperties.rotation ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado
        );
    }
}

export default AddImageControl;