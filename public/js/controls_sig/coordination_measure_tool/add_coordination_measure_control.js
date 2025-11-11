// Path: js\controls_sig\coordination_measure_tool\add_coordination_measure_control.js
import BaseControl from "../tool_manager/base_control.js";
import { CoordinationMeasureGenerator } from './coordination_measure_generator.js';
import AddCoordinationMeasureGeometry from './add_coordination_measure_geometry.js';
import { COORDINATION_POINTS_CATALOG } from './coordination_points_catalog.js';
import { UI_DATA, SUPPLY_CLASSES } from './coordination_measure_constants.js';

/**
 * Coordination Measure Control
 * Handles creation and management of military coordination measure points
 */
export class AddCoordinationMeasureControl extends BaseControl {
    constructor() {
        super();
        
        // Core components
        this.generator = new CoordinationMeasureGenerator();
        this.geometry = new AddCoordinationMeasureGeometry();
        
        // State management
        this.selectedPointCode = null;
        this.isEchelonType = false;
        
        // UI elements
        this.mainDropdown = null;
        this.subtypeDropdown = null;
        this.modifiersPanel = null;
    }

    /**
     * Initialize the control and create UI elements
     */
    initialize() {
        super.initialize();
        this.createAttributePanel();
        this.setupMapEvents();
    }

    // ===== UI CREATION =====

    /**
     * Create main attribute panel with point selection and modifiers
     * @returns {HTMLElement} Created panel element
     */
    createAttributePanel() {
        const panel = document.createElement('div');
        panel.className = 'coordination-measure-panel';
        panel.innerHTML = `
            <div class="panel-header">
                <h3>📍 Medidas de Coordenação - Pontos</h3>
            </div>
            <div class="panel-body"></div>
        `;
        
        const panelBody = panel.querySelector('.panel-body');
        
        // Main type dropdown
        this.mainDropdown = this.createMainDropdown();
        panelBody.appendChild(this.mainDropdown);
        
        // Subtype dropdown (for echelon types)
        this.subtypeDropdown = this.createSubtypeDropdown();
        this.subtypeDropdown.style.display = 'none';
        panelBody.appendChild(this.subtypeDropdown);
        
        // Separator
        const separator = document.createElement('hr');
        separator.className = 'panel-separator';
        panelBody.appendChild(separator);
        
        // Modifiers panel (dynamic fields)
        this.modifiersPanel = document.createElement('div');
        this.modifiersPanel.className = 'modifiers-panel';
        panelBody.appendChild(this.modifiersPanel);
        
        document.body.appendChild(panel);
        return panel;
    }

    /**
     * Create main dropdown for point type selection
     * @returns {HTMLElement} Dropdown container element
     */
    createMainDropdown() {
        const container = document.createElement('div');
        container.className = 'field-group';
        
        const label = document.createElement('label');
        label.textContent = 'Tipo de Ponto:';
        label.className = 'field-label';
        container.appendChild(label);
        
        const select = document.createElement('select');
        select.className = 'field-select main-type-select';
        select.name = 'mainType';
        
        // Default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Selecione o tipo...';
        select.appendChild(defaultOption);
        
        // Group points by category
        const grouped = this.groupPointsByCategory();
        
        // Category order for organized display
        const categoryOrder = [
            'Gerais',
            'Movimento e Manobra',
            'Passagens',
            'Fogos',
            'Proteção - Obstáculos',
            'Proteção - Fortificação',
            'Proteção - Minas',
            'Proteção - QBRN',
            'Logística',
            'Controle Aéreo',
            'Controle Marítimo'
        ];
        
        // Add categorized options
        categoryOrder.forEach(category => {
            if (grouped[category] && grouped[category].length > 0) {
                const optgroup = document.createElement('optgroup');
                optgroup.label = category;
                
                grouped[category].forEach(point => {
                    const option = document.createElement('option');
                    option.value = point.code;
                    option.textContent = point.label;
                    optgroup.appendChild(option);
                });
                
                select.appendChild(optgroup);
            }
        });
        
        // Add special echelon types
        const specialGroup = document.createElement('optgroup');
        specialGroup.label = '⭐ ESPECIAIS (com subtipos)';
        
        const echelonOption = document.createElement('option');
        echelonOption.value = 'ECHELON';
        echelonOption.textContent = 'Escalão';
        specialGroup.appendChild(echelonOption);
        
        const echelonFTOption = document.createElement('option');
        echelonFTOption.value = 'ECHELON_FT';
        echelonFTOption.textContent = 'Escalão Força-Tarefa';
        specialGroup.appendChild(echelonFTOption);
        
        select.appendChild(specialGroup);
        
        // Event handler
        select.addEventListener('change', (e) => {
            this.onMainTypeChange(e.target.value);
        });
        
        container.appendChild(select);
        return container;
    }

    /**
     * Group points by category for organized dropdown
     * @returns {Object} Points grouped by category
     */
    groupPointsByCategory() {
        const grouped = {};
        
        UI_DATA.pointsList.forEach(point => {
            const category = point.category || 'Outros';
            
            if (!grouped[category]) {
                grouped[category] = [];
            }
            
            grouped[category].push(point);
        });
        
        // Sort points within each category
        Object.keys(grouped).forEach(category => {
            grouped[category].sort((a, b) => a.label.localeCompare(b.label));
        });
        
        return grouped;
    }

    /**
     * Create subtype dropdown for echelon selection
     * @returns {HTMLElement} Dropdown container element
     */
    createSubtypeDropdown() {
        const container = document.createElement('div');
        container.className = 'field-group subtype-group';
        
        const label = document.createElement('label');
        label.textContent = 'Escalão:';
        label.className = 'field-label';
        container.appendChild(label);
        
        const select = document.createElement('select');
        select.className = 'field-select subtype-select';
        select.name = 'echelonSubtype';
        
        select.addEventListener('change', (e) => {
            this.onSubtypeChange(e.target.value);
        });
        
        container.appendChild(select);
        return container;
    }

    // ===== EVENT HANDLERS =====

    /**
     * Handle main type dropdown change
     * @param {string} value - Selected value
     */
    onMainTypeChange(value) {
        this.modifiersPanel.innerHTML = '';
        
        if (value === 'ECHELON' || value === 'ECHELON_FT') {
            // Echelon type requires subtype selection
            this.isEchelonType = value;
            this.selectedPointCode = null;
            
            this.populateSubtypeDropdown(value);
            this.subtypeDropdown.style.display = 'block';
            
            return;
        }
        
        // Regular point type
        this.isEchelonType = false;
        this.selectedPointCode = value;
        
        this.subtypeDropdown.style.display = 'none';
        
        if (value) {
            this.updateModifiersPanel(value);
        }
    }

    /**
     * Populate subtype dropdown with echelon options
     * @param {string} type - Echelon type ('ECHELON' or 'ECHELON_FT')
     */
    populateSubtypeDropdown(type) {
        const select = this.subtypeDropdown.querySelector('select');
        select.innerHTML = '';
        
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Selecione o escalão...';
        select.appendChild(defaultOption);
        
        const subtypes = type === 'ECHELON' 
            ? UI_DATA.echelonSubtypes 
            : UI_DATA.echelonFTSubtypes;
        
        subtypes.forEach(subtype => {
            const option = document.createElement('option');
            option.value = subtype.code;
            option.textContent = subtype.label;
            select.appendChild(option);
        });
    }

    /**
     * Handle subtype dropdown change
     * @param {string} value - Selected subtype value
     */
    onSubtypeChange(value) {
        if (!value) {
            this.selectedPointCode = null;
            this.modifiersPanel.innerHTML = '';
            return;
        }
        
        this.selectedPointCode = value;
        this.updateModifiersPanel(value);
    }

    /**
     * Update modifiers panel with fields for selected point type
     * @param {string} pointCode - Selected point code
     */
    updateModifiersPanel(pointCode) {
        const pointData = COORDINATION_POINTS_CATALOG[pointCode];
        
        if (!pointData) {
            this.modifiersPanel.innerHTML = '<p class="no-fields-message">Ponto não encontrado</p>';
            return;
        }
        
        this.modifiersPanel.innerHTML = '<h4 class="modifiers-title">Amplificadores Textuais</h4>';
        
        if (!pointData.textFields || pointData.textFields.length === 0) {
            this.modifiersPanel.innerHTML += '<p class="no-fields-message">Sem campos adicionais</p>';
            return;
        }
        
        // Create fields for each text modifier
        pointData.textFields.forEach(fieldName => {
            const fieldDef = UI_DATA.textFieldDefinitions[fieldName];
            
            if (!fieldDef) {
                console.warn(`Field definition not found: ${fieldName}`);
                return;
            }
            
            const fieldGroup = this.createFieldGroup(fieldName, fieldDef);
            this.modifiersPanel.appendChild(fieldGroup);
        });
    }

    /**
     * Create field group for a modifier
     * @param {string} fieldName - Field name
     * @param {Object} fieldDef - Field definition
     * @returns {HTMLElement} Field group element
     */
    createFieldGroup(fieldName, fieldDef) {
        const fieldGroup = document.createElement('div');
        fieldGroup.className = 'field-group';
        
        // Label
        const label = document.createElement('label');
        label.textContent = fieldDef.label + ':';
        label.className = 'field-label';
        if (fieldDef.required) label.classList.add('required');
        fieldGroup.appendChild(label);
        
        // Input/Select
        if (fieldDef.type === 'select') {
            const select = this.createSelectField(fieldName, fieldDef);
            fieldGroup.appendChild(select);
        } else {
            const input = this.createInputField(fieldName, fieldDef);
            fieldGroup.appendChild(input);
        }
        
        // Help text
        if (fieldDef.help) {
            const help = document.createElement('span');
            help.className = 'field-help';
            help.textContent = fieldDef.help;
            fieldGroup.appendChild(help);
        }
        
        return fieldGroup;
    }

    /**
     * Create select field
     * @param {string} fieldName - Field name
     * @param {Object} fieldDef - Field definition
     * @returns {HTMLElement} Select element
     */
    createSelectField(fieldName, fieldDef) {
        const select = document.createElement('select');
        select.className = 'field-select';
        select.name = fieldName;
        
        // Default option
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = 'Selecione...';
        select.appendChild(defaultOpt);
        
        // Options
        const options = fieldName === 'classeSuprimento' 
            ? Object.entries(SUPPLY_CLASSES).map(([k, v]) => ({ value: k, label: v }))
            : fieldDef.options.map(o => ({ value: o, label: o }));
        
        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            select.appendChild(option);
        });
        
        return select;
    }

    /**
     * Create input field
     * @param {string} fieldName - Field name
     * @param {Object} fieldDef - Field definition
     * @returns {HTMLElement} Input element
     */
    createInputField(fieldName, fieldDef) {
        const input = document.createElement('input');
        input.className = 'field-input';
        input.name = fieldName;
        input.type = fieldDef.type;
        input.placeholder = fieldDef.placeholder || '';
        
        if (fieldDef.type === 'number') {
            input.min = '1';
        }
        
        return input;
    }

    // ===== MAP INTERACTION =====

    /**
     * Setup map event listeners
     */
    setupMapEvents() {
        this.map.on('click', async (e) => {
            if (!this.selectedPointCode) {
                this.showWarning('Selecione um tipo de ponto');
                return;
            }
            
            const coordinates = e.coordinate;
            await this.onClick(coordinates);
        });
    }

    /**
     * Handle map click to add coordination measure
     * @param {Array} coordinates - Click coordinates [lng, lat]
     */
    async onClick(coordinates) {
        const properties = this.collectProperties();
        
        try {
            // Validate before generation
            const errors = this.validate(properties);
            if (errors.length > 0) {
                this.showError(errors.join('\n'));
                return;
            }
            
            // Generate symbol
            const result = await this.generator.generate(this.selectedPointCode, properties);
            
            // Create feature
            const feature = this.createFeature(coordinates, result, properties);
            
            // Add to map
            this.addFeatureToMap(feature);
            
            this.showSuccess('Ponto adicionado com sucesso');
            
        } catch (error) {
            console.error('Error generating symbol:', error);
            this.showError('Erro ao gerar símbolo: ' + error.message);
        }
    }

    /**
     * Create feature object from coordinates and properties
     * @param {Array} coordinates - Feature coordinates
     * @param {Object} result - Generator result
     * @param {Object} properties - Feature properties
     * @returns {Object} Feature object
     */
    createFeature(coordinates, result, properties) {
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates },
            properties: {
                featureType: 'coordination_measure',
                pointCode: this.selectedPointCode,
                imageUrl: result.dataUrl,
                width: result.width,
                height: result.height,
                anchor: result.anchor,
                createdAtZoom: this.map.getView().getZoom(),
                ...properties
            }
        };
    }

    // ===== PROPERTY COLLECTION & VALIDATION =====

    /**
     * Collect properties from modifier fields
     * @returns {Object} Collected properties
     */
    collectProperties() {
        const properties = {};
        const inputs = this.modifiersPanel.querySelectorAll('input, select');
        
        inputs.forEach(input => {
            const name = input.name;
            let value = input.value.trim();
            
            if (!value) return;
            
            // Convert number fields
            if (input.type === 'number') {
                value = parseInt(value, 10);
            }
            
            properties[name] = value;
        });
        
        return properties;
    }

    /**
     * Validate properties before feature creation
     * @param {Object} properties - Properties to validate
     * @returns {Array} Array of error messages (empty if valid)
     */
    validate(properties) {
        const errors = [];
        const pointData = COORDINATION_POINTS_CATALOG[this.selectedPointCode];
        
        if (!pointData) {
            errors.push('Tipo de ponto inválido');
            return errors;
        }
        
        // Check required fields based on point type
        if (pointData.requiresNumber && !properties.numero) {
            errors.push('Este ponto requer um número');
        }
        
        if (pointData.hasSupplyIcon && !properties.classeSuprimento) {
            errors.push('Selecione a classe de suprimento');
        }
        
        if (pointData.isEchelon) {
            if (!properties.nome) {
                errors.push('Informe o nome da unidade');
            }
            if (!properties.status) {
                errors.push('Selecione o status');
            }
        }
        
        // Validate GDH formats
        if (properties.gdhIni && !this.validateGDH(properties.gdhIni)) {
            errors.push('GDH Início com formato inválido (use: ddhhmmZ mês)');
        }
        
        if (properties.gdhFim && !this.validateGDH(properties.gdhFim)) {
            errors.push('GDH Fim com formato inválido (use: ddhhmmZ mês ou "Mdt O")');
        }
        
        // Validate number range
        if (properties.numero !== undefined && properties.numero < 1) {
            errors.push('Número deve ser maior ou igual a 1');
        }
        
        return errors;
    }

    /**
     * Validate GDH (Date-Time-Group) format
     * @param {string} gdh - GDH string to validate
     * @returns {boolean} True if valid format
     */
    validateGDH(gdh) {
        if (!gdh || gdh === "Mdt O") return true;
        
        // Format: ddhhmmZ MMM (e.g., 121400Z JUN)
        const regex = /^\d{6}Z\s[A-Z]{3}$/;
        return regex.test(gdh);
    }

    // ===== FEATURE MANAGEMENT =====

    /**
     * Add feature to map with styling and selection box
     * @param {Object} feature - Feature to add
     */
    addFeatureToMap(feature) {
        // Add to source
        this.source.addFeature(feature);
        
        // Apply icon style
        const style = new ol.style.Style({
            image: new ol.style.Icon({
                src: feature.properties.imageUrl,
                anchor: this.getAnchorArray(feature.properties.anchor),
                anchorXUnits: 'fraction',
                anchorYUnits: 'fraction',
                scale: 1
            })
        });
        
        feature.setStyle(style);
        
        // Calculate selection box
        const selectionBox = this.geometry.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.width,
            feature.properties.height,
            feature.properties.createdAtZoom,
            this.uiManager
        );
        
        feature.properties.selectionBoxGeometry = selectionBox;
    }

    /**
     * Convert anchor string to array format
     * @param {string} anchorString - Anchor position string
     * @returns {Array} Anchor array [x, y]
     */
    getAnchorArray(anchorString) {
        const anchors = {
            'bottom-center': [0.5, 1.0],
            'center-center': [0.5, 0.5],
            'top-center': [0.5, 0.0],
            'bottom-left': [0.0, 1.0]
        };
        
        return anchors[anchorString] || [0.5, 0.5];
    }

    // ===== UI FEEDBACK =====

    /**
     * Show success message
     * @param {string} message - Success message
     */
    showSuccess(message) {
        this.showToast(message, 'success');
    }

    /**
     * Show error message
     * @param {string} message - Error message
     */
    showError(message) {
        alert(message); // Using alert for errors for visibility
    }

    /**
     * Show warning message
     * @param {string} message - Warning message
     */
    showWarning(message) {
        alert(message);
    }

    /**
     * Show toast notification
     * @param {string} message - Toast message
     * @param {string} type - Toast type ('success', 'info', 'warning', 'error')
     */
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    // ===== FEATURE MANAGEMENT METHODS (Required by ToolManager/AttributePanel) =====

    /**
     * Update property for multiple features
     * @param {Array} features - Features to update
     * @param {string} property - Property name
     * @param {*} value - New value
     */
    async updateFeaturesProperty(features, property, value) {
        try {
            for (const feature of features) {
                feature.properties[property] = value;

                // Check if property change requires symbol regeneration
                if (this.requiresRegeneration(property)) {
                    await this.regenerateSymbol(feature);
                }

                // Update feature in map
                this.updateFeatureInMap(feature);
            }
        } catch (error) {
            console.error('Error updating features property:', error);
            throw error;
        }
    }

    /**
     * Check if property change requires symbol regeneration
     * @param {string} property - Property name
     * @returns {boolean} True if regeneration needed
     */
    requiresRegeneration(property) {
        // Text modifiers require regeneration
        const textModifiers = [
            'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
            'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
        ];

        return textModifiers.includes(property);
    }

    /**
     * Regenerate symbol for feature
     * @param {Object} feature - Feature to regenerate
     */
    async regenerateSymbol(feature) {
        try {
            // Collect properties for regeneration
            const properties = {
                tipo: feature.properties.tipo,
                identificacao: feature.properties.identificacao,
                gdhIni: feature.properties.gdhIni,
                gdhFim: feature.properties.gdhFim,
                numero: feature.properties.numero,
                classeSuprimento: feature.properties.classeSuprimento,
                status: feature.properties.status,
                numeroConcentracao: feature.properties.numeroConcentracao,
                altitude: feature.properties.altitude
            };

            // Generate new symbol
            const result = await this.generator.generate(
                feature.properties.pointCode,
                properties
            );

            // Update feature properties with new image data
            feature.properties.imageUrl = result.dataUrl;
            feature.properties.width = result.width;
            feature.properties.height = result.height;
            feature.properties.anchor = result.anchor;

            // Recalculate selection box
            const selectionBox = this.geometry.calculateSelectionBoxGeometry(
                feature.geometry.coordinates,
                feature.properties.width,
                feature.properties.height,
                feature.properties.createdAtZoom,
                this.uiManager
            );

            feature.properties.selectionBoxGeometry = selectionBox;

        } catch (error) {
            console.error('Error regenerating symbol:', error);
            throw error;
        }
    }

    /**
     * Update feature in map (refresh style and selection box)
     * @param {Object} feature - Feature to update
     */
    updateFeatureInMap(feature) {
        // Update style
        const style = new ol.style.Style({
            image: new ol.style.Icon({
                src: feature.properties.imageUrl,
                anchor: this.getAnchorArray(feature.properties.anchor),
                anchorXUnits: 'fraction',
                anchorYUnits: 'fraction',
                scale: feature.properties.size || 1,
                opacity: feature.properties.opacity || 1
            })
        });

        feature.setStyle(style);

        // Recalculate selection box if zoom or size changed
        if (feature.properties.selectionBoxGeometry) {
            const selectionBox = this.geometry.recalculateSelectionBox(
                feature,
                this.uiManager
            );
            feature.properties.selectionBoxGeometry = selectionBox;
        }
    }

    /**
     * Save features to storage
     * @param {Array} features - Features to save
     * @param {Map} initialPropertiesMap - Initial properties for comparison
     */
    async saveFeatures(features, initialPropertiesMap) {
        try {
            for (const feature of features) {
                const initialProperties = initialPropertiesMap.get(feature.properties.id);

                // Only save if properties changed
                if (this.hasFeatureChanged(feature, initialProperties)) {
                    // Save to storage (implement based on your storage system)
                    // await this.storage.updateFeature(feature);
                    console.log('Saving feature:', feature.properties.id);
                }
            }

            this.showSuccess('Alterações salvas com sucesso');
        } catch (error) {
            console.error('Error saving features:', error);
            this.showError('Erro ao salvar alterações: ' + error.message);
        }
    }

    /**
     * Discard changes to features
     * @param {Array} features - Features to revert
     * @param {Map} initialPropertiesMap - Initial properties
     */
    async discardChangeFeatures(features, initialPropertiesMap) {
        try {
            for (const feature of features) {
                const initialProperties = initialPropertiesMap.get(feature.properties.id);

                if (initialProperties) {
                    // Restore all properties
                    Object.keys(initialProperties).forEach(key => {
                        feature.properties[key] = initialProperties[key];
                    });

                    // Update feature in map
                    this.updateFeatureInMap(feature);
                }
            }

            this.showSuccess('Alterações descartadas');
        } catch (error) {
            console.error('Error discarding changes:', error);
            this.showError('Erro ao descartar alterações: ' + error.message);
        }
    }

    /**
     * Check if feature has changed compared to initial properties
     * @param {Object} feature - Current feature
     * @param {Object} initialProperties - Initial properties
     * @returns {boolean} True if changed
     */
    hasFeatureChanged(feature, initialProperties) {
        if (!initialProperties) return true;

        // Compare relevant properties
        const propertiesToCompare = [
            'nome', 'size', 'createdAtZoom', 'opacity',
            'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
            'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
        ];

        return propertiesToCompare.some(prop => {
            return feature.properties[prop] !== initialProperties[prop];
        });
    }

    /**
     * Delete features from map and storage
     * @param {Array} features - Features to delete
     */
    async deleteFeatures(features) {
        try {
            for (const feature of features) {
                // Remove from source
                this.source.removeFeature(feature);

                // Delete from storage (implement based on your storage system)
                // await this.storage.deleteFeature(feature.properties.id);
                console.log('Deleting feature:', feature.properties.id);
            }

            this.showSuccess('Features removidas com sucesso');
        } catch (error) {
            console.error('Error deleting features:', error);
            this.showError('Erro ao remover features: ' + error.message);
        }
    }

    /**
     * Get layer IDs handled by this tool
     * @returns {Array} Array of layer IDs
     */
    getLayerIds() {
        return ['coordination-measures-layer'];
    }

    /**
     * Get source names handled by this tool
     * @returns {Array} Array of source names
     */
    getSourceNames() {
        return ['coordination-measures-source'];
    }
}

export default AddCoordinationMeasureControl;