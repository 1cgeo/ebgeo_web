import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddImageControl {
    static DEFAULT_PROPERTIES = {
        size: 1,
        rotation: 0,
        imageBase64: '',
        opacity: 1,
        source: 'image'
    };

    static MAX_IMAGE_DIMENSION = 800;
    static IMAGE_QUALITY = 0.7;

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

        $('input[name="base-layer"]').on('change', this.changeButtonColor);
        this.changeButtonColor()

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
        }
    }

    addImageFeature = (lngLat, imageBase64) => {
        const imageId = Date.now().toString();

        this.resizeImage(imageBase64, (resizedImageBase64, width, height) => {
            if (!this.map.hasImage(imageId)) {
                const img = new Image();
                img.onload = () => {
                    this.map.addImage(imageId, img);
                    const feature = this.createImageFeature(lngLat, imageId, resizedImageBase64, width, height);
                    addFeature('images', feature);

                    const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
                    data.features.push(feature);
                    this.map.getSource('images').setData(data);
                };
                img.src = resizedImageBase64;
            }
        });
    }

    resizeImage = (imageBase64, callback) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            const aspectRatio = width / height;

            if (width > AddImageControl.MAX_IMAGE_DIMENSION || height > AddImageControl.MAX_IMAGE_DIMENSION) {
                if (width > height) {
                    width = AddImageControl.MAX_IMAGE_DIMENSION;
                    height = Math.round(width / aspectRatio);
                } else {
                    height = AddImageControl.MAX_IMAGE_DIMENSION;
                    width = Math.round(height * aspectRatio);
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            
            // Set the background to transparent
            ctx.clearRect(0, 0, width, height);
            
            // Draw the image
            ctx.drawImage(img, 0, 0, width, height);

            // Determine the image type
            let imageType = 'image/png';  // Default to PNG to support transparency
            if (imageBase64.startsWith('data:image/jpeg')) {
                imageType = 'image/jpeg';
            } else if (imageBase64.startsWith('data:image/gif')) {
                imageType = 'image/gif';
            }

            // Use the original image type, defaulting to PNG for other formats
            const resizedImageBase64 = canvas.toDataURL(imageType, AddImageControl.IMAGE_QUALITY);
            callback(resizedImageBase64, width, height);
        };
        img.src = imageBase64;
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
        features.forEach(feature => {
            const f = data.features.find(f => f.id == feature.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;
            }
        });
        this.map.getSource('images').setData(data);
    }
    
    updateFeatures = (features, save = false, onlyUpdateProperties = false) => {
        if(features.length > 0){
            const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
            features.forEach(feature => {
                const featureIndex = data.features.findIndex(f => f.id == feature.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        // Only update properties of the existing feature
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        // Replace the entire feature
                        data.features[featureIndex] = feature;
                    }
        
                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ? data.features[featureIndex] : feature;
                        updateFeature('images', featureToUpdate);
                    }
                }
            });
            this.map.getSource('images').setData(data);
        }
    }

    saveFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                updateFeature('images', f);
            }
        });
    }

    discardChangeFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.id));
        });
        this.updateFeatures(features, true, true);
    }

    deleteFeatures = (features) => {
        if (features.length === 0) {
            return;
        }
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        const idsToDelete = new Set(Array.from(features).map(f => String(f.id)));
        data.features = data.features.filter(f => !idsToDelete.has(f.id.toString()));
        this.map.getSource('images').setData(data);

        features.forEach(f => {
            removeFeature('images', f.id);
        });
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.size !== initialProperties.size ||
            feature.properties.rotation !== initialProperties.rotation ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.imageBase64 !== initialProperties.imageBase64
        );
    }
}

export default AddImageControl;