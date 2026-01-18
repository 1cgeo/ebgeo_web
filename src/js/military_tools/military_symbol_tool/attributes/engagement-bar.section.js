// Path: js/military_tools/military_symbol_tool/attributes/engagement-bar.section.js

/**
 * @fileoverview Engagement bar section for the military symbol modal.
 * Allows configuration of engagement stages and weapons.
 */

import { getEngagementBarData } from '../military_constants.js';

/**
 * @typedef {Object} EngagementBarContainer
 * @property {Function} updateFromProperties - Updates controls from properties
 */

/**
 * Creates the engagement bar content section.
 *
 * @param {Object} tempProperties - Temporary properties object
 * @param {Function} onUpdate - Callback when any field changes
 * @returns {HTMLElement & EngagementBarContainer} Container with engagement bar controls
 */
export function createEngagementBarContent(tempProperties, onUpdate) {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-direction: column; gap: 20px; max-width: 600px;';

    const data = getEngagementBarData();

    const stageContainer = document.createElement('div');
    stageContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

    const stageLabel = document.createElement('label');
    stageLabel.textContent = 'Estagio do Engajamento:';
    stageLabel.style.cssText = 'font-weight: bold; font-size: 15px; color: #333;';

    const stageSelect = document.createElement('select');
    stageSelect.style.cssText = 'padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;';

    const stageDefaultOption = document.createElement('option');
    stageDefaultOption.value = '';
    stageDefaultOption.textContent = 'Nao Aplicavel';
    stageSelect.appendChild(stageDefaultOption);

    data.stages.forEach(stage => {
        const option = document.createElement('option');
        option.value = stage.value;
        option.textContent = `${stage.value} - ${stage.label}`;
        stageSelect.appendChild(option);
    });

    stageContainer.appendChild(stageLabel);
    stageContainer.appendChild(stageSelect);

    const weaponContainer = document.createElement('div');
    weaponContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

    const weaponLabel = document.createElement('label');
    weaponLabel.textContent = 'Armamento/Elemento:';
    weaponLabel.style.cssText = 'font-weight: bold; font-size: 15px; color: #333;';

    const weaponSelect = document.createElement('select');
    weaponSelect.style.cssText = 'padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;';

    const weaponDefaultOption = document.createElement('option');
    weaponDefaultOption.value = '';
    weaponDefaultOption.textContent = 'Nao Aplicavel';
    weaponSelect.appendChild(weaponDefaultOption);

    data.weapons.forEach(weapon => {
        const option = document.createElement('option');
        option.value = weapon.value;
        option.textContent = `${weapon.value} - ${weapon.label}`;
        weaponSelect.appendChild(option);
    });

    weaponContainer.appendChild(weaponLabel);
    weaponContainer.appendChild(weaponSelect);

    const remoteContainer = document.createElement('div');
    remoteContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const remoteCheckbox = document.createElement('input');
    remoteCheckbox.type = 'checkbox';
    remoteCheckbox.id = 'engagement-remote';
    remoteCheckbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';

    const remoteLabel = document.createElement('label');
    remoteLabel.htmlFor = 'engagement-remote';
    remoteLabel.textContent = 'Designacao Remota';
    remoteLabel.style.cssText = 'font-size: 14px; color: #333; cursor: pointer;';

    remoteContainer.appendChild(remoteCheckbox);
    remoteContainer.appendChild(remoteLabel);

    /**
     * Updates engagement bar property from controls.
     */
    function updateEngagementBar() {
        const stage = stageSelect.value;
        const weapon = weaponSelect.value;
        const remote = remoteCheckbox.checked;

        if (!stage && !weapon) {
            tempProperties.engagementBar = null;
        } else {
            const prefix = remote ? 'R:' : '';
            let text = '';

            if (stage && weapon) {
                text = `${stage}-${weapon}`;
            } else if (stage) {
                text = stage;
            } else {
                text = weapon;
            }

            tempProperties.engagementBar = `${prefix}${text}`;
        }

        onUpdate();
    }

    stageSelect.addEventListener('change', updateEngagementBar);
    weaponSelect.addEventListener('change', updateEngagementBar);
    remoteCheckbox.addEventListener('change', updateEngagementBar);

    container.appendChild(stageContainer);
    container.appendChild(weaponContainer);
    container.appendChild(remoteContainer);

    /**
     * Updates controls from properties.
     * @param {Object} properties - Properties object
     */
    container.updateFromProperties = (properties) => {
        const engagementBar = properties.engagementBar;
        if (engagementBar) {
            let processedBar = engagementBar;
            let isRemote = false;

            if (processedBar.startsWith('R:')) {
                isRemote = true;
                processedBar = processedBar.substring(2);
            }

            if (processedBar.includes('-')) {
                const parts = processedBar.split('-');
                stageSelect.value = parts[0] || '';
                weaponSelect.value = parts[1] || '';
            } else {
                const stageExists = data.stages.some(s => s.value === processedBar);
                if (stageExists) {
                    stageSelect.value = processedBar;
                    weaponSelect.value = '';
                } else {
                    stageSelect.value = '';
                    weaponSelect.value = processedBar;
                }
            }
            remoteCheckbox.checked = isRemote;
        } else {
            stageSelect.value = '';
            weaponSelect.value = '';
            remoteCheckbox.checked = false;
        }
    };

    return container;
}
