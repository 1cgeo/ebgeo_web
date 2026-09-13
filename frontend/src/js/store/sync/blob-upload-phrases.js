// Path: js/store/sync/blob-upload-phrases.js

/**
 * @fileoverview What a failed image upload SAYS, as pure functions: no DOM, no store, no imports.
 *
 * WHY IT EXISTS. The pendency panel showed `Failed to fetch`, raw and in English, as the reason of
 * a picture that had not reached the server. That string is written by the browser, not by this
 * product: it names the layer that failed (`fetch`) to a person who never heard of it, in a screen
 * that is entirely in pt-BR, and it says nothing about what happens next, which is the only thing
 * the person can act on. The raw message did not stop being useful, it stopped being the thing on
 * the screen: it is kept beside the phrase, in `ultimoErroCru`, and no surface renders it.
 *
 * THE CAUSE TRAVELS, IT IS NOT GUESSED FROM THE TEXT. Each producer of a verdict in
 * `blob-upload-queue.js` already knows why it failed (a chunk that got no answer at all, an answer
 * that refused, a format rejected before the first byte left), so the verdict carries a `causa` and
 * this module composes from it. Sniffing the message for words like "fetch" or "type" would be a
 * classifier over strings written by three different layers, two of which are outside this
 * repository, and it would silently reclassify itself the day one of them reworded anything.
 *
 * A REFUSAL QUOTES THE SERVER, A NETWORK FAILURE DOES NOT. When the server answers refusing, its
 * own words are the only thing that tells the person what to change about the picture, so they are
 * quoted. When nothing arrived, the message is a transport string ("Failed to fetch", "NetworkError
 * when attempting to fetch resource") and quoting it just moves the same puzzle one line down.
 *
 * ZERO IMPORTS by contract, like `denial-phrases.js` and `sync-phrases.js`: the queue is reached by
 * the outbound dispatcher, and a phrase must never be the reason a module graph grows an edge.
 */

/**
 * Why an attempt did not end with the bytes on the server.
 *
 * It is NOT the state of the record ({@link BlobUploadState}, in `blob-upload-queue.js`): three of
 * these five are transient and two are definitive, and the same state answers a different question
 * ("will this be retried?").
 * @readonly
 * @enum {string}
 */
export const CausaDeFalha = Object.freeze({
    /** Nothing arrived: no answer, a dropped connection, an aborted request. Retried. */
    REDE: 'rede',
    /** The answer came back and did not mention this id. Retried, because silence is not refusal. */
    SEM_RESPOSTA: 'sem-resposta',
    /** The server answered refusing. No retry changes it. */
    RECUSA: 'recusa',
    /** The file itself is the problem: format the server does not take, or size above its limit. */
    ARQUIVO: 'arquivo',
    /** The bytes are no longer in this browser, so nothing can ever be sent. */
    SEM_BYTES: 'sem-bytes',
});

/** HTTP statuses that mean "the file, not the request". 413 is size, 415 is media type. */
const STATUS_DE_ARQUIVO = new Set([413, 415]);

/**
 * @param {*} valor
 * @returns {string|null} The trimmed message, or null when there is nothing worth keeping.
 */
function textoOuNulo(valor) {
    if (typeof valor !== 'string') return null;
    const limpo = valor.trim();
    return limpo === '' ? null : limpo;
}

/**
 * The server's own words, appended to a phrase, or nothing.
 * @param {string|null} mensagem
 * @returns {string}
 */
function oServidorDisse(mensagem) {
    return mensagem === null ? '' : ` O servidor disse: «${mensagem}».`;
}

/**
 * Which cause a thrown transport error means.
 *
 * USED ONLY WHERE THE CAUSE IS NOT KNOWN: the `catch` around the transfer, where all there is is an
 * exception. Everywhere else the producer states the cause outright.
 * @param {{status: (number|null), definitiva: boolean}} params
 * @returns {string} A value of {@link CausaDeFalha}.
 */
export function causaDeErroLancado({ status, definitiva }) {
    if (!definitiva) return CausaDeFalha.REDE;
    return STATUS_DE_ARQUIVO.has(status) ? CausaDeFalha.ARQUIVO : CausaDeFalha.RECUSA;
}

/**
 * The one case whose sentence is also written outside {@link fraseDeFalhaDeBlob}: the record whose
 * bytes vanished is closed without a transfer, so it never builds a verdict.
 */
export const FALHA_SEM_BYTES = 'Os bytes desta imagem não estão mais neste computador. '
    + 'Não há o que reenviar, e a pendência fica registrada para você decidir.';

/**
 * The pt-BR sentence for one failed attempt.
 *
 * EVERY BRANCH SAYS WHAT HAPPENS NEXT, because that is the half the raw message never had: retried
 * on its own, or waiting for a person. A pendency the person cannot act on and cannot forget is the
 * shape of a notice people learn to ignore.
 * @param {Object} desfecho
 * @param {string} [desfecho.causa] - A value of {@link CausaDeFalha}.
 * @param {string|null} [desfecho.motivo] - The server's reason, when the server gave one.
 * @param {number|null} [desfecho.status] - HTTP status, when there was an answer.
 * @returns {string} A sentence, always non-empty.
 */
export function fraseDeFalhaDeBlob({ causa, motivo = null, status = null } = {}) {
    const dito = oServidorDisse(textoOuNulo(motivo));
    switch (causa) {
        case CausaDeFalha.SEM_BYTES:
            return FALHA_SEM_BYTES;
        case CausaDeFalha.ARQUIVO:
            return status === 413
                ? 'A figura é grande demais para o servidor, e reenviar não muda isso. Ela continua '
                    + `neste computador.${dito}`
                : 'O servidor não aceita o formato desta figura, e reenviar não muda isso. Ela '
                    + `continua neste computador.${dito}`;
        case CausaDeFalha.RECUSA:
            return 'O servidor recusou esta figura, e reenviar não muda o desfecho. Ela continua '
                + `neste computador.${dito}`;
        case CausaDeFalha.SEM_RESPOSTA:
            return 'O servidor não respondeu sobre esta figura. O envio é retomado sozinho na '
                + 'próxima tentativa.';
        case CausaDeFalha.REDE:
        default:
            return 'A rede não completou o envio desta figura. Ele é retomado sozinho quando a '
                + 'conexão voltar.';
    }
}

/**
 * The raw message, kept for diagnosis and never rendered.
 *
 * IT IS A SEPARATE FIELD ON PURPOSE. Folding it into the phrase would put an English transport
 * string back on a pt-BR screen; dropping it would leave whoever reads an exported pendency with a
 * sentence this repository wrote and no trace of what the network or the server actually said.
 * @param {*} motivo
 * @returns {string|null}
 */
export function mensagemCrua(motivo) {
    return textoOuNulo(motivo);
}
