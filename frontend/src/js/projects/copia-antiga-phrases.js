// Path: js/projects/copia-antiga-phrases.js

/**
 * @fileoverview The copy of the previous version's data, in the "Neste computador" section of
 * `atlas.html`: when the command shows, and what it says. Zero imports, testable in node.
 *
 * WHY (owner's decision of 2026-09-26). The upgrade copies the pre-namespace acervo and never
 * deletes the original, because deleting the only pre-update copy is not a decision code may take
 * (`store/migration/legacy-cleanup.js`). The gesture that deletes it lived on the recovery screen,
 * which only a FAILED upgrade reaches, so every person whose upgrade worked kept the old copy on
 * disk with no way to drop it. The command lives here now, and only while there is something it
 * can do: the upgrade concluded, the original is intact and holds records. Every other verdict
 * (no upgrade, not concluded, the old version wrote after it, a slot still claims it, already
 * dropped) is a state the person cannot change from this page, so the command does not show.
 */

/**
 * The verdict the section draws the command for, or null when there is nothing to offer.
 * @param {{reason: string, records: number}|null|undefined} veredito - `describeLegacySource()`.
 * @returns {{registros: number}|null}
 */
export function copiaAntigaParaOferecer(veredito) {
    if (veredito?.reason !== 'ok') return null;
    const registros = veredito.records;
    return Number.isSafeInteger(registros) && registros > 0 ? { registros } : null;
}

const quantos = (n) => (n === 1 ? '1 registro' : `${n} registros`);

/** The sentence above the command. */
export const COPIA_ANTIGA_TEXTO =
    'Este computador ainda guarda a cópia dos seus dados da versão anterior do EBGeo. Os seus atlas '
    + 'já foram atualizados e não dependem dela.';

/** The command. */
export const COPIA_ANTIGA_BOTAO = 'Apagar a cópia antiga da versão anterior';

/**
 * The question before deleting, naming how many records leave.
 * @param {number} registros
 * @returns {{titulo: string, mensagem: string, confirmar: string}}
 */
export function confirmacaoDeApagarCopiaAntiga(registros) {
    return {
        titulo: 'Apagar a cópia antiga?',
        mensagem: `Isto apaga ${quantos(registros)} da versão anterior deste computador, e não há como `
            + 'desfazer. Os seus atlas atualizados continuam intactos.',
        confirmar: 'Apagar a cópia antiga',
    };
}

/**
 * The notice after the copy left.
 * @param {number} registros - What `dropLegacySource` reported.
 * @returns {string}
 */
export function copiaAntigaApagada(registros) {
    return `A cópia antiga saiu deste computador (${quantos(registros)}). Os seus atlas continuam intactos.`;
}

/** Another window holds one of the old databases open (`drop_blocked`). */
export const COPIA_ANTIGA_OCUPADA =
    'Outra janela do EBGeo está usando a cópia antiga. Feche as outras janelas e tente de novo.';

/** Any other refusal or failure. */
export const COPIA_ANTIGA_FALHOU =
    'Não foi possível apagar a cópia antiga. Tente de novo; se continuar, avise o administrador.';
