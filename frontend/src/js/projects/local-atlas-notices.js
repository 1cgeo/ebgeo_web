// Path: js/projects/local-atlas-notices.js

/**
 * @module projects/local-atlas-notices
 * @description Turns a `LocalAtlasResult` into the ONE sentence the user hears. Pure: no DOM, no
 * toast, no store — the page calls it and hands the result to the toast service.
 *
 * WHY IT IS A MODULE AND NOT FOUR `if`s INSIDE THE HANDLERS. The refusals of the local-atlas API
 * (`store/local-atlas.api.js`) are its whole user-facing contract: hitting the ceiling of ten and
 * refusing to delete the last atlas are not errors, they are ANSWERS, and each already carries a
 * pt-BR sentence written next to the code that raises it. What the API cannot guarantee is that the
 * sentence reaches a human: a handler that checks `result.ok` and returns is a silent no-op, and a
 * silent no-op is indistinguishable from a broken button. `projects-page.js` boots on import and
 * lives in the DOM, so nothing in it can be exercised by a test; this can.
 *
 * THE INVARIANT IS "NEVER SILENT": every refusal produces an ERROR notice with a non-empty message,
 * whatever the result looks like — an unknown code, a result with no message, a result that is not
 * even an object. A generic sentence the user can act on beats a button that does nothing.
 *
 * SINCE 2026-08-24 IT ALSO CARRIES THE TWO SENTENCES SAID *BEFORE* THE API IS CALLED, and they are
 * here for the same reason as the ones above: they are the words, they are pure, and the two files
 * that would otherwise hold them (`projects-page.js` and `atlas-drive.js`) are respectively
 * boot-on-import and DOM. See {@link deleteAttempt} (the refusal that must arrive BEFORE the
 * destructive dialog, not after it) and {@link deleteConfirmMessage} (the dialog itself, which used
 * to talk about the server to a visitor who has no account).
 */

/** Severity of a notice, matching the three toast helpers of `@utils/toast_service.js`. */
export const NoticeKind = Object.freeze({
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error'
});

/**
 * Last-resort text for a refusal that carries none. It exists for a code added to `LocalAtlasError`
 * without a message, and for a result mangled on its way here: the point is that neither can turn
 * into silence.
 */
const RECUSA_GENERICA = 'Não foi possível concluir esta operação com o atlas local.';

/**
 * @typedef {Object} Notice
 * @property {'success'|'warning'|'error'} kind
 * @property {string} message - pt-BR, non-empty.
 */

/**
 * @param {*} value
 * @returns {string|null} A trimmed non-empty string, or null.
 */
function texto(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {Object} [result] - A `LocalAtlasResult`.
 * @returns {string|null} The affected atlas name, or null when there is none to quote.
 */
function nomeDoAtlas(result) {
    return texto(result?.atlas?.name);
}

/**
 * The notice for a refused operation. The API's own message wins, always: it is written next to the
 * rule that refused and knows what the user has to do about it.
 * @param {Object} [result] - A refused `LocalAtlasResult`.
 * @returns {Notice}
 */
export function refusalNotice(result) {
    return { kind: NoticeKind.ERROR, message: texto(result?.message) ?? RECUSA_GENERICA };
}

/**
 * @param {Object} [result] - Result of `createLocalAtlas`.
 * @returns {Notice}
 */
export function createNotice(result) {
    if (!result?.ok) return refusalNotice(result);
    const nome = nomeDoAtlas(result);
    return {
        kind: NoticeKind.SUCCESS,
        message: nome ? `Atlas "${nome}" criado.` : 'Atlas local criado.'
    };
}

/**
 * @param {Object} [result] - Result of `renameLocalAtlas`.
 * @returns {Notice}
 */
export function renameNotice(result) {
    if (!result?.ok) return refusalNotice(result);
    const nome = nomeDoAtlas(result);
    return {
        kind: NoticeKind.SUCCESS,
        message: nome ? `Atlas renomeado para "${nome}".` : 'Atlas local renomeado.'
    };
}

/**
 * The notice for a deletion, including the half-done case.
 *
 * `blockedDatabases` is a SUCCESS that must not sound like one: the slot left the registry, but
 * another tab was holding its databases open, so the files stayed on disk and that tab can still
 * write into them. Reporting it as a plain success is how a user ends up with data nothing can
 * reach (`atlas-namespace.js`, Decision 4).
 * @param {Object} [result] - Result of `deleteLocalAtlas`.
 * @returns {Notice}
 */
export function deleteNotice(result) {
    if (!result?.ok) return refusalNotice(result);
    const nome = nomeDoAtlas(result);
    if (result.blockedDatabases?.length > 0) {
        return {
            kind: NoticeKind.WARNING,
            message: `${nome ? `"${nome}"` : 'O atlas'} saiu da lista, mas outra aba ainda segurava `
                + 'os dados dele neste navegador. Feche as outras abas do EBGeo e recarregue esta '
                + 'página para concluir a exclusão.'
        };
    }
    return {
        kind: NoticeKind.SUCCESS,
        message: nome ? `Atlas "${nome}" excluído.` : 'Atlas local excluído.'
    };
}

/**
 * A recusa do ÚLTIMO atlas local, palavra por palavra a de `LocalAtlasError.LAST_ATLAS`.
 *
 * COPIADA, E NÃO IMPORTADA, de propósito: a mensagem mora num `const` privado de
 * `store/local-atlas.api.js`, que não a exporta, e importar aquele módulo aqui arrastaria o store
 * para dentro de um módulo folha que existe justamente para não ter imports. A duplicação é
 * declarada aqui e cobrada pelo teste, que compara as duas por leitura de arquivo.
 */
const ULTIMO_ATLAS =
    'Este é o seu único atlas local e não pode ser excluído. Crie outro antes de excluí-lo.';

/**
 * A RECUSA CHEGA ANTES DA PERGUNTA DESTRUTIVA, e essa é a correção inteira.
 *
 * O menu oferecia "Excluir" sem olhar o tamanho da lista, o diálogo encenava o texto vermelho de
 * irreversível, e só DEPOIS do "sim" a API devolvia `LAST_ATLAS`. Quem chega de primeira viagem tem
 * exatamente um atlas, então esse era o caminho comum: um susto encenado para uma recusa que já se
 * sabia.
 *
 * O ITEM CONTINUA SENDO DESENHADO, e isso não é descuido. "Ser o único" é ESTADO, reversível pela
 * própria pessoa (crie outro e ele deixa de sê-lo), e o contrato de afordância da casa manda o
 * comando de estado bloqueado ser desenhado e RECUSAR O CLIQUE nomeando o estado, porque o clique é
 * como o motivo chega. Só o bloqueio por POSTO some da tela.
 *
 * FALHA ABERTO em contagem que não é número: a autoridade continua sendo a API, que refaz a mesma
 * checagem e devolve a mesma frase. Um gate de tela que travasse por não saber contar tiraria da
 * pessoa uma operação legítima para proteger uma que a API já protege.
 *
 * @param {number} count - Quantos atlas locais a lista tem AGORA.
 * @returns {{allowed: boolean, notice: Notice|null}}
 */
export function deleteAttempt(count) {
    if (Number.isFinite(count) && count <= 1) {
        return { allowed: false, notice: { kind: NoticeKind.WARNING, message: ULTIMO_ATLAS } };
    }
    return { allowed: true, notice: null };
}

/**
 * O CORPO DO DIÁLOGO DE EXCLUSÃO, que MUDA com a existência de conta.
 *
 * A frase única falava de "trabalho ainda não enviado ao servidor", que é um fato real e importante
 * para quem tem sessão (a fila de saída de um atlas morre junto com os bancos dele) e é a descrição
 * de um caminho que o visitante anônimo NUNCA teve. Para ele a menção não assusta à toa, faz pior:
 * insinua que alguma coisa dali já foi ou seria enviada, contra o que a própria seção promete logo
 * acima ("Nada aqui vai para o servidor").
 *
 * As duas frases dizem a MESMA perda; só a segunda acrescenta a fila.
 *
 * @param {{signedIn?: boolean}} [options]
 * @returns {string} pt-BR, nunca vazia.
 */
export function deleteConfirmMessage({ signedIn = false } = {}) {
    const base = 'Os mapas, feições e imagens deste atlas serão apagados deste navegador';
    return signedIn
        ? `${base}, junto com qualquer trabalho ainda não enviado ao servidor. Não há como desfazer.`
        : `${base}. Não há como desfazer.`;
}
