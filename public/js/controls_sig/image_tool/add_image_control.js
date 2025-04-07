// Path: js\controls_sig\image_tool\add_image_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { processImageFile } from '../utilities/image_processor.js';

class AddImageControl {
    static DEFAULT_PROPERTIES = {
        size: 1,
        rotation: 0,
        imageBase64: '',
        opacity: 1,
        source: 'image'
    };

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.imageControl = this;
        this.isActive = false;
        this.processingImage = false; // Flag para evitar processamentos simultâneos
        this.objectURLs = []; // Armazenar URLs de objetos para liberação posterior
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
        this.changeButtonColor();

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
            // Limpar todos os objectURLs criados
            this.revokeAllObjectURLs();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddImageControl:', error);
            throw error;
        }
    }

    // Liberar todos os objectURLs para economizar memória
    revokeAllObjectURLs() {
        this.objectURLs.forEach(url => {
            URL.revokeObjectURL(url);
        });
        this.objectURLs = [];
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
        if (this.isActive && !this.processingImage) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async (event) => {
                const file = event.target.files[0];
                if (!file) return;
                
                this.processingImage = true;
                this.map.getCanvas().style.cursor = 'wait';
                
                try {
                    // Usar o utilitário de processamento de imagens
                    const processedImage = await processImageFile(file);
                    this.addImageFeature(e.lngLat, processedImage.imageBase64, processedImage.width, processedImage.height);
                } catch (error) {
                    console.error('Erro ao processar imagem:', error);
                    alert(`Erro ao processar imagem: ${error.message}`);
                } finally {
                    this.processingImage = false;
                    this.map.getCanvas().style.cursor = 'crosshair';
                }
            };
            input.click();
            this.toolManager.deactivateCurrentTool();
        }
    }

    addImageFeature = (lngLat, imageBase64, width, height) => {
        const imageId = Date.now().toString();

        if (!this.map.hasImage(imageId)) {
            const img = new Image();
            img.onload = () => {
                this.map.addImage(imageId, img);
                const feature = this.createImageFeature(lngLat, imageId, imageBase64, width, height);
                addFeature('images', feature);

                const data = JSON.parse(JSON.stringify(this.map.getSource('images')._data));
                data.features.push(feature);
                this.map.getSource('images').setData(data);
            };
            img.src = imageBase64;
        }
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
        
        // Encontrar recursos que serão removidos para limpar imagens
        const featuresToRemove = data.features.filter(f => idsToDelete.has(f.id.toString()));
        
        // Remover imagens do mapa para liberar memória
        featuresToRemove.forEach(feature => {
            if (feature.properties.imageId && this.map.hasImage(feature.properties.imageId)) {
                this.map.removeImage(feature.properties.imageId);
            }
        });
        
        // Atualizar a fonte de dados
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