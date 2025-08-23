// Path: js\controls_sig\draw_tool\feature_attributes_panel.js

import { 
    createSliderWithInput, 
    createColorPicker, 
    createCheckbox,
    createAttributeRow,
    createStandardButtons,
    createEditableFeatureName,
    getCommonConfig
} from '../tool_manager/attribute_panel_helpers.js';

export function addFeatureAttributesToPanel(panel, selectedFeatures, featureControl, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) {
        return;
    }

    const feature = selectedFeatures[0]; // Use the first selected feature to populate the form.
    
    // ✅ CORRECT: Capture initial properties at panel opening (before any user interaction)
    // ⚠️ SPECIAL CASE: feature uses f.id instead of f.properties.id (maintaining original behavior)
    const initialPropertiesMap = new Map(selectedFeatures.map(f => [f.id, { ...f.properties }]));

    // ===== NOME EDITÁVEL DA FEIÇÃO (APENAS SELEÇÃO ÚNICA) =====
    if (selectedFeatures.length === 1) {
        const nameComponent = createEditableFeatureName(
            feature.properties.nome,
            (newName) => {
                featureControl.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager.updateSelectionHighlight();
            }
        );
        $(panel).append(nameComponent);
    }

    // ===== LOGIC ESPECÍFICA: FIND COMMON ATTRIBUTES =====
    // ⚠️ MANTER: Lógica específica por geometry type
    const commonAttributes = findCommonAttributes(selectedFeatures);

    commonAttributes.forEach(attr => {
        if (attr === 'profile' && selectedFeatures.length !== 1) {
            return;
        }
        
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
        
        $(panel).append(createAttributeRow(getLabel(attr, selectedFeatures) + ':', elInput));
    });

    // ===== BOTÕES DE AÇÃO PADRONIZADOS =====
    // ✅ FIXED: Pass initialPropertiesMap captured at panel opening
    const buttons = createStandardButtons({
        selectedFeatures,
        control: featureControl,
        selectionManager,
        initialPropertiesMap, // ✅ PASS THE ORIGINAL STATE
        hasSetDefault: selectedFeatures.length === 1,
        onSetDefault: () => {
            featureControl.setDefaultProperties(feature.properties, commonAttributes);
        }
    });

    $(panel).append(buttons);
}

// ===== SPECIFIC FUNCTIONS MAINTAINED =====
// ⚠️ MANTER: Funções específicas do feature tool

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

// ✅ REFACTORED: Using helper functions where possible
function createInput(attr, value, inputCallback, geometryType) {
    let input;
    
    if (attr === 'color' || attr === 'outlinecolor') {
        // ✅ USING HELPER: createColorPicker
        input = createColorPicker(value, (e) => inputCallback(input, e));
        
    } else if (attr === 'opacity') {
        // ✅ USING HELPER: createSliderWithInput with opacity config
        return createSliderWithInput(getCommonConfig('opacity',
            Math.round((value !== undefined ? value : 1) * 100), {
            onChange: (newValue) => {
                const fakeEvent = { target: { value: newValue / 100 } };
                inputCallback({ type: 'range' }, fakeEvent);
            }
        }));
        
    } else if (attr === 'size') {
        // ✅ USING HELPER: createSliderWithInput with size config
        const minValue = geometryType === 'Point' ? 6 : 2;
        const maxValue = geometryType === 'Point' ? 16 : 30;
        
        return createSliderWithInput({
            min: minValue,
            max: maxValue,
            step: 1,
            value: value !== undefined ? value : 1,
            onChange: (newValue) => {
                const fakeEvent = { target: { value: newValue } };
                inputCallback({ type: 'range' }, fakeEvent);
            }
        });
        
    } else if (attr === 'measure' || attr === 'profile') {
        // ✅ USING HELPER: createCheckbox  
        return createCheckbox(value === true, (e) => {
            // Use the inputCallback pattern like other inputs
            inputCallback({ type: 'checkbox' }, e);
        });
        
    } else {
        input = document.createElement('input');
        input.type = 'number';
        input.value = value !== undefined ? value : 1;
        input.oninput = (e) => inputCallback(input, e);
    }
    
    return input;
}