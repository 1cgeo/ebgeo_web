// Path: js/draw_tools/point_tool/add_point_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils } from '../../utilities';
import { addPointAttributesToPanel } from './point_attributes_panel.js';
import AddPointGeometry from './add_point_geometry.js';
import { BaseControl } from '../../tool_manager';
import { LABEL_ZOOM_PROPERTIES, recalcLabelSize } from '../../tool_manager/helpers/label-tab.helpers.js';
import { getSnappingService } from '../../snapping/snapping.service.js';
import { generatePointImage, needsPerFeatureImage } from './point-marker-symbols.js';
import { parseCustomMarker, registerCustomFeatureImage } from './point-custom-icons.js';
import { reanchorOnMove, translateOnPaste } from '@js/temporal/trajectory-anchor.js';

/** Maximum circle-radius (in pixels) for zoom-corrected points. */
const MAX_POINT_RADIUS = 500;

/** Maximum label text-size (in pixels) for zoom-corrected labels. */
const MAX_LABEL_SIZE = 255;

/** Properties that trigger size recalculation when changed. */
const SIZE_ZOOM_PROPERTIES = new Set(['sizeZoomCorrectionEnabled', 'sizeCreatedAtZoom', 'size']);

/** Properties that trigger selection box recalculation. */
const SELECTION_BOX_PROPERTIES = new Set(['sizeZoomCorrectionEnabled', 'sizeCreatedAtZoom', 'size', 'lineWidth']);

/** Properties that require per-feature image regeneration. */
const IMAGE_REGEN_PROPERTIES = new Set(['fillColor', 'lineColor', 'lineWidth', 'markerSymbol']);

/**
 * Recalculate calculatedSize based on current zoom and feature properties.
 * @param {Object} sourceFeature - Feature from the map source (mutated)
 * @param {Object} selectedFeature - Corresponding selected feature (mutated)
 * @param {number} currentZoom - Current map zoom level
 */
function recalcPointSize(sourceFeature, selectedFeature, currentZoom) {
    const size = sourceFeature.properties.size || 10;
    let newCalc;
    if (sourceFeature.properties.sizeZoomCorrectionEnabled === false) {
        newCalc = size;
    } else {
        const diff = currentZoom - (sourceFeature.properties.sizeCreatedAtZoom || 0);
        newCalc = Math.min(size * Math.pow(2, diff), MAX_POINT_RADIUS);
    }
    sourceFeature.properties.calculatedSize = newCalc;
    selectedFeature.properties.calculatedSize = newCalc;
}

/**
 * Register a per-feature built-in marker image (shape/icon with baked-in colors),
 * keyed by feature id, using feature properties with default fallbacks.
 * @param {Object} map - MapLibre map instance
 * @param {Object} props - Feature properties (id, markerSymbol, colors)
 */
function registerImageFromProps(map, props) {
    const defaults = AddPointControl.DEFAULT_PROPERTIES;
    const imageData = generatePointImage(
        props.markerSymbol,
        props.fillColor || defaults.fillColor,
        props.lineColor || defaults.lineColor,
        // ?? not || so a valid lineWidth of 0 ("no border") is preserved.
        props.lineWidth ?? defaults.lineWidth,
    );
    if (map.hasImage(props.id)) {
        map.removeImage(props.id);
    }
    map.addImage(props.id, imageData, { pixelRatio: 2 });
}

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
        // Size zoom correction
        sizeZoomCorrectionEnabled: true,
        sizeCreatedAtZoom: 0,
        calculatedSize: 10,
        selectionBox: null,
    };

    // ===== MAPBOX CONTROL INTERFACE =====

    // ===== ZOOM CORRECTION (size + label) =====
    #zoomPending = false;
    #zoomRafId = null;

    #handleZoom = () => {
        if (this.#zoomPending) return;
        this.#zoomPending = true;
        this.#zoomRafId = requestAnimationFrame(async () => {
            const source = this.map?.getSource('points');
            if (!source) { this.#zoomPending = false; return; }

            const currentZoom = this.map.getZoom();
            const data = await source.getData();
            let hasChanges = false;

            for (const feature of data.features) {
                const props = feature.properties;

                // Size zoom correction
                const size = props.size || 10;
                let newCalcSize;
                if (props.sizeZoomCorrectionEnabled === false) {
                    newCalcSize = size;

                    // Recalculate selection box for features with zoom correction disabled
                    const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
                        feature.geometry.coordinates,
                        size,
                        props.lineWidth || 0,
                        props.sizeCreatedAtZoom || 0,
                        currentZoom
                    );
                    props.selectionBox = newSelectionBox;
                    hasChanges = true;
                } else {
                    const diff = currentZoom - (props.sizeCreatedAtZoom || 0);
                    newCalcSize = Math.min(size * Math.pow(2, diff), MAX_POINT_RADIUS);
                }
                if (props.calculatedSize !== newCalcSize) {
                    props.calculatedSize = newCalcSize;
                    hasChanges = true;
                }

                // Label zoom correction
                if (props.showLabel) {
                    if (!props.labelCreatedAtZoom) {
                        props.labelCreatedAtZoom = currentZoom;
                        hasChanges = true;
                    }
                    const labelSize = props.labelSize || 14;
                    let newCalcLabel;
                    if (props.labelZoomCorrectionEnabled === false) {
                        newCalcLabel = labelSize;
                    } else {
                        const diff = currentZoom - props.labelCreatedAtZoom;
                        newCalcLabel = Math.min(labelSize * Math.pow(2, diff), MAX_LABEL_SIZE);
                    }
                    if (props.labelCalculatedSize !== newCalcLabel) {
                        props.labelCalculatedSize = newCalcLabel;
                        hasChanges = true;
                    }
                }
            }

            if (hasChanges) {
                source.setData(data);

                // Sync selected point features and refresh selection highlight
                const selectedPoints = this.selectionManager?.getSelectedFeaturesByType?.('point');
                if (selectedPoints?.length > 0) {
                    for (const { id, feature: selFeature } of selectedPoints) {
                        const srcFeature = data.features.find(f => String(f.properties.id) === String(id));
                        if (srcFeature) {
                            selFeature.properties.calculatedSize = srcFeature.properties.calculatedSize;
                            if (srcFeature.properties.labelCalculatedSize !== undefined) {
                                selFeature.properties.labelCalculatedSize = srcFeature.properties.labelCalculatedSize;
                            }
                            if (srcFeature.properties.sizeZoomCorrectionEnabled === false) {
                                selFeature.properties.selectionBox = srcFeature.properties.selectionBox;
                                if (this.selectionManager.uiManager?.invalidateCache) {
                                    this.selectionManager.uiManager.invalidateCache(id);
                                }
                            }
                        }
                    }
                    this.selectionManager.uiManager?.updateSelectionHighlight();
                }
            }
            this.#zoomPending = false;
        });
    };

    onAdd = (map) => {
        this.map = map;
        map.on('zoom', this.#handleZoom);
    }

    onRemove = () => {
        if (this.map) {
            this.map.off('zoom', this.#handleZoom);
        }
        if (this.#zoomRafId) {
            cancelAnimationFrame(this.#zoomRafId);
            this.#zoomRafId = null;
        }
        this.deactivate();
        this.removeAllEventListeners();
        this.map = undefined;
    }

    // ===== ZOOM CORRECTION (initial load) =====

    /**
     * Apply zoom corrections to point features loaded from persistence.
     * Called by setupPointLayers to ensure calculatedSize and labelCalculatedSize
     * match the current zoom level on load (mirrors image/military symbol pattern).
     * @param {Array} features - Point GeoJSON features
     * @returns {Array} Features with corrected calculatedSize/labelCalculatedSize
     */
    applyZoomCorrections = (features) => {
        if (!features || !Array.isArray(features)) return [];
        const currentZoom = this.map.getZoom();

        return features.map(feature => {
            const props = feature.properties;
            const size = props.size || 10;

            let calculatedSize;
            if (props.sizeZoomCorrectionEnabled === false) {
                calculatedSize = size;
            } else {
                const diff = currentZoom - (props.sizeCreatedAtZoom || 0);
                calculatedSize = Math.min(size * Math.pow(2, diff), MAX_POINT_RADIUS);
            }

            let labelCalculatedSize = props.labelCalculatedSize;
            if (props.showLabel) {
                const labelSize = props.labelSize || 14;
                if (props.labelZoomCorrectionEnabled === false) {
                    labelCalculatedSize = labelSize;
                } else {
                    const diff = currentZoom - (props.labelCreatedAtZoom || currentZoom);
                    labelCalculatedSize = Math.min(labelSize * Math.pow(2, diff), MAX_LABEL_SIZE);
                }
            }

            return {
                ...feature,
                properties: {
                    ...props,
                    calculatedSize,
                    labelCalculatedSize,
                },
            };
        });
    };

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
        // A moving (trajectory) feature is displaced from its authored position, so
        // the stored selectionBox (computed at home) no longer matches — recompute
        // from the current displayed coordinates instead.
        const moving = Array.isArray(feature.properties.trajetoria) && feature.properties.trajetoria.length >= 2;
        if (feature.properties.selectionBox && !moving) {
            return { geometry: feature.properties.selectionBox };
        }

        const effectiveZoom = feature.properties.sizeZoomCorrectionEnabled === false ? this.map.getZoom() : null;
        const selectionBox = this.geometry.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.size || 10,
            feature.properties.lineWidth || 0,
            feature.properties.sizeCreatedAtZoom || 0,
            effectiveZoom
        );

        return { geometry: selectionBox };
    }

    getSelectionBoxStrategy() {
        return 'preCalculated';
    }

    getSelectionBoxPadding() {
        return 5;
    }

    getLayerIds() {
        return ['point-layer', 'point-marker-layer', 'point-label-layer'];
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

        const effectiveZoom = feature.properties.sizeZoomCorrectionEnabled === false ? this.map.getZoom() : null;
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            newCoordinates,
            feature.properties.size || 10,
            feature.properties.lineWidth || 0,
            feature.properties.sizeCreatedAtZoom || 0,
            effectiveZoom
        );

        // Pasting copies the feature somewhere else, so the WHOLE trajectory
        // travels by the same delta (re-anchoring, which only moves kp 0, would
        // leave the copy's route running back to the original one).
        const anchorPatch = translateOnPaste(feature.properties, offset.dx, offset.dy);

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            },
            properties: {
                ...feature.properties,
                ...(anchorPatch || null),
                selectionBox: newSelectionBox,
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

        const effectiveZoom = feature.properties.sizeZoomCorrectionEnabled === false ? this.map.getZoom() : null;
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            newCoordinates,
            feature.properties.size || 10,
            feature.properties.lineWidth || 0,
            feature.properties.sizeCreatedAtZoom || 0,
            effectiveZoom
        );

        // Moving a trajectory feature relocates its anchor (kp 0 = the start position).
        const anchorPatch = reanchorOnMove(feature.properties, newCoordinates, feature.geometry.coordinates);

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            },
            properties: {
                ...feature.properties,
                ...(anchorPatch || null),
                selectionBox: newSelectionBox,
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

    syncEditHandlesAfterDrag = async (movedFeatures) => {
        if (!movedFeatures?.length) return;

        const data = await this.map.getSource('points').getData();
        let hasChanges = false;

        for (const inputFeature of movedFeatures) {
            if (inputFeature.properties.source !== 'point') continue;

            const sourceFeature = data.features.find(
                f => f.properties.id === inputFeature.properties.id
            );
            if (!sourceFeature) continue;

            const effectiveZoom = sourceFeature.properties.sizeZoomCorrectionEnabled === false
                ? this.map.getZoom() : null;
            const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
                sourceFeature.geometry.coordinates,
                sourceFeature.properties.size || 10,
                sourceFeature.properties.lineWidth || 0,
                sourceFeature.properties.sizeCreatedAtZoom || 0,
                effectiveZoom
            );
            sourceFeature.properties.selectionBox = newSelectionBox;
            hasChanges = true;
        }

        if (hasChanges) {
            this.map.getSource('points').setData(data);
            this.updateSelectionManagerFeatures(movedFeatures);
            this.selectionManager.uiManager?.invalidateCache?.();
            this.selectionManager.uiManager?.updateSelectionHighlight?.();
        }
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
     * @param {Object} [propertyOverrides] - Property overrides merged over defaults (e.g. nome, fillColor, size, attributes)
     * @returns {Promise<Object|null>} Created feature or null if error
     */
    createPointAtCoordinates = async (lng, lat, propertyOverrides = {}) => {
        const coordinates = [lng, lat];

        if (!this.geometry.validate(coordinates)) {
            console.warn('Invalid coordinates for point');
            return null;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = propertyOverrides.nome
            || await IDUtils.generateFeatureName('point', this.map);

        const currentZoom = this.map.getZoom();
        const baseProps = { ...AddPointControl.DEFAULT_PROPERTIES, ...propertyOverrides };
        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...baseProps,
                layerId: getActiveLayerIdSync(),
                id: featureId,
                nome: featureName,
                labelCreatedAtZoom: currentZoom,
                labelCalculatedSize: baseProps.labelSize,
                sizeCreatedAtZoom: currentZoom,
                calculatedSize: baseProps.size,
            },
            geometry: this.geometry.generate(coordinates)
        };

        feature.properties.selectionBox = this.geometry.calculateSelectionBoxGeometry(
            coordinates,
            baseProps.size,
            baseProps.lineWidth,
            currentZoom
        );

        // Register per-feature image (custom icon, built-in shape/icon, or none)
        await this._applyMarkerImage(feature.properties);

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

    /**
     * Register or clean up the per-feature marker image for a point's current
     * marker. Custom icons ('custom:<id>') register the uploaded image (async);
     * built-in non-circle markers bake a per-feature image; circle markers clear
     * any leftover image.
     * @param {Object} props - Feature properties (must include id + markerSymbol)
     */
    _applyMarkerImage = async (props) => {
        const iconId = parseCustomMarker(props.markerSymbol);
        if (iconId) {
            const registered = await registerCustomFeatureImage(this.map, props.id, iconId);
            // Blob missing/undecodable: drop any stale per-feature image so the point
            // doesn't keep rendering the previous marker.
            if (!registered && this.map.hasImage(props.id)) {
                this.map.removeImage(props.id);
            }
        } else if (needsPerFeatureImage(props.markerSymbol)) {
            registerImageFromProps(this.map, props);
        } else if (this.map.hasImage(props.id)) {
            this.map.removeImage(props.id);
        }
    }

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

                if (SIZE_ZOOM_PROPERTIES.has(property)) {
                    recalcPointSize(sourceFeature, feature, this.map.getZoom());
                }

                if (SELECTION_BOX_PROPERTIES.has(property)) {
                    const effectiveZoom = sourceFeature.properties.sizeZoomCorrectionEnabled === false
                        ? this.map.getZoom() : null;
                    const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
                        sourceFeature.geometry.coordinates,
                        sourceFeature.properties.size || 10,
                        sourceFeature.properties.lineWidth || 0,
                        sourceFeature.properties.sizeCreatedAtZoom || 0,
                        effectiveZoom
                    );
                    sourceFeature.properties.selectionBox = newSelectionBox;
                    feature.properties.selectionBox = newSelectionBox;
                }

                // Regenerate per-feature image when visual properties change
                if (IMAGE_REGEN_PROPERTIES.has(property)) {
                    await this._applyMarkerImage(sourceFeature.properties);
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

        // Regenerate per-feature images after discarding changes
        for (const feature of features) {
            await this._applyMarkerImage(feature.properties);
        }

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        // Clean up per-feature images
        for (const feature of features) {
            const featureId = feature.properties.id;
            if (this.map.hasImage(featureId)) {
                this.map.removeImage(featureId);
            }
        }

        // Remove from store
        for (const feature of features) {
            try {
                await removeFeature('points', feature.properties.id);
            } catch (error) {
                console.error(`Error removing point ${feature.properties.id}:`, error);
            }
        }

        // Single source read/write
        const data = await this.map.getSource('points').getData();
        const idsToDelete = new Set(features.map(f => String(f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
        this.map.getSource('points').setData(data);
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
            props.markerSymbol !== initialProperties.markerSymbol ||
            props.sizeZoomCorrectionEnabled !== initialProperties.sizeZoomCorrectionEnabled ||
            props.sizeCreatedAtZoom !== initialProperties.sizeCreatedAtZoom
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
                        const prevLabelCalcSize = data.features[featureIndex].properties.labelCalculatedSize;
                        const prevCalcSize = data.features[featureIndex].properties.calculatedSize;
                        data.features[featureIndex] = feature;
                        if (prevLabelCalcSize !== undefined && feature.properties.labelCalculatedSize === undefined) {
                            feature.properties.labelCalculatedSize = prevLabelCalcSize;
                        }
                        if (prevCalcSize !== undefined && feature.properties.calculatedSize === undefined) {
                            feature.properties.calculatedSize = prevCalcSize;
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
