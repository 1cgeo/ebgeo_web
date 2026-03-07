// Path: js/military_tools/military_symbol_tool/attributes/engagement-bar.section.js

/**
 * @fileoverview Engagement bar section for the military symbol modal.
 * Allows configuration of engagement stages and weapons.
 */

import { getEngagementBarData } from '../military_constants.js';

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
        const stage = stageField.select.value;
        const weapon = weaponField.select.value;
        const remote = remoteCheckbox.checked;

        if (!stage && !weapon) {
            tempProperties.engagementBar = null;
        } else {
            const prefix = remote ? 'R:' : '';
            let text = '';

            if (stage && weapon) {
                text = `${stage}-${weapon}`;
            } else {
                text = stage || weapon;
            }

            tempProperties.engagementBar = `${prefix}${text}`;
        }

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
        const engagementBar = properties.engagementBar;
        if (!engagementBar) {
            stageField.select.value = '';
            weaponField.select.value = '';
            remoteCheckbox.checked = false;
            return;
        }

        let processedBar = engagementBar;
        let isRemote = false;

        if (processedBar.startsWith('R:')) {
            isRemote = true;
            processedBar = processedBar.substring(2);
        }

        if (processedBar.includes('-')) {
            const parts = processedBar.split('-');
            stageField.select.value = parts[0] || '';
            weaponField.select.value = parts[1] || '';
        } else {
            const stageExists = data.stages.some(s => s.value === processedBar);
            if (stageExists) {
                stageField.select.value = processedBar;
                weaponField.select.value = '';
            } else {
                stageField.select.value = '';
                weaponField.select.value = processedBar;
            }
        }
        remoteCheckbox.checked = isRemote;
    };

    return container;
}
