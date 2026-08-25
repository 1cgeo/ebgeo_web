// Path: js/military_tools/military_symbol_tool/attributes/engagement-bar.section.js

/**
 * @fileoverview Engagement bar section for the military symbol modal.
 * Allows configuration of engagement stages and weapons.
 *
 * THE FORMAT LIVES IN `engagement-bar-codec.js`, NOT HERE. Until 2026-08-25 the encode was a
 * closure on a `change` listener and the decode hung off the returned element, so the two halves
 * of one format were written apart, read apart, and reachable only through a browser. They must be
 * inverses and nothing checked that. This file is now DOM only.
 */

import { getEngagementBarData } from '../military_constants.js';
import { encodeEngagementBar, decodeEngagementBar } from './engagement-bar-codec.js';

/**
 * Populates a select element with options from data array.
 *
 * @param {HTMLSelectElement} select - Select element
 * @param {Array<{value: string, label: string}>} items - Option items
 */
function populateSelect(select, items) {
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Não Aplicável';
    select.appendChild(defaultOption);

    for (const item of items) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = `${item.value} - ${item.label}`;
        select.appendChild(option);
    }
}

/**
 * Creates a labeled select field.
 *
 * @param {string} labelText - Label text
 * @param {Array<{value: string, label: string}>} items - Option items
 * @returns {{ container: HTMLElement, select: HTMLSelectElement }}
 */
function createSelectField(labelText, items) {
    const container = document.createElement('div');
    container.className = 'engagement-bar__field';

    const label = document.createElement('label');
    label.className = 'engagement-bar__label';
    label.textContent = labelText;

    const select = document.createElement('select');
    select.className = 'engagement-bar__select';
    populateSelect(select, items);

    container.appendChild(label);
    container.appendChild(select);

    return { container, select };
}

/**
 * Creates the engagement bar content section.
 *
 * @param {Object} tempProperties - Temporary properties object
 * @param {Function} onUpdate - Callback when any field changes
 * @returns {HTMLElement & { updateFromProperties: Function }} Container with engagement bar controls
 */
export function createEngagementBarContent(tempProperties, onUpdate) {
    const container = document.createElement('div');
    container.className = 'engagement-bar';

    const data = getEngagementBarData();

    const stageField = createSelectField('Estágio do Engajamento:', data.stages);
    const weaponField = createSelectField('Armamento/Elemento:', data.weapons);

    const remoteContainer = document.createElement('div');
    remoteContainer.className = 'engagement-bar__checkbox-row';

    const remoteCheckbox = document.createElement('input');
    remoteCheckbox.type = 'checkbox';
    remoteCheckbox.id = 'engagement-remote';
    remoteCheckbox.className = 'engagement-bar__checkbox';

    const remoteLabel = document.createElement('label');
    remoteLabel.htmlFor = 'engagement-remote';
    remoteLabel.className = 'engagement-bar__checkbox-label';
    remoteLabel.textContent = 'Designação Remota';

    remoteContainer.appendChild(remoteCheckbox);
    remoteContainer.appendChild(remoteLabel);

    /**
     * Updates engagement bar property from controls.
     */
    function updateEngagementBar() {
        tempProperties.engagementBar = encodeEngagementBar({
            stage: stageField.select.value,
            weapon: weaponField.select.value,
            remote: remoteCheckbox.checked,
        });

        onUpdate();
    }

    stageField.select.addEventListener('change', updateEngagementBar);
    weaponField.select.addEventListener('change', updateEngagementBar);
    remoteCheckbox.addEventListener('change', updateEngagementBar);

    container.appendChild(stageField.container);
    container.appendChild(weaponField.container);
    container.appendChild(remoteContainer);

    /**
     * Updates controls from properties.
     * @param {Object} properties - Properties object
     */
    container.updateFromProperties = (properties) => {
        // The catalogue is what resolves a LONE value: it has no shape that tells a stage from a
        // weapon, so the codec asks this predicate instead of importing the table, which is what
        // keeps it a leaf.
        const { stage, weapon, remote } = decodeEngagementBar(properties?.engagementBar, {
            isStage: (candidato) => data.stages.some((s) => s.value === candidato),
        });

        stageField.select.value = stage;
        weaponField.select.value = weapon;
        remoteCheckbox.checked = remote;
    };

    return container;
}
