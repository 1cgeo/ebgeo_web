// Path: js/phone/phone-layout.js

/**
 * @fileoverview Phone layout orchestrator for EBGeo (<=480px).
 * Detects phone viewport via matchMedia, creates/destroys all phone-specific
 * components, and wires inter-component communication and store integration.
 *
 * Lifecycle:
 * - init()                 — check media query, activate if phone, listen for changes
 * - _activatePhoneMode()   — create all components, mount to body, wire events
 * - _deactivatePhoneMode() — destroy all components, unwire events
 * - destroy()              — full cleanup
 */

import { PhoneBottomSheet } from './phone-bottom-sheet.js';
import { PhoneSearchOverlay } from './phone-search-overlay.js';
import { PhoneFabs } from './phone-fabs.js';
import { PhoneMoveActions } from './phone-move-actions.js';
import { PhoneFeatureEditor } from './phone-feature-editor.js';
import { getEventBus, getControl } from '@store/services.js';
import {
    getFeatureById,
    updateFeature,
    getCurrentMapNameSync,
    getLayers,
    getCurrentMapFeatures,
    getAllStorageTypes,
} from '@store';
import { EventTypes } from '@events/event_types.js';
import { showToast } from '@utils';
import config from '../config.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const PHONE_QUERY = '(max-width: 480px)';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Phone layout orchestrator.
 * Creates, mounts, wires, and destroys all phone-specific UI components.
 */
export class PhoneLayout {
    /**
     * @param {Object} options
     * @param {import('maplibre-gl').Map} options.map - MapLibre GL map instance
     */
    constructor({ map }) {
        /** @private */
        this._map = map;
        /** @private */
        this._active = false;
        /** @private */
        this._mediaQuery = null;
        /** @private */
        this._mediaHandler = null;

        // Component references (set in _activatePhoneMode)
        /** @private */
        this._bottomSheet = null;
        /** @private */
        this._searchOverlay = null;
        /** @private */
        this._fabs = null;
        /** @private */
        this._moveActions = null;
        /** @private */
        this._featureEditor = null;

        // Event subscriptions to clean up
        /** @private */
        this._eventUnsubscribers = [];
        /** @private */
        this._mapClickHandler = null;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Initialize the phone layout.
     * Checks media query and activates if viewport matches.
     * Listens for viewport changes to activate/deactivate dynamically.
     */
    init() {
        this._mediaQuery = window.matchMedia(PHONE_QUERY);
        this._mediaHandler = (e) => {
            if (e.matches) {
                this._activatePhoneMode();
            } else {
                this._deactivatePhoneMode();
            }
        };

        // Listen for future changes
        this._mediaQuery.addEventListener('change', this._mediaHandler);

        // Activate immediately if already in phone viewport
        if (this._mediaQuery.matches) {
            this._activatePhoneMode();
        }
    }

    /**
     * Full cleanup — remove media listener and deactivate phone mode.
     */
    destroy() {
        if (this._mediaQuery && this._mediaHandler) {
            this._mediaQuery.removeEventListener('change', this._mediaHandler);
        }
        this._deactivatePhoneMode();
        this._mediaQuery = null;
        this._mediaHandler = null;
    }

    // ========================================================================
    // LIFECYCLE
    // ========================================================================

    /**
     * Activate phone mode: create all components, mount to body, wire events.
     * @private
     */
    _activatePhoneMode() {
        if (this._active) return;
        this._active = true;

        const map = this._map;
        const body = document.body;

        // Create components
        this._bottomSheet = new PhoneBottomSheet({ map });
        this._searchOverlay = new PhoneSearchOverlay({ map });
        this._fabs = new PhoneFabs({ map });
        this._moveActions = new PhoneMoveActions();
        this._featureEditor = new PhoneFeatureEditor();

        // Mount components to DOM
        this._bottomSheet.mount(body);
        this._searchOverlay.mount(body);
        this._fabs.mount(body);
        this._moveActions.mount(body);
        this._featureEditor.mount(body);

        // Wire inter-component communication
        this._wireBottomSheetToFabs();
        this._wireFeatureSelection();
        this._wireFeatureEditorCallbacks();
        this._wireSearch();
        this._wireLayerUpdates();
        this._wireMapInfo();
        this._wireBaseLayerCycling();
        this._wireMapTapDeselect();

        // Add phone mode class to body for CSS targeting
        body.classList.add('phone-mode');
    }

    /**
     * Deactivate phone mode: destroy all components, unwire events.
     * @private
     */
    _deactivatePhoneMode() {
        if (!this._active) return;
        this._active = false;

        // Remove event subscriptions
        this._unwireEvents();

        // Destroy components
        if (this._bottomSheet) {
            this._bottomSheet.destroy();
            this._bottomSheet = null;
        }
        if (this._searchOverlay) {
            this._searchOverlay.destroy();
            this._searchOverlay = null;
        }
        if (this._fabs) {
            this._fabs.destroy();
            this._fabs = null;
        }
        if (this._moveActions) {
            this._moveActions.destroy();
            this._moveActions = null;
        }
        if (this._featureEditor) {
            this._featureEditor.destroy();
            this._featureEditor = null;
        }

        document.body.classList.remove('phone-mode');
    }

    // ========================================================================
    // WIRING
    // ========================================================================

    /**
     * Wire bottom sheet state changes to FABs repositioning.
     * @private
     */
    _wireBottomSheetToFabs() {
        this._bottomSheet.onStateChange((state) => {
            this._fabs.onSheetStateChange(state);
        });
    }

    /**
     * Wire feature selection events to bottom sheet and feature editor.
     * @private
     */
    _wireFeatureSelection() {
        const eventBus = getEventBus();

        const onFeaturePanelOpened = async ({ featureId, featureType }) => {
            try {
                const feature = await getFeatureById(featureType, featureId);
                if (feature) {
                    const featureData = this._buildFeatureData(feature, featureType);
                    this._featureEditor.showFeature(featureData);
                    this._bottomSheet.setFeatureContent(this._featureEditor.getElement());
                    this._bottomSheet.snapTo('half');
                }
            } catch (err) {
                console.error('PhoneLayout: error loading feature for panel:', err);
            }
        };

        const onFeaturePanelClosed = () => {
            this._featureEditor.clear();
            this._bottomSheet.clearFeatureContent();
        };

        eventBus.on(EventTypes.FEATURE_PANEL_OPENED, onFeaturePanelOpened);
        eventBus.on(EventTypes.FEATURE_PANEL_CLOSED, onFeaturePanelClosed);

        this._eventUnsubscribers.push(
            () => eventBus.off(EventTypes.FEATURE_PANEL_OPENED, onFeaturePanelOpened),
            () => eventBus.off(EventTypes.FEATURE_PANEL_CLOSED, onFeaturePanelClosed),
        );
    }

    /**
     * Wire feature editor save and move callbacks.
     * @private
     */
    _wireFeatureEditorCallbacks() {
        // Save callback
        this._featureEditor.onSave(async (featureId, properties) => {
            try {
                // Find the feature type from the current feature data
                const featureData = this._featureEditor._featureData;
                if (!featureData) return;

                await updateFeature(featureData.type, featureId, { properties });
                showToast('Feição atualizada', 'success');
            } catch (err) {
                console.error('PhoneLayout: error saving feature:', err);
                showToast('Erro ao atualizar feição', 'error');
            }
        });

        // Move start callback
        this._featureEditor.onMoveStart((_featureId) => {
            // Collapse sheet, hide FABs, show move actions
            this._bottomSheet.snapTo('peek');
            this._fabs.hide();

            this._moveActions.show(
                // Confirm: restore UI
                () => {
                    this._moveActions.hide();
                    this._fabs.show();
                    this._bottomSheet.snapTo('half');
                    this._featureEditor.exitMoveMode();
                    showToast('Posição atualizada', 'success');
                },
                // Cancel: restore UI
                () => {
                    this._moveActions.hide();
                    this._fabs.show();
                    this._bottomSheet.snapTo('half');
                    this._featureEditor.exitMoveMode();
                },
            );
        });
    }

    /**
     * Wire search overlay callbacks.
     * @private
     */
    _wireSearch() {
        this._searchOverlay.onSearch(async (query) => {
            if (!query) {
                this._searchOverlay.clearResults();
                return;
            }
            const results = await this._searchFeatures(query);
            this._searchOverlay.setResults(results);
        });

        this._searchOverlay.onResultSelect((result) => {
            if (result.coordinates) {
                this._map.flyTo({ center: result.coordinates, zoom: 14 });
            }
            this._searchOverlay.close();
        });
    }

    /**
     * Wire layer change events to bottom sheet.
     * @private
     */
    _wireLayerUpdates() {
        const eventBus = getEventBus();

        const onLayersChanged = () => {
            const layers = this._getLayerData();
            this._bottomSheet.updateLayers(layers);

            // Update feature count in map info
            this._updateMapInfoFeatureCount();
        };

        eventBus.on(EventTypes.LAYERS_CHANGED, onLayersChanged);
        this._eventUnsubscribers.push(
            () => eventBus.off(EventTypes.LAYERS_CHANGED, onLayersChanged),
        );

        // Initial layer load
        const layers = this._getLayerData();
        this._bottomSheet.updateLayers(layers);
    }

    /**
     * Wire map info updates to bottom sheet.
     * @private
     */
    _wireMapInfo() {
        const info = this._getMapInfo();
        this._bottomSheet.updateMapInfo(info);

        // Update on map lock change (which fires on map switch)
        const eventBus = getEventBus();
        const onMapLockChanged = () => {
            const updatedInfo = this._getMapInfo();
            this._bottomSheet.updateMapInfo(updatedInfo);

            // Also refresh layers
            const layers = this._getLayerData();
            this._bottomSheet.updateLayers(layers);
        };

        eventBus.on(EventTypes.MAP_LOCK_CHANGED, onMapLockChanged);
        this._eventUnsubscribers.push(
            () => eventBus.off(EventTypes.MAP_LOCK_CHANGED, onMapLockChanged),
        );
    }

    /**
     * Wire base layer cycling FAB.
     * @private
     */
    _wireBaseLayerCycling() {
        try {
            const enabledBasemaps = config.getEnabledBasemaps();
            const names = enabledBasemaps.map(([, cfg]) => cfg.name || cfg.id);
            this._fabs.setBaseLayerNames(names);

            this._fabs.onBaseLayerCycle((_name, index) => {
                const baseLayerControl = getControl('BaseLayerControl');
                if (baseLayerControl) {
                    const enabledList = config.getEnabledBasemaps();
                    if (index < enabledList.length) {
                        const [layerId] = enabledList[index];
                        baseLayerControl.executeLayerChange(layerId);
                    }
                }
            });
        } catch (_e) {
            // Config may not have basemaps configured
            this._fabs.setBaseLayerNames([]);
        }
    }

    /**
     * Wire map tap on empty area to deselect and collapse sheet.
     * @private
     */
    _wireMapTapDeselect() {
        this._mapClickHandler = (e) => {
            // Only deselect if no feature was clicked
            const features = this._map.queryRenderedFeatures(e.point);
            if (!features || features.length === 0) {
                this._featureEditor.clear();
                this._bottomSheet.clearFeatureContent();
                this._bottomSheet.snapTo('peek');
            }
        };

        this._map.on('click', this._mapClickHandler);
    }

    /**
     * Remove all event subscriptions and map handlers.
     * @private
     */
    _unwireEvents() {
        for (const unsub of this._eventUnsubscribers) {
            try {
                unsub();
            } catch (_e) {
                // Ignore cleanup errors
            }
        }
        this._eventUnsubscribers = [];

        if (this._mapClickHandler && this._map) {
            this._map.off('click', this._mapClickHandler);
            this._mapClickHandler = null;
        }
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    /**
     * Build feature data in the shape PhoneFeatureEditor expects.
     * @param {Object} feature - GeoJSON feature from store
     * @param {string} featureType - Storage type (e.g. 'point', 'polygon')
     * @returns {Object} Feature data for PhoneFeatureEditor
     * @private
     */
    _buildFeatureData(feature, featureType) {
        const props = feature.properties || {};

        // Find the layer name for this feature
        let layerName = '';
        try {
            const layers = getLayers();
            const layer = layers.find(l => l.id === props.layerId);
            layerName = layer ? (layer.nome || layer.name || '') : '';
        } catch (_e) {
            // Layer lookup failed
        }

        // Build display properties (filter out internal ones)
        const displayProperties = {};
        const internalKeys = new Set([
            'id', 'layerId', 'type', 'createdAt', 'updatedAt',
            'version', 'ownerId', 'dirty', 'deleted', 'color',
        ]);

        for (const [key, value] of Object.entries(props)) {
            if (!internalKeys.has(key) && !key.startsWith('_')) {
                displayProperties[key] = value;
            }
        }

        return {
            id: props.id,
            type: featureType,
            name: props.nome || props.name || props.descricao || 'Sem nome',
            layerName,
            color: props.color || props.cor || '',
            properties: displayProperties,
        };
    }

    /**
     * Get layer data in the shape PhoneBottomSheet expects.
     * @returns {Array<Object>} Layers array
     * @private
     */
    _getLayerData() {
        try {
            const layers = getLayers();
            return layers.map(layer => ({
                id: layer.id,
                nome: layer.nome || layer.name || '',
                visivel: layer.visivel !== false,
                featureCount: layer.featureCount || 0,
                color: layer.color || '',
            }));
        } catch (_e) {
            return [];
        }
    }

    /**
     * Get atlas/map info for the bottom sheet.
     * @returns {Object} Map info with atlasName, mapName, layerCount, featureCount
     * @private
     */
    _getMapInfo() {
        try {
            const mapName = getCurrentMapNameSync();
            const layers = getLayers();
            return {
                atlasName: 'Atlas',
                mapName: mapName || '',
                layerCount: layers.length,
                featureCount: 0, // Updated async via _updateMapInfoFeatureCount
            };
        } catch (_e) {
            return {
                atlasName: 'Atlas',
                mapName: '',
                layerCount: 0,
                featureCount: 0,
            };
        }
    }

    /**
     * Update feature count in map info asynchronously.
     * @private
     */
    async _updateMapInfoFeatureCount() {
        try {
            const features = await getCurrentMapFeatures();
            let count = 0;
            for (const storageType of getAllStorageTypes()) {
                const typeFeatures = features[storageType] || [];
                count += typeFeatures.length;
            }
            this._bottomSheet.updateMapInfo({ featureCount: count });
        } catch (_e) {
            // Feature count update is non-critical
        }
    }

    /**
     * Search features across all layers by name/description.
     * @param {string} query - Search query
     * @returns {Promise<Array<Object>>} Search results
     * @private
     */
    async _searchFeatures(query) {
        const results = [];
        const lowerQuery = query.toLowerCase();

        try {
            const features = await getCurrentMapFeatures();
            const layers = getLayers();
            const layerMap = new Map(layers.map(l => [l.id, l]));

            for (const storageType of getAllStorageTypes()) {
                const typeFeatures = features[storageType] || [];
                for (const feature of typeFeatures) {
                    const props = feature.properties || {};
                    const nome = props.nome || props.name || '';
                    const descricao = props.descricao || '';

                    if (
                        nome.toLowerCase().includes(lowerQuery) ||
                        descricao.toLowerCase().includes(lowerQuery)
                    ) {
                        // Get coordinates from geometry
                        let coordinates = null;
                        if (feature.geometry) {
                            coordinates = this._getFeatureCentroid(feature.geometry);
                        }

                        const layer = layerMap.get(props.layerId);
                        const layerName = layer ? (layer.nome || layer.name || '') : '';

                        results.push({
                            id: props.id,
                            text: nome || 'Sem nome',
                            subtitle: layerName,
                            coordinates,
                        });
                    }

                    // Limit results to avoid performance issues
                    if (results.length >= 50) break;
                }
                if (results.length >= 50) break;
            }
        } catch (err) {
            console.error('PhoneLayout: search error:', err);
        }

        return results;
    }

    /**
     * Get centroid coordinates from a GeoJSON geometry.
     * @param {Object} geometry - GeoJSON geometry
     * @returns {[number, number]|null} [lng, lat] or null
     * @private
     */
    _getFeatureCentroid(geometry) {
        if (!geometry || !geometry.type) return null;

        switch (geometry.type) {
        case 'Point':
            return geometry.coordinates ? [...geometry.coordinates].slice(0, 2) : null;
        case 'LineString':
            if (geometry.coordinates && geometry.coordinates.length > 0) {
                // Use midpoint of line
                const mid = Math.floor(geometry.coordinates.length / 2);
                return [...geometry.coordinates[mid]].slice(0, 2);
            }
            return null;
        case 'Polygon':
            if (geometry.coordinates && geometry.coordinates[0] && geometry.coordinates[0].length > 0) {
                // Simple centroid: average of exterior ring vertices
                const ring = geometry.coordinates[0];
                let sumLng = 0;
                let sumLat = 0;
                for (const coord of ring) {
                    sumLng += coord[0];
                    sumLat += coord[1];
                }
                return [sumLng / ring.length, sumLat / ring.length];
            }
            return null;
        default:
            return null;
        }
    }
}
