// Path: js/military_tools/declination_tool/add_declination_control.js

/**
 * @fileoverview Control for placing magnetic declination diagrams on the map.
 * Single-click placement with WMM2025 auto-calculation.
 */

import {
    addFeature,
    updateFeature,
    storeImage,
    getActiveLayerIdSync
} from '@store';
import { IDUtils, showError } from '@utils';
import { calculateMagneticDeclination } from '@utils/geomagnetic/wmm_calculator.js';
import { convertSvgToPngBlob } from '../svg-to-png.js';
import { addDeclinationAttributesToPanel } from './declination_attributes_panel.js';
import AddDeclinationGeometry from './add_declination_geometry.js';
import { generateDeclinationSvg } from './declination_svg_generator.js';
import { BaseControl } from '@tools';

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
    };

    onRemove = () => {
        this.map.off('zoom', this.handleZoomChange);
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

        // Generate SVG diagram and convert to PNG
        const svgString = generateDeclinationSvg(declination);
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
            await addFeature('magnetic_declinations', feature);

            const data = await this.map.getSource('magnetic_declinations').getData();
            data.features.push(feature);
            this.map.getSource('magnetic_declinations').setData(data);

            await this.loadIconToMap(featureId, blob);

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
        const url = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
            const image = new Image();

            const timeoutId = setTimeout(() => {
                URL.revokeObjectURL(url);
                reject(new Error(`Timeout loading declination icon ${iconId}`));
            }, 10000);

            image.onload = () => {
                clearTimeout(timeoutId);
                try {
                    if (this.map.hasImage(iconId)) {
                        this.map.removeImage(iconId);
                    }
                    if (!this.map.hasImage(iconId)) {
                        this.map.addImage(iconId, image);
                    }
                    URL.revokeObjectURL(url);
                    resolve();
                } catch (error) {
                    URL.revokeObjectURL(url);
                    reject(error);
                }
            };

            image.onerror = () => {
                clearTimeout(timeoutId);
                URL.revokeObjectURL(url);
                reject(new Error(`Failed to load declination icon ${iconId}`));
            };

            image.src = url;
        });
    }

    /**
     * Regenerates the diagram SVG/PNG for a feature and updates the map icon.
     * @param {Object} feature - The declination feature
     */
    async regenerateIcon(feature) {
        const svgString = generateDeclinationSvg(feature.properties.declination);

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
            this.map.getSource('magnetic_declinations').setData(data);

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
        const currentZoom = this.map.getZoom();
        return features.map((feature) => {
            const isEnabled = feature.properties.zoomCorrectionEnabled !== false;

            if (!isEnabled) {
                return {
                    ...feature,
                    properties: {
                        ...feature.properties,
                        calculatedSize: feature.properties.size,
                    },
                };
            }

            const zoomDifference = currentZoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            const newCalculatedSize = Math.min(
                feature.properties.size * scaleFactor,
                10
            );

            return {
                ...feature,
                properties: {
                    ...feature.properties,
                    calculatedSize: newCalculatedSize,
                },
            };
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
        const data = await this.map.getSource('magnetic_declinations').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(
                (f) => f.properties.id === feature.properties.id
            );
            if (!sourceFeature) continue;

            sourceFeature.properties[property] = value;
            feature.properties[property] = value;

            // Handle zoom correction toggle
            if (property === 'zoomCorrectionEnabled') {
                let newCalculatedSize;
                if (value === false) {
                    newCalculatedSize = sourceFeature.properties.size;
                } else {
                    const currentZoom = this.map.getZoom();
                    const zoomDifference = currentZoom - sourceFeature.properties.createdAtZoom;
                    const scaleFactor = Math.pow(2, zoomDifference);
                    newCalculatedSize = Math.min(sourceFeature.properties.size * scaleFactor, 10);
                }
                sourceFeature.properties.calculatedSize = newCalculatedSize;
                feature.properties.calculatedSize = newCalculatedSize;
            } else if (property === 'createdAtZoom') {
                const roundedValue = Math.round(value * 10) / 10;
                sourceFeature.properties[property] = roundedValue;
                feature.properties[property] = roundedValue;

                if (sourceFeature.properties.zoomCorrectionEnabled !== false) {
                    const currentZoom = this.map.getZoom();
                    const zoomDifference = currentZoom - roundedValue;
                    const scaleFactor = Math.pow(2, zoomDifference);
                    const newCalculatedSize = Math.min(
                        sourceFeature.properties.size * scaleFactor,
                        10
                    );
                    sourceFeature.properties.calculatedSize = newCalculatedSize;
                    feature.properties.calculatedSize = newCalculatedSize;
                }
            } else {
                // Recalculate calculatedSize for size changes
                if (sourceFeature.properties.zoomCorrectionEnabled === false) {
                    sourceFeature.properties.calculatedSize = sourceFeature.properties.size;
                    feature.properties.calculatedSize = sourceFeature.properties.size;
                } else {
                    const currentZoom = this.map.getZoom();
                    const zoomDifference = currentZoom - sourceFeature.properties.createdAtZoom;
                    const scaleFactor = Math.pow(2, zoomDifference);
                    sourceFeature.properties.calculatedSize = Math.min(
                        sourceFeature.properties.size * scaleFactor,
                        10
                    );
                    feature.properties.calculatedSize = sourceFeature.properties.calculatedSize;
                }
            }

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
            }
        }

        this.forceUpdateMainSource(data);
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

        const now = new Date();
        const data = await this.map.getSource('magnetic_declinations').getData();
        const sourceFeature = data.features.find(
            (f) => f.properties.id === feature.properties.id
        );

        if (sourceFeature) {
            sourceFeature.properties.declination = wmmResult.declination;
            sourceFeature.properties.inclination = wmmResult.inclination;
            sourceFeature.properties.intensity = wmmResult.intensity;
            sourceFeature.properties.latitude = lat;
            sourceFeature.properties.longitude = lng;
            sourceFeature.properties.calculationDate = now.toISOString().split('T')[0];
            sourceFeature.properties.wmmWarning = wmmResult.warning || null;

            feature.properties.declination = wmmResult.declination;
            feature.properties.inclination = wmmResult.inclination;
            feature.properties.intensity = wmmResult.intensity;
            feature.properties.latitude = lat;
            feature.properties.longitude = lng;
            feature.properties.calculationDate = now.toISOString().split('T')[0];
            feature.properties.wmmWarning = wmmResult.warning || null;

            await this.regenerateIcon(sourceFeature);
            this.forceUpdateMainSource(data);
            this.updateSelectionManagerFeatures([sourceFeature]);
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
        // Update source geometries first, then recalculate declination
        const data = await this.map.getSource('magnetic_declinations').getData();

        for (const feature of movedFeatures) {
            const sourceFeature = data.features.find(
                f => f.properties.id === feature.properties.id
            );
            if (sourceFeature) {
                sourceFeature.geometry = { ...feature.geometry };
                sourceFeature.properties.selectionBox = feature.properties.selectionBox;
            }
        }

        this.forceUpdateMainSource(data);

        for (const feature of movedFeatures) {
            await this.recalculateDeclination(feature);
        }
    };

    // ===== PERSISTENCE =====

    saveFeatures = async (features, initialPropertiesMap) => {
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
        for (const f of features) {
            const initialProps = initialPropertiesMap.get(f.properties.id);
            Object.assign(f.properties, initialProps);
        }

        const data = await this.map.getSource('magnetic_declinations').getData();
        for (const f of features) {
            const sourceFeature = data.features.find(sf => sf.properties.id === f.properties.id);
            if (sourceFeature) {
                const initialProps = initialPropertiesMap.get(f.properties.id);
                Object.assign(sourceFeature.properties, initialProps);
            }
        }
        this.forceUpdateMainSource(data);
        this.updateSelectionManagerFeatures(features);
    };

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        const data = await this.map.getSource('magnetic_declinations').getData();
        const idsToDelete = new Set(features.map(f => f.properties.id));
        data.features = data.features.filter(f => !idsToDelete.has(f.properties.id));
        this.forceUpdateMainSource(data);
    };

    // ===== HELPERS =====

    forceUpdateMainSource = (data) => {
        if (this.selectionManager.uiManager?.isDragging) return;
        this.map.getSource('magnetic_declinations').setData(data);
    };

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
