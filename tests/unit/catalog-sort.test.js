import { describe, it, expect } from 'vitest';
import { parseCatalogDate, sortByDateDesc, formatCatalogDate } from '../../src/js/catalog/catalog.service.js';

describe('parseCatalogDate', () => {
    it('parses the DD/MM/YYYY that 3D models carry', () => {
        expect(parseCatalogDate('15/03/2024')).toBe(new Date(2024, 2, 15).getTime());
    });

    it('parses the ISO YYYY-MM-DD that 360 projects carry', () => {
        expect(parseCatalogDate('2026-02-25')).toBe(new Date(2026, 1, 25).getTime());
    });

    it('tolerates an ISO datetime by reading only the date part', () => {
        expect(parseCatalogDate('2026-02-25T13:40:00Z')).toBe(new Date(2026, 1, 25).getTime());
    });

    it('returns null for missing or unparseable dates instead of NaN', () => {
        expect(parseCatalogDate(null)).toBeNull();
        expect(parseCatalogDate(undefined)).toBeNull();
        expect(parseCatalogDate('')).toBeNull();
        expect(parseCatalogDate('not a date')).toBeNull();
    });
});

describe('formatCatalogDate', () => {
    it('leaves a DD/MM/YYYY date as DD/MM/YYYY', () => {
        expect(formatCatalogDate('15/03/2024')).toBe('15/03/2024');
    });

    it('renders an ISO date as DD/MM/YYYY (the two sources now match)', () => {
        expect(formatCatalogDate('2026-02-25')).toBe('25/02/2026');
    });

    it('zero-pads single-digit day and month', () => {
        expect(formatCatalogDate('2026-01-05')).toBe('05/01/2026');
    });

    it('returns unparseable input unchanged, and empty for nullish', () => {
        expect(formatCatalogDate('sem data')).toBe('sem data');
        expect(formatCatalogDate(null)).toBe('');
        expect(formatCatalogDate(undefined)).toBe('');
    });
});

describe('sortByDateDesc', () => {
    // A model (DD/MM/YYYY) and a 360 project (ISO) that must interleave by date.
    const items = [
        { id: 'model-old', date: '15/03/2024' },
        { id: '360-new', date: '2026-02-25' },
        { id: 'model-mid', date: '20/01/2025' },
        { id: 'layer-a', date: null },
        { id: '360-old', date: '2023-12-01' },
        { id: 'layer-b', date: null },
    ];

    it('orders most recent first across the two date formats', () => {
        const ordered = sortByDateDesc(items).map(i => i.id);
        // 2026-02-25 > 20/01/2025 > 15/03/2024 > 2023-12-01, then the undated.
        expect(ordered.slice(0, 4)).toEqual(['360-new', 'model-mid', 'model-old', '360-old']);
    });

    it('places undated items at the end, in their original order (stable)', () => {
        const ordered = sortByDateDesc(items).map(i => i.id);
        expect(ordered.slice(4)).toEqual(['layer-a', 'layer-b']);
    });

    it('does not mutate the input array', () => {
        const before = items.map(i => i.id);
        sortByDateDesc(items);
        expect(items.map(i => i.id)).toEqual(before);
    });

    it('is deterministic even when every date is a different format-mix', () => {
        // The old comparator returned NaN whenever an ISO date met a DD/MM one,
        // corrupting the whole order. This asserts a fully-determined result.
        const mixed = [
            { id: 'a', date: '2020-01-01' },
            { id: 'b', date: '01/01/2022' },
            { id: 'c', date: '2021-06-15' },
        ];
        expect(sortByDateDesc(mixed).map(i => i.id)).toEqual(['b', 'c', 'a']);
    });
});
