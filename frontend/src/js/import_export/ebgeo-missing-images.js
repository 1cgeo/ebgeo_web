// Path: js/import_export/ebgeo-missing-images.js

/**
 * @fileoverview Which images a `.ebgeo` export MUST carry, and what the screen says when one of
 * them has no file to carry.
 *
 * Leaf module, zero imports, so it runs in plain node.
 *
 * THE DEFECT THIS CLOSES (2026-09-21). An image feature or a custom icon whose blob is not
 * available used to be skipped in silence, and the file went out with a hole nobody was told
 * about. On 2026-09-19 that became a hard refusal ("Imagem <id> indisponível. Aguarde a conexão e
 * tente exportar novamente."), which closed the silent loss and opened a worse door: ONE orphan
 * image made the WHOLE atlas impossible to export, forever. On a LOCAL atlas no connection will
 * ever bring the blob back, so the sentence promised a way out that does not exist; on a server
 * atlas a blob the server answers 404 for is the same dead end. Orphans are real: the 2.2 fixture
 * `tests/fixtures/ebgeo-2.2/01-completo.ebgeo`, a byte-for-byte copy of a file produced by the
 * other line of the product, carries four image features and the blob of three.
 *
 * The rule that keeps both intentions: the loss is NEVER silent and NEVER a trap. The exporter
 * counts what is missing BEFORE writing the file, names it, and the person decides. The feature
 * stays in the file without its picture, which is exactly the state it already has on this disk.
 */

/**
 * @typedef {Object} RequiredImage
 * @property {string} id - Image id (the feature id, or the custom icon id)
 * @property {'imagem'|'icone'} kind - An image FEATURE, or a custom point ICON
 * @property {string|null} mapName - Map that holds the feature; null for an icon
 */

/**
 * The images an export cannot quietly go without: every image FEATURE and every custom ICON.
 * Other features may own a blob too (a regenerated symbol bitmap); those are rebuilt from the
 * feature's properties on load, so a missing one is not a loss and is not listed here.
 *
 * @param {Object} data - The export data object (`maps`, `customIcons`)
 * @returns {RequiredImage[]} In document order, without duplicates
 */
export function requiredImagesOf(data) {
    const seen = new Set();
    const out = [];
    const push = (id, kind, mapName) => {
        if (typeof id !== 'string' || id.length === 0 || seen.has(id)) return;
        seen.add(id);
        out.push({ id, kind, mapName });
    };
    for (const icon of Array.isArray(data?.customIcons) ? data.customIcons : []) push(icon?.id, 'icone', null);
    for (const [mapName, map] of Object.entries(data?.maps || {})) {
        for (const feature of Array.isArray(map?.features?.images) ? map.features.images : []) {
            push(feature?.properties?.id, 'imagem', mapName);
        }
    }
    return out;
}

/**
 * @param {number} n
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function count(n, singular, plural) {
    return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * The confirmation the exporter shows when required images have no file, or null when nothing is
 * missing (the caller then asks nothing).
 *
 * The two scopes get different sentences because the way out is different: on a server atlas the
 * blob may simply not have been downloaded yet, so cancelling and trying again with a connection
 * is a real option; on a local atlas it is not, and saying so would be a lie.
 *
 * @param {RequiredImage[]} missing - The required images with no blob available
 * @param {{ remote?: boolean }} [options]
 * @returns {{ title: string, message: string, confirmText: string, cancelText: string }|null}
 */
export function missingImagesConfirm(missing, { remote = false } = {}) {
    const list = Array.isArray(missing) ? missing : [];
    if (list.length === 0) return null;

    const images = list.filter((m) => m.kind === 'imagem');
    const icons = list.filter((m) => m.kind === 'icone');
    const parts = [];
    if (images.length > 0) {
        const maps = [...new Set(images.map((m) => m.mapName).filter(Boolean))];
        parts.push(count(images.length, 'imagem', 'imagens')
            + (maps.length > 0 ? ` (${maps.length === 1 ? 'no mapa' : 'nos mapas'} ${maps.map((n) => `"${n}"`).join(', ')})` : ''));
    }
    if (icons.length > 0) parts.push(count(icons.length, 'ícone personalizado', 'ícones personalizados'));

    const why = remote
        ? 'Não foi possível obter do servidor o arquivo de: '
        : 'O arquivo de figura não está guardado neste computador para: ';
    const wayOut = remote
        ? 'Se você está sem conexão, cancele e exporte de novo quando ela voltar. Se continuar, '
        : 'Não há de onde recuperá-lo. Se continuar, ';
    const total = list.length;

    return {
        title: `Este arquivo sai sem ${count(total, 'figura', 'figuras')}`,
        message: `${why}${parts.join(' e ')}.\n\n${wayOut}`
            + (total === 1
                ? 'o que usa essa figura continua no arquivo, sem ela, que é como já aparece neste computador.'
                : 'o que usa essas figuras continua no arquivo, sem elas, que é como já aparece neste computador.')
            + ' Todo o resto vai inteiro.',
        confirmText: 'Exportar assim',
        cancelText: 'Cancelar',
    };
}
