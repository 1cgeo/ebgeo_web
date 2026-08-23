// Path: js/admin/group-phrases.js

/**
 * @fileoverview What the UI SAYS about an access group, as pure functions.
 *
 * NÃO É MAIS SÓ DA ABA "GRUPOS", desde 2026-08-23: o seletor de grupo do modal de
 * compartilhar recurso (`catalog/resource-share.modal.js`) passou a criar grupo no ponto de
 * uso, e as frases dele (lista vazia, falha de leitura) vieram para cá em vez de nascerem
 * uma segunda vez lá. O módulo continua com ZERO imports, que é o que o mantém carregável
 * em node puro e importável de uma página que não boota a store.
 *
 * This exists because of one confirmation. Deleting a group revokes everything it granted:
 * the operator believes they are tidying a list of people, and they are taking access away
 * from every member, to every resource the group reached. The warning is only worth showing
 * if it names HOW MANY of each, and that is arithmetic plus plural agreement, which is
 * testable in node and does not belong inside a DOM builder.
 *
 * O ALCANCE DE UM GRUPO TEM DOIS EIXOS desde D2 (2026-08-21), e as frases daqui só
 * conheciam um: `atlas_shares.group_id` faz o grupo carregar acesso a ATLAS, além das
 * concessões de recurso. Enquanto o aviso falava só de recursos, ele avisava de MENOS
 * sobre um ato irreversível, que é a pior direção do erro numa confirmação destrutiva.
 *
 * OS RAMOS NÃO ENUMERAM AS COMBINAÇÕES, e é decisão, não preguiça: com 0/N em três eixos
 * são oito casos, e oito frases escritas à mão divergem na primeira revisão. O alcance é
 * COMPOSTO (`reachPhrase` junta os sintagmas não-vazios) e os ramos são três — tudo
 * zerado, sem alcance, sem gente — mais o cheio.
 *
 * A CASCATA CONTINUA PRESA AO EIXO DE RECURSO, e essa assimetria é a parte que não se
 * adivinha: repasse é a aresta `parent_grant_id` de `resource_grants`, que só existe
 * naquele eixo. Um grupo com N atlas e ZERO concessão não tem repasse pendurado nele, e
 * anunciar a queda de repasses ali seria prometer um efeito impossível.
 *
 * Every counter crosses the wire from a SQL `COUNT`, and node-postgres returns a bigint
 * count as a STRING. So every number here goes through `toCount()` instead of being
 * trusted: a plural picked with `count === 1` reads "1 pessoas" the moment the value
 * arrives as `'1'`, and that class of bug never shows up in the happy path of a hand test.
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
 * "1 atlas" / "3 atlas".
 *
 * `atlas` é INVARIÁVEL em português (o atlas, os atlas), então o número muda e a palavra
 * não. Ter a função mesmo assim, em vez de interpolar `${n} atlas` nos chamadores, é o
 * que mantém a passagem por `toCount()` obrigatória: sem ela a string `'2'` do `COUNT`
 * chegaria crua na tela, e um dia alguém acrescentaria um plural aqui sem achar as
 * interpolações espalhadas.
 * @param {*} value
 * @returns {string}
 */
export function atlasLabel(value) {
    const n = toCount(value);
    return `${n} atlas`;
}

/**
 * O ALCANCE DE ACESSO do grupo, como sintagma, sem os eixos vazios: "2 recursos e
 * 1 atlas", "1 atlas", "3 recursos", ou string VAZIA quando o grupo não alcança nada.
 *
 * A string vazia é o produto principal, e não um caso degenerado: é ela que o chamador
 * testa para escolher o ramo, em vez de reexaminar as duas contagens. Enumerar as quatro
 * combinações de 0/N nos dois eixos dentro de cada ramo de `groupDeletionWarning` daria
 * oito frases; compor aqui deixa três.
 *
 * @param {*} grantCount - concessões de recurso vivas
 * @param {*} atlasShareCount - atlas alcançados pelo grupo
 * @returns {string}
 */
export function reachPhrase(grantCount, atlasShareCount) {
    const partes = [];
    if (toCount(grantCount) > 0) partes.push(resourceLabel(grantCount));
    if (toCount(atlasShareCount) > 0) partes.push(atlasLabel(atlasShareCount));
    return partes.join(' e ');
}

/**
 * The one-line reach of a group, for a subtitle: "3 pessoas · 2 recursos · 1 atlas".
 *
 * Aqui os zeros APARECEM, ao contrário de `reachPhrase`: este é o painel de estado de UM
 * grupo aberto, e "0 recursos" é a resposta à pergunta que a pessoa está fazendo. Omitir
 * o eixo zerado deixaria a linha ambígua entre "não tem" e "a tela não sabe".
 *
 * @param {{member_count?: *, grant_count?: *, atlas_share_count?: *}} group
 * @returns {string}
 */
export function groupReach(group) {
    return `${peopleLabel(group?.member_count)} · ${resourceLabel(group?.grant_count)}`
        + ` · ${atlasLabel(group?.atlas_share_count)}`;
}

/**
 * A METADE DA CONSEQUÊNCIA QUE NÃO TEM NÚMERO. Apagar o grupo (ou tirar alguém dele)
 * derruba também o que os membros REPASSARAM a partir daquele acesso, e essa contagem
 * a tela não tem: a listagem conhece as concessões DIRETAS ao grupo, e a subárvore só é
 * conhecida depois do ato, pelo `grantsAffected` do servidor.
 *
 * A frase é uma função e não um trecho repetido porque as duas telas (apagar o grupo,
 * tirar o membro) anunciam a MESMA cascata, e duas cópias divergem na primeira revisão.
 * Ela só entra nos ramos em que a cascata é POSSÍVEL: sem concessão viva ao grupo não
 * existe repasse pendurado nele, e prometer uma queda que não vai acontecer gasta a
 * credibilidade da frase alta no caso em que ela é alta. Repare que o eixo de ATLAS não
 * a habilita: a aresta `parent_grant_id` é de `resource_grants`, e `atlas_shares` não
 * tem subárvore nenhuma.
 *
 * ELA CONCORDA COM O NÚMERO DE PESSOAS. Era uma constante com "elas fizeram", e um grupo
 * de UMA pessoa lia "remove o acesso de 1 pessoa (...) e derruba os repasses que elas
 * fizeram" — a mesma classe de deslize que `toCount` existe para impedir do outro lado.
 *
 * @param {number} pessoas - quantos membros, já normalizado
 * @returns {string}
 */
function cascata(pessoas) {
    return pessoas === 1
        ? 'derruba os repasses que ela fez a partir dele.'
        : 'derruba os repasses que elas fizeram a partir dele.';
}

/**
 * A RESSALVA DE NÚMERO NÃO CONFIRMADO, para o aviso de um ato irreversível.
 *
 * O aviso de exclusão cita contagens que vieram da LISTAGEM, e a listagem é uma foto: entre
 * ela e o clique alguém pode ter concedido o recurso ao grupo ou compartilhado outro atlas
 * com ele. A tela relê antes de perguntar; quando a releitura falha, o certo NÃO é esconder
 * o número (ele continua sendo a melhor estimativa) nem mostrá-lo como se fosse certo, e sim
 * dizer que ele pode estar defasado. Número velho apresentado como fresco é a forma de
 * verificação fantasma que cabe numa confirmação destrutiva.
 * @type {string}
 */
export const STALE_COUNTS_NOTICE =
    'Não foi possível confirmar estes números com o servidor agora, então eles podem estar defasados.';

/**
 * QUEM PÔS ESTA PESSOA NO GRUPO, para a coluna do roster.
 *
 * `LIST_MEMBERS` (servidor) devolve `added_by` e `added_by_username`, e os dois podem faltar
 * por motivos DIFERENTES, que a coluna precisa distinguir: sem `added_by` é linha antiga (ou
 * entrada por outro caminho), e a resposta honesta é "não registrado"; COM `added_by` e sem
 * nome de usuário é uma conta que saiu do `LEFT JOIN`, e dizer "não registrado" ali apagaria
 * o fato de que houve alguém. Nenhum dos dois pode virar "null" na tela.
 *
 * O servidor não manda o `nome` de quem adicionou, só o `username`, então a coluna mostra o
 * arroba: inventar `memberDisplayName` aqui produziria "Usuário" para toda linha.
 *
 * @param {{added_by?: string|null, added_by_username?: string|null}} member
 * @returns {string}
 */
export function memberAddedByLabel(member) {
    const username = (member?.added_by_username || '').trim();
    if (username) return `@${username}`;
    if (member?.added_by) return 'Conta removida';
    return 'Não registrado';
}

/**
 * A MESMA INFORMAÇÃO EM FRASE, para o `title` da célula: quem adicionou E quando.
 *
 * A data chega já formatada porque a formatação é da tela (locale, travessão para ausente) e
 * esta função é de vocabulário. `'—'` conta como ausente, que é o que a tela escreve quando
 * `added_at` não veio ou não é data.
 *
 * @param {{added_by?: string|null, added_by_username?: string|null}} member
 * @param {string} [quando] - a data já formatada, ou `'—'`/vazio quando não há.
 * @returns {string}
 */
export function memberAdmissionTitle(member, quando) {
    const data = (quando || '').trim();
    const temData = data !== '' && data !== '—';
    const username = (member?.added_by_username || '').trim();
    let quem = '';
    if (username) quem = `@${username}`;
    else if (member?.added_by) quem = 'uma conta já removida';

    if (quem && temData) return `Adicionado por ${quem} em ${data}.`;
    if (quem) return `Adicionado por ${quem}, em data não registrada.`;
    if (temData) return `Entrou em ${data}. Quem adicionou não ficou registrado.`;
    return 'Não há registro de quem adicionou nem de quando.';
}

/**
 * A FALHA DE LEITURA DA LISTA DE GRUPOS, escrita para NÃO se parecer com lista vazia.
 *
 * As duas ausências tinham a mesma aparência (o seletor sumia), e a diferença é toda: lista
 * vazia é um ESTADO do usuário, falha de rede é um acidente do instante. Quem lê a frase de
 * vazio depois de um erro conclui que não tem grupo nenhum, o que é afirmar uma coisa falsa.
 * @returns {string}
 */
export function groupsLoadFailureNotice() {
    return 'Não foi possível carregar os seus grupos de acesso. '
        + 'Isto é falha ao consultar o servidor, não ausência de grupos.';
}

/**
 * A DICA DE QUEM NÃO TEM GRUPO NENHUM, no ponto em que ele iria conceder a um.
 *
 * A remissão nomeia a PORTA pelo rótulo que aquele principal vê (`admin/admin-audience.js`),
 * nunca por um texto fixo: a mesma página se chama "Administração" para o administrador,
 * "Catálogo" para o produtor e "Grupos" para o resto de quem entrou, e um rótulo fixo mandava
 * dois dos quatro papéis procurar uma página com outro nome. Sem porta (anônimo) a remissão
 * simplesmente não sai, em vez de virar "crie um em null".
 *
 * @param {string|null} [porta] - o rótulo de `adminAudience`, ou nulo.
 * @returns {string}
 */
export function groupPickerEmptyNotice(porta) {
    const onde = porta ? ` Você também administra os seus grupos em ${porta}.` : '';
    return 'Você ainda não tem grupos de acesso. Crie um aqui mesmo e conceda a ele, '
        + `em vez de pessoa por pessoa.${onde}`;
}

/**
 * O QUE UM GRUPO RECÉM-CRIADO AINDA NÃO FAZ.
 *
 * Criar o grupo no ponto de uso resolve o vaivém, e introduz um mal-entendido novo: o grupo
 * nasce VAZIO, então conceder a ele não alcança pessoa nenhuma até que alguém entre. Quem
 * acabou de criar e conceder acredita ter compartilhado, e a tela não desmente. A frase
 * desmente, e nomeia a porta onde se põe gente dentro.
 *
 * @param {string|null} [porta] - o rótulo de `adminAudience`, ou nulo.
 * @returns {string}
 */
export function newGroupEmptyHint(porta) {
    const onde = porta ? ` Ponha pessoas nele em ${porta}.` : '';
    return `Um grupo novo nasce vazio: conceder a ele não alcança ninguém enquanto não `
        + `houver membros.${onde}`;
}

/**
 * A dica de quem TEM grupos e já concedeu este recurso a todos eles.
 * @param {string|null} [porta] - o rótulo de `adminAudience`, ou nulo.
 * @returns {string}
 */
export function groupPickerExhaustedNotice(porta) {
    const onde = porta ? ` Você administra os seus grupos em ${porta}.` : '';
    return `Todos os seus grupos de acesso já receberam este recurso.${onde}`;
}

/**
 * The deletion warning, with the reach spelled out.
 *
 * The four branches are not decoration: "remove o acesso de 0 pessoas a 0 recursos" reads as
 * a bug, and an empty group is the one case where deleting is harmless — saying so is what
 * keeps the loud sentence credible in the case that IS loud.
 *
 * OS RAMOS CONTINUAM QUATRO COM TRÊS EIXOS, e é o ponto do desenho: o que se ramifica é
 * "tem gente?" contra "alcança alguma coisa?", e o QUE ele alcança é composto por
 * `reachPhrase`. Acrescentar o quarto eixo (se existir um dia) não multiplica ramo.
 *
 * @param {{name?: string, member_count?: *, grant_count?: *, atlas_share_count?: *}} group
 * @param {{countsStale?: boolean}} [options] - `countsStale` quando os números NÃO puderam
 *   ser reconfirmados com o servidor antes do aviso.
 * @returns {string}
 */
export function groupDeletionWarning(group, { countsStale = false } = {}) {
    const nome = group?.name ?? '';
    const pessoas = toCount(group?.member_count);
    const recursos = toCount(group?.grant_count);
    const alcance = reachPhrase(group?.grant_count, group?.atlas_share_count);
    const ressalva = countsStale ? ` ${STALE_COUNTS_NOTICE}` : '';

    if (pessoas === 0 && alcance === '') {
        return `O grupo "${nome}" não tem membros, concessões nem atlas. `
            + `Apagar não se desfaz.${ressalva}`;
    }
    if (alcance === '') {
        return `Apagar o grupo "${nome}" tira ${peopleLabel(pessoas)} do grupo. `
            + `Ele não dá acesso a nenhum recurso nem atlas hoje, e isso não se desfaz.${ressalva}`;
    }
    if (pessoas === 0) {
        return `Apagar o grupo "${nome}" derruba o acesso que ele dá a ${alcance}. `
            + `Ele não tem membros hoje, e isso não se desfaz.${ressalva}`;
    }
    // A cascata é do eixo de RECURSO, e só entra com concessão viva: um grupo que só
    // alcança atlas não tem repasse pendurado nele.
    const cauda = recursos > 0 ? `, e ${cascata(pessoas)}` : '.';
    return `Apagar o grupo "${nome}" remove o acesso de ${peopleLabel(pessoas)} `
        + `a ${alcance}${cauda} Isso não se desfaz.${ressalva}`;
}

/**
 * What the toast says AFTER the delete, from the server's own numbers rather than the
 * listing's. The two can disagree (someone else granted in between), and the number that
 * actually fell is the server's.
 *
 * OS DOIS NÚMEROS SÃO DE NATUREZAS DIFERENTES, e por isso saem em frases separadas em vez
 * de somados: `grantsAffected` conta LINHAS REVOGADAS (a poda inteira, raízes mais
 * descendentes), e `atlasShares` conta atlas que saíram do alcance SEM nenhuma linha ter
 * sido escrita — o share do grupo apagado morre no predicado. Somá-los daria um total que
 * não corresponde a nada no banco.
 *
 * O eixo ausente não vira "0": um zero anunciado transforma o caso normal num susto, e é
 * a mesma regra do irmão `memberRemovalSummary`.
 *
 * @param {{name?: string, grantsAffected?: *, atlasShares?: *}} result
 * @returns {string}
 */
export function groupDeletionSummary(result) {
    const nome = result?.name ?? '';
    const recursos = toCount(result?.grantsAffected);
    const atlas = toCount(result?.atlasShares);
    let frase = `Grupo "${nome}" apagado.`;
    if (recursos > 0) frase += ` Concessões revogadas: ${recursos}.`;
    if (atlas > 0) frase += ` Atlas fora do alcance: ${atlas}.`;
    return frase;
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
 * impossível. É por isso que o eixo de ATLAS, que entrou aqui junto com o da exclusão, NÃO
 * habilita a cascata: tirar a pessoa do grupo tira o acesso dela aos atlas do grupo, e
 * `atlas_shares` não tem subárvore para derrubar.
 *
 * @param {{name?: string, grant_count?: *, atlas_share_count?: *}} group
 * @returns {string}
 */
export function memberRemovalWarning(group) {
    const recursos = toCount(group?.grant_count);
    const alcance = reachPhrase(group?.grant_count, group?.atlas_share_count);
    if (alcance === '') {
        return 'O grupo não dá acesso a nenhum recurso nem atlas hoje, '
            + 'então nada muda para ela agora.';
    }
    const cauda = recursos > 0
        ? ', e sai também o que ela repassou a partir deste grupo.'
        : '.';
    return `Ela perde o acesso a ${alcance} que este grupo dá, `
        + `a menos que tenha acesso por outro caminho${cauda}`;
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
