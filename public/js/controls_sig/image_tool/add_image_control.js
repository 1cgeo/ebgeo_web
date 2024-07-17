import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddImageControl {
    static DEFAULT_PROPERTIES = {
        size: 1,
        rotation: 0,
        imageBase64: '',
        opacity: 1,
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
        button.setAttribute("id", "photo-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_photo_black.svg" alt="PHOTO" />';
        button.title = 'Adicionar imagem';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.setupEventListeners();

        this.changeButtonColor()
        $('input[name="base-layer"]').on('change', this.changeButtonColor);

        return this.container;
    }

    changeButtonColor = () => {
        const color = $('input[name="base-layer"]:checked').val() == 'Carta' ? 'black' : 'white'
        $("#photo-tool").html(`<img class="icon-sig-tool" src="./images/icon_photo_${color}.svg" alt="PHOTO" />`);
        if (!this.isActive) return
        $("#photo-tool").html('<img class="icon-sig-tool" src="./images/icon_photo_red.svg" alt="PHOTO" />');
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

        const feature = {
            type: 'Feature',
            id: imageId,
            properties: {
                imageId: imageId,
                size: 1,
                rotation: 0,
                imageBase64: imageBase64
            },
            geometry: {
                type: 'Point',
                coordinates: [lngLat.lng, lngLat.lat]
            }
        };
    
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
            properties: { ...AddImageControl.DEFAULT_PROPERTIES, imageBase64, width, height, imageId },
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
        const feature = data.features.find(f => f.id == featureId);
        if (feature) {
            createImageAttributesPanel(feature, this.map);
        }
    }

    handleMouseDown(e) {
        e.preventDefault();
        const feature = e.features[0];
        this.map.getCanvas().style.cursor = 'grabbing';
    
        let isDragging = false;
        let coords;
        let lastUpdateTime = Date.now();
    
        const updateCoordinates = () => {
            if (!isDragging) {
                requestAnimationFrame(updateCoordinates);
                return;
            }
    
            const currentTime = Date.now();
            if (currentTime - lastUpdateTime >= 50) { // Update every 50ms
                feature.geometry.coordinates = [coords.lng, coords.lat];
    
                const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
                const featureIndex = data.features.findIndex(f => f.id == feature.id);
                if (featureIndex !== -1) {
                    data.features[featureIndex] = feature;
                    this.map.getSource('images').setData(data);
                }
    
                lastUpdateTime = currentTime;
                isDragging = false;
            }
    
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
            updateFeature('images', feature);
        };
    
        this.map.on('mousemove', onMove);
        this.map.once('mouseup', onUp);
    
        requestAnimationFrame(updateCoordinates);
    }  
}

export default AddImageControl;