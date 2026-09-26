// Path: js/store/sync/sem-tempo-real-phrases.js

/**
 * @fileoverview What the person reads when a server atlas goes on WITHOUT REAL TIME (the socket did
 * not open and the server answers over HTTP; `sem-tempo-real.js`). Zero imports, so the style
 * census of screen notices (`tests/unit/avisos-de-tela-estilo.test.js`) reads every literal here.
 *
 * WHAT THE SENTENCE MAY NOT SAY, and each point was a choice. It does not name the cause: a proxy
 * that drops the upgrade is the common one, but a firewall or a server without the socket look the
 * same from here, and the house rule is not to state a cause the code does not know. It carries no
 * transport jargon (no socket, no HTTP, no queue). And it does not promise the colleagues' edits
 * "in real time" later: the mode comes back by itself when the socket passes, and the badge is what
 * says so.
 *
 * TWO AUDIENCES, because the first half of the sentence is false for one of them: the public-link
 * visitor sends nothing, so "suas alterações são salvas" would describe edits that visitor cannot
 * make. The advice is the same for both: the person can keep working, and whoever runs the network
 * is the one who can bring the real time back.
 */

/** For an account: its edits go to the server, the colleagues' arrive a few seconds late. */
const PARA_CONTA = 'Sem tempo real: suas alterações são salvas no servidor, e as dos colegas chegam '
    + 'em alguns segundos. Se continuar, avise o administrador.';

/** For the public-link visitor, who reads and never sends. */
const PARA_VISITANTE = 'Sem tempo real: as alterações deste atlas chegam em alguns segundos. Se '
    + 'continuar, avise o administrador.';

/**
 * The notice shown once per session when the atlas enters the mode without real time.
 * @param {{ visitante?: boolean }} [contexto] - Whether the session is a public-link visitor.
 * @returns {string}
 */
export function avisoDeSemTempoReal({ visitante = false } = {}) {
    return visitante === true ? PARA_VISITANTE : PARA_CONTA;
}
