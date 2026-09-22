// Path: tests/unit/glifos-tokens-literais.test.js

/**
 * @fileoverview The `glyphs` template that reaches MapLibre keeps `{fontstack}` and `{range}`
 * LITERAL, after every transformation the client applies, under a subpath deploy included.
 *
 * THE SYMPTOM (2026-09-22): the browser asks for the glyph TEMPLATE itself, 404
 * (`/ebgeo_novo/glyphs/%7Bfontstack%7D/%7Brange%7D.pbf` on the test stack, and the same request
 * with literal braces in production's access log, because an intermediate nginx decodes the URI).
 *
 * WHAT WAS MEASURED, in real Chromium driving the real MapLibre 6.9.1 and 6.7 (throwaway probe,
 * the same day): the browser's URL parser percent-encodes `{` and `}`, so ANY fetch of the
 * unsubstituted template goes out as `%7B...%7D`; and MapLibre itself never fetches it. With a
 * relative, root-relative or absolute `glyphs`, at boot, across a `setStyle` diff with
 * `transformStyle`, on a map built from `getStyle()`, from a URL style, and with the six real
 * basemap styles of `main`, every glyph request was the SUBSTITUTED range. So `%7B` is the wire
 * form of a template fetch, not evidence that the value was encoded before MapLibre.
 *
 * WHAT IS PINNED, so that the client can never be the one that issues it:
 *   1. the SHIPPED MapLibre, driven in node: `_loadGlyphRange` is extracted from
 *      `node_modules/maplibre-gl/dist/maplibre-gl.mjs` and run, and the URL it hands to
 *      `transformRequest` is asserted, under `/ebgeo_novo/`. It substitutes by TEXT and before
 *      any resolution, so a literal template is always substituted and an encoded one never is.
 *      An upgrade that changes that path reddens here before anyone ships it;
 *   2. the defensive restore (`baselayers/glyphs-template.js`) at the two points a basemap style
 *      is handed to MapLibre (`resolveBasemapStyle`, the `transformStyle` hook), plus the 360
 *      mini-map: harmless when the value is literal, which is what the test server serves;
 *   3. a CENSUS over `src/js/` and the HTML pages: only the leaf reads a style's `glyphs`, and a
 *      `{fontstack}` template appears only as a `glyphs:` declaration. A new absolutizer
 *      (`new URL(style.glyphs, ...)`), a `fetch` of the template or a preload of it reddens here.
 *
 * NEGATIVE CONTROLS (what reddens when each piece goes back to the obvious):
 *   - `resolveBasemapStyle` returning `published` raw: the published-style case;
 *   - `mergeApplicationStyle` spreading `next` raw: the two hook cases;
 *   - `literalGlyphTokens` matching `%7B` case-sensitively: the lower-case case.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { literalGlyphTokens, withLiteralGlyphTokens } from '../../src/js/baselayers/glyphs-template.js';
import { resolveBasemapStyle } from '../../src/js/baselayers/basemap-style.js';
import { mergeApplicationStyle, collectStyleIds } from '../../src/js/baselayers/style-transform.js';
import { estiloDoMiniMapa } from '../../src/js/street_view_tool/mini-mapa-base.js';

const BASE_NOVO = 'https://ebgeo.example/ebgeo_novo/';
const TEMPLATE_RELATIVO = './glyphs/{fontstack}/{range}.pbf';
// The value the test stack served, produced by the same parser that produced it there.
const TEMPLATE_CODIFICADO = new URL(TEMPLATE_RELATIVO, BASE_NOVO).href;

/** What MapLibre does to the template before asking for a range (`_loadGlyphRange`). */
const substituir = (t) => t.replace('{fontstack}', 'Noto Sans Regular').replace('{range}', '0-255');

const estilo = (glyphs, extra = {}) => ({
    version: 8,
    glyphs,
    sources: { base: { type: 'raster', tiles: ['https://t/{z}/{x}/{y}.png'] } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
    ...extra,
});

/** @param {*} glyphs @returns {boolean} */
function literal(glyphs) {
    return typeof glyphs === 'string' && glyphs.includes('{fontstack}') && glyphs.includes('{range}')
        && !/%7B|%7D/i.test(glyphs);
}

/**
 * The shipped `GlyphManager._loadGlyphRange`, cut out of the MapLibre bundle Vite resolves and
 * made runnable with its two helpers stubbed. Returns the URL it hands to `transformRequest`.
 *
 * The minified helper names change between builds, so they are READ from the body (the
 * `getArrayBuffer` call and the PBF parser), never hardcoded.
 * @returns {(url: string, stack: string, range: number) => Promise<string>}
 */
function carregarLoadGlyphRangeReal() {
    const raiz = fileURLToPath(new URL('../../', import.meta.url));
    const pacote = JSON.parse(readFileSync(path.join(raiz, 'node_modules/maplibre-gl/package.json'), 'utf8'));
    const bundle = readFileSync(path.join(raiz, 'node_modules/maplibre-gl', pacote.exports['.'].import), 'utf8');

    const inicio = bundle.indexOf('async _loadGlyphRange(');
    if (inicio === -1) throw new Error('_loadGlyphRange not found in the shipped MapLibre bundle');
    const abre = bundle.indexOf('{', inicio);
    const params = bundle.slice(bundle.indexOf('(', inicio) + 1, bundle.indexOf(')', inicio));
    let fundo = 0;
    let fim = abre;
    for (; fim < bundle.length; fim++) {
        if (bundle[fim] === '{') fundo++;
        else if (bundle[fim] === '}' && --fundo === 0) break;
    }
    const corpo = bundle.slice(abre + 1, fim);
    const buscar = /await ([\w$]+)\([\w$]+,new AbortController\)/.exec(corpo)?.[1];
    const analisar = /of ([\w$]+)\([\w$]+\.data\)/.exec(corpo)?.[1];
    if (!buscar || !analisar) throw new Error(`unexpected _loadGlyphRange shape: ${corpo.slice(0, 200)}`);

    // eslint-disable-next-line no-new-func
    const fabricar = new Function(buscar, analisar, `return async function(${params}){${corpo}};`);
    const fn = fabricar(async () => ({ data: new ArrayBuffer(0) }), () => []);
    return async (url, stack, range) => {
        let pedido = null;
        const self = { url, requestManager: { transformRequest: (u) => { pedido = u; return { url: u }; } } };
        await fn.call(self, stack, range);
        return pedido;
    };
}

describe('o MapLibre que o build entrega, dirigido em node', () => {
    const loadGlyphRange = carregarLoadGlyphRangeReal();

    it('o `glyphs` do estilo chega ao GlyphManager sem transformação', () => {
        const raiz = fileURLToPath(new URL('../../', import.meta.url));
        const bundle = readFileSync(path.join(raiz, 'node_modules/maplibre-gl/dist/maplibre-gl.mjs'), 'utf8');
        expect(bundle).toMatch(/setURL\(([\w$]+)\)\{this\.url=\1\}/);
        expect(bundle).toMatch(/this\.glyphManager\.setURL\([\w$]+\.glyphs\)/);
    });

    it('as três formas literais pedem a FAIXA, e sob /ebgeo_novo/ nenhuma leva %7B', async () => {
        for (const glyphs of [TEMPLATE_RELATIVO, '/ebgeo_novo/glyphs/{fontstack}/{range}.pbf',
            'https://ebgeo.example/ebgeo_novo/glyphs/{fontstack}/{range}.pbf']) {
            const pedido = await loadGlyphRange(glyphs, 'Noto Sans Condensed', 32);
            expect(pedido).toMatch(/\/glyphs\/Noto Sans Condensed\/8192-8447\.pbf$/);
            // O fio: o que o navegador manda, resolvido contra a página do deploy em subcaminho.
            expect(new URL(pedido, BASE_NOVO).pathname).toBe('/ebgeo_novo/glyphs/Noto%20Sans%20Condensed/8192-8447.pbf');
        }
    });

    it('CONTROLE: o modelo codificado não é substituído, e é esse o pedido que dá 404', async () => {
        const pedido = await loadGlyphRange(TEMPLATE_CODIFICADO, 'Noto Sans Regular', 0);
        expect(pedido).toBe(TEMPLATE_CODIFICADO);
        // A restauração devolve ao MapLibre algo que ele substitui.
        expect(await loadGlyphRange(literalGlyphTokens(TEMPLATE_CODIFICADO), 'Noto Sans Regular', 0))
            .toBe('https://ebgeo.example/ebgeo_novo/glyphs/Noto Sans Regular/0-255.pbf');
    });
});

describe('o mecanismo, com o parser de URL de verdade', () => {
    it('resolver o modelo contra a base codifica as chaves, e a substituição do MapLibre não faz nada', () => {
        expect(TEMPLATE_CODIFICADO).toBe('https://ebgeo.example/ebgeo_novo/glyphs/%7Bfontstack%7D/%7Brange%7D.pbf');
        // O pedido que dá 404: o MODELO, e não uma faixa de glifos.
        expect(substituir(TEMPLATE_CODIFICADO)).toBe(TEMPLATE_CODIFICADO);
    });

    it('o modelo restaurado substitui, e o relativo cai na pasta certa sob /ebgeo_novo/', () => {
        const restaurado = literalGlyphTokens(TEMPLATE_CODIFICADO);
        expect(restaurado).toBe('https://ebgeo.example/ebgeo_novo/glyphs/{fontstack}/{range}.pbf');
        expect(substituir(restaurado)).toBe('https://ebgeo.example/ebgeo_novo/glyphs/Noto Sans Regular/0-255.pbf');

        // O relativo NÃO é tocado, e é o navegador quem o resolve, na thread principal.
        expect(literalGlyphTokens(TEMPLATE_RELATIVO)).toBe(TEMPLATE_RELATIVO);
        expect(new URL(substituir(TEMPLATE_RELATIVO), BASE_NOVO).pathname)
            .toBe('/ebgeo_novo/glyphs/Noto%20Sans%20Regular/0-255.pbf');
    });

    it('bordas: caixa baixa, codificação parcial, e o que não é modelo', () => {
        expect(literalGlyphTokens('/g/%7bfontstack%7d/%7BRANGE%7D.pbf')).toBe('/g/{fontstack}/{range}.pbf');
        expect(literalGlyphTokens('/g/{fontstack%7D/%7Brange}.pbf')).toBe('/g/{fontstack}/{range}.pbf');
        // Outro %7B do endereço, que não é chave do modelo, fica como está.
        expect(literalGlyphTokens('/g/%7Bx%7D/{fontstack}/{range}.pbf')).toBe('/g/%7Bx%7D/{fontstack}/{range}.pbf');
        for (const cru of [undefined, null, 42, '', 'https://h/font/{fontstack}/{range}.pbf']) {
            expect(literalGlyphTokens(cru)).toBe(cru);
        }
        const url = 'https://h/estilo.json';
        expect(withLiteralGlyphTokens(url)).toBe(url);
        expect(withLiteralGlyphTokens(null)).toBeNull();
        const semGlifos = { version: 8, sources: {}, layers: [] };
        expect(withLiteralGlyphTokens(semGlifos)).toBe(semGlifos);
    });
});

describe('os pontos em que um estilo de mapa base é entregue ao MapLibre', () => {
    it('resolveBasemapStyle: o publicado sai com o modelo literal, e o config compartilhado não muda', () => {
        const publicado = estilo(TEMPLATE_CODIFICADO, { name: 'topo-publicada' });
        const publicados = { topo: publicado };
        const r = resolveBasemapStyle('topo', {}, publicados);
        expect(literal(r.glyphs)).toBe(true);
        expect(r.name).toBe('topo-publicada');
        expect(r.layers).toBe(publicado.layers);
        expect(publicados.topo).toBe(publicado);
        expect(publicado.glyphs).toBe(TEMPLATE_CODIFICADO);
    });

    it('resolveBasemapStyle: o embutido de reserva também, e o estilo sadio volta por IDENTIDADE', () => {
        const embutidoRuim = estilo(TEMPLATE_CODIFICADO);
        expect(literal(resolveBasemapStyle('osm', { osm: embutidoRuim }, {}).glyphs)).toBe(true);

        const sadio = estilo(TEMPLATE_RELATIVO);
        expect(resolveBasemapStyle('osm', { osm: sadio }, {})).toBe(sadio);
        expect(resolveBasemapStyle('osm', {}, { osm: sadio })).toBe(sadio);
    });

    it('mergeApplicationStyle: o gancho transformStyle entrega o modelo literal, com e sem estilo anterior', () => {
        const anterior = estilo(TEMPLATE_RELATIVO, {
            sources: { base: { type: 'raster', tiles: ['a'] }, pontos: { type: 'geojson', data: {} } },
            layers: [{ id: 'base', type: 'raster', source: 'base' }, { id: 'pontos', type: 'circle', source: 'pontos' }],
        });
        // O documento de um estilo por URL, que só chega aqui depois do fetch do MapLibre.
        const proximo = estilo(TEMPLATE_CODIFICADO, {
            sources: { orto: { type: 'raster', tiles: ['b'] } },
            layers: [{ id: 'orto', type: 'raster', source: 'orto' }],
        });
        const merged = mergeApplicationStyle(anterior, proximo, collectStyleIds(estilo(TEMPLATE_RELATIVO)));
        expect(literal(merged.glyphs)).toBe(true);
        expect(merged.layers.map((l) => l.id)).toEqual(['orto', 'pontos']);
        expect(proximo.glyphs).toBe(TEMPLATE_CODIFICADO);

        expect(literal(mergeApplicationStyle(null, proximo, undefined).glyphs)).toBe(true);
        const sadio = estilo(TEMPLATE_RELATIVO);
        expect(mergeApplicationStyle(null, sadio, undefined)).toBe(sadio);
    });

    it('o mini-mapa do 360 recebe o modelo literal do mapa base do catálogo', () => {
        const config = {
            map2d: { minZoom: 2, maxZoom: 21 },
            basemaps: { topo: { name: 'Topo', enabled: true, priority: 1, minzoom: 2, maxzoom: 19 } },
            basemapStyles: { topo: estilo(TEMPLATE_CODIFICADO) },
            streetView360: { miniMapBasemap: 'topo' },
        };
        const local = { version: 8, sources: {}, layers: [] };
        const r = estiloDoMiniMapa(config, local);
        expect(r).not.toBe(local);
        expect(literal(r.glyphs)).toBe(true);
        expect(substituir(r.glyphs)).toBe('https://ebgeo.example/ebgeo_novo/glyphs/Noto Sans Regular/0-255.pbf');
    });
});

describe('censo: quem toca no modelo de glifos no código do cliente', () => {
    const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
    const JS = path.join(RAIZ, 'src/js');
    const FOLHA = 'baselayers/glyphs-template.js';

    function listar(dir) {
        return readdirSync(dir).flatMap((nome) => {
            const p = path.join(dir, nome);
            if (statSync(p).isDirectory()) return listar(p);
            return nome.endsWith('.js') ? [p] : [];
        });
    }
    const semComentarios = (t) => t
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    const arquivos = listar(JS).map((p) => ({
        rel: path.relative(JS, p).split(path.sep).join('/'),
        codigo: semComentarios(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')),
    }));

    it('só a folha lê o `glyphs` de um estilo', () => {
        expect(arquivos.length).toBeGreaterThan(300);
        const LEITURA = /\.glyphs\b|\[\s*['"`]glyphs['"`]\s*\]/;
        const leitores = arquivos.filter((a) => LEITURA.test(a.codigo)).map((a) => a.rel);
        expect(leitores).toEqual([FOLHA]);
    });

    it('um modelo `{fontstack}` só aparece como declaração `glyphs:`, nunca num fetch, link ou URL', () => {
        const DECLARACAO = /^\s*["']?glyphs["']?\s*:\s*(["'`])[^"'`]*\{fontstack\}[^"'`]*\{range\}[^"'`]*\1,?\s*$/;
        const declaracoes = [];
        const fora = [];
        for (const a of arquivos) {
            // A folha é o lugar sancionado: o padrão dela nomeia a chave para restaurá-la.
            if (a.rel === FOLHA) continue;
            a.codigo.split('\n').forEach((linha, i) => {
                if (!linha.includes('fontstack')) return;
                (DECLARACAO.test(linha) ? declaracoes : fora).push(`${a.rel}:${i + 1}: ${linha.trim()}`);
            });
        }
        // Os quatro embutidos de `baselayers/` e o estilo local do mini-mapa: cobertura vazia
        // passaria verde.
        expect(declaracoes.length).toBeGreaterThanOrEqual(5);
        expect(fora).toEqual([]);
    });

    it('nenhuma página HTML cita o modelo (um preload dele pediria o próprio modelo)', () => {
        const paginas = readdirSync(RAIZ).filter((f) => f.endsWith('.html'));
        expect(paginas).toContain('index.html');
        const citam = paginas.filter((f) => readFileSync(path.join(RAIZ, f), 'utf8').includes('fontstack'));
        expect(citam).toEqual([]);
    });
});
