// Path: js\controls_sig\tool_manager\ui_manager.js

import { addImageAttributesToPanel } from '../image_tool/image_attributes_panel.js';
import { addTextAttributesToPanel } from '../text_tool/text_attributes_panel.js';
import { addPointAttributesToPanel } from '../draw_tools/point_attributes_panel.js';
import { addLineAttributesToPanel } from '../draw_tools/line_attributes_panel.js';
import { addPolygonAttributesToPanel } from '../draw_tools/polygon_attributes_panel.js';
import { addLOSAttributesToPanel } from '../los_tool/los_attributes_panel.js';
import { addVisibilityAttributesToPanel } from '../visibility_tool/visibility_attributes_panel.js';
import { addCircleAttributesToPanel } from '../circle_tool/circle_attributes_panel.js';
import { addEllipseAttributesToPanel } from '../ellipse_tool/ellipse_attributes_panel.js';
import { addArrowAttributesToPanel } from '../arrow_tool/arrow_attributes_panel.js';
import { addBoundaryAttributesToPanel } from '../boundary_tool/boundary_attributes_panel.js';
import { addOccupiedFrontAttributesToPanel } from '../occupied_front_tool/occupied_front_attributes_panel.js';
import { addMilitarySymbolAttributesToPanel } from '../military_symbol_tool/military_symbol_attributes_panel.js';
import { addRectangleAttributesToPanel } from '../rectangle_tool/rectangle_attributes_panel.js';
import { addBrushAttributesToPanel } from '../brush_tool/brush_attributes_panel.js';

// ===== CONFIGURATION =====

/**
 * Selection box strategies for different feature types
 * Adding new types requires only adding an entry here
 */
const SELECTION_BOX_STRATEGIES = {
    // Geometric features that use bounding box with custom padding
    'circle': { strategy: 'bbox', errorMsg: 'círculo', padding: 5 },
    'ellipse': { strategy: 'bbox', errorMsg: 'elipse', padding: 5 },
    'arrow': { strategy: 'bbox', errorMsg: 'seta', padding: 5 },
    'boundary': { strategy: 'bbox', errorMsg: 'boundary', padding: 5 },
    'occupied_front': { strategy: 'bbox', errorMsg: 'frente ocupada', padding: 5 },
    'rectangle': { strategy: 'bbox', errorMsg: 'retângulo', padding: 5 },
    'brush': { strategy: 'bbox', errorMsg: 'pincel', padding: 5 },
    // Linear features that now use bounding box with different padding based on geometry
    'point': { strategy: 'bbox', errorMsg: 'ponto', padding: 10 },
    'line': { strategy: 'bbox', errorMsg: 'linha', padding: 5 },
    'polygon': { strategy: 'bbox', errorMsg: 'polígono', padding: 5 },
    'los': { strategy: 'bbox', errorMsg: 'linha de visada', padding: 5 }, // Always LineString
    'visibility': { strategy: 'bbox', errorMsg: 'visibilidade', padding: 5 }, // Always LineString

    // Point-based features with custom boxes (keep existing padding: 10px default)
    'text': { strategy: 'preCalculated' }, // Nova estratégia
    'image': { strategy: 'preCalculated' },
    'military_symbol': { strategy: 'preCalculated' }
};

/**
 * Registry for attribute panel functions
 * Maps feature types to their corresponding panel functions and controls
 */
const ATTRIBUTE_PANEL_REGISTRY = {
    'text': {
        panelFunction: addTextAttributesToPanel,
        controlKey: 'text',
        sectionClass: 'text-attributes-section'
    },
    'image': {
        panelFunction: addImageAttributesToPanel,
        controlKey: 'image',
        sectionClass: 'image-attributes-section'
    },
    'point': {
        panelFunction: addPointAttributesToPanel,
        controlKey: 'point',
        sectionClass: 'point-attributes-section'
    },
    'line': {
        panelFunction: addLineAttributesToPanel,
        controlKey: 'line',
        sectionClass: 'line-attributes-section'
    },
    'polygon': {
        panelFunction: addPolygonAttributesToPanel,
        controlKey: 'polygon',
        sectionClass: 'polygon-attributes-section'
    },
    'los': {
        panelFunction: addLOSAttributesToPanel,
        controlKey: 'los',
        sectionClass: 'los-attributes-section'
    },
    'visibility': {
        panelFunction: addVisibilityAttributesToPanel,
        controlKey: 'visibility',
        sectionClass: 'visibility-attributes-section'
    },
    'rectangle': {
        panelFunction: addRectangleAttributesToPanel,
        controlKey: 'rectangle',
        sectionClass: 'rectangle-attributes-section'
    },
    'circle': {
        panelFunction: addCircleAttributesToPanel,
        controlKey: 'circle',
        sectionClass: 'circle-attributes-section'
    },
    'ellipse': {
        panelFunction: addEllipseAttributesToPanel,
        controlKey: 'ellipse',
        sectionClass: 'ellipse-attributes-section'
    },
    'arrow': {
        panelFunction: addArrowAttributesToPanel,
        controlKey: 'arrow',
        sectionClass: 'arrow-attributes-section'
    },
    'boundary': {
        panelFunction: addBoundaryAttributesToPanel,
        controlKey: 'boundary',
        sectionClass: 'boundary-attributes-section'
    },
    'occupied_front': {
        panelFunction: addOccupiedFrontAttributesToPanel,
        controlKey: 'occupied_front',
        sectionClass: 'occupied-front-attributes-section'
    },
    'military_symbol': {
        panelFunction: addMilitarySymbolAttributesToPanel,
        controlKey: 'military_symbol',
        sectionClass: 'military-symbol-attributes-section'
    },
    'brush': {
        panelFunction: addBrushAttributesToPanel,
        controlKey: 'brush',
        sectionClass: 'brush-attributes-section'
    },
};

class UIManager {
    constructor(map, selectionManager, toolManager) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.toolManager = toolManager;
        this.featureSearchControl = null;

        // UI state
        this.selectionBoxes = [];
        this.isDragging = false;

        // ===== CACHE SYSTEM =====
        /**
         * Cache para selection boxes
         * Key: featureId, Value: { geometryHash, selectionBox }
         */
        this.selectionBoxCache = new Map();

        /**
         * Cache para hashes de geometrias
         * Key: featureId, Value: geometryHash
         */
        this.geometryHashes = new Map();
        this.rafId = null;
        this.map.on('zoom', this.handleZoomChange);
    }

    handleZoomChange = () => {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }

        // Agenda novo cálculo para próximo frame
        this.rafId = requestAnimationFrame(() => {
            if (this.selectionManager.hasSelectedFeatures()) {
                this.updateSelectionHighlight();
            }
            this.rafId = null;
        });
    }

    getCacheKey(featureId) {
        const zoom = this.map.getZoom();
        const zoomLevel = Math.round(zoom * 2) / 2;
        return `${featureId}-${zoomLevel}`;
    }

    setFeatureSearchControl(featureSearchControl) {
        this.featureSearchControl = featureSearchControl;
    }

    setDragging = (isDragging) => {
        this.isDragging = isDragging;
    }

    // ===== CACHE MANAGEMENT =====

    /**
     * Calcula hash simples da geometria para cache
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
            height: feature.properties.height
        });

        // Hash simples mas efetivo
        let hash = 0;
        const str = coords + props;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString();
    }

    /**
     * Invalida cache para uma feature específica
     */
    invalidateCache(featureId) {
        if (featureId) {
            // MODIFICAR: invalidar todas as entradas de zoom para esta feature
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
     * Invalida todo o cache
     */
    invalidateAllCache() {
        this.selectionBoxCache.clear();
        this.geometryHashes.clear();
    }

    /**
     * Notifica mudança de geometria - chamado pelo SelectionManager
     */
    notifyGeometryChange(featureId) {
        this.invalidateCache(featureId);
    }

    // ===== UNIFIED SELECTION HIGHLIGHTING (OPTIMIZED) =====

    /**
     * Main selection highlight update - OTIMIZADO com cache
     */
    updateSelectionHighlight = () => {
        if (this.isDragging) return;

        const selectionBoxesSource = this.map.getSource('selection-boxes');
        if (!selectionBoxesSource) return;

        // Gerar selection boxes usando cache
        const allFeatures = Object.keys(SELECTION_BOX_STRATEGIES)
            .flatMap(type => this.createSelectionBoxesForType(type));

        this.selectionBoxes = allFeatures;
        selectionBoxesSource.setData({
            type: 'FeatureCollection',
            features: allFeatures
        });
    }

    /**
     * Generic selection box creator - OTIMIZADO com cache
     */
    createSelectionBoxesForType(type) {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType(type);
        if (!selectedItems.length) return [];

        const strategy = SELECTION_BOX_STRATEGIES[type];
        if (!strategy) {
            console.warn(`No selection box strategy found for type: ${type}`);
            return [];
        }

        const features = selectedItems.map(item => item.feature);
        
        // Para estratégia preCalculated, não usar cache
        if (strategy.strategy === 'preCalculated') {
            return this.createPreCalculatedSelectionBoxes(features);
        }

        const cachedBoxes = [];
        const uncachedFeatures = [];

        // Separar features que já estão em cache das que precisam ser calculadas
        for (const feature of features) {
            const featureId = feature.properties.id;
            const currentHash = this.calculateGeometryHash(feature);
            const cacheKey = this.getCacheKey(featureId);
            const cached = this.selectionBoxCache.get(cacheKey);

            if (cached && cached.geometryHash === currentHash) {
                // Cache hit - usar selection box do cache
                cachedBoxes.push(cached.selectionBox);
            } else {
                // Cache miss - precisa calcular
                uncachedFeatures.push(feature);
                // Atualizar hash
                this.geometryHashes.set(featureId, currentHash);
            }
        }

        // Calcular selection boxes para features não cachadas
        let newBoxes = [];
        if (uncachedFeatures.length > 0) {
            switch (strategy.strategy) {
                case 'bbox':
                    newBoxes = this.createBboxSelectionBoxes(uncachedFeatures, type, strategy.errorMsg);
                    break;
                case 'imageBox':
                    newBoxes = this.createImageSelectionBoxes(uncachedFeatures);
                    break;
                case 'buffer':
                    newBoxes = this.createBufferSelectionBoxes(uncachedFeatures);
                    break;
                default:
                    console.warn(`Unknown selection box strategy: ${strategy.strategy}`);
            }

            // Cachear os novos selection boxes
            for (let i = 0; i < uncachedFeatures.length; i++) {
                const feature = uncachedFeatures[i];
                const featureId = feature.properties.id;
                const geometryHash = this.geometryHashes.get(featureId);
                const selectionBox = newBoxes[i];

                if (selectionBox) {
                    const cacheKey = this.getCacheKey(featureId);
                    this.selectionBoxCache.set(cacheKey, {
                        geometryHash,
                        selectionBox
                    });
                }
            }
        }

        return [...cachedBoxes, ...newBoxes];
    }

    /**
     * Usa geometria pré-calculada armazenada na feature
     */
    createPreCalculatedSelectionBoxes(features) {
        return features.map(feature => ({
            type: 'Feature',
            geometry: feature.properties.selectionBox,
            properties: {}
        }));
    }

    expandBboxWithPadding(bbox, paddingPixels, map) {
        // Get center of bbox for latitude calculation
        const centerLat = (bbox[1] + bbox[3]) / 2;
        const centerLng = (bbox[0] + bbox[2]) / 2;

        // Use map center as fallback if bbox center is invalid
        const mapCenter = this.map.getCenter();
        const latitude = isNaN(centerLat) ? mapCenter.lat : centerLat;

        // Convert padding from pixels to degrees
        const zoom = this.map.getZoom();
        const paddingDegrees = this.pixelsToDegrees(paddingPixels, latitude, zoom);

        // Expand bbox
        return [
            bbox[0] - paddingDegrees, // minX
            bbox[1] - paddingDegrees, // minY  
            bbox[2] + paddingDegrees, // maxX
            bbox[3] + paddingDegrees  // maxY
        ];
    }

    /**
     * Creates bounding box selection boxes for geometric features
     */
    createBboxSelectionBoxes(features, type, errorMsg) {
        const boxes = [];
        const strategy = SELECTION_BOX_STRATEGIES[type];

        for (const feature of features) {
            try {
                // Calculate original bbox
                const originalBbox = turf.bbox(feature);

                // Determine padding
                let paddingPixels;
                if (typeof strategy.padding === 'number') {
                    paddingPixels = strategy.padding;
                } else {
                    paddingPixels = 5; // Default fallback
                }

                // Expand bbox with padding
                const expandedBbox = this.expandBboxWithPadding(originalBbox, paddingPixels, this.map);

                // Create polygon from expanded bbox
                const boxFeature = turf.bboxPolygon(expandedBbox);
                boxFeature.properties = {
                    type: 'selection-box',
                    source: type,
                    featureId: feature.properties.id
                };
                boxes.push(boxFeature);
            } catch (error) {
                console.warn(`Erro ao criar selection box para ${errorMsg}:`, error);
            }
        }

        return boxes;
    }

    /**
     * Creates selection boxes for image-like features (image, military_symbol) (bounding box without rotation but sized to fit rotated content)
     */
    createImageSelectionBoxes(features) {
        return features.map(feature => {
            const coordinates = feature.geometry.coordinates;
            const width = feature.properties.width * feature.properties.size;
            const height = feature.properties.height * feature.properties.size;
            const rotation = feature.properties.rotation || 0;
            
            // Calculate expanded dimensions to fit rotated content
            const expandedDimensions = this.calculateExpandedDimensions(width, height, rotation);
            
            // Create selection box without rotation but with expanded dimensions
            const polygon = this.createSelectionBox(
                coordinates, 
                expandedDimensions.width, 
                expandedDimensions.height, 
                0
            );

            return {
                type: 'Feature',
                geometry: polygon,
                properties: {}
            };
        });
    }

    /**
     * Creates buffered selection boxes for linear features
     */
    createBufferSelectionBoxes(features) {
        const zoom = this.map.getZoom();
        const center = this.map.getCenter();
        const bufferSize = this.pixelsToDegrees(10, center.lat, zoom);

        return features.map(feature => this.calculateBuffer(feature, bufferSize));
    }

    // ===== UNIFIED ATTRIBUTE PANEL MANAGEMENT =====

    /**
     * Updates panels using the new SelectionManager API
     */
    updatePanels = () => {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (allSelectedFeatures.length > 0) {
            this.createUnifiedAttributesPanel(allSelectedFeatures);
            this.showProfilePanel(allSelectedFeatures);
        } else {
            this.saveChangesAndClosePanel();
        }
    }

    updateProfile = () => {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (allSelectedFeatures.length > 0) {
            this.showProfilePanel(allSelectedFeatures);
        } else {
            this.saveChangesAndClosePanel();
        }
    }

    /**
     * Creates unified attributes panel using configuration-driven approach
     * Replaces the giant if/else chain
     */
    createUnifiedAttributesPanel = (selectedFeatures) => {
        // Remove existing panel
        let panel = document.querySelector('.unified-attributes-panel');
        if (panel) panel.remove();

        // Create new panel
        panel = document.createElement('div');
        panel.id = 'attributes-panel';
        panel.className = 'unified-attributes-panel';

        // Get unique feature types
        const featureTypes = new Set(selectedFeatures.map(f => f.properties.source));

        // Only show attributes panel for single type selections
        if (featureTypes.size === 1) {
            const featureType = featureTypes.values().next().value;
            this.addAttributesForType(panel, selectedFeatures, featureType);
        }

        // Add delete button
        this.addDeleteButton(panel);

        // Add to DOM
        document.body.appendChild(panel);
    }

    /**
     * Generic method to add attributes for any feature type
     * Replaces 11+ individual addXXXAttributes methods
     */
    addAttributesForType(panel, features, type) {
        const config = ATTRIBUTE_PANEL_REGISTRY[type];
        if (!config) {
            console.warn(`No attribute panel configuration found for type: ${type}`);
            return;
        }

        // Create section container
        const sectionPanel = document.createElement('div');
        sectionPanel.className = config.sectionClass;

        // Get the appropriate control
        const control = this.selectionManager.controls.get(config.controlKey);
        if (!control) {
            console.warn(`Control not found for type: ${type}`);
            return;
        }

        // Call the specific panel function
        try {
            config.panelFunction(sectionPanel, features, control, this.selectionManager, this);
            panel.appendChild(sectionPanel);
        } catch (error) {
            console.error(`Error creating attribute panel for ${type}:`, error);
        }
    }

    /**
     * Adds delete button to panel
     */
    addDeleteButton(panel) {
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('delete-button', 'pure-material-button-contained');
        deleteButton.textContent = 'Deletar';
        deleteButton.onclick = () => this.selectionManager.deleteSelectedFeatures();
        panel.appendChild(deleteButton);
    }

    // ===== SPECIALIZED PANELS =====

    /**
     * Shows vector tile info panel (unchanged)
     */
    showVectorTileInfoPanel(feature) {
        this.saveChangesAndClosePanel();

        const panel = document.createElement('div');
        panel.className = 'vector-tile-info-panel unified-attributes-panel';
        this.addVectorTileInfoToPanel(panel, feature);
        document.body.appendChild(panel);
    }

    addVectorTileInfoToPanel(panel, feature) {
        const title = document.createElement('h3');
        let sourceName = feature.sourceLayer.replace(/_10k|_25k|_50k|_100k|_250k/g, '').replace('edgv_', '');
        title.textContent = `Atributos ${sourceName}:`;
        panel.appendChild(title);

        const propertiesList = document.createElement('ul');
        const blacklist = ['id', 'vector_type', 'tilequery', 'mapbox_clip_start', 'mapbox_clip_end', 'justificativa_txt_value', 'visivel_value', 'exibir_linha_rotulo_value', 'suprimir_bandeira_value', 'posicao_rotulo_value', 'direcao_fixada_value', 'exibir_ponta_simbologia_value', 'exibir_lado_simbologia_value', 'label_x', 'label_y', 'length_otf', 'texto_edicao', 'simb_rot', 'observacao'];
        const blacklistSuffixes = ['_code'];

        for (const [key, value] of Object.entries(feature.properties)) {
            if (blacklist.includes(key) || blacklistSuffixes.some(suffix => key.endsWith(suffix))) {
                continue;
            }

            let displayKey = key.endsWith('_value') ? key.slice(0, -6) : key;
            const listItem = document.createElement('li');
            listItem.innerHTML = `<strong>${displayKey}:</strong> ${value}`;
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
     * Saves changes and closes panel
     */
    saveChangesAndClosePanel = () => {
        this.hideFeatureSearchPanel();
        this.hideProfilePanel();

        const panel = document.querySelector('.unified-attributes-panel');
        if (panel) {
            const saveButton = panel.querySelector('button[type="submit"]');
            if (saveButton) {
                saveButton.click();
            }
            panel.remove();
        }
    }

    // ===== DRAG OPERATIONS =====

    /**
     * Shifts selection boxes during drag operations
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
     * Translates a feature by dx, dy
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

    // ===== PROFILE PANEL =====

    /**
     * Shows profile panel for features with elevation data
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

    createProfilePanel(profileData, linkFirstLast = false) {
        let panel = document.querySelector('.profile-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'profile-panel';
            document.body.appendChild(panel);
        }

        panel.innerHTML = '';

        const canvas = document.createElement('canvas');
        panel.appendChild(canvas);

        const profileDataParsed = JSON.parse(profileData);
        const labels = profileDataParsed.map(d => d.distance.toFixed(0));
        const elevation = profileDataParsed.map(d => d.elevation);

        const datasets = [{
            label: 'Elevação',
            data: elevation,
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgb(75, 192, 192)',
            fill: false,
            tension: 0.1
        }];

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
                segment: {
                    borderColor: ctx => ctx.p0DataIndex < intersectionIndex || intersectionIndex == -1 ? 'rgb(0, 255, 0)' : 'rgb(255, 0, 0)'
                }
            });
        }

        new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Distância (m)'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Altitude (m)'
                        }
                    }
                }
            }
        });
    }

    hideProfilePanel() {
        const panel = document.querySelector('.profile-panel');
        if (panel) {
            panel.remove();
        }
    }

    // ===== FEATURE SEARCH PANEL =====

    hideFeatureSearchPanel() {
        const panel = document.querySelector('.feature-search-panel');
        if (panel) {
            panel.remove();
            this.featureSearchControl.removeMarker();
        }
    }

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

    // ===== UTILITY METHODS =====

    /**
     * Calculates expanded dimensions needed for a rectangular bounding box to contain a rotated feature
     * @param {number} originalWidth - Original width of the feature
     * @param {number} originalHeight - Original height of the feature  
     * @param {number} rotationDegrees - Rotation angle in degrees
     * @returns {Object} { width, height } - Expanded dimensions
     */
    calculateExpandedDimensions(originalWidth, originalHeight, rotationDegrees) {
        if (rotationDegrees === 0) {
            return { width: originalWidth, height: originalHeight };
        }

        const radians = rotationDegrees * (Math.PI / 180);
        
        // Calculate the 4 corners of the original rectangle (centered at origin)
        const corners = [
            { x: -originalWidth / 2, y: -originalHeight / 2 },  // top-left
            { x: originalWidth / 2, y: -originalHeight / 2 },   // top-right  
            { x: originalWidth / 2, y: originalHeight / 2 },    // bottom-right
            { x: -originalWidth / 2, y: originalHeight / 2 }    // bottom-left
        ];
        
        // Apply rotation to each corner
        const rotatedCorners = corners.map(corner => ({
            x: corner.x * Math.cos(radians) - corner.y * Math.sin(radians),
            y: corner.x * Math.sin(radians) + corner.y * Math.cos(radians)
        }));
        
        // Find the bounding box of the rotated corners
        const minX = Math.min(...rotatedCorners.map(c => c.x));
        const maxX = Math.max(...rotatedCorners.map(c => c.x));
        const minY = Math.min(...rotatedCorners.map(c => c.y));
        const maxY = Math.max(...rotatedCorners.map(c => c.y));
        
        return {
            width: maxX - minX,
            height: maxY - minY
        };
    }

    pixelsToDegrees = (pixels, latitude, zoom) => {
        const earthCircumference = 40075017;
        const metersPerPixel = earthCircumference * Math.cos(latitude * Math.PI / 180) / Math.pow(2, zoom + 8);
        const degreesPerMeter = 360 / earthCircumference;
        return pixels * metersPerPixel * degreesPerMeter;
    }

    calculateBuffer = (feature, bufferSize) => {
        return turf.buffer(feature, bufferSize, { units: 'degrees' });
    }

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
}

export default UIManager;