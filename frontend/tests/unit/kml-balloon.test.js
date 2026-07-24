// Path: tests/unit/kml-balloon.test.js

import { describe, it, expect } from 'vitest';
import {
    escapeXml,
    makeCdataSafe,
    wrapCdata,
    parseDataUrl,
    extensionForMime,
    sanitizePathSegment,
    buildExtendedData,
    buildDescription,
} from '@js/import_export/kmz/kml-balloon.js';

describe('escapeXml', () => {
    it('escapes the five XML entities', () => {
        expect(escapeXml('a & b')).toBe('a &amp; b');
        expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
        expect(escapeXml('say "hi"')).toBe('say &quot;hi&quot;');
        expect(escapeXml("it's")).toBe('it&apos;s');
    });

    it('escapes ampersands before other entities (no double-escaping)', () => {
        expect(escapeXml('&lt;')).toBe('&amp;lt;');
    });

    it('neutralizes injected markup', () => {
        expect(escapeXml('<img src=x onerror=alert(1)>'))
            .toBe('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('preserves accented Portuguese text', () => {
        expect(escapeXml('Posição de Observação')).toBe('Posição de Observação');
    });

    it('handles null, undefined and non-strings', () => {
        expect(escapeXml(null)).toBe('');
        expect(escapeXml(undefined)).toBe('');
        expect(escapeXml(42)).toBe('42');
        expect(escapeXml(false)).toBe('false');
    });
});

describe('makeCdataSafe', () => {
    it('splits a premature CDATA terminator', () => {
        const out = makeCdataSafe('before ]]> after');
        expect(out).toBe('before ]]]]><![CDATA[> after');
    });

    it('leaves ordinary text untouched', () => {
        expect(makeCdataSafe('nothing special')).toBe('nothing special');
    });

    it('handles repeated terminators', () => {
        const out = makeCdataSafe(']]>]]>');
        expect(out.split(']]]]><![CDATA[>')).toHaveLength(3);
    });

    it('handles non-string input', () => {
        expect(makeCdataSafe(null)).toBe('');
        expect(makeCdataSafe(undefined)).toBe('');
    });
});

describe('wrapCdata', () => {
    it('produces a section whose only terminator is the real one', () => {
        const wrapped = wrapCdata('evil ]]> payload');
        expect(wrapped.startsWith('<![CDATA[')).toBe(true);
        expect(wrapped.endsWith(']]>')).toBe(true);
        // Every internal ']]>' must be immediately followed by a reopening tag.
        const body = wrapped.slice('<![CDATA['.length, -']]>'.length);
        const stray = body.split(']]>').slice(0, -1)
            .filter((_, i, arr) => i < arr.length);
        stray.forEach(() => { /* presence is fine as long as reopened */ });
        expect(body).not.toMatch(/\]\]>(?!<!\[CDATA\[)/);
    });
});

describe('parseDataUrl', () => {
    it('parses a jpeg data URL', () => {
        const parsed = parseDataUrl('data:image/jpeg;base64,AAAA');
        expect(parsed).toEqual({ mime: 'image/jpeg', base64: 'AAAA', extension: 'jpg' });
    });

    it('parses a png data URL with extra parameters', () => {
        const parsed = parseDataUrl('data:image/png;charset=utf-8;base64,BBBB');
        expect(parsed.mime).toBe('image/png');
        expect(parsed.extension).toBe('png');
    });

    it('rejects URLs without a base64 payload', () => {
        expect(parseDataUrl('data:image/png,notbase64')).toBeNull();
        expect(parseDataUrl('data:image/png;base64,')).toBeNull();
        expect(parseDataUrl('https://example.com/a.png')).toBeNull();
    });

    it('handles non-string input', () => {
        expect(parseDataUrl(null)).toBeNull();
        expect(parseDataUrl(undefined)).toBeNull();
        expect(parseDataUrl(123)).toBeNull();
    });

    it('falls back to a generic extension for unknown types', () => {
        expect(parseDataUrl('data:application/octet-stream;base64,CCCC').extension).toBe('bin');
    });
});

describe('extensionForMime', () => {
    it('maps the common image types', () => {
        expect(extensionForMime('image/jpeg')).toBe('jpg');
        expect(extensionForMime('image/png')).toBe('png');
        expect(extensionForMime('image/webp')).toBe('webp');
        expect(extensionForMime('image/svg+xml')).toBe('svg');
        expect(extensionForMime('nonsense')).toBe('bin');
    });
});

describe('sanitizePathSegment', () => {
    it('blocks path traversal', () => {
        const out = sanitizePathSegment('../../etc/passwd');
        expect(out).not.toContain('/');
        expect(out).not.toContain('..');
    });

    it('replaces spaces and accents', () => {
        expect(sanitizePathSegment('Posição 1')).toBe('Posi__o_1');
    });

    it('keeps safe characters intact', () => {
        expect(sanitizePathSegment('abc-123_x.png')).toBe('abc-123_x.png');
    });

    it('falls back for empty or unusable input', () => {
        expect(sanitizePathSegment('')).toBe('item');
        expect(sanitizePathSegment(null)).toBe('item');
        expect(sanitizePathSegment('...')).toBe('item');
        expect(sanitizePathSegment('', 'foto')).toBe('foto');
    });

    it('bounds the length', () => {
        expect(sanitizePathSegment('a'.repeat(500)).length).toBeLessThanOrEqual(64);
    });
});

describe('buildExtendedData', () => {
    it('records name, description and custom attributes', () => {
        const xml = buildExtendedData({
            nome: 'Alvo',
            descricao: 'Ponto de interesse',
            attributes: { unidade: '1o BIS', prioridade: 'alta' },
        });
        expect(xml).toContain('<Data name="nome"><value>Alvo</value></Data>');
        expect(xml).toContain('<Data name="unidade"><value>1o BIS</value></Data>');
        expect(xml).toContain('prioridade');
    });

    it('returns an empty string when there is nothing to record', () => {
        expect(buildExtendedData({})).toBe('');
        expect(buildExtendedData({ attributes: {} })).toBe('');
    });

    it('skips empty attribute values', () => {
        const xml = buildExtendedData({ attributes: { a: '', b: null, c: 'ok' } });
        expect(xml).toContain('name="c"');
        expect(xml).not.toContain('name="a"');
        expect(xml).not.toContain('name="b"');
    });

    it('escapes attribute keys and values', () => {
        const xml = buildExtendedData({ attributes: { '<k>': '"v" & more' } });
        expect(xml).toContain('name="&lt;k&gt;"');
        expect(xml).toContain('&quot;v&quot; &amp; more');
        expect(xml).not.toContain('<k>');
    });

    it('appends caller-supplied extras', () => {
        const xml = buildExtendedData({ nome: 'X' }, { lineStyle: 'dashed' });
        expect(xml).toContain('<Data name="lineStyle"><value>dashed</value></Data>');
    });

    it('preserves the number zero as a value', () => {
        const xml = buildExtendedData({ attributes: { contagem: 0 } });
        expect(xml).toContain('<value>0</value>');
    });
});

describe('buildDescription', () => {
    it('returns an empty string when the feature has no content', () => {
        expect(buildDescription({ properties: {} })).toBe('');
        expect(buildDescription()).toBe('');
    });

    it('renders name, description and an attribute table', () => {
        const xml = buildDescription({
            properties: {
                nome: 'Alvo',
                descricao: 'linha 1\nlinha 2',
                attributes: { unidade: '1o BIS' },
            },
        });
        expect(xml).toContain('<h3>Alvo</h3>');
        expect(xml).toContain('linha 1<br/>linha 2');
        expect(xml).toContain('<table');
        expect(xml).toContain('unidade');
    });

    it('escapes injected markup in every field', () => {
        const xml = buildDescription({
            properties: {
                nome: '<script>alert(1)</script>',
                descricao: '<img src=x onerror=alert(2)>',
                attributes: { '<k>': '<v>' },
            },
        });
        expect(xml).not.toContain('<script>');
        expect(xml).not.toContain('onerror=alert(2)>');
        expect(xml).toContain('&lt;script&gt;');
    });

    it('cannot be broken out of via a CDATA terminator', () => {
        const xml = buildDescription({ properties: { nome: 'a ]]> b' } });
        // The escaped '>' means no raw terminator can survive, but assert the
        // structural invariant directly: exactly one closing sequence, at the end.
        const inner = xml.slice('<description><![CDATA['.length, -']]></description>'.length);
        expect(inner).not.toMatch(/\]\]>(?!<!\[CDATA\[)/);
    });

    it('omits the photo block when there are no photos', () => {
        const xml = buildDescription({ properties: { nome: 'X' }, photos: [] });
        expect(xml).not.toContain('<img');
    });

    it('embeds photos with relative hrefs', () => {
        const xml = buildDescription({
            properties: { nome: 'X' },
            photos: [{ href: 'files/fotos/a/b.jpg', name: 'Foto 1' }],
        });
        expect(xml).toContain('src="files/fotos/a/b.jpg"');
        expect(xml).toContain('Foto 1');
    });

    it('skips photo entries with no href', () => {
        const xml = buildDescription({
            properties: { nome: 'X' },
            photos: [{ name: 'sem href' }, null],
        });
        expect(xml).not.toContain('<img');
    });

    it('renders degradation notes', () => {
        const xml = buildDescription({
            properties: { nome: 'X' },
            notes: ['Hachura não suportada pelo KML'],
        });
        expect(xml).toContain('<li>Hachura não suportada pelo KML</li>');
    });
});
