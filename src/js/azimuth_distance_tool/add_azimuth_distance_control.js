// Path: js/azimuth_distance_tool/add_azimuth_distance_control.js

/**
 * @fileoverview Azimuth and Distance Tool Control.
 * Manages the tool activation, map interaction, and feature creation.
 *
 * @module azimuth_distance_tool/add_azimuth_distance_control
 */

import { BaseControl } from '../tool_manager/index.js';
import { AzimuthDistancePanel } from './azimuth_distance_panel.js';
import { generateFeature, generatePointFeatures, calculateWaypoints } from './azimuth_distance_geometry.js';
import { addAzimuthDistanceAttributesToPanel } from './azimuth_distance_attributes_panel.js';
import {
    DEFAULT_PROPERTIES,
    OUTPUT_MODE,
    MODE_TO_SOURCE,
    NORTH_REFERENCE,
    COLORS
} from './azimuth_distance_constants.js';
import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync, getControl } from '../store/index.js';
import { IDUtils } from '../utilities/index.js';
import { showCoordinateEditModal } from '../modals/coordinate-edit.modal.js';
import { showConfirm } from '../modals/confirm.modal.js';

/**
 * Azimuth and Distance Tool Control.
 * Extends BaseControl to manage polar construction of geometries.
 */
class AddAzimuthDistanceControl extends BaseControl {
    /**
     * Tool type identifier for StateManager/toolbar integration.
     * @type {string}
     */
    type = 'azimuth_distance';

    constructor(toolManager) {
        super(toolManager);

        this._panel = null;
        this._isWaitingForMapClick = false;
        this._previewFeature = null;
        this._referenceMarker = null;

        // Bind methods
        this._handleMapClick = this._handleMapClick.bind(this);
        this._handleKeyDown = this._handleKeyDown.bind(this);
    }

    // =========================================================================
    // DEFAULT PROPERTIES
    // =========================================================================

    static DEFAULT_PROPERTIES = { ...DEFAULT_PROPERTIES };

    // =========================================================================
    // MAPBOX CONTROL INTERFACE
    // =========================================================================

    onAdd = (map) => {
        this.map = map;
        return document.createElement('div');
    }

    onRemove = () => {
        this.deactivate();
        this.map = undefined;
    }

    // =========================================================================
    // TOOL-CENTRIC INTERFACE IMPLEMENTATIONS
    // =========================================================================

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'azimuth-distance-attributes-section';

        try {
            addAzimuthDistanceAttributesToPanel(
                sectionPanel,
                features,
                this,
                selectionManager,
                uiManager,
                options
            );
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating azimuth distance attribute panel:', error);
        }
    }

    getDragSources() {
        // Returns sources that this control can drag
        return ['points', 'lines', 'polygons'];
    }

    getEditHandleSources() {
        return [];
    }

    getLayerIds() {
        return ['point-layer', 'line-layer', 'polygon-fill-layer', 'polygon-layer'];
    }

    getSourceNames() {
        return ['points', 'lines', 'polygons'];
    }

    canMove(feature) {
        return feature.properties?.featureType === 'azimuth_distance' && !feature.properties?.bloqueado;
    }

    // =========================================================================
    // TOOL ACTIVATION/DEACTIVATION
    // =========================================================================

    activate = () => {
        this.isActive = true;
        this._showPanel();
        this._setupEventListeners();

        // Enter map click mode by default
        this._enterMapClickMode();
    }

    deactivate = () => {
        this.isActive = false;
        this._exitMapClickMode();
        this._removeEventListeners();
        this._hidePanel();
        this._clearPreview();
        this._removeReferenceMarker();
    }

    // =========================================================================
    // REFERENCE POINT MARKER
    // =========================================================================

    /**
     * Create and show a marker at the reference point.
     * @param {number} lng - Longitude
     * @param {number} lat - Latitude
     * @private
     */
    _showReferenceMarker(lng, lat) {
        this._removeReferenceMarker();

        // Create custom marker element
        const el = document.createElement('div');
        el.className = 'azimuth-reference-marker';
        el.style.cssText = `
            width: 24px;
            height: 24px;
            background: ${COLORS.primary600};
            border: 3px solid ${COLORS.white};
            border-radius: 50%;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            cursor: pointer;
            position: relative;
        `;

        // Add inner crosshair
        const crosshair = document.createElement('div');
        crosshair.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 8px;
            height: 8px;
            border: 2px solid ${COLORS.white};
            border-radius: 50%;
        `;
        el.appendChild(crosshair);

        // Create MapLibre marker
        this._referenceMarker = new maplibregl.Marker({
            element: el,
            anchor: 'center'
        })
            .setLngLat([lng, lat])
            .addTo(this.map);
    }

    /**
     * Remove the reference point marker.
     * @private
     */
    _removeReferenceMarker() {
        if (this._referenceMarker) {
            this._referenceMarker.remove();
            this._referenceMarker = null;
        }
    }

    // =========================================================================
    // PANEL MANAGEMENT
    // =========================================================================

    _showPanel() {
        // Create panel content
        this._panel = new AzimuthDistancePanel({
            onCreateFeature: (state) => this._createFeature(state),
            onCancel: () => this._handleCancel(),
            onRequestMapClick: () => this._enterMapClickMode(),
            onEditCoordinates: (lat, lng) => this._openCoordinateModal(lat, lng),
            onStateChange: (state) => this._updatePreview(state),
            onResetReferencePoint: () => this._removeReferenceMarker()
        });

        const panelContent = this._panel.render();

        // Get the SidebarControl and show the panel
        const sidebarControl = getControl('sidebarControl');
        if (sidebarControl && sidebarControl.showToolPanel) {
            // Use the new public method to show custom panel content
            sidebarControl.showToolPanel(
                panelContent,
                'Azimute e Distância',
                // Cleanup function
                () => {
                    if (this._panel) {
                        this._panel.destroy();
                        this._panel = null;
                    }
                },
                // onClose callback - deactivate tool when panel is closed by user
                () => {
                    this.toolManager?.deactivateCurrentTool();
                }
            );
        } else {
            // Fallback: find feature panel directly
            const featurePanel = document.querySelector('.feature-panel');
            if (featurePanel) {
                const contentContainer = featurePanel.querySelector('.feature-panel-content');
                if (contentContainer) {
                    contentContainer.innerHTML = '';
                    contentContainer.appendChild(panelContent);
                    featurePanel.dataset.expanded = 'true';
                }
            }
        }
    }

    _hidePanel() {
        if (this._panel) {
            this._panel.destroy();
            this._panel = null;
        }

        // Hide using SidebarControl
        const sidebarControl = getControl('sidebarControl');
        if (sidebarControl && sidebarControl.hideToolPanel) {
            // Don't save changes, and don't trigger onClose (we're already deactivating)
            sidebarControl.hideToolPanel(false, false);
        } else {
            // Fallback
            const featurePanel = document.querySelector('.feature-panel');
            if (featurePanel) {
                featurePanel.dataset.expanded = 'false';
            }
        }
    }

    // =========================================================================
    // MAP CLICK MODE
    // =========================================================================

    _enterMapClickMode() {
        this._isWaitingForMapClick = true;
        this.map.getCanvas().style.cursor = 'crosshair';
    }

    _exitMapClickMode() {
        this._isWaitingForMapClick = false;
        this.map.getCanvas().style.cursor = '';
    }

    // =========================================================================
    // EVENT LISTENERS
    // =========================================================================

    _setupEventListeners() {
        this.map.on('click', this._handleMapClick);
        document.addEventListener('keydown', this._handleKeyDown);
    }

    _removeEventListeners() {
        this.map.off('click', this._handleMapClick);
        document.removeEventListener('keydown', this._handleKeyDown);
    }

    _handleMapClick(e) {
        if (!this.isActive || !this._isWaitingForMapClick) return;

        const { lng, lat } = e.lngLat;

        // Set reference point in panel
        if (this._panel) {
            this._panel.setReferencePoint(lng, lat);
        }

        // Show marker at reference point
        this._showReferenceMarker(lng, lat);

        // Exit map click mode after setting point
        this._exitMapClickMode();
    }

    _handleKeyDown(e) {
        if (!this.isActive) return;

        if (e.key === 'Escape') {
            this._handleCancel();
        }
    }

    // =========================================================================
    // COORDINATE MODAL
    // =========================================================================

    _openCoordinateModal(lat, lng) {
        showCoordinateEditModal({
            lat: lat || 0,
            lng: lng || 0,
            currentFormat: 'latlong',
            onConfirm: (newLat, newLng) => {
                if (this._panel) {
                    this._panel.setReferencePoint(newLng, newLat);
                }
                // Update marker position
                this._showReferenceMarker(newLng, newLat);
            }
        });
    }

    // =========================================================================
    // PREVIEW (on map)
    // =========================================================================

    _updatePreview(state) {
        if (!state || !state.referencePoint) {
            this._clearPreview();
            return;
        }

        // Calculate waypoints
        const declination = state.northReference === NORTH_REFERENCE.MAGNETIC
            ? state.magneticDeclination : 0;

        const waypoints = calculateWaypoints(
            state.referencePoint,
            state.legs,
            declination,
            state.northReference,
            state.angularUnit,
            state.distanceUnit
        );

        if (waypoints.length < 1) {
            this._clearPreview();
            return;
        }

        // Generate preview based on mode
        switch (state.outputMode) {
            case OUTPUT_MODE.POINT:
                // Show all waypoints as MultiPoint for preview
                if (waypoints.length >= 1) {
                    this._showPreview({
                        type: 'MultiPoint',
                        coordinates: waypoints
                    }, state.outputMode);
                }
                break;
            case OUTPUT_MODE.ROUTE:
                if (waypoints.length >= 2) {
                    this._showPreview({
                        type: 'LineString',
                        coordinates: waypoints
                    }, state.outputMode);
                } else {
                    this._clearPreview();
                }
                break;
            case OUTPUT_MODE.AREA:
                if (waypoints.length >= 3) {
                    this._showPreview({
                        type: 'Polygon',
                        coordinates: [[...waypoints, waypoints[0]]]
                    }, state.outputMode);
                } else {
                    this._clearPreview();
                }
                break;
        }
    }

    _showPreview(geometry, outputMode) {
        // Clear all previews first
        this._clearPreview();

        // Use appropriate feedback source based on output mode
        const feedbackSource = this._getFeedbackSource(outputMode);
        if (!feedbackSource) return;

        const source = this.map.getSource(feedbackSource);
        if (source) {
            // For MultiPoint (point mode), create individual point features
            if (geometry.type === 'MultiPoint') {
                const features = geometry.coordinates.map((coord, index) => ({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: coord
                    },
                    properties: {
                        isPreview: true,
                        fillColor: DEFAULT_PROPERTIES.fillColor || '#16a34a',
                        size: 10,
                        opacity: 0.7,
                        pointIndex: index
                    }
                }));

                source.setData({
                    type: 'FeatureCollection',
                    features
                });
            } else {
                source.setData({
                    type: 'Feature',
                    geometry,
                    properties: {
                        isPreview: true,
                        lineColor: DEFAULT_PROPERTIES.strokeColor || '#16a34a',
                        lineWidth: outputMode === OUTPUT_MODE.ROUTE ? 5 : 2,
                        fillColor: DEFAULT_PROPERTIES.fillColor || '#16a34a',
                        opacity: outputMode === OUTPUT_MODE.ROUTE ? 0.7 : 0.3
                    }
                });
            }
        }
    }

    _clearPreview() {
        // Clear all possible feedback sources
        ['point-feedback', 'line-feedback', 'polygon-feedback'].forEach(sourceName => {
            const source = this.map.getSource(sourceName);
            if (source) {
                source.setData({ type: 'FeatureCollection', features: [] });
            }
        });
    }

    _getFeedbackSource(outputMode) {
        switch (outputMode) {
            case OUTPUT_MODE.POINT:
                return 'point-feedback';
            case OUTPUT_MODE.ROUTE:
                return 'line-feedback';
            case OUTPUT_MODE.AREA:
                return 'polygon-feedback';
            default:
                return null;
        }
    }

    // =========================================================================
    // FEATURE CREATION
    // =========================================================================

    async _createFeature(state) {
        const layerId = getActiveLayerIdSync();

        // Calculate waypoints first
        const declination = state.northReference === NORTH_REFERENCE.MAGNETIC
            ? state.magneticDeclination : 0;

        const waypoints = calculateWaypoints(
            state.referencePoint,
            state.legs,
            declination,
            state.northReference,
            state.angularUnit,
            state.distanceUnit
        );

        if (waypoints.length === 0) {
            await showConfirm('Erro ao criar geometria', {
                message: 'Não foi possível calcular os pontos. Verifique os dados.',
                confirmText: 'OK'
            });
            return;
        }

        try {
            // Handle different output modes
            if (state.outputMode === OUTPUT_MODE.POINT) {
                // POINT MODE: Create multiple point features
                await this._createPointFeatures(state, waypoints, layerId);
            } else {
                // ROUTE or AREA MODE: Create single line or polygon feature
                await this._createLineOrPolygonFeature(state, layerId);
            }

            // Clear preview
            this._clearPreview();

            // Deactivate tool
            this.toolManager.deactivateCurrentTool();

        } catch (error) {
            console.error('Error creating azimuth/distance feature:', error);
            await showConfirm('Erro ao criar geometria', {
                message: 'Ocorreu um erro ao salvar a geometria.',
                confirmText: 'OK'
            });
        }
    }

    /**
     * Create multiple point features (Point mode).
     * @private
     */
    async _createPointFeatures(state, waypoints, layerId) {
        // Store polar data for reference
        const storedLegs = state.legs.map(leg => ({
            azimuth: leg.azimuth,
            distance: leg.distance,
            observation: leg.observation || ''
        }));

        const polarData = {
            referencePoint: state.referencePoint,
            outputMode: state.outputMode,
            angularUnit: state.angularUnit,
            distanceUnit: state.distanceUnit,
            northReference: state.northReference,
            magneticDeclination: state.magneticDeclination,
            legs: storedLegs
        };

        // Generate point features
        const features = await generatePointFeatures({
            waypoints,
            generateIds: () => IDUtils.generateFeatureIds(),
            generateName: () => IDUtils.generateFeatureName('point', this.map),
            layerId,
            style: {
                fillColor: DEFAULT_PROPERTIES.fillColor || '#16a34a',
                size: 10,
                opacity: 1
            },
            polarData
        });

        if (features.length === 0) {
            await showConfirm('Erro ao criar pontos', {
                message: 'Não foi possível criar os pontos.',
                confirmText: 'OK'
            });
            return;
        }

        // Add all points to store and map
        const source = this.map.getSource('points');
        if (source) {
            const data = await source.getData();

            for (const feature of features) {
                await addFeature('points', feature);
                data.features.push(feature);
            }

            source.setData(data);
        }

        // Select the last created point
        const lastFeature = features[features.length - 1];
        await this.selectionManager.toggleFeatureSelection('point', lastFeature.properties.id, lastFeature);
        this.selectionManager.updateUI();

    }

    /**
     * Create line or polygon feature (Route/Area mode).
     * @private
     */
    async _createLineOrPolygonFeature(state, layerId) {
        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureTypeName = state.outputMode === OUTPUT_MODE.ROUTE ? 'line' : 'polygon';
        const featureName = await IDUtils.generateFeatureName(featureTypeName, this.map);

        const feature = generateFeature({
            referencePoint: state.referencePoint,
            legs: state.legs,
            outputMode: state.outputMode,
            angularUnit: state.angularUnit,
            distanceUnit: state.distanceUnit,
            northReference: state.northReference,
            magneticDeclination: state.magneticDeclination,
            style: {
                lineColor: DEFAULT_PROPERTIES.strokeColor || '#16a34a',
                lineWidth: state.outputMode === OUTPUT_MODE.ROUTE ? 5 : 2,
                opacity: state.outputMode === OUTPUT_MODE.ROUTE ? 0.7 : 0.5,
                fillColor: DEFAULT_PROPERTIES.fillColor || '#16a34a',
                lineStyle: 'solid'
            },
            id: featureId,
            geoJsonId,
            layerId,
            name: featureName
        });

        if (!feature) {
            await showConfirm('Erro ao criar geometria', {
                message: 'Não foi possível criar a geometria. Verifique os dados.',
                confirmText: 'OK'
            });
            return;
        }

        // Determine target source based on output mode
        const sourceName = MODE_TO_SOURCE[state.outputMode];

        // Add to store
        await addFeature(sourceName, feature);

        // Add to map source
        const source = this.map.getSource(sourceName);
        if (source) {
            const data = await source.getData();
            data.features.push(feature);
            source.setData(data);
        }

        // Select the created feature
        const featureType = this._getFeatureTypeFromSource(sourceName);
        await this.selectionManager.toggleFeatureSelection(featureType, featureId, feature);
        this.selectionManager.updateUI();

    }

    _getFeatureTypeFromSource(sourceName) {
        const map = {
            'points': 'point',
            'lines': 'line',
            'polygons': 'polygon'
        };
        return map[sourceName] || 'line';
    }

    // =========================================================================
    // CANCEL
    // =========================================================================

    _handleCancel() {
        this._clearPreview();
        this.toolManager.deactivateCurrentTool();
    }

    // =========================================================================
    // SELECTION SYSTEM INTEGRATION
    // =========================================================================

    onFeatureSelected = (feature) => {
        // If we're in creation mode, ignore selection
        if (this.isActive && this._panel) return;

        // Otherwise, show attribute panel for editing
        if (feature.properties?.featureType === 'azimuth_distance') {
            this.selectFeature(feature);
        }
    }

    onFeatureDeselected = (feature) => {
        if (feature.properties?.featureType === 'azimuth_distance') {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        this.deselectFeature();
    }

    selectFeature(feature) {
        // Show edit handles if needed
        this.createEditHandles(feature);
    }

    deselectFeature() {
        this.clearEditHandles();
    }

    createEditHandles(_feature) {
        // For now, no edit handles
        // Could add waypoint handles for advanced editing
    }

    clearEditHandles() {
        // Clear any edit handles
    }

    isEditingMode() {
        return false;
    }

    hasEditHandle(_featureId) {
        return false;
    }

    // =========================================================================
    // FEATURE MANAGEMENT (for attribute panel)
    // =========================================================================

    async updateFeaturesProperty(features, property, value) {
        for (const feature of features) {
            const sourceName = feature.properties.source || 'lines';
            const source = this.map.getSource(sourceName);

            if (source) {
                const data = await source.getData();
                const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);

                if (sourceFeature) {
                    sourceFeature.properties[property] = value;
                    feature.properties[property] = value;

                    // If legs changed, recalculate geometry
                    if (property === 'legs' || property === 'referencePoint' ||
                        property === 'magneticDeclination' || property === 'northReference') {
                        this._recalculateGeometry(sourceFeature);
                    }
                }

                source.setData(data);
            }
        }

        this.updateSelectionManagerFeatures(features);
    }

    _recalculateGeometry(feature) {
        const props = feature.properties;

        // For point features, get polar data from azimuthDistanceData
        const polarData = props.azimuthDistanceData || props;
        const referencePoint = polarData.referencePoint || props.referencePoint;
        const legs = polarData.legs || props.legs;
        const northReference = polarData.northReference || props.northReference;
        const angularUnit = polarData.angularUnit || props.angularUnit;
        const distanceUnit = polarData.distanceUnit || props.distanceUnit;
        const magneticDeclination = polarData.magneticDeclination || props.magneticDeclination || 0;
        const outputMode = polarData.outputMode || props.outputMode;

        if (!referencePoint || !legs) return;

        const declination = northReference === NORTH_REFERENCE.MAGNETIC
            ? magneticDeclination : 0;

        const waypoints = calculateWaypoints(
            referencePoint,
            legs,
            declination,
            northReference,
            angularUnit,
            distanceUnit
        );

        if (waypoints.length === 0) return;

        // Update geometry based on output mode
        switch (outputMode) {
            case OUTPUT_MODE.POINT: {
                // For point features, use the waypoint at the stored index
                const waypointIndex = props.azimuthDistanceData?.waypointIndex ?? waypoints.length - 1;
                if (waypointIndex < waypoints.length) {
                    feature.geometry = {
                        type: 'Point',
                        coordinates: waypoints[waypointIndex]
                    };
                }
                break;
            }
            case OUTPUT_MODE.ROUTE:
                feature.geometry = {
                    type: 'LineString',
                    coordinates: waypoints
                };
                // Also update baseCoordinates
                props.baseCoordinates = waypoints;
                break;
            case OUTPUT_MODE.AREA:
                feature.geometry = {
                    type: 'Polygon',
                    coordinates: [[...waypoints, waypoints[0]]]
                };
                // Also update baseCoordinates
                props.baseCoordinates = waypoints;
                break;
        }

        // Update stored waypoints for line/polygon
        if (props.azimuthDistanceData) {
            props.azimuthDistanceData.calculatedWaypoints = waypoints;
        }
    }

    async saveFeatures(features, _initialPropertiesMap) {
        for (const feature of features) {
            const sourceName = feature.properties.source || 'lines';
            const source = this.map.getSource(sourceName);

            if (source) {
                const data = await source.getData();
                const currentFeature = data.features.find(f => f.properties.id === feature.properties.id);

                if (currentFeature) {
                    await updateFeature(sourceName, currentFeature);
                }
            }
        }
    }

    async discardChangeFeatures(features, initialPropertiesMap) {
        for (const feature of features) {
            const initialProps = initialPropertiesMap.get(feature.properties.id);
            if (initialProps) {
                Object.assign(feature.properties, initialProps);
                this._recalculateGeometry(feature);
            }
        }

        await this.updateFeatures(features, true, true);
    }

    async deleteFeatures(features) {
        for (const feature of features) {
            const sourceName = feature.properties.source || 'lines';

            try {
                await removeFeature(sourceName, feature.properties.id);

                const source = this.map.getSource(sourceName);
                if (source) {
                    const data = await source.getData();
                    data.features = data.features.filter(f => f.properties.id !== feature.properties.id);
                    source.setData(data);
                }
            } catch (error) {
                console.error(`Error removing azimuth distance feature:`, error);
            }
        }
    }

    setDefaultProperties(properties) {
        Object.assign(AddAzimuthDistanceControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged(feature, initialProperties) {
        if (!initialProperties) return true;

        return (
            feature.properties.strokeColor !== initialProperties.strokeColor ||
            feature.properties.strokeWidth !== initialProperties.strokeWidth ||
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.fillOpacity !== initialProperties.fillOpacity ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            JSON.stringify(feature.properties.legs) !== JSON.stringify(initialProperties.legs) ||
            JSON.stringify(feature.properties.referencePoint) !== JSON.stringify(initialProperties.referencePoint)
        );
    }

    async updateFeatures(features, save = false, onlyUpdateProperties = false) {
        for (const feature of features) {
            const sourceName = feature.properties.source || 'lines';
            const source = this.map.getSource(sourceName);

            if (source) {
                const data = await source.getData();
                const idx = data.features.findIndex(f => f.properties.id === feature.properties.id);

                if (idx !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[idx].properties, feature.properties);
                    } else {
                        data.features[idx] = feature;
                    }

                    if (save) {
                        await updateFeature(sourceName, data.features[idx]);
                    }
                }

                source.setData(data);
            }
        }

        this.updateSelectionManagerFeatures(features);
    }

    updateSelectionManagerFeature(feature) {
        const featureType = this._getFeatureTypeFromSource(feature.properties.source || 'lines');
        this.selectionManager.updateSelectedFeature(featureType, feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            this.updateSelectionManagerFeature(feature);
        });
    }

    // =========================================================================
    // FEATURE RETRIEVAL
    // =========================================================================

    getSelectedFeature() {
        // Check all possible sources for azimuth_distance features
        for (const featureType of ['point', 'line', 'polygon']) {
            const items = this.selectionManager.getSelectedFeaturesByType(featureType);
            const azFeature = items.find(item =>
                item.feature.properties?.featureType === 'azimuth_distance'
            );
            if (azFeature) return azFeature.feature;
        }
        return null;
    }

    getSelectedFeatures() {
        const features = [];
        for (const featureType of ['point', 'line', 'polygon']) {
            const items = this.selectionManager.getSelectedFeaturesByType(featureType);
            items.forEach(item => {
                if (item.feature.properties?.featureType === 'azimuth_distance') {
                    features.push(item.feature);
                }
            });
        }
        return features;
    }

    // =========================================================================
    // MOVEMENT
    // =========================================================================

    calculateMoveOffset(feature, referencePoint) {
        const refPoint = feature.properties.referencePoint;
        if (!refPoint) return [0, 0];

        return [
            refPoint[0] - referencePoint.lng,
            refPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, _newCoords) {
        const props = feature.properties;
        const oldRefPoint = props.referencePoint;

        if (!oldRefPoint) return feature;

        // Update reference point
        const newRefPoint = [
            oldRefPoint[0] + dx,
            oldRefPoint[1] + dy
        ];

        const updatedFeature = {
            ...feature,
            properties: {
                ...props,
                referencePoint: newRefPoint
            }
        };

        // Recalculate geometry
        this._recalculateGeometry(updatedFeature);

        return updatedFeature;
    }
}

export { AddAzimuthDistanceControl };
export default AddAzimuthDistanceControl;
