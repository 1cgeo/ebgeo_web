// Path: js/store/sync/copia-no-servidor-phrases.js

/**
 * @fileoverview What a copy made BY THE SERVER says when this computer still owes it work.
 *
 * Two doors copy on the server: "Copiar no servidor" on `atlas.html` (the atlas clone) and
 * "Duplicar" of a map in a server atlas. Both copy what the SERVER has, so whatever this computer
 * has not sent yet (an edit still in the queue, a picture whose bytes are still uploading, and the
 * picture's feature held behind those bytes) is simply not in the copy. Until 2026-09-24 neither
 * door said so, and a copy made right after placing a picture came out without it.
 *
 * ZERO IMPORTS: the atlas page boots with no store, and the map page reaches this through the map
 * manager; both need the same words.
 */

/** Which door is asking. */
export const PortaDeCopia = Object.freeze({
    ATLAS: 'atlas',
    MAPA: 'mapa',
});

/**
 * The confirmation shown before a server copy that would miss this computer's work.
 *
 * TWO KINDS OF DEBT, TWO DIFFERENT THINGS THE PERSON CAN DO, and one sentence for both was wrong
 * for one of them (review of 2026-09-24). Work still on its way goes out by itself: the advice is to
 * wait (the map) or to open the atlas so it can go (`atlas.html`). Work the SERVER REFUSED never
 * goes out by waiting or by opening: the only place to decide about it is the Pendências button of
 * the map, and the sentence says that. With both, the pending advice comes first and the refused
 * one is added.
 *
 * `desconhecido` is for a count that could not be read: the sentence must not claim there IS such
 * work, and must not stay silent either, because silence is the defect.
 * @param {string} porta - A {@link PortaDeCopia} value.
 * @param {{ enviaveis?: boolean, recusadas?: boolean, desconhecido?: boolean }} [opcoes]
 * @returns {{ titulo: string, corpo: string, confirmar: string, cancelar: string }}
 */
export function avisoDeCopiaComPendencias(porta, { enviaveis = false, recusadas = false, desconhecido = false } = {}) {
    const doMapa = porta === PortaDeCopia.MAPA;
    const onde = doMapa ? 'neste mapa' : 'neste atlas';
    const esperar = doMapa
        ? 'Espere o envio terminar e duplique de novo.'
        : 'Abra o atlas para que elas sejam enviadas e copie depois.';
    const decidir = doMapa
        ? 'Veja o que fazer com elas no botão Pendências do mapa.'
        : 'Abra o atlas e veja o que fazer com elas no botão Pendências do mapa.';
    const botoes = { confirmar: doMapa ? 'Duplicar mesmo assim' : 'Copiar mesmo assim', cancelar: 'Cancelar' };

    if (desconhecido) {
        return {
            titulo: `Não foi possível conferir se há alterações deste computador ainda não enviadas ${onde}`,
            corpo: `Se houver, a cópia não as terá. ${esperar}`,
            ...botoes,
        };
    }
    if (recusadas && !enviaveis) {
        return {
            titulo: `O servidor recusou alterações deste computador ${onde}`,
            corpo: `A cópia não as terá. ${decidir}`,
            ...botoes,
        };
    }
    return {
        titulo: `Há alterações deste computador ainda não enviadas ${onde}`,
        corpo: recusadas
            ? `A cópia não as terá. ${esperar} As que o servidor recusou estão no botão Pendências do mapa.`
            : `A cópia não as terá. ${esperar}`,
        ...botoes,
    };
}

/** Shown while "Duplicar" waits for this map's pending work, so the delay has a reason. */
export const FRASE_DA_ESPERA_DA_COPIA = 'Enviando as alterações deste mapa antes de duplicar.';
