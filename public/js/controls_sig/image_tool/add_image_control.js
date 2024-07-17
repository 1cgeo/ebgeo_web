import { createImageAttributesPanel } from './image_attributes_panel.js';
import { addFeature, updateFeature } from '../store.js';

class AddImageControl {

    constructor(toolManager) {
        this.toolManager = toolManager;
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
        button.onclick = () =>this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.map.on('click', this.handleMapClick.bind(this));
        this.map.on('click', 'image-layer', this.handleImageClick.bind(this));
        this.map.on('mouseenter', 'image-layer', () => {
            this.map.getCanvas().style.cursor = 'move';
        });
        this.map.on('mouseleave', 'image-layer', () => {
            this.map.getCanvas().style.cursor = '';
        });
        this.map.on('mousedown', 'image-layer', this.handleMouseDown.bind(this));

        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map.off('click', this.handleMapClick.bind(this));
        this.map.off('click', 'image-layer', this.handleImageClick.bind(this));
        this.map.off('mouseenter', 'image-layer');
        this.map.off('mouseleave', 'image-layer');
        this.map.off('mousedown', 'image-layer');
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
            if (!this.map.hasImage(imageId)) {
                this.map.addImage(imageId, imageElement);
            }
    
            const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
            data.features.push(feature);
            this.map.getSource('images').setData(data);
            addFeature('images',feature)
        };
    }
    

    handleImageClick(e) {
        const featureId = e.features[0].id;
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
