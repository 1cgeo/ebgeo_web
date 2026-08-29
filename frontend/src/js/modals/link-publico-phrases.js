// Path: js/modals/link-publico-phrases.js
/**
 * @fileoverview O QUE O LINK PÚBLICO EXPÕE, dito ao dono na hora de publicar.
 *
 * MÓDULO FOLHA, sem imports, testável em node puro, como os outros `*-phrases.js` da
 * casa. A frase é dado; quem a desenha é o modal.
 *
 * POR QUE ELE EXISTE. A cláusula 6.3 da constituição diz que o empréstimo do atlas alcança
 * o visitante de link público, e ela foi REEXAMINADA e MANTIDA pelo dono em 2026-08-29. A
 * proposta era restringi-la a quem tem conta, e caiu por um argumento que vale repetir
 * aqui: o auto-cadastro é aberto, então "estar logado" não é barreira nenhuma. O eixo que
 * separa de verdade é a NOMEAÇÃO (um share nominal significa que alguém escolheu aquela
 * pessoa; o link público é o único caminho em que ninguém decidiu quem entra), e o dono
 * decidiu que a nomeação continua não sendo exigida.
 *
 * O QUE FALTAVA, ENTÃO, NÃO ERA O PREDICADO: era o CONSENTIMENTO (cláusula 6.6). Um
 * empréstimo é invisível na tela de quem publica o link, que até aqui dizia apenas que
 * "qualquer pessoa com o link pode visualizar este atlas". Isso é verdade e é
 * insuficiente: não diz que junto vai o acervo PRIVADO que o atlas empresta.
 *
 * A FRASE NOMEIA, E NÃO CONTA. "3 recursos privados" não permite decidir nada; os nomes,
 * sim. É a mesma regra dos módulos de frase de ato destrutivo do painel: o número que a
 * frase diz tem de ser o número que o servidor mandou, e onde o nome existe ele vale mais
 * que o número.
 *
 * O TETO DA LISTA existe porque um atlas pode emprestar dezenas: acima dele a frase nomeia
 * os primeiros e diz quantos sobram, em vez de virar um parágrafo que ninguém lê.
 */

/** Quantos nomes a frase lista antes de resumir o resto. */
export const LIMITE_DE_NOMES = 5;

/**
 * Os recursos PRIVADOS de uma lista de empréstimos do atlas.
 *
 * `access_level` NULO NÃO CONTA COMO PRIVADO, e a direção é deliberada: nulo é o
 * empréstimo ÓRFÃO (a linha de catálogo não existe mais), e ele não expõe byte nenhum
 * porque não há recurso para servir. Tratá-lo como privado encheria o aviso de fantasmas
 * e treinaria o dono a ignorá-lo.
 *
 * @param {Array<{name?: string|null, access_level?: string|null, resource_id?: string}>} recursos
 * @returns {Array} Só os privados, na ordem em que vieram.
 */
export function recursosPrivados(recursos) {
    if (!Array.isArray(recursos)) return [];
    return recursos.filter((r) => r && r.access_level === 'private');
}

/**
 * O nome de um recurso emprestado, para leitura humana.
 *
 * Cai no id quando o nome não veio, porque um item sem rótulo nenhum não é acionável: o
 * dono precisa saber QUAL linha desfazer.
 *
 * @param {{name?: string|null, resource_id?: string}} recurso
 * @returns {string}
 */
export function nomeDoRecurso(recurso) {
    const nome = typeof recurso?.name === 'string' ? recurso.name.trim() : '';
    if (nome) return nome;
    const id = typeof recurso?.resource_id === 'string' ? recurso.resource_id.trim() : '';
    return id || 'recurso sem nome';
}

/**
 * O aviso a mostrar na seção do link público, ou `null` quando não há o que avisar.
 *
 * DEVOLVE `null` PARA A LISTA VAZIA, e é o que impede o aviso de virar ruído: um atlas que
 * não empresta nada privado não tem por que exibir uma caixa de alerta. Aviso que aparece
 * sempre é aviso que ninguém lê.
 *
 * @param {Array} recursos - O que `GET /atlas/:id/resources` devolveu.
 * @returns {{titulo: string, nomes: string[], restantes: number, corpo: string}|null}
 */
export function avisoDeExposicao(recursos) {
    const privados = recursosPrivados(recursos);
    if (privados.length === 0) return null;

    const nomes = privados.slice(0, LIMITE_DE_NOMES).map(nomeDoRecurso);
    const restantes = privados.length - nomes.length;

    const titulo = privados.length === 1
        ? 'Este link também dá acesso a 1 item privado'
        : `Este link também dá acesso a ${privados.length} itens privados`;

    // A SEGUNDA FRASE É A QUE IMPORTA, e ela nomeia a consequência em vez do mecanismo:
    // quem recebe o link não precisa entrar, então o acervo privado emprestado sai para
    // qualquer pessoa que tenha o endereço.
    const corpo = 'Quem abrir o link vê estes itens sem precisar entrar, porque este atlas '
        + 'os empresta. Para deixar de expô-los, remova-os do atlas ou não publique o link.';

    return { titulo, nomes, restantes, corpo };
}
