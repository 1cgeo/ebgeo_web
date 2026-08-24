// Path: js/admin/user-deactivation-phrases.js

/**
 * @fileoverview As frases da DESATIVAÇÃO de conta, o ato mais destrutivo do painel.
 *
 * ZERO IMPORTS, como as irmãs (`producer-scope-phrases.js`, `group-phrases.js`,
 * `catalog-delete-phrases.js`): a aba mora numa página que boota sem a store, e frase pura é
 * testável em node sem montar DOM nenhum.
 *
 * POR QUE ESTE ARQUIVO EXISTE, e a razão é uma contradição dentro de um arquivo só. Numa
 * transação, `deleteUser` transfere os atlas, apaga os shares do novo dono, faz o soft-delete,
 * revoga toda a família de refresh, carimba o corte de sessão e PODA toda concessão originada por
 * aquela pessoa junto com a subárvore. A tela avisava com uma linha ("Ele não poderá mais entrar.")
 * e relatava com três palavras ("Usuário desativado."). Duas linhas acima, no mesmo `users-tab.js`,
 * a TROCA DE PAPEL, que poda um SUBCONJUNTO disso, tem o fluxo exemplar: decide se pergunta,
 * avisa com a contagem, muda o rótulo do botão conforme ela e relata os números depois.
 *
 * O DADO SEMPRE ESTEVE LÁ, e é isso que torna o conserto barato: `live_grant_count` já vem por
 * linha nas duas listagens de usuário (e `users-tab.js` já o lia, mas SÓ no ramo da troca de
 * papel), e a resposta da desativação já carrega `atlasTransferred`, `grantsRevoked` e
 * `grantsReparented`. Uma varredura por esses três nomes em `frontend/src/` achava apenas
 * `admin/audit-phrases.js`, ou seja, os números só eram legíveis DEPOIS, noutra aba. Zero rota
 * nova, zero consulta nova.
 *
 * A METADE QUE NINGUÉM TINHA NOTADO É A REATIVAÇÃO. `reactivateUser` é uma consulta mais uma linha
 * de trilha: as concessões podadas continuam com `revoked_at` gravado e as sessões continuam
 * mortas. A única coisa que a reativação ressuscita sozinha é a chave de API, justamente a que
 * ninguém pediu de volta. Uma tela que oferece "Reativar" ao lado de "Desativar" sugere simetria
 * que não existe, e é essa sugestão que `reactivationNotice` desfaz.
 */

/**
 * Normaliza uma contagem que veio do servidor.
 *
 * Aceita string (pg devolve `bigint` como string), número e ausência. Qualquer coisa que não vire
 * inteiro finito e não negativo conta como zero: numa frase de aviso, inventar quantidade é pior
 * que omiti-la.
 * @param {*} valor
 * @returns {number}
 */
function toCount(valor) {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** "1 concessão" / "3 concessões". */
function grantLabel(n) {
    return `${n} ${n === 1 ? 'concessão' : 'concessões'}`;
}

/**
 * O aviso que precede a desativação.
 *
 * COMPOSTO, e não escrito caso a caso: a cascata é sempre a mesma e a contagem é o que varia, e
 * duas frases inteiras escritas à mão divergem na primeira revisão.
 *
 * A FRASE DA CASCATA NÃO TEM NÚMERO, e a omissão é medida: `live_grant_count` conta as concessões
 * que a pessoa ORIGINOU, e a poda alcança também a subárvore delas, que a listagem não conta.
 * Prometer "N concessões caem" com o número das raízes seria subcontar exatamente no ato em que a
 * subcontagem convence a confirmar. O número que existe é dito como o que é (concessões que ela
 * concedeu), e o resto é nomeado sem quantidade.
 *
 * @param {Object} [params]
 * @param {string} [params.username] - Para nomear a pessoa no aviso.
 * @param {*} [params.liveGrants] - `live_grant_count` da linha da listagem.
 * @param {boolean} [params.hasAtlas] - Se ela ainda tem atlas, incluindo os da lixeira.
 * @returns {string} O corpo da confirmação. Nunca vazio.
 */
export function deactivationWarning({ username, liveGrants, hasAtlas = false } = {}) {
    const quem = (username || '').trim() || 'esta pessoa';
    const n = toCount(liveGrants);
    const partes = [`Desativar "${quem}" faz mais do que impedir a entrada dela.`];

    if (n > 0) {
        partes.push(
            `${grantLabel(n)} que ela concedeu deixam de valer, junto com o acesso de quem `
            + 'recebeu através dela.',
        );
    } else {
        partes.push('Todo acesso que ela tiver concedido deixa de valer, junto com o acesso de '
            + 'quem recebeu através dela.');
    }

    if (hasAtlas) {
        partes.push('Os atlas dela passam para quem você escolher, inclusive os que estão na '
            + 'lixeira dela.');
    }

    // A PARTE IRREVERSÍVEL, dita ANTES e não depois. Reativar devolve a entrada e mais nada.
    partes.push('Reativar a conta depois devolve o acesso dela, e NÃO devolve as concessões '
        + 'derrubadas nem as sessões abertas.');
    return partes.join(' ');
}

/**
 * O rótulo do botão que confirma a desativação.
 *
 * Muda com a contagem pela mesma razão do irmão: um botão "Desativar e revogar" numa conta que não
 * concedeu nada é uma ameaça falsa, e ameaça falsa é o que faz a pessoa parar de ler o botão.
 * @param {*} liveGrants
 * @returns {string}
 */
export function deactivationConfirmLabel(liveGrants) {
    return toCount(liveGrants) > 0 ? 'Desativar e revogar' : 'Desativar';
}

/**
 * O toast DEPOIS da desativação, com os números que o servidor devolveu.
 *
 * OS TRÊS EIXOS SÃO INDEPENDENTES e cada um só aparece quando é diferente de zero, pela mesma
 * razão do irmão: a desativação de uma conta que nunca concedeu nada não pode virar "0 concessões
 * revogadas", senão o caso normal vira susto e o sinal do caso que importa se perde.
 *
 * `grantsReparented` entra porque sem ele um `grantsRevoked` menor que o esperado parece poda
 * incompleta: ele responde "o que sobreviveu, e sobreviveu por outro caminho de acesso".
 *
 * A LIXEIRA É PARCELA, NÃO SEGUNDO TOTAL. `atlasTransferredFromTrash` conta quantos dos
 * `atlasTransferred` estavam descartados, e por isso é somado DENTRO da frase de atlas em vez de
 * virar uma sentença própria: quem lê "3 atlas transferidos. 2 da lixeira." pode entender cinco.
 * Ele existe desde 2026-08-24, quando a transferência passou a alcançar a lixeira, e é o número
 * que explica ao herdeiro por que ele recebeu coisa que não esperava.
 *
 * @param {{atlasTransferred?: *, grantsRevoked?: *, grantsReparented?: *,
 *   atlasTransferredFromTrash?: *}} [result] - O corpo do 200.
 * @returns {string}
 */
export function deactivationSummary(result) {
    const atlas = toCount(result?.atlasTransferred);
    const daLixeira = toCount(result?.atlasTransferredFromTrash);
    const revogadas = toCount(result?.grantsRevoked);
    const mantidas = toCount(result?.grantsReparented);
    let frase = 'Usuário desativado.';
    if (atlas > 0) {
        frase += ` ${atlas} ${atlas === 1 ? 'atlas transferido' : 'atlas transferidos'}`;
        frase += daLixeira > 0 ? `, ${daLixeira} da lixeira dele.` : '.';
    }
    if (revogadas > 0) frase += ` Concessões derrubadas: ${revogadas}.`;
    if (mantidas > 0) frase += ` Mantidas por outro caminho: ${mantidas}.`;
    return frase;
}

/**
 * A frase da REATIVAÇÃO, que diz o que ela não desfaz.
 *
 * A tela desenha "Reativar" no mesmo lugar em que desenhava "Desativar", e essa simetria visual
 * afirma uma simetria de efeito que não existe. Sem esta frase, quem reativa conclui que desfez o
 * ato, e vai descobrir o contrário pela reclamação de terceiros, que é a pior via.
 *
 * MENCIONA A CHAVE DE API de propósito: ela é a única coisa que a reativação ressuscita sozinha, e
 * é a menos desejável das três. Se a conta foi desativada por comprometimento, a chave volta viva.
 * @returns {string}
 */
export function reactivationNotice() {
    return 'A conta volta a entrar, e só isso: as concessões derrubadas na desativação continuam '
        + 'revogadas e precisam ser concedidas de novo, e as sessões que estavam abertas seguem '
        + 'encerradas. A chave de API dela, essa sim, volta a valer.';
}
