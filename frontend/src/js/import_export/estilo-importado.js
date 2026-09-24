// Path: js/import_export/estilo-importado.js

/**
 * @fileoverview The STYLE of a feature across a file round trip, and the style keys of a foreign
 * KML that are not user data. ZERO imports, testable in node; both sides of the round trip (the
 * KMZ export and the import) read this one file, so the two cannot drift.
 *
 * WHY IT EXISTS (2026-09-23, coordinator's acceptance criterion: "ida e volta do NOSSO .kmz devolve
 * a feição com os mesmos atributos e o mesmo estilo"). KML can say a colour and a width, not an
 * EBGeo point (marker symbol, label, outline, zoom correction), so the export rasterizes it, and the
 * import read NO style at all: every re-imported feature came back with the tool's defaults, and
 * the KML style that the reader derives (`styleUrl`, `icon-scale`, `label-scale`...) landed as five
 * junk user attributes per point. Now:
 *   - the export writes the feature's own style properties, as JSON, in ONE ExtendedData entry
 *     ({@link CHAVE_DO_ESTILO});
 *   - the import restores them onto the feature, only the keys the target tool knows
 *     ({@link aplicarEstiloImportado}), and consumes the entry and the redundant human-readable
 *     extras the export also writes for other GIS tools ({@link CHAVES_DE_ESTILO_DEGRADADO});
 *   - a foreign KML's derived style keys ({@link CHAVES_DE_ESTILO_DO_KML}) are not user data and are
 *     dropped, unless the placemark declared that same key in its own ExtendedData.
 */

/** The ExtendedData entry that carries a feature's style through a KMZ. */
export const CHAVE_DO_ESTILO = 'ebgeo_estilo';

/**
 * Human-readable style extras the KMZ export writes for OTHER GIS tools (`collectDegradedStyle`,
 * `import_export/kmz/kml-style.js`). Redundant with {@link CHAVE_DO_ESTILO}, so consumed with it.
 * @type {ReadonlyArray<string>}
 */
export const CHAVES_DE_ESTILO_DEGRADADO = Object.freeze([
    'lineStyle', 'hatchEnabled', 'hatchType', 'hatchColor', 'hatchSpacing',
]);

/**
 * The CLOSED list of keys `@tmcw/togeojson` derives from a placemark's `<Style>`/`<styleUrl>`
 * (`extractStyle` and `extractCascadedStyle` of the package), plus the two presentation flags of
 * a placemark (`visibility`, `open`). None of them is user data.
 * @type {ReadonlyArray<string>}
 */
export const CHAVES_DE_ESTILO_DO_KML = Object.freeze([
    'styleUrl', 'styleHash', 'styleMapHash',
    'stroke', 'stroke-opacity', 'stroke-width',
    'fill', 'fill-opacity',
    'icon', 'icon-color', 'icon-opacity', 'icon-scale', 'icon-heading', 'icon-offset', 'icon-offset-units',
    'label-color', 'label-opacity', 'label-scale',
    'visibility', 'open',
]);

/**
 * Properties that are NOT style: identity, content, geometry, time, and the bookkeeping the import
 * recomputes from the current zoom. Never exported in the style, never restored from it.
 * @type {ReadonlySet<string>}
 */
const NAO_E_ESTILO = new Set([
    'id', 'nome', 'descricao', 'source', 'layerId', 'groupId', 'attributes', 'images', 'text',
    'baseCoordinates', 'coordinates', 'center', 'radius', 'profileData', 'elevationProfile',
    'trajetoria', 'temporalInicio', 'temporalFim', 'selectionBox',
    'sizeCreatedAtZoom', 'calculatedSize', 'labelCreatedAtZoom', 'labelCalculatedSize',
    'createdAt', 'updatedAt', 'version', 'imageUrl', 'imageData',
]);

const ehPrimitivo = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/**
 * The style of a feature, as the JSON the KMZ export writes. Empty string when there is none.
 * @param {Object} properties - The feature's properties.
 * @returns {string}
 */
export function estiloParaExportar(properties = {}) {
    const estilo = {};
    for (const [chave, valor] of Object.entries(properties ?? {})) {
        if (NAO_E_ESTILO.has(chave) || !ehPrimitivo(valor)) continue;
        if (typeof valor === 'number' && !Number.isFinite(valor)) continue;
        estilo[chave] = valor;
    }
    return Object.keys(estilo).length > 0 ? JSON.stringify(estilo) : '';
}

/**
 * Splits an imported feature's properties into user data and the EBGeo style it carried.
 *
 * When the style entry is present and parses, it is removed, and so are the redundant extras and
 * a `name` that only repeats the label text (a point exported with its label shows the label as
 * the placemark name). When it is absent or does not parse, the properties are returned as they
 * came: nothing is consumed on a guess.
 * @param {Object} props - Imported properties.
 * @returns {{propriedades: Object, estilo: (Object|null)}}
 */
export function separarEstiloImportado(props) {
    if (!props || typeof props !== 'object' || !Object.hasOwn(props, CHAVE_DO_ESTILO)) {
        return { propriedades: props, estilo: null };
    }
    let estilo = null;
    try {
        const lido = JSON.parse(props[CHAVE_DO_ESTILO]);
        if (lido && typeof lido === 'object' && !Array.isArray(lido)) estilo = lido;
    } catch {
        estilo = null;
    }
    if (!estilo) return { propriedades: props, estilo: null };

    const propriedades = { ...props };
    delete propriedades[CHAVE_DO_ESTILO];
    for (const chave of CHAVES_DE_ESTILO_DEGRADADO) delete propriedades[chave];
    if (typeof estilo.labelText === 'string' && estilo.labelText !== ''
        && propriedades.name === estilo.labelText && typeof propriedades.nome === 'string') {
        delete propriedades.name;
    }
    return { propriedades, estilo };
}

/**
 * Restores an imported style onto the properties a tool built from its defaults. Only keys the
 * target tool DECLARES in its defaults are restored, only with a value of the same kind as the
 * default (or any primitive when the default is null), and never a non-style key.
 * @param {Object} base - Properties built from the tool's defaults (mutated and returned).
 * @param {Object|null} estilo - What {@link separarEstiloImportado} returned.
 * @param {Object} padroes - The tool's `DEFAULT_PROPERTIES`.
 * @returns {Object} `base`
 */
export function aplicarEstiloImportado(base, estilo, padroes = {}) {
    if (!estilo) return base;
    for (const [chave, valor] of Object.entries(estilo)) {
        if (NAO_E_ESTILO.has(chave) || !Object.hasOwn(padroes, chave) || !ehPrimitivo(valor)) continue;
        const padrao = padroes[chave];
        if (padrao !== null && padrao !== undefined && typeof padrao !== typeof valor) continue;
        if (typeof valor === 'number' && !Number.isFinite(valor)) continue;
        base[chave] = valor;
    }
    return base;
}

/**
 * Drops the style keys `togeojson` derived from each placemark's `<Style>`, keeping any key the
 * placemark declared in its own `<ExtendedData>` (user data wins over a style of the same name).
 * @param {Object} geoJSON - What `toGeoJSON.kml` returned (mutated and returned).
 * @param {Array<Set<string>>|null} dadosPorPlacemark - The ExtendedData names of each placemark, in
 *   document order; when its length does not match the features, `todos` is used for every one.
 * @param {Set<string>} [todos] - The ExtendedData names of the whole document.
 * @returns {Object} `geoJSON`
 */
export function limparEstiloDoKml(geoJSON, dadosPorPlacemark = null, todos = new Set()) {
    const features = geoJSON?.features;
    if (!Array.isArray(features)) return geoJSON;
    const porIndice = Array.isArray(dadosPorPlacemark) && dadosPorPlacemark.length === features.length;
    features.forEach((feature, i) => {
        const props = feature?.properties;
        if (!props || typeof props !== 'object') return;
        const declarados = porIndice ? dadosPorPlacemark[i] : todos;
        for (const chave of CHAVES_DE_ESTILO_DO_KML) {
            if (Object.hasOwn(props, chave) && !declarados.has(chave)) delete props[chave];
        }
    });
    return geoJSON;
}

/**
 * The ExtendedData names of each `<Placemark>` of a parsed KML document, in document order.
 * @param {Document} kmlDoc
 * @returns {{porPlacemark: Array<Set<string>>, todos: Set<string>}}
 */
export function nomesDeDadosPorPlacemark(kmlDoc) {
    const porPlacemark = [];
    const todos = new Set();
    const placemarks = kmlDoc?.getElementsByTagName ? Array.from(kmlDoc.getElementsByTagName('Placemark')) : [];
    for (const placemark of placemarks) {
        const nomes = new Set();
        for (const tag of ['Data', 'SimpleData']) {
            for (const el of Array.from(placemark.getElementsByTagName(tag))) {
                const nome = el.getAttribute('name');
                if (nome) { nomes.add(nome); todos.add(nome); }
            }
        }
        porPlacemark.push(nomes);
    }
    return { porPlacemark, todos };
}
