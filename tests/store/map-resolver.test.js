import { describe, it, expect, beforeEach } from 'vitest';
import { createMapResolver } from '../../src/js/store/services/map-resolver.service.js';

let resolver;

beforeEach(() => {
    resolver = createMapResolver();
});

// ============================================================================
// Registration
// ============================================================================

describe('MapResolver registration', () => {
    it('registers name/ID mapping', () => {
        resolver.registerMap('Mapa 1', 'uuid-1');
        expect(resolver.size).toBe(1);
    });

    it('resolves name to ID', () => {
        resolver.registerMap('Mapa 1', 'uuid-1');
        expect(resolver.resolveToId('Mapa 1')).toBe('uuid-1');
    });

    it('resolves ID to name', () => {
        resolver.registerMap('Mapa 1', 'uuid-1');
        expect(resolver.resolveToName('uuid-1')).toBe('uuid-1'); // Not a valid UUID v4 format
    });

    it('resolves valid UUID to name', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        resolver.registerMap('Mapa 1', uuid);
        expect(resolver.resolveToName(uuid)).toBe('Mapa 1');
    });

    it('returns original input when not found', () => {
        expect(resolver.resolveToId('Unknown')).toBe('Unknown');
        expect(resolver.resolveToName('unknown-id')).toBe('unknown-id');
    });
});

// ============================================================================
// Unregister
// ============================================================================

describe('MapResolver unregister', () => {
    it('removes mapping by ID', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        resolver.registerMap('Mapa 1', uuid);
        resolver.unregisterMapById(uuid);
        expect(resolver.isKnown('Mapa 1')).toBe(false);
        expect(resolver.isKnown(uuid)).toBe(false);
    });

    it('handles unregister of unknown ID gracefully', () => {
        expect(() => resolver.unregisterMapById('unknown')).not.toThrow();
    });
});

// ============================================================================
// Rename
// ============================================================================

describe('MapResolver rename', () => {
    it('updates name mapping', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        resolver.registerMap('Mapa 1', uuid);
        resolver.renameMap('Mapa 1', 'Mapa Renomeado');

        expect(resolver.resolveToId('Mapa Renomeado')).toBe(uuid);
        expect(resolver.resolveToId('Mapa 1')).toBe('Mapa 1'); // No longer known
        expect(resolver.resolveToName(uuid)).toBe('Mapa Renomeado');
    });

    it('handles rename of unknown name gracefully', () => {
        expect(() => resolver.renameMap('Unknown', 'New Name')).not.toThrow();
    });
});

// ============================================================================
// Bidirectional consistency
// ============================================================================

describe('MapResolver bidirectional consistency', () => {
    it('resolveToId(resolveToName(id)) === id', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        resolver.registerMap('Mapa 1', uuid);

        const name = resolver.resolveToName(uuid);
        const backToId = resolver.resolveToId(name);
        expect(backToId).toBe(uuid);
    });

    it('resolveToName(resolveToId(name)) === name', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        resolver.registerMap('Mapa 1', uuid);

        const id = resolver.resolveToId('Mapa 1');
        const backToName = resolver.resolveToName(id);
        expect(backToName).toBe('Mapa 1');
    });

    it('maintains consistency after rename', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        resolver.registerMap('Original', uuid);
        resolver.renameMap('Original', 'Renamed');

        const id = resolver.resolveToId('Renamed');
        const name = resolver.resolveToName(id);
        expect(id).toBe(uuid);
        expect(name).toBe('Renamed');
    });
});

// ============================================================================
// isKnown
// ============================================================================

describe('MapResolver isKnown', () => {
    it('recognizes registered names', () => {
        resolver.registerMap('Mapa 1', 'id-1');
        expect(resolver.isKnown('Mapa 1')).toBe(true);
    });

    it('recognizes registered UUIDs', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        resolver.registerMap('Mapa 1', uuid);
        expect(resolver.isKnown(uuid)).toBe(true);
    });

    it('returns false for unknown', () => {
        expect(resolver.isKnown('Unknown')).toBe(false);
    });

    it('returns false for null/empty', () => {
        expect(resolver.isKnown(null)).toBe(false);
        expect(resolver.isKnown('')).toBe(false);
    });
});

// ============================================================================
// Bulk operations
// ============================================================================

describe('MapResolver bulk operations', () => {
    beforeEach(() => {
        const maps = [
            { name: 'Mapa 1', id: '550e8400-e29b-41d4-a716-446655440001' },
            { name: 'Mapa 2', id: '550e8400-e29b-41d4-a716-446655440002' },
            { name: 'Mapa 3', id: '550e8400-e29b-41d4-a716-446655440003' }
        ];
        maps.forEach(m => resolver.registerMap(m.name, m.id));
    });

    it('getAllNames returns all names', () => {
        const names = resolver.getAllNames();
        expect(names).toContain('Mapa 1');
        expect(names).toContain('Mapa 2');
        expect(names).toContain('Mapa 3');
        expect(names).toHaveLength(3);
    });

    it('getAllIds returns all IDs', () => {
        const ids = resolver.getAllIds();
        expect(ids).toHaveLength(3);
    });

    it('clear removes everything', () => {
        resolver.clear();
        expect(resolver.size).toBe(0);
        expect(resolver.isInitialized).toBe(false);
    });
});

// ============================================================================
// Direct lookups
// ============================================================================

describe('MapResolver direct lookups', () => {
    it('getIdForName returns ID', () => {
        resolver.registerMap('Test', 'id-1');
        expect(resolver.getIdForName('Test')).toBe('id-1');
    });

    it('getIdForName returns undefined for unknown', () => {
        expect(resolver.getIdForName('Unknown')).toBeUndefined();
    });

    it('getNameForId returns name', () => {
        resolver.registerMap('Test', 'id-1');
        expect(resolver.getNameForId('id-1')).toBe('Test');
    });

    it('getNameForId returns undefined for unknown', () => {
        expect(resolver.getNameForId('unknown')).toBeUndefined();
    });
});

// ============================================================================
// UUID detection
// ============================================================================

describe('MapResolver UUID auto-detection', () => {
    it('recognizes UUID input and returns as-is when known', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        resolver.registerMap('Mapa 1', uuid);
        expect(resolver.resolveToId(uuid)).toBe(uuid);
    });

    it('returns unknown UUID as-is (assumes new map)', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655449999';
        expect(resolver.resolveToId(uuid)).toBe(uuid);
    });

    it('treats non-UUID strings as names', () => {
        resolver.registerMap('my-map', 'id-1');
        expect(resolver.resolveToId('my-map')).toBe('id-1');
    });
});

// ============================================================================
// Backend integration scenarios
// ============================================================================

describe('MapResolver backend scenarios', () => {
    it('simulates server returning UUID, UI using name', () => {
        // Server creates a map with UUID
        const serverId = '550e8400-e29b-41d4-a716-446655440000';
        resolver.registerMap('Operação Alpha', serverId);

        // UI code uses name
        const resolvedId = resolver.resolveToId('Operação Alpha');
        expect(resolvedId).toBe(serverId);

        // Backend response uses UUID
        const resolvedName = resolver.resolveToName(serverId);
        expect(resolvedName).toBe('Operação Alpha');
    });

    it('simulates concurrent rename (conflict detection)', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        resolver.registerMap('Original', uuid);

        // Client A renames
        resolver.renameMap('Original', 'Renamed by A');

        // Client B tries to resolve old name
        const result = resolver.resolveToId('Original');
        // Should not find it anymore — returns as-is
        expect(result).toBe('Original');

        // But UUID still resolves
        expect(resolver.resolveToName(uuid)).toBe('Renamed by A');
    });
});
