// Path: js/tool_manager/helpers/discard-targets.helpers.js

/**
 * @fileoverview What "Descartar" in a feature panel restores: the snapshot taken when the panel
 * opened, EXCEPT for the fields somebody else changed while it was open.
 *
 * Every tool's `discardChangeFeatures` copies the opening snapshot over the panel copy and WRITES
 * the whole feature back (`updateFeatures(..., save = true)`, which ends in `updateFeature`). The
 * snapshot predates a colleague's edit made meanwhile, and the op leaves with an up-to-date base,
 * so the server accepted it: a colleague renames a line, I click "Descartar" without having
 * touched it, and the name goes back to the old one everywhere (measured in two browsers,
 * `frontend/tests/e2e-ui/browser-collab-descartar-painel.repro.spec.js`).
 *
 * The rule is the one undo already follows (`keepLaterEdits`, `store/feature.operations.js`),
 * with the panel copy as the state "the edit left": a field whose STORED value is no longer the
 * panel's was changed by someone else (or was only a preview here, in which case the stored
 * value is the opening one anyway), and it keeps the stored value; a field the panel and the
 * store agree on goes back to the opening snapshot. So this person's persisted and previewed
 * changes are discarded and nobody else's are.
 *
 * Built ONCE for all the tools, at the two places that call `discardChangeFeatures`, instead of
 * in the eighteen implementations of it.
 */

import { getFeatureById, keepLaterEdits } from '@store/feature.operations.js';
import { getStorageTypeFromSource } from '@store/store.constants.js';

/**
 * The properties each selected feature should be discarded to.
 * @param {Object[]} features - The panel copies of the selected features.
 * @param {Map<string, Object>} initialPropertiesMap - Snapshot of each feature's properties when
 *   the panel opened, keyed by feature id.
 * @returns {Promise<Map<string, Object>>} A new map with the same keys: the snapshot, with every
 *   field changed by someone else meanwhile replaced by the stored value.
 */
export async function discardTargets(features, initialPropertiesMap) {
    const targets = new Map(initialPropertiesMap);
    for (const feature of Array.isArray(features) ? features : []) {
        const id = feature?.properties?.id;
        const initial = id ? initialPropertiesMap.get(id) : null;
        if (!initial) continue;
        const storage = getStorageTypeFromSource(feature.properties.source);
        let stored = null;
        try {
            stored = storage ? await getFeatureById(storage, id) : null;
        } catch (error) {
            console.warn('Discard could not read the stored feature, using the opening snapshot:', error);
        }
        if (!stored) continue;
        const target = keepLaterEdits(stored, feature, { ...feature, properties: initial });
        targets.set(id, target.properties);
    }
    return targets;
}
