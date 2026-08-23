// Path: js/catalog/visibility-phrases.js

/**
 * @fileoverview What the two RETIRADA surfaces say before they take a resource away from
 * people, as pure functions: the visibility switch of the admin catalog tab and the lending
 * section of the atlas settings modal.
 *
 * EXISTE PELA MESMA RAZÃO DE `grant-tree.js`, e é irmão dele. Três escritas retiravam acesso
 * de gente sem perguntar nada e sem dizer o que tinham feito: marcar um item do catálogo como
 * privado, marcar um projeto 360 como privado e retirar um empréstimo do atlas. As três se
 * parecem com ajuste de configuração e nenhuma é: elas mudam o que OUTRAS pessoas enxergam.
 *
 * A ASSIMETRIA É O DESENHO INTEIRO, e é ela que {@link visibilityChangeWarning} codifica
 * devolvendo `null`. Tornar público e emprestar são ADITIVOS (ninguém perde nada), tornar
 * privado e retirar o empréstimo são DESTRUTIVOS. Confirmar os quatro treinaria o operador a
 * clicar em "Confirmar" sem ler, que é como um aviso destrutivo perde o efeito exatamente no
 * caso em que ele importa. Quem decide o ramo é este módulo, e não cada chamador, porque a
 * regra escrita em dois lugares diverge na primeira revisão.
 *
 * NÃO HÁ NÚMERO EM NENHUMA DAS TRÊS FRASES, e a ausência foi MEDIDA, não presumida. As frases
 * de `group-phrases.js` citam quantas pessoas caem porque a listagem de grupos traz os
 * `COUNT` do servidor; aqui nenhuma das respostas disponíveis traz o equivalente:
 *
 *   1. `PATCH /resource-access/:type/:id/visibility` responde `{ id, name, access_level }` e
 *      nada mais (`setResourceVisibility`, no serviço do backend, projeta explicitamente
 *      esses três campos). Quem PERDE o acesso ao privatizar é o complemento de um conjunto
 *      que ninguém enumera: todo usuário que não tem papel global, concessão, empréstimo nem
 *      produção na OM dona.
 *   2. `GET /resource-access/:type/:id/grants` existe e tem contagem, mas responde a pergunta
 *      CONTRÁRIA: as concessões sobrevivem à privatização, então aquele número é quem
 *      CONTINUA vendo. Usá-lo como "quantos perdem" seria pior que não ter número.
 *   3. `DELETE /atlas/:id/resources/:type/:id` responde a linha de `atlas_resources` que
 *      acabou de morrer, sem contagem de audiência. E a audiência de um empréstimo não é a
 *      lista de participantes do atlas: ela inclui quem entra por LINK PÚBLICO, que não tem
 *      linha em lugar nenhum. Um `COUNT` de compartilhamentos seria um piso apresentado como
 *      a verdade, que é a forma de gastar a credibilidade do aviso.
 *
 * Por isso a consequência é dita QUALITATIVAMENTE e por extenso ("todos os participantes
 * deste atlas, inclusive quem entra por link público"). O único número que aparece é o de
 * {@link lendingScopeNote}, e ele é sobre o que a própria tela acabou de listar.
 *
 * Zero imports, como `grant-tree.js` e `group-phrases.js`: os dois consumidores moram em
 * páginas diferentes (a de administração, que boota sem a store, e o mapa), e uma dependência
 * aqui chegaria às duas.
 */

/**
 * A wire counter as a non-negative integer, pela mesma razão de `toCount` em
 * `js/admin/group-phrases.js`: um `COUNT` de node-postgres chega como STRING, e um plural
 * escolhido com `=== 1` lê "1 recursos" no instante em que o valor vem como `'1'`. Aqui a
 * entrada é o tamanho de um array e o risco é menor, mas o custo de normalizar é zero e a
 * tela nunca pode imprimir "NaN recursos".
 * @param {*} value
 * @returns {number}
 */
export function toCount(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * "1 recurso" / "3 recursos". Zero sai como "nenhum recurso" porque o único chamador usa a
 * expressão dentro de uma frase afirmativa, e "empresta 0 recursos" é uma leitura de painel,
 * não uma frase.
 * @param {*} value
 * @returns {string}
 */
export function resourceCountLabel(value) {
    const n = toCount(value);
    if (n === 0) return 'nenhum recurso';
    return `${n} ${n === 1 ? 'recurso' : 'recursos'}`;
}

/**
 * O nome de exibição de um recurso, com queda para um sujeito genérico.
 *
 * `||` e não `??`, como em `granteeName` (`js/catalog/grant-tree.js`): string vazia é ausência
 * de nome, não nome, e uma frase que abre com aspas vazias parece defeito de renderização.
 * @param {*} nome
 * @returns {string}
 */
function subject(nome) {
    const limpo = String(nome ?? '').trim();
    return limpo ? `"${limpo}"` : 'este recurso';
}

/** O tipo entre parênteses, ou nada quando o chamador não sabe qual é. */
function typeSuffix(tipoRotulo) {
    const limpo = String(tipoRotulo ?? '').trim();
    return limpo ? ` (${limpo})` : '';
}

/**
 * O aviso que precede a MUDANÇA DE VISIBILIDADE de um item do catálogo, ou `null` quando a
 * mudança é aditiva e não há o que avisar.
 *
 * `null` É O PRODUTO PRINCIPAL, e não um caso degenerado: é ele que o chamador testa para
 * decidir se abre o diálogo, em vez de reexaminar o nível. Qualquer valor que não seja
 * `'private'` cai no ramo aditivo, inclusive lixo: um nível desconhecido não descreve uma
 * perda, e inventar um aviso para ele seria assustar sem informar.
 *
 * A LISTA DE QUEM CONTINUA VENDO é a mesma da dica do formulário, de propósito. Ela é o que
 * transforma "vai ficar privado" em consequência concreta: sem ela o operador não distingue
 * "some para os outros" de "some para mim também", que é a dúvida real de quem clica.
 *
 * @param {string} accessLevel - `'private'` ou `'public'`.
 * @param {{nome?: string, tipoRotulo?: string}} [alvo]
 * @returns {string|null} A mensagem do diálogo, ou `null` quando não se deve perguntar nada.
 */
export function visibilityChangeWarning(accessLevel, { nome, tipoRotulo } = {}) {
    if (accessLevel !== 'private') return null;
    return `${subject(nome)}${typeSuffix(tipoRotulo)} sai do catálogo de todo mundo que não `
        + 'tem acesso próprio a ele, inclusive de quem já o estava usando. '
        + 'Continuam vendo: administradores, credenciados, produtores da OM dona, quem recebeu '
        + 'concessão e quem abrir um atlas que o empreste. '
        + 'Voltar a marcar como público desfaz isto.';
}

/**
 * O toast DEPOIS da mudança de visibilidade, nos dois sentidos.
 *
 * Ele relata o EFEITO e não o sucesso da chamada: "Sucesso" depois de tirar um recurso do
 * catálogo de outras pessoas é a mensagem que faz o operador descobrir o estrago por chamado.
 *
 * @param {{nome?: string, accessLevel?: string}} [params]
 * @returns {string}
 */
export function visibilityChangeSummary({ nome, accessLevel } = {}) {
    if (accessLevel === 'private') {
        return `${subject(nome)} agora é privado: saiu do catálogo de quem não tem acesso próprio.`;
    }
    return `${subject(nome)} agora é público: qualquer pessoa passa a vê-lo no catálogo.`;
}

/**
 * O aviso que precede RETIRAR um empréstimo do atlas.
 *
 * "TODOS OS PARTICIPANTES" NÃO É FORÇA DE EXPRESSÃO, é o alcance literal: o empréstimo é do
 * ATLAS, não de uma pessoa, então retirá-lo alcança de uma vez todo mundo que abre aquele
 * atlas. A menção ao link público está aqui porque ela é a parte que ninguém deduz, e é
 * também a razão de não haver número (ver o `@fileoverview`).
 *
 * A ÚLTIMA ORAÇÃO NÃO É CONSOLO. Retirar o empréstimo é reversível, ao contrário de revogar
 * uma concessão, e dizê-lo é o que mantém o aviso proporcional: um texto que soa
 * irreversível onde não é treina o operador a descontar o que os avisos dizem.
 *
 * @param {{nome?: string, tipoRotulo?: string}} [alvo]
 * @returns {string}
 */
export function lendingRemovalWarning({ nome, tipoRotulo } = {}) {
    return `${subject(nome)}${typeSuffix(tipoRotulo)} deixa de ser enxergado por TODOS os `
        + 'participantes deste atlas, inclusive por quem entra pelo link público, salvo quem '
        + 'tiver acesso a ele por outro caminho. '
        + 'Você pode emprestar de novo depois, enquanto continuar enxergando o recurso.';
}

/**
 * O toast DEPOIS de anexar ou retirar um empréstimo.
 *
 * As duas frases são assimétricas de propósito, como as ações: a de anexar conta um ganho e a
 * de retirar nomeia quem deixa de ver. "Empréstimo retirado." sozinho descrevia a linha do
 * banco, não o efeito.
 *
 * @param {{nome?: string, acao?: 'add'|'remove'}} [params]
 * @returns {string}
 */
export function lendingSummary({ nome, acao } = {}) {
    if (acao === 'remove') {
        return `Empréstimo de ${subject(nome)} retirado: quem dependia deste atlas para vê-lo `
            + 'deixa de enxergá-lo.';
    }
    return `${subject(nome)} emprestado: quem abrir este atlas passa a enxergá-lo.`;
}

/**
 * O texto de apoio da seção de empréstimos: quanto este atlas empresta e, sobretudo, ONDE
 * aquilo vale.
 *
 * A SEGUNDA FRASE EXISTE POR CAUSA DE UM SELO. O catálogo mostra "Privado" para três origens
 * de acesso diferentes (papel global, concessão pessoal e empréstimo do atlas), e só a
 * terceira SOME sozinha quando a pessoa troca de atlas. Nada na tela dizia isso, então o
 * sintoma chegava como "o recurso sumiu" muito depois da causa. Aqui é onde a frase custa
 * menos: quem lê esta seção é exatamente quem cria essa dependência.
 *
 * O NÚMERO DAQUI É O ÚNICO DO MÓDULO, e ele é honesto porque não é de audiência: é o tamanho
 * da lista que a própria seção acabou de desenhar.
 *
 * @param {*} quantosEmprestados - Quantos recursos este atlas empresta hoje.
 * @returns {string}
 */
export function lendingScopeNote(quantosEmprestados) {
    const n = toCount(quantosEmprestados);
    const inicio = n === 0
        ? 'Este atlas não empresta nenhum recurso hoje.'
        : `Este atlas empresta ${resourceCountLabel(n)}.`;
    return `${inicio} O empréstimo vale SÓ dentro deste atlas: quem o recebe por aqui deixa de `
        + 'enxergar o recurso ao abrir outro atlas, a menos que tenha acesso próprio a ele.';
}
