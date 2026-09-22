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
 * next. WHAT HAPPENS NEXT WAS MEASURED THREE TIMES ON 2026-09-21, AND EACH MEASUREMENT OVERRULED
 * THE ONE BEFORE, which is the reason this paragraph is long.
 *
 *  1. The divergence was rebuilt BY HAND, after the receipts of the move had settled, and a reload
 *     was seen to reconcile it. The sentence said "Recarregue a página". A reconstruction measures
 *     the state it builds, not the path that leads to it.
 *  2. The refusal was injected at the right instant (the lock entering the client's memory between
 *     the destination write and the source emptying) and the gesture driven through the screen:
 *     the source emptied BY ITSELF in 0.5 to 2 s, because the receipt of a moved feature carries
 *     the canonical operation with `previousMapId` and `resolveLocalEdit` re-applies it. The
 *     sentence became "they leave the source on their own", plus "the empty layer stays". But the
 *     lock lived ONLY IN THE CLIENT: the server was never locked, so it accepted the move.
 *  3. With the server REALLY locked, which is what a peer's lock is, the server REFUSES the move:
 *     its gate checks the SOURCE map of a move too (`pushOperations`, right after
 *     `prepareFeatureMutation`, in `backend/src/modules/sync/sync.service.js`). Measured: within
 *     one second the whole batch comes back refused, the copy in the DESTINATION is undone, the
 *     layer stays FULL in the source, the server's reason is shown in a toast and three problems
 *     stay recorded in the outbound queue. "Levada" and "the empty layer stays" were both false for
 *     the case the sentence exists for.
 *
 * So the duplicate is short-lived either way and resolves in OPPOSITE directions, and which one is
 * the server's call. The sentence says exactly that, and promises nothing about which.
 * Guard: `tests/e2e-ui/browser-collab-transferencia-origem-cheia.spec.js`, the two real-path cases.
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
            text: `A camada "${layerName}" foi copiada para "${targetMapName}" (${featureCount(count)}), `
                + `mas o mapa de origem não pôde ser esvaziado na hora: ${clause}. Quem decide agora é o `
                + 'servidor, em instantes: se ele aceitar a mudança, as feições saem do mapa de origem '
                + `sozinhas; se recusar, a cópia em "${targetMapName}" é desfeita, a camada continua no `
                + 'mapa de origem e o motivo é avisado na tela'
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
