// Path: js/store/migration/transicao-resiliente.js

/**
 * @fileoverview THE REPAIR COMES BEFORE THE SCREEN (owner's decision, 2026-09-22).
 *
 * ===========================================================================================
 * WHAT CHANGED
 * ===========================================================================================
 * Until this date every way the local upgrade could stumble drew the recovery screen, and the
 * screen offered the person a repair to choose: "Preparar uma nova cópia" for a copy that was
 * disturbed halfway, "Recuperar alterações em outro atlas" for a write the previous version made
 * after the transition. Both are decisions nobody outside this code can judge, and both have
 * exactly ONE answer that never loses work. So the code takes them, and the screen is left for
 * the case where taking them did not work.
 *
 * THE SCREEN IS NOT REMOVED FROM THE FLOW, IT IS MOVED BEHIND THE ATTEMPT. Every code that used
 * to reach it still reaches it; what it no longer does is reach it FIRST.
 *
 * ===========================================================================================
 * THE TWO REPAIRS, AND WHY EACH ONE IS BUDGETED
 * ===========================================================================================
 * `source_changed` / `copy_failed`: redo the copy from scratch (`restartLegacyCopy`), which is
 * what the button did. TWO attempts, because the cause is almost always another window writing
 * during the copy, and a window that is writing once is likely to write again: one retry answers
 * a single disturbance, a third would only spend the person's time in front of a card that says
 * "copying" while a tab they forgot keeps drawing. The origin is never written by any of this, so
 * an abandoned copy costs disk and the boot sweep collects it.
 *
 * `legacy_changes`: put what the old version wrote into a NEW local atlas
 * (`recoverLateLegacyChanges`), leaving the updated atlas untouched, which is the most
 * conservative of the outcomes the screen offered. ONE attempt, and the number is the point: each
 * run of that repair mints another atlas, the registry holds ten, and a legacy window that keeps
 * writing would spend all ten in one boot. If it happens twice in the same boot, the person is
 * looking at a window they have to close, and that is what the screen says.
 *
 * ===========================================================================================
 * WHY IT IS NOT IN THE UI GATE
 * ===========================================================================================
 * `runLegacyUpgradeGate` lives in `ui/`, needs a `document`, and the hermetic suite runs in node.
 * A loop written there could only be verified structurally (by reading the source text), and a
 * retry budget is exactly the kind of thing that has to be MEASURED. Here it is driven by
 * `tests/integration/transicao-resiliente.test.js` against real IndexedDB.
 *
 * THE PLAN OF THE LATE JOIN IS NOT TOUCHED. `planLateLegacyChanges` still answers ABSORB or
 * CONFLICT exactly as it did, and `prepareLegacyTransition` still throws `legacy_changes` on a
 * conflict. What changed is only what the CALLER does with that throw.
 */

import { prepareLegacyTransition, restartLegacyCopy } from './legacy-transition.js';

/**
 * How many times the copy is redone by itself before the screen is drawn. See the header.
 * @type {number}
 */
export const MAX_COPIAS_REFEITAS = 2;

/**
 * How many times the late legacy changes are moved to a new atlas by themselves. See the header.
 * @type {number}
 */
export const MAX_RECUPERACOES = 1;

/** What an automatic repair did, for the caller to tell the person about. */
export const ReparoAutomatico = Object.freeze({
    COPIA_REFEITA: 'copia_refeita',
    ALTERACOES_RECUPERADAS: 'alteracoes_recuperadas'
});

/**
 * Moves what the previous version wrote after the transition into a NEW local atlas.
 *
 * Imported DYNAMICALLY because `recovery-archive.js` pulls JSZip, and this module is reached from
 * the boot of the four pages that touch the local archive, two of which must stay light.
 *
 * @returns {Promise<{ id: string, name: string }>} The registry entry of the atlas that was created.
 */
export async function recuperarAlteracoesTardias() {
    const { recoverLateLegacyChanges } = await import('./recovery-archive.js');
    return recoverLateLegacyChanges();
}

/**
 * Tries the one repair that fits this failure, within its budget.
 *
 * A REPAIR THAT ITSELF FAILS IS NOT AN ERROR TO PROPAGATE: the caller's next move is the same
 * either way (draw the screen with the ORIGINAL cause), and replacing the cause with the cause of
 * the failed repair would tell the person about a step they never asked for. It is logged, and the
 * reason travels back so the caller can log it too.
 *
 * @param {Error} error - What `prepareLegacyTransition` threw.
 * @param {{ copias: number, recuperacoes: number }} gastos - Budgets already spent, mutated here.
 * @returns {Promise<{ kind: string, entry?: Object }|null>} What was repaired, or null when
 *   nothing was: an unrepairable code, an exhausted budget, or a repair that failed.
 */
async function repararUmaVez(error, gastos) {
    const code = error?.code;
    if (code === 'source_changed' || code === 'copy_failed') {
        if (gastos.copias >= MAX_COPIAS_REFEITAS) return null;
        gastos.copias += 1;
        try {
            await restartLegacyCopy();
            console.info(`Atualização local: cópia refeita automaticamente (tentativa ${gastos.copias}).`);
            return { kind: ReparoAutomatico.COPIA_REFEITA };
        } catch (falha) {
            console.warn('Atualização local: não foi possível refazer a cópia.', falha?.message);
            return null;
        }
    }
    if (code === 'legacy_changes') {
        if (gastos.recuperacoes >= MAX_RECUPERACOES) return null;
        gastos.recuperacoes += 1;
        try {
            const entry = await recuperarAlteracoesTardias();
            console.info(`Atualização local: alterações da versão antiga guardadas em "${entry?.name}".`);
            return { kind: ReparoAutomatico.ALTERACOES_RECUPERADAS, entry };
        } catch (falha) {
            console.warn('Atualização local: não foi possível guardar as alterações da versão antiga.', falha?.message);
            return null;
        }
    }
    return null;
}

/**
 * `prepareLegacyTransition` with the automatic repairs in front of the screen.
 *
 * @param {Object} [options]
 * @param {Function} [options.onProgress] - Copy progress, forwarded unchanged.
 * @returns {Promise<Object>} Whatever `prepareLegacyTransition` returns, plus `reparos`: the list
 *   of repairs that were needed, in order. Absent when none were.
 * @throws {Error} The FIRST unrepaired error, unchanged, so the screen names the real cause.
 */
export async function prepareLegacyTransitionResiliente({ onProgress } = {}) {
    const gastos = { copias: 0, recuperacoes: 0 };
    const reparos = [];
    for (;;) {
        try {
            const resultado = await prepareLegacyTransition({ onProgress });
            return reparos.length > 0 ? { ...resultado, reparos } : resultado;
        } catch (error) {
            const reparo = await repararUmaVez(error, gastos);
            if (!reparo) throw error;
            reparos.push(reparo);
        }
    }
}
