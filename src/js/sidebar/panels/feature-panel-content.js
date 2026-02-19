// Path: js/sidebar/panels/feature-panel-content.js

/**
 * @fileoverview Feature panel content creation for selected features.
 * Builds the feature panel UI with identification, gallery, tabs, location, and delete sections.
 *
 * @module sidebar/panels/feature-panel-content
 */

import { showConfirm } from '../../modals/index.js';
import { createFeatureIdentification, createMultiSelectionHeader } from '../components/feature-identification.js';
import { createPhotoGallery } from '../components/feature-photo-gallery.js';
import { createFeatureTabs } from '../components/feature-tabs.js';
import { createLocationSection } from '../components/feature-location-section.js';
import { createGroupTypeSelector } from '../components/group-type-selector.js';
import { createMultiSelectionActions } from '../components/multi-selection-actions.js';
import { isCurrentMapLockedSync, startBatchUndo, commitBatchUndo, discardBatchUndo } from '../../store';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Feature type display names in Portuguese.
 * @constant {Object<string, string>}
 */
const FEATURE_TYPE_NAMES = {
    'point': 'Ponto',
    'line': 'Linha',
    'polygon': 'Polígono',
    'circle': 'Círculo',
    'ellipse': 'Elipse',
    'rectangle': 'Retângulo',
    'text': 'Texto',
    'image': 'Imagem',
    'brush': 'Pincel',
    'arrow': 'Seta',
    'boundary': 'Limite',
    'occupied_front': 'Frente Ocupada',
    'military_symbol': 'Símbolo Militar',
    'coordination_measure': 'Medida de Coordenação',
    'los': 'Linha de Visada',
    'visibility': 'Visibilidade',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Gets a display name for the feature type.
 *
 * @param {string} featureType - Feature type
 * @returns {string} Display name in Portuguese
 */
export function getFeatureTypeName(featureType) {
    return FEATURE_TYPE_NAMES[featureType] || 'Feição';
}

/**
 * Creates the delete section with delete button.
 *
 * @param {Object} options - Options
 * @param {boolean} options.isSingleSelection - Whether single feature is selected
 * @param {number} options.featureCount - Number of selected features
 * @param {Object} options.selectionManager - Selection manager instance
 * @returns {HTMLElement} Delete section element
 */
function createDeleteSection({ isSingleSelection, featureCount, selectionManager }) {
    const deleteSection = document.createElement('div');
    deleteSection.className = 'feature-panel-delete-section';

    const deleteButton = document.createElement('button');
    deleteButton.className = 'feature-panel-delete-btn';
    const deleteLabel = isSingleSelection ? 'Deletar' : `Deletar ${featureCount} feições`;
    deleteButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        ${deleteLabel}
    `;

    const confirmTitle = isSingleSelection
        ? 'Deletar esta feição?'
        : `Deletar ${featureCount} feições?`;

    deleteButton.onclick = async () => {
        const confirmed = await showConfirm(confirmTitle, { destructive: true });
        if (confirmed) {
            await selectionManager?.deleteSelectedFeatures();
        }
    };

    deleteSection.appendChild(deleteButton);
    return deleteSection;
}

/**
 * Creates global save/discard buttons for mixed type editing.
 *
 * @param {Object} options - Options
 * @param {Map} options.editedTypesState - State map for edited types
 * @param {Object} options.selectionManager - Selection manager instance
 * @returns {HTMLElement} Buttons container element
 */
function createGlobalButtons({ editedTypesState, selectionManager }) {
    const saveAllEditedTypes = async () => {
        // Batch all saves so they produce a single undo entry
        const needsBatch = editedTypesState.size > 1;
        if (needsBatch) startBatchUndo();
        try {
            for (const [_type, state] of editedTypesState) {
                const { control, features, initialPropertiesMap } = state;
                if (control && typeof control.saveFeatures === 'function') {
                    await control.saveFeatures(features, initialPropertiesMap);
                }
            }
            if (needsBatch) commitBatchUndo();
        } catch (error) {
            if (needsBatch) discardBatchUndo();
            console.error('Error during batch save:', error);
        }
    };

    const discardAllEditedTypes = async () => {
        for (const [_type, state] of editedTypesState) {
            const { control, features, initialPropertiesMap } = state;
            if (control && typeof control.discardChangeFeatures === 'function') {
                await control.discardChangeFeatures(features, initialPropertiesMap);
            }
        }
    };

    const globalButtonsContainer = document.createElement('div');
    globalButtonsContainer.className = 'group-type-global-buttons';

    const globalButtonsRow = document.createElement('div');
    globalButtonsRow.className = 'attr-modern-buttons-row';

    const globalSaveButton = document.createElement('button');
    globalSaveButton.textContent = 'Salvar';
    globalSaveButton.className = 'group-type-btn-save';
    globalSaveButton.type = 'button';
    globalSaveButton.addEventListener('click', async () => {
        await saveAllEditedTypes();
        // skipSave: saveAllEditedTypes() already persisted — avoid double undo entry
        selectionManager?.deselectAllFeatures({ skipSave: true });
    });
    globalButtonsRow.appendChild(globalSaveButton);

    const globalDiscardButton = document.createElement('button');
    globalDiscardButton.textContent = 'Descartar';
    globalDiscardButton.className = 'group-type-btn-discard';
    globalDiscardButton.type = 'button';
    globalDiscardButton.addEventListener('click', async () => {
        await discardAllEditedTypes();
        // skipSave: discard reverted changes — nothing to save
        selectionManager?.deselectAllFeatures({ skipSave: true });
    });
    globalButtonsRow.appendChild(globalDiscardButton);

    globalButtonsContainer.appendChild(globalButtonsRow);

    return {
        element: globalButtonsContainer,
        saveAll: saveAllEditedTypes
    };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Creates feature panel content for selected features.
 * Uses component-based structure:
 * - Identification section
 * - Photo gallery
 * - Tabs (Estilo / Atributos)
 * - Location section
 * - Delete button
 *
 * @param {Object} options - Options
 * @param {Array<Object>} options.selectedFeatures - Selected features
 * @param {string} options.featureType - Feature type
 * @param {Object} options.selectionManager - Selection manager instance
 * @param {Object} options.uiManager - UI manager instance
 * @param {Object} [options.map] - MapLibre map instance (for location section)
 * @returns {Promise<{ element: HTMLElement, cleanup: Function } | null>}
 */
export async function createFeaturePanelContent({
    selectedFeatures,
    featureType,
    selectionManager,
    uiManager,
    map
}) {
    if (!selectedFeatures || selectedFeatures.length === 0) return null;

    const control = selectionManager?.controls.get(featureType);
    const feature = selectedFeatures[0];
    const featureId = feature?.properties?.id;
    const isSingleSelection = selectedFeatures.length === 1;

    // Check if all selected features are the same type
    const types = new Set(selectedFeatures.map(f => f.properties?.source));
    const isMixedTypes = types.size > 1;

    // Main container
    const mapLocked = isCurrentMapLockedSync();
    const container = document.createElement('div');
    container.className = 'feature-panel-sections';
    if (mapLocked) {
        container.classList.add('feature-panel--locked');
    }

    // Array to store cleanup functions
    const cleanupFunctions = [];

    // 1. Identification section
    let identificationSection;
    if (isSingleSelection) {
        if (!control) {
            console.warn(`Control not found for type: ${featureType}`);
            return null;
        }
        identificationSection = await createFeatureIdentification({
            feature,
            featureType,
            selectedFeatures,
            selectionManager,
            uiManager,
            onNameChange: (newName) => {
                control.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                uiManager?.updateSelectionHighlight();
            }
        });
    } else {
        identificationSection = createMultiSelectionHeader({
            selectedFeatures,
            featureType,
            selectionManager,
            uiManager
        });
    }
    container.appendChild(identificationSection);

    // 1b. Multi-selection action buttons (lock/hide) — only for multi-selection when map not locked
    if (!isSingleSelection && !mapLocked) {
        const actionsSection = createMultiSelectionActions({
            selectedFeatures,
            selectionManager,
            uiManager
        });
        container.appendChild(actionsSection);
    }

    // 2. Photo gallery (only for single selection)
    if (isSingleSelection) {
        const photoGallery = await createPhotoGallery({
            featureId,
            featureType,
            compact: true
        });
        container.appendChild(photoGallery.element);
        cleanupFunctions.push(photoGallery.cleanup);
    }

    // 3. Info section before tabs (for LOS and similar analysis tools)
    if (isSingleSelection && control && typeof control.createInfoSection === 'function') {
        try {
            const infoSection = control.createInfoSection(selectedFeatures[0]);
            if (infoSection) {
                container.appendChild(infoSection);
            }
        } catch (error) {
            console.error(`Error creating info section for ${featureType}:`, error);
        }
    }

    // 4. Tabs (Estilo / Parâmetros / Atributos) - only show for single selection or multiple same-type
    // For mixed types, show group type selector to edit by type
    if (!isMixedTypes) {
        const featureTabs = createFeatureTabs({
            featureId,
            featureType,
            singleSelection: isSingleSelection
        });
        container.appendChild(featureTabs.container);
        cleanupFunctions.push(featureTabs.cleanup);

        // Inject tool-specific style controls into the Style tab
        if (control && control.hasAttributePanel && control.hasAttributePanel()) {
            try {
                control.createAttributePanel(
                    featureTabs.styleTab,
                    selectedFeatures,
                    selectionManager,
                    uiManager,
                    { hideHeader: true }
                );
            } catch (error) {
                console.error(`Error creating attribute panel for ${featureType}:`, error);
            }
        }

        // Inject parameters controls into Parameters tab (for LOS and similar tools)
        if (featureTabs.parametersTab && control && typeof control.createParametersPanel === 'function') {
            try {
                control.createParametersPanel(
                    featureTabs.parametersTab,
                    selectedFeatures,
                    selectionManager,
                    uiManager
                );
                // Register cleanup for terrain listener attached by parameters panel
                if (featureTabs.parametersTab._parametersCleanup) {
                    cleanupFunctions.push(featureTabs.parametersTab._parametersCleanup);
                }
            } catch (error) {
                console.error(`Error creating parameters panel for ${featureType}:`, error);
            }
        }
    } else {
        // Mixed types: show group type selector
        const typeTabsContainer = document.createElement('div');
        typeTabsContainer.className = 'group-type-tabs-container';

        // Track state for each type that was edited
        const editedTypesState = new Map();

        const typeSelector = createGroupTypeSelector({
            selectedFeatures,
            onTypeSelect: (selectedType, featuresOfType) => {
                // Clear previous tabs content
                typeTabsContainer.innerHTML = '';

                // Get control for this type
                const typeControl = selectionManager?.controls.get(selectedType);

                // Store initial properties for this type if not already stored
                if (!editedTypesState.has(selectedType)) {
                    editedTypesState.set(selectedType, {
                        control: typeControl,
                        features: featuresOfType,
                        initialPropertiesMap: new Map(
                            featuresOfType.map(f => [f.properties.id, { ...f.properties }])
                        )
                    });
                }

                // Create tabs for this type (multi-selection mode)
                const typeTabs = createFeatureTabs({
                    featureId: featuresOfType[0]?.properties?.id,
                    featureType: selectedType,
                    singleSelection: false
                });
                typeTabsContainer.appendChild(typeTabs.container);

                // Inject style controls for this type (hide buttons, we'll add global ones)
                if (typeControl && typeControl.hasAttributePanel && typeControl.hasAttributePanel()) {
                    try {
                        typeControl.createAttributePanel(
                            typeTabs.styleTab,
                            featuresOfType,
                            selectionManager,
                            uiManager,
                            { hideHeader: true, hideButtons: true }
                        );
                    } catch (error) {
                        console.error(`Error creating attribute panel for ${selectedType}:`, error);
                    }
                }
            }
        });

        container.appendChild(typeSelector.element);
        container.appendChild(typeTabsContainer);

        // Create global Save/Discard buttons for all types
        const globalButtons = createGlobalButtons({
            editedTypesState,
            selectionManager
        });
        container.appendChild(globalButtons.element);

        // Cleanup: save all edited types before destroying
        cleanupFunctions.push(() => {
            globalButtons.saveAll();
            typeSelector.cleanup();
        });
    }

    // 5. Location section (only for single selection)
    if (isSingleSelection && map) {
        const locationSection = await createLocationSection({
            feature,
            featureType,
            map,
            control,
            uiManager
        });
        container.appendChild(locationSection);
    }

    // 6. Delete button (hidden when map locked)
    if (!mapLocked) {
        const deleteSection = createDeleteSection({
            isSingleSelection,
            featureCount: selectedFeatures.length,
            selectionManager
        });
        container.appendChild(deleteSection);
    }

    // Cleanup function
    const cleanup = () => {
        cleanupFunctions.forEach(fn => {
            try {
                fn();
            } catch (e) {
                console.warn('Cleanup error:', e);
            }
        });
    };

    return {
        element: container,
        cleanup
    };
}
