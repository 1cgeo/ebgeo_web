// Path: js/controls_sig/image_tool/add_image_control.js
import { addFeature, updateFeature, removeFeature, imageStore } from '../store.js';
import { IDUtils } from '../id_utils.js';

class AddImageControl {
    static DEFAULT_PROPERTIES = {
        size: 1,
        rotation: 0,
        opacity: 1,
        source: 'image'
    };

    static MAX_IMAGE_DIMENSION = 800;
    static IMAGE_QUALITY = 0.7;

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.imageControl = this;
        this.isActive = false;
        this.selectionManager = toolManager.selectionManager;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl image-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "photo-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_photo_black.svg" alt="PHOTO" />';
        button.title = 'Adicionar imagem (I)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.setupEventListeners();
        this.changeButtonColor();

        return this.container;
    }

    changeButtonColor = () => {
        $("#photo-tool").html(`<img class="icon-sig-tool" src="./images/icon_photo_black.svg" alt="PHOTO" />`);
        if (!this.isActive) return;
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
        this.changeButtonColor();
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.changeButtonColor();
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

    addImageFeature = async (lngLat, imageBase64) => {
        // Gerar ID único
        const imageId = IDUtils.generateUniqueId();

        this.resizeImage(imageBase64, async (resizedImageBase64, width, height) => {
            try {
                // Converter para blob e salvar no imageStore
                const response = await fetch(resizedImageBase64);
                const blob = await response.blob();
                await imageStore.setItem(imageId, blob);

                // Criar feature com imageId
                const feature = this.createImageFeature(lngLat, imageId, width, height);

                // Salvar no IndexedDB
                await addFeature('images', feature);

                // Atualizar layer do MapLibre
                const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
                data.features.push(feature);
                this.map.getSource('images').setData(data);

                // Adicionar imagem ao mapa (seguindo padrão do map.js)
                await this.loadImageToMap(imageId, blob);

                // Selecionar a feição criada
                this.selectionManager.toggleFeatureSelection('image', feature.properties.id, feature);
                this.selectionManager.updateUI();

            } catch (error) {
                console.error('Erro ao adicionar imagem:', error);
                alert('Erro ao adicionar imagem');
            }
        });
    }

    // Método que segue exatamente o padrão do map.js
    async loadImageToMap(imageId, blob) {
        const url = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
            const image = new Image();

            image.onload = () => {
                try {
                    if (!this.map.hasImage(imageId)) {
                        this.map.addImage(imageId, image);
                    }
                    URL.revokeObjectURL(url);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`Falha ao carregar imagem ${imageId}`));
            };

            // Timeout para evitar travamento
            setTimeout(() => {
                URL.revokeObjectURL(url);
                reject(new Error(`Timeout ao carregar imagem ${imageId}`));
            }, 10000);

            image.src = url;
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

    createImageFeature = (lngLat, imageId, width, height) => {
        return {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddImageControl.DEFAULT_PROPERTIES,
                width,
                height,
                id: imageId
            },
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
        for (const feature of features) {
            const f = data.features.find(f => f.properties.id == feature.properties.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;
            }
        }
        this.map.getSource('images').setData(data);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ? data.features[featureIndex] : feature;
                        await updateFeature('images', featureToUpdate);
                    }
                }
            }
            this.map.getSource('images').setData(data);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('images')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('images', featureToSave);
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
        });
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) {
            return;
        }

        // Remover features do source
        const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
        const idsToDelete = new Set(Array.from(features).map(f => String(f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(f.properties.id.toString()));
        this.map.getSource('images').setData(data);

        // Remover recursos e feições
        for (const f of features) {
            try {
                // Remover imagem do imageStore usando f.properties.id (garantia de consistência)
                await imageStore.removeItem(f.properties.id);

                // Remover do IndexedDB
                await removeFeature('images', f.properties.id);

            } catch (error) {
                console.error(`Erro ao deletar imagem ${f.properties.id}:`, error);
            }
        }
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.size !== initialProperties.size ||
            feature.properties.rotation !== initialProperties.rotation ||
            feature.properties.opacity !== initialProperties.opacity
        );
    }
}

export default AddImageControl;