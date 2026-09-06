// Path: tests/unit/icon-selection-box.test.js

/**
 * @fileoverview The dashed selection box of the icon-backed tools (image,
 * military symbol, coordination measure, declination diagram), and the cache
 * that decides when it has to be rebuilt.
 *
 * WHY THE BOX MOVED. Until 2026-09-06 each of those tools derived its box from
 * the stored `width`/`height` multiplied by an empirical factor — 0.5 in some
 * tools, 0.625 in others — that stood in for the image's `pixelRatio`, and then
 * took the AXIS-ALIGNED bounds of the rotated rectangle. The factors disagreed
 * with each other and the bounds ignored the rotation, so the frame could sit
 * visibly off the picture. `createRenderedIconSelectionBox` builds it from the
 * rectangle MapLibre actually drew instead (`renderedIconQuad`), adds the
 * padding in SCREEN pixels and unprojects the four corners, so what is pinned
 * here is: the box is the picture plus the padding, rotation included.
 *
 * The box is geometry in DEGREES and therefore view-dependent, which is the
 * other half of this file: `SelectionHighlightManager.getCacheKey` has to carry
 * the bearing and the pitch for those tools, and the manager has to listen to
 * `rotate` and `pitch`, or a turn would leave a box built for another view on
 * screen.
 *
 * Node env, no DOM and no MapLibre: the map is a double whose projection is a
 * plain 1000x scale, so every expected corner below is arithmetic done by hand.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@store', () => ({
    getStateManager: () => ({ getUnsafe: () => undefined }),
}));

import {
    ICON_SELECTION_BOX_PADDING_PX,
    createRenderedIconSelectionBox,
} from '../../src/js/tool_manager/helpers/icon-selection-box.helpers.js';
import { SelectionHighlightManager } from '@tools/managers/selection-highlight.manager.js';

/** A 200x100 bitmap at pixelRatio 2, i.e. 100x50 CSS pixels. */
const IMAGE = { data: { width: 200, height: 100 }, pixelRatio: 2 };

/**
 * Map double with a 1000x scale projection: `[10, 20]` is the screen point
 * (10000, 20000) and back. Flat and unpitched, so the perspective ratio is 1.
 * @returns {Object} The double
 */
function montarMapa() {
    return {
        getZoom: () => 12,
        getPitch: () => 0,
        getTerrain: () => null,
        getImage: vi.fn(() => IMAGE),
        project: vi.fn(([lng, lat]) => ({ x: lng * 1000, y: lat * 1000 })),
        unproject: vi.fn(([x, y]) => ({ lng: x / 1000, lat: y / 1000 })),
    };
}

/**
 * An icon-backed feature drawn at `icon-size` 1: zoom correction OFF pins the
 * size to `size`, so the rectangle is the bitmap's own CSS size.
 * @param {Object} [options] - Feature parts
 * @param {Array<number>} [options.coordinates] - `[lng, lat]`
 * @param {Object} [options.properties] - Extra properties
 * @returns {Object} GeoJSON feature
 */
function montarFeicao({ coordinates = [10, 20], properties = {} } = {}) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: { id: 'img1', size: 1, zoomCorrectionEnabled: false, ...properties },
    };
}

describe('createRenderedIconSelectionBox', () => {
    it('unprojects the padded rectangle into a closed 5-position ring', () => {
        // Anchor [10, 20] is the screen point (10000, 20000); the picture is
        // 100x50 CSS px centred there and the padding is 5 px on every side, so
        // the corners are x in {9945, 10055} and y in {19970, 20030}, which the
        // 1000x projection reads back as lng in {9.945, 10.055} and lat in
        // {19.97, 20.03}.
        const box = createRenderedIconSelectionBox(montarMapa(), montarFeicao(), 'image-layer');

        expect(box.type).toBe('Polygon');
        expect(box.coordinates).toHaveLength(1);

        const ring = box.coordinates[0];
        expect(ring).toHaveLength(5);
        expect(ring[0][0]).toBeCloseTo(9.945, 10);
        expect(ring[0][1]).toBeCloseTo(19.97, 10);
        expect(ring[1][0]).toBeCloseTo(10.055, 10);
        expect(ring[1][1]).toBeCloseTo(19.97, 10);
        expect(ring[2][0]).toBeCloseTo(10.055, 10);
        expect(ring[2][1]).toBeCloseTo(20.03, 10);
        expect(ring[3][0]).toBeCloseTo(9.945, 10);
        expect(ring[3][1]).toBeCloseTo(20.03, 10);
        expect(ring[4]).toEqual(ring[0]);
    });

    it('pads by ICON_SELECTION_BOX_PADDING_PX by default and by nothing at paddingPx 0', () => {
        expect(ICON_SELECTION_BOX_PADDING_PX).toBe(5);

        const padrao = createRenderedIconSelectionBox(montarMapa(), montarFeicao(), 'image-layer');
        const explicito = createRenderedIconSelectionBox(
            montarMapa(), montarFeicao(), 'image-layer', ICON_SELECTION_BOX_PADDING_PX,
        );
        expect(padrao).toEqual(explicito);

        // Without the frame the box IS the picture: half-width 50, half-height 25.
        const colado = createRenderedIconSelectionBox(montarMapa(), montarFeicao(), 'image-layer', 0);
        expect(colado.coordinates[0][0][0]).toBeCloseTo(9.95, 10);
        expect(colado.coordinates[0][0][1]).toBeCloseTo(19.975, 10);
        expect(colado.coordinates[0][2][0]).toBeCloseTo(10.05, 10);
        expect(colado.coordinates[0][2][1]).toBeCloseTo(20.025, 10);
    });

    it('follows the icon-offset of a coordination measure, so the frame stays on the drawing', () => {
        // The bitmap is cropped to the drawing and the nucleus anchors its
        // ELLIPSE centre, not the bitmap centre, so the layer shifts the icon by
        // `iconOffset` (icon px) and the frame has to shift with it. At
        // icon-size 1 that is 12.5 screen px down, i.e. 0.0125 degrees here:
        // the box keeps its 110x60 px size and its top edge moves from
        // 19.97 to 19.9825.
        const box = createRenderedIconSelectionBox(
            montarMapa(),
            montarFeicao({ properties: { iconOffset: [0, 12.5] } }),
            'coordination-measures-layer',
        );

        const ring = box.coordinates[0];
        expect(ring[0][0]).toBeCloseTo(9.945, 10);
        expect(ring[0][1]).toBeCloseTo(19.9825, 10);
        expect(ring[2][0]).toBeCloseTo(10.055, 10);
        expect(ring[2][1]).toBeCloseTo(20.0425, 10);
    });

    it('turns the ring with the picture instead of boxing it in', () => {
        // The old axis-aligned expansion produced a ring with only two distinct
        // longitudes and two latitudes whatever the rotation; a rotated
        // rectangle has four of each, and still sits on the anchor.
        const box = createRenderedIconSelectionBox(
            montarMapa(),
            montarFeicao({ properties: { rotation: 45 } }),
            'image-layer',
        );

        const cantos = box.coordinates[0].slice(0, 4);
        expect(new Set(cantos.map(([lng]) => lng)).size).toBe(4);
        expect(new Set(cantos.map(([, lat]) => lat)).size).toBe(4);

        const centroLng = cantos.reduce((soma, [lng]) => soma + lng, 0) / 4;
        const centroLat = cantos.reduce((soma, [, lat]) => soma + lat, 0) / 4;
        expect(centroLng).toBeCloseTo(10, 9);
        expect(centroLat).toBeCloseTo(20, 9);
    });

    it('boxes the position the feature has NOW, not the one it was created at', () => {
        const mapa = montarMapa();
        const box = createRenderedIconSelectionBox(
            mapa, montarFeicao({ coordinates: [-45.5, -23.5] }), 'image-layer',
        );

        expect(mapa.project).toHaveBeenCalledWith([-45.5, -23.5]);
        for (const [lng, lat] of box.coordinates[0]) {
            expect(lng).toBeCloseTo(-45.5, 0);
            expect(lat).toBeCloseTo(-23.5, 0);
        }
        expect(box.coordinates[0][0][0]).toBeCloseTo(-45.555, 10);
        expect(box.coordinates[0][0][1]).toBeCloseTo(-23.53, 10);
    });

    it('returns null whenever the drawn rectangle cannot be rebuilt', () => {
        const semUnproject = montarMapa();
        delete semUnproject.unproject;
        expect(createRenderedIconSelectionBox(semUnproject, montarFeicao(), 'image-layer')).toBeNull();
        expect(createRenderedIconSelectionBox(null, montarFeicao(), 'image-layer')).toBeNull();

        // The style has not loaded the icon's bitmap yet.
        const semImagem = montarMapa();
        semImagem.getImage = vi.fn(() => undefined);
        expect(createRenderedIconSelectionBox(semImagem, montarFeicao(), 'image-layer')).toBeNull();

        // No geometry at all, and a geometry with no coordinates array.
        expect(createRenderedIconSelectionBox(montarMapa(), { properties: {} }, 'image-layer')).toBeNull();
        expect(createRenderedIconSelectionBox(
            montarMapa(), { geometry: { type: 'Point' }, properties: {} }, 'image-layer',
        )).toBeNull();

        // A layer with no size rule cannot be rebuilt either (`point-marker-layer`
        // HAS one since the markers joined `EXACT_ICON_LAYER_IDS`; `text-layer`
        // still answers from its collision box and has none).
        expect(createRenderedIconSelectionBox(
            montarMapa(), montarFeicao(), 'text-layer',
        )).toBeNull();
    });

    it('returns null rather than a NaN ring when unproject cannot answer', () => {
        const mapa = montarMapa();
        mapa.unproject = vi.fn(() => ({ lng: NaN, lat: 20 }));
        expect(createRenderedIconSelectionBox(mapa, montarFeicao(), 'image-layer')).toBeNull();

        const semRetorno = montarMapa();
        semRetorno.unproject = vi.fn(() => undefined);
        expect(createRenderedIconSelectionBox(semRetorno, montarFeicao(), 'image-layer')).toBeNull();
    });
});

/**
 * Map double for the cache key: only what the manager reads. The listener map
 * is exposed so the subscriptions can be asserted.
 * @param {Object} [options] - Double configuration
 * @param {number} [options.zoom] - Map zoom
 * @param {number} [options.bearing] - Map bearing
 * @param {number} [options.pitch] - Map pitch
 * @param {boolean} [options.semAngulos] - Omit `getBearing`/`getPitch` entirely
 * @returns {Object} The double
 */
function montarMapaDeCache({ zoom = 6.2, bearing = 0, pitch = 0, semAngulos = false } = {}) {
    const ouvintes = new Map();
    const mapa = {
        zoom,
        bearing,
        pitch,
        ouvintes,
        on(tipo, cb) {
            if (!ouvintes.has(tipo)) ouvintes.set(tipo, []);
            ouvintes.get(tipo).push(cb);
        },
        off(tipo, cb) {
            const lista = ouvintes.get(tipo) || [];
            const i = lista.indexOf(cb);
            if (i >= 0) lista.splice(i, 1);
        },
        getZoom() { return this.zoom; },
        getSource: () => null,
    };
    if (!semAngulos) {
        mapa.getBearing = () => mapa.bearing;
        mapa.getPitch = () => mapa.pitch;
    }
    return mapa;
}

/** Selection manager double: the manager only asks these two things of it. */
const gerenteDeSelecao = { hasSelectedFeatures: () => false, controls: new Map() };

/**
 * A control that answers one selection-box strategy.
 * @param {string} strategy - `'bbox'` or `'viewport'`
 * @returns {Object} Control double
 */
function montarControle(strategy) {
    return { getSelectionBoxStrategy: () => strategy, createSelectionBox: () => null };
}

/**
 * A selected feature as the manager sees it.
 * @param {Object} [properties] - Extra properties
 * @returns {Object} GeoJSON feature
 */
function feicaoSelecionada(properties = {}) {
    return { properties: { id: 'f1', source: 'image', ...properties } };
}

describe('SelectionHighlightManager.getCacheKey', () => {
    it('keys a bbox tool on the feature and the half-level zoom only', () => {
        const mapa = montarMapaDeCache({ zoom: 6.2, bearing: 45, pitch: 30 });
        const gerente = new SelectionHighlightManager(mapa, gerenteDeSelecao);

        // A box in degrees scales with the map, so a turn or a tilt leaves it
        // right: the key must not carry either.
        expect(gerente.getCacheKey(feicaoSelecionada(), montarControle('bbox'))).toBe('f1-6');
        expect(gerente.getCacheKey(feicaoSelecionada(), undefined)).toBe('f1-6');

        gerente.destroy();
    });

    it('keys a viewport tool on the bearing and the pitch too', () => {
        const mapa = montarMapaDeCache({ zoom: 6.2, bearing: 45, pitch: 30 });
        const gerente = new SelectionHighlightManager(mapa, gerenteDeSelecao);
        const controle = montarControle('viewport');

        expect(gerente.getCacheKey(feicaoSelecionada(), controle)).toBe('f1-6-b45.0-p30.0');

        mapa.bearing = 90;
        expect(gerente.getCacheKey(feicaoSelecionada(), controle)).toBe('f1-6-b90.0-p30.0');

        mapa.pitch = 0;
        expect(gerente.getCacheKey(feicaoSelecionada(), controle)).toBe('f1-6-b90.0-p0.0');

        gerente.destroy();
    });

    it('reads a missing getBearing / getPitch as zero instead of undefined', () => {
        const mapa = montarMapaDeCache({ zoom: 6.2, semAngulos: true });
        const gerente = new SelectionHighlightManager(mapa, gerenteDeSelecao);

        expect(gerente.getCacheKey(feicaoSelecionada(), montarControle('viewport')))
            .toBe('f1-6-b0.0-p0.0');

        gerente.destroy();
    });

    it('quantizes the zoom to half a level while the zoom correction is on', () => {
        const mapa = montarMapaDeCache({ zoom: 6.2 });
        const gerente = new SelectionHighlightManager(mapa, gerenteDeSelecao);
        const controle = montarControle('viewport');

        const em62 = gerente.getCacheKey(feicaoSelecionada(), controle);
        mapa.zoom = 6.24;
        expect(gerente.getCacheKey(feicaoSelecionada(), controle)).toBe(em62);

        // The band boundary still separates two keys.
        mapa.zoom = 6.3;
        expect(gerente.getCacheKey(feicaoSelecionada(), controle)).not.toBe(em62);

        gerente.destroy();
    });

    it('uses the exact zoom when the feature keeps its screen size across zooms', () => {
        // Zoom correction OFF means the picture does NOT scale with the map, so
        // its box in degrees is only right at the zoom it was built for: half a
        // level of slack would leave the frame visibly off the picture.
        const mapa = montarMapaDeCache({ zoom: 6.2 });
        const gerente = new SelectionHighlightManager(mapa, gerenteDeSelecao);
        const controle = montarControle('viewport');
        const feicao = feicaoSelecionada({ zoomCorrectionEnabled: false });

        expect(gerente.getCacheKey(feicao, controle)).toBe('f1-6.20-b0.0-p0.0');
        mapa.zoom = 6.24;
        expect(gerente.getCacheKey(feicao, controle)).toBe('f1-6.24-b0.0-p0.0');

        // A bbox tool ignores the flag: its box is in degrees either way.
        mapa.zoom = 6.2;
        expect(gerente.getCacheKey(feicao, montarControle('bbox'))).toBe('f1-6');

        gerente.destroy();
    });
});

describe('SelectionHighlightManager view subscriptions', () => {
    it('listens to zoom, rotate and pitch, and drops all three on destroy', () => {
        const mapa = montarMapaDeCache();
        const gerente = new SelectionHighlightManager(mapa, gerenteDeSelecao);

        expect([...mapa.ouvintes.keys()].sort()).toEqual(['pitch', 'rotate', 'zoom']);
        for (const tipo of ['zoom', 'rotate', 'pitch']) {
            expect(mapa.ouvintes.get(tipo)).toEqual([gerente._handleZoomChange]);
        }

        gerente.destroy();

        for (const tipo of ['zoom', 'rotate', 'pitch']) {
            expect(mapa.ouvintes.get(tipo)).toEqual([]);
        }
    });
});
describe('SelectionHighlightManager cache eviction', () => {
    /**
     * A control whose box depends on nothing: what is under test is how many
     * entries the cache keeps, not what is in them.
     * @returns {Object} Control double
     */
    function montarControleDeCaixa() {
        return {
            getSelectionBoxStrategy: () => 'viewport',
            createSelectionBox: () => ({
                type: 'Polygon',
                coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            }),
        };
    }

    /**
     * @param {string} id - Feature id
     * @returns {Object} A viewport-strategy feature the manager can hash
     */
    function feicaoDeIcone(id) {
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [10, 20] },
            properties: { id, source: 'image', zoomCorrectionEnabled: false },
        };
    }

    it('keeps exactly one cached box per feature across a rotate gesture', () => {
        // The `'viewport'` key carries the bearing to a tenth of a degree, so a turn
        // mints a key per frame. Without eviction the Map would hold all forty of them
        // for the rest of the session.
        const mapa = montarMapaDeCache({ zoom: 6.2 });
        const gerente = new SelectionHighlightManager(mapa, gerenteDeSelecao);
        const controle = montarControleDeCaixa();
        const feicao = feicaoDeIcone('f1');

        const QUADROS = 40;
        for (let quadro = 0; quadro < QUADROS; quadro++) {
            mapa.bearing = quadro * 0.7;
            mapa.zoom = 6.2 + quadro * 0.01;
            expect(gerente._createSelectionBoxesWithCache([feicao], controle)).toHaveLength(1);
        }

        // Forty distinct keys were minted, and one survives: the current view's.
        expect(gerente.selectionBoxCache.size).toBe(1);
        expect(gerente.selectionBoxCache.has(gerente.getCacheKey(feicao, controle))).toBe(true);

        gerente.destroy();
    });

    it('evicts only the feature that missed, and still hits the cache when the view holds still', () => {
        const mapa = montarMapaDeCache({ zoom: 6.2 });
        const gerente = new SelectionHighlightManager(mapa, gerenteDeSelecao);
        const controle = montarControleDeCaixa();
        const feicoes = [feicaoDeIcone('f1'), feicaoDeIcone('f2')];

        for (let quadro = 0; quadro < 10; quadro++) {
            mapa.bearing = quadro;
            gerente._createSelectionBoxesWithCache(feicoes, controle);
        }

        // One entry per SELECTED feature, not one per feature per frame: the eviction
        // is by feature id, never a `clear()`.
        expect(gerente.selectionBoxCache.size).toBe(2);

        // And a frame that did not move the view is still a HIT: the same box object
        // comes back, which is what the identity guard of `updateSelectionHighlight`
        // rides on.
        const primeira = gerente._createSelectionBoxesWithCache(feicoes, controle);
        const segunda = gerente._createSelectionBoxesWithCache(feicoes, controle);
        expect(segunda[0]).toBe(primeira[0]);
        expect(segunda[1]).toBe(primeira[1]);
        expect(gerente.selectionBoxCache.size).toBe(2);

        gerente.destroy();
    });
});
