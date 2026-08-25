// Path: tests/unit/pdf-mosaico-grade-cartografica.test.js

/**
 * @fileoverview Pins the two MOSAIC drawers of
 * `js/import_export/pdf-cartographic-elements.js` - `drawMosaicGridLines` and
 * `drawMosaicTileBorder` - by driving them with a SPY 2D context and an injected
 * projection. Both take every pixel they touch through `ctx`, so they are pure
 * enough to run in node: nothing here needs a real canvas.
 *
 * This is the only way to reach the private helpers the backlog wants extracted
 * (`_formatDMS`, `_getGridSpacing`, `_utmZone`, `_formatUTMValue`,
 * `_findEdgeIntersection`, `_clipSegment`) without touching `src/`.
 *
 * WHAT THIS SUITE PINS
 * - the four early-return gates (no bounds, no projection, neither grid, no band);
 * - the STRICT `<` UTM cutoff at `UTM_MAX_SCALE_DENOM` (2.500.000 is excluded);
 * - `uiScale = dpi / 200` as it reaches the font size and the label offset;
 * - the DMS label text produced for a known bounds/scale pair, including the
 *   three branches of `_formatDMS` (degree only / degree+minute / +second) and
 *   the hemisphere of a NEGATIVE ZERO degree value;
 * - the contract that `drawMosaicGridLines` draws every label OUTSIDE the tile
 *   rect (that is how the labelled drawers are reused for seam-continuous lines);
 * - the perimeter contract of `drawMosaicTileBorder`: only requested sides get a
 *   white band, a neat-line and labels, so internal seams stay continuous;
 * - the label stacking when both grid families are on (UTM close, lat/long out);
 * - seam alignment: two adjoining tiles produce exactly the gridlines that a
 *   single tile spanning both would, because the intervals are absolute.
 *
 * WHAT IT DOES NOT REACH
 * - `composeLayout` and every `_draw*` of the single-sheet path: they build a real
 *   `document.createElement('canvas')` and measure text.
 * - `_drawScaleBar` / `_formatBarLabel` / `_formatScaleText`, reachable only from
 *   `composeLayout`. `parseScaleDenom`, which feeds them, is covered separately in
 *   `tests/unit/pdf-export-constantes.test.js`.
 * - Pixel appearance. The spy records geometry and text, not rendering.
 */

import { describe, it, expect } from 'vitest';
import {
    drawMosaicGridLines,
    drawMosaicTileBorder,
} from '../../src/js/import_export/pdf-cartographic-elements.js';
import { UTM_MAX_SCALE_DENOM } from '../../src/js/import_export/pdf-export.constants.js';

// ============================================================================
// Spy context
// ============================================================================

/**
 * Minimal 2D-context spy. It tracks the translation stack so a rotated label
 * (drawn as `fillText(text, 0, 0)` after `translate`) is recorded at its real
 * canvas position; rotation itself does not move the anchor, so it is ignored.
 */
function makeCtx() {
    const calls = [];
    let tx = 0;
    let ty = 0;
    const stack = [];
    return {
        calls,
        fillStyle: '', strokeStyle: '', font: '', lineWidth: 0,
        textAlign: '', textBaseline: '',
        save() { stack.push([tx, ty]); },
        restore() { const s = stack.pop(); if (s) { tx = s[0]; ty = s[1]; } },
        translate(x, y) { tx += x; ty += y; },
        rotate(r) { calls.push({ op: 'rotate', r }); },
        setLineDash(d) { calls.push({ op: 'setLineDash', d }); },
        beginPath() { calls.push({ op: 'beginPath' }); },
        moveTo(x, y) { calls.push({ op: 'moveTo', x, y }); },
        lineTo(x, y) { calls.push({ op: 'lineTo', x, y }); },
        stroke() { calls.push({ op: 'stroke' }); },
        strokeRect(x, y, w, h) { calls.push({ op: 'strokeRect', x, y, w, h }); },
        fillRect(x, y, w, h) { calls.push({ op: 'fillRect', x, y, w, h }); },
        fillText(text, x, y) {
            calls.push({ op: 'fillText', text, x: tx + x, y: ty + y, font: this.font });
        },
        measureText(t) { return { width: String(t).length * 6 }; },
    };
}

const texts = (ctx) => ctx.calls.filter((c) => c.op === 'fillText');
const labelSet = (ctx) => [...new Set(texts(ctx).map((c) => c.text))];

/** Plain equirectangular projection from bounds to a w x h pixel rect. */
const proj = (b, w, h) => ([lng, lat]) => ({
    x: ((lng - b.west) / (b.east - b.west)) * w,
    y: ((b.north - lat) / (b.north - b.south)) * h,
});

/** A 0.02 x 0.02 degree tile over Rio; at 1:25.000 the interval is 0.01 deg. */
const RIO = { west: -43.205, east: -43.185, south: -22.905, north: -22.885 };

const gridArgs = (b, over = {}) => ({
    mapBounds: b,
    mapW: 800,
    mapH: 800,
    projectionFn: proj(b, 800, 800),
    scale: '1:25000',
    showLatLong: true,
    showUTM: false,
    dpi: 200,
    ...over,
});

const borderArgs = (b, over = {}) => ({
    mapBounds: b,
    pageWpx: 800,
    pageHpx: 800,
    bands: { left: true, right: true, top: true, bottom: true },
    bandPx: 40,
    projectionFn: proj(b, 800, 800),
    scale: '1:25000',
    showLatLong: true,
    showUTM: false,
    dpi: 200,
    ...over,
});

// ============================================================================
// Gates
// ============================================================================

describe('drawMosaicGridLines - portoes de saida antecipada', () => {
    it('nenhuma grade pedida: o contexto nao e tocado', () => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(RIO, { showLatLong: false, showUTM: false }));
        expect(ctx.calls).toHaveLength(0);
    });

    it('sem mapBounds: o contexto nao e tocado', () => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(RIO, { mapBounds: null }));
        expect(ctx.calls).toHaveLength(0);
    });

    it('sem projectionFn: o contexto nao e tocado', () => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(RIO, { projectionFn: null }));
        expect(ctx.calls).toHaveLength(0);
    });

    it('CONTROLE: com os tres presentes, ele desenha', () => {
        // Without this the three assertions above would pass on a function that
        // never draws anything at all.
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(RIO));
        expect(ctx.calls.length).toBeGreaterThan(0);
        expect(texts(ctx).length).toBeGreaterThan(0);
    });
});

describe('drawMosaicTileBorder - portoes de saida antecipada', () => {
    it('nenhuma borda de perimetro: nada e desenhado', () => {
        const ctx = makeCtx();
        drawMosaicTileBorder(ctx, borderArgs(RIO, {
            bands: { left: false, right: false, top: false, bottom: false },
        }));
        expect(ctx.calls).toHaveLength(0);
    });

    it('nenhuma grade pedida: nem a faixa branca sai', () => {
        const ctx = makeCtx();
        drawMosaicTileBorder(ctx, borderArgs(RIO, { showLatLong: false, showUTM: false }));
        expect(ctx.calls).toHaveLength(0);
    });

    it('CONTROLE: com uma banda e uma grade, ele desenha faixa e rotulo', () => {
        const ctx = makeCtx();
        drawMosaicTileBorder(ctx, borderArgs(RIO, {
            bands: { left: false, right: false, top: true, bottom: false },
        }));
        expect(ctx.calls.filter((c) => c.op === 'fillRect')).toHaveLength(1);
        expect(texts(ctx).length).toBeGreaterThan(0);
    });
});

// ============================================================================
// UTM cutoff (strict <)
// ============================================================================

describe('corte de escala do UTM', () => {
    // 3 x 2 degrees, wide enough for 50 km eastings to exist inside it.
    const WIDE = { west: -44.0, east: -41.0, south: -23.5, north: -21.5 };

    it('a constante compartilhada continua sendo 2.500.000', () => {
        expect(UTM_MAX_SCALE_DENOM).toBe(2500000);
    });

    it('escala EXATAMENTE no limite nao desenha UTM (comparacao estrita)', () => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(WIDE, {
            scale: `1:${UTM_MAX_SCALE_DENOM}`, showLatLong: false, showUTM: true,
        }));
        expect(ctx.calls).toHaveLength(0);
    });

    it('CONTROLE: uma escala abaixo do limite desenha eastings em metros', () => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(WIDE, {
            scale: '1:1000000', showLatLong: false, showUTM: true,
        }));
        const found = labelSet(ctx);
        expect(found.length).toBeGreaterThan(0);
        for (const t of found) expect(t).toMatch(/^(\d+ m [EN]|Fuso \d+)$/);
        expect(found).toContain('700000 m E');
        expect(found).toContain('7600000 m N');
    });

    it('_utmZone: um tile que cruza a fronteira de fuso rotula os DOIS fusos', () => {
        // -44 deg is in zone 23 and -41 deg is in zone 24; the drawer loops from
        // westZone to eastZone, so both zone captions must appear.
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(WIDE, {
            scale: '1:1000000', showLatLong: false, showUTM: true,
        }));
        const zones = labelSet(ctx).filter((t) => t.startsWith('Fuso '));
        expect(zones.sort()).toEqual(['Fuso 23', 'Fuso 24']);
    });

    it('_utmZone: um tile dentro de UM fuso nao rotula fuso nenhum', () => {
        // The caption only exists to name the two sides of a boundary, so a tile
        // that never crosses one draws none. CONTROLE: it still draws eastings.
        const inside = { west: -43.5, east: -43.0, south: -23.0, north: -22.5 };
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(inside, {
            scale: '1:100000', showLatLong: false, showUTM: true,
            projectionFn: proj(inside, 800, 800),
        }));
        const found = labelSet(ctx);
        expect(found.length).toBeGreaterThan(0);
        expect(found.filter((t) => t.startsWith('Fuso '))).toHaveLength(0);
    });

    it('os dois rotulos de fuso ficam um de cada lado do meridiano limite', () => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(WIDE, {
            scale: '1:1000000', showLatLong: false, showUTM: true,
        }));
        const z23 = texts(ctx).filter((c) => c.text === 'Fuso 23');
        const z24 = texts(ctx).filter((c) => c.text === 'Fuso 24');
        // One pair on the top edge and one on the bottom edge.
        expect(z23).toHaveLength(2);
        expect(z24).toHaveLength(2);
        for (let i = 0; i < 2; i++) expect(z23[i].x).toBeLessThan(z24[i].x);
    });

    it('o corte vale so para o UTM: lat/long continua desenhando na mesma escala', () => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(WIDE, {
            scale: `1:${UTM_MAX_SCALE_DENOM}`, showLatLong: true, showUTM: true,
        }));
        const found = labelSet(ctx);
        expect(found.length).toBeGreaterThan(0);
        // Nothing in metres: every label is a DMS one.
        for (const t of found) expect(t).not.toMatch(/ m [EN]$/);
    });
});

// ============================================================================
// Grid spacing table and its fallback
// ============================================================================

describe('_getGridSpacing atraves dos rotulos', () => {
    const at = (scale) => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(RIO, { scale }));
        return labelSet(ctx);
    };

    it('1:25.000 usa intervalo de 0,01 grau (dois meridianos no tile de 0,02 grau)', () => {
        expect(at('1:25000')).toEqual(["22°54'S", "22°53'24\"S", "43°12'W", "43°11'24\"W"]);
    });

    it('escala mais fechada adensa a grade; escala mais aberta a rareia', () => {
        const dense = at('1:5000');   // 0,002 grau
        const sparse = at('1:100000'); // 0,05 grau
        expect(dense.length).toBeGreaterThan(4);
        expect(sparse.length).toBeLessThan(4);
    });

    it('denominador FORA da tabela cai no padrao de 1:25.000', () => {
        expect(at('1:33000')).toEqual(at('1:25000'));
    });

    it('scale ausente equivale a 1:25.000 (o `scale || "1:25000"` do drawer)', () => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(RIO, { scale: undefined }));
        expect(labelSet(ctx)).toEqual(at('1:25000'));
    });

    it('OBSERVADO: "1:25.000" em pt-BR vira 25 e cai no MESMO padrao, por acaso', () => {
        // parseScaleDenom stops at the dot and returns 25; 25 is not in the table,
        // so the fallback happens to restore the 1:25.000 spacing. The grid is
        // right for the wrong reason - the scale BAR is not (see the constants suite).
        expect(at('1:25.000')).toEqual(at('1:25000'));
    });

    it('OBSERVADO: string sem ":" e "1:0" tambem caem no padrao, sem avisar', () => {
        expect(at('sem-doispontos')).toEqual(at('1:25000'));
        expect(at('1:0')).toEqual(at('1:25000'));
    });
});

// ============================================================================
// _formatDMS through the labels
// ============================================================================

describe('rotulos DMS', () => {
    it('grau inteiro imprime so o grau, e fracao de minuto imprime minuto', () => {
        // 1:500.000 has a 0,25 deg interval, so every line is a whole quarter degree.
        const b = { west: -44.2, east: -42.8, south: -23.2, north: -21.8 };
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(b, {
            scale: '1:500000', mapW: 600, mapH: 600, projectionFn: proj(b, 600, 600),
        }));
        const found = labelSet(ctx);
        expect(found).toContain('23°S');      // degree only: minute and second are 0
        expect(found).toContain('44°W');
        expect(found).toContain("22°45'S");   // degree + minute, no seconds
        expect(found).toContain("43°45'W");
    });

    it('sobra de segundo imprime a terceira parte', () => {
        const b = { west: -59.96, east: -59.93, south: -1.02, north: -0.99 };
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(b, {
            scale: '1:10000', mapW: 600, mapH: 600, projectionFn: proj(b, 600, 600),
        }));
        const found = labelSet(ctx);
        expect(found).toContain("0°59'42\"S");
        expect(found).toContain("59°57'36\"W");
    });

    it('hemisferio: latitude negativa e S, longitude negativa e W', () => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(RIO));
        const found = labelSet(ctx);
        expect(found.filter((t) => t.endsWith('S'))).toHaveLength(2);
        expect(found.filter((t) => t.endsWith('W'))).toHaveLength(2);
    });

    it('o valor ZERO (que a grade produz como -0) sai como "0°N", nao "0°S"', () => {
        // `Math.ceil(-0.005 / 0.01) * 0.01` is -0, and `-0 >= 0` is true, so the
        // hemisphere is N. Pinning it because a rewrite using `value > 0` would
        // silently flip the equator label.
        const b = { west: 0.001, east: 0.02, south: -0.005, north: 0.005 };
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(b, { projectionFn: proj(b, 600, 600), mapW: 600, mapH: 600 }));
        expect(labelSet(ctx)).toContain('0°N');
    });

    it('CONSERTADO: nenhum rotulo imprime 60 segundos, numa escala corrente', () => {
        // 1:250.000 has a 0,1 deg interval (6 minutes exactly), so EVERY label must
        // end in whole minutes. Before the seconds carry, ten of these twelve came
        // out as 43°11'60"W and the like: `Math.round` on the seconds remainder can
        // land on exactly 60, and -43.3 (like the accumulated -43.199999999999996)
        // is not representable, so `(43.3 - 43) * 60` is 17.99999999999983.
        const b = { west: -43.5, east: -42.9, south: -22.5, north: -21.9 };
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(b, {
            scale: '1:250000', mapW: 600, mapH: 600, projectionFn: proj(b, 600, 600),
        }));
        const found = labelSet(ctx);
        expect(found).toHaveLength(12);
        expect(found.filter((t) => t.includes('60"'))).toEqual([]);
        expect(found).toEqual([
            "22°30'S", "22°24'S", "22°18'S", "22°12'S", "22°6'S", '22°S',
            "43°30'W", "43°24'W", "43°18'W", "43°12'W", "43°6'W", '43°W',
        ]);
    });

    it('CONTROLE: o carry sobe o GRAU quando os minutos tambem estouram', () => {
        // -22.0 arrives as -21.999999999999996 through the accumulation, which is
        // deg 21, min 59, sec 60. Two carries are needed, not one: without the
        // second the label would read 21°60'S. Absolute assertion, because
        // comparing the two families against each other would pass with both wrong.
        const b = { west: -43.5, east: -42.9, south: -22.5, north: -21.9 };
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(b, {
            scale: '1:250000', mapW: 600, mapH: 600, projectionFn: proj(b, 600, 600),
        }));
        const found = labelSet(ctx);
        expect(found).toContain('22°S');
        expect(found).not.toContain("21°60'S");
        expect(found).not.toContain("21°59'60\"S");
    });

    it('CONSERTADO (segunda forma): a escala 1:5.000 tambem sai sem 60 segundos', () => {
        const b = { west: -59.9556, east: -59.9445, south: -1.005, north: -0.995 };
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(b, {
            scale: '1:5000', mapW: 600, mapH: 600, projectionFn: proj(b, 600, 600),
        }));
        const found = labelSet(ctx);
        expect(found).not.toContain('59°56\'60"W');
        expect(found).toContain("59°57'W");
        // Neighbours on the same gridline family were always fine, which is what
        // localised the defect to the rounding carry rather than the whole formatter.
        expect(found).toContain('59°57\'7"W');
        expect(found).toContain('59°56\'53"W');
    });
});

// ============================================================================
// uiScale = dpi / 200
// ============================================================================

describe('uiScale deriva do DPI', () => {
    const fontAt = (dpi) => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(RIO, { dpi }));
        const t = texts(ctx);
        expect(t.length).toBeGreaterThan(0);
        return t[0].font;
    };

    it('a fonte da grade e round(13 * dpi/200) px', () => {
        expect(fontAt(150)).toMatch(/^10px /);
        expect(fontAt(200)).toMatch(/^13px /);
        expect(fontAt(300)).toMatch(/^20px /);
    });

    it('dpi ausente assume 300 (o padrao do parametro)', () => {
        const ctx = makeCtx();
        const { dpi, ...rest } = gridArgs(RIO);
        expect(dpi).toBe(200);
        drawMosaicGridLines(ctx, rest);
        expect(texts(ctx)[0].font).toMatch(/^20px /);
    });

    it('a fonte da BORDA e round(12 * dpi/200) px', () => {
        const at = (d) => {
            const ctx = makeCtx();
            drawMosaicTileBorder(ctx, borderArgs(RIO, { dpi: d }));
            const t = texts(ctx);
            expect(t.length).toBeGreaterThan(0);
            return t[0].font;
        };
        expect(at(150)).toMatch(/^9px /);
        expect(at(200)).toMatch(/^12px /);
        expect(at(300)).toMatch(/^18px /);
    });

    it('o afastamento do rotulo escala junto: 6*uiScale fora do quadro', () => {
        const yTop = (dpi) => {
            const ctx = makeCtx();
            drawMosaicGridLines(ctx, gridArgs(RIO, { dpi }));
            const top = texts(ctx).filter((c) => c.y < 0);
            expect(top.length).toBeGreaterThan(0);
            return top[0].y;
        };
        expect(yTop(200)).toBeCloseTo(-6, 9);
        expect(yTop(300)).toBeCloseTo(-9, 9);
        expect(yTop(150)).toBeCloseTo(-4.5, 9);
    });
});

// ============================================================================
// The "labels land off-canvas" contract of drawMosaicGridLines
// ============================================================================

describe('drawMosaicGridLines - o rotulo cai FORA do tile', () => {
    it('nenhum rotulo cai dentro do retangulo [0,mapW] x [0,mapH]', () => {
        // This is the documented reason the labelled drawers can be reused with
        // marginPx = 0: the line is clipped to the tile and every label overflows.
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(RIO, { showLatLong: true, showUTM: true }));
        const t = texts(ctx);
        expect(t.length).toBeGreaterThan(0);
        for (const c of t) {
            const inside = c.x >= 0 && c.x <= 800 && c.y >= 0 && c.y <= 800;
            expect(inside).toBe(false);
        }
    });

    it('cada linha rende dois rotulos: um antes de 0 e um depois do limite', () => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(RIO));
        const t = texts(ctx);
        expect(t).toHaveLength(8); // 2 parallels + 2 meridians, twice each
        expect(t.filter((c) => c.y < 0 || c.x < 0)).toHaveLength(4);
        expect(t.filter((c) => c.y > 800 || c.x > 800)).toHaveLength(4);
    });

    it('nenhuma faixa branca e desenhada: a costura interna fica continua', () => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(RIO, { showLatLong: true, showUTM: true }));
        expect(ctx.calls.filter((c) => c.op === 'fillRect')).toHaveLength(0);
    });
});

// ============================================================================
// drawMosaicTileBorder - perimeter only
// ============================================================================

describe('drawMosaicTileBorder - so o perimetro ganha moldura', () => {
    it('uma faixa branca por lado pedido, com a geometria do lado', () => {
        const ctx = makeCtx();
        drawMosaicTileBorder(ctx, borderArgs(RIO, {
            bands: { left: true, right: false, top: true, bottom: false },
        }));
        const rects = ctx.calls.filter((c) => c.op === 'fillRect');
        expect(rects).toHaveLength(2);
        expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 800, h: 40 }); // top
        expect(rects[1]).toMatchObject({ x: 0, y: 0, w: 40, h: 800 }); // left
    });

    it('os quatro lados pedidos dao quatro faixas', () => {
        const ctx = makeCtx();
        drawMosaicTileBorder(ctx, borderArgs(RIO));
        expect(ctx.calls.filter((c) => c.op === 'fillRect')).toHaveLength(4);
    });

    it('o rotulo do lado pedido cai DENTRO da faixa, nao fora do papel', () => {
        const ctx = makeCtx();
        drawMosaicTileBorder(ctx, borderArgs(RIO, {
            bands: { left: false, right: false, top: true, bottom: false },
        }));
        const t = texts(ctx);
        expect(t).toHaveLength(2); // the two meridians crossing the top edge
        for (const c of t) {
            expect(c.y).toBeGreaterThan(0);
            expect(c.y).toBeLessThan(40); // inside the 40 px band
        }
    });

    it('lado NAO pedido nao recebe rotulo algum (costura continua)', () => {
        const only = (side) => {
            const ctx = makeCtx();
            drawMosaicTileBorder(ctx, borderArgs(RIO, {
                bands: { left: false, right: false, top: false, bottom: false, [side]: true },
            }));
            return texts(ctx);
        };
        expect(only('top')).toHaveLength(2);
        expect(only('bottom')).toHaveLength(2);
        expect(only('left')).toHaveLength(2);
        expect(only('right')).toHaveLength(2);
        // All four sides together: exactly the sum, no side stealing another's.
        const ctx = makeCtx();
        drawMosaicTileBorder(ctx, borderArgs(RIO));
        expect(texts(ctx)).toHaveLength(8);
    });

    it('a linha de moldura acompanha a borda interna dos lados pedidos', () => {
        const ctx = makeCtx();
        drawMosaicTileBorder(ctx, borderArgs(RIO, {
            bands: { left: false, right: false, top: true, bottom: false },
        }));
        const moves = ctx.calls.filter((c) => c.op === 'moveTo');
        const lines = ctx.calls.filter((c) => c.op === 'lineTo');
        expect(moves).toHaveLength(1);
        expect(lines).toHaveLength(1);
        // Only `top` is banded, so the inner rect keeps the other three at the page edge.
        expect(moves[0]).toMatchObject({ x: 0, y: 40 });
        expect(lines[0]).toMatchObject({ x: 800, y: 40 });
    });

    it('com as duas grades, o UTM fica colado no quadro e o lat/long mais afastado', () => {
        const ctx = makeCtx();
        drawMosaicTileBorder(ctx, borderArgs(RIO, { showUTM: true, showLatLong: true }));
        const t = texts(ctx);
        expect(t.length).toBeGreaterThan(0);
        const utm = t.filter((c) => / m [EN]$/.test(c.text));
        const dms = t.filter((c) => !/ m [EN]$/.test(c.text));
        expect(utm.length).toBeGreaterThan(0);
        expect(dms.length).toBeGreaterThan(0);
        // Top band: UTM at inner.top - 6, lat/long at inner.top - (6 + 12 + 4).
        // Filter by the band itself (y inside the 40 px strip), not by an arbitrary
        // cut-off: the LEFT band labels also carry small x but arbitrary y.
        const inTopBand = (c) => c.y >= 0 && c.y <= 40 && c.x > 40;
        const utmTop = utm.filter(inTopBand).map((c) => c.y);
        const dmsTop = dms.filter(inTopBand).map((c) => c.y);
        expect(utmTop.length).toBeGreaterThan(0);
        expect(dmsTop.length).toBeGreaterThan(0);
        expect(Math.max(...dmsTop)).toBeLessThan(Math.min(...utmTop));
        expect(Math.min(...utmTop)).toBeCloseTo(34, 9);
        expect(Math.min(...dmsTop)).toBeCloseTo(18, 9);
    });

    it('com UMA grade so, o lat/long volta para junto do quadro', () => {
        const ctx = makeCtx();
        drawMosaicTileBorder(ctx, borderArgs(RIO, { showUTM: false, showLatLong: true }));
        const top = texts(ctx).filter((c) => c.y >= 0 && c.y <= 40 && c.x > 40);
        expect(top.length).toBeGreaterThan(0);
        expect(top[0].y).toBeCloseTo(34, 9);
    });
});

// ============================================================================
// Seam alignment across neighbouring tiles
// ============================================================================

describe('alinhamento entre tiles vizinhos', () => {
    const meridians = (b) => {
        const ctx = makeCtx();
        drawMosaicGridLines(ctx, gridArgs(b, { projectionFn: proj(b, 800, 800) }));
        return labelSet(ctx).filter((t) => /[EW]$/.test(t));
    };

    it('dois tiles adjacentes reproduzem exatamente os meridianos do tile inteiro', () => {
        // The intervals are absolute multiples, never relative to the tile, which
        // is what makes the printed lines meet at the seam.
        const whole = { west: -43.205, east: -43.185, south: -22.905, north: -22.885 };
        const left = { ...whole, east: -43.195 };
        const right = { ...whole, west: -43.195 };

        const wholeSet = meridians(whole);
        const leftSet = meridians(left);
        const rightSet = meridians(right);

        expect(wholeSet).toHaveLength(2);
        expect(leftSet).toHaveLength(1);
        expect(rightSet).toHaveLength(1);
        expect([...leftSet, ...rightSet].sort()).toEqual([...wholeSet].sort());
        // No duplicated line at the seam.
        expect(leftSet.filter((t) => rightSet.includes(t))).toHaveLength(0);
    });

    it('mover a janela do tile nao muda o ROTULO da linha que ela contem', () => {
        const a = meridians({ west: -43.2049, east: -43.1951, south: -22.905, north: -22.885 });
        const b = meridians({ west: -43.2031, east: -43.1969, south: -22.895, north: -22.891 });
        expect(a).toEqual(["43°12'W"]);
        expect(b).toEqual(["43°12'W"]);
    });
});
