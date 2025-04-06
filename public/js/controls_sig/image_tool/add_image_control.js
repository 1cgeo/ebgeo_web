// Path: js\controls_sig\image_tool\add_image_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddImageControl {
    static DEFAULT_PROPERTIES = {
        size: 1,
        rotation: 0,
        imageBase64: '',
        opacity: 1,
        source: 'image'
    };

    // Reduzir limites para melhorar performance
    static MAX_IMAGE_DIMENSION = 600; // Reduzido de 800px para 600px
    static MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024; // 5MB limite máximo de arquivo
    static IMAGE_QUALITY = 0.5; // Reduzido de 0.7 para 0.5 (50% de qualidade)
    static MOBILE_IMAGE_DIMENSION = 400; // Limite ainda menor para dispositivos móveis

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.imageControl = this;
        this.isActive = false;
        this.processingImage = false; // Flag para evitar processamentos simultâneos
        this.isMobile = window.matchMedia("(max-width: 768px)").matches;
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

        // Adicionar listener para detecção de mudança em dispositivos móveis
        this.mediaQueryList = window.matchMedia("(max-width: 768px)");
        this.mediaQueryList.addEventListener('change', this.handleDeviceChange);

        return this.container;
    }

    // Detectar mudanças de tipo de dispositivo
    handleDeviceChange = (e) => {
        this.isMobile = e.matches;
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
            // Remover listener de media query
            this.mediaQueryList.removeEventListener('change', this.handleDeviceChange);
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
            input.onchange = (event) => {
                const file = event.target.files[0];
                
                // Verificar tamanho do arquivo antes de processar
                if (file.size > AddImageControl.MAX_IMAGE_FILE_SIZE) {
                    alert(`A imagem é muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). O tamanho máximo é ${AddImageControl.MAX_IMAGE_FILE_SIZE / 1024 / 1024}MB.`);
                    return;
                }
                
                this.processingImage = true;
                
                // Mostrar indicador de carregamento (opcional)
                this.map.getCanvas().style.cursor = 'wait';
                
                // Criar URL do objeto para preview
                const objectURL = URL.createObjectURL(file);
                this.objectURLs.push(objectURL);
                
                // Verificar dimensões antes do processamento completo
                const img = new Image();
                img.onload = () => {
                    // Revogar o objectURL após o carregamento
                    URL.revokeObjectURL(objectURL);
                    this.objectURLs = this.objectURLs.filter(url => url !== objectURL);
                    
                    const { width, height } = img;
                    const isVeryLarge = width > 2000 || height > 2000;
                    
                    // Ajustar qualidade baseado no tamanho da imagem
                    const quality = isVeryLarge ? 0.4 : AddImageControl.IMAGE_QUALITY;
                    
                    // Processar a imagem com FileReader
                    const reader = new FileReader();
                    reader.onload = () => {
                        this.processAndAddImage(e.lngLat, reader.result, quality);
                    };
                    reader.onerror = () => {
                        console.error('Erro ao ler arquivo de imagem:', reader.error);
                        this.processingImage = false;
                        this.map.getCanvas().style.cursor = 'crosshair';
                    };
                    reader.readAsDataURL(file);
                };
                img.onerror = () => {
                    URL.revokeObjectURL(objectURL);
                    this.objectURLs = this.objectURLs.filter(url => url !== objectURL);
                    console.error('Erro ao carregar imagem para verificação');
                    this.processingImage = false;
                    this.map.getCanvas().style.cursor = 'crosshair';
                };
                img.src = objectURL;
            };
            input.click();
            this.toolManager.deactivateCurrentTool();
        }
    }

    processAndAddImage = (lngLat, imageBase64, quality = AddImageControl.IMAGE_QUALITY) => {
        // Usar setTimeout para não bloquear a thread principal
        setTimeout(() => {
            this.resizeImage(imageBase64, quality, (resizedImageBase64, width, height) => {
                this.addImageFeature(lngLat, resizedImageBase64, width, height);
                this.processingImage = false;
                this.map.getCanvas().style.cursor = '';
            });
        }, 50);
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

    resizeImage = (imageBase64, quality = AddImageControl.IMAGE_QUALITY, callback) => {
        // Determinar tamanho máximo com base no dispositivo
        const maxDimension = this.isMobile ? 
            AddImageControl.MOBILE_IMAGE_DIMENSION : AddImageControl.MAX_IMAGE_DIMENSION;
            
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            const aspectRatio = width / height;

            // Verificar se redimensionamento é necessário
            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    width = maxDimension;
                    height = Math.round(width / aspectRatio);
                } else {
                    height = maxDimension;
                    width = Math.round(height * aspectRatio);
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            
            // Limpar o canvas para fundo transparente
            ctx.clearRect(0, 0, width, height);
            
            // Desenhar a imagem
            ctx.drawImage(img, 0, 0, width, height);

            // Determinar o tipo de imagem
            let imageType = 'image/png';  // Default para PNG que suporta transparência
            if (imageBase64.startsWith('data:image/jpeg')) {
                imageType = 'image/jpeg';
            } else if (imageBase64.startsWith('data:image/gif')) {
                imageType = 'image/gif';
            }
            
            // Usar menor qualidade para JPEGs para reduzir tamanho
            const finalQuality = imageType === 'image/jpeg' ? quality : 0.8;
            
            // Usar o tipo original, defaulting para PNG
            const resizedImageBase64 = canvas.toDataURL(imageType, finalQuality);
            
            // Liberar memória
            canvas.width = 1;
            canvas.height = 1;
            ctx.clearRect(0, 0, 1, 1);
            
            callback(resizedImageBase64, width, height);
        };
        
        // Tratamento de erro
        img.onerror = () => {
            console.error('Erro ao carregar imagem para redimensionamento');
            this.processingImage = false;
            this.map.getCanvas().style.cursor = '';
            callback(imageBase64, 100, 100); // Fallback para evitar quebra da aplicação
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