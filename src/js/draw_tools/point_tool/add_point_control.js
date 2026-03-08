// Path: js/draw_tools/point_tool/add_point_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils } from '../../utilities';
import { addPointAttributesToPanel } from './point_attributes_panel.js';
import AddPointGeometry from './add_point_geometry.js';
import { BaseControl } from '../../tool_manager';
import { LABEL_ZOOM_PROPERTIES, recalcLabelSize, createLabelZoomHandler } from '../../tool_manager/helpers/label-tab.helpers.js';
import { getSnappingService } from '../../snapping/snapping.service.js';
import { loadMarkerImages } from './point-marker-symbols.js';

class AddPointControl extends BaseControl {
    featureType = 'point';
    constructor(toolManager) {
        super(toolManager);
        this.geometry = new AddPointGeometry();
    }

    static DEFAULT_PROPERTIES = {
        fillColor: '#3f4fb5',
        lineColor: '#000000',
        lineWidth: 0,
        size: 10,
        opacity: 1,
        source: 'point',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false,
        // Label properties (matching 3D marker pattern)
        showLabel: false,
        labelText: '',
        labelColor: '#ffffff',
        labelSize: 14,
        labelOutlineColor: '#000000',
        labelOutlineWidth: 2,
        // Label zoom correction properties
        labelCreatedAtZoom: 0,
        labelCalculatedSize: 14,
        labelZoomCorrectionEnabled: true,
        // Marker symbol
        markerSymbol: 'circle',
    };

    // ===== SINGLE SOURCE OF TRUTH =====

    // ===== MAPBOX CONTROL INTERFACE =====

    // ===== LABEL ZOOM CORRECTION =====
    #labelZoom = createLabelZoomHandler(() => this.map, 'points');

    onAdd = (map) => {
        this.map = map;
        map.on('zoom', this.#labelZoom.handler);
        loadMarkerImages(map);
    }

    onRemove = () => {
        if (this.map) {
            this.map.off('zoom', this.#labelZoom.handler);
        }
        this.#labelZoom.cleanup();
        this.deactivate();
        this.removeAllEventListeners();
        this.map = undefined;
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'point-attributes-section';

        try {
            addPointAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating point attribute panel:', error);
        }
    }

    getDragSources() {
        return ['points'];
    }

    getEditHandleSources() {
        return [];
    }

    createSelectionBox(feature) {
        try {
            const coordinates = feature.geometry.coordinates;
            const zoom = this.map.getZoom();
            const paddingPixels = this.getSelectionBoxPadding();

            return this.geometry.createSelectionBoxGeometry(coordinates, paddingPixels, zoom);
        } catch (error) {
            console.warn('Error creating point selection box:', error);
            return null;
        }
    }

    getSelectionBoxStrategy() {
        return 'custom';
    }

    getSelectionBoxPadding() {
        return 15;
    }

    getLayerIds() {
        return ['point-layer', 'point-symbol-layer', 'point-label-layer'];
    }

    getSourceNames() {
        return ['points'];
    }

    getEditHandleSource() {
        return null;
    }

    canCopy(_feature) {
        return true;
    }

    canPaste(_feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const newCoordinates = this.geometry.applyOffset(
            feature.geometry.coordinates,
            offset.dx,
            offset.dy
        );

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            }
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const centerPoint = this.geometry.getCenter(feature.geometry.coordinates);
        if (!centerPoint) {
            return [0, 0];
        }

        return [
            centerPoint[0] - referencePoint.lng,
            centerPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, _newCoords) {
        const newCoordinates = this.geometry.applyOffset(
            feature.geometry.coordinates,
            dx,
            dy
        );

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            }
        };
    }

    canMove(feature) {
        return !feature.properties?.bloqueado;
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('mousemove', this._onPreClickMouseMove);
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.map.off('mousemove', this._onPreClickMouseMove);
        getSnappingService()?.hideIndicator(this.map);
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (_feature) => {
    }

    onFeatureDeselected = (_feature) => {
    }

    onGlobalDeselect = () => {
    }

    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (_featureId) => {
        return false;
    }

    syncEditHandlesAfterDrag = (_movedFeatures) => {
    }

    // ===== DRAWING SYSTEM =====

    _onPreClickMouseMove = (e) => {
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }
    }

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for point');
            return;
        }

        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
        if (snap.snapped) {
            snapping.hideIndicator(this.map);
        }

        await this.createPointAtCoordinates(snap.lng, snap.lat);
    }

    /**
     * Create point at specific coordinates
     * @param {number} lng - Longitude
     * @param {number} lat - Latitude
     * @returns {Promise<Object|null>} Created feature or null if error
     */
    createPointAtCoordinates = async (lng, lat) => {
        const coordinates = [lng, lat];

        if (!this.geometry.validate(coordinates)) {
            console.warn('Invalid coordinates for point');
            return null;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('point', this.map);

        const currentZoom = this.map.getZoom();
        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...AddPointControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                id: featureId,
                nome: featureName,
                labelCreatedAtZoom: currentZoom,
                labelCalculatedSize: AddPointControl.DEFAULT_PROPERTIES.labelSize,
            },
            geometry: this.geometry.generate(coordinates)
        };

        try {
            await addFeature('points', feature);

            const data = await this.map.getSource('points').getData();
            data.features.push(feature);
            this.map.getSource('points').setData(data);

            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('point', featureId, feature);
            this.selectionManager.updateUI();

            return feature;
        } catch (error) {
            console.error('Error creating point:', error);
            return null;
        }
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('points').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (LABEL_ZOOM_PROPERTIES.has(property)) {
                    recalcLabelSize(sourceFeature, feature, this.map.getZoom());
                }
            }
        }

        this.map.getSource('points').setData(data);

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            return sourceFeature || feature;
        });

        this.updateSelectionManagerFeatures(freshFeatures);
    }


    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('points').getData();

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('points', currentFeature);
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
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('points', featureId);
                const data = await this.map.getSource('points').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('points').setData(data);
            } catch (error) {
                console.error(`Error removing point ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddPointControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        const props = feature.properties;
        return (
            props.fillColor !== initialProperties.fillColor ||
            props.lineColor !== initialProperties.lineColor ||
            props.lineWidth !== initialProperties.lineWidth ||
            props.size !== initialProperties.size ||
            props.opacity !== initialProperties.opacity ||
            props.nome !== initialProperties.nome ||
            props.descricao !== initialProperties.descricao ||
            props.visivel !== initialProperties.visivel ||
            props.bloqueado !== initialProperties.bloqueado ||
            props.showLabel !== initialProperties.showLabel ||
            props.labelText !== initialProperties.labelText ||
            props.labelColor !== initialProperties.labelColor ||
            props.labelSize !== initialProperties.labelSize ||
            props.labelOutlineColor !== initialProperties.labelOutlineColor ||
            props.labelOutlineWidth !== initialProperties.labelOutlineWidth ||
            props.labelZoomCorrectionEnabled !== initialProperties.labelZoomCorrectionEnabled ||
            props.labelCreatedAtZoom !== initialProperties.labelCreatedAtZoom ||
            props.markerSymbol !== initialProperties.markerSymbol
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('points').getData();
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        const prevCalcSize = data.features[featureIndex].properties.labelCalculatedSize;
                        data.features[featureIndex] = feature;
                        if (prevCalcSize !== undefined) {
                            feature.properties.labelCalculatedSize = prevCalcSize;
                        }
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('points', featureToUpdate);
                    }
                }
            }

            this.map.getSource('points').setData(data);

            this.updateSelectionManagerFeatures(features);
        }
    }
    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('point', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'point') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    // ===== UTILITY METHODS =====

    setupBaseEventListeners = () => {
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this._onPreClickMouseMove);
    }
}

export default AddPointControl;
