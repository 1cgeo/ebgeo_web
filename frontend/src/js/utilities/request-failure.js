// Path: js/utilities/request-failure.js

/**
 * @fileoverview WHY a request failed, as a value instead of as the bare fact of failing.
 *
 * ZERO IMPORTS, and that is a contract rather than an accident: the boot entries that consume
 * this include pages that boot WITHOUT the store, so anything reachable from here would be
 * dragged into `atlas.html`, `admin.html` and `calibracao.html`. It is imported by FILE
 * (`@utils/request-failure.js`), never through the `@utils` barrel, for the same reason
 * `tab-lock.js` is. WHO consumes it is not enumerated here on purpose: the census in
 * `tests/unit/falha-de-requisicao-nao-apaga-credencial.test.js` derives that list from
 * `git ls-files`, and a second list written in prose is the one that goes stale. This header
 * said "the three boot entries" while there were already four.
 *
 * O DEFEITO QUE ELE EXISTE PARA FECHAR foi medido em 2026-08-23 e era o mesmo nos dois lados:
 * `catch { apiClient.clearTokens(); }` byte a byte em `projects-page.js` e em `admin-page.js`.
 * Um 502 do proxy, um pico de latência ou um 429 apagavam a credencial em definitivo. O desfecho
 * ERA TERMINAL: naquela data o produto não tinha redefinição de senha por conta própria, e quem
 * não soubesse a senha de cor perdia a conta até falar com um administrador.
 *
 * **ISSO MUDOU NO MESMO LOTE QUE CRIOU ESTE ARQUIVO**, e o parágrafo acima já nascia desatualizado
 * porque enumerava as rotas de `auth` uma a uma: `POST /auth/forgot-password` e
 * `POST /auth/reset-password` existem, montadas sob `canDeliverAccountMail()`. A perda deixou de
 * ser terminal ONDE há canal de entrega, e continua terminal onde não há, que é justamente a
 * produção sem relay. A regra abaixo não afrouxa por causa disso: preservar a credencial custa um
 * recarregamento, e apagá-la à toa custa uma conta em metade dos ambientes.
 *
 * E este é o caminho PADRÃO do produto, não uma borda: `shouldRouteToProjects` manda todo
 * visitante com sessão numa URL nua para `atlas.html`, cuja primeira ação é justamente essa.
 *
 * A REGRA É "O STATUS DECIDE, NUNCA O MERO FATO DE FALHAR". A mesma regra já era aplicada em
 * dois outros lugares e nascia de novo em cada um: `isCredentialFailure`, que morava dentro de
 * `index.js` e era usada só ali, e `classifyFlushFailure` (`store/sync/sync-flush.js`), que
 * classifica a falha do laço de saída. Esta é a definição que os três consomem no eixo da
 * credencial; a do flush continua com as frases DELA, porque o que ela precisa dizer é sobre a
 * fila de saída e não sobre a sessão.
 *
 * A CLASSIFICAÇÃO FALHA FECHADA NO SENTIDO QUE PRESERVA A CREDENCIAL: só 401 e 403 são a
 * credencial respondendo por si mesma. Timeout, erro de rede, 429, 5xx e qualquer status que
 * ninguém previu caem em classes que NÃO autorizam apagar token. O erro de julgar demais custa
 * uma conta; o erro de julgar de menos custa um recarregamento.
 */

/**
 * As classes de falha que um pedido HTTP produz aqui.
 *
 * `UNKNOWN` não é lixo: é o status que ninguém previu, e ele existe para que um 418 ou um 451
 * não sejam silenciosamente tratados como credencial morta. Quem consome decide o desfecho,
 * mas nenhum consumidor deve apagar credencial fora de {@link RequestFailure.CREDENTIAL}.
 * @enum {string}
 */
export const RequestFailure = Object.freeze({
    /** 401/403: a credencial respondeu por si mesma. É a ÚNICA classe que autoriza descartá-la. */
    CREDENTIAL: 'credential',
    /** 404/410: o servidor respondeu que o alvo não está lá. */
    MISSING: 'missing',
    /** 429: o servidor respondeu, e a resposta é "agora não". */
    RATE_LIMITED: 'rate-limited',
    /** 5xx: o servidor falhou ao responder. Não diz nada sobre quem pediu. */
    SERVER: 'server',
    /** Sem status nenhum: rede caída, DNS, CORS, ou o `AbortError` do deadline de boot. */
    NETWORK: 'network',
    /** Um status que este código não classifica. Nunca tratado como credencial. */
    UNKNOWN: 'unknown',
});

/**
 * O status HTTP de um erro, ou `null` quando não houve resposta nenhuma.
 *
 * Lê os DOIS campos porque as duas formas circulam: `ApiError` (`store/sync/api-client.js`)
 * carrega `status`, e código mais antigo carrega `statusCode`. O `Number.isFinite` não é
 * paranoia: `error.status` chega como string em erro remontado a partir de JSON, e um
 * `'404' === 404` responderia falso calado. O zero vira `null` de propósito, porque
 * `res.status === 0` de uma resposta opaca é ausência de resposta, não um código.
 *
 * @param {*} error
 * @returns {number|null}
 */
export function requestStatus(error) {
    const raw = error?.status ?? error?.statusCode;
    const status = Number(raw);
    if (!Number.isFinite(status) || status <= 0) return null;
    return Math.trunc(status);
}

/**
 * A classe de falha de um erro de pedido.
 * @param {*} error
 * @returns {string} um valor de {@link RequestFailure}
 */
export function classifyRequestFailure(error) {
    const status = requestStatus(error);
    if (status === null) return RequestFailure.NETWORK;
    if (status === 401 || status === 403) return RequestFailure.CREDENTIAL;
    if (status === 404 || status === 410) return RequestFailure.MISSING;
    if (status === 429) return RequestFailure.RATE_LIMITED;
    if (status >= 500 && status <= 599) return RequestFailure.SERVER;
    return RequestFailure.UNKNOWN;
}

/**
 * Whether a failed request means the CREDENTIAL is dead (so the stored tokens must go) or
 * merely that the server could not answer right now (so they must stay).
 *
 * Only 401/403 are the credential answering for itself. A timeout (`getMe` runs with an 8 s boot
 * deadline), a network error or a 5xx say nothing about the token — and clearing it on those
 * logged the user out PERMANENTLY over a slow backend: the session did not come back when the
 * server recovered, the password had to be typed again.
 *
 * @param {*} error
 * @returns {boolean}
 */
export function isCredentialFailure(error) {
    return classifyRequestFailure(error) === RequestFailure.CREDENTIAL;
}
