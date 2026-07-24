// Path: js/sidebar/tabs/kmz-export.section.js

/**
 * @fileoverview Configuration panel for the vector KMZ export: map picker plus
 * the options that control what gets embedded in the archive.
 *
 * @module sidebar/tabs/kmz-export.section
 */

import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';
import { showError } from '@utils/index.js';
import { getAllMapNamesStore, getCurrentMapName } from '@store';

/**
 * Checkbox options rendered in the panel, in display order.
 * @type {Array<{id: string, label: string, checked: boolean}>}
 */
const TOGGLES = [
    { id: 'kmz-include-photos', label: 'Incluir fotos anexadas', checked: true },
    { id: 'kmz-simulate-dash', label: 'Simular linhas tracejadas', checked: true },
];

/**
 * Owns the KMZ export panel DOM and its interactions.
 */
export class KmzExportSection {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {HTMLElement} dependencies.container - Element to render into
     */
    constructor({ container }) {
        this._container = container;
        this._mapSelect = null;
        this._exportButton = null;
        this._exporting = false;

        setupCleanup(this);
    }

    /**
     * Builds the panel and populates the map list.
     * @returns {Promise<void>}
     */
    async render() {
        if (!this._container) return;

        this._container.textContent = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'kmz-export-container';

        wrapper.appendChild(this._createInstructions());
        wrapper.appendChild(this._createMapField());

        for (const toggle of TOGGLES) {
            wrapper.appendChild(this._createToggle(toggle));
        }

        wrapper.appendChild(this._createExportButton());

        this._container.appendChild(wrapper);

        await this._populateMapSelect();
    }

    /**
     * Creates the explanatory header text.
     * @private
     * @returns {HTMLElement} Instructions element
     */
    _createInstructions() {
        const instructions = document.createElement('p');
        instructions.className = 'kmz-export-instructions';
        instructions.textContent =
            'Exporta um mapa como KMZ vetorial para o Google Earth, preservando estilo, '
            + 'imagens e atributos. As fotos anexadas aparecem no balão de cada feição.';
        return instructions;
    }

    /**
     * Creates the labelled map picker.
     * @private
     * @returns {HTMLElement} Field wrapper
     */
    _createMapField() {
        const field = document.createElement('div');
        field.className = 'kmz-export-field';

        const label = document.createElement('label');
        label.className = 'kmz-export-label';
        label.setAttribute('for', 'kmz-map-select');
        label.textContent = 'Mapa';

        this._mapSelect = document.createElement('select');
        this._mapSelect.className = 'kmz-export-select';
        this._mapSelect.id = 'kmz-map-select';

        field.appendChild(label);
        field.appendChild(this._mapSelect);
        return field;
    }

    /**
     * Creates one checkbox option.
     * @private
     * @param {{id: string, label: string, checked: boolean}} toggle - Option definition
     * @returns {HTMLElement} Option wrapper
     */
    _createToggle({ id, label, checked }) {
        const wrapper = document.createElement('label');
        wrapper.className = 'kmz-export-toggle';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.checked = checked;

        const text = document.createElement('span');
        text.textContent = label;

        wrapper.appendChild(input);
        wrapper.appendChild(text);
        return wrapper;
    }

    /**
     * Creates the export action button.
     * @private
     * @returns {HTMLElement} Button element
     */
    _createExportButton() {
        this._exportButton = document.createElement('button');
        this._exportButton.className = 'kmz-export-btn';
        this._exportButton.textContent = 'Exportar KMZ';

        addDomListener(this, this._exportButton, 'click', () => this._handleExport());

        return this._exportButton;
    }

    /**
     * Fills the map picker, preselecting the current map.
     * @private
     * @returns {Promise<void>}
     */
    async _populateMapSelect() {
        if (!this._mapSelect) return;

        try {
            const mapNames = await getAllMapNamesStore();
            const currentMap = getCurrentMapName();

            this._mapSelect.textContent = '';

            for (const name of mapNames) {
                const option = document.createElement('option');
                option.value = name;
                // Map names are user data — never interpolate them into HTML.
                option.textContent = name;
                if (name === currentMap) option.selected = true;
                this._mapSelect.appendChild(option);
            }

            if (mapNames.length === 0) {
                this._setDisabled(true);
            }
        } catch (error) {
            console.error('KMZ export: could not load map list', error);
            showError('Não foi possível carregar a lista de mapas');
            this._setDisabled(true);
        }
    }

    /**
     * Enables or disables the panel controls.
     * @private
     * @param {boolean} disabled - Whether controls should be disabled
     */
    _setDisabled(disabled) {
        if (this._exportButton) this._exportButton.disabled = disabled;
        if (this._mapSelect) this._mapSelect.disabled = disabled;
    }

    /**
     * Reads the checked state of a toggle.
     * @private
     * @param {string} id - Checkbox element id
     * @returns {boolean} Whether the option is enabled
     */
    _isChecked(id) {
        return this._container?.querySelector(`#${id}`)?.checked !== false;
    }

    /**
     * Runs the export for the selected map.
     * @private
     * @returns {Promise<void>}
     */
    async _handleExport() {
        if (this._exporting) return;

        const mapName = this._mapSelect?.value;
        if (!mapName) {
            showError('Selecione um mapa para exportar');
            return;
        }

        this._exporting = true;
        this._setDisabled(true);

        try {
            // Loaded on demand so JSZip and the symbol generators stay out of
            // the sidebar bundle until an export is actually requested.
            const { exportMapAsKmz } = await import('@js/import_export/kmz/index.js');
            await exportMapAsKmz({
                mapName,
                options: {
                    includePhotos: this._isChecked('kmz-include-photos'),
                    simulateDash: this._isChecked('kmz-simulate-dash'),
                },
            });
        } catch (error) {
            console.error('KMZ export failed', error);
            showError('Erro ao exportar KMZ');
        } finally {
            this._exporting = false;
            this._setDisabled(false);
        }
    }

    /**
     * Releases listeners and clears the panel.
     */
    destroy() {
        cleanup(this);
        this._mapSelect = null;
        this._exportButton = null;
        if (this._container) this._container.textContent = '';
    }
}
