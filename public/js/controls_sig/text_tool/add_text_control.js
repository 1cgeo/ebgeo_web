import { createTextAttributesPanel, deselectAllFeatures } from './text_attributes_panel.js';
import { addFeature, updateFeature, removeFeature } from '../store.js';

let defaultTextProperties = {
    text: '',
    size: 16,
    color: '#000000',
    backgroundColor: '#ffffff'
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

        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map.off('click', this.handleMapClick.bind(this));
        this.map.off('click', 'text-layer', this.handleTextClick.bind(this));
        this.map.off('mouseenter', 'text-layer', this.handleMouseEnter.bind(this));
        this.map.off('mouseleave', 'text-layer', this.handleMouseLeave.bind(this));
        this.map.off('mousedown', 'text-layer', this.handleMouseDown.bind(this));
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
            const text = prompt("Enter text:");
            if (text) {
                this.addTextFeature(e.lngLat, text);
            }
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
            createTextAttributesPanel(Array.from(this.selectedFeatures), this.map, defaultTextProperties);
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
        const offsets = Array.from(this.selectedFeatures).map(f => {
            return {
                feature: f,
                offset: [
                    f.geometry.coordinates[0] - startCoords.lng,
                    f.geometry.coordinates[1] - startCoords.lat
                ]
            };
        });

        const updateCoordinates = () => {
            if (!isDragging) {
                requestAnimationFrame(updateCoordinates);
                return;
            }

            const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
            offsets.forEach(item => {
                const featureIndex = data.features.findIndex(f => f.id === item.feature.id);
                if (featureIndex !== -1) {
                    data.features[featureIndex].geometry.coordinates = [
                        item.feature.geometry.coordinates[0],
                        item.feature.geometry.coordinates[1]
                    ];
                }
            });

            this.map.getSource('texts').setData(data);
            requestAnimationFrame(updateCoordinates);
        };

        const onMove = (e) => {
            isDragging = true;
            const newCoords = e.lngLat;
            offsets.forEach(item => {
                item.feature.geometry.coordinates = [
                    newCoords.lng + item.offset[0],
                    newCoords.lat + item.offset[1]
                ];
            });
        };

        const onUp = () => {
            this.map.getCanvas().style.cursor = '';
            this.map.off('mousemove', onMove);
            this.map.off('mouseup', onUp);

            // Call updateFeature for each selected feature when dragging is complete
            this.selectedFeatures.forEach(f => updateFeature('texts', f));
        };

        this.map.on('mousemove', onMove);
        this.map.once('mouseup', onUp);

        requestAnimationFrame(updateCoordinates);
    }

    deselectAllFeatures() {
        const selectedFeaturesArray = Array.from(this.selectedFeatures);
        deselectAllFeatures(selectedFeaturesArray, this.map);
        this.selectedFeatures.clear();
    }

    getAllSelectedFeatures() {
        return Array.from(this.selectedFeatures);
    }
}

export default AddTextControl;
