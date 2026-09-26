// Path: js/account/resgate-saida.js

/**
 * @fileoverview The exits offered when a server atlas is opened while a local slot holds the work
 * a rescue kept from it: when "enviar as pendências a este atlas" is one of them, and what the
 * question says. Zero imports, testable in node.
 *
 * THE NEW EXIT, AND ITS TWO CONDITIONS (owner's decision of 2026-09-26). Opening the server atlas
 * whose work was rescued used to offer "Apagar e abrir" and, by the text, the long way round of
 * "Enviar ao servidor" (a NEW atlas). The rescued slot and the server atlas are the same ten
 * databases, outbound queue included, so the work can instead go back to the atlas it came from,
 * with two conditions:
 *   - the SAME ACCOUNT: an operation carries no author, and pushing another account's queue under
 *     your token would sign their edits with your name (`store/sync/autor-da-fila.js`);
 *   - an UNTOUCHED COPY: a rescued slot journals nothing, so what was edited in it after the rescue
 *     is in no queue, and the server's snapshot would erase it on the way in. The first such edit
 *     is on record (`resgate.editadoEm`, `store/local-atlas.api.js`), and from then on the exit is
 *     not offered: "Enviar ao servidor" keeps everything as a new atlas.
 * A slot rescued before this existed carries no `resgate` and never gets the exit.
 */

/** The three answers of the question. */
export const SaidaDoResgate = Object.freeze({ CANCELAR: 'cancel', APAGAR: 'discard', ENVIAR: 'enviar' });

/**
 * @param {Object} args
 * @param {{resgate?: {atlasId?: string, editadoEm?: number}}|null|undefined} args.entrada - The
 *   rescued slot's registry entry.
 * @param {string} args.atlasId - The server atlas being opened.
 * @param {string|null|undefined} args.conta - The account opening it.
 * @param {string|null|undefined} args.autor - The account that wrote that atlas's queue.
 * @returns {boolean} Whether "enviar as pendências a este atlas" may be offered.
 */
export function podeEnviarPendencias({ entrada, atlasId, conta, autor }) {
    const resgate = entrada?.resgate;
    if (!resgate || resgate.atlasId !== atlasId) return false;
    if (resgate.editadoEm) return false;
    return typeof conta === 'string' && conta !== '' && autor === conta;
}

/** The title of the question, the same with or without the new exit. */
export const TITULO_DO_RESGATE = 'Este atlas tem trabalho guardado neste computador';

/**
 * The question and its choices.
 * @param {string} nomeLocal - The rescued slot's name.
 * @param {boolean} comEnvio - Whether "enviar as pendências" is offered.
 * @returns {{mensagem: string, escolhas: Array<{id: string, label: string, variant: string}>}}
 */
export function perguntaDoResgate(nomeLocal, comEnvio) {
    if (comEnvio) {
        return {
            mensagem: `As alterações que não chegaram ao servidor estão guardadas aqui como o atlas local "${nomeLocal}". `
                + 'Envie-as a este atlas agora. Abrir sem enviar apaga esse trabalho.',
            escolhas: [
                { id: SaidaDoResgate.CANCELAR, label: 'Cancelar', variant: 'ghost' },
                { id: SaidaDoResgate.APAGAR, label: 'Apagar e abrir', variant: 'danger' },
                { id: SaidaDoResgate.ENVIAR, label: 'Enviar as pendências', variant: 'primary' },
            ],
        };
    }
    return {
        // SEM A CAUSA, desde 2026-09-24: o resgate deixou de ser só da sessão que caiu (entra também
        // quando o atlas vai para a lixeira ou o acesso é revogado com trabalho não enviado), e
        // "quando sua sessão caiu" passou a contar o motivo errado.
        mensagem: `As alterações que não chegaram ao servidor foram guardadas aqui como o atlas `
            + `local "${nomeLocal}". Abrir este atlas do servidor agora apaga esse trabalho.\n\n`
            + 'Para não perder nada: cancele, abra o atlas local e use "Enviar ao servidor".',
        escolhas: [
            { id: SaidaDoResgate.CANCELAR, label: 'Cancelar', variant: 'ghost' },
            { id: SaidaDoResgate.APAGAR, label: 'Apagar e abrir', variant: 'danger' },
        ],
    };
}

/**
 * The notice once the atlas opened with the queue sent back.
 * @param {string} nomeLocal - The rescued slot's name.
 * @returns {string}
 */
export function pendenciasDevolvidas(nomeLocal) {
    return `As alterações guardadas em "${nomeLocal}" voltaram para este atlas e estão sendo enviadas.`;
}
