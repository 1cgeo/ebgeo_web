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
 * The confirmation shown before a server copy that would miss this computer's pending work.
 *
 * `desconhecido` is for a count that could not be read: the sentence must not claim there IS
 * pending work, and must not stay silent either, because silence is the defect.
 * @param {string} porta - A {@link PortaDeCopia} value.
 * @param {{ desconhecido?: boolean }} [opcoes]
 * @returns {{ titulo: string, corpo: string, confirmar: string, cancelar: string }}
 */
export function avisoDeCopiaComPendencias(porta, { desconhecido = false } = {}) {
    const doMapa = porta === PortaDeCopia.MAPA;
    const onde = doMapa ? 'neste mapa' : 'neste atlas';
    const acao = doMapa
        ? 'Espere o envio terminar e duplique de novo.'
        : 'Abra o atlas para que elas sejam enviadas e copie depois.';
    const titulo = desconhecido
        ? `Não foi possível conferir se há alterações deste computador ainda não enviadas ${onde}`
        : `Há alterações deste computador ainda não enviadas ${onde}`;
    const corpo = desconhecido
        ? `Se houver, a cópia não as terá. ${acao}`
        : `A cópia não as terá. ${acao}`;
    return {
        titulo,
        corpo,
        confirmar: doMapa ? 'Duplicar mesmo assim' : 'Copiar mesmo assim',
        cancelar: 'Cancelar',
    };
}

/** Shown while "Duplicar" waits for this map's pending work, so the delay has a reason. */
export const FRASE_DA_ESPERA_DA_COPIA = 'Enviando as alterações deste mapa antes de duplicar.';
