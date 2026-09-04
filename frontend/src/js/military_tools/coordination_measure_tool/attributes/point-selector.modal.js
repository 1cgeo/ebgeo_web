// Path: js/military_tools/coordination_measure_tool/attributes/point-selector.modal.js

/**
 * @fileoverview Point selector modal for coordination measure configuration.
 * Main orchestrator for the point configuration modal.
 */

import { ModalBase } from '@modals';
import { addDomListener } from '@utils/event-cleanup.js';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';

import {
    createDigitalComboBoxWithThumbnails,
    createCheckbox,
    isEchelonPointCode,
    isNucleoFT,
    trocarFamiliaDoNucleo,
    getPointsGroupedOptions,
    getEchelonSubtypeOptions,
    clearAllTextModifiers,
    createDropdownState
} from './ui-components.helpers.js';
import { createColorControlSection } from './color-control.section.js';
import { createTextModifierField } from './text-modifiers.section.js';
import { getAvailableTextFields } from '../coordination_points_catalog.js';
import { NITIDEZ_DE_TELA } from '../coordination_measure_generator.js';
import { UI_DATA } from '../coordination_measure_constants.js';

/**
 * Icons used in the modal.
 */
const ICONS = {
    coordinationMeasure: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>`
};

/**
 * @typedef {Object} PointModalConfig
 * @property {Object} feature - Feature being edited
 * @property {Array} selectedFeatures - All selected features
 * @property {Object} coordinationMeasureControl - Control instance
 * @property {Object} selectionManager - Selection manager instance
 * @property {Map} initialPropertiesMap - Map of initial properties
 */

/**
 * Miniaturas ja desenhadas, por codigo de ponto.
 *
 * Elas nao dependem das propriedades da feicao (a chamada passa `{}`), entao sao sempre a
 * mesma imagem. Sem esta memoria, marcar Forca-Tarefa reconstruia o combobox de escalao e
 * rasterizava as treze miniaturas OUTRA VEZ, e era isso que fazia a caixa demorar a
 * responder. O modulo vive enquanto a pagina vive, e o catalogo nao muda em tempo de
 * execucao, entao a memoria nunca fica velha.
 */
const miniaturas = new Map();

/**
 * Generate thumbnail for combo box options.
 * @param {Object} coordinationMeasureControl - Control instance
 * @param {string} pointCode - Point code
 * @param {string} defaultEchelonCode - Default echelon code
 * @returns {Promise<string|null>} Data URL or null
 */
async function generatePointThumbnailForCombo(coordinationMeasureControl, pointCode, defaultEchelonCode) {
    try {
        if (pointCode === 'ECHELON' || pointCode === 'ECHELON_FT') {
            pointCode = defaultEchelonCode ||
                (pointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
        }

        if (miniaturas.has(pointCode)) {
            return miniaturas.get(pointCode);
        }

        // Miniatura de combobox tem umas dezenas de pixels: rasteriza-la na nitidez do
        // mapa e trabalho jogado fora, treze vezes por troca de subtipo.
        const result = await coordinationMeasureControl.symbolGenerator.generate(
            pointCode,
            {},
            { nitidez: NITIDEZ_DE_TELA }
        );

        const dataUrl = result?.dataUrl || null;
        miniaturas.set(pointCode, dataUrl);

        return dataUrl;
    } catch (error) {
        console.warn(`Error generating combo thumbnail: ${pointCode}`, error);
        return null;
    }
}

/**
 * Point selector modal class.
 * @extends ModalBase
 */
export class PointSelectorModal extends ModalBase {
    /**
     * @param {PointModalConfig} config - Modal configuration
     */
    constructor(config) {
        super({
            id: 'point-selector-modal',
            title: 'Configurar Medida de Coordenação',
            icon: ICONS.coordinationMeasure,
            // Transient modal: a fresh instance is created per open (openPointModal),
            // so the overlay and the document keydown listener must go on hide.
            destroyOnHide: true
        });

        this._feature = config.feature;
        this._selectedFeatures = config.selectedFeatures;
        this._coordinationMeasureControl = config.coordinationMeasureControl;
        this._selectionManager = config.selectionManager;
        this._initialPropertiesMap = config.initialPropertiesMap;

        this._tempProperties = { ...config.feature.properties };
        this._dropdownState = createDropdownState();
        this._previewDebounceTimer = null;
        // Sela cada pedido de previa: um render que chega atrasado nao sobrescreve o atual.
        this._previewToken = 0;
        this._previewImage = null;
        this._subtypeDropdown = null;
        this._ftCheckWrapper = null;
        this._textModifiersContent = null;
        // Combo containers created by this modal. Their dropdowns live in
        // document.body, so they cannot be found by walking the modal subtree.
        this._combos = [];
    }

    /**
     * O combo de tipo tem UMA opcao de Nucleo. A feicao guarda `ECHELON` ou `ECHELON_FT`,
     * e as duas se exibem como a mesma opcao: quem separa as familias e a caixa
     * Forca-Tarefa. Sem esta normalizacao, abrir um Nucleo FT ja salvo mostraria
     * "Selecione..." no combo, porque `ECHELON_FT` nao esta mais na lista.
     *
     * @private
     * @returns {string} Codigo que a lista de tipos conhece
     */
    _codigoDeTipoNaLista() {
        return isEchelonPointCode(this._tempProperties.pointCode)
            ? 'ECHELON'
            : this._tempProperties.pointCode;
    }

    /**
     * O codigo que o CATALOGO conhece. `ECHELON` e `ECHELON_FT` sao codigos de tela, e nao
     * existem no catalogo: quem pergunta ao catalogo (os campos do formulario, a previa)
     * tem de resolver antes, senao recebe lista vazia e o formulario nasce sem os campos.
     *
     * @private
     * @returns {string} Codigo real do ponto
     */
    _codigoRealDoPonto() {
        const codigo = this._tempProperties.pointCode;

        if (codigo === 'ECHELON' || codigo === 'ECHELON_FT') {
            return this._tempProperties.echelonCode
                || (codigo === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
        }

        return codigo;
    }

    /**
     * O Nucleo nasce OCUPADO, que e o caso comum e o traco continuo. Sem isto a Situacao
     * abre em "-- Selecione --", e o desenho fica dependendo de um valor que ninguem
     * escolheu: quem olha a tela nao sabe se a elipse esta continua por decisao ou por
     * omissao.
     *
     * @private
     */
    _semearPadraoDoNucleo() {
        if (!isEchelonPointCode(this._tempProperties.pointCode)) return;

        if (!this._tempProperties.status) {
            this._tempProperties.status = 'ocupado';
        }
    }

    /**
     * Runs the cleanup of a combo container and forgets it.
     * @private
     * @param {HTMLElement} combo - Combo container returned by the factory
     */
    _releaseCombo(combo) {
        if (!combo) return;
        const index = this._combos.indexOf(combo);
        if (index > -1) {
            this._combos.splice(index, 1);
        }
        if (typeof combo._cleanup === 'function') {
            combo._cleanup();
        }
    }

    /**
     * Renders the modal content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._container.classList.add('point-selector-modal-container');

        const body = this.getBody();
        body.innerHTML = '';
        body.appendChild(this._createBodyContent());

        this._setupListeners();
        this._updatePreview();

        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Creates the body content.
     * @private
     * @returns {HTMLElement}
     */
    _createBodyContent() {
        this._semearPadraoDoNucleo();

        const content = document.createElement('div');
        content.className = 'point-selector-content';

        const mainLayout = document.createElement('div');
        mainLayout.className = 'point-selector-main';

        const controlsColumn = document.createElement('div');
        controlsColumn.className = 'point-selector-controls';
        this._controlsColumn = controlsColumn;

        const generateThumbnail = (pointCode, defaultEchelonCode) => {
            return generatePointThumbnailForCombo(this._coordinationMeasureControl, pointCode, defaultEchelonCode);
        };

        const pointTypeCombo = createDigitalComboBoxWithThumbnails(
            getPointsGroupedOptions(),
            this._codigoDeTipoNaLista(),
            (newValue) => this._handlePointTypeChange(newValue),
            'Tipo',
            generateThumbnail,
            this._dropdownState,
            (previewCode) => this._previewPointCode(previewCode)
        );
        this._combos.push(pointTypeCombo);
        controlsColumn.appendChild(pointTypeCombo);

        this._ftCheckWrapper = document.createElement('div');
        this._ftCheckWrapper.className = 'point-selector-ft';
        this._updateFtCheck();
        controlsColumn.appendChild(this._ftCheckWrapper);

        this._subtypeDropdown = document.createElement('div');
        this._subtypeDropdown.className = 'point-selector-subtype';
        this._subtypeDropdown.style.display = isEchelonPointCode(this._tempProperties.pointCode) ? 'block' : 'none';
        this._updateSubtypeCombo();
        controlsColumn.appendChild(this._subtypeDropdown);

        const colorControl = createColorControlSection(
            this._tempProperties.fillColor,
            (newColor) => {
                this._tempProperties.fillColor = newColor;
                this._updatePreviewDebounced();
            },
            'Cor do símbolo'
        );
        controlsColumn.appendChild(colorControl);

        const textModifiersSection = document.createElement('div');
        textModifiersSection.className = 'point-selector-text-modifiers';

        this._textModifiersContent = document.createElement('div');
        this._textModifiersContent.className = 'point-selector-text-grid';
        this._rebuildTextModifiersSection(this._codigoRealDoPonto());
        textModifiersSection.appendChild(this._textModifiersContent);
        controlsColumn.appendChild(textModifiersSection);

        const previewColumn = document.createElement('div');
        previewColumn.className = 'point-selector-preview';

        const previewLabel = document.createElement('h4');
        previewLabel.className = 'point-selector-preview-label';
        previewLabel.textContent = 'Visualização';
        previewColumn.appendChild(previewLabel);

        const previewContainer = document.createElement('div');
        previewContainer.className = 'point-selector-preview-container';

        this._previewImage = document.createElement('img');
        this._previewImage.className = 'point-selector-preview-image';
        previewContainer.appendChild(this._previewImage);
        previewColumn.appendChild(previewContainer);

        mainLayout.appendChild(controlsColumn);
        mainLayout.appendChild(previewColumn);

        content.appendChild(mainLayout);

        const actions = document.createElement('div');
        actions.className = 'point-selector-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'point-selector-btn point-selector-btn-cancel';
        cancelBtn.textContent = 'Cancelar';
        this._cancelBtn = cancelBtn;

        const applyBtn = document.createElement('button');
        applyBtn.className = 'point-selector-btn point-selector-btn-apply';
        applyBtn.textContent = 'Aplicar';
        this._applyBtn = applyBtn;

        actions.appendChild(cancelBtn);
        actions.appendChild(applyBtn);
        content.appendChild(actions);

        return content;
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupListeners() {
        addDomListener(this, this._cancelBtn, 'click', () => this.hide());
        addDomListener(this, this._applyBtn, 'click', () => this._handleApply());
    }

    /**
     * Handles point type change.
     * @private
     * @param {string} newValue - New point code
     */
    _handlePointTypeChange(newValue) {
        const wasEchelon = isEchelonPointCode(this._tempProperties.pointCode);
        const isEchelon = newValue === 'ECHELON' || newValue === 'ECHELON_FT';

        this._tempProperties.pointCode = newValue;

        if (wasEchelon && !isEchelon) {
            this._tempProperties.echelonCode = null;
        }

        if (isEchelon) {
            this._tempProperties.echelonCode = newValue === 'ECHELON_FT' ? 'ECHELON_FT_16' : 'ECHELON_16';
        }

        clearAllTextModifiers(this._tempProperties);
        this._semearPadraoDoNucleo();

        if (isEchelon) {
            this._subtypeDropdown.style.display = 'block';
            this._updateSubtypeCombo();
        } else {
            this._subtypeDropdown.style.display = 'none';
        }

        this._updateFtCheck();
        this._rebuildTextModifiersSection(this._codigoRealDoPonto());
        this._updatePreviewDebounced();
    }

    /**
     * Marcar a Forca-Tarefa troca a familia do simbolo e PRESERVA o escalao e os textos ja
     * preenchidos: e a mesma medida com o colchete de FT, nunca um ponto novo. Por isso
     * este caminho nao passa pelo `_handlePointTypeChange`, que limpa os modificadores.
     *
     * @private
     * @param {boolean} marcado - Estado da caixa
     */
    _handleForcaTarefaChange(marcado) {
        this._tempProperties.pointCode = marcado ? 'ECHELON_FT' : 'ECHELON';
        this._tempProperties.echelonCode = trocarFamiliaDoNucleo(
            this._tempProperties.echelonCode,
            marcado
        );

        this._updateSubtypeCombo();
        this._updatePreviewDebounced();
    }

    /**
     * Rebuilds the task force checkbox, shown only for the nucleus.
     * @private
     */
    _updateFtCheck() {
        if (!this._ftCheckWrapper) return;

        this._ftCheckWrapper.innerHTML = '';

        const ehNucleo = isEchelonPointCode(this._tempProperties.pointCode);
        this._ftCheckWrapper.style.display = ehNucleo ? 'block' : 'none';

        if (!ehNucleo) return;

        this._ftCheckWrapper.appendChild(createCheckbox(
            'Força-Tarefa',
            isNucleoFT(this._tempProperties.pointCode),
            (marcado) => this._handleForcaTarefaChange(marcado)
        ));
    }

    /**
     * Updates subtype combo box.
     * @private
     */
    _updateSubtypeCombo() {
        // Release the previous subtype combo before dropping it: its dropdown node
        // and its document click listener live outside this subtree.
        this._releaseCombo(this._subtypeDropdown.firstElementChild);
        this._subtypeDropdown.innerHTML = '';

        if (!isEchelonPointCode(this._tempProperties.pointCode)) return;

        const generateThumbnail = (pointCode, defaultEchelonCode) => {
            return generatePointThumbnailForCombo(this._coordinationMeasureControl, pointCode, defaultEchelonCode);
        };

        const isFT = isNucleoFT(this._tempProperties.pointCode);
        const subtypeCombo = createDigitalComboBoxWithThumbnails(
            getEchelonSubtypeOptions(this._tempProperties.pointCode),
            this._tempProperties.echelonCode || (isFT ? 'ECHELON_FT_16' : 'ECHELON_16'),
            (newValue) => {
                this._tempProperties.echelonCode = newValue;
                this._updatePreviewDebounced();
            },
            'Escalão',
            generateThumbnail,
            this._dropdownState,
            (previewCode) => this._previewPointCode(previewCode)
        );

        this._combos.push(subtypeCombo);
        this._subtypeDropdown.appendChild(subtypeCombo);
    }

    /**
     * Rebuilds text modifiers section.
     * @private
     * @param {string} pointCode - Point code
     */
    _rebuildTextModifiersSection(pointCode) {
        this._textModifiersContent.innerHTML = '';

        const applicableFields = getAvailableTextFields(pointCode);

        applicableFields.forEach(fieldName => {
            const fieldDef = UI_DATA.textFieldDefinitions[fieldName];
            if (!fieldDef) return;

            const fieldContainer = createTextModifierField(
                fieldName,
                fieldDef,
                this._tempProperties[fieldName],
                (newValue) => {
                    this._tempProperties[fieldName] = newValue;
                    this._updatePreviewDebounced();
                }
            );

            this._textModifiersContent.appendChild(fieldContainer);
        });
    }

    /**
     * Desenha a previa de um codigo SEM tocar no estado, para o mouseover do combobox.
     * Com `null` desfaz a previa e devolve o desenho do que esta realmente escolhido.
     *
     * Nao se usa o onChange do combo para isto: aquele caminho limpa os modificadores de
     * texto e reconstroi secoes, o que e destrutivo demais para um passar de mouse.
     *
     * @private
     * @param {string|null} pointCode - Codigo a prever, ou null para desfazer
     */
    async _previewPointCode(pointCode) {
        if (!pointCode) {
            this._updatePreviewDebounced();
            return;
        }

        let actualPointCode = pointCode;
        if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
            // Com um Nucleo ja escolhido, a previa da propria opcao mostra o escalao e a
            // familia correntes, e nao o batalhao padrao.
            actualPointCode = (isEchelonPointCode(this._tempProperties.pointCode)
                && this._tempProperties.echelonCode)
                || (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
        }

        const token = ++this._previewToken;
        try {
            const result = await this._coordinationMeasureControl.symbolGenerator.generate(
                actualPointCode,
                { fillColor: this._tempProperties.fillColor }
            );

            if (token !== this._previewToken) {
                return;
            }

            if (result && result.dataUrl) {
                this._previewImage.src = result.dataUrl;
                this._previewImage.style.display = 'block';
            }
        } catch (error) {
            console.error('Erro ao gerar a previa do combobox:', error);
        }
    }

    /**
     * Updates preview with debounce.
     * @private
     */
    _updatePreviewDebounced() {
        clearTimeout(this._previewDebounceTimer);
        this._previewDebounceTimer = setTimeout(() => {
            this._updatePreview();
        }, 50);
    }

    /**
     * Updates the preview image.
     * @private
     */
    async _updatePreview() {
        const token = ++this._previewToken;
        try {
            if (!this._tempProperties.pointCode) {
                this._previewImage.style.display = 'none';
                return;
            }

            if (isEchelonPointCode(this._tempProperties.pointCode) && !this._tempProperties.echelonCode) {
                this._previewImage.style.display = 'none';
                return;
            }

            let actualPointCode = this._tempProperties.pointCode;

            if (actualPointCode === 'ECHELON' || actualPointCode === 'ECHELON_FT') {
                actualPointCode = this._tempProperties.echelonCode ||
                    (actualPointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
            }

            const result = await this._coordinationMeasureControl.symbolGenerator.generate(
                actualPointCode,
                this._tempProperties
            );

            if (token !== this._previewToken) {
                return;
            }

            if (result && result.dataUrl) {
                this._previewImage.src = result.dataUrl;
                this._previewImage.style.display = 'block';
            } else {
                this._previewImage.style.display = 'none';
            }
        } catch (error) {
            console.error('Error generating preview:', error);
            this._previewImage.style.display = 'none';
        }
    }

    /**
     * Handles apply button click.
     * @private
     */
    async _handleApply() {
        const propertiesToUpdate = [
            'pointCode', 'echelonCode', 'fillColor',
            'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
            'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
        ];

        // Same dispatcher instance `add_coordination_measure_control.js` uses (the registry is
        // keyed by map + source id), so this modal cannot wipe a diff the tool has queued. The
        // read stays: an unknown id must be skipped rather than created.
        const map = this._coordinationMeasureControl.map;
        const dispatcher = getGeoJsonDispatcher(map, 'coordination_measures');
        await dispatcher.flush();
        const data = await map.getSource("coordination_measures").getData();
        const touched = [];
        let needsRegeneration = false;

        for (const feat of this._selectedFeatures) {
            const sourceFeature = data.features.find(
                (f) => f.properties.id === feat.properties.id
            );

            if (sourceFeature) {
                touched.push(sourceFeature);
                for (const key of propertiesToUpdate) {
                    if (Object.prototype.hasOwnProperty.call(this._tempProperties, key)) {
                        sourceFeature.properties[key] = this._tempProperties[key];
                        feat.properties[key] = this._tempProperties[key];

                        if (this._coordinationMeasureControl.geometry.affectsSIDC(key) ||
                            this._coordinationMeasureControl.geometry.affectsTextModifiers(key) ||
                            key === 'fillColor') {
                            needsRegeneration = true;
                        }
                    }
                }
            }
        }

        // The mutated source features are complete, so they ship as upserts (`add` is a total
        // replacement) instead of the whole collection.
        dispatcher.add(touched);
        await dispatcher.flush();

        if (needsRegeneration && this._selectedFeatures.length > 0) {
            const updatedData = await map.getSource("coordination_measures").getData();
            const updatedFeature = updatedData.features.find(
                f => f.properties.id === this._selectedFeatures[0].properties.id
            );

            if (updatedFeature) {
                try {
                    await this._coordinationMeasureControl.updateSymbolImage(updatedFeature);
                } catch (error) {
                    // Codigo que sumiu do catalogo (uma feicao antiga de escalao "Nao
                    // Especificado", por exemplo) fazia o gerador lancar e a modal ficar
                    // aberta, sem gravar e sem avisar. O desenho falha, a edicao segue: o
                    // simbolo cai no icone de erro que layer_setup ja instala.
                    console.error('Nao foi possivel gerar o simbolo desta medida de coordenacao:', error);
                }
                this._coordinationMeasureControl.updateSelectionManagerFeature(updatedFeature);
            }
        }

        await this._coordinationMeasureControl.saveFeatures(this._selectedFeatures, this._initialPropertiesMap);
        this.hide();
        this._selectionManager.deselectAllFeatures();
    }

    /**
     * Hides the modal.
     * @override
     */
    hide() {
        // Iterate over a copy: _releaseCombo mutates the list.
        [...this._combos].forEach(combo => this._releaseCombo(combo));

        if (this._previewDebounceTimer) {
            clearTimeout(this._previewDebounceTimer);
            this._previewDebounceTimer = null;
        }

        super.hide();
    }
}

/**
 * Opens the point configuration modal.
 * @param {PointModalConfig} config - Modal configuration
 */
export function openPointModal(config) {
    const modal = new PointSelectorModal(config);
    modal.render();
    modal.show();
    return modal;
}
