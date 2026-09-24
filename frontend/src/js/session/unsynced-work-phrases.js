// Path: js/session/unsynced-work-phrases.js

/**
 * @fileoverview What the UI SAYS about work the server never received when a session ends, as pure
 * functions. Zero imports, so it loads in plain node and can be reached from a page that never
 * boots the store (`atlas.html`, `admin.html`).
 *
 * WHY IT EXISTS. Clicking "Sair" used to wipe the outbound queue without a word: the voluntary
 * path never even counted it (`pendingOps` was hard-wired to 0 unless the session died on its
 * own), so the namespace teardown took the pending operations with it. The mechanism to keep that
 * work already existed and was wired only to the involuntary path.
 *
 * Voluntary logout confirms pending-work loss (2026-09-12). Rescue notices below describe
 * involuntary session endings; `confirm-logout.js` owns the explicit exit dialog.
 *
 * THE NUMBER IS THE POINT, not decoration. "Você tem trabalho não enviado" and "você tem 47
 * operações não enviadas" produce different readings from the same person. Every phrase below that
 * can carry the count carries it.
 *
 * UNKNOWN IS NOT ZERO, and the distinction decides whether work survives. The queue read can fail
 * (IndexedDB unavailable, a scope torn down mid-read), and it answers with a non-finite number.
 * Treating that as "nothing pending" would destroy on the strength of a measurement that just
 * broke; every unknown here says out loud that it could not count, and `shouldPreserveLocalWork`
 * preserves on it for the same reason.
 */

/**
 * What the exit guard actually did. It travels on the query string between a page WITHOUT a map
 * and the map (`?trabalho=<valor>`), so these values are a wire format, not an internal label.
 *
 * IT LIVES IN THE PURE MODULE, next to the sentences it keys, and that placement is the point:
 * whoever builds the sentence and whoever reads the URL agree on the same frozen object instead of
 * on a string literal typed twice. A renamed value then breaks loudly, instead of making the phrase
 * table quietly stop matching, which is the failure mode of a loose literal.
 *
 * Confirmed discard is handled before navigation and does not use this rescue URL channel.
 * @readonly
 * @enum {string}
 */
export const ExitOutcome = Object.freeze({
    /** Nothing was at stake: no server atlas mounted, or an empty queue. */
    NADA: 'nada',
    /** The work is on record as a local atlas. */
    GUARDADO: 'guardado',
    /** There was work to keep and the rescue FAILED. The loudest of the three. */
    FALHOU: 'falhou',
});

/**
 * What became of the unsent work of the OTHER server atlases an involuntary exit looked at (the
 * ones the tab left), apart from the mounted one. It travels as `?outros=` (a comma list of the
 * codes present), next to `?trabalho=`, because one code for both made "the mounted atlas was
 * kept, another was only retained" read as a failure of the mounted atlas. A wire format, like
 * {@link ExitOutcome}.
 */
export const OtherAtlasesOutcome = Object.freeze({
    /** Became local atlases. */
    GUARDADO: 'guardado',
    /** Could not become local atlases; kept for a while by the retention veto. */
    RETIDO: 'retido',
    /** Neither: the sweep of the same exit destroyed them. */
    PERDIDO: 'perdido',
});

/**
 * A pending-operation count as a non-negative integer, or NaN for "could not be measured".
 *
 * The sibling in `admin/group-phrases.js` collapses every oddity to 0, because there a wrong count
 * misspells a label. Here 0 means "nothing was at stake", so collapsing garbage into it would
 * silently claim an empty queue. Everything that is not a finite, non-negative number becomes NaN.
 *
 * `Infinity` lands on NaN by the same rule, which keeps it consistent with `shouldPreserveLocalWork`
 * (where a non-finite count also preserves).
 *
 * THE TYPE CHECK COMES BEFORE `Number()`, AND IT IS THE WHOLE POINT. `Number(null)`, `Number('')`,
 * `Number([])` and `Number(false)` are all 0, so a coercion-first version answers "queue empty" to
 * four different ways of saying "no answer". Only a number or a non-blank numeric string is a count.
 *
 * @param {*} value
 * @returns {number} A non-negative integer, or NaN.
 */
export function toPendingCount(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return NaN;
    if (typeof value === 'string' && value.trim() === '') return NaN;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.trunc(n);
}

/**
 * "1 alteração" / "12 alterações" (the count of queued operations, in the person's word), and a
 * phrase instead of a number when it could not be counted.
 * @param {*} value
 * @returns {string}
 */
export function pendingOpsLabel(value) {
    const n = toPendingCount(value);
    if (Number.isNaN(n)) return 'um número desconhecido de alterações';
    return `${n} ${n === 1 ? 'alteração' : 'alterações'}`;
}

/**
 * "1 alteração" / "12 alterações", the word the exit DIALOG uses.
 *
 * Since 2026-09-22 {@link pendingOpsLabel} says the same word: "operação" is the unit the queue and
 * the diagnostics speak in, and on a toast or a dialog it was jargon the person could not map to
 * anything they did. The count is still the queue's; only the word changed. This helper stays
 * separate because it takes an already-validated integer and has no "unknown" branch.
 * @param {number} n - A non-negative integer.
 * @returns {string}
 */
function alteracoes(n) {
    return `${n} ${n === 1 ? 'alteração' : 'alterações'}`;
}

/**
 * THE FIRST SENTENCE OF THE EXIT DIALOG, which now names the QUARANTINE separately.
 *
 * WHY TWO NUMBERS. The total includes work the server REFUSED, or that this build will not replay,
 * and the confirmed discard PRESERVES that part instead of destroying it (decision D2 of
 * 2026-09-13). Saying only "há 12 operações com envio pendente" and then announcing that
 * everything pending would be lost was wrong in both halves for those operations: they were not
 * going to be sent, and they are not going to be lost.
 *
 * THE SUBTRACTION IS THE POINT: the quarantine is PART of the total, because both come from the
 * same queue, so the sentence says how much is waiting to be SENT (the total minus the quarantine)
 * and names the quarantine on its own. A negative difference should be impossible and is clamped
 * anyway: an issue record left behind by an atlas written before the journal poda could make the
 * second number larger than the first, and "há -2 alterações" would discredit the whole dialog.
 *
 * UNKNOWN DEGRADES IN TWO STEPS. An unknown TOTAL keeps the sentence that says so, because that
 * count is what decides whether anything is at stake at all. An unknown QUARANTINE falls back to
 * the single-number sentence: better to say less than to promise that something survives when
 * nobody could measure it.
 * @param {*} total - Pending-operation count, or a non-finite value for "unknown".
 * @param {*} [quarantined] - How many of those are in quarantine; non-finite for "unknown".
 * @returns {string}
 */
export function pendingWorkSummary(total, quarantined) {
    const t = toPendingCount(total);
    if (Number.isNaN(t)) {
        return 'Não foi possível verificar se há alterações ainda não enviadas ao servidor.';
    }
    const q = toPendingCount(quarantined);
    if (Number.isNaN(q) || q === 0) {
        return `Há ${pendingOpsLabel(t)} que ainda não ${t === 1 ? 'chegou' : 'chegaram'} ao servidor.`;
    }
    const aguardando = Math.max(0, t - q);
    if (aguardando === 0) {
        return `Há ${alteracoes(q)} ${q === 1 ? 'guardada' : 'guardadas'} para revisão e nada `
            + 'aguardando envio ao servidor.';
    }
    return `Há ${alteracoes(aguardando)} aguardando envio ao servidor e `
        + `${q} ${q === 1 ? 'guardada' : 'guardadas'} para revisão.`;
}

/**
 * The half-sentence saying the quarantine SURVIVES the discard, or nothing at all.
 *
 * It is its own function because the dialog body is a paragraph about destruction and this is the
 * one clause in it that promises the opposite. It ends with a space so the caller concatenates
 * without deciding anything, and it is EMPTY for zero and for unknown: a promise that something
 * was kept has to rest on a number somebody measured.
 * @param {*} quarantined - Quarantine count, or non-finite for "unknown".
 * @returns {string}
 */
export function quarantineKeptNotice(quarantined) {
    const q = toPendingCount(quarantined);
    if (Number.isNaN(q) || q === 0) return '';
    return q === 1
        ? 'A alteração guardada para revisão continua neste navegador e pode ser consultada depois. '
        : 'As alterações guardadas para revisão continuam neste navegador e podem ser consultadas '
            + 'depois. ';
}

/**
 * The toast after a rescue that WORKED. It names the local atlas, because that name is the only
 * handle the person has to find the work again.
 * @param {string|null|undefined} atlasName - The name the local slot took.
 * @returns {string}
 */
export function exitPreservedSummary(atlasName) {
    const nome = typeof atlasName === 'string' ? atlasName.trim() : '';
    const qual = nome ? ` como o atlas local "${nome}"` : ' como um atlas local';
    return `Você saiu da conta. O trabalho não enviado ficou neste computador${qual}. `
        + 'Entre novamente e use "Enviar ao servidor".';
}

/**
 * The toast after a rescue that FAILED, and it must not promise a rescue.
 *
 * `preserveUnsyncedWorkAsLocal` answers false when the adoption throws or when the read-back finds
 * no slot on disk, and in that case NOTHING claims the namespace. There are two failures, not one,
 * and they need different instructions: with the veto recorded the work survives closing the tab
 * for a bounded time, and telling the person not to close would frighten them for nothing; without
 * it, this live tab really is the last guarantee. A single fixed sentence would have to be wrong in
 * one of the two cases, which is the exact form of lie this whole path exists to remove.
 *
 * O PRAZO ENTRA COMO ARGUMENTO, e não por import, porque este módulo tem ZERO IMPORTS por
 * contrato (ele é lido das páginas que bootam sem a store) e a constante mora em
 * `store/remote-atlas.api.js`, que arrasta a store inteira. Passá-lo é o que mantém o número
 * DERIVADO da constante em vez de digitado aqui, que é a única forma de ele não envelhecer
 * sozinho no dia em que o prazo mudar.
 *
 * E ele é dito porque "o quanto antes" NÃO É ACIONÁVEL: quem lê isso numa sexta à noite volta na
 * segunda e perdeu o trabalho. A frase precisa do número para a pessoa poder decidir se corre
 * agora ou se dá tempo.
 *
 * @param {{retained?: boolean, graceMs?: number|null}} [options] - `retained` when the namespace
 *   is under a rescue veto; `graceMs` is `RESCUE_VETO_GRACE_MS`, in milliseconds.
 * @returns {string}
 */
export function exitPreserveFailedNotice({ retained = false, graceMs = null } = {}) {
    const cabeca = 'Você saiu da conta, mas NÃO foi possível guardar o trabalho não enviado como '
        + 'atlas local.';
    if (!retained) {
        return `${cabeca} Não feche esta aba: entre de novo para que ele seja enviado ao servidor.`;
    }
    const prazo = prazoEmHoras(graceMs);
    return `${cabeca} Ele fica neste computador por ${prazo}: entre de novo nesse prazo para `
        + 'enviá-lo ao servidor.';
}

/**
 * Uma lista de nomes entre aspas, na forma de frase: `"A"`, `"A" e "B"`, `"A", "B" e "C"`.
 * @param {string[]} nomes
 * @returns {string}
 */
function listaDeNomes(nomes) {
    const entre = nomes.map((nome) => `"${nome}"`);
    if (entre.length <= 1) return entre.join('');
    return `${entre.slice(0, -1).join(', ')} e ${entre[entre.length - 1]}`;
}

/**
 * The toast about the OTHER server atlases whose unsent work an involuntary exit had to protect:
 * atlases this tab left earlier, which the rescue of the mounted atlas does not reach.
 *
 * THREE OUTCOMES, AND EACH NAMES ITS ATLASES, because a count would not tell the person which
 * project to reopen. `rescued` became local atlases (the names are the ones the local list shows);
 * `retained` could not become local atlases (the local cap, or the adoption failed) and is kept by
 * the retention veto for `graceMs`; `lost` could not even be retained, so this live tab is the last
 * chance.
 *
 * @param {{rescued?: string[], retained?: string[], lost?: string[], graceMs?: number|null}} [params]
 * @returns {{message: string, tone: string}|null} Null when there is nothing to say.
 */
export function otherAtlasesRescueNotice({ rescued = [], retained = [], lost = [], graceMs = null } = {}) {
    const partes = [];
    if (rescued.length === 1) {
        partes.push(`O trabalho não enviado de outro atlas foi guardado neste computador como o atlas `
            + `local ${listaDeNomes(rescued)}. Entre de novo e use "Enviar ao servidor".`);
    } else if (rescued.length > 1) {
        partes.push(`O trabalho não enviado de outros atlas foi guardado neste computador como os `
            + `atlas locais ${listaDeNomes(rescued)}. Entre de novo e use "Enviar ao servidor".`);
    }
    if (retained.length > 0) {
        partes.push(`Não foi possível guardar como atlas local o trabalho não enviado de `
            + `${listaDeNomes(retained)}. Ele fica neste computador por ${prazoEmHoras(graceMs)}: `
            + 'entre de novo e abra esse atlas nesse prazo.');
    }
    if (lost.length > 0) {
        // NO ACTION IS OFFERED, because none exists: the sweep of the same exit runs right before or
        // right after this sentence, so "do not close this tab" or "log in again" would be false.
        partes.push(`NÃO foi possível guardar neste computador o trabalho não enviado de `
            + `${listaDeNomes(lost)}, e ele foi descartado.`);
    }
    if (partes.length === 0) return null;
    return { message: partes.join(' '), tone: lost.length > 0 ? 'error' : 'warning' };
}

/**
 * O prazo em português, a partir de um valor em milissegundos.
 *
 * DEGRADA PARA A FORMA VAGA quando o prazo não é um número utilizável, em vez de escrever
 * "por NaN horas" ou de inventar um número. A forma vaga é pior que o número, mas é verdadeira.
 * @param {*} graceMs
 * @returns {string}
 */
function prazoEmHoras(graceMs) {
    const ms = Number(graceMs);
    if (!Number.isFinite(ms) || ms <= 0) return 'tempo limitado';
    const horas = Math.floor(ms / 3_600_000);
    if (horas >= 48) return `${Math.floor(horas / 24)} dias`;
    if (horas === 24) return '24 horas';
    if (horas >= 1) return `${horas} ${horas === 1 ? 'hora' : 'horas'}`;
    const minutos = Math.max(1, Math.round(ms / 60_000));
    return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
}

/**
 * THE SENTENCE FOR THE URL CHANNEL: what the MAP says about a rescue that happened on a page it
 * cannot see (`atlas.html` and `admin.html` end the session and then `window.location.replace`).
 *
 * WHY IT IS NOT ONE OF THE TWO ABOVE. Those are written for a toast raised by the page that did the
 * rescue, which knows two things this channel does not: the NAME the local slot took, and whether a
 * retention veto was recorded. Neither survives a navigation, and inventing them here would put in
 * front of the user a fact nobody measured. What does survive is a code and a count, so these
 * sentences are built from exactly those two.
 *
 * IT ALSO DOES NOT SAY WHY THE SESSION ENDED. `?sessao=` already carries that and the map says it
 * in its own toast; repeating "você saiu da conta" would be wrong for the idle expiry, where nobody
 * left anything.
 *
 * THE COUNT ONLY APPEARS WHEN IT IS A POSITIVE INTEGER. The query string is hand-editable and the
 * emitter omits the parameter when the count is zero or unknown, so `?pendentes=0`, `?pendentes=x`
 * and a missing parameter are the same fact here: it was not measured, and the sentence carries no
 * number. Printing "0 operações" next to "o trabalho ficou guardado" would be the only
 * self-contradicting sentence this module could produce.
 *
 * @param {*} outcome - The `?trabalho=` value; anything outside {@link ExitOutcome} answers null.
 * @param {*} [pendingOps] - The `?pendentes=` value, as it came off the URL.
 * @returns {{message: string, tone: string}|null} Null when there is nothing to say, so the caller
 *   shows no toast at all.
 */
export function exitOutcomeNotice(outcome, pendingOps) {
    const n = toPendingCount(pendingOps);
    const quantas = !Number.isNaN(n) && n > 0 ? ` (${pendingOpsLabel(n)})` : '';
    const oTrabalho = `O trabalho não enviado ao servidor${quantas}`;

    if (outcome === ExitOutcome.GUARDADO) {
        return {
            message: `${oTrabalho} foi guardado neste computador como atlas local. `
                + 'Entre de novo e use "Enviar ao servidor".',
            tone: 'warning',
        };
    }
    if (outcome === ExitOutcome.FALHOU) {
        // O MAIS FORTE DOS TRÊS, e o tom é 'error' de propósito: ninguém escolheu isto, o resgate
        // não deu certo, e a única ação que ainda recupera o trabalho é entrar de novo. A frase não
        // promete guarda nenhuma, porque não há veto medido deste lado da navegação.
        return {
            message: `NÃO foi possível guardar neste computador o trabalho não enviado ao `
                + `servidor${quantas}. Entre novamente o quanto antes para enviá-lo.`,
            tone: 'error',
        };
    }
    // `nada`, ausente, ou qualquer valor que alguém tenha digitado na barra de endereços: silêncio.
    // Ecoar o desconhecido seria deixar o usuário escrever o próprio aviso.
    return null;
}

/**
 * THE SENTENCE FOR `?outros=`: what the MAP says about the other atlases an exit on a page without
 * a map looked at. Only codes travel (never names, for the reason given at {@link exitOutcomeNotice}),
 * so the sentence names no atlas; unknown codes are ignored rather than echoed.
 * @param {*} codes - The `?outros=` value, a comma list as it came off the URL.
 * @param {{graceMs?: number|null}} [options] - The retention window, for the RETIDO sentence.
 * @returns {{message: string, tone: string}|null}
 */
export function otherAtlasesExitNotice(codes, { graceMs = null } = {}) {
    const presentes = new Set(String(codes ?? '').split(',').map(c => c.trim()));
    const partes = [];
    if (presentes.has(OtherAtlasesOutcome.GUARDADO)) {
        partes.push('O trabalho não enviado de outros atlas foi guardado neste computador como atlas '
            + 'locais. Entre de novo e use "Enviar ao servidor".');
    }
    if (presentes.has(OtherAtlasesOutcome.RETIDO)) {
        partes.push('O trabalho não enviado de outros atlas não coube como atlas local e fica neste '
            + `computador por até ${prazoEmHoras(graceMs)}: entre de novo e abra esses atlas nesse prazo.`);
    }
    if (presentes.has(OtherAtlasesOutcome.PERDIDO)) {
        partes.push('NÃO foi possível guardar neste computador o trabalho não enviado de outros atlas, '
            + 'e ele foi descartado.');
    }
    if (partes.length === 0) return null;
    return {
        message: partes.join(' '),
        tone: presentes.has(OtherAtlasesOutcome.PERDIDO) ? 'error' : 'warning',
    };
}
