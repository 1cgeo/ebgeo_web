// Path: tests/unit/kml-document.test.js

import { describe, it, expect } from 'vitest';
import {
    hashString,
    StyleRegistry,
    buildPlacemark,
    buildGroundOverlay,
    buildFolder,
    buildKmlDocument,
} from '@js/import_export/kmz/kml-document.js';

const POINT = '<Point><coordinates>1,2,0</coordinates></Point>';

describe('hashString', () => {
    it('is deterministic and fixed-width', () => {
        expect(hashString('abc')).toBe(hashString('abc'));
        expect(hashString('abc')).toMatch(/^[0-9a-f]{8}$/);
    });

    it('separates different inputs', () => {
        expect(hashString('abc')).not.toBe(hashString('abd'));
        expect(hashString('')).not.toBe(hashString('a'));
    });

    it('handles null and non-strings', () => {
        expect(hashString(null)).toMatch(/^[0-9a-f]{8}$/);
        expect(hashString(undefined)).toBe(hashString(''));
    });

    it('stays 8 hex chars for long input', () => {
        expect(hashString('x'.repeat(10000))).toMatch(/^[0-9a-f]{8}$/);
    });
});

describe('StyleRegistry', () => {
    it('emits one Style per unique signature', () => {
        const registry = new StyleRegistry();
        const a = registry.register('sig-a', '<LineStyle/>');
        const b = registry.register('sig-a', '<LineStyle/>');
        const c = registry.register('sig-b', '<PolyStyle/>');

        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(registry.size).toBe(2);
        expect(registry.toXml().match(/<Style /g)).toHaveLength(2);
    });

    it('collapses many features onto few styles', () => {
        const registry = new StyleRegistry();
        for (let i = 0; i < 100; i++) {
            registry.register(`sig-${i % 3}`, '<LineStyle/>');
        }
        expect(registry.size).toBe(3);
    });

    it('produces ids usable as KML references', () => {
        const registry = new StyleRegistry();
        expect(registry.register('x', '<LineStyle/>')).toMatch(/^s_[0-9a-f]{8}$/);
    });

    it('serializes to an empty string when nothing is registered', () => {
        expect(new StyleRegistry().toXml()).toBe('');
    });
});

describe('buildPlacemark', () => {
    it('returns null without geometry', () => {
        expect(buildPlacemark({ name: 'X' })).toBeNull();
        expect(buildPlacemark()).toBeNull();
    });

    it('assembles name, style reference and geometry', () => {
        const xml = buildPlacemark({ name: 'Alvo', styleId: 's_1234abcd', geometry: POINT });
        expect(xml).toContain('<name>Alvo</name>');
        expect(xml).toContain('<styleUrl>#s_1234abcd</styleUrl>');
        expect(xml).toContain(POINT);
    });

    it('escapes special characters in the name', () => {
        const xml = buildPlacemark({ name: 'A & B <c>', geometry: POINT });
        expect(xml).toContain('<name>A &amp; B &lt;c&gt;</name>');
    });

    it('marks hidden features', () => {
        expect(buildPlacemark({ geometry: POINT, visible: false })).toContain('<visibility>0</visibility>');
        expect(buildPlacemark({ geometry: POINT, visible: true })).not.toContain('<visibility>');
    });

    it('omits optional blocks cleanly', () => {
        const xml = buildPlacemark({ geometry: POINT });
        expect(xml).toBe(`<Placemark>${POINT}</Placemark>`);
    });
});

describe('buildGroundOverlay', () => {
    const box = { north: 1, south: 0, east: 1, west: 0, rotation: 0 };

    it('builds an overlay with a LatLonBox', () => {
        const xml = buildGroundOverlay({ name: 'Foto', href: 'files/a.png', box });
        expect(xml).toContain('<href>files/a.png</href>');
        expect(xml).toContain('<north>1</north>');
        expect(xml).toContain('<rotation>0</rotation>');
    });

    it('returns null for unusable input', () => {
        expect(buildGroundOverlay({ href: 'a.png' })).toBeNull();
        expect(buildGroundOverlay({ box })).toBeNull();
        expect(buildGroundOverlay({ href: 'a.png', box: { ...box, north: NaN } })).toBeNull();
        expect(buildGroundOverlay()).toBeNull();
    });

    it('defaults a non-finite rotation to zero', () => {
        const xml = buildGroundOverlay({ href: 'a.png', box: { ...box, rotation: NaN } });
        expect(xml).toContain('<rotation>0</rotation>');
    });

    it('escapes the href', () => {
        const xml = buildGroundOverlay({ href: 'files/a&b.png', box });
        expect(xml).toContain('a&amp;b.png');
    });
});

describe('buildFolder', () => {
    const placemark = buildPlacemark({ geometry: POINT });

    it('returns null when it would be empty', () => {
        expect(buildFolder({ name: 'Camada', children: [] })).toBeNull();
        expect(buildFolder({ name: 'Camada', children: [null, undefined] })).toBeNull();
        expect(buildFolder()).toBeNull();
    });

    it('wraps children and records visibility', () => {
        const xml = buildFolder({ name: 'Camada 1', children: [placemark], visible: false });
        expect(xml).toContain('<name>Camada 1</name>');
        expect(xml).toContain('<visibility>0</visibility>');
        expect(xml).toContain(placemark);
    });

    it('escapes the folder name', () => {
        expect(buildFolder({ name: 'A & B', children: [placemark] }))
            .toContain('<name>A &amp; B</name>');
    });

    it('drops falsy children but keeps the rest', () => {
        const xml = buildFolder({ name: 'C', children: [null, placemark, undefined, placemark] });
        expect(xml.match(/<Placemark>/g)).toHaveLength(2);
    });
});

describe('buildKmlDocument', () => {
    const styles = new StyleRegistry();
    styles.register('sig', '<LineStyle><width>2</width></LineStyle>');
    const folder = buildFolder({ name: 'Camada', children: [buildPlacemark({ geometry: POINT })] });

    it('produces a well-formed envelope', () => {
        const xml = buildKmlDocument({ name: 'Mapa', styles, folders: [folder] });
        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
        expect(xml).toContain('xmlns="http://www.opengis.net/kml/2.2"');
        expect(xml.endsWith('</kml>')).toBe(true);
    });

    it('balances its container tags', () => {
        const xml = buildKmlDocument({ name: 'Mapa', styles, folders: [folder, folder] });
        for (const tag of ['Document', 'Folder', 'Placemark', 'Style']) {
            const open = xml.match(new RegExp(`<${tag}[ >]`, 'g')) || [];
            const close = xml.match(new RegExp(`</${tag}>`, 'g')) || [];
            expect(open.length).toBe(close.length);
        }
    });

    it('hoists styles above the folders', () => {
        const xml = buildKmlDocument({ name: 'Mapa', styles, folders: [folder] });
        expect(xml.indexOf('<Style ')).toBeLessThan(xml.indexOf('<Folder>'));
    });

    it('escapes the map name', () => {
        expect(buildKmlDocument({ name: 'Mapa "A" & <B>', styles, folders: [] }))
            .toContain('<name>Mapa &quot;A&quot; &amp; &lt;B&gt;</name>');
    });

    it('works with no styles and no folders', () => {
        const xml = buildKmlDocument({ name: 'Vazio' });
        expect(xml).toContain('<name>Vazio</name>');
        expect(xml).toContain('</Document>');
    });

    it('drops falsy folders', () => {
        const xml = buildKmlDocument({ name: 'M', styles, folders: [null, folder, undefined] });
        expect(xml.match(/<Folder>/g)).toHaveLength(1);
    });
});
