// Path: js/tool_manager/ui_manager.js

/**
 * @fileoverview UI manager for feature selection, attribute panels, and profile display.
 * Handles selection highlighting, attribute editing panels, and profile charts.
 */

import {
    Chart,
    LineController,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Filler,
    Tooltip,
    Legend
} from 'chart.js';
import { cleanupFeatureDropdownListeners } from './helpers';
import { getStateManager, getEventBus } from '../store';
import { injectTabbedPanelStyles } from './tabbed_attribute_panel.js';
import { EventTypes } from '../events/event_types.js';

// Register Chart.js components (tree-shaking)
Chart.register(
    LineController,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Filler,
    Tooltip,
    Legend
);

class UIManager {
    /**
     * @param {Object} map - MapLibre map instance
     * @param {Object} selectionManager - Selection manager instance
     * @param {Object} toolManager - Tool manager instance
     */
    constructor(map, selectionManager, toolManager) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.toolManager = toolManager;
        this.featureSearchControl = null;

        this.selectionBoxes = [];

        // Cache for selection box calculations (performance optimization)
        this.selectionBoxCache = new Map();
        this.geometryHashes = new Map();
        this.rafId = null;

        this.activeChart = null;

        /** @type {Array<Function>} Cleanup functions for subscriptions */
        this._unsubscribers = [];

        this._initSubscriptions();
        this.map.on('zoom', this._handleZoomChange);

        // Injetar estilos do TabbedPanel uma vez
        injectTabbedPanelStyles();
    }

    // =========================================================================
    // STATE MANAGER INTEGRATION
    // =========================================================================

    /**
     * Initialize StateManager subscriptions.
     * @private
     */
    _initSubscriptions() {
        try {
            const stateManager = getStateManager();

            // Subscribe to selection changes for selection box updates only.
            // Panel updates are handled explicitly by SelectionManager.updateUI()
            // to avoid unnecessary panel recreation during property edits.
            this._unsubscribers.push(
                stateManager.subscribe('selection.features', (features) => {
                    // Only update selection highlight (boxes), not panels
                    // Panels are managed explicitly to avoid flicker during edits
                    this.updateSelectionHighlight();
                })
            );
        } catch (e) {
            // StateManager not available yet - will work without subscriptions
        }
    }

    /**
     * Get dragging state from StateManager.
     * @returns {boolean}
     */
    get isDragging() {
        try {
            return getStateManager().get('ui.isDragging') || false;
        } catch (e) {
            return false;
        }
    }

    /**
     * Set dragging state in StateManager.
     * @param {boolean} isDragging
     */
    setDragging(isDragging) {
        try {
            getStateManager().set('ui.isDragging', isDragging);
        } catch (e) {
            // StateManager not available
        }
    }

    // =========================================================================
    // ZOOM HANDLING
    // =========================================================================

    /**
     * Handle map zoom changes with debouncing.
     * @private
     */
    _handleZoomChange = () => {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        this.rafId = requestAnimationFrame(() => {
            if (this.selectionManager.hasSelectedFeatures()) {
                this.updateSelectionHighlight();
            }
            this.rafId = null;
        });
    }

    // =========================================================================
    // CACHE MANAGEMENT
    // =========================================================================

    /**
     * Get cache key for feature at current zoom level.
     * @param {string} featureId
     * @returns {string}
     */
    getCacheKey(featureId) {
        const zoom = this.map.getZoom();
        const zoomLevel = Math.round(zoom * 2) / 2;
        return `${featureId}-${zoomLevel}`;
    }

    setFeatureSearchControl(featureSearchControl) {
        this.featureSearchControl = featureSearchControl;
    }

    setMouseCoordinatesControl(mouseCoordinatesControl) {
        this.mouseCoordinatesControl = mouseCoordinatesControl;
    }

    /**
     * Calculate geometry hash for cache invalidation.
     * @param {Object} feature - GeoJSON feature
     * @returns {string}
     */
    calculateGeometryHash(feature) {
        const coords = JSON.stringify(feature.geometry.coordinates);
        const props = JSON.stringify({
            center: feature.properties.center,
            radius: feature.properties.radius,
            majorRadius: feature.properties.majorRadius,
            minorRadius: feature.properties.minorRadius,
            bearing: feature.properties.bearing,
            text: feature.properties.text,
            size: feature.properties.size,
            rotation: feature.properties.rotation,
            width: feature.properties.width,
            height: feature.properties.height,
            anchor: feature.properties.anchor,
            selectionBox: feature.properties.selectionBox ? JSON.stringify(feature.properties.selectionBox) : null
        });

        let hash = 0;
        const str = coords + props;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    /**
     * Invalidate cache for specific feature.
     * @param {string} featureId
     */
    invalidateCache(featureId) {
        if (featureId) {
            const keysToDelete = [];
            for (const key of this.selectionBoxCache.keys()) {
                if (key.startsWith(`${featureId}-`)) {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(key => this.selectionBoxCache.delete(key));
            this.geometryHashes.delete(featureId);
        }
    }

    /**
     * Invalidate entire selection box cache.
     */
    invalidateAllCache() {
        this.selectionBoxCache.clear();
        this.geometryHashes.clear();
    }

    /**
     * Notify geometry change (for cache invalidation).
     * @param {string} featureId
     */
    notifyGeometryChange(featureId) {
        this.invalidateCache(featureId);
    }

    // =========================================================================
    // TOOL-CENTRIC SELECTION HIGHLIGHTING
    // =========================================================================

    /**
     * Main selection highlight update using tool-centric approach.
     */
    updateSelectionHighlight = () => {
        if (this.isDragging) return;

        const selectionBoxesSource = this.map.getSource('selection-boxes');
        if (!selectionBoxesSource) return;

        const featuresByType = this.groupSelectedFeaturesByType();
        const allSelectionBoxes = [];

        for (const [type, features] of featuresByType.entries()) {
            const selectionBoxes = this.createSelectionBoxesForTypeToolCentric(type, features);
            allSelectionBoxes.push(...selectionBoxes);
        }

        this.selectionBoxes = allSelectionBoxes;
        selectionBoxesSource.setData({
            type: 'FeatureCollection',
            features: allSelectionBoxes
        });
    }

    /**
     * Group selected features by type for efficient processing.
     * Uses StateManager as source of truth.
     * @returns {Map<string, Array<Object>>}
     */
    groupSelectedFeaturesByType() {
        const featuresByType = new Map();

        try {
            const selectedFeatures = getStateManager().getSelectedFeatures();

            for (const item of selectedFeatures) {
                if (!featuresByType.has(item.type)) {
                    featuresByType.set(item.type, []);
                }
                featuresByType.get(item.type).push(item.feature);
            }
        } catch (e) {
            // StateManager not available - return empty map
        }

        return featuresByType;
    }

    /**
     * Create selection boxes for features of a specific type using tool-centric approach.
     * @param {string} type - Feature type
     * @param {Array<Object>} features - GeoJSON features
     * @returns {Array<Object>}
     */
    createSelectionBoxesForTypeToolCentric(type, features) {
        if (features.length === 0) return [];

        const control = this.selectionManager.controls.get(type);

        if (!this.supportsToolCentricSelectionBoxes(control)) {
            console.warn(`Tool ${type} does not implement tool-centric selection box interface`);
            return [];
        }

        return this.createSelectionBoxesToolCentric(features, control);
    }

    /**
     * Check if control supports tool-centric selection box interface.
     * @param {Object} control
     * @returns {boolean}
     */
    supportsToolCentricSelectionBoxes(control) {
        return control &&
            typeof control.createSelectionBox === 'function' &&
            typeof control.getSelectionBoxStrategy === 'function';
    }

    /**
     * Create selection boxes using tool-centric approach with caching.
     * @param {Array<Object>} features
     * @param {Object} control
     * @returns {Array<Object>}
     */
    createSelectionBoxesToolCentric(features, control) {
        const selectionBoxes = [];

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                const currentHash = this.calculateGeometryHash(feature);
                const cacheKey = this.getCacheKey(featureId);
                const cached = this.selectionBoxCache.get(cacheKey);

                let selectionBox;

                if (cached && cached.geometryHash === currentHash) {
                    selectionBox = cached.selectionBox;
                } else {
                    const boxGeometry = control.createSelectionBox(feature);

                    if (boxGeometry) {
                        selectionBox = {
                            type: 'Feature',
                            geometry: boxGeometry.geometry || boxGeometry,
                            properties: {
                                type: 'selection-box',
                                source: feature.properties.source,
                                featureId: featureId
                            }
                        };

                        this.selectionBoxCache.set(cacheKey, {
                            geometryHash: currentHash,
                            selectionBox: selectionBox
                        });
                        this.geometryHashes.set(featureId, currentHash);
                    }
                }

                if (selectionBox) {
                    selectionBoxes.push(selectionBox);
                }
            } catch (error) {
                console.warn(`Error creating tool-centric selection box for ${feature.properties.source}:`, error);
            }
        }

        return selectionBoxes;
    }

    /**
     * Expand bounding box with padding in pixels.
     * @param {Array<number>} bbox - [minX, minY, maxX, maxY]
     * @param {number} paddingPixels
     * @returns {Array<number>}
     */
    expandBboxWithPadding(bbox, paddingPixels) {
        const centerLat = (bbox[1] + bbox[3]) / 2;
        const mapCenter = this.map.getCenter();
        const latitude = isNaN(centerLat) ? mapCenter.lat : centerLat;

        const zoom = this.map.getZoom();
        const paddingDegrees = this.pixelsToDegrees(paddingPixels, latitude, zoom);

        return [
            bbox[0] - paddingDegrees,
            bbox[1] - paddingDegrees,
            bbox[2] + paddingDegrees,
            bbox[3] + paddingDegrees
        ];
    }

    // =========================================================================
    // ATTRIBUTE PANEL MANAGEMENT
    // =========================================================================

    /**
     * Update attribute and profile panels based on selection.
     * Now delegates to sidebar feature panel via StateManager.
     */
    updatePanels = () => {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (allSelectedFeatures.length > 0) {
            // Remove any legacy floating panel
            this.removeExistingPanel();

            // Show profile panel if needed
            this.showProfilePanel(allSelectedFeatures);

            // Notify StateManager to show feature panel in sidebar
            this._notifyFeaturePanelOpened(allSelectedFeatures[0]);
        } else {
            this.saveChangesAndClosePanel();
        }
    }

    /**
     * Notify StateManager that a feature panel should be opened.
     * The sidebar will handle rendering the feature attributes.
     * @private
     * @param {Object} feature - The selected feature
     */
    _notifyFeaturePanelOpened(feature) {
        try {
            const stateManager = getStateManager();
            const featureId = feature?.properties?.id;
            const featureType = feature?.properties?.source;

            if (featureId && featureType) {
                stateManager.openFeaturePanel(featureId, featureType);
            }
        } catch (_e) {
            // StateManager not available - UI will work without layout coordination
        }
    }

    /**
     * Update only the profile panel.
     */
    updateProfile = () => {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (allSelectedFeatures.length > 0) {
            this.showProfilePanel(allSelectedFeatures);
        } else {
            this.saveChangesAndClosePanel();
        }
    }

    /**
     * Remove existing legacy floating panel and cleanup resources.
     * @private
     */
    removeExistingPanel() {
        const existingPanel = document.querySelector('.unified-attributes-panel');
        if (existingPanel) {
            // Cleanup do TabbedPanel
            if (existingPanel._tabbedPanelCleanup) {
                existingPanel._tabbedPanelCleanup();
            }
            // Cleanup legado (manter para compatibilidade)
            if (existingPanel._userDataCleanup) {
                existingPanel._userDataCleanup();
            }
            cleanupFeatureDropdownListeners(existingPanel);
            existingPanel.remove();
        }
    }

    /**
     * Create unified attributes panel for selected features.
     * DEPRECATED: Now handled by sidebar feature panel.
     * This method is kept for API compatibility but no longer creates the floating panel.
     * The sidebar handles feature panel rendering via StateManager events.
     * @param {Array<Object>} _selectedFeatures - Unused, kept for API compatibility
     */
    createUnifiedAttributesPanel = (_selectedFeatures) => {
        // Panel creation is now handled by SidebarControl via StateManager events
        // Just ensure any legacy floating panel is removed
        this.removeExistingPanel();
    }

    /**
     * Add delete button to panel.
     * @param {HTMLElement} panel
     */
    addDeleteButton(panel) {
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('delete-button', 'pure-material-button-contained');
        deleteButton.textContent = 'Deletar';
        deleteButton.onclick = () => this.selectionManager.deleteSelectedFeatures();
        panel.appendChild(deleteButton);
    }

    // =========================================================================
    // DRAG OPERATIONS
    // =========================================================================

    /**
     * Shift selection boxes by delta (for visual feedback during drag).
     * @param {number} dx - Delta longitude
     * @param {number} dy - Delta latitude
     * @param {boolean} [save=false] - Whether to persist the change
     */
    shiftSelectionBoxes(dx, dy, save = false) {
        const shiftedFeatures = this.selectionBoxes.map(feature => {
            return this.translateFeature(feature, dx, dy);
        });

        const selectionBoxesSource = this.map.getSource('selection-boxes');
        if (selectionBoxesSource) {
            selectionBoxesSource.setData({
                type: 'FeatureCollection',
                features: shiftedFeatures
            });
        }

        if (save) {
            this.selectionBoxes = shiftedFeatures;
        }
    }

    /**
     * Translate feature geometry by delta.
     * @param {Object} feature - GeoJSON feature
     * @param {number} dx - Delta X
     * @param {number} dy - Delta Y
     * @returns {Object} Translated feature
     */
    translateFeature(feature, dx, dy) {
        const translatedFeature = JSON.parse(JSON.stringify(feature));

        const translateCoords = (coords) => {
            if (typeof coords[0] === 'number') {
                return [coords[0] + dx, coords[1] + dy];
            }
            return coords.map(translateCoords);
        };

        const { type, coordinates } = feature.geometry;

        switch (type) {
            case 'Point':
                translatedFeature.geometry.coordinates = translateCoords(coordinates);
                break;
            case 'LineString':
                translatedFeature.geometry.coordinates = coordinates.map(translateCoords);
                break;
            case 'Polygon':
                translatedFeature.geometry.coordinates = coordinates.map(ring => ring.map(translateCoords));
                break;
            case 'MultiLineString':
                translatedFeature.geometry.coordinates = coordinates.map(line => line.map(translateCoords));
                break;
            case 'MultiPolygon':
                translatedFeature.geometry.coordinates = coordinates.map(polygon => polygon.map(ring => ring.map(translateCoords)));
                break;
            default:
                throw new Error(`Unsupported geometry type: ${type}`);
        }

        return translatedFeature;
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    /**
     * Calculate expanded dimensions after rotation.
     * @param {number} originalWidth
     * @param {number} originalHeight
     * @param {number} rotationDegrees
     * @returns {{width: number, height: number}}
     */
    calculateExpandedDimensions(originalWidth, originalHeight, rotationDegrees) {
        if (rotationDegrees === 0) {
            return { width: originalWidth, height: originalHeight };
        }

        const radians = rotationDegrees * (Math.PI / 180);

        const corners = [
            { x: -originalWidth / 2, y: -originalHeight / 2 },
            { x: originalWidth / 2, y: -originalHeight / 2 },
            { x: originalWidth / 2, y: originalHeight / 2 },
            { x: -originalWidth / 2, y: originalHeight / 2 }
        ];

        const rotatedCorners = corners.map(corner => ({
            x: corner.x * Math.cos(radians) - corner.y * Math.sin(radians),
            y: corner.x * Math.sin(radians) + corner.y * Math.cos(radians)
        }));

        const minX = Math.min(...rotatedCorners.map(c => c.x));
        const maxX = Math.max(...rotatedCorners.map(c => c.x));
        const minY = Math.min(...rotatedCorners.map(c => c.y));
        const maxY = Math.max(...rotatedCorners.map(c => c.y));

        return {
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Convert pixels to degrees at given latitude and zoom.
     * @param {number} pixels
     * @param {number} latitude
     * @param {number} zoom
     * @returns {number}
     */
    pixelsToDegrees = (pixels, latitude, zoom) => {
        const earthCircumference = 40075017;
        const metersPerPixel = earthCircumference * Math.cos(latitude * Math.PI / 180) / Math.pow(2, zoom + 8);
        const degreesPerMeter = 360 / earthCircumference;
        return pixels * metersPerPixel * degreesPerMeter;
    }

    /**
     * Calculate buffer around feature.
     * @param {Object} feature - GeoJSON feature
     * @param {number} bufferSize
     * @returns {Object}
     */
    calculateBuffer = (feature, bufferSize) => {
        return turf.buffer(feature, bufferSize, { units: 'degrees' });
    }

    /**
     * Create selection box polygon.
     * @param {Array<number>} coordinates - [lng, lat]
     * @param {number} width
     * @param {number} height
     * @param {number} rotation
     * @returns {Object} GeoJSON Polygon geometry
     */
    createSelectionBox = (coordinates, width, height, rotation) => {
        const radians = rotation * (Math.PI / 180);
        const point = this.map.project(coordinates);
        const points = [
            [-width / 2, -height / 2],
            [width / 2, -height / 2],
            [width / 2, height / 2],
            [-width / 2, height / 2]
        ];

        const rotatedPoints = points.map(([x, y]) => {
            const nx = x * Math.cos(radians) - y * Math.sin(radians);
            const ny = x * Math.sin(radians) + y * Math.cos(radians);
            return this.map.unproject([point.x + nx, point.y + ny]);
        });

        return {
            type: 'Polygon',
            coordinates: [[
                ...rotatedPoints.map(p => [p.lng, p.lat]),
                [rotatedPoints[0].lng, rotatedPoints[0].lat]
            ]]
        };
    }

    // =========================================================================
    // PROFILE PANEL
    // =========================================================================

    /**
     * Show profile panel for selected features.
     * @param {Array<Object>} selectedFeatures
     */
    showProfilePanel(selectedFeatures) {
        if (selectedFeatures.length !== 1) {
            this.hideProfilePanel();
            return;
        }

        const feature = selectedFeatures[0];

        if (!('properties' in feature) || !('geometry' in feature)) {
            this.hideProfilePanel();
            return;
        }

        const { source } = feature.properties;
        const isLineFeature = feature.geometry.type === 'LineString';
        const hasProfileData = feature.properties.profileData && feature.properties.profile;

        if (source === 'los' && hasProfileData) {
            this.createProfilePanel(feature.properties.profileData, true);
        } else if (source === 'line' && isLineFeature && hasProfileData) {
            this.createProfilePanel(feature.properties.profileData, false);
        } else {
            this.hideProfilePanel();
        }
    }

    /**
     * Default slope threshold for cavalry mobility alerts (in percentage)
     * Configurable threshold for when slope is considered critical
     */
    static SLOPE_THRESHOLD = 30;

    /**
     * Create elevation profile panel with chart including slope percentage.
     * @param {string} profileData - JSON string of profile data
     * @param {boolean} [linkFirstLast=false] - Whether to show line of sight
     */
    createProfilePanel(profileData, linkFirstLast = false) {
        let panel = document.querySelector('.profile-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'profile-panel';
            document.body.appendChild(panel);
        }

        if (this.activeChart) {
            try {
                this.activeChart.destroy();
            } catch (error) {
                console.warn('Error destroying previous chart:', error);
            }
            this.activeChart = null;
        }

        panel.innerHTML = '';

        // Header with title and action buttons
        const header = document.createElement('div');
        header.className = 'profile-panel-header';

        const title = document.createElement('h3');
        title.textContent = linkFirstLast ? 'Linha de Visada' : 'Perfil do Terreno';
        header.appendChild(title);

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'profile-panel-buttons';

        // Save button
        const saveButton = document.createElement('button');
        saveButton.className = 'profile-save-button';
        saveButton.title = 'Salvar como imagem';
        saveButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        saveButton.addEventListener('click', () => this._saveChartAsImage(linkFirstLast));
        buttonGroup.appendChild(saveButton);

        // Close button
        const closeButton = document.createElement('button');
        closeButton.className = 'close-button';
        closeButton.title = 'Fechar';
        closeButton.innerHTML = '×';
        closeButton.addEventListener('click', () => this._closeProfileAndUpdateFeature());
        buttonGroup.appendChild(closeButton);

        header.appendChild(buttonGroup);
        panel.appendChild(header);

        const profileDataParsed = JSON.parse(profileData);
        const labels = profileDataParsed.map(d => d.distance.toFixed(0));
        const elevation = profileDataParsed.map(d => d.elevation);
        const slopes = profileDataParsed.map(d => d.slope ?? 0);

        // Check for critical slopes and calculate max slope
        const maxSlope = Math.max(...slopes.map(s => Math.abs(s)));
        const hasCriticalSlope = maxSlope > UIManager.SLOPE_THRESHOLD;

        // Show slope alert if critical slopes detected
        if (hasCriticalSlope) {
            const alertDiv = document.createElement('div');
            alertDiv.className = 'profile-slope-alert';
            alertDiv.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span>Inclinação máxima: ${maxSlope.toFixed(1)}% (limite: ${UIManager.SLOPE_THRESHOLD}%)</span>
            `;
            panel.appendChild(alertDiv);
        }

        const canvas = document.createElement('canvas');
        canvas.id = 'profileChart';
        panel.appendChild(canvas);

        // Color function for slope segments based on threshold
        const getSlopeColor = (slope) => {
            const absSlope = Math.abs(slope);
            if (absSlope > UIManager.SLOPE_THRESHOLD) {
                return 'rgba(255, 82, 82, 0.8)'; // Critical - red
            } else if (absSlope > UIManager.SLOPE_THRESHOLD * 0.6) {
                return 'rgba(255, 193, 7, 0.8)'; // Warning - yellow
            }
            return 'rgba(102, 187, 106, 0.8)'; // Normal - green
        };

        const datasets = [
            {
                label: 'Elevação',
                data: elevation,
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.1)',
                fill: true,
                tension: 0.1,
                pointRadius: 3,
                pointHoverRadius: 6,
                yAxisID: 'y'
            },
            {
                label: 'Inclinação (%)',
                data: slopes,
                borderColor: 'rgba(156, 39, 176, 0.8)',
                backgroundColor: slopes.map(s => getSlopeColor(s)),
                fill: false,
                tension: 0.1,
                pointRadius: 4,
                pointHoverRadius: 7,
                pointBackgroundColor: slopes.map(s => getSlopeColor(s)),
                pointBorderColor: slopes.map(s => getSlopeColor(s)),
                yAxisID: 'y1',
                segment: {
                    borderColor: ctx => {
                        const slope = slopes[ctx.p1DataIndex];
                        return getSlopeColor(slope);
                    }
                }
            }
        ];

        if (linkFirstLast) {
            const firstElevation = elevation[0];
            const lastElevation = elevation[elevation.length - 1];
            const firstDistance = parseFloat(labels[0]);
            const lastDistance = parseFloat(labels[labels.length - 1]);

            const slopeLine = (lastElevation - firstElevation) / (lastDistance - firstDistance);
            let intersectionIndex = -1;

            const lineElevations = labels.map((distance, i) => {
                const dist = parseFloat(distance);
                const lineElevation = slopeLine * (dist - firstDistance) + firstElevation;

                if (i != 0 && i != labels.length - 1 && intersectionIndex === -1 && elevation[i] >= lineElevation) {
                    intersectionIndex = i;
                }

                return lineElevation;
            });

            datasets.push({
                label: 'Linha de visada',
                data: lineElevations,
                fill: false,
                tension: 0.1,
                pointRadius: 0,
                yAxisID: 'y',
                segment: {
                    borderColor: ctx => ctx.p0DataIndex < intersectionIndex || intersectionIndex == -1 ? 'rgb(0, 255, 0)' : 'rgb(255, 0, 0)'
                }
            });
        }

        this.activeChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleFont: { size: 12 },
                        bodyFont: { size: 11 },
                        padding: 10,
                        cornerRadius: 4,
                        callbacks: {
                            title: (context) => `Distância: ${context[0].label} m`,
                            label: (context) => {
                                const value = context.parsed.y;
                                const datasetLabel = context.dataset.label;
                                if (datasetLabel === 'Inclinação (%)') {
                                    const absValue = Math.abs(value);
                                    const direction = value >= 0 ? 'subida' : 'descida';
                                    const warning = absValue > UIManager.SLOPE_THRESHOLD ? ' ⚠️' : '';
                                    return `${datasetLabel}: ${value.toFixed(1)}% (${direction})${warning}`;
                                }
                                return `${datasetLabel}: ${value.toFixed(1)} m`;
                            }
                        }
                    },
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            boxWidth: 12,
                            padding: 8,
                            font: { size: 11 }
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Distância (m)',
                            font: { size: 11 }
                        },
                        ticks: { font: { size: 10 } }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Altitude (m)',
                            font: { size: 11 }
                        },
                        ticks: { font: { size: 10 } }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Inclinação (%)',
                            font: { size: 11 },
                            color: 'rgba(156, 39, 176, 0.8)'
                        },
                        ticks: {
                            font: { size: 10 },
                            color: 'rgba(156, 39, 176, 0.8)'
                        },
                        grid: {
                            drawOnChartArea: false
                        }
                    }
                }
            }
        });
    }

    /**
     * Save chart as PNG image with white background.
     * @param {boolean} isLOS - Whether this is a line of sight profile
     * @private
     */
    _saveChartAsImage(isLOS) {
        if (!this.activeChart) return;

        const canvas = this.activeChart.canvas;
        const ctx = canvas.getContext('2d');

        // Create a new canvas with white background
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        // Fill with white background
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Draw the chart on top
        tempCtx.drawImage(canvas, 0, 0);

        const link = document.createElement('a');
        link.download = isLOS ? 'linha-de-visada.png' : 'perfil-terreno.png';
        link.href = tempCanvas.toDataURL('image/png', 1);
        link.click();
    }

    /**
     * Close profile panel and update the feature's profile property to false.
     * @private
     */
    _closeProfileAndUpdateFeature() {
        const selectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (selectedFeatures.length === 1) {
            const feature = selectedFeatures[0];
            const { source } = feature.properties;

            // Get the appropriate control from selectionManager and update the property
            const control = this.selectionManager.controls.get(source);
            if (control && typeof control.updateFeaturesProperty === 'function') {
                control.updateFeaturesProperty(selectedFeatures, 'profile', false);
            }

            // Update the toggle in the attribute panel directly
            const profileToggle = document.getElementById('profile-toggle');
            if (profileToggle && profileToggle.setChecked) {
                profileToggle.setChecked(false);
            }
        }

        this.hideProfilePanel();
    }

    /**
     * Hide profile panel.
     */
    hideProfilePanel() {
        if (this.activeChart) {
            try {
                this.activeChart.destroy();
            } catch (error) {
                console.warn('Error destroying chart:', error);
            }
            this.activeChart = null;
        }

        const panel = document.querySelector('.profile-panel');
        if (panel) {
            panel.remove();
        }
    }

    /**
     * Hide feature search panel.
     */
    hideFeatureSearchPanel() {
        const panel = document.querySelector('.feature-search-panel');
        if (panel) {
            panel.remove();
            this.featureSearchControl?.removeMarker();
        }
    }

    /**
     * Show feature search result panel.
     * @param {Object} feature - Search result feature
     */
    showFeatureSearchPanel(feature) {
        const panel = document.createElement('div');
        panel.className = 'unified-attributes-panel feature-search-panel';

        const title = document.createElement('h3');
        title.textContent = 'Resultado da busca';
        panel.appendChild(title);

        const infoList = document.createElement('ul');
        const infoItems = [
            { label: 'Nome', value: feature.nome },
            { label: 'Latitude', value: feature.latitude },
            { label: 'Longitude', value: feature.longitude },
            { label: 'Classe', value: feature.tipo },
            { label: 'Município', value: feature.municipio },
            { label: 'Estado', value: feature.estado }
        ];

        infoItems.forEach(item => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `<strong>${item.label}:</strong> ${item.value}`;
            infoList.appendChild(listItem);
        });

        panel.appendChild(infoList);

        const closeButton = document.createElement('button');
        closeButton.textContent = 'Fechar';
        closeButton.onclick = () => this.hideFeatureSearchPanel();
        panel.appendChild(closeButton);

        document.body.appendChild(panel);
    }

    /**
     * Show vector tile info panel.
     * Emits event for sidebar to handle display.
     * @param {Object} feature
     */
    showVectorTileInfoPanel(feature) {
        this.saveChangesAndClosePanel();

        // Get the display title
        const originalLayerName = feature.sourceLayer;
        let sourceName;

        if (originalLayerName.startsWith('situacao')) {
            sourceName = originalLayerName
                .replace('situacao', 'produtos')
                .replace(/_(10|25|50|100|250)k/, ' (1:$1.000)');
        } else {
            sourceName = originalLayerName
                .replace(/_10k|_25k|_50k|_100k|_250k/g, '')
                .replace('edgv_', '');
        }

        // Emit event for sidebar to handle
        try {
            const eventBus = getEventBus();
            eventBus.emit(EventTypes.VECTOR_INFO_PANEL_OPENED, {
                feature,
                title: sourceName
            });
        } catch (e) {
            // Fallback to legacy floating panel if event bus not available
            const panel = document.createElement('div');
            panel.className = 'vector-tile-info-panel unified-attributes-panel';
            this.addVectorTileInfoToPanel(panel, feature);
            document.body.appendChild(panel);
        }
    }

    /**
     * Add vector tile info content to panel.
     * @param {HTMLElement} panel
     * @param {Object} feature
     */
    addVectorTileInfoToPanel(panel, feature) {
        const title = document.createElement('h3');
        let sourceName;
        const originalLayerName = feature.sourceLayer;

        if (originalLayerName.startsWith('situacao')) {
            sourceName = originalLayerName
                .replace('situacao', 'produtos')
                .replace(/_(10|25|50|100|250)k/, ' (1:$1.000)');

        } else {
            sourceName = originalLayerName
                .replace(/_10k|_25k|_50k|_100k|_250k/g, '')
                .replace('edgv_', '');
        }
        title.textContent = `Atributos ${sourceName}:`;
        panel.appendChild(title);

        const propertiesList = document.createElement('ul');
        const blacklist = ['fid', 'id', 'vector_type', 'tilequery', 'mapbox_clip_start', 'mapbox_clip_end', 'justificativa_txt_value', 'visivel_value', 'exibir_linha_rotulo_value', 'suprimir_bandeira_value', 'posicao_rotulo_value', 'direcao_fixada_value', 'exibir_ponta_simbologia_value', 'exibir_lado_simbologia_value', 'label_x', 'label_y', 'length_otf', 'texto_edicao', 'simb_rot', 'observacao'];
        const blacklistSuffixes = ['_code'];

        for (const [key, value] of Object.entries(feature.properties)) {
            if (blacklist.includes(key) || blacklistSuffixes.some(suffix => key.endsWith(suffix))) {
                continue;
            }

            let displayKey = key.endsWith('_value') ? key.slice(0, -6) : key;
            displayKey = displayKey.replace(/_/g, ' ');
            if (displayKey.startsWith('identificador')) {
                displayKey = displayKey.substring('identificador'.length);
            }

            let displayValue;
            if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
                const formattedString = value
                    .slice(1, -1)
                    .replace(/"/g, '')
                    .replace(/,/g, ', ');

                displayValue = formattedString || '-';
            } else {
                displayValue = value;
            }

            const listItem = document.createElement('li');
            listItem.innerHTML = `<strong>${displayKey}:</strong> ${displayValue}`;
            propertiesList.appendChild(listItem);
        }

        if (propertiesList.children.length > 0) {
            panel.appendChild(propertiesList);
        } else {
            const noPropertiesMsg = document.createElement('p');
            noPropertiesMsg.textContent = 'Feição sem atributos';
            panel.appendChild(noPropertiesMsg);
        }

        const closeButton = document.createElement('button');
        closeButton.textContent = 'Fechar';
        closeButton.onclick = () => {
            this.toolManager.deactivateCurrentTool();
            this.saveChangesAndClosePanel();
        };
        panel.appendChild(closeButton);
    }

    /**
     * Save changes and close all panels.
     */
    saveChangesAndClosePanel = () => {
        this.hideFeatureSearchPanel();
        this.hideProfilePanel();

        // Handle legacy floating panel if it exists
        const panel = document.querySelector('.unified-attributes-panel');
        if (panel) {
            const saveButton = panel.querySelector('button[type="submit"]');
            if (saveButton) {
                saveButton.click();
            }
            panel.remove();
            cleanupFeatureDropdownListeners();
        }

        // Handle sidebar feature panel - save before closing
        const sidebarSaveButton = document.querySelector('.feature-panel .attr-modern-btn-save');
        if (sidebarSaveButton) {
            sidebarSaveButton.click();
        }

        // Always notify StateManager to close feature panel in sidebar
        this._notifyFeaturePanelClosed();
    }

    /**
     * Notify StateManager that a feature panel has been closed.
     * @private
     */
    _notifyFeaturePanelClosed() {
        try {
            const stateManager = getStateManager();
            stateManager.closeFeaturePanel();
        } catch (e) {
            // StateManager not available
        }
    }

    /**
     * Cleanup resources.
     * Call when component is destroyed.
     */
    destroy() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];

        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        if (this.activeChart) {
            try {
                this.activeChart.destroy();
            } catch (e) {
                // Ignore
            }
            this.activeChart = null;
        }
    }
}

export default UIManager;
