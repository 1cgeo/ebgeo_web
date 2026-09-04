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
import { reanchorOnMove } from '@js/temporal/trajectory-anchor.js';
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { readGeoJSONSourceData } from '@utils/geojson-source.js';

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
 * The dispatcher that owns the `points` source.
 *
 * EVERY write to `points` made in this file goes through it. The reason is not style: a raw
 * `source.setData()` issued while a diff is queued replaces MapLibre's pending-update slot
 * (`_pendingWorkerUpdate`) and the diff disappears with no error at all.
 *
 * Each public method here also awaits `flush()` before it returns. Two reasons, and the second
 * is the one that matters:
 * - the deferred write would otherwise land one animation frame after the caller resumed;
 * - `points` still has co-writers outside this file (the azimuth/distance tool, the batch-points
 *   panel, the point-to-symbol conversions in `feature-header.helpers.js`, the temporal playback
 *   service), and they all do read-modify-write with a raw `setData`. Draining inside the awaited
 *   method keeps the queue empty between gestures, so no co-writer can read a collection that is
 *   missing what this tool just wrote.
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `points` source
 */
function pointsSource(map) {
    return getGeoJsonDispatcher(map, 'points');
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
    // The point layer paints the zoom-scaled radius, the marker icon size and the label
    // size with style expressions (layers/styles/zoom-expression.js), so this pass no
    // longer feeds the drawing. It only refreshes the stored `calculatedSize` and
    // `labelCalculatedSize` for the consumers that still read them (export, selection box,
    // feature header), and that is worth doing ONCE per gesture: it runs on `zoomend`.
    //
    // What an expression cannot do is the ground geometry of a point whose size correction
    // is OFF: its `selectionBox` is expressed in degrees and has to be rebuilt at every
    // zoom step. Those features, and only those, keep a per-frame pass.
    //
    // Behaviour this changes, and it is the price of the trade: a legacy label with no
    // `labelCreatedAtZoom` only gets its anchor at the END of the first gesture that
    // touches it, and stays at its nominal size for that gesture.
    #zoomPending = false;
    #zoomRafId = null;
    #zoomEndPending = false;
    #zoomEndRafId = null;

    /**
     * Per-frame pass, coalesced by rAF: rebuilds the ground-sized selection box of the
     * points whose size correction is disabled, and nothing else. The collection is read
     * SYNCHRONOUSLY (`utilities/geojson-source.js`), so a gesture over a map with no
     * fixed-size point costs no worker traffic and no write at all, and what does change
     * leaves as a diff through the dispatcher.
     */
    #handleZoom = () => {
        if (this.#zoomPending) return;
        this.#zoomPending = true;
        this.#zoomRafId = requestAnimationFrame(async () => {
            try {
                const source = this.map?.getSource('points');
                if (!source) return;

                const data = readGeoJSONSourceData(source);
                if (!data?.features?.length) return;

                const fixed = data.features.filter(
                    f => f.properties.sizeZoomCorrectionEnabled === false
                );
                if (!fixed.length) return;

                const currentZoom = this.map.getZoom();
                const dispatcher = pointsSource(this.map);
                const boxes = new Map();
                for (const feature of fixed) {
                    const props = feature.properties;
                    const size = props.size || 10;
                    const selectionBox = this.geometry.calculateSelectionBoxGeometry(
                        feature.geometry.coordinates,
                        size,
                        props.lineWidth || 0,
                        props.sizeCreatedAtZoom || 0,
                        currentZoom
                    );
                    boxes.set(props.id, selectionBox);
                    dispatcher.patch(props.id, { setProps: { selectionBox, calculatedSize: size } });
                }
                await dispatcher.flush();

                this.#syncFixedPoints(boxes);
            } finally {
                this.#zoomPending = false;
            }
        });
    };

    /**
     * Copy the recalculated boxes onto the selected points and refresh the highlight.
     * @param {Map<string, Object>} boxes - Selection box per point id
     */
    #syncFixedPoints = (boxes) => {
        const selectedPoints = this.selectionManager?.getSelectedFeaturesByType?.('point');
        if (!selectedPoints?.length) return;

        let touched = false;
        for (const { id, feature: selFeature } of selectedPoints) {
            const box = boxes.get(selFeature.properties.id);
            if (!box) continue;
            selFeature.properties.selectionBox = box;
            this.selectionManager.uiManager?.invalidateCache?.(id);
            touched = true;
        }
        if (touched) this.selectionManager.uiManager?.updateSelectionHighlight?.();
    };

    /**
     * End-of-gesture pass: the full recalculation (sizes, the lazy `labelCreatedAtZoom`
     * stamp, selection sync) that used to run per frame.
     */
    #handleZoomEnd = () => {
        if (this.#zoomEndPending) return;
        this.#zoomEndPending = true;
        this.#zoomEndRafId = requestAnimationFrame(async () => {
            const source = this.map?.getSource('points');
            if (!source) { this.#zoomEndPending = false; return; }

            // NOT a diff, on purpose: every zoom-corrected point changes size on every zoom
            // step, so the delta IS the collection and a diff would carry one update entry per
            // feature for the same O(N) cost. The read-modify-write still has to start from a
            // drained queue, or the copy read back would be missing whatever is queued and the
            // whole-collection write would then erase it.
            const dispatcher = pointsSource(this.map);
            await dispatcher.flush();
            if (!this.map) { this.#zoomEndPending = false; return; }

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
                dispatcher.setData(data);
                await dispatcher.flush();

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
            this.#zoomEndPending = false;
        });
    };

    onAdd = (map) => {
        this.map = map;
        map.on('zoom', this.#handleZoom);
        map.on('zoomend', this.#handleZoomEnd);
    }

    onRemove = () => {
        if (this.map) {
            this.map.off('zoom', this.#handleZoom);
            this.map.off('zoomend', this.#handleZoomEnd);
            // Releases the queue, its settle timers and the two map listeners the dispatcher
            // opens per dispatch. Dropping a batch here cannot lose a point: the store write
            // always precedes the source write, so the redraw that follows a style switch
            // repopulates `points` from persistence.
            destroyGeoJsonDispatcher(this.map, 'points');
        }
        if (this.#zoomRafId) {
            cancelAnimationFrame(this.#zoomRafId);
            this.#zoomRafId = null;
        }
        if (this.#zoomEndRafId) {
            cancelAnimationFrame(this.#zoomEndRafId);
            this.#zoomEndRafId = null;
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

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            },
            properties: {
                ...feature.properties,
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

        const dispatcher = pointsSource(this.map);
        let hasChanges = false;

        // The moved feature already carries the post-drag state: `updateFeatureForMove` built it
        // and `updateFeatures` pushed that same object into the source moments ago. So the box is
        // recomputed from it and shipped as a one-property patch, instead of reading the whole
        // collection back only to find the copy of what the caller already handed us.
        for (const inputFeature of movedFeatures) {
            if (inputFeature.properties.source !== 'point') continue;

            const effectiveZoom = inputFeature.properties.sizeZoomCorrectionEnabled === false
                ? this.map.getZoom() : null;
            const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
                inputFeature.geometry.coordinates,
                inputFeature.properties.size || 10,
                inputFeature.properties.lineWidth || 0,
                inputFeature.properties.sizeCreatedAtZoom || 0,
                effectiveZoom
            );
            inputFeature.properties.selectionBox = newSelectionBox;
            dispatcher.patch(inputFeature.properties.id, { setProps: { selectionBox: newSelectionBox } });
            hasChanges = true;
        }

        if (hasChanges) {
            await dispatcher.flush();
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

        // Single-shot tool: disarm BEFORE the first await. `createPointAtCoordinates`
        // awaits name generation, image registration and the store write before
        // `deactivateCurrentTool()` runs, so two clicks in the same tick both used to
        // pass the guard above and create two points with the same generated name.
        this.isActive = false;

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

            const dispatcher = pointsSource(this.map);
            dispatcher.add(feature);
            await dispatcher.flush();

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
        const dispatcher = pointsSource(this.map);
        const currentZoom = this.map.getZoom();

        // One patch per feature carrying the edited property plus everything derived from it.
        // The selected feature is the only copy consulted: it is kept in step with the source by
        // `updateSelectionManagerFeatures` and by the zoom handler, and every value written below
        // is derived from properties both copies share. The two `recalc*` helpers take the source
        // and the selected feature separately and write the same result into both, so the same
        // object is passed twice here.
        for (const feature of features) {
            const props = feature.properties;
            props[property] = value;
            const setProps = { [property]: value };

            if (LABEL_ZOOM_PROPERTIES.has(property)) {
                recalcLabelSize(feature, feature, currentZoom);
                setProps.labelCreatedAtZoom = props.labelCreatedAtZoom;
                setProps.labelCalculatedSize = props.labelCalculatedSize;
            }

            if (SIZE_ZOOM_PROPERTIES.has(property)) {
                recalcPointSize(feature, feature, currentZoom);
                setProps.calculatedSize = props.calculatedSize;
            }

            if (SELECTION_BOX_PROPERTIES.has(property)) {
                const effectiveZoom = props.sizeZoomCorrectionEnabled === false ? currentZoom : null;
                props.selectionBox = this.geometry.calculateSelectionBoxGeometry(
                    feature.geometry.coordinates,
                    props.size || 10,
                    props.lineWidth || 0,
                    props.sizeCreatedAtZoom || 0,
                    effectiveZoom
                );
                setProps.selectionBox = props.selectionBox;
            }

            // Regenerate per-feature image when visual properties change
            if (IMAGE_REGEN_PROPERTIES.has(property)) {
                await this._applyMarkerImage(props);
            }

            dispatcher.patch(props.id, { setProps });
        }

        await dispatcher.flush();

        this.updateSelectionManagerFeatures(features);
    }


    saveFeatures = async (features, initialPropertiesMap) => {
        // Reads only, and it persists the SOURCE's version of each feature rather than the
        // selected one, so the queue has to be drained before the collection comes back.
        await pointsSource(this.map).flush();
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

        // Removal by promoted key, with no collection read. The keys go in raw, never coerced:
        // MapLibre keyed the feature by the very value that sits in `properties.id`, so a
        // `String()` around it would miss a numeric key instead of protecting anything.
        const dispatcher = pointsSource(this.map);
        dispatcher.remove(features.map(f => f.properties.id));
        await dispatcher.flush();
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
            const dispatcher = pointsSource(this.map);
            // The collection read survives here on purpose, and it is the one call-site where it
            // does. Two things below need the PREVIOUS source feature, and no diff can hand it
            // back: whether the feature exists at all (an unknown id must be skipped, not
            // created), and its derived sizes, which are carried over when the incoming feature
            // arrives without them. Draining first keeps that read from being stale.
            await dispatcher.flush();
            const data = await this.map.getSource('points').getData();
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                        dispatcher.patch(feature.properties.id, { setProps: feature.properties });
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
                        // Queued only after the carry-over above, because `add` is a TOTAL
                        // replacement: whatever is missing from this object is missing from
                        // the source too.
                        dispatcher.add(feature);
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('points', featureToUpdate);
                    }
                }
            }

            await dispatcher.flush();

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
