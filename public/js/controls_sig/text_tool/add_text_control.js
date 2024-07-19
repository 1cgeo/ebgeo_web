import { createTextAttributesPanel } from './text_attributes_panel.js';
import { addFeature, updateFeature, removeFeature } from '../store.js';

let defaultTextProperties = {
    text: '',
    size: 16,
    color: '#000000',
    backgroundColor: '#ffffff',
    rotation: 0
};

class AddTextControl {

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.isActive = false;
        this.selectedFeatures = new Set(); // Set to store selected features
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.innerHTML = 'T';
        button.title = 'Adicionar texto';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.map.on('click', this.handleMapClick.bind(this));
        this.map.on('click', 'text-layer', this.handleTextClick.bind(this));
        this.map.on('mouseenter', 'text-layer', this.handleMouseEnter.bind(this));
        this.map.on('mouseleave', 'text-layer', this.handleMouseLeave.bind(this));
        this.map.on('mousedown', 'text-layer', this.handleMouseDown.bind(this));
        this.map.on('move', this.updateSelectionBoxes.bind(this)); // Atualizar as caixas de seleção ao mudar o zoom

        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map.off('click', this.handleMapClick.bind(this));
        this.map.off('click', 'text-layer', this.handleTextClick.bind(this));
        this.map.off('mouseenter', 'text-layer', this.handleMouseEnter.bind(this));
        this.map.off('mouseleave', 'text-layer', this.handleMouseLeave.bind(this));
        this.map.off('mousedown', 'text-layer', this.handleMouseDown.bind(this));
        this.map.off('move', this.updateSelectionBoxes.bind(this));
        this.map = undefined;
    }

    activate() {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
    }

    deactivate() {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
    }

    handleMapClick(e) {
        if (this.isActive) {
            this.addTextFeature(e.lngLat, 'Texto');
            this.toolManager.deactivateCurrentTool();
        } else {
            if (!e.originalEvent.shiftKey) {
                this.deselectAllFeatures();
            }
            let panel = document.querySelector('.text-attributes-panel');
            if (panel) {
                const saveButton = panel.querySelector('button[id="SalvarTxt"]');
                if (saveButton) {
                    saveButton.click();
                }
                panel.remove();
            }
        }
    }

    addTextFeature(lngLat, text) {
        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: { ...defaultTextProperties, text, selected: false }, // Add selected property
            geometry: {
                type: 'Point',
                coordinates: [lngLat.lng, lngLat.lat]
            }
        };

        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        data.features.push(feature);
        this.map.getSource('texts').setData(data);
        addFeature('texts', feature);
    }

    handleTextClick(e) {
        const featureId = e.features[0].id;
        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        const feature = data.features.find(f => f.id == featureId);
        if (feature) {
            // Check if Shift key is pressed for multiple selection
            if (!e.originalEvent.shiftKey) {
                this.deselectAllFeatures();
            }

            // Toggle selection state
            feature.properties.selected = !feature.properties.selected;
            if (feature.properties.selected) {
                this.selectedFeatures.add(feature);
            } else {
                this.selectedFeatures.delete(feature);
            }

            this.map.getSource('texts').setData(data);
            this.updateSelectionBoxes();
            createTextAttributesPanel(Array.from(this.selectedFeatures), this);
        }
    }

    handleMouseEnter(e) {
        const feature = e.features[0];
        if (feature.properties.selected) {
            this.map.getCanvas().style.cursor = 'move';
        }
    }

    handleMouseLeave(e) {
        this.map.getCanvas().style.cursor = '';
    }

    handleMouseDown(e) {
        e.preventDefault();
        const feature = e.features[0];
    
        // Only allow dragging if the feature is selected
        if (!feature.properties.selected) {
            return;
        }
    
        this.map.getCanvas().style.cursor = 'grabbing';
    
        let isDragging = false;
        const startCoords = e.lngLat;
        const scale = this.map.getZoom();
        const tolerance = 2 / Math.pow(2, scale);
    
        const initialCoordinates = [...feature.geometry.coordinates]; // Correctly copy the initial coordinates
    
        const offsets = Array.from(this.selectedFeatures).map(f => ({
            feature: f,
            offset: [
                f.geometry.coordinates[0] - startCoords.lng,
                f.geometry.coordinates[1] - startCoords.lat
            ]
        }));
    
        const updatePositions = (newCoords) => {
            const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
            offsets.forEach(item => {
                item.feature.geometry.coordinates = [
                    newCoords.lng + item.offset[0],
                    newCoords.lat + item.offset[1]
                ];
    
                const featureIndex = data.features.findIndex(f => f.id === item.feature.id);
                if (featureIndex !== -1) {
                    data.features[featureIndex].geometry.coordinates = [
                        item.feature.geometry.coordinates[0],
                        item.feature.geometry.coordinates[1]
                    ];
                }
            });
    
            this.map.getSource('texts').setData(data);
            this.updateSelectionBoxes();
        };
    
        const onMove = (e) => {
            isDragging = true;
            const newCoords = e.lngLat;
            requestAnimationFrame(() => updatePositions(newCoords));
        };
    
        const onUp = (e) => {
            this.map.getCanvas().style.cursor = '';
            this.map.off('mousemove', onMove);
            this.map.off('mouseup', onUp);
            const newCoords = e.lngLat;
    
            // Calculate the distance moved
            const dx = newCoords.lng - initialCoordinates[0];
            const dy = newCoords.lat - initialCoordinates[1];
            const distanceMoved = Math.sqrt(dx * dx + dy * dy);
    
            // Only call updateFeature if the movement exceeds the tolerance
            if (distanceMoved > tolerance) {
                this.selectedFeatures.forEach(f => updateFeature('texts', f));
            }
        };
    
        this.map.on('mousemove', onMove);
        this.map.once('mouseup', onUp);
    }
    
    
    updateFeaturesProperty(features, property, value) {
        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        features.forEach(feature => {
            const f = data.features.find(f => f.id === feature.id);
            if (f) {
                f.properties[property] = value;
                // Atualize a feature também em this.selectedFeatures
                feature.properties[property] = value;
            }
        });
        this.map.getSource('texts').setData(data);
    
        if (property === 'size' || property === 'text' || property === 'rotation') {
            this.updateSelectionBoxes();
        }
    }

    updateFeatures(features) {
        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        features.forEach(feature => {
            const featureIndex = data.features.findIndex(f => f.id === feature.id);
            if (featureIndex !== -1) {
                data.features[featureIndex] = feature;
            }
        });
        this.map.getSource('texts').setData(data);
    }

    saveFeature(feature) {
        updateFeature('texts', feature);
    }

    deleteFeature(id) {
        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        data.features = data.features.filter(f => f.id !== id);
        this.map.getSource('texts').setData(data);
        removeFeature('texts', id);
    }

    setDefaultProperties(properties) {
        defaultTextProperties.color = properties.color;
        defaultTextProperties.size = properties.size;
        defaultTextProperties.backgroundColor = properties.backgroundColor;
    }

    deselectAllFeatures() {
        const selectedFeaturesArray = Array.from(this.selectedFeatures);
        selectedFeaturesArray.forEach(feature => {
            feature.properties.selected = false;
        });
        this.selectedFeatures.clear();
        this.updateSelectionBoxes();
    }

    getAllSelectedFeatures() {
        return Array.from(this.selectedFeatures);
    }

    updateSelectionBoxes() {
        if(this.selectedFeatures.size > 0){
            const features = Array.from(this.selectedFeatures).map(feature => {
                const coordinates = feature.geometry.coordinates;
                const { width, height } = measureTextSize(feature.properties.text, feature.properties.size+15, 'Arial'); // Ajuste a família de fontes conforme necessário
                const polygon = createSelectionBox(this.map, coordinates, width, height, feature.properties.rotation);
                return {
                    type: 'Feature',
                    geometry: polygon,
                    properties: {}
                };
            });
    
            const data = {
                type: 'FeatureCollection',
                features: features
            };
    
            this.map.getSource('selection-boxes').setData(data);
        }
        else{
            if(this.map.getSource('selection-boxes')._data.features.length > 0){
                this.map.getSource('selection-boxes').setData({
                    type: 'FeatureCollection',
                    features: []
                });
            }
        }
    }
}

function measureTextSize(text, fontSize, fontFamily) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = `${fontSize}px ${fontFamily}`;
    const lines = text.split('\n');
    const width = Math.max(...lines.map(line => context.measureText(line).width));
    const height = (fontSize - 8) * lines.length; // Calcular a altura com base no número de linhas
    return { width, height };
}


function createSelectionBox(map, coordinates, width, height, rotate) {
    const radians = rotate * (Math.PI / 180); // Converter graus para radianos

    const point = map.project(coordinates);
    const points = [
        [-width / 2, -height / 2],
        [width / 2, -height / 2],
        [width / 2, height / 2],
        [-width / 2, height / 2]
    ];

    const rotatedPoints = points.map(([x, y]) => {
        const nx = x * Math.cos(radians) - y * Math.sin(radians);
        const ny = x * Math.sin(radians) + y * Math.cos(radians);
        return map.unproject([point.x + nx, point.y + ny]);
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
    };
}


export default AddTextControl;
