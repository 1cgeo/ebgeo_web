// Path: js/session/sessao-id.js

/**
 * @fileoverview THE ID OF THIS TAB, AND THE SESSION IS THE TAB: it survives F5.
 *
 * It lives in `sessionStorage`, so one UUID spans every load of the same tab until the tab is
 * closed, and a reload does NOT mint a new one. That is the whole point, and it was decided
 * again on 2026-09-13 (D5) after a release had moved the singleton to memory-only: correlating
 * errors by session is the diagnostic instrument, and a reload is the single most common thing a
 * person does when something breaks, so an id that resets on F5 splits exactly the trail someone
 * is trying to follow. The same value rides the `X-EBGeo-Sessao` header of every REST request,
 * which is what stitches a browser report to the server line written in the same instant.
 *
 * IT IS NOT AN IDENTITY. It does not say who the person is (that is the cookie's or the token's
 * job), it does not outlive the tab, and it is not shared between tabs: `sessionStorage` rather
 * than `localStorage` is the entire choice. Two tabs of the same user are two values, which is
 * precisely what is wanted when the defect is "only in one tab". Usage telemetry mints a fresh id
 * of its own when the logged-in user CHANGES (`uso-telemetria.js`), so that one person's rows are
 * never attributed to the next; only boot reads this storage.
 *
 * WHY IT MINTS ITS OWN UUID instead of using the house `generateUUID()`, and the reason is NOT the
 * barrel: `utilities/uuid.js` is a leaf and imports nothing. The reason is that `generateUUID()`
 * calls `crypto.getRandomValues` with NO guard, and `crypto` exists in neither an insecure context
 * (an `http:` origin that is not localhost) nor an old browser: the call THROWS. That is
 * unacceptable here, because this value is read on the first line of all four pages' boot and
 * inside the error capturer, the two worst places in the product for an exception.
 * {@link sortearUuid} does the same thing wrapped in `try` with a fallback path, and that is the
 * only reason it exists. The file is a LEAF, with ZERO IMPORTS, like the other telemetry decision
 * modules, but that is a property of it, not the reason for the duplication.
 *
 * EVERY STORAGE ACCESS SITS INSIDE A `try`. In private mode, with third-party cookies blocked or
 * with site storage disabled, reading `sessionStorage` does not return `null`: it THROWS, and a
 * throw from here would take down the first line of all four pages' boot for the most dispensable
 * field of a report. The outcome of a failure is a memory-only id, alive as long as the page is,
 * which is exactly what is needed to group whatever happens in it.
 */

/** Onde o id mora. Prefixado, porque o `sessionStorage` é compartilhado com tudo da origem. */
export const CHAVE_DA_SESSAO = 'ebgeo:sessao-id';

/**
 * A forma que o servidor aceita. O corpo do relato só carrega o campo se ele casar isto, pelo
 * mesmo motivo do `atlasId`: a coluna é `uuid`, e um valor de outra forma custaria o relato
 * INTEIRO num 422 por causa do campo mais dispensável dele.
 */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O sorteio de reserva, para quando `crypto.randomUUID` não existe.
 *
 * ELE NÃO É EQUIVALENTE, e a diferença está declarada aqui para não ser descoberta por engano:
 * `randomUUID` é criptograficamente forte, e `Math.random` não é. Isto não importa para o uso
 * (agrupar relatos de uma aba não é segredo nem credencial, e o valor não autoriza nada), e a
 * alternativa seria não ter id nenhum em navegador antigo ou em contexto não seguro, onde
 * `crypto.randomUUID` simplesmente não é exposto. `getRandomValues` é tentado primeiro porque ele
 * é exposto em mais lugares que `randomUUID`.
 * @returns {string} Um UUID na forma da versão 4.
 */
function sortearUuid() {
    const bytes = new Uint8Array(16);
    let preenchido = false;
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
            crypto.getRandomValues(bytes);
            preenchido = true;
        }
    } catch {
        preenchido = false;
    }
    if (!preenchido) {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    // Versão 4 e variante RFC 4122, para que o valor case a forma que o servidor valida.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** O cunhador padrão: `crypto.randomUUID` quando existe, sorteio quando não. @returns {string} */
function uuidPadrao() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        // Contexto não seguro, ou `crypto` sequestrado: cai no sorteio.
    }
    return sortearUuid();
}

/**
 * Uma fábrica de id de sessão sobre um armazenamento injetado.
 *
 * FÁBRICA E SINGLETON, os dois: o singleton é o que o produto usa (uma aba, um id), e a fábrica é
 * o que torna as três propriedades testáveis em node puro, onde não existe `sessionStorage`
 * nenhum — cunha uma vez, reusa o que já está guardado, e degrada para a memória quando o
 * armazenamento recusa.
 *
 * @param {Object} [opcoes]
 * @param {{getItem: Function, setItem: Function}|null} [opcoes.storage] - O armazenamento. `null`
 *   é um valor legítimo e significa "só memória".
 * @param {() => string} [opcoes.uuid] - O cunhador. Um retorno que não seja UUID é descartado e
 *   substituído pelo sorteio, porque um valor de outra forma não chega ao servidor.
 * @param {string} [opcoes.chave] - A chave no armazenamento.
 * @returns {() => string} A função que devolve SEMPRE o mesmo id para esta página.
 */
export function criarSessaoId({ storage, uuid = uuidPadrao, chave = CHAVE_DA_SESSAO } = {}) {
    /** O id desta página, uma vez resolvido. Memorizar é o que sustenta o caso degradado. */
    let memoria = null;

    return function sessaoIdDaAba() {
        if (memoria) return memoria;

        let guardado = null;
        try {
            guardado = storage?.getItem(chave) ?? null;
        } catch {
            guardado = null;
        }
        if (typeof guardado === 'string' && RE_UUID.test(guardado)) {
            memoria = guardado;
            return memoria;
        }

        let novo = null;
        try {
            novo = uuid();
        } catch {
            novo = null;
        }
        if (typeof novo !== 'string' || !RE_UUID.test(novo)) novo = sortearUuid();

        try {
            storage?.setItem(chave, novo);
        } catch {
            // Modo privado, cota estourada, armazenamento bloqueado: o id vive só na memória, e
            // isso basta para agrupar o que acontecer nesta carga da página.
        }
        memoria = novo;
        return memoria;
    };
}

/** O `sessionStorage` da página, ou `null` quando lê-lo lança. */
let _armazenamento = null;
try {
    _armazenamento = globalThis.sessionStorage ?? null;
} catch {
    // Só acessar a propriedade já lança com o armazenamento bloqueado; daí o `try` em volta de
    // uma linha que parece não precisar de um.
    _armazenamento = null;
}

/**
 * O id desta aba. Mesmo valor em toda chamada, em toda a vida da ABA, F5 incluído.
 * @returns {string}
 */
export const sessaoId = criarSessaoId({ storage: _armazenamento });
