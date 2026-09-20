// Path: js/ui/searchable-select.model.js

/**
 * @fileoverview Pure filtering for the searchable select (`ui/searchable-select.js`): given the
 * controlled list and whatever the person typed, decide WHICH options show and in WHICH order.
 *
 * ZERO IMPORTS BY CONTRACT, like `store/feature-type.registry.js` and `utilities/person-label.js`: it
 * is what keeps the file loadable in plain node (no alias resolution, no DOM) and importable from
 * `atlas.html`, which boots without the store. The DOM half lives next door and imports this.
 *
 * TWO PROPERTIES THAT ARE NOT STYLE:
 *
 * 1. THE MATCH IS SUBSTRING, NEVER REGEX. The term comes from a keyboard, so `(`, `*`, `[` and `+`
 *    are ordinary characters a unit name may contain; building a `RegExp` out of it would throw on
 *    "(" and silently match the wrong rows on "*". `indexOf` over the normalised strings has no
 *    such edge.
 * 2. NORMALISATION IS NFD-AND-STRIP, so "Servico" finds "Serviço". Accents are the rule in
 *    Portuguese unit names and the exception on a keyboard in a hurry; a filter that demands them
 *    is a filter that answers "nothing found" to a term that is right. THE ORDINAL IS A SEPARATE,
 *    EXPLICIT RULE (see `normalizarBusca`): NFD leaves "º" intact, and this header promised the
 *    opposite until a review measured it.
 *
 * ORDER IS RANKED, NOT ALPHABETICAL: what the person typed the START of comes first (the acronym
 * before the name), then what merely contains it. Inside a rank the CALLER's order survives, which
 * for the military organisations is `sort_order` from the server, not the alphabet.
 */

/** Rank of a match, lower first. Exported so the tests can name what they assert. */
export const MatchRank = Object.freeze({
    /** The acronym starts with the term ("DSG" typed, "DSG" the sigla). */
    SIGLA_PREFIXO: 0,
    /** The name starts with the term. */
    NOME_PREFIXO: 1,
    /** The acronym contains the term. */
    SIGLA_CONTEM: 2,
    /** The name contains the term. */
    NOME_CONTEM: 3,
    /** No match: the option is dropped. */
    FORA: 4,
});

/**
 * Folds a piece of text to the form the filter compares: no accents, lower case, single spaces.
 * A non-string (null, undefined, a number that slipped out of a payload) folds to the empty
 * string rather than throwing, because this runs on every keystroke and on server data.
 * @param {*} texto
 * @returns {string}
 */
export function normalizarBusca(texto) {
    if (typeof texto !== 'string') return '';
    return texto
        // THE ORDINAL IS FOLDED AWAY, on both sides. Army unit names START with one ("1º Centro de
        // Geoinformação", "2ª Cia"), so it is the first thing a person types, and keyboards
        // disagree on how: "1º", "1°" (the degree sign, one key away on ABNT2), "1o" or a bare
        // "1". NFD does not touch º/ª (their decomposition is a COMPATIBILITY one), which is how
        // "1o cgeo" used to answer "Nenhuma unidade encontrada" for a unit that was right there.
        .replace(/[ºª°]/g, '')
        .replace(/(\d)[oa](?=\s|$)/gi, '$1')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * How well one option matches a folded term.
 * @param {{ label?: string, sigla?: string }} item
 * @param {string} termo - Already folded by `normalizarBusca`.
 * @returns {number} One of `MatchRank`.
 */
function postoDeMatch(item, termo) {
    const nome = normalizarBusca(item?.label);
    const sigla = normalizarBusca(item?.sigla);
    if (sigla && sigla.startsWith(termo)) return MatchRank.SIGLA_PREFIXO;
    if (nome.startsWith(termo)) return MatchRank.NOME_PREFIXO;
    if (sigla && sigla.includes(termo)) return MatchRank.SIGLA_CONTEM;
    if (nome.includes(termo)) return MatchRank.NOME_CONTEM;
    return MatchRank.FORA;
}

/**
 * The options to show for a typed term.
 *
 * An EMPTY OR BLANK term is not "no match", it is "no filter": the whole list comes back in the
 * caller's order, which is what makes the closed combobox openable as a plain list. An item with
 * no `value` is dropped whatever the term, because choosing it would submit nothing.
 *
 * @param {Array<{ value: string, label: string, sigla?: string }>} itens
 * @param {string} termo - Raw text from the input; folded here.
 * @returns {Array<{ value: string, label: string, sigla?: string }>} A new array; inputs untouched.
 */
export function filtrarOpcoes(itens, termo) {
    if (!Array.isArray(itens)) return [];
    const validos = itens.filter((item) => item && item.value);
    const alvo = normalizarBusca(termo);
    if (!alvo) return validos.slice();

    const pontuados = [];
    for (let i = 0; i < validos.length; i += 1) {
        const posto = postoDeMatch(validos[i], alvo);
        if (posto !== MatchRank.FORA) pontuados.push({ item: validos[i], posto, i });
    }
    // Stable by construction: the original index breaks every tie, so the caller's ordering
    // (sort_order from the server, not the alphabet) survives inside each rank.
    pontuados.sort((a, b) => (a.posto - b.posto) || (a.i - b.i));
    return pontuados.map((p) => p.item);
}
