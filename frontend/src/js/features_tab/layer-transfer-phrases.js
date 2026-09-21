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
 * The refused case names the STATE, in the house rule for denied affordances, and tells the person
 * the one thing they can do about it. THAT PROMISE WAS MEASURED, not assumed (2026-09-21, two real
 * browsers, 3 of 3): reloading does take the moved features out of the source map. Not because a
 * snapshot arrives (the active generation is the same before and after the F5): the durable cursor
 * only advances when a snapshot is activated, so the tail the reload pulls still carries the
 * `feature create` ops of the move itself, and each one removes the feature from its PREVIOUS map
 * before writing it to the destination. The sentence is therefore SPECIFIC on purpose ("so that
 * they leave the source map"): a reload re-applies the operations that describe a change, it does
 * not bring "the state of the server", and a record that exists only on this disk survives it.
 * Guard: `tests/e2e-ui/browser-collab-transferencia-origem-cheia.spec.js`.
 */

/** `TransferMode.MOVE`, kept as a literal so this module stays import-free. */
const MOVE = 'move';

/** Why the source could not be emptied, as the clause that goes inside the parentheses. */
const REFUSAL_CLAUSES = Object.freeze({
    map_locked: 'o mapa de origem está bloqueado',
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
            text: `A camada "${layerName}" foi copiada para "${targetMapName}" (${featureCount(count)}), `
                + `mas não pôde ser retirada do mapa de origem: ${clause}. Neste computador as feições `
                + `aparecem nos dois mapas; no servidor elas estão só em "${targetMapName}". `
                + 'Recarregue a página para que elas saiam do mapa de origem'
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
