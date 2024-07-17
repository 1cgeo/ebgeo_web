import { addFeature, updateFeature, removeFeature } from '../store.js';
class AddTextControl {
    static DEFAULT_PROPERTIES = {
        text: '',
        size: 16,
        color: '#000000',
        backgroundColor: '#ffffff',
        rotation: 0,
        justify: 'center'
    };

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.textControl = this;
        this.isActive = false;
    }

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "text-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_text_black.svg" alt="TEXT" />';
        button.title = 'Adicionar texto';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.setupEventListeners();

        this.changeButtonColor()
        $('input[name="base-layer"]').on('change', this.changeButtonColor);

        return this.container;
    }
    
    changeButtonColor = () => {
        const color = $('input[name="base-layer"]:checked').val() == 'Carta' ? 'black' : 'white'
        $("#text-tool").html(`<img class="icon-sig-tool" src="./images/icon_text_${color}.svg" alt="TEXT" />`);
        if (!this.isActive) return
        $("#text-tool").html('<img class="icon-sig-tool" src="./images/icon_text_red.svg" alt="TEXT" />');
    }

    onRemove = () => {
        try {
            this.uiManager.removeControl(this.container);
            this.removeEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddTextControl:', error);
            throw error;
        }
    }

    setupEventListeners = () => {
        this.map.on('mouseenter', 'text-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'text-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'text-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'text-layer', this.handleMouseLeave);
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.changeButtonColor()
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        $('input[name="base-layer"]').off('change', this.changeButtonColor);
        this.changeButtonColor()
    }

    handleMapClick = (e) => {
        if (this.isActive) {
            this.addTextFeature(e.lngLat, 'Texto');
            this.toolManager.deactivateCurrentTool();
        } else {
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
            properties: { ...AddTextControl.DEFAULT_PROPERTIES, text },
            geometry: {
                type: 'Point',
                coordinates: [lngLat.lng, lngLat.lat]
            }
        };
    }

    handleMouseEnter = (e) => {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    handleMouseLeave = (e) => {
        this.map.getCanvas().style.cursor = '';
    }
    
    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        features.forEach(feature => {
            const f = data.features.find(f => f.id === feature.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;
            }
        });
        this.map.getSource('texts').setData(data);
    }

    updateFeatures = (features, save = false) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
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
        let coords;
    
        const updateCoordinates = () => {
            if (!isDragging) {
                requestAnimationFrame(updateCoordinates);
                return;
            }
            
            feature.geometry.coordinates = [coords.lng, coords.lat];
            
            const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
            const featureIndex = data.features.findIndex(f => f.id == feature.id);
            if (featureIndex !== -1) {
                data.features[featureIndex] = feature;
                this.map.getSource('texts').setData(data);
            }
    
            isDragging = false;
            requestAnimationFrame(updateCoordinates);
        };
    
        const onMove = (e) => {
            coords = e.lngLat;
            isDragging = true;
        };
    
        const onUp = () => {
            this.map.getCanvas().style.cursor = '';
            this.map.off('mousemove', onMove);
            this.map.off('mouseup', onUp);
    
            // Call updateFeature here, when dragging is complete
            updateFeature('texts', feature);
        };
    
        this.map.on('mousemove', onMove);
        this.map.once('mouseup', onUp);
    
        requestAnimationFrame(updateCoordinates);
    }
    
}

export default AddTextControl;