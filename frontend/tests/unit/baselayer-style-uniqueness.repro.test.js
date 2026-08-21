import { describe, it, expect } from 'vitest';
import cartaTopografica from '../../src/js/baselayers/carta_topografica.js';
import cartaOrtoimagem from '../../src/js/baselayers/carta_ortoimagem.js';
import osmLayer from '../../src/js/baselayers/osm_layer.js';
import imagensLayer from '../../src/js/baselayers/imagens_layer.js';
import bdgexLayer from '../../src/js/baselayers/bdgex_layer.js';
import { resolveBasemapStyle } from '../../src/js/baselayers/basemap-style.js';
import { buildBasemapStyles } from '../../../backend/src/modules/config/config.static.js';

/**
 * Regression: the app hung on the loading screen forever when switching to a
 * base layer whose style is identical to the one already applied.
 *
 * Root cause: MapLibre's Style.setState() diffs the incoming style against the
 * current one and returns early when the diff yields zero operations, WITHOUT
 * firing 'styledata'. switchLayer() awaited that event, so the await rejected
 * on timeout, the rejection escaped the async map 'load' handler, and
 * hideLoadingScreen() never ran.
 *
 * The trigger is carta_topografica.js being a byte-for-byte copy of
 * osm_layer.js. The map always boots with carta_topografica (map_sig.js), so
 * any user whose persisted base layer was 'osm' hit the no-op diff on every
 * page load. switchLayer() no longer treats a missing 'styledata' as fatal.
 *
 * ---------------------------------------------------------------------------
 * THE SECOND HALF: THE STYLES ARE DEFINED TWICE, IN TWO PACKAGES.
 *
 * This file used to read the client modules only, and that made it half a
 * guard. The same five basemap styles exist a second time on the server, in
 * `backend/src/modules/config/config.static.js` (`buildBasemapStyles`), which
 * builds them from the deployment's ENV-injected tile and glyph URLs and ships
 * them to the browser as `config.basemapStyles`.
 *
 * The two copies are NOT interchangeable content — the client hardcodes public
 * URLs, the server injects whatever the deployment configured — so comparing
 * the style bodies would fail on a correct repository. What must agree is the
 * SET OF IDS and the SHAPE, and both consumers prove why:
 *
 *  - `base-layer.control.js` resolves built-in FIRST and only falls back to the
 *    published copy for an id it has no module for (`basemap-style.js`). So a
 *    server style with no static pair is the one path by which a server-built
 *    style reaches the main map, untested until now.
 *  - `calibration/project-map.js` does the opposite: it reads
 *    `config.basemapStyles.osm` VERBATIM, with no built-in fallback. The
 *    calibration page therefore draws the server's copy while the map draws the
 *    client's, and nothing compared them.
 *
 * Importing across the package boundary is the house pattern for this class of
 * guard: `frontend/tests/unit/sync-trace-espelha-backend.test.js` imports
 * `backend/src/utils/sync-trace.js` for exactly the same reason. It is safe
 * here because `config.static.js` is pure formatting with no imports of its own
 * — it does not drag the Postgres pool along, which is why the style builders
 * were put there instead of in `config.service.js`.
 */

/**
 * The client's built-in styles. Mirrors `STYLE_MAP` in `base-layer.control.js`,
 * which is module-private; keep the two in step when a module is added.
 */
const STYLES = {
    'carta-topografica': cartaTopografica,
    'carta-ortoimagem': cartaOrtoimagem,
    'osm': osmLayer,
    'imagens': imagensLayer,
    'bdgex': bdgexLayer
};

/**
 * Stand-in for `config.appConfig`. The real values are per-deployment, so the
 * test supplies its own: sentinels that are DISTINCT per key, so that any pair
 * of server styles that comes out identical is identical by construction (two
 * builders sharing a body) and never by two env keys happening to hold the same
 * URL in one deployment.
 */
const SENTINEL_CONFIG = {
    glyphsUrl: 'https://sentinel.invalid/glyphs/{fontstack}/{range}.pbf',
    osmTileUrl: 'https://sentinel.invalid/osm/{z}/{x}/{y}.png',
    bdgexWmsUrl: 'https://sentinel.invalid/bdgex?BBOX={bbox-epsg-3857}',
    imagensTileUrl: 'https://sentinel.invalid/imagens/{z}/{x}/{y}.png',
    ortoimagemTileUrl: 'https://sentinel.invalid/ortoimagem?BBOX={bbox-epsg-3857}'
};

const SERVED_STYLES = buildBasemapStyles(SENTINEL_CONFIG);

/**
 * Pairs that currently hold the same style. Two identical entries are a bug on
 * their own — they are indistinguishable on the map, so the picker offers a
 * choice that does nothing — but deciding which service "Topográfica" should
 * point at is a product call, not a code fix.
 *
 * THE DEBT IS SYMMETRIC, and that is why this is a tolerated set and no longer
 * the expected value of the assertion. `carta_topografica.js` is a copy of
 * `osm_layer.js` on the client, and `buildBasemapStyles` calls `osmStyle(C)`
 * twice on the server: both halves carry it. The previous form
 * (`expect(duplicates).toEqual(KNOWN_DUPLICATES)`) REQUIRED the duplicate, so
 * giving Topográfica its own service — the fix this comment asks for — would
 * have turned the guard red and read as a regression. A guard that punishes the
 * repair is a guard that keeps the debt.
 *
 * The cost of tolerating instead of requiring: once the debt is paid, this entry
 * goes stale silently rather than failing to remind anyone to delete it. That is
 * the cheaper failure. Anything NOT listed here is a new duplicate and fails, on
 * either side.
 */
const ACCEPTED_DUPLICATES = new Set(['carta-topografica === osm']);

/**
 * Every pair of ids in `styles` whose styles serialize identically.
 * Ids inside a pair are sorted so the label does not depend on insertion order,
 * which differs between the client map and the server builder.
 * @param {Object<string, Object|string>} styles
 * @returns {string[]} labels of the form 'a === b', sorted.
 */
function identicalPairs(styles) {
    const entries = Object.entries(styles);
    const pairs = [];

    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            const [idA, styleA] = entries[i];
            const [idB, styleB] = entries[j];
            if (JSON.stringify(styleA) === JSON.stringify(styleB)) {
                pairs.push([idA, idB].sort().join(' === '));
            }
        }
    }

    return pairs.sort();
}

/** Pairs that are duplicated and are NOT on the accepted list. */
const newDuplicates = (styles) => identicalPairs(styles).filter((p) => !ACCEPTED_DUPLICATES.has(p));

/**
 * Asserts a style is something MapLibre's setStyle() can actually load: either a
 * style URL, or an inline object with sources, layers and at least one tile URL.
 * Anything else (undefined, empty object) leaves the map blank and, before the
 * switchLayer() guard, hung the caller outright.
 * @param {string} id
 * @param {Object|string} style
 * @param {string} side - 'client' or 'server', for the failure message.
 */
function expectLoadable(id, style, side) {
    expect(style, `${side}: ${id} has no style`).toBeTruthy();

    if (typeof style === 'string') {
        expect(style, `${side}: ${id} is not a URL`).toMatch(/^https?:\/\//);
        return;
    }

    const sources = Object.values(style.sources ?? {});
    expect(sources.length, `${side}: ${id} has no sources`).toBeGreaterThan(0);
    expect(style.layers?.length, `${side}: ${id} has no layers`).toBeGreaterThan(0);

    const hasTiles = sources.some(
        (source) => Array.isArray(source.tiles) && source.tiles.length > 0
    );
    expect(hasTiles, `${side}: ${id} has no tile URL`).toBe(true);
}

describe('base layer styles', () => {
    // FLOOR. Without it, an import that resolved to an empty object (file moved,
    // export renamed) would report green comparing two empty sets — the empty
    // coverage every assertion below would otherwise hide.
    it('both copies were actually loaded (floor against an empty comparison)', () => {
        expect(Object.keys(STYLES).length).toBe(5);
        expect(Object.keys(SERVED_STYLES).length).toBeGreaterThan(0);
    });

    it('introduces no new pair of identical styles (client)', () => {
        expect(newDuplicates(STYLES)).toEqual([]);
    });

    it('introduces no new pair of identical styles (server)', () => {
        expect(newDuplicates(SERVED_STYLES)).toEqual([]);
    });

    // The debt is one debt, held in two places. Paying it on one side only leaves
    // the two halves disagreeing about whether Topográfica and OSM are the same
    // layer — and the calibration page reads the server's answer while the map
    // reads the client's.
    it('the duplicate debt is the same on both sides', () => {
        const client = identicalPairs(STYLES);
        const server = identicalPairs(SERVED_STYLES);
        expect(
            server,
            `client duplicates: [${client}]\nserver duplicates: [${server}]\n`
            + 'pay the debt on BOTH sides in the same commit, or on neither.'
        ).toEqual(client);
    });

    // THE ASSERTION WITH TEETH, and the one the file was missing. It catches both
    // directions of drift, and each direction is a real defect:
    //  - server id with no client module: the map silently renders the SERVER
    //    style for it (basemap-style.js falls back), so a layer nobody reviewed
    //    on this side ships to users;
    //  - client module the server does not serve: the calibration page, which has
    //    no built-in fallback, has nothing to draw for it.
    it('the server serves exactly the ids the client knows', () => {
        const client = Object.keys(STYLES).sort();
        const server = Object.keys(SERVED_STYLES).sort();

        const onlyServer = server.filter((id) => !client.includes(id));
        const onlyClient = client.filter((id) => !server.includes(id));

        expect(
            onlyServer,
            'served with no static pair in baselayers/ — the map would render the'
            + ` server's copy unreviewed: ${onlyServer.join(', ')}`
        ).toEqual([]);
        expect(
            onlyClient,
            'built into the client but never served — calibration has no fallback'
            + ` and draws nothing for: ${onlyClient.join(', ')}`
        ).toEqual([]);
        expect(server).toEqual(client);
    });

    it('gives every style something MapLibre can actually load', () => {
        for (const [id, style] of Object.entries(STYLES)) expectLoadable(id, style, 'client');
        for (const [id, style] of Object.entries(SERVED_STYLES)) expectLoadable(id, style, 'server');
    });

    // WHERE AN ADMIN-EDITED STYLE ACTUALLY LANDS. `config.service.js`
    // (listBasemapStyles) overlays any catalog row's `config.style` on top of the
    // static builders, for any id. This pins what that overlay does to the map,
    // because the answer is counter-intuitive and it is what makes the id-set
    // assertion above the load-bearing one: for the five built-in ids the overlay
    // is INERT on the map, so the only way a server style reaches it is an id the
    // client has no module for.
    it('an admin style overrides only the ids the client has no module for', () => {
        const admin = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] };
        const published = { ...SERVED_STYLES, osm: admin, 'bm-custom': admin };

        expect(resolveBasemapStyle('osm', STYLES, published)).toBe(STYLES.osm);
        expect(resolveBasemapStyle('bm-custom', STYLES, published)).toBe(admin);
    });
});
