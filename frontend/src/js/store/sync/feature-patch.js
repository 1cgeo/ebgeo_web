// Path: js/store/sync/feature-patch.js
import { deepEqual } from '../../utilities/deep-utils.js';

const METADATA = new Set(['id', 'sync', 'version', 'confirmedVersion', 'createdAt', 'updatedAt']);

/** Geometry is one unit; each property is one unit, including arrays and nested objects. */
export function featureMutationContract(operationType, data, previousData) {
    const baseVersion = previousData?.properties?.confirmedVersion ?? null;
    if (operationType !== 'update') return { protocolVersion: 2, baseVersion, patch: null };
    if (!previousData || !data) return { protocolVersion: 2, baseVersion, patch: null };
    const patch = [];
    if (!deepEqual(previousData.geometry, data.geometry)) {
        patch.push({ op: 'set', path: ['geometry'], value: data.geometry });
    }
    const previous = previousData.properties ?? {};
    const next = data.properties ?? {};
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        if (METADATA.has(key) || deepEqual(previous[key], next[key])) continue;
        patch.push(Object.hasOwn(next, key)
            ? { op: 'set', path: ['properties', key], value: next[key] }
            : { op: 'remove', path: ['properties', key] });
    }
    return { protocolVersion: 2, baseVersion, patch };
}
