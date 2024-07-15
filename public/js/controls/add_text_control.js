// public/js/controls/add_text_control.js
import { createTextAttributesPanel } from './text_attributes_panel.js';

let defaultTextProperties = {
    text: '',
    size: 16,
    color: '#000000',
    backgroundColor: '#ffffff'
};

class AddTextControl {
    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.innerHTML = 'T';
        button.title = 'Adicionar texto';
        button.onclick = () => this.enableTextAddingMode();

        this.container.appendChild(button);

        this.map.on('click', this.handleMapClick.bind(this));
        this.map.on('click', 'text-layer', this.handleTextClick.bind(this));
        this.map.on('mouseenter', 'text-layer', () => {
            this.map.getCanvas().style.cursor = 'move';
        });
        this.map.on('mouseleave', 'text-layer', () => {
            this.map.getCanvas().style.cursor = '';
        });
        this.map.on('mousedown', 'text-layer', this.handleMouseDown.bind(this));

        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map.off('click', this.handleMapClick.bind(this));
        this.map.off('click', 'text-layer', this.handleTextClick.bind(this));
        this.map.off('mouseenter', 'text-layer');
        this.map.off('mouseleave', 'text-layer');
        this.map.off('mousedown', 'text-layer');
        this.map = undefined;
    }

    enableTextAddingMode() {
        this.isAddingText = true;
        this.map.getCanvas().style.cursor = 'crosshair';
    }

    handleMapClick(e) {
        if (this.isAddingText) {
            const text = prompt("Enter text:");
            if (text) {
                this.addTextFeature(e.lngLat, text);
            }
            this.isAddingText = false;
            this.map.getCanvas().style.cursor = '';
        } else {
            let panel = document.querySelector('.text-attributes-panel');
            if (panel) {
                const discardButton = panel.querySelector('button[id="DescartarTxt"]');
                if (discardButton) {
                    discardButton.click();
                }
                panel.remove();
            }
        }
    }


    addTextFeature(lngLat, text) {
        if (!this.map.getSource('texts')) {
            this.map.addSource('texts', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            });

            this.map.addLayer({
                id: 'text-layer',
                type: 'symbol',
                source: 'texts',
                layout: {
                    'text-field': ['get', 'text'],
                    'text-size': ['get', 'size'],
                    'text-justify': 'center',
                    'text-anchor': 'center'
                },
                paint: {
                    'text-color': ['get', 'color'],
                    'text-halo-color': ['get', 'backgroundColor'],
                    'text-halo-width': 2
                }
            });
        }

        const feature = {
            type: 'Feature',
            id: Date.now().toString(), // Use timestamp as unique ID
            properties: {...defaultTextProperties, text},
            geometry: {
                type: 'Point',
                coordinates: [lngLat.lng, lngLat.lat]
            }
        };

        const data = this.map.getSource('texts')._data;
        data.features.push(feature);
        this.map.getSource('texts').setData(data);
    }

    handleTextClick(e) {
        const featureId = e.features[0].id;
        const data = this.map.getSource('texts')._data;
        const feature = data.features.find(f => f.id == featureId);
        if (feature) {
            createTextAttributesPanel(feature, this.map, defaultTextProperties);
        }
    }

    handleMouseDown(e) {
        e.preventDefault();
        const feature = e.features[0];
        this.map.getCanvas().style.cursor = 'grabbing';
    
        let isDragging = false;
    
        const onMove = (e) => {
            if (!isDragging) {
                isDragging = true;
                requestAnimationFrame(() => {
                    const coords = e.lngLat;
                    feature.geometry.coordinates = [coords.lng, coords.lat];
    
                    const data = this.map.getSource('texts')._data;
                    const featureIndex = data.features.findIndex(f => f.id == feature.id);
                    if (featureIndex !== -1) {
                        data.features[featureIndex] = feature;
                        this.map.getSource('texts').setData(data);
                    }
                    isDragging = false;
                });
            }
        };
    
        const onUp = () => {
            this.map.getCanvas().style.cursor = '';
            this.map.off('mousemove', onMove);
            this.map.off('mouseup', onUp);
        };
    
        this.map.on('mousemove', onMove);
        this.map.once('mouseup', onUp);
    }
    
}

export default AddTextControl;
