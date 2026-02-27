// Path: js/tool_manager/helpers/feature-header.helpers.js

/**
 * @fileoverview Feature header components for attribute panels.
 */

import { getLayers, isFeatureEffectivelyLocked, addFeature, removeFeature, updateFeature, storeImage, getGroupManager } from '../../store';
import { IDUtils } from '../../utilities';


// ── Arrow merge/split helpers ─────────────────────────────────────────────────
// These inline checks avoid a static import from military_tools (which would
// create a military-tools ↔ core circular chunk).  The actual merge/split
// operations are loaded lazily via dynamic import only when the user executes
// the action.

/** Pure property check — no heavy imports needed */
function canMergeArrows(selectedFeatures) {
    if (!selectedFeatures || selectedFeatures.length < 2) {
        return { canMerge: false, reason: 'Selecione pelo menos 2 setas' };
    }
    const allArrows = selectedFeatures.every(f => f.properties?.source === 'arrow');
    if (!allArrows) return { canMerge: false, reason: 'Todas as feições devem ser setas' };
    const layerIds = new Set(selectedFeatures.map(f => f.properties?.layerId || 'default'));
    if (layerIds.size > 1) return { canMerge: false, reason: 'Setas devem estar na mesma camada' };
    return { canMerge: true };
}

/** Pure property check — no heavy imports needed */
function canSplitArrows(selectedFeatures) {
    if (!selectedFeatures || selectedFeatures.length !== 1) return { canSplit: false };
    const f = selectedFeatures[0];
    return {
        canSplit: f.properties?.source === 'arrow' &&
            f.properties?.isMerged === true &&
            Array.isArray(f.properties?.branches) &&
            f.properties.branches.length > 1
    };
}

/**
 * Creates an editable feature name component.
 *
 * @param {string} initialName - Initial feature name
 * @param {Function} onNameChange - Callback when name changes
 * @returns {HTMLElement} Editable name container
 */
export function createEditableFeatureName(initialName, onNameChange) {
    const container = document.createElement('div');
    container.className = 'feature-name-container';

    const nameDisplay = document.createElement('div');
    nameDisplay.className = 'feature-name-editable';
    nameDisplay.textContent = initialName || 'Sem nome';
    nameDisplay.title = 'Clique para editar o nome';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'feature-name-input';
    nameInput.value = initialName || '';
    nameInput.style.cssText = 'display: none; width: 100%; font-size: 16px; font-weight: bold; padding: 6px; border: 1px solid #007bff; border-radius: 4px;';

    nameDisplay.onclick = () => {
        nameDisplay.style.display = 'none';
        nameInput.style.display = 'block';
        nameInput.focus();
        nameInput.select();
    };

    const saveEdit = () => {
        const newName = nameInput.value.trim();
        if (newName === '') {
            nameInput.value = initialName || 'Sem nome';
            return;
        }

        nameDisplay.textContent = newName;
        nameDisplay.style.display = 'block';
        nameInput.style.display = 'none';

        if (newName !== initialName) {
            onNameChange(newName);
        }
    };

    const cancelEdit = () => {
        nameInput.value = initialName || '';
        nameDisplay.style.display = 'block';
        nameInput.style.display = 'none';
    };

    nameInput.onblur = saveEdit;
    nameInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
    };

    container.appendChild(nameDisplay);
    container.appendChild(nameInput);

    return container;
}

/**
 * Creates feature header with editable name and options button.
 *
 * @param {string} initialName - Initial feature name
 * @param {Function} onNameChange - Callback when name changes
 * @param {Array} selectedFeatures - Selected features
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 * @returns {HTMLElement} Header container
 */
export function createFeatureHeaderWithOptions(
    initialName,
    onNameChange,
    selectedFeatures,
    selectionManager,
    uiManager
) {
    const container = document.createElement('div');
    container.className = 'feature-header-with-options';

    const nameWrapper = document.createElement('div');
    nameWrapper.className = 'feature-name-wrapper';

    const nameComponent = createEditableFeatureName(initialName, onNameChange);
    nameWrapper.appendChild(nameComponent);

    const optionsButton = createFeatureOptionsButton(
        selectedFeatures,
        selectionManager,
        uiManager
    );

    container.appendChild(nameWrapper);
    container.appendChild(optionsButton);

    return container;
}

/**
 * Creates feature options button (three vertical dots).
 *
 * @param {Array} selectedFeatures - Selected features
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 * @returns {HTMLElement} Options button
 */
export function createFeatureOptionsButton(selectedFeatures, selectionManager, uiManager) {
    const button = document.createElement('button');
    button.className = 'feature-options-button';
    button.title = 'Opções';

    button.innerHTML = `<img src="./images/gear_icon.svg" alt="Opções" />`;

    const shouldDisable = shouldDisableOptionsButton(selectedFeatures);
    button.disabled = shouldDisable;

    if (shouldDisable) {
        button.title = 'Disponível apenas para seleção de features do mesmo tipo';
    }

    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOpen = button.dataset.dropdownOpen === 'true';

        if (isOpen) {
            closeAllFeatureDropdowns(true);
        } else {
            closeAllFeatureDropdowns(false);
            openFeatureDropdown(button, selectedFeatures, selectionManager, uiManager);
        }
    });

    initializeFeatureDropdownListeners();

    return button;
}

/**
 * Checks if options button should be disabled.
 *
 * @param {Array} selectedFeatures - Selected features
 * @returns {boolean} True if should disable
 */
function shouldDisableOptionsButton(selectedFeatures) {
    if (selectedFeatures.length <= 1) {
        return false;
    }

    const firstType = selectedFeatures[0].properties.source;
    const allSameType = selectedFeatures.every(f =>
        f.properties.source === firstType
    );

    return !allSameType;
}

/**
 * Opens feature options dropdown.
 *
 * @param {HTMLElement} button - Button that triggered dropdown
 * @param {Array} selectedFeatures - Selected features
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function openFeatureDropdown(button, selectedFeatures, selectionManager, uiManager) {
    const dropdown = document.createElement('div');
    dropdown.className = 'feature-dropdown-content';
    dropdown.dataset.buttonId = `feature-options-${Date.now()}`;

    const selectAllButton = document.createElement('button');
    selectAllButton.className = 'feature-menu-button';
    selectAllButton.textContent = 'Selecionar todos com mesmo tipo';

    selectAllButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        await selectAllFeaturesOfSameType(selectedFeatures, selectionManager, uiManager);
        closeAllFeatureDropdowns(true);
    });

    dropdown.appendChild(selectAllButton);

    const selectAllStyleButton = document.createElement('button');
    selectAllStyleButton.className = 'feature-menu-button';
    selectAllStyleButton.textContent = 'Selecionar todos com mesmo estilo';

    selectAllStyleButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        await selectAllFeaturesOfSameStyle(selectedFeatures, selectionManager, uiManager);
        closeAllFeatureDropdowns(true);
    });

    dropdown.appendChild(selectAllStyleButton);

    const currentFeature = selectedFeatures[0];
    const currentLayerId = currentFeature?.properties?.layerId || 'default';
    const layers = await getLayers();
    const currentLayer = layers.find(l => l.id === currentLayerId);

    if (currentLayer) {
        const separator1 = document.createElement('div');
        separator1.style.cssText = 'height: 1px; background: #e0e0e0; margin: 4px 0;';
        dropdown.appendChild(separator1);

        const selectAllLayerButton = document.createElement('button');
        selectAllLayerButton.className = 'feature-menu-button';
        selectAllLayerButton.textContent = `Selecionar todos da camada "${currentLayer.name}"`;

        selectAllLayerButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await selectAllInLayer(currentLayerId, selectionManager, uiManager);
            closeAllFeatureDropdowns(true);
        });
        dropdown.appendChild(selectAllLayerButton);

        const featureType = currentFeature?.properties?.source;
        if (featureType) {
            const selectTypeInLayerButton = document.createElement('button');
            selectTypeInLayerButton.className = 'feature-menu-button';
            const typeName = getFeatureTypeName(featureType);
            selectTypeInLayerButton.textContent = `Selecionar todos "${typeName}" da camada`;

            selectTypeInLayerButton.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await selectAllOfTypeInLayer(featureType, currentLayerId, selectionManager, uiManager);
                closeAllFeatureDropdowns(true);
            });
            dropdown.appendChild(selectTypeInLayerButton);
        }
    }

    // Add conversion options for line features (single selection only)
    if (selectedFeatures.length === 1 && currentFeature?.properties?.source === 'line') {
        const separator2 = document.createElement('div');
        separator2.style.cssText = 'height: 1px; background: #e0e0e0; margin: 4px 0;';
        dropdown.appendChild(separator2);

        const convertToArrowButton = document.createElement('button');
        convertToArrowButton.className = 'feature-menu-button';
        convertToArrowButton.textContent = 'Converter para Seta';

        convertToArrowButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await convertLineToArrow(currentFeature, selectionManager, uiManager);
            closeAllFeatureDropdowns(true);
        });
        dropdown.appendChild(convertToArrowButton);

        const convertToBoundaryButton = document.createElement('button');
        convertToBoundaryButton.className = 'feature-menu-button';
        convertToBoundaryButton.textContent = 'Converter para Linha de Limite';

        convertToBoundaryButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await convertLineToBoundary(currentFeature, selectionManager, uiManager);
            closeAllFeatureDropdowns(true);
        });
        dropdown.appendChild(convertToBoundaryButton);
    }

    // Add reverse option for arrow features (single selection only)
    if (selectedFeatures.length === 1 && currentFeature?.properties?.source === 'arrow') {
        const separator3 = document.createElement('div');
        separator3.style.cssText = 'height: 1px; background: #e0e0e0; margin: 4px 0;';
        dropdown.appendChild(separator3);

        const reverseArrowButton = document.createElement('button');
        reverseArrowButton.className = 'feature-menu-button';
        reverseArrowButton.textContent = 'Inverter Seta';

        reverseArrowButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await reverseArrow(currentFeature, selectionManager, uiManager);
            closeAllFeatureDropdowns(true);
        });
        dropdown.appendChild(reverseArrowButton);
    }

    // Add merge/split options for arrow features
    const allArrows = selectedFeatures.every(f => f.properties?.source === 'arrow');
    if (allArrows) {
        const mergeCheck = canMergeArrows(selectedFeatures);
        const splitCheck = canSplitArrows(selectedFeatures);

        if (mergeCheck.canMerge || splitCheck.canSplit) {
            const separatorMerge = document.createElement('div');
            separatorMerge.style.cssText = 'height: 1px; background: #e0e0e0; margin: 4px 0;';
            dropdown.appendChild(separatorMerge);

            if (mergeCheck.canMerge) {
                const mergeButton = document.createElement('button');
                mergeButton.className = 'feature-menu-button';
                mergeButton.textContent = 'Combinar Setas';

                mergeButton.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const map = selectionManager.map;
                    const { mergeArrows } = await import('../../military_tools/arrow_tool/arrow-merge.js');
                    await mergeArrows(selectedFeatures, map, selectionManager);
                    closeAllFeatureDropdowns(true);
                    uiManager.updatePanels();
                });
                dropdown.appendChild(mergeButton);
            }

            if (splitCheck.canSplit) {
                const splitButton = document.createElement('button');
                splitButton.className = 'feature-menu-button';
                splitButton.textContent = 'Separar Setas';

                splitButton.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const map = selectionManager.map;
                    const { splitArrows } = await import('../../military_tools/arrow_tool/arrow-merge.js');
                    await splitArrows(currentFeature, map, selectionManager);
                    closeAllFeatureDropdowns(true);
                    uiManager.updatePanels();
                });
                dropdown.appendChild(splitButton);
            }
        }
    }

    // Add conversion options for point features (single selection only)
    if (selectedFeatures.length === 1 && currentFeature?.properties?.source === 'point') {
        const separatorPoint = document.createElement('div');
        separatorPoint.style.cssText = 'height: 1px; background: #e0e0e0; margin: 4px 0;';
        dropdown.appendChild(separatorPoint);

        const convertToMilSymButton = document.createElement('button');
        convertToMilSymButton.className = 'feature-menu-button';
        convertToMilSymButton.textContent = 'Converter para Símbolo Militar';

        convertToMilSymButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await convertPointToMilitarySymbol(currentFeature, selectionManager, uiManager);
            closeAllFeatureDropdowns(true);
        });
        dropdown.appendChild(convertToMilSymButton);

        const convertToCoordMeasureButton = document.createElement('button');
        convertToCoordMeasureButton.className = 'feature-menu-button';
        convertToCoordMeasureButton.textContent = 'Converter para Medida de Coordenação';

        convertToCoordMeasureButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await convertPointToCoordinationMeasure(currentFeature, selectionManager, uiManager);
            closeAllFeatureDropdowns(true);
        });
        dropdown.appendChild(convertToCoordMeasureButton);
    }

    document.body.appendChild(dropdown);

    positionFeatureDropdown(dropdown, button);

    button.classList.add('dropdown-active');
    button.dataset.dropdownOpen = 'true';
}

/**
 * Returns readable feature type name.
 *
 * @param {string} featureType - Feature type code
 * @returns {string} Readable name
 */
function getFeatureTypeName(featureType) {
    const names = {
        'point': 'Pontos',
        'line': 'Linhas',
        'polygon': 'Polígonos',
        'text': 'Textos',
        'image': 'Imagens',
        'circle': 'Círculos',
        'rectangle': 'Retângulos',
        'ellipse': 'Elipses',
        'brush': 'Pincéis',
        'arrow': 'Setas',
        'boundary': 'Limites',
        'occupied_front': 'Frentes Ocupadas',
        'military_symbol': 'Símbolos Militares',
        'coordination_measure': 'Medidas de Coordenação',
        'los': 'Linhas de Visada',
        'visibility': 'Visibilidade',
        'sector': 'Setores'
    };
    return names[featureType] || featureType;
}

/**
 * Selects all features in a layer.
 * Respects groups: only selects features from groups where ALL features are in the target layer.
 *
 * @param {string} layerId - Layer ID
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function selectAllInLayer(layerId, selectionManager, uiManager) {
    try {
        const allFeatures = [];
        const allFeaturesMap = new Map(); // Store all features for group lookup

        for (const [_featureType, control] of selectionManager.controls) {
            const sourceNames = control.getSourceNames();
            if (!sourceNames || sourceNames.length === 0) continue;

            for (const sourceName of sourceNames) {
                const source = selectionManager.map.getSource(sourceName);
                if (!source) continue;

                try {
                    const data = await source.getData();
                    if (data && data.features) {
                        // Store all features for group membership check
                        for (const f of data.features) {
                            if (f.properties?.id) {
                                allFeaturesMap.set(`${f.properties.source}:${f.properties.id}`, f);
                            }
                        }

                        const layerFeatures = data.features.filter(f => {
                            const featureLayerId = f.properties?.layerId || 'default';
                            return featureLayerId === layerId;
                        });
                        allFeatures.push(...layerFeatures);
                    }
                } catch (e) {
                    console.debug(`Error getting data from source ${sourceName}:`, e);
                }
            }
        }

        const selectableFeatures = allFeatures.filter(f => !isFeatureEffectivelyLocked(f));

        if (selectableFeatures.length === 0) {
            return;
        }

        // Filter features respecting groups
        const groupManager = getGroupManager();
        const skippedGroups = new Set(); // Groups that should NOT be selected
        const featuresToSelect = [];

        // First pass: identify groups to skip (not all features in layer)
        for (const feature of selectableFeatures) {
            const featureType = feature.properties?.source;
            const featureId = feature.properties?.id;
            if (!featureType || !featureId) continue;

            const group = groupManager.getFeatureGroup(featureType, featureId);

            if (group && !skippedGroups.has(group.id)) {
                // Check if ALL features in group are in the target layer
                const allInLayer = group.features.every(ref => {
                    const refFeature = allFeaturesMap.get(`${ref.type}:${ref.id}`);
                    const refLayerId = refFeature?.properties?.layerId || 'default';
                    return refLayerId === layerId;
                });

                if (!allInLayer) {
                    // Mark group to be skipped
                    skippedGroups.add(group.id);
                }
            }
        }

        // Second pass: select features not in skipped groups
        for (const feature of selectableFeatures) {
            const featureType = feature.properties?.source;
            const featureId = feature.properties?.id;
            if (!featureType || !featureId) continue;

            const group = groupManager.getFeatureGroup(featureType, featureId);

            if (group && skippedGroups.has(group.id)) {
                // Feature belongs to a group not fully in layer - skip
                continue;
            }

            featuresToSelect.push(feature);
        }

        selectionManager.deselectAllFeatures();

        for (const feature of featuresToSelect) {
            const featureType = feature.properties?.source;
            const featureId = feature.properties?.id;
            if (featureType && featureId) {
                if (!selectionManager.isFeatureSelected(featureType, featureId)) {
                    await selectionManager.toggleFeatureSelection(featureType, featureId, feature, false);
                }
            }
        }

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error selecting all features in layer:', error);
    }
}

/**
 * Selects all features of a type in a specific layer.
 * Respects groups: only selects features from homogeneous groups (all same type) in the target layer.
 *
 * @param {string} featureType - Feature type
 * @param {string} layerId - Layer ID
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function selectAllOfTypeInLayer(featureType, layerId, selectionManager, uiManager) {
    try {
        const control = selectionManager.controls.get(featureType);
        if (!control) {
            console.warn(`Control not found for type: ${featureType}`);
            return;
        }

        const sourceNames = control.getSourceNames();
        if (!sourceNames || sourceNames.length === 0) {
            console.warn(`Source names not found for type: ${featureType}`);
            return;
        }

        const filteredFeatures = [];

        for (const sourceName of sourceNames) {
            const source = selectionManager.map.getSource(sourceName);
            if (!source) continue;

            try {
                const data = await source.getData();
                if (data && data.features) {
                    const layerFeatures = data.features.filter(f => {
                        const featureLayerId = f.properties?.layerId || 'default';
                        return featureLayerId === layerId && !isFeatureEffectivelyLocked(f);
                    });
                    filteredFeatures.push(...layerFeatures);
                }
            } catch (e) {
                console.debug(`Error getting data from source ${sourceName}:`, e);
            }
        }

        if (filteredFeatures.length === 0) {
            return;
        }

        // Filter features respecting groups
        const groupManager = getGroupManager();
        const skippedGroups = new Set(); // Groups that should NOT be selected (heterogeneous)
        const featuresToSelect = [];

        // First pass: identify heterogeneous groups to skip
        for (const feature of filteredFeatures) {
            const featureId = feature.properties?.id;
            if (!featureId) continue;

            const group = groupManager.getFeatureGroup(featureType, featureId);

            if (group && !skippedGroups.has(group.id)) {
                // Check if all features in group are of the target type
                const allSameType = group.features.every(f => f.type === featureType);

                if (!allSameType) {
                    // Mark heterogeneous group to be skipped
                    skippedGroups.add(group.id);
                }
            }
        }

        // Second pass: select features not in skipped groups
        for (const feature of filteredFeatures) {
            const featureId = feature.properties?.id;
            if (!featureId) continue;

            const group = groupManager.getFeatureGroup(featureType, featureId);

            if (group && skippedGroups.has(group.id)) {
                // Feature belongs to a heterogeneous group - skip
                continue;
            }

            featuresToSelect.push(feature);
        }

        selectionManager.deselectAllFeatures();

        for (const feature of featuresToSelect) {
            const featureId = feature.properties?.id;
            if (featureId) {
                if (!selectionManager.isFeatureSelected(featureType, featureId)) {
                    await selectionManager.toggleFeatureSelection(featureType, featureId, feature, false);
                }
            }
        }

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error selecting features of type in layer:', error);
    }
}

/**
 * Positions dropdown near button.
 *
 * @param {HTMLElement} dropdown - Dropdown element
 * @param {HTMLElement} button - Button element
 */
function positionFeatureDropdown(dropdown, button) {
    requestAnimationFrame(() => {
        const rect = button.getBoundingClientRect();
        const dropdownRect = dropdown.getBoundingClientRect();
        const dropdownWidth = dropdownRect.width || 220;
        const dropdownHeight = dropdownRect.height || 100;

        let top = rect.bottom + 4;
        let left = rect.right - dropdownWidth;

        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };

        const padding = 10;

        if (left < padding) {
            left = rect.left;
        }
        if (left + dropdownWidth > viewport.width - padding) {
            left = Math.max(padding, viewport.width - dropdownWidth - padding);
        }

        if (top + dropdownHeight > viewport.height - padding) {
            const topAbove = rect.top - dropdownHeight - 4;
            if (topAbove >= padding) {
                top = topAbove;
            } else {
                top = Math.max(padding, Math.min(top, viewport.height - dropdownHeight - padding));
            }
        }

        dropdown.style.top = `${top}px`;
        dropdown.style.left = `${left}px`;
    });
}

/**
 * Closes all feature dropdowns.
 *
 * @param {boolean} [animated=false] - Whether to use animation
 */
function closeAllFeatureDropdowns(animated = false) {
    const dropdowns = document.querySelectorAll('.feature-dropdown-content');

    if (animated && dropdowns.length > 0) {
        dropdowns.forEach(dropdown => {
            if (dropdown.parentElement === document.body) {
                dropdown.classList.add('closing');
                setTimeout(() => {
                    if (dropdown.parentNode) {
                        dropdown.remove();
                    }
                }, 150);
            }
        });
    } else {
        dropdowns.forEach(dropdown => {
            if (dropdown.parentElement === document.body) {
                dropdown.remove();
            }
        });
    }

    const activeButtons = document.querySelectorAll('.feature-options-button.dropdown-active');
    activeButtons.forEach(button => {
        button.classList.remove('dropdown-active');
        delete button.dataset.dropdownOpen;
    });
}

/**
 * Style property keys per feature type.
 * Only visual appearance properties - excludes metadata, content, geometry, and state.
 */
const STYLE_KEYS_BY_TYPE = {
    point: ['fillColor', 'size', 'opacity'],
    line: ['lineColor', 'lineWidth', 'opacity', 'lineStyle'],
    polygon: ['fillColor', 'lineColor', 'lineWidth', 'opacity', 'lineStyle', 'hatchEnabled', 'hatchType', 'hatchColor', 'hatchSpacing', 'hatchLineWidth'],
    circle: ['fillColor', 'lineColor', 'lineWidth', 'lineStyle', 'opacity', 'hatchEnabled', 'hatchType', 'hatchColor', 'hatchSpacing', 'hatchLineWidth'],
    ellipse: ['fillColor', 'lineColor', 'lineWidth', 'lineStyle', 'opacity', 'hatchEnabled', 'hatchType', 'hatchColor', 'hatchSpacing', 'hatchLineWidth'],
    rectangle: ['fillColor', 'lineColor', 'lineWidth', 'lineStyle', 'opacity', 'borderRadius', 'hatchEnabled', 'hatchType', 'hatchColor', 'hatchSpacing', 'hatchLineWidth'],
    text: ['size', 'color', 'textHaloWidth', 'justify', 'showBackground', 'backgroundFillColor', 'backgroundFillOpacity', 'backgroundBorderColor', 'backgroundBorderOpacity', 'backgroundBorderWidth'],
    brush: ['lineColor', 'lineWidth'],
    image: ['size', 'opacity'],
    arrow: ['width', 'fillColor', 'lineColor', 'lineWidth', 'fillOpacity', 'lineOpacity', 'headLengthRatio', 'showArrowHead'],
    boundary: ['color', 'lineWidth', 'opacity', 'echelon', 'symbol_size', 'text_size'],
    occupied_front: ['color', 'lineWidth', 'opacity'],
    los: ['opacity', 'width'],
    visibility: ['opacity'],
    military_symbol: ['size', 'opacity', 'fillColor'],
    coordination_measure: ['size', 'opacity']
};

/**
 * Extracts a style fingerprint from a feature for comparison.
 *
 * @param {Object} feature - GeoJSON feature
 * @returns {string} JSON string of style values (for equality comparison)
 */
function getStyleFingerprint(feature) {
    const type = feature.properties?.source;
    const keys = STYLE_KEYS_BY_TYPE[type];
    if (!keys) return '{}';

    const style = {};
    for (const key of keys) {
        style[key] = feature.properties[key] ?? null;
    }
    return JSON.stringify(style);
}

/**
 * Selects all features of same type as current selection.
 * Respects groups: heterogeneous groups are not selected, homogeneous groups are selected entirely.
 *
 * @param {Array} selectedFeatures - Currently selected features
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function selectAllFeaturesOfSameType(selectedFeatures, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const firstFeature = selectedFeatures[0];
    const targetType = firstFeature.properties.source;

    const control = selectionManager.controls.get(targetType);
    if (!control) {
        console.warn(`Control not found for type: ${targetType}`);
        return;
    }

    const sourceNames = control.getSourceNames();
    if (!sourceNames || sourceNames.length === 0) {
        console.warn(`Source names not found for type: ${targetType}`);
        return;
    }

    const allFeaturesOfType = [];

    for (const sourceName of sourceNames) {
        const source = selectionManager.map.getSource(sourceName);
        if (source) {
            const data = await source.getData();
            if (data && data.features) {
                allFeaturesOfType.push(...data.features);
            }
        }
    }

    if (allFeaturesOfType.length === 0) {
        console.warn(`No features found for type: ${targetType}`);
        return;
    }

    // Filter features respecting groups
    const groupManager = getGroupManager();
    const skippedGroups = new Set(); // Groups that should NOT be selected (heterogeneous)
    const featuresToSelect = [];

    // First pass: identify heterogeneous groups to skip
    for (const feature of allFeaturesOfType) {
        const featureId = feature.properties?.id;
        if (!featureId) continue;

        const group = groupManager.getFeatureGroup(targetType, featureId);

        if (group && !skippedGroups.has(group.id)) {
            // Check if all features in group are of the target type
            const allSameType = group.features.every(f => f.type === targetType);

            if (!allSameType) {
                // Mark heterogeneous group to be skipped
                skippedGroups.add(group.id);
            }
        }
    }

    // Second pass: select features not in skipped groups
    for (const feature of allFeaturesOfType) {
        const featureId = feature.properties?.id;
        if (!featureId) continue;

        const group = groupManager.getFeatureGroup(targetType, featureId);

        if (group && skippedGroups.has(group.id)) {
            // Feature belongs to a heterogeneous group - skip
            continue;
        }

        // Feature is either ungrouped or in a homogeneous group - select it
        featuresToSelect.push(feature);
    }

    selectionManager.deselectAllFeatures();

    for (const feature of featuresToSelect) {
        const featureId = feature.properties.id;
        if (!selectionManager.isFeatureSelected(targetType, featureId)) {
            await selectionManager.toggleFeatureSelection(targetType, featureId, feature, false);
        }
    }

    uiManager.updateSelectionHighlight();
    uiManager.updatePanels();
}

/**
 * Selects all features that share the same type AND style as the current selection.
 * Respects groups: heterogeneous groups are skipped.
 *
 * @param {Array} selectedFeatures - Currently selected features
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function selectAllFeaturesOfSameStyle(selectedFeatures, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const firstFeature = selectedFeatures[0];
    const targetType = firstFeature.properties.source;
    const targetFingerprint = getStyleFingerprint(firstFeature);

    const control = selectionManager.controls.get(targetType);
    if (!control) {
        console.warn(`Control not found for type: ${targetType}`);
        return;
    }

    const sourceNames = control.getSourceNames();
    if (!sourceNames || sourceNames.length === 0) {
        console.warn(`Source names not found for type: ${targetType}`);
        return;
    }

    const allFeaturesOfType = [];

    for (const sourceName of sourceNames) {
        const source = selectionManager.map.getSource(sourceName);
        if (source) {
            const data = await source.getData();
            if (data && data.features) {
                allFeaturesOfType.push(...data.features);
            }
        }
    }

    if (allFeaturesOfType.length === 0) return;

    // Filter by matching style fingerprint
    const matchingFeatures = allFeaturesOfType.filter(
        f => getStyleFingerprint(f) === targetFingerprint
    );

    if (matchingFeatures.length === 0) return;

    // Filter respecting groups (same logic as selectAllFeaturesOfSameType)
    const groupManager = getGroupManager();
    const skippedGroups = new Set();
    const featuresToSelect = [];

    for (const feature of matchingFeatures) {
        const featureId = feature.properties?.id;
        if (!featureId) continue;

        const group = groupManager.getFeatureGroup(targetType, featureId);

        if (group && !skippedGroups.has(group.id)) {
            const allSameType = group.features.every(f => f.type === targetType);
            if (!allSameType) {
                skippedGroups.add(group.id);
            }
        }
    }

    for (const feature of matchingFeatures) {
        const featureId = feature.properties?.id;
        if (!featureId) continue;

        const group = groupManager.getFeatureGroup(targetType, featureId);

        if (group && skippedGroups.has(group.id)) {
            continue;
        }

        featuresToSelect.push(feature);
    }

    selectionManager.deselectAllFeatures();

    for (const feature of featuresToSelect) {
        const featureId = feature.properties.id;
        if (!selectionManager.isFeatureSelected(targetType, featureId)) {
            await selectionManager.toggleFeatureSelection(targetType, featureId, feature, false);
        }
    }

    uiManager.updateSelectionHighlight();
    uiManager.updatePanels();
}

// ===== LINE CONVERSION FUNCTIONS =====

/**
 * Converts a line feature to an arrow feature.
 *
 * @param {Object} lineFeature - Line feature to convert
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function convertLineToArrow(lineFeature, selectionManager, uiManager) {
    try {
        const map = selectionManager.map;
        const arrowControl = selectionManager.controls.get('arrow');

        if (!arrowControl) {
            console.error('Arrow control not found');
            return;
        }

        // Get base coordinates from line
        const baseCoordinates = lineFeature.geometry.coordinates;
        if (!baseCoordinates || baseCoordinates.length < 2) {
            console.error('Line does not have enough coordinates');
            return;
        }

        // Generate new ID and name for arrow
        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('arrow', map);

        // Get default arrow properties
        const AddArrowControl = arrowControl.constructor;
        const defaultProps = AddArrowControl.DEFAULT_PROPERTIES || {};

        // Calculate adaptive width based on current zoom
        const currentZoom = map.getZoom();
        const adaptiveWidth = arrowControl.calculateWidthForZoom
            ? arrowControl.calculateWidthForZoom(currentZoom)
            : 500;

        // Map line properties to arrow properties
        const arrowProperties = {
            ...defaultProps,
            layerId: lineFeature.properties.layerId,
            width: adaptiveWidth,
            fillColor: lineFeature.properties.lineColor || defaultProps.fillColor,
            lineColor: lineFeature.properties.lineColor || defaultProps.lineColor,
            fillOpacity: lineFeature.properties.opacity || defaultProps.fillOpacity,
            lineOpacity: lineFeature.properties.opacity || defaultProps.lineOpacity,
            baseCoordinates: [...baseCoordinates],
            id: featureId,
            nome: lineFeature.properties.nome || featureName,
            descricao: lineFeature.properties.descricao || '',
            visivel: lineFeature.properties.visivel !== false,
            bloqueado: lineFeature.properties.bloqueado || false
        };

        // Generate arrow geometry
        const arrowGeometry = arrowControl.geometry.generate(baseCoordinates, arrowProperties);

        const arrowFeature = {
            type: 'Feature',
            id: geoJsonId,
            properties: arrowProperties,
            geometry: arrowGeometry
        };

        // Deselect current line
        selectionManager.deselectAllFeatures();

        // Remove line from store and map source
        const lineId = lineFeature.properties.id;
        await removeFeature('lines', lineId);

        const lineData = await map.getSource('lines').getData();
        lineData.features = lineData.features.filter(f => f.properties.id !== lineId);
        map.getSource('lines').setData(lineData);

        // Add arrow to store and map source
        await addFeature('arrows', arrowFeature);

        const arrowData = await map.getSource('arrows').getData();
        arrowData.features.push(arrowFeature);
        map.getSource('arrows').setData(arrowData);

        // Select the new arrow
        await selectionManager.toggleFeatureSelection('arrow', featureId, arrowFeature);

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error converting line to arrow:', error);
    }
}

/**
 * Converts a line feature to a boundary feature.
 *
 * @param {Object} lineFeature - Line feature to convert
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function convertLineToBoundary(lineFeature, selectionManager, uiManager) {
    try {
        const map = selectionManager.map;
        const boundaryControl = selectionManager.controls.get('boundary');

        if (!boundaryControl) {
            console.error('Boundary control not found');
            return;
        }

        // Get base coordinates from line
        const baseCoordinates = lineFeature.geometry.coordinates;
        if (!baseCoordinates || baseCoordinates.length < 2) {
            console.error('Line does not have enough coordinates');
            return;
        }

        // Generate new ID and name for boundary
        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('boundary', map);

        // Get default boundary properties
        const AddBoundaryControl = boundaryControl.constructor;
        const defaultProps = AddBoundaryControl.DEFAULT_PROPERTIES || {};

        // Calculate adaptive symbol size based on current zoom
        const currentZoom = map.getZoom();
        const adaptiveSymbolSize = boundaryControl.calculateSymbolSizeForZoom
            ? boundaryControl.calculateSymbolSizeForZoom(currentZoom)
            : 1;

        // Map line properties to boundary properties
        const boundaryProperties = {
            ...defaultProps,
            layerId: lineFeature.properties.layerId,
            color: lineFeature.properties.lineColor || defaultProps.color,
            lineWidth: lineFeature.properties.lineWidth || defaultProps.lineWidth,
            opacity: lineFeature.properties.opacity || defaultProps.opacity,
            symbol_size: adaptiveSymbolSize,
            baseCoordinates: [...baseCoordinates],
            id: featureId,
            nome: lineFeature.properties.nome || featureName,
            descricao: lineFeature.properties.descricao || '',
            visivel: lineFeature.properties.visivel !== false,
            bloqueado: lineFeature.properties.bloqueado || false
        };

        // Generate boundary geometry
        const boundaryGeometry = boundaryControl.geometry.generate(boundaryProperties);

        const boundaryFeature = {
            type: 'Feature',
            id: geoJsonId,
            properties: boundaryProperties,
            geometry: boundaryGeometry
        };

        // Deselect current line
        selectionManager.deselectAllFeatures();

        // Remove line from store and map source
        const lineId = lineFeature.properties.id;
        await removeFeature('lines', lineId);

        const lineData = await map.getSource('lines').getData();
        lineData.features = lineData.features.filter(f => f.properties.id !== lineId);
        map.getSource('lines').setData(lineData);

        // Add boundary to store and map source
        await addFeature('boundarys', boundaryFeature);

        const boundaryData = await map.getSource('boundarys').getData();
        boundaryData.features.push(boundaryFeature);
        map.getSource('boundarys').setData(boundaryData);

        // Update dependent features (circles and texts)
        await boundaryControl.updateDependentFeatures(boundaryFeature);

        // Select the new boundary
        await selectionManager.toggleFeatureSelection('boundary', featureId, boundaryFeature);

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error converting line to boundary:', error);
    }
}

/**
 * Reverses an arrow feature by inverting its base coordinates.
 *
 * @param {Object} arrowFeature - Arrow feature to reverse
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function reverseArrow(arrowFeature, selectionManager, uiManager) {
    try {
        const map = selectionManager.map;
        const arrowControl = selectionManager.controls.get('arrow');

        if (!arrowControl) {
            console.error('Arrow control not found');
            return;
        }

        // Get base coordinates and reverse them
        let baseCoordinates = arrowFeature.properties.baseCoordinates;
        if (typeof baseCoordinates === 'string') {
            baseCoordinates = JSON.parse(baseCoordinates);
        }

        if (!baseCoordinates || baseCoordinates.length < 2) {
            console.error('Arrow does not have enough coordinates');
            return;
        }

        // Reverse the coordinates array
        const reversedCoordinates = [...baseCoordinates].reverse();

        // Update properties with reversed coordinates
        const updatedProperties = {
            ...arrowFeature.properties,
            baseCoordinates: reversedCoordinates
        };

        // Generate new geometry with reversed coordinates
        const newGeometry = arrowControl.geometry.generate(reversedCoordinates, updatedProperties);

        const updatedFeature = {
            ...arrowFeature,
            properties: updatedProperties,
            geometry: newGeometry
        };

        // Update in map source
        const arrowData = await map.getSource('arrows').getData();
        const featureIndex = arrowData.features.findIndex(
            f => f.properties.id === arrowFeature.properties.id
        );

        if (featureIndex !== -1) {
            arrowData.features[featureIndex] = updatedFeature;
            map.getSource('arrows').setData(arrowData);
        }

        // Update in store
        await updateFeature('arrows', updatedFeature);

        // Update selection manager
        selectionManager.updateSelectedFeature('arrow', updatedFeature.properties.id, updatedFeature);

        // Update edit handles if arrow is selected
        if (arrowControl.createEditHandles) {
            arrowControl.createEditHandles(updatedFeature);
        }

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error reversing arrow:', error);
    }
}

// ===== POINT CONVERSION FUNCTIONS =====

/**
 * Converts a point feature to a military symbol feature.
 * Creates a default MIL-STD-2525D symbol at the same position.
 *
 * @param {Object} pointFeature - Point feature to convert
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function convertPointToMilitarySymbol(pointFeature, selectionManager, uiManager) {
    try {
        const map = selectionManager.map;
        const milSymControl = selectionManager.controls.get('military_symbol');

        if (!milSymControl) {
            console.error('Military symbol control not found');
            return;
        }

        const coordinates = pointFeature.geometry.coordinates;
        if (!coordinates) {
            console.error('Point does not have coordinates');
            return;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('military_symbol', map);

        const currentZoom = map.getZoom();
        const DefaultProps = milSymControl.constructor.DEFAULT_PROPERTIES;

        // Build initial SIDC from default properties
        const sidc30 = milSymControl.symbolGenerator.buildSIDC(DefaultProps);

        // Calculate initial selection box
        const selectionBox = milSymControl.geometry.calculateSelectionBoxGeometry(
            coordinates,
            DefaultProps.width,
            DefaultProps.height,
            DefaultProps.size,
            DefaultProps.rotation,
            currentZoom,
            uiManager
        );

        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...DefaultProps,
                layerId: pointFeature.properties.layerId || 'default',
                id: featureId,
                nome: pointFeature.properties.nome || featureName,
                descricao: pointFeature.properties.descricao || '',
                visivel: pointFeature.properties.visivel !== false,
                bloqueado: pointFeature.properties.bloqueado || false,
                opacity: pointFeature.properties.opacity ?? DefaultProps.opacity,
                sidc: sidc30,
                createdAtZoom: currentZoom,
                calculatedSize: DefaultProps.size,
                selectionBox: selectionBox
            },
            geometry: {
                type: 'Point',
                coordinates: [coordinates[0], coordinates[1]]
            }
        };

        // Generate symbol image and capture real dimensions
        const result = await milSymControl.symbolGenerator.generateSymbolBlob(feature.properties);

        feature.properties.width = result.width;
        feature.properties.height = result.height;

        // Recalculate selection box with real dimensions
        feature.properties.selectionBox = milSymControl.geometry.calculateSelectionBoxGeometry(
            coordinates,
            result.width,
            result.height,
            feature.properties.size,
            feature.properties.rotation,
            currentZoom,
            uiManager
        );

        await storeImage(featureId, result.blob);

        // Deselect and remove point
        selectionManager.deselectAllFeatures();

        const pointId = pointFeature.properties.id;
        await removeFeature('points', pointId);

        const pointData = await map.getSource('points').getData();
        pointData.features = pointData.features.filter(f => f.properties.id !== pointId);
        map.getSource('points').setData(pointData);

        // Add military symbol
        await addFeature('military_symbols', feature);

        const milSymData = await map.getSource('military_symbols').getData();
        milSymData.features.push(feature);
        map.getSource('military_symbols').setData(milSymData);

        await milSymControl.loadSymbolToMap(featureId, result.blob);

        // Select the new feature
        await selectionManager.toggleFeatureSelection('military_symbol', featureId, feature);

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error converting point to military symbol:', error);
    }
}

/**
 * Converts a point feature to a coordination measure feature.
 * Creates a default coordination measure (generic point) at the same position.
 *
 * @param {Object} pointFeature - Point feature to convert
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function convertPointToCoordinationMeasure(pointFeature, selectionManager, uiManager) {
    try {
        const map = selectionManager.map;
        const coordControl = selectionManager.controls.get('coordination_measure');

        if (!coordControl) {
            console.error('Coordination measure control not found');
            return;
        }

        const coordinates = pointFeature.geometry.coordinates;
        if (!coordinates) {
            console.error('Point does not have coordinates');
            return;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('coordination_measure', map);

        const currentZoom = map.getZoom();
        const DefaultProps = coordControl.constructor.DEFAULT_PROPERTIES;
        const pointCode = DefaultProps.pointCode;

        // Calculate initial selection box
        const selectionBox = coordControl.geometry.calculateSelectionBoxGeometry(
            coordinates,
            DefaultProps.width,
            DefaultProps.height,
            DefaultProps.size,
            DefaultProps.rotation,
            currentZoom,
            uiManager,
            'center'
        );

        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...DefaultProps,
                layerId: pointFeature.properties.layerId || 'default',
                id: featureId,
                nome: pointFeature.properties.nome || featureName,
                descricao: pointFeature.properties.descricao || '',
                visivel: pointFeature.properties.visivel !== false,
                bloqueado: pointFeature.properties.bloqueado || false,
                opacity: pointFeature.properties.opacity ?? DefaultProps.opacity,
                pointCode: pointCode,
                createdAtZoom: currentZoom,
                calculatedSize: DefaultProps.size,
                selectionBox: selectionBox
            },
            geometry: {
                type: 'Point',
                coordinates: [coordinates[0], coordinates[1]]
            }
        };

        // Generate symbol image
        const result = await coordControl.symbolGenerator.generate(pointCode, feature.properties);

        feature.properties.imageUrl = result.dataUrl;
        feature.properties.width = result.width;
        feature.properties.height = result.height;
        feature.properties.anchor = result.anchor;

        // Recalculate selection box with real dimensions and anchor
        feature.properties.selectionBox = coordControl.geometry.calculateSelectionBoxGeometry(
            coordinates,
            result.width,
            result.height,
            feature.properties.size,
            feature.properties.rotation,
            currentZoom,
            uiManager,
            result.anchor
        );

        await storeImage(featureId, result.blob);

        // Deselect and remove point
        selectionManager.deselectAllFeatures();

        const pointId = pointFeature.properties.id;
        await removeFeature('points', pointId);

        const pointData = await map.getSource('points').getData();
        pointData.features = pointData.features.filter(f => f.properties.id !== pointId);
        map.getSource('points').setData(pointData);

        // Add coordination measure
        await addFeature('coordination_measures', feature);

        const coordData = await map.getSource('coordination_measures').getData();
        coordData.features.push(feature);
        map.getSource('coordination_measures').setData(coordData);

        await coordControl.loadSymbolToMap(featureId, result.blob);

        // Select the new feature
        await selectionManager.toggleFeatureSelection('coordination_measure', featureId, feature);

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error converting point to coordination measure:', error);
    }
}

// Global listeners state
let featureDropdownListenersInitialized = false;
let dropdownClickHandler = null;
let dropdownKeydownHandler = null;
let dropdownScrollHandler = null;
let dropdownResizeHandler = null;

/**
 * Initializes global event listeners for feature dropdowns.
 */
function initializeFeatureDropdownListeners() {
    if (featureDropdownListenersInitialized) return;

    dropdownClickHandler = (e) => {
        if (!e.target.closest('.feature-dropdown-content') &&
            !e.target.closest('.feature-options-button')) {
            closeAllFeatureDropdowns(false);
        }
    };

    dropdownKeydownHandler = (e) => {
        if (e.key === 'Escape') {
            closeAllFeatureDropdowns(true);
        }
    };

    dropdownScrollHandler = () => {
        closeAllFeatureDropdowns(false);
    };

    dropdownResizeHandler = () => {
        closeAllFeatureDropdowns(false);
    };

    document.addEventListener('click', dropdownClickHandler);
    document.addEventListener('keydown', dropdownKeydownHandler);
    document.addEventListener('scroll', dropdownScrollHandler, true);
    window.addEventListener('resize', dropdownResizeHandler);

    featureDropdownListenersInitialized = true;
}

/**
 * Removes global event listeners to prevent memory leaks.
 */
export function cleanupFeatureDropdownListeners() {
    if (!featureDropdownListenersInitialized) return;

    if (dropdownClickHandler) {
        document.removeEventListener('click', dropdownClickHandler);
    }
    if (dropdownKeydownHandler) {
        document.removeEventListener('keydown', dropdownKeydownHandler);
    }
    if (dropdownScrollHandler) {
        document.removeEventListener('scroll', dropdownScrollHandler, true);
    }
    if (dropdownResizeHandler) {
        window.removeEventListener('resize', dropdownResizeHandler);
    }

    closeAllFeatureDropdowns(false);

    dropdownClickHandler = null;
    dropdownKeydownHandler = null;
    dropdownScrollHandler = null;
    dropdownResizeHandler = null;
    featureDropdownListenersInitialized = false;
}
