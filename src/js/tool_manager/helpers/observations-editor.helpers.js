// Path: js/tool_manager/helpers/observations-editor.helpers.js

/**
 * @fileoverview Scrollable editor for per-segment observations.
 * Each row maps to a segment (vertex i → vertex i+1).
 */

import { createSectionDivider } from './section-divider.helpers.js';
import { showToast } from '@utils';

/**
 * Create a per-segment observations editor.
 * @param {Object} options
 * @param {Object} options.feature - Primary selected feature
 * @param {Array} options.selectedFeatures - All selected features
 * @param {Object} options.control - Tool control instance
 * @returns {HTMLElement} Editor container element
 */
export function createObservationsEditor({ feature, selectedFeatures, control }) {
    const coords = feature.properties.baseCoordinates || [];
    const observations = feature.properties.observations || [];
    const isPolygon = feature.properties.source === 'polygon';
    const segmentCount = isPolygon ? coords.length : Math.max(0, coords.length - 1);

    const container = document.createElement('div');
    container.className = 'obs-editor';

    if (segmentCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'obs-editor__empty';
        empty.textContent = 'Nenhum segmento disponível';
        container.appendChild(empty);
        return container;
    }

    const list = document.createElement('div');
    list.className = 'obs-editor__list';

    // Keep direct references to inputs for efficient collection
    const inputRefs = [];

    for (let i = 0; i < segmentCount; i++) {
        const row = document.createElement('div');
        row.className = 'obs-editor__row';

        const badge = document.createElement('span');
        badge.className = 'obs-editor__badge';
        badge.textContent = `${i + 1}`;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'obs-editor__input';
        input.placeholder = `Perna ${i + 1}`;
        input.value = observations[i] || '';
        inputRefs.push(input);

        input.addEventListener('input', () => {
            const updated = inputRefs.map(inp => inp.value || '');
            control.updateFeaturesProperty(selectedFeatures, 'observations', updated);
        });

        row.appendChild(badge);
        row.appendChild(input);
        list.appendChild(row);
    }

    container.appendChild(list);
    return container;
}

/**
 * Create a full observations section with divider, editor, and QAN export button.
 * Consolidates the duplicated pattern from line and polygon panels.
 * @param {Object} options
 * @param {Object} options.feature - Primary selected feature
 * @param {Array} options.selectedFeatures - All selected features
 * @param {Object} options.control - Tool control instance
 * @returns {DocumentFragment} Fragment with divider, editor, and export button
 */
export function createObservationsSection({ feature, selectedFeatures, control }) {
    const fragment = document.createDocumentFragment();

    fragment.appendChild(createSectionDivider('Observações por Perna'));
    fragment.appendChild(createObservationsEditor({ feature, selectedFeatures, control }));

    // QAN export button (lazy import for code splitting)
    const qanWrapper = document.createElement('div');
    qanWrapper.className = 'obs-editor__export';
    const qanBtn = document.createElement('button');
    qanBtn.type = 'button';
    qanBtn.className = 'attr-modern-btn attr-modern-btn-secondary';
    qanBtn.textContent = 'Exportar QAN';
    qanBtn.addEventListener('click', async () => {
        try {
            const { generateQAN, downloadQANAsHTML } = await import('../../import_export/qan/index.js');
            const qanData = await generateQAN(feature);
            downloadQANAsHTML(qanData, feature.properties.nome);
        } catch (error) {
            console.error('Error exporting QAN:', error);
            showToast('Erro ao exportar QAN', 'error');
        }
    });
    qanWrapper.appendChild(qanBtn);
    fragment.appendChild(qanWrapper);

    return fragment;
}
