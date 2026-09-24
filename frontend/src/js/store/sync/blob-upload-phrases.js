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
 * IT IS THE ONLY SOURCE, AND SINCE 2026-09-13 THAT IS LITERAL. `image-sync.js` used to compose its
 * own sentence for the toast it raises right after a failed upload (`imageUploadFailureNotice`),
 * from an object it built as `{ message: resultado.motivo }` — a shape that function never read,
 * since it looked only at `status`. So the toast threw away the sentence composed here and printed
 * a generic one, and its 403 and 413 branches were unreachable through that path. That function is
 * gone: the toast now shows the verdict's own `motivo`, which is what the pendency panel shows for
 * the same event. Two surfaces wording the same failure differently is how a person learns that one
 * of them is lying.
 *
 * ZERO IMPORTS by contract, like `denial-phrases.js` and `sync-phrases.js`: the queue is reached by
 * the outbound dispatcher, and a phrase must never be the reason a module graph grows an edge.
 */

/**
 * Why an attempt did not end with the bytes on the server.
 *
 * It is NOT the state of the record ({@link BlobUploadState}, in `blob-upload-queue.js`): four of
 * these six are transient or definitive in ways that state does not distinguish, and the same state
 * answers a different question ("will this be retried?").
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
    /** The account may not write pictures in this atlas. Definitive, and nothing about the file. */
    PERMISSAO: 'permissao',
    /** The file itself is the problem: format the server does not take, or size above its limit. */
    ARQUIVO: 'arquivo',
    /** The server answered and could not store it (its disk, its database). Retried. */
    SERVIDOR: 'servidor',
    /** The bytes are no longer in this browser, so nothing can ever be sent. */
    SEM_BYTES: 'sem-bytes',
});

/** HTTP statuses that mean "the file, not the request". 413 is size, 415 is media type. */
const STATUS_DE_ARQUIVO = new Set([413, 415]);

/**
 * The status that means the account, not the picture.
 *
 * IT IS SPLIT FROM {@link CausaDeFalha.RECUSA} because the two ask different things of the person:
 * a refusal is about the file, and the only useful next step is to change it; a 403 is about who is
 * asking, and changing the file does nothing. 401 is deliberately NOT here: `RECUSA_DEFINITIVA` in
 * `blob-upload-queue.js` does not treat it as definitive (a session can come back), so it never
 * reaches this branch and listing it would advertise a path that does not exist.
 */
const STATUS_DE_PERMISSAO = new Set([403]);

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
    if (STATUS_DE_ARQUIVO.has(status)) return CausaDeFalha.ARQUIVO;
    return STATUS_DE_PERMISSAO.has(status) ? CausaDeFalha.PERMISSAO : CausaDeFalha.RECUSA;
}

/**
 * The one case whose sentence is also written outside {@link fraseDeFalhaDeBlob}: the record whose
 * bytes vanished is closed without a transfer, so it never builds a verdict.
 */
export const FALHA_SEM_BYTES = 'O arquivo desta imagem não está mais neste computador, então '
    + 'não há o que enviar. A pendência fica registrada para você decidir.';

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
        case CausaDeFalha.PERMISSAO:
            return 'Você não tem permissão para enviar figuras neste atlas. Ela continua neste '
                + `computador, visível apenas para você, e reenviar não muda isso.${dito}`;
        case CausaDeFalha.RECUSA:
            return 'O servidor recusou esta figura, e reenviar não muda o desfecho. Ela continua '
                + `neste computador.${dito}`;
        case CausaDeFalha.SEM_RESPOSTA:
            return 'O servidor não respondeu sobre esta figura. O envio é retomado sozinho na '
                + 'próxima tentativa.';
        case CausaDeFalha.SERVIDOR:
            return 'O servidor não conseguiu guardar esta figura agora. O envio é retomado sozinho '
                + `na próxima tentativa.${dito}`;
        case CausaDeFalha.REDE:
        default:
            return 'A rede não completou o envio desta figura. Ele é retomado sozinho quando a '
                + 'conexão voltar.';
    }
}

/**
 * The notice of a figure the server refused, NAMING it and saying what the person can do.
 *
 * WHY A SECOND SENTENCE (2026-09-23). Since the image tool writes the feature while its bytes are
 * still going up, the refusal can arrive seconds or minutes after the gesture, when the person is
 * already doing something else: "esta figura" no longer points at anything on the screen. The name
 * is the handle the attribute table and the pendency panel also show. The pendency panel keeps
 * {@link fraseDeFalhaDeBlob}, which is written for a row that already sits next to the picture.
 *
 * Short on purpose (house rule of 2026-09-22): what happened, then the action.
 * @param {Object} params
 * @param {string|null} [params.nome] - The feature's name; a generic handle when there is none.
 * @param {string} [params.causa] - A value of {@link CausaDeFalha}.
 * @param {number|null} [params.status] - HTTP status, when there was an answer.
 * @returns {string}
 */
export function avisoDeFiguraRecusada({ nome = null, causa, status = null } = {}) {
    const rotulo = textoOuNulo(nome);
    const qual = rotulo ? `A figura "${rotulo}"` : 'Uma figura';
    const inicio = `${qual} não foi enviada ao servidor e aparece só para você.`;
    switch (causa) {
        case CausaDeFalha.ARQUIVO:
            return status === 413
                ? `${inicio} Ela é grande demais: insira uma versão menor.`
                : `${inicio} O formato não é aceito: insira a figura em outro formato.`;
        case CausaDeFalha.PERMISSAO:
            return `${inicio} Seu acesso a este atlas não permite enviar figuras: peça ao gestor do atlas.`;
        case CausaDeFalha.SEM_BYTES:
            return `${inicio} O arquivo não está mais neste computador: insira a figura de novo.`;
        default:
            return `${inicio} Ela está nas pendências para revisão.`;
    }
}

/**
 * The notice of an attached PHOTO the server refused, naming the PHOTO and saying what the person
 * can do (2026-09-24, second review of the attached photos).
 *
 * {@link avisoDeFiguraRecusada} spoke of a "figura" and told the person to insert it in another
 * format, which for an old inline photo that an edit converted points at a gesture nobody made. The
 * two photos also end differently, and the sentence says which: an ATTACHED one is released, so the
 * colleagues get the reference and see only its thumbnail; a CONVERTED one holds the edit that
 * carried it in the pendencies (`aplicarRecusa`, `blob-upload-queue.js`).
 * @param {Object} params
 * @param {string|null} [params.nome] - The photo's file name; a generic handle when there is none.
 * @param {string} [params.causa] - A value of {@link CausaDeFalha}.
 * @param {number|null} [params.status] - HTTP status, when there was an answer.
 * @param {boolean} [params.convertida] - Whether it is an old inline photo that an edit converted.
 * @returns {string}
 */
export function avisoDeFotoRecusada({ nome = null, causa, status = null, convertida = false } = {}) {
    const rotulo = textoOuNulo(nome);
    const qual = rotulo ? `A foto "${rotulo}"` : 'Uma foto anexa';
    if (causa === CausaDeFalha.PERMISSAO) {
        return `${qual} não foi enviada ao servidor: seu acesso a este atlas não permite enviar fotos. Peça ao gestor do atlas.`;
    }
    if (convertida) {
        return `${qual} não foi enviada ao servidor, e a edição que a levava ficou nas pendências. Abra as pendências para decidir.`;
    }
    const inicio = `${qual} não foi enviada ao servidor, e os colegas veem só a miniatura.`;
    switch (causa) {
        case CausaDeFalha.ARQUIVO:
            return status === 413
                ? `${inicio} Anexe uma versão menor.`
                : `${inicio} Anexe a foto em JPEG ou PNG.`;
        case CausaDeFalha.SEM_BYTES:
            return `${inicio} O arquivo não está mais neste computador: anexe a foto de novo.`;
        default:
            return `${inicio} Ela está nas pendências para revisão.`;
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
