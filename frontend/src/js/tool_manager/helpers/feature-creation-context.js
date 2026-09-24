// Path: js/tool_manager/helpers/feature-creation-context.js
import { addFeature, getActiveLayerIdSync, getCurrentMapNameSync, getLayers, getStateManager } from '@store/index.js';
import { getActiveScope } from '@store/atlas-namespace.js';
import { mapResolver } from '@store/services/map-resolver.service.js';
import { lockedLayerCreateNotice } from '@store/denial-phrases.js';
import { showWarning } from '@utils/toast_service.js';
import { criaFeicao } from '../tool-registry.js';

/**
 * The activation gate of the drawing tools: the refusal sentence when `tool` creates features and
 * the ACTIVE layer is locked, or null.
 *
 * Wired into `ToolManager.setActiveTool` by `map_sig.js`. The tool stays drawn and the click
 * refuses naming the state ("o ESTADO recusa o clique"), because the person can lift the lock or
 * pick another layer. The store refuses the same creation at the commit
 * (`refuseCreationInLockedLayer`, `store/feature.operations.js`), for the lock that lands in the
 * middle of a drawing; this gate is what spares the person drawing something that cannot be kept.
 * @param {Object} tool - The tool being activated (its `type` is the registry's `tipoDeUi`).
 * @returns {string|null}
 */
export function lockedActiveLayerRefusal(tool) {
    if (!criaFeicao(tool?.type)) return null;
    const activeId = getActiveLayerIdSync();
    const layer = getLayers().find((l) => l.id === activeId);
    return layer?.locked === true ? lockedLayerCreateNotice(true) : null;
}

/** Keep a completed drawing visible when its original layer was removed during preparation. */
export async function saveCreatedFeature(storage, feature, mapName) {
    const layers = getLayers(mapName);
    const layerId = feature.properties.layerId;
    let replacement = null;
    if (layerId && !layers.some(layer => layer.id === layerId)) {
        replacement = layers.find(layer => !layer.locked && layer.visible !== false)
            || layers.find(layer => !layer.locked);
        if (!replacement) {
            showWarning('A camada de origem foi removida e não há outra camada disponível para salvar o desenho.');
            return false;
        }
        feature.properties.layerId = replacement.id;
    }
    const saved = await addFeature(storage, feature, mapName);
    if (saved && replacement) {
        showWarning(`A camada de origem foi removida. O desenho foi salvo na camada "${replacement.name}".`);
    }
    return saved;
}

/** Capture the destination before an asynchronous drawing finalization begins. */
export function captureFeatureCreation(control) {
    const scope = getActiveScope();
    const mapId = mapResolver.resolveToId(getCurrentMapNameSync());
    const activationId = control._activationId;
    const initialTool = control.toolManager.activeTool;
    const isCurrent = () => getActiveScope() === scope
        && mapResolver.isKnown(mapId)
        && mapResolver.resolveToId(getCurrentMapNameSync()) === mapId;
    const canSelect = () => isCurrent()
        && control._activationId === activationId
        && !control.toolManager.activeTool
        && !getStateManager()?.getUnsafe('ui.activeToolbarGroup');
    const canSave = () => {
        if (getActiveScope() === scope && mapResolver.isKnown(mapId)) return true;
        showWarning('O mapa de origem não está mais aberto. O desenho não foi salvo em outro atlas.');
        return false;
    };

    return {
        layerId: getActiveLayerIdSync(),
        zoom: control.map.getZoom(),
        get mapName() { return mapResolver.resolveToName(mapId); },
        isCurrent,
        canSave,
        isActiveTool: () => isCurrent() && control._activationId === activationId
            && control.toolManager.activeTool === control,
        async save(storage, feature) {
            if (!canSave()) return false;
            return saveCreatedFeature(storage, feature, mapResolver.resolveToName(mapId));
        },
        async finish(type, feature, isGestureCurrent = () => true) {
            if (!isCurrent() || control._activationId !== activationId || !isGestureCurrent()) return;
            if (control.toolManager.activeTool === control) {
                if (Array.isArray(control.drawPoints)) control.drawPoints = [];
                control.toolManager.deactivateCurrentTool();
            } else if (initialTool || control.toolManager.activeTool) {
                return;
            }
            const stillCurrent = () => canSelect() && isGestureCurrent();
            if (!stillCurrent()) return;
            await control.selectionManager.toggleFeatureSelection(type, feature.properties.id, feature, false, stillCurrent);
            if (stillCurrent()) control.selectionManager.updateUI();
        }
    };
}
