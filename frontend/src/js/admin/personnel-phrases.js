// Path: js/admin/personnel-phrases.js

/**
 * @fileoverview As frases das duas listas controladas: postos e organizações militares.
 *
 * ZERO IMPORTS, como as irmãs desta pasta, porque a aba mora numa página que boota sem a store e
 * porque frase pura é testável em node sem montar DOM.
 *
 * O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR é o pior defeito do painel inteiro. Desativar uma
 * organização militar é `UPDATE organizations SET is_active = false`, e a partir daí
 * `LIVE_AUTH_STATE` devolve `org_is_active: false` para toda conta LOTADA nela. No middleware de
 * autenticação a ordem é: conta inativa (401), OM inativa (403), corte de sessão, e só então a
 * adoção do papel. O gate de OM precede a ADOÇÃO DO PAPEL, então `requireAdmin` nunca roda: o
 * administrador que desativou a própria OM de lotação não consegue nem desfazer o que acabou de
 * fazer. E não é só 403 nas rotas, o login e o refresh recusam pelo mesmo predicado.
 *
 * A tela dizia `Excluir "<nome>" da lista?` e, no sucesso, `Item excluído.`
 *
 * TRÊS PALAVRAS MUDAM E CADA UMA CONSERTA UMA MENTIRA DIFERENTE: "excluir" vira "desativar"
 * (porque a linha continua no banco e volta com um clique), "da lista" vira o efeito real (porque
 * o alcance não é a lista, são as contas), e o sucesso passa a dizer o que ficou fora de alcance.
 *
 * AS CONTAGENS SÃO OPCIONAIS DE PROPÓSITO. Elas vêm de uma leitura à parte, e uma leitura pode
 * falhar; quando falha, a confirmação continua tendo de ser honesta. As frases abaixo degradam
 * para a versão sem número em vez de sumirem, porque o que a pessoa precisa saber (o que este ato
 * faz) não depende de quantos são.
 */

/**
 * Normaliza uma contagem vinda do servidor. Ver a irmã em `user-deactivation-phrases.js`.
 * @param {*} valor
 * @returns {number}
 */
function toCount(valor) {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** "1 conta" / "3 contas". */
function contas(n) {
    return `${n} ${n === 1 ? 'conta' : 'contas'}`;
}

/**
 * O aviso antes de DESATIVAR uma organização militar.
 *
 * @param {Object} [params]
 * @param {string} [params.nome] - O nome da OM.
 * @param {Object|null} [params.contagens] - O corpo de `GET /organizations/:id/deactivation-impact`
 *   (`activeMembers`, `activeProducers`, `catalogItems`), quando a leitura respondeu. Nulo
 *   degrada para a versão sem número. USA O VOCABULÁRIO DO SERVIDOR de propósito: traduzir os
 *   nomes aqui criaria um segundo vocabulário para a mesma coisa, que é como os dois divergem.
 * @param {boolean} [params.ehMinhaLotacao] - Se é a OM de lotação de quem está pedindo.
 * @returns {string} O corpo da confirmação. Nunca vazio.
 */
export function orgDeactivationWarning({ nome, contagens = null, ehMinhaLotacao = false } = {}) {
    const qual = (nome || '').trim() ? `"${nome}"` : 'esta organização';
    const partes = [];

    // O EFEITO PRIMEIRO, e o número depois: quem lê para de ler no meio, e a primeira frase é a
    // que precisa carregar o que o ato faz.
    const lotados = toCount(contagens?.activeMembers);
    partes.push(lotados > 0
        ? `Desativar ${qual} tira do ar o acesso de ${contas(lotados)} lotada${lotados === 1 ? '' : 's'} `
          + 'nela: o servidor passa a recusar cada requisição delas, e elas também não conseguem '
          + 'entrar de novo.'
        : `Desativar ${qual} tira do ar o acesso de toda conta lotada nela: o servidor passa a `
          + 'recusar cada requisição dessas contas, e elas também não conseguem entrar de novo.');

    const produtores = toCount(contagens?.activeProducers);
    if (produtores > 0) {
        partes.push(`${contas(produtores)} produzem por ela e perdem o escopo de produção.`);
    }

    const itens = toCount(contagens?.catalogItems);
    if (itens > 0) {
        partes.push(`Os ${itens} itens de catálogo que ela mantém ficam sem quem os edite.`);
    }

    // A REVERSIBILIDADE É DITA, porque ela é a diferença entre este ato e uma exclusão, e porque
    // sem ela a pessoa hesita no ato certo e não hesita no errado.
    partes.push('Nada é apagado: a organização continua na lista, marcada como inativa, e '
        + 'Reativar devolve tudo.');

    if (ehMinhaLotacao) {
        // ESTE RAMO NÃO DEVE SER ALCANÇADO, e existe por isso mesmo. O servidor recusa com 409, e
        // esta frase é a segunda linha de defesa, para o DOM velho e para a lotação que muda entre
        // o desenho da tela e o clique.
        partes.push('ATENÇÃO: esta é a sua própria lotação. Desativá-la trancaria você para fora '
            + 'do sistema, inclusive da tela que desfaria o ato. O servidor vai recusar.');
    }
    return partes.join(' ');
}

/**
 * O rótulo do botão que confirma a desativação de uma OM.
 * @param {Object|null} [contagens]
 * @returns {string}
 */
export function orgDeactivationConfirmLabel(contagens) {
    return toCount(contagens?.activeMembers) > 0 ? 'Desativar mesmo assim' : 'Desativar';
}

/**
 * O relato depois de desativar, com o número quando ele existe.
 * @param {string} nome
 * @param {Object|null} [contagens]
 * @returns {string}
 */
export function orgDeactivationSummary(nome, contagens = null) {
    const qual = (nome || '').trim() ? `"${nome}"` : 'A organização';
    const lotados = toCount(contagens?.activeMembers);
    return lotados > 0
        ? `${qual} foi desativada, e ${contas(lotados)} perderam o acesso.`
        : `${qual} foi desativada.`;
}

/**
 * O aviso antes de desativar um POSTO ou graduação.
 *
 * Não é destrutivo como o da OM (posto não gateia autenticação nenhuma), mas some dos seletores de
 * cadastro de toda a base, e essa é a parte que surpreende: a listagem do administrador continua
 * mostrando a linha, porque ela não filtra por `is_active`, enquanto o `/api/config` filtra.
 * @param {string} [nome]
 * @returns {string}
 */
export function rankDeactivationWarning(nome) {
    const qual = (nome || '').trim() ? `"${nome}"` : 'este posto';
    return `Desativar ${qual} o retira dos seletores de cadastro de todo o sistema. Quem já o tem `
        + 'continua com ele, e nada é apagado: a linha fica aqui, marcada como inativa, e Reativar '
        + 'devolve.';
}

/**
 * O rótulo do estado de uma linha das duas listas.
 * @param {boolean} ativo
 * @returns {string}
 */
export function statusLabel(ativo) {
    return ativo === false ? 'Inativo' : 'Ativo';
}
