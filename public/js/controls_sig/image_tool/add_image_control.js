import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddImageControl {
    static DEFAULT_IMAGE_PROPERTIES = {
        size: 1,
        rotation: 0,
        imageBase64: '',
    };

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.imageControl = this;
        this.isActive = false;
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

        this.setupEventListeners();

        return this.container;
    }

    onRemove() {
        try {
            this.uiManager.removeControl(this.container);
            this.removeEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddImageControl:', error);
            throw error;
        }
    }

    setupEventListeners = () => {
        this.map.on('mouseenter', 'image-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'image-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'image-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'image-layer', this.handleMouseLeave);
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
    }

    handleMapClick = (e) => {
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
        }
    }

    addImageFeature = (lngLat, imageBase64) => {
        const imageId = Date.now().toString();

        const imageElement = new Image();
        imageElement.src = imageBase64;
        imageElement.onload = () => {
            const width = imageElement.width;
            const height = imageElement.height;

            if (!this.map.hasImage(imageId)) {
                this.map.addImage(imageId, imageElement);
            }

            const feature = this.createImageFeature(lngLat, imageId, imageBase64, width, height);
            addFeature('images', feature);

            const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
            data.features.push(feature);
            this.map.getSource('images').setData(data);
        };
    }

    createImageFeature = (lngLat, imageId, imageBase64, width, height) => {
        return {
            type: 'Feature',
            id: imageId,
            properties: { ...AddImageControl.DEFAULT_IMAGE_PROPERTIES, imageBase64, width, height, imageId },
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
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        features.forEach(feature => {
            const f = data.features.find(f => f.id === feature.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;
            }
        });
        this.map.getSource('images').setData(data);
    }
    
    updateFeatures = (features, save = false) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        features.forEach(feature => {
            const featureIndex = data.features.findIndex(f => f.id === feature.id);
            if (featureIndex !== -1) {
                data.features[featureIndex] = feature;
            }
            if(save){
                updateFeature('images', feature);
            }
        });
        this.map.getSource('images').setData(data);
    }

    saveFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                updateFeature('images', f);
            }
        });
    }

    discartChangeFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.id));
        });
        this.updateFeatures(features);
    }

    deleteFeatures = (features) => {
        if (features.size === 0) {
            return;
        }
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        const idsToDelete = new Set(Array.from(features).map(f => f.id));
        data.features = data.features.filter(f => !idsToDelete.has(f.id));
        this.map.getSource('images').setData(data);

        features.forEach(f => {
            removeFeature('images', f.id);
        });
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.size !== initialProperties.size ||
            feature.properties.rotation !== initialProperties.rotation ||
            feature.properties.imageBase64 !== initialProperties.imageBase64
        );
    }
}

export default AddImageControl;