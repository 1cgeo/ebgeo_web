import { addImageAttributesToPanel } from '../image_tool/image_attributes_panel.js';
import { addTextAttributesToPanel } from '../text_tool/text_attributes_panel.js';
import { addFeatureAttributesToPanel } from '../draw_tool/feature_attributes_panel.js';
import { addLOSAttributesToPanel } from '../los_tool/los_attributes_panel.js';
import { addVisibilityAttributesToPanel } from '../visibility_tool/visibility_attributes_panel.js';

class UIManager {
    constructor(map, selectionManager) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.drawControl = selectionManager.drawControl;

        this.setupEventListeners();
    }

    setupEventListeners = () => {
        this.map.on('move', this.updateSelectionHighlight);
        this.map.on('draw.render', this.updateSelectionHighlight);
    }

    updateSelectionHighlight = () => {
        const features = [];

        const textFeatures = this.createSelectionBoxesForTextFeatures();
        const imageFeatures = this.createSelectionBoxesForImageFeatures();
        const drawFeatures = this.createSelectionBoxesForDrawFeatures();
        const losFeatures = this.createSelectionBoxesForLOSFeatures();
        const visibilityFeatures = this.createSelectionBoxesForVisibilityFeatures();

        features.push(...textFeatures, ...imageFeatures, ...drawFeatures, ...losFeatures, ...visibilityFeatures);

        const data = {
            type: 'FeatureCollection',
            features: features
        };

        this.map.getSource('selection-boxes').setData(data);
    }

    createSelectionBoxesForTextFeatures = () => {
        return Array.from(this.selectionManager.selectedTextFeatures.values()).map(feature => {
            const coordinates = feature.geometry.coordinates;
            const { width, height } = this.measureTextSize(feature.properties.text, feature.properties.size, 'Arial');
            const polygon = this.createSelectionBox(coordinates, width, height, feature.properties.rotation);
            return {
                type: 'Feature',
                geometry: polygon,
                properties: {}
            };
        });
    }

    createSelectionBoxesForImageFeatures = () => {
        return Array.from(this.selectionManager.selectedImageFeatures.values()).map(feature => {
            const coordinates = feature.geometry.coordinates;
            const width = feature.properties.width * feature.properties.size;
            const height = feature.properties.height * feature.properties.size;
            const polygon = this.createSelectionBox(coordinates, width, height, feature.properties.rotation);
            return {
                type: 'Feature',
                geometry: polygon,
                properties: {}
            };
        });
    }

    createSelectionBoxesForDrawFeatures = () => {
        const zoom = this.map.getZoom();
        const center = this.map.getCenter();
        const latitude = center.lat;
        const pixelBuffer = 10;

        return Array.from(this.selectionManager.selectedDrawFeatures.values()).map(feature => 
            this.calculateBuffer(feature, zoom, latitude, pixelBuffer)
        );
    }

    createSelectionBoxesForLOSFeatures = () => {
        return Array.from(this.selectionManager.selectedLOSFeatures.values()).map(feature => {
            const mergedLine = {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: feature.geometry.coordinates.flat()
                }
            };

            return this.calculateBuffer(mergedLine);
        });
    }

    createSelectionBoxesForVisibilityFeatures = () => {
        const x= Array.from(this.selectionManager.selectedVisibilityFeatures.values()).map(feature => 
            this.calculateBuffer(feature));
        return x
    }

    updatePanels = () => {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (allSelectedFeatures.length > 0) {
            this.createUnifiedAttributesPanel(allSelectedFeatures);
        } else {
            this.saveChangesAndClosePanel();
        }
    }

    createUnifiedAttributesPanel = (selectedFeatures) => {
        let panel = document.querySelector('.unified-attributes-panel');
        if (panel) {
            panel.remove();
        }

        panel = document.createElement('div');
        panel.className = 'unified-attributes-panel';

        const featureTypes = new Set(selectedFeatures.map(f => f.properties.source));

        if (featureTypes.size === 1) {
            const featureType = featureTypes.values().next().value;
            if (featureType === 'text') {
                this.addTextAttributes(panel, selectedFeatures);
            } else if (featureType === 'image') {
                this.addImageAttributes(panel, selectedFeatures);
            } else if (featureType === 'draw') {
                this.addDrawAttributes(panel, selectedFeatures);
            } else if (featureType === 'los') {
                this.addLOSAttributes(panel, selectedFeatures);
            } else if (featureType === 'visibility') {
                this.addVisibilityAttributes(panel, selectedFeatures);
            }
        }

        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete';
        deleteButton.onclick = () => this.selectionManager.deleteSelectedFeatures();

        panel.appendChild(deleteButton);
        document.body.appendChild(panel);
    }

    showVectorTileInfoPanel(feature) {
        this.saveChangesAndClosePanel();

        const panel = document.createElement('div');
        panel.className = 'unified-attributes-panel';

        this.addVectorTileInfoToPanel(panel, feature);

        document.body.appendChild(panel);
    }

    addVectorTileInfoToPanel(panel, feature) {
        const title = document.createElement('h3');
        title.textContent = `Atributos: (${feature.source})`;
        panel.appendChild(title);

        const propertiesList = document.createElement('ul');
        for (const [key, value] of Object.entries(feature.properties)) {
            const listItem = document.createElement('li');
            listItem.textContent = `${key}: ${value}`;
            propertiesList.appendChild(listItem);
        }
        panel.appendChild(propertiesList);

        const closeButton = document.createElement('button');
        closeButton.textContent = 'Fechar';
        closeButton.onclick = () => {
            this.saveChangesAndClosePanel();
        };
        panel.appendChild(closeButton);
    }

    updatePanels() {
        const allSelectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (allSelectedFeatures.length > 0) {
            this.createUnifiedAttributesPanel(allSelectedFeatures);
        } else {
            this.saveChangesAndClosePanel();
        }
    }

    saveChangesAndClosePanel = () => {
        const panel = document.querySelector('.unified-attributes-panel');
        if (panel) {
            // Trigger save action for the current panel
            const saveButton = panel.querySelector('button[type="submit"]');
            if (saveButton) {
                saveButton.click();
            }
            
            // Close the panel
            panel.remove();
        }
    }

    addTextAttributes = (panel, features) => {
        const textPanel = document.createElement('div');
        textPanel.className = 'text-attributes-section';
        addTextAttributesToPanel(textPanel, features, this.selectionManager.textControl, this.selectionManager, this);
        panel.appendChild(textPanel);
    }

    addImageAttributes = (panel, features) => {
        const imagePanel = document.createElement('div');
        imagePanel.className = 'image-attributes-section';
        addImageAttributesToPanel(imagePanel, features, this.selectionManager.imageControl, this.selectionManager, this);
        panel.appendChild(imagePanel);
    }

    addDrawAttributes = (panel, features) => {
        const drawPanel = document.createElement('div');
        drawPanel.className = 'draw-attributes-section';
        addFeatureAttributesToPanel(drawPanel, features,  this.selectionManager.drawControl, this.selectionManager, this);
        panel.appendChild(drawPanel);
    }

    addLOSAttributes = (panel, features) => {
        const losPanel = document.createElement('div');
        losPanel.className = 'los-attributes-section';
        addLOSAttributesToPanel(losPanel, features, this.selectionManager.losControl, this.selectionManager, this);
        panel.appendChild(losPanel);
    }

    addVisibilityAttributes = (panel, features) => {
        const visibilityPanel = document.createElement('div');
        visibilityPanel.className = 'visibility-attributes-section';
        addVisibilityAttributesToPanel(visibilityPanel, features, this.selectionManager.visibilityControl, this.selectionManager, this);
        panel.appendChild(visibilityPanel);
    }

    pixelsToDegrees = (pixels, latitude, zoom) => {
        const earthCircumference = 40075017;
        const metersPerPixel = earthCircumference * Math.cos(latitude * Math.PI / 180) / Math.pow(2, zoom + 8);
        const degreesPerMeter = 360 / earthCircumference;
        return pixels * metersPerPixel * degreesPerMeter;
    }
    
    calculateBoundingBox = (feature) => {
        const bbox = turf.bbox(feature);
        return turf.bboxPolygon(bbox);
    }

    calculateBuffer = (feature, zoom, latitude, pixelBuffer) => {
        const bufferSize = this.pixelsToDegrees(pixelBuffer, latitude, zoom);
        const buffered = turf.buffer(feature, bufferSize, { units: 'degrees' });
        return buffered;
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
                [rotatedPoints[0].lng, rotatedPoints[0].lat],
                [rotatedPoints[1].lng, rotatedPoints[1].lat],
                [rotatedPoints[2].lng, rotatedPoints[2].lat],
                [rotatedPoints[3].lng, rotatedPoints[3].lat],
                [rotatedPoints[0].lng, rotatedPoints[0].lat]
            ]]
        }
    }

    measureTextSize = (text, fontSize, fontFamily) => {
        let adjustedFontSize = fontSize + 15; // 15 é um ajuste manual da caixa
        const canvas = document.createElement('canvas'); 
        const context = canvas.getContext('2d');
        context.font = `${adjustedFontSize}px ${fontFamily}`;
        const lines = text.split('\n');
        const width = Math.max(...lines.map(line => context.measureText(line).width));
        const height = (adjustedFontSize  - 8) * lines.length; 
        return { width, height };
    }
}

export default UIManager;
