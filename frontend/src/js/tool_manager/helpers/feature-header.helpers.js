// Path: js/tool_manager/helpers/feature-header.helpers.js

/**
 * @fileoverview Feature header components for attribute panels.
 *
 * SOURCE WRITES. The conversions below are the cross-source case of the diff dispatcher
 * (`layers/geojson-dispatcher.js`): every one of them ADDS a feature to one source and REMOVES
 * one from another, which is exactly the shape a `{ add }` / `{ remove }` diff carries. They used
 * to read both collections back, mutate them and write both whole, so converting one point in a
 * map holding thousands paid twice the whole-collection cost for a two-feature change.
 *
 * This file does NOT own any source: it borrows the dispatcher each drawing tool owns, through the
 * shared per-map registry, so it must never `destroy()` one. It also never writes a source with a
 * raw `setData`, because that would replace MapLibre's pending-update slot and drop whatever diff
 * the owning tool had queued, with no error at all.
 *
 * AS CONVERSÕES LINEARES NÃO MORAM MAIS AQUI. Linha, seta e limite compartilham um eixo e se
 * convertem nos SEIS sentidos, decididos por `linear-conversion.model.js` (puro, node-testável)
 * e executados por `linear-conversion.helpers.js`. As duas que ficavam neste arquivo saíam de
 * linha e mais nada, não consultavam permissão nenhuma e deixavam artefato órfão na tela; o
 * porquê de cada passo está no cabeçalho daqueles dois. As conversões de PONTO continuam aqui,
 * e continuam sem gate: elas ficaram fora daquela mudança, e é dívida declarada, não simetria.
 */

import { getLayers, isCurrentMapLockedSync, isFeatureEffectivelyLocked, addFeature, removeFeature, removeImage, updateFeature, storeImage, getGroupManager, getControl, startBatchUndo, commitBatchUndo } from '../../store';
import { IDUtils, showWarning } from '../../utilities';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { checkPermission } from '@store/sync/permission-guard.js';
import {
    LINEAR_CONVERSION_LABELS,
    isMergedArrow,
    linearConversionActions,
} from './linear-conversion.model.js';
import { convertLinearFeature } from './linear-conversion.helpers.js';

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
    // `??`, NUNCA `||`: um `layerId` de `0` ou `''` e valor de dominio, e o `||` o trocava por
    // 'default', fazendo setas de CAMADAS DIFERENTES passarem pelo portao de mesma-camada. O gemeo
    // desta linha vive em `military_tools/arrow_tool/arrow-merge.js` e foi consertado em
    // 2026-08-24; esta copia existe para nao criar ciclo de chunk entre core e military-tools, e
    // por isso mesmo ela nao herda conserto nenhum: quem mexer num lado mexe nos dois.
    const layerIds = new Set(selectedFeatures.map(f => f.properties?.layerId ?? 'default'));
    if (layerIds.size > 1) return { canMerge: false, reason: 'Setas devem estar na mesma camada' };
    return { canMerge: true };
}

/**
 * Pure property check.
 *
 * O predicado da seta COMBINADA vive em `linear-conversion.model.js` e é lido daqui em vez de
 * reescrito: ele tinha TRÊS moradas (esta, a geometria da seta e a decisão de conversão), e
 * três cópias de um predicado de três condições é uma a mais do que qualquer revisão pega. O
 * modelo é um módulo folha de `tool_manager/helpers/`, portanto core como este arquivo, e não
 * traz de volta a aresta para `military_tools`.
 * @param {Array} selectedFeatures - Currently selected features
 * @returns {{canSplit: boolean}} Whether the split command applies
 */
function canSplitArrows(selectedFeatures) {
    if (!selectedFeatures || selectedFeatures.length !== 1) return { canSplit: false };
    const f = selectedFeatures[0];
    return { canSplit: f.properties?.source === 'arrow' && isMergedArrow(f.properties) };
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
        separator1.className = 'feature-menu-separator';
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

    // Conversão entre os três tipos LINEARES (seleção única). A decisão de QUAIS comandos
    // aparecem, e de quais deles o clique tem de recusar, é `linearConversionActions`
    // (`linear-conversion.model.js`): aqui só se desenha o que ela devolveu.
    if (selectedFeatures.length === 1) {
        const conversions = linearConversionActions({
            source: currentFeature?.properties?.source,
            can: (key) => checkPermission(key).allowed,
            mapLocked: isCurrentMapLockedSync(),
            featureLocked: isFeatureEffectivelyLocked(currentFeature),
            feature: currentFeature,
        });

        if (conversions.length > 0) {
            const separator2 = document.createElement('div');
            separator2.className = 'feature-menu-separator';
            dropdown.appendChild(separator2);

            for (const { target, blocked } of conversions) {
                const convertButton = document.createElement('button');
                convertButton.className = blocked
                    ? 'feature-menu-button feature-menu-button--blocked'
                    : 'feature-menu-button';
                convertButton.textContent = LINEAR_CONVERSION_LABELS[target];

                // `aria-disabled`, NUNCA a propriedade `disabled`: um botão desabilitado não
                // dispara clique, e o clique É como o motivo chega à pessoa. O `title` leva a
                // mesma frase para quem só passa o ponteiro por cima.
                if (blocked) {
                    convertButton.setAttribute('aria-disabled', 'true');
                    convertButton.title = blocked;
                }

                convertButton.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeAllFeatureDropdowns(true);
                    if (blocked) {
                        showWarning(blocked);
                        return;
                    }
                    await convertLinearFeature(currentFeature, target, selectionManager, uiManager);
                });
                dropdown.appendChild(convertButton);
            }
        }
    }

    // OS TIPOS LINEARES QUE SE CORTAM EM DUAS, cada um com o rótulo do menu e o módulo que
    // guarda o modo de clique temporário. O carregamento é tardio pelo mesmo motivo das
    // operações de seta: aresta estática daqui para um chunk de ferramenta recria o ciclo
    // core <-> ferramenta. Continua não sendo conversão, é divisão, e a seta segue de fora,
    // porque o "Separar Setas" dela é o inverso da combinação.
    //
    // A TABELA MORA AQUI DENTRO, e não no topo do arquivo, porque o rótulo da linha é a ÂNCORA
    // de fim do recorte de `tests/unit/conversao-linear-menu-fiacao.test.js`: aquele guarda
    // recorta o bloco de conversão da chamada a `linearConversionActions` até o comando
    // seguinte, e uma tabela no topo levaria a âncora para ANTES do bloco, deixando o recorte
    // vazio e todas as asserções de ausência vacuamente verdes.
    const SPLITTABLE_LINEAR_SOURCES = {
        line: {
            label: 'Cortar Linha',
            load: () => import('../../draw_tools/line_tool/line-split.js')
                .then(module => module.activateSplitMode),
        },
        boundary: {
            label: 'Cortar Linha de Limite',
            load: () => import('../../military_tools/boundary_tool/boundary-split.js')
                .then(module => module.activateBoundarySplitMode),
        },
    };

    const splitSpec = selectedFeatures.length === 1
        ? SPLITTABLE_LINEAR_SOURCES[currentFeature?.properties?.source]
        : null;
    if (splitSpec) {
        const splitButton = document.createElement('button');
        splitButton.className = 'feature-menu-button';
        splitButton.textContent = splitSpec.label;

        splitButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAllFeatureDropdowns(true);
            const activate = await splitSpec.load();
            await activate(currentFeature, selectionManager.map, selectionManager);
        });
        dropdown.appendChild(splitButton);
    }

    // Add reverse option for arrow features (single selection only)
    if (selectedFeatures.length === 1 && currentFeature?.properties?.source === 'arrow') {
        const separator3 = document.createElement('div');
        separator3.className = 'feature-menu-separator';
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

    // Reversing a coordination line is not cosmetic: the glyphs that sit on ONE side of the
    // line (the obstacle peak, the concertina loop) are placed from the local bearing, so
    // flipping the spine flips which side they face. That is the doctrinal question of which
    // way an obstacle points.
    if (selectedFeatures.length === 1 && currentFeature?.properties?.source === 'coordination_line') {
        const separatorFlip = document.createElement('div');
        separatorFlip.className = 'feature-menu-separator';
        dropdown.appendChild(separatorFlip);

        const reverseLineButton = document.createElement('button');
        reverseLineButton.className = 'feature-menu-button';
        reverseLineButton.textContent = 'Inverter Linha';

        reverseLineButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await reverseCoordinationLine(currentFeature, selectionManager, uiManager);
            closeAllFeatureDropdowns(true);
        });
        dropdown.appendChild(reverseLineButton);
    }

    // Add merge/split options for arrow features
    const allArrows = selectedFeatures.every(f => f.properties?.source === 'arrow');
    if (allArrows) {
        const mergeCheck = canMergeArrows(selectedFeatures);
        const splitCheck = canSplitArrows(selectedFeatures);

        if (mergeCheck.canMerge || splitCheck.canSplit) {
            const separatorMerge = document.createElement('div');
            separatorMerge.className = 'feature-menu-separator';
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

    // Add recalculate option for magnetic declination features (single selection only)
    if (selectedFeatures.length === 1 && currentFeature?.properties?.source === 'magnetic_declination') {
        const separatorDecl = document.createElement('div');
        separatorDecl.className = 'feature-menu-separator';
        dropdown.appendChild(separatorDecl);

        const recalcButton = document.createElement('button');
        recalcButton.className = 'feature-menu-button';
        recalcButton.textContent = 'Recalcular Declinação';

        recalcButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const control = getControl('AddDeclinationControl');
            if (control) {
                await control.recalculateDeclination(currentFeature);
                uiManager.updatePanels();
            }
            closeAllFeatureDropdowns(true);
        });
        dropdown.appendChild(recalcButton);
    }

    // Add conversion options for point features (single selection only)
    if (selectedFeatures.length === 1 && currentFeature?.properties?.source === 'point') {
        const separatorPoint = document.createElement('div');
        separatorPoint.className = 'feature-menu-separator';
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
        'coordination_line': 'Linhas de Coordenação',
        'military_symbol': 'Símbolos Militares',
        'coordination_measure': 'Medidas de Coordenação',
        'magnetic_declination': 'Declinações Magnéticas',
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
    arrow: ['width', 'fillColor', 'lineColor', 'lineWidth', 'fillOpacity', 'lineOpacity', 'headLengthRatio', 'showArrowHead', 'doubleHeaded'],
    boundary: ['color', 'lineWidth', 'opacity', 'echelon', 'symbol_size', 'text_size'],
    occupied_front: ['color', 'lineWidth', 'opacity'],
    coordination_line: ['color', 'lineWidth', 'opacity', 'symbol_code', 'symbol_size', 'symbol_spacing'],
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

// ===== COORDINATION LINE UTILITIES =====

/**
 * Reverses a coordination line by inverting its spine.
 *
 * Separate from `reverseArrow` on purpose: the two geometries take different arguments
 * (`generate(coords, props)` against `generate(props, zoom)`), so a shared helper would
 * have to branch on the type anyway. This one delegates to the control, whose
 * `updateFeaturesProperty` already regenerates the geometry and rewrites the live source
 * for `baseCoordinates`.
 *
 * @param {Object} feature - Coordination line to reverse
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 * @returns {Promise<void>} Resolves once the flip is persisted
 */
async function reverseCoordinationLine(feature, selectionManager, uiManager) {
    try {
        // `selectionManager.controls`, like the four sibling helpers below. The tool is LAZY
        // on this branch, and this is safe for the same reason theirs is: the menu only opens
        // over a SELECTED feature, and selecting one is what makes `tool-registry.js` resolve
        // the module and call `selectionManager.registerControl`.
        const control = selectionManager.controls.get('coordination_line');
        if (!control) {
            console.error('Coordination line control not found');
            return;
        }

        const spine = control.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!spine || spine.length < 2) {
            console.error('Coordination line does not have enough coordinates');
            return;
        }

        const reversed = [...spine].reverse();

        // One write: the control regenerates the geometry and rewrites the source.
        await control.updateFeaturesProperty([feature], 'baseCoordinates', reversed);

        control.updateSelectionManagerFeature(feature);
        control.createEditHandles(feature);
        await control.saveFeatureChanges(feature);

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error reversing coordination line:', error);
    }
}

// ===== ARROW UTILITIES =====

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

        // Update in map source. The collection read survives HERE and nowhere else in this file,
        // because it is an existence test: `add` on a key the source does not hold CREATES the
        // feature instead of skipping it, and the store write below runs either way. Draining
        // first keeps the copy read back from missing whatever the arrow tool has queued.
        const arrows = getGeoJsonDispatcher(map, 'arrows');
        await arrows.flush();

        const arrowData = await map.getSource('arrows').getData();
        const featureIndex = arrowData.features.findIndex(
            f => f.properties.id === arrowFeature.properties.id
        );

        if (featureIndex !== -1) {
            // Full-feature upsert: the reversal rewrites both geometry and baseCoordinates, and
            // `add` is a TOTAL replacement, so no stale property survives it.
            arrows.add(updatedFeature);
            await arrows.flush();
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
    let conversionFeatureId = null;
    let symbolAdded = false;
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

        conversionFeatureId = featureId;
        await storeImage(featureId, result.blob);

        // Deselect current point
        selectionManager.deselectAllFeatures();

        const pointId = pointFeature.properties.id;

        const milSymbols = getGeoJsonDispatcher(map, 'military_symbols');
        const points = getGeoJsonDispatcher(map, 'points');

        // Batch add+remove so a single Ctrl+Z undoes the whole conversion.
        startBatchUndo();
        try {
            // Add the military symbol FIRST so a persist failure cannot lose the point.
            await addFeature('military_symbols', feature);
            symbolAdded = true;
            milSymbols.add(feature);

            // The queued add only leaves at flush time, so the symbol image is now guaranteed to
            // be registered BEFORE the feature reaches the source, instead of racing it.
            await milSymControl.loadSymbolToMap(featureId, result.blob);

            // Only after the add succeeded do we remove the source point.
            await removeFeature('points', pointId);
            points.remove(pointId);

            await Promise.all([milSymbols.flush(), points.flush()]);
        } finally {
            commitBatchUndo();
        }

        // Select the new feature
        await selectionManager.toggleFeatureSelection('military_symbol', featureId, feature);

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error converting point to military symbol:', error);
        // If the symbol was never created, release its now-orphaned image blob.
        if (conversionFeatureId && !symbolAdded) {
            try { await removeImage(conversionFeatureId); } catch (_e) { /* best effort */ }
        }
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
    let conversionFeatureId = null;
    let symbolAdded = false;
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
        // The generator rasterises the Nucleo above its logical size and reports the ratio;
        // dropping it here registered the bitmap 1:1 and drew the converted symbol four times
        // larger than the same code drawn by the tool (see loadSymbolToMap below).
        feature.properties.pixelRatio = result.pixelRatio || 1;

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

        conversionFeatureId = featureId;
        await storeImage(featureId, result.blob);

        // Deselect current point
        selectionManager.deselectAllFeatures();

        const pointId = pointFeature.properties.id;

        const measures = getGeoJsonDispatcher(map, 'coordination_measures');
        const points = getGeoJsonDispatcher(map, 'points');

        // Batch add+remove so a single Ctrl+Z undoes the whole conversion.
        startBatchUndo();
        try {
            // Add the coordination measure FIRST so a persist failure cannot lose the point.
            await addFeature('coordination_measures', feature);
            symbolAdded = true;
            measures.add(feature);

            // Same ordering guarantee as the military symbol above: the image is registered
            // before the queued add reaches the source.
            await coordControl.loadSymbolToMap(featureId, result.blob, result.pixelRatio);

            // Only after the add succeeded do we remove the source point.
            await removeFeature('points', pointId);
            points.remove(pointId);

            await Promise.all([measures.flush(), points.flush()]);
        } finally {
            commitBatchUndo();
        }

        // Select the new feature
        await selectionManager.toggleFeatureSelection('coordination_measure', featureId, feature);

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error converting point to coordination measure:', error);
        // If the measure was never created, release its now-orphaned image blob.
        if (conversionFeatureId && !symbolAdded) {
            try { await removeImage(conversionFeatureId); } catch (_e) { /* best effort */ }
        }
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
