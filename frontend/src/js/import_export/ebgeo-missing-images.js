// Path: js/import_export/ebgeo-missing-images.js

/**
 * @fileoverview Which images a `.ebgeo` export MUST carry, and what the screen says when one of
 * them has no file to carry.
 *
 * Leaf module whose one import (`user_data/photo-refs.js`) is itself a zero-import leaf, so it
 * runs in plain node.
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

import { idsDeFotosPorReferencia } from '@js/user_data/photo-refs.js';
import { idsDeFigurasDoDocumento } from '@js/briefing/figura-de-slide.js';

/**
 * @typedef {Object} RequiredImage
 * @property {string} id - Image id (the feature id, or the custom icon id)
 * @property {'imagem'|'icone'|'anexo'|'slide'} kind - An image FEATURE, a custom point ICON, a photo
 *   attached to a feature or a 3D/360 item, or a SLIDE FIGURE held by reference
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
    // A PHOTO HELD BY REFERENCE has its bytes only in `images/`, so a missing one is a loss like an
    // image feature's. An inline photo travels in the document and is never listed.
    for (const id of idsDeFotosPorReferencia(data)) push(id, 'anexo', null);
    // A SLIDE FIGURE held by reference (`briefing/figura-de-slide.js`) is the same loss.
    for (const id of idsDeFigurasDoDocumento(data)) push(id, 'slide', null);
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
 * "2 imagens (nos mapas "A", "B"), 1 ícone personalizado e 1 figura anexada": what is missing, by
 * kind, with the maps of the image features. Shared by the two questions below so the same loss is
 * never worded two ways.
 *
 * @param {RequiredImage[]} list - Non-empty
 * @returns {string}
 */
function describeMissing(list) {
    const images = list.filter((m) => m.kind === 'imagem');
    const icons = list.filter((m) => m.kind === 'icone');
    const attached = list.filter((m) => m.kind === 'anexo');
    const slides = list.filter((m) => m.kind === 'slide');
    const parts = [];
    if (images.length > 0) {
        const maps = [...new Set(images.map((m) => m.mapName).filter(Boolean))];
        parts.push(count(images.length, 'imagem', 'imagens')
            + (maps.length > 0 ? ` (${maps.length === 1 ? 'no mapa' : 'nos mapas'} ${maps.map((n) => `"${n}"`).join(', ')})` : ''));
    }
    if (icons.length > 0) parts.push(count(icons.length, 'ícone personalizado', 'ícones personalizados'));
    if (attached.length > 0) parts.push(count(attached.length, 'figura anexada', 'figuras anexadas'));
    if (slides.length > 0) parts.push(count(slides.length, 'figura de slide', 'figuras de slide'));
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
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

    const why = remote
        ? 'Não foi possível obter do servidor o arquivo de: '
        : 'O arquivo de figura não está guardado neste computador para: ';
    const wayOut = remote
        ? 'Se você está sem conexão, cancele e exporte de novo quando ela voltar. Se continuar, '
        : 'Não há de onde recuperá-lo. Se continuar, ';
    const total = list.length;

    return {
        title: `Este arquivo sai sem ${count(total, 'figura', 'figuras')}`,
        message: `${why}${describeMissing(list)}.\n\n${wayOut}`
            + (total === 1
                ? 'o que usa essa figura continua no arquivo, sem ela, que é como já aparece neste computador.'
                : 'o que usa essas figuras continua no arquivo, sem elas, que é como já aparece neste computador.')
            + ' Todo o resto vai inteiro.',
        confirmText: 'Exportar assim',
        cancelText: 'Cancelar',
    };
}

/**
 * Names the images that are missing on the way UP to a server (2026-09-21).
 *
 * The three upload doors learn WHICH ids are missing from the payload builder's list, which is
 * wider than `requiredImagesOf`: it also cites the pictures attached to a marker or to a 3D/360
 * item. An id this module can place becomes an image feature (with its map) or a custom icon; any
 * other id is an attachment, named as such and never dropped from the count, because an uncounted
 * loss is the silent loss this module exists to close.
 *
 * @param {string[]} missingIds - Ids (as the export data cites them) with no file available
 * @param {Object} data - The export data object the ids came from
 * @returns {RequiredImage[]} One entry per distinct id, in the order given
 */
export function classifyMissingImages(missingIds, data) {
    const known = new Map(requiredImagesOf(data).map((image) => [image.id, image]));
    const seen = new Set();
    const out = [];
    for (const id of Array.isArray(missingIds) ? missingIds : []) {
        if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
        seen.add(id);
        out.push(known.get(id) ?? { id, kind: 'anexo', mapName: null });
    }
    return out;
}

/**
 * The confirmation shown before an atlas goes UP to a server without some of its pictures, or null
 * when nothing is missing.
 *
 * Until 2026-09-21 the three doors (send the mounted local atlas, send a local atlas from the atlas
 * page, import a `.ebgeo` straight into the server) REFUSED on the first missing original ("Uma
 * imagem original está ausente. Nenhum atlas foi publicado."). Same trap as the exporter's: one
 * picture whose file no longer exists anywhere made the atlas impossible to publish, forever, and
 * the sentence did not even say which picture. The refusal protected a real thing (nobody should
 * publish a hole without knowing), and the question keeps it: the loss is counted, named, and the
 * person decides. The server is TOLD which originals are missing (`missingImageIds`) and records
 * the count in the audit trail, so a knowingly incomplete publication leaves a trace.
 *
 * Two sources, two ways out: from the DISK there is nowhere to get the file back; from a FILE
 * there may be a more complete copy of the `.ebgeo`.
 *
 * @param {RequiredImage[]} missing - From `classifyMissingImages`
 * @param {{ from?: 'disco'|'arquivo', exportData?: Object }} [options]
 * @returns {{ title: string, message: string, confirmText: string, cancelText: string }|null}
 */
export function missingImagesUploadConfirm(missing, { from = 'disco', exportData } = {}) {
    const list = Array.isArray(missing) ? missing : [];
    // Bulk import cannot preserve comment authorship. Its omission belongs in the same
    // pre-publication decision as missing images, including when every image is present.
    const comments = Object.keys(exportData?.maps ?? {}).reduce((total, name) => {
        const collection = Object.hasOwn(exportData?.comments ?? {}, name) ? exportData.comments[name] : null;
        return total + Object.values(collection ?? {}).filter(value => value && typeof value === 'object').length;
    }, 0);
    if (list.length === 0 && comments === 0) return null;
    const fromFile = from === 'arquivo';
    const total = list.length;
    const why = fromFile
        ? 'O arquivo .ebgeo não traz a figura de: '
        : 'O arquivo de figura não está guardado neste computador para: ';
    const wayOut = fromFile
        ? 'Se existir uma cópia mais completa do arquivo, cancele e importe a partir dela. Se continuar, '
        : 'Não há de onde recuperá-lo. Se continuar, ';
    const imageMessage = total ? `${why}${describeMissing(list)}.\n\n${wayOut}`
            + (total === 1
                ? 'o que usa essa figura vai para o servidor sem ela, e quem abrir o atlas verá um marcador de erro no lugar.'
                : 'o que usa essas figuras vai para o servidor sem elas, e quem abrir o atlas verá um marcador de erro no lugar.') : '';
    const commentMessage = comments
        ? `${count(comments, 'comentário', 'comentários')} (incluindo respostas) não ${comments === 1 ? 'será enviado' : 'serão enviados'} ao servidor por esta importação. `
            + `O texto continua ${fromFile ? 'no arquivo .ebgeo original' : 'no atlas local deste computador'}. `
            + 'Cancele para manter o trabalho local ou continue para publicar uma cópia sem esses comentários.'
        : 'Todo o resto sobe inteiro.';
    return {
        title: comments ? 'Esta cópia será publicada com conteúdo faltando' : `Este atlas sobe sem ${count(total, 'figura', 'figuras')}`,
        message: [imageMessage, commentMessage].filter(Boolean).join('\n\n'),
        confirmText: fromFile ? 'Importar assim' : 'Enviar assim',
        cancelText: 'Cancelar',
    };
}

/**
 * The error a door throws when the person answers "Cancelar", or when the door was given no way to
 * ask. Tagged so the caller can tell a DECISION from a failure and say nothing: a cancelled send
 * is not an error to report.
 *
 * @returns {Error} With `cancelled: true`
 */
export function uploadCancelledError() {
    return Object.assign(new Error('Envio cancelado: nada foi publicado.'), { cancelled: true, stage: 'leitura' });
}
