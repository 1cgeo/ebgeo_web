// Path: js/store/sync/feature-patch.js
import { deepEqual } from '../../utilities/deep-utils.js';

const METADATA = new Set(['id', 'sync', 'version', 'confirmedVersion', 'createdAt', 'updatedAt']);

/**
 * The property whose unit of dispute is each of its KEYS (owner's decision, 2026-09-24).
 *
 * The custom attributes are a bag of independent fields, and two colleagues filling different
 * fields of one feature used to dispute the whole bag: the second write was refused, and reapplying
 * it brought back a field the first had deleted. Mirrors the server's `ATTRIBUTES`
 * (`backend/src/modules/sync/feature-conflicts.js`), which merges and disputes per key.
 */
export const ATTRIBUTES = 'attributes';
/**
 * Keys the server refuses at `['properties','attributes',key]`, because they reach the prototype.
 * Only `__proto__` does; `constructor` and `prototype` are own keys like any other.
 */
export const UNSAFE_ATTRIBUTE_KEYS = new Set(['__proto__']);

/** @returns {boolean} Whether `value` is an attribute bag that can be diffed key by key. */
function isBag(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The per-key entries of an attribute change, or null when it has to travel whole.
 *
 * A bag that was ABSENT reads as empty, so the first attribute two colleagues each add to a feature
 * are two keys and not two bags (the server creates the bag). WHOLE is kept for the shapes a
 * per-key patch cannot state: the bag disappearing, a value that is not a plain object, and a key
 * the server would refuse. Those are the old wire shape, which the server still accepts and applies
 * as a replacement.
 * @param {*} previous - `previousData.properties.attributes`.
 * @param {*} next - `data.properties.attributes`.
 * @returns {Array<Object>|null}
 */
function attributeEntries(previous, next) {
    if (previous === undefined) previous = {};
    if (!isBag(previous) || !isBag(next)) return null;
    const entries = [];
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        if (UNSAFE_ATTRIBUTE_KEYS.has(key) || key === '') return null;
        if (Object.hasOwn(previous, key) && Object.hasOwn(next, key) && deepEqual(previous[key], next[key])) continue;
        entries.push(Object.hasOwn(next, key)
            ? { op: 'set', path: ['properties', ATTRIBUTES, key], value: next[key] }
            : { op: 'remove', path: ['properties', ATTRIBUTES, key] });
    }
    return entries;
}

/**
 * Geometry is one unit; each property is one unit, including arrays and nested objects, EXCEPT the
 * custom attributes, whose unit is each key (see {@link ATTRIBUTES}).
 */
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
        if (key === ATTRIBUTES) {
            const perKey = attributeEntries(previous[key], next[key]);
            if (perKey) {
                patch.push(...perKey);
                continue;
            }
        }
        patch.push(Object.hasOwn(next, key)
            ? { op: 'set', path: ['properties', key], value: next[key] }
            : { op: 'remove', path: ['properties', key] });
    }
    return { protocolVersion: 2, baseVersion, patch };
}
