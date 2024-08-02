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
        //this.map.on('move', this.updateSelectionHighlight);
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
        const bufferSize = this.pixelsToDegrees(pixelBuffer, latitude, zoom);

        return Array.from(this.selectionManager.selectedDrawFeatures.values()).map(feature =>
            this.calculateBuffer(feature, bufferSize)
        );
    }

    createSelectionBoxesForLOSFeatures = () => {
        const zoom = this.map.getZoom();
        const center = this.map.getCenter();
        const latitude = center.lat;
        const pixelBuffer = 10;
        const bufferSize = this.pixelsToDegrees(pixelBuffer, latitude, zoom);

        return Array.from(this.selectionManager.selectedLOSFeatures.values()).map(feature => {
            return this.calculateBuffer(feature, bufferSize);
        });
    }

    createSelectionBoxesForVisibilityFeatures = () => {
        const zoom = this.map.getZoom();
        const center = this.map.getCenter();
        const latitude = center.lat;
        const pixelBuffer = 10;
        const bufferSize = this.pixelsToDegrees(pixelBuffer, latitude, zoom);

        const x = Array.from(this.selectionManager.selectedVisibilityFeatures.values()).map(feature =>
            this.calculateBuffer(feature, bufferSize));
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
        deleteButton.classList.add('tutorial-button', 'pure-material-button-contained')
        deleteButton.textContent = 'Delete';
        deleteButton.onclick = () => this.selectionManager.deleteSelectedFeatures();

        panel.appendChild(deleteButton);
        document.body.appendChild(panel);

        $('.picker-color').spectrum({
            color: this.value,
            showInput: true,
            containerClassName: "full-spectrum",
            showInitial: true,
            showPalette: true,
            showSelectionPalette: true,
            showAlpha: true,
            maxPaletteSize: 10,
            preferredFormat: "hex",
            cancelText: "Cancelar",
            chooseText: "Escolher",
            move: function (color) {
                this.oninput(color)
                this.value = `#${color.toHex()}`
            },
            show: function () {
            },
            beforeShow: function () {
            },
            hide: function (color) {
            },
            palette: [
                ["rgb(0, 0, 0)", "rgb(67, 67, 67)", "rgb(102, 102, 102)", /*"rgb(153, 153, 153)","rgb(183, 183, 183)",*/
                    "rgb(204, 204, 204)", "rgb(217, 217, 217)", /*"rgb(239, 239, 239)", "rgb(243, 243, 243)",*/ "rgb(255, 255, 255)"],
                ["rgb(152, 0, 0)", "rgb(255, 0, 0)", "rgb(255, 153, 0)", "rgb(255, 255, 0)", "rgb(0, 255, 0)",
                    "rgb(0, 255, 255)", "rgb(74, 134, 232)", "rgb(0, 0, 255)", "rgb(153, 0, 255)", "rgb(255, 0, 255)"],
                ["rgb(230, 184, 175)", "rgb(244, 204, 204)", "rgb(252, 229, 205)", "rgb(255, 242, 204)", "rgb(217, 234, 211)",
                    "rgb(208, 224, 227)", "rgb(201, 218, 248)", "rgb(207, 226, 243)", "rgb(217, 210, 233)", "rgb(234, 209, 220)",
                    "rgb(221, 126, 107)", "rgb(234, 153, 153)", "rgb(249, 203, 156)", "rgb(255, 229, 153)", "rgb(182, 215, 168)",
                    "rgb(162, 196, 201)", "rgb(164, 194, 244)", "rgb(159, 197, 232)", "rgb(180, 167, 214)", "rgb(213, 166, 189)",
                    "rgb(204, 65, 37)", "rgb(224, 102, 102)", "rgb(246, 178, 107)", "rgb(255, 217, 102)", "rgb(147, 196, 125)",
                    "rgb(118, 165, 175)", "rgb(109, 158, 235)", "rgb(111, 168, 220)", "rgb(142, 124, 195)", "rgb(194, 123, 160)",
                    "rgb(166, 28, 0)", "rgb(204, 0, 0)", "rgb(230, 145, 56)", "rgb(241, 194, 50)", "rgb(106, 168, 79)",
                    "rgb(69, 129, 142)", "rgb(60, 120, 216)", "rgb(61, 133, 198)", "rgb(103, 78, 167)", "rgb(166, 77, 121)",
                    /*"rgb(133, 32, 12)", "rgb(153, 0, 0)", "rgb(180, 95, 6)", "rgb(191, 144, 0)", "rgb(56, 118, 29)",
                    "rgb(19, 79, 92)", "rgb(17, 85, 204)", "rgb(11, 83, 148)", "rgb(53, 28, 117)", "rgb(116, 27, 71)",*/
                    "rgb(91, 15, 0)", "rgb(102, 0, 0)", "rgb(120, 63, 4)", "rgb(127, 96, 0)", "rgb(39, 78, 19)",
                    "rgb(12, 52, 61)", "rgb(28, 69, 135)", "rgb(7, 55, 99)", "rgb(32, 18, 77)", "rgb(76, 17, 48)"]
            ]
        });

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
        title.textContent = `Atributos ${feature.source}:`;
        panel.appendChild(title);

        const propertiesList = document.createElement('ul');

        const blacklist = ['id', 'vector_type', 'tilequery', 'mapbox_clip_start', 'mapbox_clip_end', 'justificativa_txt_value', 'visivel_value', 'exibir_linha_rotulo_value', 'suprimir_bandeira_value', 'posicao_rotulo_value', 'direcao_fixada_value'];
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
            this.saveChangesAndClosePanel();
        };
        panel.appendChild(closeButton);
    }

    saveChangesAndClosePanel = () => {
        const panel = document.querySelector('.unified-attributes-panel');
        if (panel) {
            const saveButton = panel.querySelector('button[type="submit"]');
            if (saveButton) {
                saveButton.click();
            }

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
        addFeatureAttributesToPanel(drawPanel, features, this.selectionManager.drawControl, this.selectionManager, this);
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

    calculateBoundingBox = (feature) => {
        const bbox = turf.bbox(feature);
        return turf.bboxPolygon(bbox);
    }

    calculateBuffer = (feature, bufferSize) => {
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
        const height = (adjustedFontSize - 8) * lines.length;
        return { width, height };
    }
}

export default UIManager;