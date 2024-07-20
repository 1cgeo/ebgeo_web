import { createImageAttributesPanel } from './image_attributes_panel.js';
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddImageControl {

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.isActive = false;
        this.selectedFeatures = new Set();
        this.isImageClick = false;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.innerHTML = '📷';
        button.title = 'Adicionar imagem';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.map.on('click', this.handleMapClick.bind(this));
        this.map.on('click', 'image-layer', this.handleImageClick.bind(this));
        this.map.on('mouseenter', 'image-layer', this.handleMouseEnter.bind(this));
        this.map.on('mouseleave', 'image-layer', this.handleMouseLeave.bind(this));
        this.map.on('mousedown', 'image-layer', this.handleMouseDown.bind(this));
        this.map.on('move', this.updateSelectionBoxes.bind(this));

        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map.off('click', this.handleMapClick.bind(this));
        this.map.off('click', 'image-layer', this.handleImageClick.bind(this));
        this.map.off('mouseenter', 'image-layer', this.handleMouseEnter.bind(this));
        this.map.off('mouseleave', 'image-layer', this.handleMouseLeave.bind(this));
        this.map.off('mousedown', 'image-layer', this.handleMouseDown.bind(this));
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
        if (this.isImageClick) {
            this.isImageClick = false;
            return;
        }

        if (this.isActive) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (event) => {
                const file = event.target.files[0];
                const reader = new FileReader();
                reader.onload = () => {
                    const imageBase64 = reader.result;
                    this.addImageFeature(e.lngLat, imageBase64);
                };
                reader.readAsDataURL(file);
            };
            input.click();
            this.toolManager.deactivateCurrentTool();
        } else {
            if (!e.originalEvent.shiftKey) {
                this.deselectAllFeatures();
            }
            let panel = document.querySelector('.image-attributes-panel');
            if (panel) {
                const saveButton = panel.querySelector('button[id="SalvarImg"]');
                if (saveButton) {
                    saveButton.click();
                }
                panel.remove();
            }
        }
    }

    addImageFeature(lngLat, imageBase64) {
        const imageId = Date.now().toString(); // Use timestamp as unique ID

        const imageElement = new Image();
        imageElement.src = imageBase64;
        imageElement.onload = () => {
            const width = imageElement.width;
            const height = imageElement.height;

            if (!this.map.hasImage(imageId)) {
                this.map.addImage(imageId, imageElement);
            }

            const feature = {
                type: 'Feature',
                id: imageId,
                properties: {
                    imageId: imageId,
                    size: 1,
                    rotation: 0,
                    width: width,
                    height: height,
                    imageBase64: imageBase64
                },
                geometry: {
                    type: 'Point',
                    coordinates: [lngLat.lng, lngLat.lat]
                }
            };

            const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
            data.features.push(feature);
            this.map.getSource('images').setData(data);
            addFeature('images', feature);
        };
    }

    handleImageClick(e) {
        this.isImageClick = true;
        const featureId = e.features[0].id;
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        const feature = data.features.find(f => f.id == featureId);
        if (feature) {
            // Check if Shift key is pressed for multiple selection
            if (!e.originalEvent.shiftKey) {
                this.deselectAllFeatures();
            }

            if (this.selectedFeatures.has(feature)) {
                this.selectedFeatures.delete(feature);
            } else {
                this.selectedFeatures.add(feature);
            }

            this.map.getSource('images').setData(data);
            this.updateSelectionBoxes();
            createImageAttributesPanel(Array.from(this.selectedFeatures), this);
        }
    }

    handleMouseEnter(e) {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    handleMouseLeave(e) {
        this.map.getCanvas().style.cursor = '';
    }

    handleMouseDown(e) {
        e.preventDefault();
        const feature = e.features[0];

        let selectedFeature = null;
        for (let f of this.selectedFeatures) {
            if (f.id == feature.id) {
                selectedFeature = f;
                break;
            }
        }

        if (!selectedFeature) {
            return;
        }

        this.map.getCanvas().style.cursor = 'grabbing';

        const startCoords = e.lngLat;
        const scale = this.map.getZoom();
        const tolerance = 2 / Math.pow(2, scale);

        const initialCoordinates = [...feature.geometry.coordinates];

        const offsets = Array.from(this.selectedFeatures).map(f => ({
            feature: f,
            offset: [
                f.geometry.coordinates[0] - startCoords.lng,
                f.geometry.coordinates[1] - startCoords.lat
            ]
        }));

        let lastUpdateTime = 0;
        const debounceTime = 20;

        const updatePositions = (newCoords) => {
            const currentTime = Date.now();

            if (currentTime - lastUpdateTime < debounceTime) {
                return;
            }
            lastUpdateTime = currentTime;


            const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
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

            this.map.getSource('images').setData(data);
            this.updateSelectionBoxes();
        };

        const onMove = (e) => {
            const newCoords = e.lngLat;
            updatePositions(newCoords);
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
                this.selectedFeatures.forEach(f => updateFeature('images', f));
            }
        };

        this.map.on('mousemove', onMove);
        this.map.once('mouseup', onUp);
    }

    updateFeaturesProperty(features, property, value) {
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        features.forEach(feature => {
            const f = data.features.find(f => f.id === feature.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;
            }
        });
        this.map.getSource('images').setData(data);
        this.updateSelectionBoxes();
    }

    updateFeatures(features) {
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        features.forEach(feature => {
            const featureIndex = data.features.findIndex(f => f.id === feature.id);
            if (featureIndex !== -1) {
                data.features[featureIndex] = feature;
            }
        });
        this.map.getSource('images').setData(data);
    }

    saveFeature(feature) {
        updateFeature('images', feature);
    }

    deleteFeature(id) {
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        data.features = data.features.filter(f => f.id !== id);
        this.map.getSource('images').setData(data);
        removeFeature('images', id);
    }

    deselectAllFeatures() {
        this.selectedFeatures.clear();
        this.updateSelectionBoxes();
    }

    getAllSelectedFeatures() {
        return Array.from(this.selectedFeatures);
    }

    updateSelectionBoxes() {
        if (this.selectedFeatures.size > 0) {
            const features = Array.from(this.selectedFeatures).map(feature => {
                const coordinates = feature.geometry.coordinates;
                const width = feature.properties.width * feature.properties.size;
                const height = feature.properties.height * feature.properties.size;
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
        } else {
            if (this.map.getSource('selection-boxes')._data.features.length > 0) {
                this.map.getSource('selection-boxes').setData({
                    type: 'FeatureCollection',
                    features: []
                });
            }
        }
    }
}

function createSelectionBox(map, coordinates, width, height, rotate) {
    const radians = rotate * (Math.PI / 180);

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

export default AddImageControl;