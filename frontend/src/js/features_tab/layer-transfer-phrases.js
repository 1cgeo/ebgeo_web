// Path: js/features_tab/layer-transfer-phrases.js

/**
 * @fileoverview What the screen SAYS after a layer transfer, as a pure function of the result.
 *
 * Leaf module, zero imports, so it runs in plain node. It exists because the sentence used to be
 * built inside the features tab from two facts only (`mode`, `sourceLayerRemoved`), and a move has
 * THREE source-side outcomes (see `transferLayerToMap`, `store/layer-transfer.operations.js`):
 *
 *  - the source was emptied: the old success sentence, with the patch about the empty layer when
 *    only the layer RECORD could not be deleted;
 *  - the source map is GONE (a peer deleted it mid-gesture): still a success, and the patch about
 *    "the empty layer stayed in the source map" would be false, because there is no source map;
 *  - the emptying was REFUSED with the source alive (a peer locked the map, or the role was lowered,
 *    between the destination write and the source emptying): NOT a success. The same features now
 *    sit in both maps on this computer while the server has them only in the destination. Until
 *    2026-09-21 the screen announced "layer moved" plus the empty-layer patch, false twice over.
 *
 * The refused case names the STATE, in the house rule for denied affordances, and says what happens
 * next. WHAT HAPPENS NEXT WAS MEASURED TWICE, AND THE SECOND MEASUREMENT OVERRULED THE FIRST.
 *
 * Both measurements are from 2026-09-21. In the first the divergence was rebuilt BY HAND, after the receipts of the move had settled, and
 * a reload was seen to reconcile it (the tail of the connect re-applied the move's own creates). The
 * sentence therefore said "Recarregue a página". Hours later the REAL refusal was driven through
 * the screen (the lock arriving between the destination write and the source emptying), four runs
 * out of four: the source empties BY ITSELF, with no reload, in 0.5 to 2 s. In the real path the
 * receipt arrives AFTER the refusal; the receipt of a `feature create` that declares a move carries
 * the server's canonical operation with `previousMapId`, and the author re-applies it through the
 * inbound path (`resolveLocalEdit`, `store/sync/remote-operation-handler.js`), which removes the
 * feature from its PREVIOUS map on disk, in the MapLibre source and in the layer tree. A ten-second
 * toast asking for a reload was outliving the duplicate it described. The hand-made divergence never
 * saw this because its receipts had already been consumed.
 *
 * So the sentence says what the screen will do on its own, and what stays behind: the layer RECORD,
 * empty, in the source map (it is deliberately not deleted while the layer still holds features). If
 * the server REFUSES the move instead, nothing converges and the flush announces the reason in a
 * toast of its own, which is the second half of the sentence.
 * Guard: `tests/e2e-ui/browser-collab-transferencia-origem-cheia.spec.js`, both cases.
 */

/** `TransferMode.MOVE`, kept as a literal so this module stays import-free. */
const MOVE = 'move';

/** Why the source could not be emptied, as the clause that goes inside the parentheses. */
const REFUSAL_CLAUSES = Object.freeze({
    map_locked: 'ele está bloqueado',
    permission: 'a sua permissão neste atlas mudou',
    unknown: 'a escrita foi recusada',
});

/**
 * @param {number} count
 * @returns {string} "1 feição" / "N feições"
 */
function featureCount(count) {
    return `${count} ${count === 1 ? 'feição' : 'feições'}`;
}

/**
 * @param {number} skipped - Analysis features left behind
 * @returns {string} The trailing sentence, or '' when nothing was skipped
 */
function skippedSentence(skipped) {
    if (!(skipped > 0)) return '';
    const plural = skipped === 1 ? 'feição' : 'feições';
    const levada = skipped === 1 ? 'foi levada' : 'foram levadas';
    return `. ${skipped} ${plural} de análise (LOS/visibilidade) não ${levada}`;
}

/**
 * The sentence, and whether it is a success or a warning.
 *
 * @param {string} layerName - Layer name
 * @param {string} targetMapName - Destination map name
 * @param {Object} result - A SUCCESSFUL result of `transferLayerToMap`
 * @returns {{ kind: 'success'|'warning', text: string }}
 */
export function transferOutcomeNotice(layerName, targetMapName, result) {
    const r = result || {};
    const count = Number.isFinite(r.movedCount) ? r.movedCount : 0;
    const isMove = r.mode === MOVE;

    if (isMove && r.sourceEmptied === false) {
        const clause = Object.hasOwn(REFUSAL_CLAUSES, r.sourceRefusal)
            ? REFUSAL_CLAUSES[r.sourceRefusal]
            : REFUSAL_CLAUSES.unknown;
        return {
            kind: 'warning',
            text: `A camada "${layerName}" foi levada para "${targetMapName}" (${featureCount(count)}), `
                + `mas o mapa de origem não pôde ser esvaziado na hora: ${clause}. As feições `
                + 'saem do mapa de origem sozinhas assim que o servidor confirmar a mudança; se ele a '
                + 'recusar, o motivo é avisado na tela. A camada vazia continua no mapa de origem'
                + skippedSentence(r.skippedCount),
        };
    }

    let text = `Camada "${layerName}" ${isMove ? 'movida' : 'copiada'} para "${targetMapName}" (${featureCount(count)})`;
    if (isMove && r.sourceMissing === true) {
        text += '. O mapa de origem foi removido por outro usuário';
    } else if (r.sourceLayerRemoved === false) {
        text += '. A camada vazia continuou no mapa de origem';
    }
    return { kind: 'success', text: text + skippedSentence(r.skippedCount) };
}
