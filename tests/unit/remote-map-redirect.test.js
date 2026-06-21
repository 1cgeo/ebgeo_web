// Path: tests/unit/remote-map-redirect.test.js
import { describe, it, expect } from 'vitest';
import { resolveRedirectTarget } from '../../src/js/sidebar/tabs/remote-map-redirect.js';

const idToName = { 'id-A': 'Mapa A', 'id-B': 'Mapa B', 'id-C': 'Mapa C' };
const getNameForId = (id) => idToName[id];

function ctx(currentMapName, allMapNames = ['Mapa A', 'Mapa B', 'Mapa C']) {
    return { currentMapName, allMapNames, getNameForId };
}

describe('resolveRedirectTarget (§1.9 remote map-delete redirect)', () => {
    it('redirects to another map when the CURRENT map is deleted remotely', () => {
        const op = { entityType: 'map', operationType: 'delete', entityId: 'id-A' };
        expect(resolveRedirectTarget(op, ctx('Mapa A'))).toBe('Mapa B');
    });

    it('does NOT redirect when a DIFFERENT map is deleted', () => {
        const op = { entityType: 'map', operationType: 'delete', entityId: 'id-B' };
        expect(resolveRedirectTarget(op, ctx('Mapa A'))).toBeNull();
    });

    it('does NOT redirect for non-delete or non-map ops', () => {
        expect(resolveRedirectTarget({ entityType: 'map', operationType: 'update', entityId: 'id-A' }, ctx('Mapa A'))).toBeNull();
        expect(resolveRedirectTarget({ entityType: 'feature', operationType: 'delete', entityId: 'id-A' }, ctx('Mapa A'))).toBeNull();
    });

    it('returns null when the deleted map is the ONLY map (nowhere to go)', () => {
        const op = { entityType: 'map', operationType: 'delete', entityId: 'id-A' };
        expect(resolveRedirectTarget(op, ctx('Mapa A', ['Mapa A']))).toBeNull();
    });

    it('returns null when the id is unknown / op missing', () => {
        expect(resolveRedirectTarget({ entityType: 'map', operationType: 'delete', entityId: 'ghost' }, ctx('Mapa A'))).toBeNull();
        expect(resolveRedirectTarget(null, ctx('Mapa A'))).toBeNull();
    });
});
