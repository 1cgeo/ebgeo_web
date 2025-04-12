// Path: js\controls_sig\draw_tool\feature_attributes_panel.js
import { createCustomAttributesPanel } from './custom_attributes_editor.js';
import { processImageFile } from '../utilities/image_processor.js';
import { getTerrainElevation } from '../terrain_control.js';

export function addFeatureAttributesToPanel(panel, selectedFeatures, featureControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form.
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    const commonAttributes = findCommonAttributes(selectedFeatures);

    // Nome da feição (apenas para seleção única)
    if (selectedFeatures.length === 1) {
        const nameSection = document.createElement('div');
        nameSection.className = 'feature-name-section';
        
        const nameTitle = document.createElement('h4');
        nameTitle.textContent = 'Nome da feição';
        nameTitle.style.marginTop = '5px';
        nameTitle.style.marginBottom = '10px';
        nameSection.appendChild(nameTitle);
        
        const nameContainer = $("<div>", { class: "attr-container-row" });
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = feature.properties.name || '';
        nameInput.placeholder = 'Nome da feição';
        nameInput.oninput = (e) => {
            featureControl.updateFeaturesProperty(selectedFeatures, 'name', e.target.value);
        };
        
        nameContainer.append($("<div>", { class: "attr-input", style: "width: 100%" }).append(nameInput));
        nameSection.appendChild(nameContainer[0]);
        panel.appendChild(nameSection);
        
        if (feature.geometry.type === 'Point') {
            const coordsSection = createCoordinatesSection(feature, selectedFeatures, featureControl, uiManager.map);
            panel.appendChild(coordsSection);
        }
    }

    // Visual attributes section
    const visualAttributesSection = document.createElement('div');
    visualAttributesSection.className = 'visual-attributes-section';

    const visualTitle = document.createElement('h4');
    visualTitle.textContent = 'Atributos visuais';
    visualTitle.style.marginTop = '5px';
    visualTitle.style.marginBottom = '10px';
    visualAttributesSection.appendChild(visualTitle);

    commonAttributes.forEach(attr => {
        if (attr === 'profile' && selectedFeatures.length !== 1) {
            return;
        }
        const container = $("<div>", { class: "attr-container-row" });
        const attrLabel = document.createElement('label');
        attrLabel.textContent = getLabel(attr, selectedFeatures);
        const elInput = createInput(
            attr,
            selectedFeatures[0].properties[attr],
            (input, e) => {
                let value = input.type === 'range' || input.type === 'number' ? parseFloat(e.target.value) : e.target.value;
                value = input.type === 'checkbox' ? e.target.checked : value;
                featureControl.updateFeaturesProperty(selectedFeatures, attr, value);
                if(attr === 'profile') {
                    selectionManager.updateProfile();
                }
            },
            feature.geometry.type
        );
        container.append($("<div>", { class: "attr-name" }).append(attrLabel))
        container.append($("<div>", { class: "attr-input" }).append(elInput))
        $(visualAttributesSection).append(container);
    });

    panel.appendChild(visualAttributesSection);

    // Add feature images section (only for single feature selection)
    if (selectedFeatures.length === 1) {
        const imagesSection = document.createElement('div');
        imagesSection.className = 'feature-images-section';
        
        const imagesTitle = document.createElement('h4');
        imagesTitle.textContent = 'Imagens associadas';
        imagesTitle.style.marginTop = '15px';
        imagesTitle.style.marginBottom = '10px';
        imagesSection.appendChild(imagesTitle);
        
        // Container para mostrar as imagens
        const imagesContainer = document.createElement('div');
        imagesContainer.className = 'feature-images-container';
        imagesContainer.style.display = 'flex';
        imagesContainer.style.flexWrap = 'wrap';
        imagesContainer.style.gap = '10px';
        imagesContainer.style.marginBottom = '10px';
        
        // Verificar se já existem imagens
        if (feature.properties.images && feature.properties.images.length > 0) {
            feature.properties.images.forEach((image, index) => {
                const imageWrapper = document.createElement('div');
                imageWrapper.className = 'image-thumbnail-wrapper';
                imageWrapper.style.position = 'relative';
                imageWrapper.style.width = '80px';
                imageWrapper.style.height = '80px';
                
                const img = document.createElement('img');
                img.src = image.imageBase64;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '4px';
                
                const removeButton = document.createElement('button');
                removeButton.innerHTML = '&times;';
                removeButton.className = 'image-remove-button';
                removeButton.style.position = 'absolute';
                removeButton.style.top = '2px';
                removeButton.style.right = '2px';
                removeButton.style.background = 'rgba(255, 0, 0, 0.7)';
                removeButton.style.color = 'white';
                removeButton.style.border = 'none';
                removeButton.style.borderRadius = '50%';
                removeButton.style.width = '20px';
                removeButton.style.height = '20px';
                removeButton.style.cursor = 'pointer';
                removeButton.style.display = 'flex';
                removeButton.style.justifyContent = 'center';
                removeButton.style.alignItems = 'center';
                removeButton.style.padding = '0';
                
                removeButton.onclick = () => {
                    const updatedImages = [...feature.properties.images];
                    updatedImages.splice(index, 1);
                    featureControl.updateFeaturesProperty(selectedFeatures, 'images', updatedImages);
                    imageWrapper.remove();
                };
                
                imageWrapper.appendChild(img);
                imageWrapper.appendChild(removeButton);
                imagesContainer.appendChild(imageWrapper);
            });
        } else {
            const noImagesMsg = document.createElement('p');
            noImagesMsg.textContent = 'Nenhuma imagem associada';
            noImagesMsg.style.fontStyle = 'italic';
            noImagesMsg.style.opacity = '0.7';
            imagesContainer.appendChild(noImagesMsg);
        }
        
        imagesSection.appendChild(imagesContainer);
        
        // Botão para adicionar imagem
        const addImageButton = document.createElement('button');
        addImageButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        addImageButton.textContent = 'Adicionar imagem';
        addImageButton.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async (event) => {
                const file = event.target.files[0];
                if (!file) return;
                
                try {
                    // Usar o utilitário de processamento de imagens
                    const processedImage = await processImageFile(file);
                    
                    // Adicionar à lista de imagens da feição
                    const updatedImages = [...(feature.properties.images || [])];
                    updatedImages.push({ 
                        id: Date.now().toString(),
                        ...processedImage
                    });
                    
                    featureControl.updateFeaturesProperty(selectedFeatures, 'images', updatedImages);
                    
                    // Atualizar UI
                    addFeatureAttributesToPanel(panel, selectedFeatures, featureControl, selectionManager, uiManager);
                } catch (error) {
                    alert(`Erro ao processar imagem: ${error.message}`);
                }
            };
            input.click();
        };
        
        imagesSection.appendChild(addImageButton);
        panel.appendChild(imagesSection);
        
        // Add custom attributes section
        createCustomAttributesPanel(panel, feature, featureControl);
    }

    // Button container
    const container = $("<div>", { class: "attr-container-row" });
    container.css('margin-top', '15px');

    const saveButton = document.createElement('button');
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    saveButton.textContent = 'Salvar';
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        featureControl.saveFeatures(selectedFeatures, initialPropertiesMap)
        selectionManager.deselectAllFeatures(true);
    };
    container.append(saveButton)

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained')
    discardButton.onclick = () => {
        featureControl.discardChangeFeatures(selectedFeatures, initialPropertiesMap)
        selectionManager.deselectAllFeatures(true);
    };
    container.append(discardButton)

    if (selectedFeatures.length === 1) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.textContent = 'Definir padrão';
        setDefaultButton.classList.add('tool-button', 'pure-material-tool-button-contained')
        setDefaultButton.onclick = () => {
            featureControl.setDefaultProperties(feature.properties, commonAttributes);
            selectionManager.deselectAllFeatures(true);
        };
        container.append(setDefaultButton)
    }
    
    $(panel).append(container);
}

function createCoordinatesSection(feature, selectedFeatures, featureControl, map) {
    const section = document.createElement('div');
    section.className = 'coordinates-section';
    
    const title = document.createElement('h4');
    title.textContent = 'Coordenadas do ponto';
    title.style.marginTop = '15px';
    title.style.marginBottom = '10px';
    section.appendChild(title);
    
    // Obter coordenadas atuais
    const [lng, lat] = feature.geometry.coordinates;
    
    // Container para as coordenadas
    const coordsContainer = document.createElement('div');
    coordsContainer.className = 'coordinates-inputs';
    
    // Latitude
    const latContainer = document.createElement('div');
    latContainer.className = 'attr-container-row';
    
    const latLabel = document.createElement('label');
    latLabel.textContent = 'Latitude:';
    latLabel.className = 'attr-name';
    
    const latInput = document.createElement('input');
    latInput.type = 'text';
    latInput.value = lat.toFixed(6);
    latInput.className = 'attr-input';
    
    latContainer.appendChild(latLabel);
    latContainer.appendChild(latInput);
    
    // Longitude
    const lngContainer = document.createElement('div');
    lngContainer.className = 'attr-container-row';
    
    const lngLabel = document.createElement('label');
    lngLabel.textContent = 'Longitude:';
    lngLabel.className = 'attr-name';
    
    const lngInput = document.createElement('input');
    lngInput.type = 'text';
    lngInput.value = lng.toFixed(6);
    lngInput.className = 'attr-input';
    
    lngContainer.appendChild(lngLabel);
    lngContainer.appendChild(lngInput);
    
    // Nova seção para Altitude
    const altContainer = document.createElement('div');
    altContainer.className = 'attr-container-row';
    
    const altLabel = document.createElement('label');
    altLabel.textContent = 'Altitude:';
    altLabel.className = 'attr-name';
    
    const altInputContainer = document.createElement('div');
    altInputContainer.className = 'attr-input';
    altInputContainer.style.display = 'flex';
    altInputContainer.style.alignItems = 'center';
    altInputContainer.style.gap = '5px';
    
    const altInput = document.createElement('input');
    altInput.type = 'text';
    altInput.value = feature.properties.altitude ? feature.properties.altitude.toFixed(2) : '';
    altInput.placeholder = 'Altitude (m)';
    altInput.style.width = 'calc(100% - 40px)';
    
    const getAltButton = document.createElement('button');
    getAltButton.textContent = '📡';
    getAltButton.title = 'Obter altitude do terreno';
    getAltButton.style.padding = '4px 8px';
    getAltButton.style.borderRadius = '4px';
    getAltButton.style.border = '1px solid #ccc';
    getAltButton.style.backgroundColor = '#f0f0f0';
    getAltButton.style.cursor = 'pointer';
    
    getAltButton.onclick = async () => {
        try {
            // Mostrar indicador de carregamento
            getAltButton.textContent = '⏳';
            getAltButton.disabled = true;
            
            // Buscar a altitude do terreno
            const altitude = await getTerrainElevation(map, [lng, lat]);
            
            // Atualizar o campo e a propriedade
            altInput.value = altitude.toFixed(2);
            featureControl.updateFeaturesProperty(selectedFeatures, 'altitude', altitude);
            
            // Restaurar o botão
            getAltButton.textContent = '📡';
            getAltButton.disabled = false;
        } catch (error) {
            console.error('Erro ao obter altitude:', error);
            alert('Não foi possível obter a altitude do terreno');
            getAltButton.textContent = '📡';
            getAltButton.disabled = false;
        }
    };
    
    // Salvar valor digitado manualmente
    altInput.onchange = (e) => {
        const value = parseFloat(e.target.value);
        if (!isNaN(value)) {
            featureControl.updateFeaturesProperty(selectedFeatures, 'altitude', value);
        }
    };
    
    altInputContainer.appendChild(altInput);
    altInputContainer.appendChild(getAltButton);
    
    altContainer.appendChild(altLabel);
    altContainer.appendChild(altInputContainer);
    
    // Adicionar os campos ao container
    coordsContainer.appendChild(latContainer);
    coordsContainer.appendChild(lngContainer);
    coordsContainer.appendChild(altContainer);
    
    // Formato de coordenadas
    const formatContainer = document.createElement('div');
    formatContainer.className = 'attr-container-row';
    
    const formatLabel = document.createElement('label');
    formatLabel.textContent = 'Formato:';
    formatLabel.className = 'attr-name';
    
    const formatSelect = document.createElement('select');
    formatSelect.className = 'attr-input';
    
    const formats = [
        { id: 'latlong', label: 'Lat/Long (graus)' },
        { id: 'utm', label: 'UTM (metros)' },
        { id: 'mgrs', label: 'MGRS' }
    ];
    
    formats.forEach(format => {
        const option = document.createElement('option');
        option.value = format.id;
        option.textContent = format.label;
        formatSelect.appendChild(option);
    });
    
    formatContainer.appendChild(formatLabel);
    formatContainer.appendChild(formatSelect);
    
    coordsContainer.appendChild(formatContainer);
    
    // Botão para atualizar coordenadas
    const updateButton = document.createElement('button');
    updateButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    updateButton.textContent = 'Atualizar coordenadas';
    updateButton.style.marginTop = '10px';
    
    updateButton.onclick = () => {
        try {
            let newCoords;
            
            // Obter valores dos inputs
            const formatType = formatSelect.value;
            const latValue = parseFloat(latInput.value);
            const lngValue = parseFloat(lngInput.value);
            
            // Validar e converter coordenadas
            if (formatType === 'latlong') {
                if (isNaN(latValue) || isNaN(lngValue) || 
                    latValue < -90 || latValue > 90 || 
                    lngValue < -180 || lngValue > 180) {
                    throw new Error('Coordenadas Lat/Long inválidas.');
                }
                
                newCoords = { lng: lngValue, lat: latValue };
            } else if (formatType === 'utm') {
                // Código UTM - implementar conversão
                if (typeof proj4 === 'undefined') {
                    throw new Error('Biblioteca proj4 não disponível para conversão UTM.');
                }
                
                // TODO: Implementar conversão UTM
                throw new Error('Conversão UTM não implementada nesta versão.');
                
            } else if (formatType === 'mgrs') {
                // Código MGRS - implementar conversão
                if (typeof mgrs === 'undefined') {
                    throw new Error('Biblioteca MGRS não disponível para conversão.');
                }
                
                // TODO: Implementar conversão MGRS
                throw new Error('Conversão MGRS não implementada nesta versão.');
            }
            
            // Atualizar as coordenadas do ponto
            if (newCoords) {
                featureControl.updatePointCoordinates(feature, newCoords.lng, newCoords.lat);
                alert('Coordenadas atualizadas com sucesso.');
            }
            
        } catch (error) {
            alert(`Erro ao atualizar coordenadas: ${error.message}`);
        }
    };
    
    coordsContainer.appendChild(updateButton);
    section.appendChild(coordsContainer);
    
    return section;
}

function findCommonAttributes(features) {
    const attributeSets = {
        Point: ['size', 'color', 'opacity'],
        LineString: ['size', 'color', 'opacity', 'measure', 'profile'],
        Polygon: ['color', 'opacity', 'outlinecolor', 'size', 'measure']
    };

    const featureTypes = features.map(f => f.geometry.type);
    const allAttributes = featureTypes.map(type => attributeSets[type]);

    return allAttributes.reduce((common, attributes) => {
        return common.filter(attr => attributes.includes(attr));
    });
}

function getLabel(attr, features) {
    const labels = {
        size: 'Tamanho',
        color: 'Cor',
        opacity: 'Opacidade',
        outlinecolor: 'Cor da borda',
        measure: 'Medir',
        profile: 'Perfil do terreno'
    };

    if (attr === 'size') {
        const allPolygons = features.every(feature => feature.geometry.type === 'Polygon');
        if (allPolygons) {
            return 'Largura da borda';
        } else {
            return 'Tamanho';
        }
    }

    return labels[attr] || attr;
}

function createInput(attr, value, inputCallback, geometryType) {
    let input;
    if (attr === 'color' || attr === 'outlinecolor') {
        input = document.createElement('input');
        input.classList.add("picker-color");
        input.type = 'color';
        input.value = value || '#000000';
    } else if (attr === 'opacity') {
        input = document.createElement('input');
        input.classList.add("slider");
        input.type = 'range';
        input.min = 0.1;
        input.max = 1;
        input.step = 0.1;
        input.value = value !== undefined ? value : 1;
    } else if (attr === 'size') {
        input = document.createElement('input');
        input.classList.add("slider");
        input.type = 'range';
        input.min = geometryType === 'Point' ? 6 : 2;
        input.max = geometryType === 'Point' ? 16 : 30;
        input.step = 1;
        input.value = value !== undefined ? value : 1;
    }
    else if (attr === 'measure' || attr === 'profile') {
        let label = $("<label>", { class: "switch" })
        input = document.createElement('input');
        input.classList.add("slider-check-input");
        input.type = 'checkbox';
        input.checked = value === true;
        label.append(input)
        label.append($("<div>", { class: "slider-check round" }))
        input.oninput = (e) => inputCallback(input, e)
        return label
    } else {
        input = document.createElement('input');
        input.type = 'number';
        input.value = value !== undefined ? value : 1;
    }
    input.oninput = (e) => inputCallback(input, e)
    return input;
}