// Path: js/controls_sig/tool_manager/ui_manager.js

import { cleanupFeatureDropdownListeners } from './attribute_panel_helpers.js';

class UIManager {
    constructor(map, selectionManager, toolManager) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.toolManager = toolManager;
        this.featureSearchControl = null;

        this.selectionBoxes = [];
        this.isDragging = false;

        this.selectionBoxCache = new Map();
        this.geometryHashes = new Map();
        this.rafId = null;
        this.map.on('zoom', this.handleZoomChange);
        this.activeChart = null;
    }

    handleZoomChange = () => {
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

    setDragging = (isDragging) => {
        this.isDragging = isDragging;
    }

    // ===== CACHE MANAGEMENT =====

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

    invalidateAllCache() {
        this.selectionBoxCache.clear();
        this.geometryHashes.clear();
    }

    notifyGeometryChange(featureId) {
        this.invalidateCache(featureId);
    }

    // ===== TOOL-CENTRIC SELECTION HIGHLIGHTING =====

    /**
     * Main selection highlight update using tool-centric approach
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
     * Group selected features by type for efficient processing
     */
    groupSelectedFeaturesByType() {
        const featuresByType = new Map();

        for (const [key, item] of this.selectionManager.selectedFeatures.entries()) {
            const type = item.type;
            if (!featuresByType.has(type)) {
                featuresByType.set(type, []);
            }
            featuresByType.get(type).push(item.feature);
        }

        return featuresByType;
    }

    /**
     * Create selection boxes for features of a specific type using tool-centric approach
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
     * Check if control supports tool-centric selection box interface
     */
    supportsToolCentricSelectionBoxes(control) {
        return control &&
               typeof control.createSelectionBox === 'function' &&
               typeof control.getSelectionBoxStrategy === 'function';
    }

    /**
     * Create selection boxes using tool-centric approach
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
     * Expand bbox with padding
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

    // ===== ATTRIBUTE PANEL MANAGEMENT =====

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

    createUnifiedAttributesPanel = (selectedFeatures) => {
        let panel = document.querySelector('.unified-attributes-panel');
        if (panel) panel.remove();

        panel = document.createElement('div');
        panel.id = 'attributes-panel';
        panel.className = 'unified-attributes-panel';

        const featureTypes = new Set(selectedFeatures.map(f => f.properties.source));

        if (featureTypes.size === 1) {
            const featureType = featureTypes.values().next().value;
            this.addAttributesForType(panel, selectedFeatures, featureType);
        }

        this.addDeleteButton(panel);
        document.body.appendChild(panel);

        panel.style.display = 'flex';
    }

    /**
     * Add attributes for type using tool-centric approach
     */
    addAttributesForType(panel, features, type) {
        const control = this.selectionManager.controls.get(type);
        if (!control) {
            console.warn(`Control not found for type: ${type}`);
            return;
        }

        if (control.hasAttributePanel && control.hasAttributePanel()) {
            try {
                control.createAttributePanel(panel, features, this.selectionManager, this);
            } catch (error) {
                console.error(`Error creating tool-centric attribute panel for ${type}:`, error);
            }
        } else {
            console.warn(`Tool ${type} does not implement attribute panel interface`);
        }
    }

    addDeleteButton(panel) {
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('delete-button', 'pure-material-button-contained');
        deleteButton.textContent = 'Deletar';
        deleteButton.onclick = () => this.selectionManager.deleteSelectedFeatures();
        panel.appendChild(deleteButton);
    }

    // ===== DRAG OPERATIONS =====

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

    // ===== UTILITY METHODS =====

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

    // ===== PROFILE PANEL =====

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

        if (this.activeChart) {
            try {
                this.activeChart.destroy();
            } catch (error) {
                console.warn('Erro ao destruir chart anterior:', error);
            }
            this.activeChart = null;
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

        this.activeChart = new Chart(canvas, {
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

    showVectorTileInfoPanel(feature) {
        this.saveChangesAndClosePanel();

        const panel = document.createElement('div');
        panel.className = 'vector-tile-info-panel unified-attributes-panel';
        this.addVectorTileInfoToPanel(panel, feature);
        document.body.appendChild(panel);
    }

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

            cleanupFeatureDropdownListeners();
        }
    }
}

export default UIManager;
