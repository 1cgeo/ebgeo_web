// Path: js/utilities/person-label.js

/**
 * @fileoverview How a PERSON is named on screen, in the military form: rank plus war name,
 * with the unit beside it ("Cap Silva · 1º CGEO").
 *
 * WHY THIS IS A DOMAIN RULE AND NOT A PREFERENCE. In the Army nobody is identified by their
 * full civil name: a document, a roster and a radio call all say `Cap Silva`, and the war name
 * ("nome de guerra") is the name the person CHOSE to be called by — it may not even be a
 * substring of `nome` (`João Batista de Souza` known as `Silva` is ordinary). A sharing screen
 * that writes `João Batista de Souza` forces the reader to translate before recognising a
 * colleague, and two people with similar full names are told apart by rank and unit, not by
 * the surname alone.
 *
 * ZERO IMPORTS, BY CONTRACT. This is a leaf: it is reached from `modals/sharing.modal.core.js`,
 * which is held to a closed import list by `frontend/tests/unit/compartilhar-sem-a-store.test.js`
 * because the modal has to load inside `atlas.html`, a page that boots WITHOUT the store. Pull
 * anything in here and that page pays for it. It is also what makes the function testable in
 * plain node, with no alias resolution.
 *
 * IT READS BOTH SPELLINGS OF EVERY FIELD, and that is not sloppiness: the two payloads that
 * feed the same screen disagree by contract. `GET /users/search` answers in snake_case (it is
 * the row of `users` projected almost verbatim) and `GET /atlas/:id/sharing` answers in
 * camelCase (its own integration test asserts that "snake_case must NOT leak"). Normalising at
 * three call sites is three chances to miss one; normalising here is one place that fails the
 * same way for everybody.
 *
 * THE LABEL IS NEVER EMPTY. A row with no usable name is still a person holding access to the
 * atlas, and dropping it would shorten the list without lowering the count printed beside it.
 * The last rung is the login, and the one after that is a word.
 */

/** The last resort, when the payload carries no name and no login at all. */
const SEM_NOME = 'Alguém';

/** What separates the unit from the login on the secondary line. */
const SEPARADOR = ' · ';

/**
 * First non-empty trimmed string among `keys`, read off `person`.
 * @param {Object|null|undefined} person
 * @param {string[]} keys - Tried in order; the first that yields text wins.
 * @returns {string} '' when none of them carries text.
 */
function primeiroTexto(person, keys) {
    for (const key of keys) {
        const bruto = person?.[key];
        // `String(null)` is 'null', which is why the type is checked before trimming: a JSON
        // null in any of these columns is the COMMON case (rank, unit and war name are all
        // nullable), and stringifying it would print the word 'null' on screen.
        if (typeof bruto !== 'string' && typeof bruto !== 'number') continue;
        const texto = String(bruto).trim();
        if (texto) return texto;
    }
    return '';
}

/**
 * The military identity of one person, ready to be drawn.
 *
 * THE FALLBACK CHAIN OF `label` IS THE WHOLE DESIGN, and each rung exists because the column
 * below it is nullable in `users`:
 *   1. rank + war name       → `Cap Silva`        (the intended form)
 *   2. rank + full name      → `Cap João Souza`   (account with no war name yet)
 *   3. war name alone        → `Silva`            (civilian account, or rank not set)
 *   4. full name alone       → `João Souza`
 *   5. `@login`              → `@jsouza`          (account with no name at all)
 *   6. `Alguém`
 *
 * `handle` GOES EMPTY WHEN THE LABEL ALREADY IS THE LOGIN (rung 5), so the row never draws
 * `@jsouza` twice. This is the one piece of state the caller cannot re-derive cheaply, and
 * getting it wrong looks like a rendering bug rather than a missing name.
 *
 * `detail` IS THE COMPOSITION, and it lives here instead of at the call sites for the reason
 * the whole module exists: the sharing modal draws three kinds of person row (the owner, a
 * participant, a search hit) and a fourth in read-only mode. Four copies of `[unit, handle]
 * .filter(Boolean).join(' · ')` is four chances for one of them to drift.
 *
 * `name` IS THE LABEL WITHOUT THE RANK, and it exists for exactly one caller: the avatar.
 * `getInitials('Cap Silva')` is `CS`, so every Capitão in the list would share the first
 * letter and the badge would stop identifying anybody — the rank is a POST, not a name.
 * Feeding it `Silva` gives `SI`, which is what the badge meant before the rank was added.
 *
 * @param {{nome?: *, nome_guerra?: *, nomeGuerra?: *, posto_graduacao?: *, postoGraduacao?: *,
 *   organizacao_militar?: *, organizacaoMilitar?: *, organizacao_militar_sigla?: *,
 *   organizacaoMilitarSigla?: *, username?: *}|null|undefined} person
 * @returns {{label: string, name: string, unit: string, handle: string, detail: string}}
 *   `label` is never empty; the other four are '' when the payload does not carry them.
 */
export function militaryPersonLabel(person) {
    const posto = primeiroTexto(person, ['posto_graduacao', 'postoGraduacao']);
    const guerra = primeiroTexto(person, ['nome_guerra', 'nomeGuerra']);
    const nome = primeiroTexto(person, ['nome']);
    const username = primeiroTexto(person, ['username']);
    // The abbreviation first, then the long form: `1º CGEO` fits the column that
    // `1º Centro de Geoinformação` overflows, and the server already coalesces one into the
    // other. The second pair is read for payloads that only ever carried the long name.
    const unit = primeiroTexto(person, [
        'organizacao_militar_sigla', 'organizacaoMilitarSigla',
        'organizacao_militar', 'organizacaoMilitar',
    ]);

    const chamado = guerra || nome;
    let label;
    if (chamado) {
        label = posto ? `${posto} ${chamado}` : chamado;
    } else if (username) {
        label = `@${username}`;
    } else {
        label = SEM_NOME;
    }

    const handle = username && chamado ? `@${username}` : '';
    const detail = [unit, handle].filter(Boolean).join(SEPARADOR);

    return { label, name: chamado, unit, handle, detail };
}
