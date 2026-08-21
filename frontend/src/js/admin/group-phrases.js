// Path: js/admin/group-phrases.js

/**
 * @fileoverview What the "Grupos" tab SAYS about an access group, as pure functions.
 *
 * This exists because of one confirmation. Deleting a group revokes everything it granted:
 * the operator believes they are tidying a list of people, and they are taking access away
 * from every member, to every resource the group reached. The warning is only worth showing
 * if it names HOW MANY of each, and that is arithmetic plus plural agreement, which is
 * testable in node and does not belong inside a DOM builder.
 *
 * Both counters cross the wire from a SQL `COUNT`, and node-postgres returns a bigint count
 * as a STRING. So every number here goes through `toCount()` instead of being trusted: a
 * plural picked with `count === 1` reads "1 pessoas" the moment the value arrives as `'1'`,
 * and that class of bug never shows up in the happy path of a hand test.
 */

/**
 * A wire counter as a non-negative integer. Strings (the `COUNT` case), null, undefined,
 * NaN and negatives all collapse to 0 — the tab must never render "NaN pessoas".
 * @param {*} value
 * @returns {number}
 */
export function toCount(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * "1 pessoa" / "3 pessoas".
 * @param {*} value
 * @returns {string}
 */
export function peopleLabel(value) {
    const n = toCount(value);
    return `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;
}

/**
 * "1 recurso" / "3 recursos".
 * @param {*} value
 * @returns {string}
 */
export function resourceLabel(value) {
    const n = toCount(value);
    return `${n} ${n === 1 ? 'recurso' : 'recursos'}`;
}

/**
 * The one-line reach of a group, for a subtitle: "3 pessoas · 2 recursos".
 * @param {{member_count?: *, grant_count?: *}} group
 * @returns {string}
 */
export function groupReach(group) {
    return `${peopleLabel(group?.member_count)} · ${resourceLabel(group?.grant_count)}`;
}

/**
 * A METADE DA CONSEQUÊNCIA QUE NÃO TEM NÚMERO. Apagar o grupo (ou tirar alguém dele)
 * derruba também o que os membros REPASSARAM a partir daquele acesso, e essa contagem
 * a tela não tem: a listagem conhece as concessões DIRETAS ao grupo, e a subárvore só é
 * conhecida depois do ato, pelo `grantsAffected` do servidor.
 *
 * A frase é uma constante e não um trecho repetido porque as duas telas (apagar o grupo,
 * tirar o membro) anunciam a MESMA cascata, e duas cópias divergem na primeira revisão.
 * Ela só entra nos ramos em que a cascata é POSSÍVEL: sem concessão viva ao grupo não
 * existe repasse pendurado nele, e prometer uma queda que não vai acontecer gasta a
 * credibilidade da frase alta no caso em que ela é alta.
 */
const CASCATA = 'derruba os repasses que elas fizeram a partir dele.';

/**
 * The deletion warning, with the reach spelled out.
 *
 * The four branches are not decoration: "remove o acesso de 0 pessoas a 0 recursos" reads as
 * a bug, and an empty group is the one case where deleting is harmless — saying so is what
 * keeps the loud sentence credible in the case that IS loud.
 *
 * @param {{name?: string, member_count?: *, grant_count?: *}} group
 * @returns {string}
 */
export function groupDeletionWarning(group) {
    const nome = group?.name ?? '';
    const pessoas = toCount(group?.member_count);
    const recursos = toCount(group?.grant_count);

    if (pessoas === 0 && recursos === 0) {
        return `O grupo "${nome}" não tem membros nem concessões. Apagar não se desfaz.`;
    }
    if (recursos === 0) {
        return `Apagar o grupo "${nome}" tira ${peopleLabel(pessoas)} do grupo. `
            + 'Ele não concede acesso a nenhum recurso hoje, e isso não se desfaz.';
    }
    if (pessoas === 0) {
        return `Apagar o grupo "${nome}" derruba as concessões dele a ${resourceLabel(recursos)}. `
            + 'Ele não tem membros hoje, e isso não se desfaz.';
    }
    return `Apagar o grupo "${nome}" remove o acesso de ${peopleLabel(pessoas)} `
        + `a ${resourceLabel(recursos)}, e ${CASCATA} Isso não se desfaz.`;
}

/**
 * What the toast says AFTER the delete, from the server's own numbers rather than the
 * listing's. The two can disagree (someone else granted in between), and the number that
 * actually fell is the server's.
 * @param {{name?: string, grantsAffected?: *}} result
 * @returns {string}
 */
export function groupDeletionSummary(result) {
    const nome = result?.name ?? '';
    const recursos = toCount(result?.grantsAffected);
    if (recursos === 0) return `Grupo "${nome}" apagado.`;
    return `Grupo "${nome}" apagado. Concessões revogadas: ${recursos}.`;
}

/**
 * O aviso que precede TIRAR alguém do grupo.
 *
 * Tirar um membro deixou de ser uma operação local em 2026-08-20: além de a pessoa perder o
 * que o grupo dava, cai o que ELA repassou a partir dele (a subárvore pendurada na concessão
 * ao grupo). Como a exclusão do grupo, a consequência é anunciada sem número, porque o número
 * só existe depois do ato.
 *
 * O ramo do grupo SEM concessão viva não recebe a frase de cascata, e não por brevidade: sem
 * concessão ao grupo não há repasse pendurado nele, e o aviso estaria descrevendo uma queda
 * impossível.
 *
 * @param {{name?: string, grant_count?: *}} group
 * @returns {string}
 */
export function memberRemovalWarning(group) {
    const recursos = toCount(group?.grant_count);
    if (recursos === 0) {
        return 'O grupo não concede acesso a nenhum recurso hoje, então nada muda para ela agora.';
    }
    return `Ela perde o acesso a ${resourceLabel(recursos)} que este grupo dá, `
        + 'a menos que tenha acesso por outro caminho, e sai também o que ela repassou '
        + 'a partir deste grupo.';
}

/**
 * O toast DEPOIS de tirar a pessoa, com o número do servidor.
 *
 * `grantsAffected` conta a poda inteira. Zero é o caso comum (a pessoa não repassou nada) e
 * ali a frase NÃO anuncia revogação nenhuma: dizer "0 concessões revogadas" transforma o caso
 * normal num susto.
 *
 * @param {{name?: string, grantsAffected?: *}} result - `name` já é o nome de exibição.
 * @returns {string}
 */
export function memberRemovalSummary(result) {
    const nome = result?.name ?? '';
    const caidas = toCount(result?.grantsAffected);
    if (caidas === 0) return `${nome} saiu do grupo.`;
    return `${nome} saiu do grupo. Concessões revogadas: ${caidas}.`;
}

/**
 * De quem é o grupo, para a seção "grupos de que participo".
 *
 * É a única informação de pessoa que sai por aquela seção, e ela sai por um motivo: quem
 * participa precisa saber A QUEM pedir entrada ou saída. O roster continua do lado fechado.
 *
 * Grupo sem dono é estado real (o backfill adota `created_by`, que pode ser nulo em linha
 * antiga), e dizê-lo por extenso é melhor que um travessão: quem lê "sem dono definido" sabe
 * que só o administrador do sistema administra aquele grupo.
 *
 * @param {{owner_id?: string|null, owner_nome?: string, owner_username?: string}} group
 * @returns {string}
 */
export function groupOwnerLabel(group) {
    const nome = (group?.owner_nome || '').trim();
    const username = (group?.owner_username || '').trim();
    if (nome && username) return `Dono: ${nome} (@${username})`;
    if (nome) return `Dono: ${nome}`;
    if (username) return `Dono: @${username}`;
    return 'Sem dono definido';
}

/**
 * How a person is named in the member list and in the search results. Falls back down the
 * chain because `nome` is optional in the database and a blank row is unclickable.
 * @param {{nome?: string, username?: string, posto_graduacao?: string}} person
 * @returns {string}
 */
export function memberDisplayName(person) {
    const nome = (person?.nome || '').trim();
    const posto = (person?.posto_graduacao || '').trim();
    const base = nome || (person?.username || '').trim() || 'Usuário';
    return posto && nome ? `${posto} ${base}` : base;
}
