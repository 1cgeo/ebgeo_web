// Path: js/military_tools/declination_tool/add_declination_control.js

/**
 * @fileoverview Control for placing magnetic declination diagrams on the map.
 * Single-click placement with WMM2025 auto-calculation.
 */

import {
    addFeature,
    updateFeature,
    removeFeature,
    storeImage,
    getActiveLayerIdSync
} from '@store';
import { IDUtils, showError, loadImageToMap } from '@utils';
import { calculateMagneticDeclination } from '@utils/geomagnetic/wmm_calculator.js';
import { calculateMeridianConvergence } from '@utils/geomagnetic/meridian_convergence.js';
import { convertSvgToPngBlob } from '../svg-to-png.js';
import { addDeclinationAttributesToPanel } from './declination_attributes_panel.js';
import AddDeclinationGeometry from './add_declination_geometry.js';
import { generateDeclinationSvg } from './declination_svg_generator.js';
import { BaseControl } from '@tools';
import {
    applyZoomCorrections as applyZoomCorrectionsUtil,
    syncZoomCorrectedProperty,
} from '@tools/helpers/zoom-correction.helpers.js';
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';

/**
 * The dispatcher that owns the `magnetic_declinations` source.
 *
 * EVERY write to `magnetic_declinations` made in this file goes through it. The reason is not
 * style: a raw `source.setData()` issued while a diff is queued replaces MapLibre's pending-update
 * slot and the diff disappears with no error at all.
 *
 * Each public method here also awaits `flush()` before it returns. Two reasons, and the second is
 * the one that matters:
 * - the deferred write would otherwise land one animation frame after the caller resumed;
 * - `magnetic_declinations` still has co-writers outside this file (the generic by-storageType
 *   writers: attribute table, features tab, import, clipboard, multi-selection actions, context
 *   menu, phone layout), and they all do read-modify-write with a raw `setData`. Draining inside
 *   the awaited method keeps the queue empty between gestures, so no co-writer can read a
 *   collection that is missing what this tool just wrote.
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `magnetic_declinations` source
 */
function declinationsSource(map) {
    return getGeoJsonDispatcher(map, 'magnetic_declinations');
}

/** SVG rasterization target dimensions */
const ICON_WIDTH = 400;
const ICON_HEIGHT = 500;

class AddDeclinationControl extends BaseControl {
    featureType = 'magnetic_declination';

    constructor(toolManager) {
        super(toolManager);

        this.geometry = new AddDeclinationGeometry();

        this.zoomRafId = null;
        this.pendingZoomUpdate = false;
        this._name = 'AddDeclinationControl';

        // Feature IDs with an in-flight convergence backfill (prevents the
        // fire-and-forget backfill from running twice on rapid panel reopens).
        this._convergenceBackfillIds = new Set();
    }

    static DEFAULT_PROPERTIES = {
        size: 0.6,
        opacity: 1.0,
        width: ICON_WIDTH,
        height: ICON_HEIGHT,

        createdAtZoom: 0,
        calculatedSize: 1.0,
        zoomCorrectionEnabled: true,
        selectionBox: null,

        source: 'magnetic_declination',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false,

        declination: 0,
        convergence: 0,
        inclination: 0,
        intensity: 0,
        latitude: 0,
        longitude: 0,
        calculationDate: '',
        wmmWarning: null,
    };

    // ===== LIFECYCLE =====

    onAdd = (map) => {
        this.map = map;
        this.setupZoomListener();
        // A declination diagram is rendered from a local PNG keyed by the feature id, and that
        // PNG is NEVER uploaded — so a peer has no blob to fetch (it rendered the error icon).
        // The diagram is fully reconstructible from the synced props (declination/convergence),
        // so regenerate it on the peer whenever a REMOTE declination op is applied. Deterministic,
        // so it round-trips create AND edit without shipping the raster.
        this._subscribeRemoteImageRegen('magnetic_declination', (f) => this.regenerateIcon(f));
    };

    onRemove = () => {
        this.map.off('zoom', this.handleZoomChange);
        // Releases the queue, its settle timers and the two map listeners the dispatcher opens
        // per dispatch. Dropping a batch here cannot lose a diagram: the store write always
        // precedes the source write, so the redraw that follows a style switch repopulates
        // `magnetic_declinations` from persistence.
        destroyGeoJsonDispatcher(this.map, 'magnetic_declinations');
        this._unsubscribeRemoteImageRegen();
        if (this.zoomRafId) {
            cancelAnimationFrame(this.zoomRafId);
            this.zoomRafId = null;
        }
        this.pendingZoomUpdate = false;
        this.deactivate();
        this.map = undefined;
    };

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'declination-attributes-section';

        try {
            addDeclinationAttributesToPanel(
                sectionPanel,
                features,
                this,
                selectionManager,
                uiManager,
                options
            );
            container.appendChild(sectionPanel);

            // Backfill convergence for legacy diagrams (created before the
            // feature existed). Fire-and-forget: regenerates the icon when done.
            if (features.length === 1 && features[0].properties.convergence === undefined) {
                this.ensureConvergence(features[0]).catch((error) => {
                    console.error('Error backfilling convergence:', error);
                });
            }
        } catch (error) {
            console.error('Error creating declination attribute panel:', error);
        }
    }

    // ===== MAP CLICK =====

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for declination diagram');
            return;
        }

        await this.createDeclinationFeature(e.lngLat);
        this.toolManager.deactivateCurrentTool();
    };

    /**
     * Creates a declination diagram feature at the given coordinates.
     * @param {Object} lngLat - MapLibre LngLat object
     */
    createDeclinationFeature = async (lngLat) => {
        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName(
            'magnetic_declination',
            this.map
        );

        const currentZoom = this.map.getZoom();
        const coordinates = [lngLat.lng, lngLat.lat];

        // Calculate magnetic declination at this point
        const wmmResult = calculateMagneticDeclination(lngLat.lat, lngLat.lng);

        if (!wmmResult) {
            showError('Erro ao calcular declinação magnética');
            return;
        }

        const declination = wmmResult.declination;
        const convergence = calculateMeridianConvergence(lngLat.lat, lngLat.lng) ?? 0;

        // Generate SVG diagram and convert to PNG
        const svgString = generateDeclinationSvg(declination, convergence);
        let blob;
        try {
            blob = await convertSvgToPngBlob(svgString, ICON_WIDTH, ICON_HEIGHT);
        } catch (error) {
            console.error('Error converting declination SVG to PNG:', error);
            showError('Erro ao gerar diagrama de declinação');
            return;
        }

        const selectionBox = this.geometry.calculateSelectionBoxGeometry(
            coordinates,
            ICON_WIDTH,
            ICON_HEIGHT,
            AddDeclinationControl.DEFAULT_PROPERTIES.size,
            0,
            currentZoom,
            this.selectionManager.uiManager
        );

        const now = new Date();
        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...AddDeclinationControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                id: featureId,
                nome: featureName,
                createdAtZoom: currentZoom,
                calculatedSize: AddDeclinationControl.DEFAULT_PROPERTIES.size,
                selectionBox,
                declination: wmmResult.declination,
                convergence,
                inclination: wmmResult.inclination,
                intensity: wmmResult.intensity,
                latitude: lngLat.lat,
                longitude: lngLat.lng,
                calculationDate: now.toISOString().split('T')[0],
                wmmWarning: wmmResult.warning || null,
            },
            geometry: this.geometry.generate(coordinates),
        };

        try {
            await storeImage(featureId, blob);
            await this.loadIconToMap(featureId, blob);

            await addFeature('magnetic_declinations', feature);

            const dispatcher = declinationsSource(this.map);
            dispatcher.add(feature);
            await dispatcher.flush();

            await this.selectionManager.toggleFeatureSelection(
                'magnetic_declination',
                featureId,
                feature
            );
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating declination feature:', error);
            showError('Erro ao criar diagrama de declinação');
        }
    };

    // ===== ICON MANAGEMENT =====

    /**
     * Registers a PNG blob as a MapLibre image.
     * @param {string} iconId - Feature ID used as image key
     * @param {Blob} blob - PNG blob
     * @returns {Promise<void>}
     */
    async loadIconToMap(iconId, blob) {
        return loadImageToMap(this.map, iconId, blob, { replaceExisting: true });
    }

    /**
     * Regenerates the diagram SVG/PNG for a feature and updates the map icon.
     * @param {Object} feature - The declination feature
     */
    /**
     * Rebuilds this diagram's LOCAL-ONLY PNG from its synced props, and installs it on the map.
     *
     * NOME COMUM ÀS TRÊS FERRAMENTAS que registram regeneração de imagem, e é isso que permite
     * ao `tool_manager/tool-registry.js` registrar UMA closure genérica no boot: ela carrega a
     * ferramenta na primeira feição que precisar dela e chama este método. Aqui o trabalho já
     * era público (`regenerateIcon`); o apelido existe para o contrato ser o mesmo nas três.
     *
     * @param {Object} feature
     * @returns {Promise<void>}
     */
    regenerateImageFromProps(feature) {
        return this.regenerateIcon(feature);
    }

    async regenerateIcon(feature) {
        const svgString = generateDeclinationSvg(
            feature.properties.declination,
            feature.properties.convergence ?? 0,
        );

        try {
            const blob = await convertSvgToPngBlob(svgString, ICON_WIDTH, ICON_HEIGHT);
            await storeImage(feature.properties.id, blob);
            await this.loadIconToMap(feature.properties.id, blob);
        } catch (error) {
            console.error('Error regenerating declination icon:', error);
        }
    }

    // ===== ZOOM CORRECTION =====

    setupZoomListener = () => {
        this.map.on('zoom', this.handleZoomChange);
    };

    handleZoomChange = () => {
        if (!this.pendingZoomUpdate) {
            this.pendingZoomUpdate = true;
            this.zoomRafId = requestAnimationFrame(this.updateAllSizes);
        }
    };

    updateAllSizes = async () => {
        if (!this.map.getSource('magnetic_declinations')) {
            this.pendingZoomUpdate = false;
            return;
        }

        // NOT a diff, on purpose: every zoom-corrected diagram changes size on every zoom step, so
        // the delta IS the collection and a diff would carry one update entry per feature for the
        // same O(N) cost. The read-modify-write still has to start from a drained queue, or the
        // copy read back would be missing whatever is queued and the whole-collection write would
        // then erase it.
        const dispatcher = declinationsSource(this.map);
        await dispatcher.flush();
        if (!this.map) {
            this.pendingZoomUpdate = false;
            return;
        }

        const data = await this.map.getSource('magnetic_declinations').getData();
        if (data.features.length === 0) {
            this.pendingZoomUpdate = false;
            return;
        }

        const currentZoom = this.map.getZoom();
        let hasChanges = false;

        data.features.forEach((feature) => {
            let newCalculatedSize;

            if (feature.properties.zoomCorrectionEnabled === false) {
                newCalculatedSize = feature.properties.size;

                const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
                    feature.geometry.coordinates,
                    feature.properties.width,
                    feature.properties.height,
                    feature.properties.size,
                    0,
                    feature.properties.createdAtZoom,
                    this.selectionManager.uiManager,
                    currentZoom
                );
                feature.properties.selectionBox = newSelectionBox;
                hasChanges = true;
            } else {
                const zoomDifference = currentZoom - feature.properties.createdAtZoom;
                const scaleFactor = Math.pow(2, zoomDifference);
                newCalculatedSize = Math.min(
                    feature.properties.size * scaleFactor,
                    10
                );
            }

            if (feature.properties.calculatedSize !== newCalculatedSize) {
                feature.properties.calculatedSize = newCalculatedSize;
                hasChanges = true;
            }
        });

        if (hasChanges) {
            dispatcher.setData(data);
            await dispatcher.flush();

            const selectedFeatures = this.getSelectedFeatures();
            const featuresWithDisabledZoom = selectedFeatures.filter(
                f => f.properties.zoomCorrectionEnabled === false
            );
            if (featuresWithDisabledZoom.length > 0) {
                featuresWithDisabledZoom.forEach(selectedFeature => {
                    const freshFeature = data.features.find(f => f.properties.id === selectedFeature.properties.id);
                    if (freshFeature) {
                        this.selectionManager.updateSelectedFeature('magnetic_declination', freshFeature.properties.id, freshFeature);
                        if (this.selectionManager.uiManager.invalidateCache) {
                            this.selectionManager.uiManager.invalidateCache(freshFeature.properties.id);
                        }
                    }
                });
                if (this.selectionManager.uiManager.updateSelectionHighlight) {
                    this.selectionManager.uiManager.updateSelectionHighlight();
                }
            }
        }

        this.pendingZoomUpdate = false;
    };

    /**
     * Applies zoom corrections to feature array (used by layer setup).
     * @param {Array} features - Array of declination features
     * @returns {Array} Features with corrected calculatedSize
     */
    applyZoomCorrections = (features) => {
        return applyZoomCorrectionsUtil(features, this.map.getZoom(), {
            sourceProperty: 'size',
            calculatedProperty: 'calculatedSize',
            maxValue: 10,
        });
    };

    // ===== PROPERTY UPDATES =====

    /**
     * Updates a property on one or more features.
     * @param {Array} features - Features to update
     * @param {string} property - Property name
     * @param {*} value - New value
     */
    updateFeaturesProperty = async (features, property, value) => {
        // The collection read survives here on purpose. Two things below need the PREVIOUS source
        // feature and no diff hands them back: whether the feature exists at all (an unknown id
        // must be skipped, not created) and the raster size the selection box is measured from.
        // Draining first keeps that read from being stale.
        const dispatcher = declinationsSource(this.map);
        await dispatcher.flush();
        const data = await this.map.getSource('magnetic_declinations').getData();
        const patches = [];

        for (const feature of features) {
            const sourceFeature = data.features.find(
                (f) => f.properties.id === feature.properties.id
            );
            if (!sourceFeature) continue;

            const setProps = { [property]: value };
            sourceFeature.properties[property] = value;
            feature.properties[property] = value;

            syncZoomCorrectedProperty(
                sourceFeature, feature, property, value, this.map.getZoom(),
                { sourceProperty: 'size', calculatedProperty: 'calculatedSize', maxValue: 10 }
            );

            // Read back rather than recompute: `syncZoomCorrectedProperty` always writes
            // `calculatedSize` and rounds `createdAtZoom`, so the source object is the authority
            // on what the patch has to carry.
            setProps.createdAtZoom = sourceFeature.properties.createdAtZoom;
            setProps.calculatedSize = sourceFeature.properties.calculatedSize;

            // Recalculate selection box when visual properties change
            if (property === 'size' || property === 'createdAtZoom' || property === 'zoomCorrectionEnabled') {
                const effectiveZoom = sourceFeature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
                const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
                    sourceFeature.geometry.coordinates,
                    sourceFeature.properties.width,
                    sourceFeature.properties.height,
                    sourceFeature.properties.size,
                    0,
                    sourceFeature.properties.createdAtZoom,
                    this.selectionManager.uiManager,
                    effectiveZoom
                );

                sourceFeature.properties.selectionBox = newSelectionBox;
                feature.properties.selectionBox = newSelectionBox;
                setProps.selectionBox = newSelectionBox;
            }

            patches.push({ id: sourceFeature.properties.id, setProps });
        }

        // Same drag guard the whole-collection write carried: while the UI owns the on-screen
        // position, a source write would fight it, so the batch is dropped exactly as before.
        if (!this.isSourceUpdateBlocked()) {
            for (const patch of patches) {
                dispatcher.patch(patch.id, { setProps: patch.setProps });
            }
            await dispatcher.flush();
        }

        const freshFeatures = features.map((feature) => {
            const sourceFeature = data.features.find(
                (f) => f.properties.id === feature.properties.id
            );
            return sourceFeature || feature;
        });
        this.updateSelectionManagerFeatures(freshFeatures);

        if (property === 'size' || property === 'createdAtZoom' || property === 'zoomCorrectionEnabled') {
            requestAnimationFrame(() => {
                if (this.selectionManager.uiManager.updateSelectionHighlight) {
                    this.selectionManager.uiManager.updateSelectionHighlight();
                }
            });
        }
    };

    /**
     * Recalculates declination at the feature's current position and regenerates the icon.
     * @param {Object} feature - The declination feature
     */
    async recalculateDeclination(feature) {
        const lat = feature.geometry.coordinates[1];
        const lng = feature.geometry.coordinates[0];
        const wmmResult = calculateMagneticDeclination(lat, lng);

        if (!wmmResult) {
            showError('Erro ao recalcular declinação magnética');
            return;
        }

        const convergence = calculateMeridianConvergence(lat, lng) ?? 0;
        const calculationDate = new Date().toISOString().split('T')[0];

        // The read stays: `regenerateIcon` and the selection sync both want the SOURCE feature,
        // and no diff hands it back. Only the write is a diff.
        const dispatcher = declinationsSource(this.map);
        await dispatcher.flush();
        const data = await this.map.getSource('magnetic_declinations').getData();
        const sourceFeature = data.features.find(
            (f) => f.properties.id === feature.properties.id
        );

        if (sourceFeature) {
            // Eight properties, spelled once and reused as the diff payload: this object IS the
            // delta, so there is nothing to recompute when the patch is built.
            const wmmProps = {
                declination: wmmResult.declination,
                convergence,
                inclination: wmmResult.inclination,
                intensity: wmmResult.intensity,
                latitude: lat,
                longitude: lng,
                calculationDate,
                wmmWarning: wmmResult.warning || null,
            };
            Object.assign(sourceFeature.properties, wmmProps);
            Object.assign(feature.properties, wmmProps);

            await this.regenerateIcon(sourceFeature);
            if (!this.isSourceUpdateBlocked()) {
                dispatcher.patch(sourceFeature.properties.id, { setProps: wmmProps });
                await dispatcher.flush();
            }
            this.updateSelectionManagerFeatures([sourceFeature]);
        }
    }

    /**
     * Lazily backfills meridian convergence for diagrams created before the
     * convergence feature existed, then regenerates the icon. No-op when the
     * convergence is already present. Uses the stored latitude/longitude, so it
     * does not depend on geometry being available.
     * @param {Object} feature - The declination feature
     */
    async ensureConvergence(feature) {
        const id = feature.properties.id;
        if (feature.properties.convergence !== undefined || this._convergenceBackfillIds.has(id)) return;
        this._convergenceBackfillIds.add(id);

        try {
            const { latitude: lat, longitude: lng } = feature.properties;
            const convergence = calculateMeridianConvergence(lat, lng) ?? 0;

            feature.properties.convergence = convergence;

            // The read stays: `regenerateIcon` prefers the SOURCE feature (it carries the
            // declination as persisted), and no diff hands it back.
            const dispatcher = declinationsSource(this.map);
            await dispatcher.flush();
            const data = await this.map.getSource('magnetic_declinations').getData();
            const sourceFeature = data.features.find((f) => f.properties.id === id);
            if (sourceFeature) {
                sourceFeature.properties.convergence = convergence;
            }

            if (sourceFeature && !this.isSourceUpdateBlocked()) {
                dispatcher.patch(id, { setProps: { convergence } });
                await dispatcher.flush();
            }
            const target = sourceFeature || feature;
            await this.regenerateIcon(target);
            this.updateSelectionManagerFeatures([target]);
        } finally {
            this._convergenceBackfillIds.delete(id);
        }
    }

    // ===== MOVE SUPPORT =====

    /**
     * Updates feature geometry and selection box after a drag move.
     * Also recalculates declination at the new position.
     * @param {Object} feature - Feature being moved
     * @param {number} _dx - Delta X (unused, newCoords used instead)
     * @param {number} _dy - Delta Y (unused)
     * @param {Object} newCoords - New coordinates { lng, lat }
     * @returns {Object} Updated feature
     */
    updateFeatureForMove(feature, _dx, _dy, newCoords) {
        const newCoordinates = [newCoords.lng, newCoords.lat];

        const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
        const newSelectionBox = this.geometry.calculateSelectionBoxGeometry(
            newCoordinates,
            feature.properties.width,
            feature.properties.height,
            feature.properties.size,
            0,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            effectiveZoom
        );

        return {
            ...feature,
            geometry: this.geometry.generate(newCoordinates),
            properties: {
                ...feature.properties,
                selectionBox: newSelectionBox,
            },
        };
    }

    syncEditHandlesAfterDrag = async (movedFeatures) => {
        // Update source geometries first, then recalculate declination. The moved feature already
        // carries the post-drag geometry and box, so a geometry patch per feature replaces the
        // read-modify-write; a patch of an id that is not in the source is the same silent no-op
        // the `if (sourceFeature)` guard used to produce.
        const dispatcher = declinationsSource(this.map);
        if (!this.isSourceUpdateBlocked()) {
            for (const feature of movedFeatures) {
                dispatcher.patch(feature.properties.id, {
                    geometry: { ...feature.geometry },
                    setProps: { selectionBox: feature.properties.selectionBox },
                });
            }
            await dispatcher.flush();
        }

        for (const feature of movedFeatures) {
            await this.recalculateDeclination(feature);
        }
    };

    // ===== PERSISTENCE =====

    saveFeatures = async (features, initialPropertiesMap) => {
        // Reads only, and it persists the SOURCE's version of each feature rather than the
        // selected one, so the queue has to be drained before the collection comes back.
        await declinationsSource(this.map).flush();
        const currentData = await this.map.getSource('magnetic_declinations').getData();

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(
                    (f) => f.properties.id === selectedFeature.properties.id
                );
                if (currentFeature) {
                    await updateFeature('magnetic_declinations', currentFeature);
                }
            }
        }
    };

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        // The snapshot IS the delta: `Object.assign` over the source properties is exactly a
        // property patch, so no collection read is needed to build it.
        const dispatcher = declinationsSource(this.map);
        for (const f of features) {
            const initialProps = initialPropertiesMap.get(f.properties.id);
            Object.assign(f.properties, initialProps);
            if (initialProps && !this.isSourceUpdateBlocked()) {
                dispatcher.patch(f.properties.id, { setProps: initialProps });
            }
        }

        await dispatcher.flush();
        this.updateSelectionManagerFeatures(features);
    };

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        // Persist the deletion to the store, not just the in-memory source —
        // otherwise the diagram reappears from IndexedDB on the next load. The
        // rasterized PNG blob is released later, on undo-history eviction, so an
        // Undo can still restore the diagram.
        for (const feature of features) {
            const featureId = feature.properties.id;
            try {
                await removeFeature('magnetic_declinations', featureId);
            } catch (error) {
                console.error('Error removing declination feature:', error);
            }
        }

        // Removal by promoted key, with no collection read. The keys go in raw, never coerced:
        // MapLibre keyed the feature by the very value that sits in `properties.id`, so a
        // `String()` around it would miss a numeric key instead of protecting anything.
        const dispatcher = declinationsSource(this.map);
        dispatcher.remove(features.map(f => f.properties.id));
        await dispatcher.flush();
    };

    // ===== HELPERS =====

    isSourceUpdateBlocked = () => {
        return this.selectionManager.uiManager?.isDragging;
    };

    ensureFeatureConsistency = (feature, currentZoom = null, forceRecalculateSelectionBox = false) => {
        const zoom = currentZoom || this.map.getZoom();

        if (feature.properties.zoomCorrectionEnabled === false) {
            feature.properties.calculatedSize = feature.properties.size;
        } else {
            const zoomDifference = zoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            feature.properties.calculatedSize = Math.min(
                feature.properties.size * scaleFactor,
                10
            );
        }

        if (forceRecalculateSelectionBox && !this.isSourceUpdateBlocked()) {
            const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? zoom : null;
            feature.properties.selectionBox = this.geometry.calculateSelectionBoxGeometry(
                feature.geometry.coordinates,
                feature.properties.width,
                feature.properties.height,
                feature.properties.size,
                0,
                feature.properties.createdAtZoom,
                this.selectionManager.uiManager,
                effectiveZoom
            );
        }

        return feature;
    };

    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('magnetic_declination', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach((feature) => {
            if (feature.properties.source === 'magnetic_declination') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    getSourceNames() {
        return ['magnetic_declinations'];
    }

    getEditHandleSource() {
        return null;
    }

    getSelectionBoxStrategy() {
        return 'preCalculated';
    }

    createSelectionBox(feature) {
        if (feature.properties.selectionBox) {
            return { geometry: feature.properties.selectionBox };
        }

        // Fallback: calculate on demand if missing
        const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? this.map.getZoom() : null;
        const selectionBox = this.geometry.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.width,
            feature.properties.height,
            feature.properties.size,
            0,
            feature.properties.createdAtZoom,
            this.selectionManager.uiManager,
            effectiveZoom
        );

        return { geometry: selectionBox };
    }

    setupBaseEventListeners = () => {};

    removeAllEventListeners = () => {
        if (this.zoomRafId) {
            cancelAnimationFrame(this.zoomRafId);
            this.zoomRafId = null;
        }
        this.pendingZoomUpdate = false;
    };
}

export default AddDeclinationControl;
