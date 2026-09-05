// Path: js/azimuth_distance_tool/add_azimuth_distance_control.js

/**
 * @fileoverview Azimuth and Distance Tool Control.
 * Manages the tool activation, map interaction, and feature creation.
 *
 * @module azimuth_distance_tool/add_azimuth_distance_control
 */

import { BaseControl } from '@tools/index.js';
import { AzimuthDistancePanel } from './azimuth_distance_panel.js';
import { generateFeature, generatePointFeatures, calculateWaypoints } from './azimuth_distance_geometry.js';
import { addAzimuthDistanceAttributesToPanel } from './azimuth_distance_attributes_panel.js';
import { DEFAULT_PROPERTIES, OUTPUT_MODE, MODE_TO_SOURCE, NORTH_REFERENCE } from './azimuth_distance_constants.js';
import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync, getControl } from '@store';
import { IDUtils } from '@utils';
import { showCoordinateEditModal } from '@modals/coordinate-edit.modal.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { maplibregl } from '@js/map/maplibre.js';

/**
 * Azimuth/distance features store their origin geometry kind in properties.source
 * as a SINGULAR value ('point'/'line'/'polygon'), but the MapLibre sources and
 * store collections are PLURAL ('points'/'lines'/'polygons'). Resolving to the
 * plural collection makes getSource()/updateFeature()/removeFeature() target the
 * real source instead of silently no-op'ing on an undefined source (which dropped
 * every edit, save and delete of these features).
 */
const SOURCE_TO_COLLECTION = { point: 'points', line: 'lines', polygon: 'polygons' };

function resolveAzimuthCollection(feature) {
    const source = feature?.properties?.source;
    return SOURCE_TO_COLLECTION[source] || source || 'lines';
}

/**
 * The dispatcher that owns one of the three persistent sources this tool writes.
 *
 * This tool does NOT own `points`, `lines` or `polygons`: each of them is also written by its own
 * draw tool, and the dispatcher registry is keyed by (map, sourceId), so all writers share one
 * queue per source. That is the point. A raw `source.setData()` issued while a diff is queued
 * replaces MapLibre's pending-update slot and the diff disappears with no error, so every writer
 * of a source has to arrive through the same dispatcher.
 *
 * Because ownership is shared, this file never destroys these dispatchers: each draw tool releases
 * the one for its own source in its `onRemove`, and destroying one here would drop a batch that
 * belongs to another writer.
 * @param {Object} map - MapLibre map instance
 * @param {string} sourceName - `points`, `lines` or `polygons`
 * @returns {Object} dispatcher owning that source
 */
function collectionSource(map, sourceName) {
    return getGeoJsonDispatcher(map, sourceName);
}

/**
 * Azimuth and Distance Tool Control.
 * Extends BaseControl to manage polar construction of geometries.
 */
class AddAzimuthDistanceControl extends BaseControl {
    /** @type {string} */
    type = 'azimuth_distance';

    constructor(toolManager) {
        super(toolManager);

        this._panel = null;
        this._isWaitingForMapClick = false;
        this._previewFeature = null;
        this._referenceMarker = null;

        this._handleMapClick = this._handleMapClick.bind(this);
        this._handleKeyDown = this._handleKeyDown.bind(this);
    }

    static DEFAULT_PROPERTIES = { ...DEFAULT_PROPERTIES };

    // =========================================================================
    // MAPLIBRE CONTROL INTERFACE
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
    // TOOL-CENTRIC INTERFACE
    // =========================================================================

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'azimuth-distance-attributes-section';

        try {
            addAzimuthDistanceAttributesToPanel(
                sectionPanel, features, this, selectionManager, uiManager, options
            );
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating azimuth distance attribute panel:', error);
        }
    }

    getDragSources() {
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
     */
    _showReferenceMarker(lng, lat) {
        this._removeReferenceMarker();

        const el = document.createElement('div');
        el.className = 'azd-reference-marker';

        const crosshair = document.createElement('div');
        crosshair.className = 'azd-reference-marker__crosshair';
        el.appendChild(crosshair);

        this._referenceMarker = new maplibregl.Marker({
            element: el,
            anchor: 'center'
        })
            .setLngLat([lng, lat])
            .addTo(this.map);
    }

    /**
     * Remove the reference point marker.
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
        this._panel = new AzimuthDistancePanel({
            onCreateFeature: (state) => this._createFeature(state),
            onCancel: () => this._handleCancel(),
            onRequestMapClick: () => this._enterMapClickMode(),
            onEditCoordinates: (lat, lng) => this._openCoordinateModal(lat, lng),
            onStateChange: (state) => this._updatePreview(state),
            onResetReferencePoint: () => this._removeReferenceMarker()
        });

        const panelContent = this._panel.render();

        const sidebarControl = getControl('sidebarControl');
        if (sidebarControl?.showToolPanel) {
            sidebarControl.showToolPanel(
                panelContent,
                'Azimute e Dist\u00E2ncia',
                () => {
                    if (this._panel) {
                        this._panel.destroy();
                        this._panel = null;
                    }
                },
                () => {
                    this.toolManager?.deactivateCurrentTool();
                }
            );
        } else {
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

        const sidebarControl = getControl('sidebarControl');
        if (sidebarControl?.hideToolPanel) {
            sidebarControl.hideToolPanel(false, false);
        } else {
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

        if (this._panel) {
            this._panel.setReferencePoint(lng, lat);
        }

        this._showReferenceMarker(lng, lat);
        this._exitMapClickMode();
    }

    _handleKeyDown(e) {
        if (!this.isActive) return;
        if (e.key === 'Escape') this._handleCancel();
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
                this._panel?.setReferencePoint(newLng, newLat);
                this._showReferenceMarker(newLng, newLat);
            }
        });
    }

    // =========================================================================
    // PREVIEW (on map)
    // =========================================================================

    _updatePreview(state) {
        if (!state?.referencePoint) {
            this._clearPreview();
            return;
        }

        const declination = state.northReference === NORTH_REFERENCE.MAGNETIC
            ? state.magneticDeclination : 0;

        const waypoints = calculateWaypoints(
            state.referencePoint, state.legs, declination,
            state.northReference, state.angularUnit, state.distanceUnit
        );

        if (waypoints.length < 1) {
            this._clearPreview();
            return;
        }

        switch (state.outputMode) {
            case OUTPUT_MODE.POINT:
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
        this._clearPreview();

        const feedbackSource = this._getFeedbackSource(outputMode);
        if (!feedbackSource) return;

        const source = this.map.getSource(feedbackSource);
        if (!source) return;

        if (geometry.type === 'MultiPoint') {
            const features = geometry.coordinates.map((coord, index) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: coord },
                properties: {
                    isPreview: true,
                    fillColor: DEFAULT_PROPERTIES.fillColor || '#16a34a',
                    size: 10,
                    opacity: 0.7,
                    pointIndex: index
                }
            }));

            source.setData({ type: 'FeatureCollection', features });
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

    _clearPreview() {
        ['point-feedback', 'line-feedback', 'polygon-feedback'].forEach(sourceName => {
            const source = this.map.getSource(sourceName);
            if (source) {
                source.setData({ type: 'FeatureCollection', features: [] });
            }
        });
    }

    _getFeedbackSource(outputMode) {
        switch (outputMode) {
            case OUTPUT_MODE.POINT: return 'point-feedback';
            case OUTPUT_MODE.ROUTE: return 'line-feedback';
            case OUTPUT_MODE.AREA: return 'polygon-feedback';
            default: return null;
        }
    }

    // =========================================================================
    // FEATURE CREATION
    // =========================================================================

    async _createFeature(state) {
        const layerId = getActiveLayerIdSync();

        const declination = state.northReference === NORTH_REFERENCE.MAGNETIC
            ? state.magneticDeclination : 0;

        const waypoints = calculateWaypoints(
            state.referencePoint, state.legs, declination,
            state.northReference, state.angularUnit, state.distanceUnit
        );

        if (waypoints.length === 0) {
            await showConfirm('Erro ao criar geometria', {
                message: 'N\u00E3o foi poss\u00EDvel calcular os pontos. Verifique os dados.',
                confirmText: 'OK'
            });
            return;
        }

        try {
            if (state.outputMode === OUTPUT_MODE.POINT) {
                await this._createPointFeatures(state, waypoints, layerId);
            } else {
                await this._createLineOrPolygonFeature(state, layerId);
            }

            this._clearPreview();
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
     */
    async _createPointFeatures(state, waypoints, layerId) {
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

        const legObservations = storedLegs.map(leg => leg.observation);

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
            polarData,
            observations: legObservations,
            currentZoom: Number.isFinite(this.map?.getZoom?.()) ? this.map.getZoom() : 0
        });

        if (features.length === 0) {
            await showConfirm('Erro ao criar pontos', {
                message: 'N\u00E3o foi poss\u00EDvel criar os pontos.',
                confirmText: 'OK'
            });
            return;
        }

        // One upsert per waypoint instead of a read-modify-write of the whole `points`
        // collection. The store write keeps its place before the source write, and the
        // pre-existing guard on the source is kept as it was.
        if (this.map.getSource('points')) {
            const dispatcher = collectionSource(this.map, 'points');
            for (const feature of features) {
                await addFeature('points', feature);
                dispatcher.add(feature);
            }
            await dispatcher.flush();
        }

        const lastFeature = features[features.length - 1];
        await this.selectionManager.toggleFeatureSelection('point', lastFeature.properties.id, lastFeature);
        this.selectionManager.updateUI();
    }

    /**
     * Create line or polygon feature (Route/Area mode).
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
                message: 'N\u00E3o foi poss\u00EDvel criar a geometria. Verifique os dados.',
                confirmText: 'OK'
            });
            return;
        }

        const sourceName = MODE_TO_SOURCE[state.outputMode];

        await addFeature(sourceName, feature);

        if (this.map.getSource(sourceName)) {
            const dispatcher = collectionSource(this.map, sourceName);
            dispatcher.add(feature);
            await dispatcher.flush();
        }

        const featureType = this._getFeatureTypeFromSource(sourceName);
        await this.selectionManager.toggleFeatureSelection(featureType, featureId, feature);
        this.selectionManager.updateUI();
    }

    _getFeatureTypeFromSource(sourceName) {
        const sourceMap = { 'points': 'point', 'lines': 'line', 'polygons': 'polygon' };
        return sourceMap[sourceName] || 'line';
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
        if (this.isActive && this._panel) return;
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
        this.createEditHandles(feature);
    }

    deselectFeature() {
        this.clearEditHandles();
    }

    createEditHandles(_feature) {
        // Waypoint handles reserved for future advanced editing
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
        const touched = new Set();

        for (const feature of features) {
            const sourceName = resolveAzimuthCollection(feature);
            const source = this.map.getSource(sourceName);
            if (!source) continue;

            const dispatcher = collectionSource(this.map, sourceName);

            // The collection read survives here: the polar recalculation rebuilds the geometry from
            // the SOURCE copy of the feature (the one carrying `azimuthDistanceData`), which no diff
            // can hand back. Draining first keeps that read from missing a queued write.
            await dispatcher.flush();
            const data = await source.getData();
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (!sourceFeature) continue;

            sourceFeature.properties[property] = value;
            feature.properties[property] = value;

            if (['legs', 'referencePoint', 'magneticDeclination', 'northReference'].includes(property)) {
                this._recalculateGeometry(sourceFeature);
                // Total replacement: the recalculation rewrites the geometry plus the derived
                // `baseCoordinates` and `calculatedWaypoints`, and the mutated source copy in hand
                // already carries every one of them.
                dispatcher.add(sourceFeature);
            } else {
                dispatcher.patch(sourceFeature.properties.id, { setProps: { [property]: value } });
            }
            touched.add(dispatcher);
        }

        for (const dispatcher of touched) {
            await dispatcher.flush();
        }

        this.updateSelectionManagerFeatures(features);
    }

    _recalculateGeometry(feature) {
        const props = feature.properties;
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
            referencePoint, legs, declination,
            northReference, angularUnit, distanceUnit
        );

        if (waypoints.length === 0) return;

        switch (outputMode) {
            case OUTPUT_MODE.POINT: {
                const waypointIndex = props.azimuthDistanceData?.waypointIndex ?? waypoints.length - 1;
                if (waypointIndex < waypoints.length) {
                    feature.geometry = { type: 'Point', coordinates: waypoints[waypointIndex] };
                }
                break;
            }
            case OUTPUT_MODE.ROUTE:
                feature.geometry = { type: 'LineString', coordinates: waypoints };
                props.baseCoordinates = waypoints;
                break;
            case OUTPUT_MODE.AREA:
                feature.geometry = { type: 'Polygon', coordinates: [[...waypoints, waypoints[0]]] };
                props.baseCoordinates = waypoints;
                break;
        }

        if (props.azimuthDistanceData) {
            props.azimuthDistanceData.calculatedWaypoints = waypoints;
        }
    }

    async saveFeatures(features) {
        for (const feature of features) {
            const sourceName = resolveAzimuthCollection(feature);
            const source = this.map.getSource(sourceName);

            if (source) {
                // Reads only, and it persists the SOURCE's version of the feature rather than the
                // selected one, so the queue has to be drained before the collection comes back.
                await collectionSource(this.map, sourceName).flush();
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
        const touched = new Set();

        for (const feature of features) {
            const sourceName = resolveAzimuthCollection(feature);

            try {
                await removeFeature(sourceName, feature.properties.id);

                // Removal by promoted key, with no collection read. The key goes in raw, never
                // coerced: MapLibre keyed the feature by the very value sitting in `properties.id`.
                if (this.map.getSource(sourceName)) {
                    const dispatcher = collectionSource(this.map, sourceName);
                    dispatcher.remove(feature.properties.id);
                    touched.add(dispatcher);
                }
            } catch (error) {
                console.error('Error removing azimuth distance feature:', error);
            }
        }

        for (const dispatcher of touched) {
            await dispatcher.flush();
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
        const touched = new Set();

        for (const feature of features) {
            const sourceName = resolveAzimuthCollection(feature);
            const source = this.map.getSource(sourceName);
            if (!source) continue;

            const dispatcher = collectionSource(this.map, sourceName);
            // The collection read survives here, as it does in the point tool: an unknown id must
            // be skipped rather than created (`add` would create it), and the merge branch persists
            // the SOURCE copy with the incoming properties folded in, which no diff returns.
            await dispatcher.flush();
            const data = await source.getData();
            const idx = data.features.findIndex(f => f.properties.id === feature.properties.id);

            if (idx !== -1) {
                if (onlyUpdateProperties) {
                    Object.assign(data.features[idx].properties, feature.properties);
                    dispatcher.patch(feature.properties.id, { setProps: feature.properties });
                } else {
                    data.features[idx] = feature;
                    dispatcher.add(feature);
                }
                touched.add(dispatcher);

                if (save) {
                    await updateFeature(sourceName, data.features[idx]);
                }
            }
        }

        for (const dispatcher of touched) {
            await dispatcher.flush();
        }

        this.updateSelectionManagerFeatures(features);
    }

    updateSelectionManagerFeature(feature) {
        // Resolve via the plural collection: properties.source is singular
        // ('point'/'line'/'polygon') and _getFeatureTypeFromSource keys on the plural
        // names, so passing source directly would mis-map point/polygon to 'line'.
        const featureType = this._getFeatureTypeFromSource(resolveAzimuthCollection(feature));
        this.selectionManager.updateSelectedFeature(featureType, feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        for (const feature of features) {
            this.updateSelectionManagerFeature(feature);
        }
    }

    // =========================================================================
    // FEATURE RETRIEVAL
    // =========================================================================

    getSelectedFeature() {
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
            for (const item of items) {
                if (item.feature.properties?.featureType === 'azimuth_distance') {
                    features.push(item.feature);
                }
            }
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

    updateFeatureForMove(feature, dx, dy) {
        const oldRefPoint = feature.properties.referencePoint;
        if (!oldRefPoint) return feature;

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                referencePoint: [oldRefPoint[0] + dx, oldRefPoint[1] + dy]
            }
        };

        this._recalculateGeometry(updatedFeature);
        return updatedFeature;
    }
}

export { AddAzimuthDistanceControl };
