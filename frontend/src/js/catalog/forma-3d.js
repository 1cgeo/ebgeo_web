// Path: js/catalog/forma-3d.js

/**
 * @fileoverview THE DECLARED AXIS OF 3D SHAPE, and the compat derivation that reads the two
 * improvised discriminators it replaces.
 *
 * WHAT THIS FILE EXISTS TO KILL. A `tilesets` row used to say what it was BY EXCLUSION, in two
 * unrelated places: `config.type === 'glb'` chose between the isolated-model loader and the
 * tileset loader (`3d_models_viewer_tool/map_3d.js`), and `config.viewer !== 'firstPerson'`
 * removed the indoor scene from the 3D list (`catalog/catalog.service.js` and the two search
 * providers). Neither was enumerated and neither was validated, so the real taxonomy — Tiles 3D,
 * isolated model, point cloud, indoor — had two of its four members with no name at all: the
 * point cloud loaded as a tileset (the right loader, since its format is part of 3D Tiles) and
 * showed up on screen as an ordinary model, with no label, no icon and no filter.
 *
 * THE FAILURE MODE THAT MADE IT URGENT is the one the constitution names on the role axis: a
 * taxonomy written by exclusion does not accuse the new variant. A fifth kind added tomorrow
 * would satisfy "not glb and not firstPerson" and fall silently into the tileset branch, with no
 * label and no error. The four values below are a CLOSED enumeration, validated at the write
 * border by Joi (`backend/src/modules/catalog/catalog.schemas.js`) and censused by
 * `frontend/tests/unit/forma-3d-censo.test.js`, which turns red when a value is added without a
 * label, an icon and a viewer branch.
 *
 * ZERO IMPORTS, AND THAT IS CONTRACT. This module is read by the catalog (core), by the Cesium
 * viewer (lazy chunk), by the first-person scene service (core) and by the admin page, which
 * boots WITHOUT the store. One import here of anything that reaches `@store` would drag the map
 * application into `admin.html`. The census asserts the emptiness.
 */

/**
 * The four shapes a `tilesets` row can declare. This is an enumeration, not a ladder: no value
 * contains another, so comparing them by order is a reading error.
 * @readonly
 * @enum {string}
 */
export const Forma3D = Object.freeze({
    /** Cesium 3D Tiles: the tiled mesh of a whole area. */
    TILES3D: 'tiles3d',
    /** A single glTF/GLB model, placed by position, rotation and scale. */
    GLB: 'glb',
    /** A point cloud. Its format is part of 3D Tiles, so it shares the tileset LOADER. */
    POINTCLOUD: 'pointcloud',
    /** A walk-through (Gaussian splatting) indoor scene. It does NOT use Cesium. */
    INDOOR: 'indoor'
});

/** The four values, in declaration order. The closed list the census walks. */
export const FORMAS_3D = Object.freeze([
    Forma3D.TILES3D,
    Forma3D.GLB,
    Forma3D.POINTCLOUD,
    Forma3D.INDOOR
]);

/** The key inside a `tilesets` row `config` (JSONB) that carries this axis. */
export const CAMPO_FORMA_3D = 'forma3d';

/**
 * The three drawing paths a shape can be routed to. This is what "a branch in the viewer" means
 * mechanically: a shape with no entry here has nowhere to be drawn, and `visualizadorDaForma`
 * says so out loud instead of defaulting.
 * @readonly
 * @enum {string}
 */
export const Visualizador3D = Object.freeze({
    /** `Cesium.Cesium3DTileset.fromUrl` — tiled mesh and point cloud alike. */
    CESIUM_TILESET: 'cesium-tileset',
    /** `Cesium.Model.fromGltfAsync` — the isolated model. */
    CESIUM_MODEL: 'cesium-model',
    /** The walk-through viewer of `first_person_3d_tool/`; no Cesium involved. */
    FIRST_PERSON: 'first-person'
});

/**
 * Shape -> drawing path. TOTAL over `FORMAS_3D` by census.
 *
 * Two shapes share `CESIUM_TILESET` on purpose, and that is the whole point of separating the
 * axis from the loader: the point cloud is drawn exactly like a tileset and still needs to be
 * SAID to be a point cloud on screen. Collapsing the two axes is what erased it in the first
 * place.
 * @readonly
 */
export const VISUALIZADOR_POR_FORMA = Object.freeze({
    [Forma3D.TILES3D]: Visualizador3D.CESIUM_TILESET,
    [Forma3D.GLB]: Visualizador3D.CESIUM_MODEL,
    [Forma3D.POINTCLOUD]: Visualizador3D.CESIUM_TILESET,
    [Forma3D.INDOOR]: Visualizador3D.FIRST_PERSON
});

/**
 * LEGACY discriminator: the value `config.viewer` carried on an indoor row.
 *
 * Exported because `first_person_3d_tool/scene-config.service.js` re-exports it as
 * `FIRST_PERSON_VIEWER` for its own callers and test fixtures: one literal, in the file that owns
 * the vocabulary, instead of two copies drifting apart.
 */
export const VIEWER_LEGADO_INDOOR = 'firstPerson';

/** LEGACY discriminator: the value `config.type` carried on an isolated-model row. */
export const TYPE_LEGADO_GLB = 'glb';

/**
 * Is this one of the four declared shapes?
 * @param {*} valor
 * @returns {boolean}
 */
export function isForma3D(valor) {
    return typeof valor === 'string' && FORMAS_3D.includes(valor);
}

/**
 * The shape of a catalog row: the DECLARED field when it is one of the four, the legacy
 * derivation otherwise.
 *
 * HOW LONG THE COMPAT HALF HAS TO LIVE, and what makes it removable. It reads rows written before
 * the axis existed. Migration `010_forma_3d.sql` backfills `tilesets.config` in every database it
 * runs on, so after that migration the only rows without the field are ones written by a client
 * that predates it. Two conditions make the derivation deletable, and BOTH are needed:
 *   1. every deployed database has run the 010 (forward-only migrations make this a matter of
 *      deploying, not of waiting);
 *   2. the write border refuses a `tilesets` config WITHOUT `forma3d` — today it only refuses a
 *      value outside the four, so a row created by an old client or by direct SQL still arrives
 *      bare. Tightening that Joi field to `.required()` for the tileset table is the act that
 *      retires this function.
 * Until both hold, deleting the fallback turns every legacy `glb` row into a tileset load — a
 * model that renders as nothing, with no error, which is exactly the silence this axis exists to
 * end.
 *
 * A shape outside the four (which the Joi border rejects, so it can only arrive by direct SQL)
 * is NOT trusted: it degrades to the legacy derivation rather than propagating an unknown value
 * into the loader, where it would hit the `default` throw of `visualizadorDaForma`.
 *
 * @param {*} entrada - A `config.tilesets` entry (row `config` spread over `id`/`name`).
 * @returns {string} One of `FORMAS_3D`.
 */
export function derivarForma3d(entrada) {
    if (!entrada || typeof entrada !== 'object') return Forma3D.TILES3D;

    const declarado = entrada[CAMPO_FORMA_3D];
    if (isForma3D(declarado)) return declarado;

    if (entrada.viewer === VIEWER_LEGADO_INDOOR) return Forma3D.INDOOR;
    if (entrada.type === TYPE_LEGADO_GLB) return Forma3D.GLB;
    // The historical default: anything that was neither is a tileset. The point cloud lands here
    // and that is a KNOWN, deliberate limitation of the backfill — see the header of the 010.
    return Forma3D.TILES3D;
}

/**
 * The drawing path of a shape.
 * @param {string} forma - One of `FORMAS_3D`.
 * @returns {string} One of `Visualizador3D`.
 * @throws {Error} For a shape with no declared branch, which is a programming error.
 */
export function visualizadorDaForma(forma) {
    // `Object.hasOwn`, never a bare lookup: `VISUALIZADOR_POR_FORMA['toString']` is a truthy
    // inherited function, so a plain read would answer a shape nobody declared with a Function
    // instead of throwing. Same reason the read below is guarded.
    if (typeof forma !== 'string' || !Object.hasOwn(VISUALIZADOR_POR_FORMA, forma)) {
        throw new Error(`Forma 3D sem ramo de visualizador: ${String(forma)}`);
    }
    return VISUALIZADOR_POR_FORMA[forma];
}

/**
 * Is this shape drawn by Cesium?
 *
 * The predicate the catalog and the search providers use INSTEAD of "is not first-person". The
 * difference is not cosmetic: the old form let an unknown shape into the Cesium half by default,
 * and this one keeps it out unless its branch says so.
 * @param {string} forma
 * @returns {boolean}
 */
export function ehFormaDoCesium(forma) {
    if (typeof forma !== 'string' || !Object.hasOwn(VISUALIZADOR_POR_FORMA, forma)) return false;
    const visualizador = VISUALIZADOR_POR_FORMA[forma];
    return visualizador === Visualizador3D.CESIUM_TILESET
        || visualizador === Visualizador3D.CESIUM_MODEL;
}

/**
 * Is this catalog entry drawn by Cesium? The one-call form of `ehFormaDoCesium(derivarForma3d(x))`.
 * @param {*} entrada
 * @returns {boolean}
 */
export function ehEntradaDoCesium(entrada) {
    return ehFormaDoCesium(derivarForma3d(entrada));
}

/**
 * Is this catalog entry an indoor (walk-through) scene?
 * @param {*} entrada
 * @returns {boolean}
 */
export function ehEntradaIndoor(entrada) {
    return derivarForma3d(entrada) === Forma3D.INDOOR;
}
