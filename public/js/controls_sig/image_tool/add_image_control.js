// Path: js\controls_sig\image_tool\add_image_control.js
import { addFeature, updateFeature, removeFeature, storeImage, removeImage } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import { addImageAttributesToPanel } from './image_attributes_panel.js';
import AddImageGeometry from './add_image_geometry.js';
import BaseControl from '../tool_manager/base_control.js';

class AddImageControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        // Geometry handler
        this.geometry = new AddImageGeometry();

        // Zoom handling for zoom-invariant behavior
        this.zoomRafId = null;
        this.pendingZoomUpdate = false;
    }

    static DEFAULT_PROPERTIES = {
        size: 1,
        rotation: 0,
        opacity: 1,
        source: 'image',

        // Zoom-invariant properties (following text control pattern)
        createdAtZoom: 0,
        calculatedSize: 1,
        selectionBox: null,  // Pre-calculated GeoJSON Polygon geometry

        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    static MAX_IMAGE_DIMENSION = 800;
    static IMAGE_QUALITY = 0.7;

    // ===== FONTE ÚNICA DA VERDADE =====

    /**
     * Get currently selected image feature from SelectionManager
     * @returns {Object|null} Selected image feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('image');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected image features from SelectionManager
     * @returns {Array} Array of selected image features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('image')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
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
        this.setupBaseEventListeners();
        this.setupZoomListener();
        this.updateButtonAppearance();

        return this.container;
    }

    onRemove = () => {
        try {
            this.map.off('zoom', this.handleZoomChange);
            if (this.zoomRafId) {
                cancelAnimationFrame(this.zoomRafId);
                this.zoomRafId = null;
            }
            this.pendingZoomUpdate = false;

            this.selectionManager.uiManager.removeControl(this.container);
            this.deactivate();
            this.removeAllEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddImageControl:', error);
            throw error;
        }
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'image-attributes-section';

        try {
            addImageAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating image attribute panel:', error);
        }
    }

    getDragSources() {
        return ['images'];
    }

    getEditHandleSources() {
        return []; // Images don't have edit handles
    }

    createSelectionBox(feature) {
        // Images use pre-calculated selection boxes stored as properties
        if (feature.properties.selectionBox) {
            return { geometry: feature.properties.selectionBox };
        }

        // Fallback: calculate on demand if missing
        const selectionBox = this.geometry.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.width,
            feature.properties.height,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager
        );

        return { geometry: selectionBox };
    }

    getSelectionBoxStrategy() {
        return 'preCalculated'; // Images use stored selection boxes
    }

    getSelectionBoxPadding() {
        return 5;
    }

    getLayerIds() {
        return ['images-layer'];
    }

    getSourceNames() {
        return ['images'];
    }

    getEditHandleSource() {
        return null; // Images don't have edit handles
    }

    canCopy(feature) {
        return true;
    }

    canPaste(feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const oldCoordinates = feature.geometry.coordinates;
        const newCoordinates = [oldCoordinates[0] + offset.dx, oldCoordinates[1] + offset.dy];

        // Recalculate selection box for new position
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            newCoordinates,
            feature.properties.width,
            feature.properties.height,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager
        );

        return {
            ...feature,
            geometry: this.geometry.generate(newCoordinates),
            properties: {
                ...feature.properties,
                selectionBox: newSelectionBox
            }
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const coords = feature.geometry.coordinates;
        return [
            coords[0] - referencePoint.lng,
            coords[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const newCoordinates = [newCoords.lng, newCoords.lat];

        // Recalculate selection box for new position
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            newCoordinates,
            feature.properties.width,
            feature.properties.height,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager
        );

        const updatedFeature = {
            ...feature,
            geometry: this.geometry.generate(newCoordinates),
            properties: {
                ...feature.properties,
                selectionBox: newSelectionBox
            }
        };

        return updatedFeature;
    }

    canMove(feature) {
        return !feature.properties?.bloqueado;
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.deselectFeature();
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_photo_red.svg' :
            './images/icon_photo_black.svg';
        $("#photo-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="PHOTO" />`);
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        this.selectFeature(feature);
    }

    onFeatureDeselected = (feature) => {
        const selectedFeature = this.getSelectedFeature();
        const featureId = feature.properties.id;
        if (selectedFeature && selectedFeature.properties.id === featureId) {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature) {
            this.deselectFeature();
        }
    }

    isEditingMode = () => {
        return false; // Images don't have edit handles
    }

    hasEditHandle = (featureId) => {
        return false; // Images don't have edit handles
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        // Images don't have edit handles, no action needed
    }

    selectFeature = (feature) => {
        // Images don't have edit handles, just selection feedback
        this.setupHoverListeners();
    }

    deselectFeature = () => {
        this.removeHoverListeners();
        this.map.getCanvas().style.cursor = '';
    }

    // ===== FILE UPLOAD SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for image');
            return;
        }

        // Trigger file upload dialog
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (event) => {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = () => {
                    const imageBase64 = reader.result;
                    this.addImageFeature(e.lngLat, imageBase64);
                };
                reader.readAsDataURL(file);
            }
        };
        input.click();
        this.toolManager.deactivateCurrentTool();
    }

    addImageFeature = async (lngLat, imageBase64) => {
        const imageId = IDUtils.generateUniqueId();

        this.resizeImage(imageBase64, async (resizedImageBase64, width, height) => {
            try {
                // Convert to blob and save to imageStore
                const response = await fetch(resizedImageBase64);
                const blob = await response.blob();
                await storeImage(imageId, blob);

                // Create feature with zoom-invariant properties
                const feature = this.createImageFeature(lngLat, imageId, width, height);

                // Set zoom properties
                const currentZoom = this.map.getZoom();
                feature.properties.createdAtZoom = currentZoom;
                feature.properties.calculatedSize = feature.properties.size;

                // Calculate selection box
                feature.properties.selectionBox = this.geometry.calculateSelectionBoxGeometry(
                    feature.geometry.coordinates,
                    feature.properties.width,
                    feature.properties.height,
                    feature.properties.size,
                    feature.properties.rotation,
                    feature.properties.createdAtZoom,
                    this.selectionManager.uiManager
                );

                feature.properties.nome = IDUtils.generateFeatureName('image', this.map);

                // Save to IndexedDB
                await addFeature('images', feature);

                // Add to map
                const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
                data.features.push(feature);
                this.map.getSource('images').setData(data);

                // Load image to map for rendering
                await this.loadImageToMap(imageId, blob);

                // Select the new feature
                this.selectionManager.toggleFeatureSelection('image', imageId, feature);
                this.selectionManager.updateUI();
            } catch (error) {
                console.error('Error adding image feature:', error);
                alert('Erro ao adicionar imagem');
            }
        });
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
            geometry: this.geometry.generate([lngLat.lng, lngLat.lat])
        };
    }

    // ===== IMAGE PROCESSING =====

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
                reject(new Error(`Failed to load image ${imageId}`));
            };

            setTimeout(() => {
                URL.revokeObjectURL(url);
                reject(new Error(`Timeout loading image ${imageId}`));
            }, 10000);

            image.src = url;
        });
    }

    // ===== ZOOM-INVARIANT SYSTEM =====

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
            feature.properties.calculatedSize = Math.min(feature.properties.size * scaleFactor, 10);
            return feature;
        });
    }

    updateAllImageSizes = () => {
        if (!this.map.getSource('images')) {
            this.pendingZoomUpdate = false;
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

    // ===== HOVER SYSTEM =====

    setupHoverListeners = () => {
        this.map.on('mousemove', this.onHoverMove);
    }

    removeHoverListeners = () => {
        this.map.off('mousemove', this.onHoverMove);
    }

    onHoverMove = (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const features = this.map.queryRenderedFeatures(e.point);
        const hasFeature = this.hasSelectedFeatureAtPoint(features);

        this.map.getCanvas().style.cursor = hasFeature ? 'move' : '';
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'images' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // Special handling for createdAtZoom
                if (property === 'createdAtZoom') {
                    const roundedValue = Math.round(value * 10) / 10;
                    sourceFeature.properties[property] = roundedValue;
                    feature.properties[property] = roundedValue;

                    const currentZoom = this.map.getZoom();
                    const zoomDifference = currentZoom - roundedValue;
                    const scaleFactor = Math.pow(2, zoomDifference);

                    const newCalculatedSize = Math.min(sourceFeature.properties.size * scaleFactor, 10);
                    sourceFeature.properties.calculatedSize = newCalculatedSize;
                    feature.properties.calculatedSize = newCalculatedSize;

                    this.ensureFeatureConsistency(sourceFeature, currentZoom, true);
                    feature.properties.selectionBox = sourceFeature.properties.selectionBox;
                } else {
                    // Recalculate selection box if intrinsic properties changed
                    const shouldRecalculateSelectionBox = ['size', 'rotation'].includes(property);

                    // Ensure consistency
                    this.ensureFeatureConsistency(sourceFeature, null, shouldRecalculateSelectionBox);

                    // Sync back
                    feature.properties.calculatedSize = sourceFeature.properties.calculatedSize;
                    feature.properties.selectionBox = sourceFeature.properties.selectionBox;
                }
            }
        }

        this.map.getSource('images').setData(data);

        // Update SelectionManager with fresh features
        this.updateSelectionManagerFeatures(features);
    }

    ensureFeatureConsistency = (feature, currentZoom = null, forceRecalculateSelectionBox = false) => {
        const zoom = currentZoom || this.map.getZoom();

        // Update calculatedSize
        const zoomDifference = zoom - feature.properties.createdAtZoom;
        const scaleFactor = Math.pow(2, zoomDifference);
        feature.properties.calculatedSize = Math.min(feature.properties.size * scaleFactor, 10);

        // Recalculate selection box if needed
        if (forceRecalculateSelectionBox || !feature.properties.selectionBox) {
            feature.properties.selectionBox = this.geometry.calculateSelectionBoxGeometry(
                feature.geometry.coordinates,
                feature.properties.width,
                feature.properties.height,
                feature.properties.size,
                feature.properties.rotation,
                feature.properties.createdAtZoom,
                this.selectionManager.uiManager
            );
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        // Always get fresh feature data from map source before saving
        const currentData = this.map.getSource('images')._data;
        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    // Use complete current feature (with updated geometry + properties)
                    await updateFeature('images', currentFeature);
                    hasChanges = true;
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            const initialProps = initialPropertiesMap.get(f.properties.id);
            Object.assign(f.properties, initialProps);
            f.geometry = this.geometry.generate(f.geometry.coordinates);
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;

                // Remove from imageStore
                await removeImage(featureId);

                // Remove from map images
                if (this.map.hasImage(featureId)) {
                    this.map.removeImage(featureId);
                }

                // Remove from storage
                await removeFeature('images', featureId);

                // Update map source
                const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('images').setData(data);
            } catch (error) {
                console.error(`Error removing image ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddImageControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.size !== initialProperties.size ||
            feature.properties.rotation !== initialProperties.rotation ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.createdAtZoom !== initialProperties.createdAtZoom ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.geometry.coordinates) !== JSON.stringify(initialProperties.coordinates)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
            const currentZoom = this.map.getZoom();

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    // Ensure consistency for updated feature
                    this.ensureFeatureConsistency(data.features[featureIndex], currentZoom, !onlyUpdateProperties);

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('images', featureToUpdate);
                    }
                }
            }

            this.map.getSource('images').setData(data);

            // Update SelectionManager with updated features
            this.updateSelectionManagerFeatures(features);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    /**
     * Update SelectionManager with current feature data
     */
    updateSelectionManagerFeature(feature) {
        const key = `image:${feature.properties.id}`;
        this.selectionManager.selectedFeatures.set(key, { type: 'image', feature });
    }

    /**
     * Update SelectionManager with multiple features
     */
    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'image') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    // ===== UTILITY METHODS =====

    setupBaseEventListeners = () => {
        // Base listeners setup if needed
    }

    removeAllEventListeners = () => {
        this.removeHoverListeners();

        if (this.zoomRafId) {
            cancelAnimationFrame(this.zoomRafId);
            this.zoomRafId = null;
        }
        this.pendingZoomUpdate = false;
    }
}

export default AddImageControl;