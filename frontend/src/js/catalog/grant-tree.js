// Path: js/catalog/grant-tree.js

/**
 * @fileoverview A árvore de concessões de um recurso, em funções puras.
 *
 * EXISTE POR CAUSA DE UMA FRASE DE INTERFACE. Revogar uma concessão derruba TODA a
 * subárvore que dela deriva (D2: poda recursiva, revogação soft), e essa é a
 * consequência que o usuário não adivinha: ele acha que está tirando o acesso de
 * uma pessoa e tira o de cinco. O aviso só é útil se disser QUANTAS e QUEM, e
 * dizer isso exige percorrer a árvore — que é aritmética, não DOM, e por isso mora
 * aqui, testável em node.
 *
 * A travessia espelha `REVOKE_GRANT_SUBTREE` do servidor, e as duas guardas dela
 * são as mesmas: só concessões VIVAS entram na lista (a listagem já devolve só
 * vivas), e há teto de profundidade. O teto não é paranoia decorativa: um ciclo é
 * impossível por construção no servidor (o pai é fixado no INSERT e nenhuma rota
 * atualiza `parent_grant_id`), mas aqui a entrada é um JSON que chegou pela rede, e
 * uma travessia sem teto sobre dado hostil trava a aba em vez de mostrar um aviso.
 */

/** O mesmo teto de `REVOKE_GRANT_SUBTREE`. Manter os dois iguais é o ponto. */
export const MAX_GRANT_DEPTH = 32;

/**
 * As concessões que caem JUNTO com `rootId`, sem incluir a própria raiz.
 *
 * @param {Array<{id: string, parent_grant_id: string|null}>} grants - As concessões
 *   VIVAS do recurso, como a listagem as devolve.
 * @param {string} rootId - A concessão que se pretende revogar.
 * @returns {Array<Object>} Os descendentes, em ordem de nível (mais próximos primeiro).
 */
export function descendantGrants(grants, rootId) {
    const lista = Array.isArray(grants) ? grants : [];
    if (rootId == null) return [];

    // Índice pai -> filhos. Um `parent_grant_id` nulo é raiz e nunca é chave.
    const filhosDe = new Map();
    for (const g of lista) {
        const pai = g?.parent_grant_id;
        if (pai == null) continue;
        const chave = String(pai);
        if (!filhosDe.has(chave)) filhosDe.set(chave, []);
        filhosDe.get(chave).push(g);
    }

    const vistos = new Set([String(rootId)]);
    const caidos = [];
    let nivel = filhosDe.get(String(rootId)) ?? [];
    let profundidade = 1;

    while (nivel.length > 0 && profundidade < MAX_GRANT_DEPTH) {
        const proximo = [];
        for (const g of nivel) {
            const id = String(g?.id ?? '');
            // O `visitados` é o que impede um ciclo forjado de virar laço infinito,
            // e também o que impede uma concessão de ser contada duas vezes quando
            // dois caminhos chegam nela.
            if (!id || vistos.has(id)) continue;
            vistos.add(id);
            caidos.push(g);
            proximo.push(...(filhosDe.get(id) ?? []));
        }
        nivel = proximo;
        profundidade += 1;
    }

    return caidos;
}

/**
 * O nome de exibição de quem recebeu uma concessão.
 * @param {{grantee_nome?: string, grantee_username?: string}} grant
 * @returns {string}
 */
export function granteeName(grant) {
    return grant?.grantee_nome || grant?.grantee_username || 'Usuário';
}

/**
 * A frase de confirmação da revogação, já com o alcance da poda.
 *
 * É a razão de este módulo existir: sem a contagem, o texto diria "isto pode
 * afetar outras pessoas", que é a forma de avisar sem informar. Com ela, o aviso
 * nomeia quantos caem e os primeiros nomes.
 *
 * @param {Array<Object>} grants - As concessões vivas do recurso.
 * @param {string} rootId
 * @param {number} [maxNomes] - Quantos nomes citar antes de resumir o resto.
 * @returns {string}
 */
export function revocationWarning(grants, rootId, maxNomes = 3) {
    const alvo = (Array.isArray(grants) ? grants : []).find((g) => String(g?.id) === String(rootId));
    const quem = granteeName(alvo);
    const caidos = descendantGrants(grants, rootId);

    if (caidos.length === 0) {
        return `Remover o acesso de ${quem} a este recurso?`;
    }

    const nomes = caidos.slice(0, maxNomes).map(granteeName);
    const resto = caidos.length - nomes.length;
    const lista = resto > 0 ? `${nomes.join(', ')} e mais ${resto}` : nomes.join(', ');
    const pessoas = caidos.length === 1 ? 'pessoa perde' : 'pessoas perdem';

    return `Remover o acesso de ${quem} a este recurso? ` +
        `Quem recebeu acesso ATRAVÉS de ${quem} perde junto: ${caidos.length} ${pessoas} o acesso (${lista}).`;
}
