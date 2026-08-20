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
 *
 * O BENEFICIÁRIO TEM DOIS TIPOS, e a frase precisa ser verdadeira nos dois. Uma
 * concessão é a uma PESSOA ou a um GRUPO, nunca aos dois (o banco cobra
 * `CHECK (num_nonnulls(grantee_id, grantee_group_id) = 1)`), então numa concessão a
 * grupo os campos de pessoa vêm NULOS. Contar tudo como "pessoa" fazia o aviso
 * mentir em dois lugares ao mesmo tempo: chamava um grupo de doze de "Usuário" e
 * dizia "N pessoas perdem o acesso" quando um dos N era um grupo. As funções deste
 * arquivo discriminam pelo campo (`isGroupGrant`), nunca pela ausência de nome.
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
 * Se o beneficiário desta concessão é um GRUPO, e não uma pessoa.
 *
 * O discriminador é a PRESENÇA do campo, nunca a ausência do nome da pessoa: o
 * `CHECK` do banco garante exatamente um dos dois alvos, então `grantee_group_id`
 * preenchido é a resposta inteira. Adivinhar por "não veio nome de pessoa"
 * classificaria como grupo qualquer linha com usuário apagado.
 *
 * @param {{grantee_group_id?: string|null}} grant
 * @returns {boolean}
 */
export function isGroupGrant(grant) {
    const id = grant?.grantee_group_id;
    return id != null && String(id) !== '';
}

/**
 * Quantas pessoas o grupo beneficiário reúne, ou 0 quando não é grupo, quando a
 * contagem não veio e quando o grupo está vazio.
 *
 * Os três casos colapsam em 0 de propósito: o único uso é decidir se há número para
 * mostrar, e "não sei" e "nenhum" levam à mesma decisão de interface.
 *
 * @param {{grantee_group_member_count?: number|null}} grant
 * @returns {number}
 */
export function groupMemberCount(grant) {
    if (!isGroupGrant(grant)) return 0;
    const n = Number(grant?.grantee_group_member_count);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * O nome de exibição de quem recebeu uma concessão, pessoa OU grupo.
 *
 * Numa concessão a grupo `grantee_nome` e `grantee_username` vêm nulos por CHECK, e
 * a versão anterior desta função caía no literal 'Usuário' — a lista e a frase de
 * revogação chamavam um grupo de doze pessoas de "Usuário". O fallback do grupo
 * existe pela mesma razão do fallback da pessoa: string vazia é ausência, não nome,
 * e a linha em branco é pior que um rótulo genérico.
 *
 * @param {{grantee_nome?: string, grantee_username?: string,
 *   grantee_group_id?: string|null, grantee_group_name?: string}} grant
 * @returns {string}
 */
export function granteeName(grant) {
    if (isGroupGrant(grant)) return grant?.grantee_group_name || 'Grupo';
    return grant?.grantee_nome || grant?.grantee_username || 'Usuário';
}

/**
 * O beneficiário na forma PREPOSICIONADA, para entrar numa frase sem concordar
 * errado: "de Ana" e "do grupo Equipe Alfa".
 *
 * Existe porque a alternativa (montar a frase com o nome cru) obriga cada chamador
 * a decidir a preposição, e o chamador que esquecer produz "o acesso de Equipe
 * Alfa", que soa como pessoa exatamente onde a diferença importa.
 *
 * @param {Object} grant
 * @returns {string}
 */
export function granteeSubject(grant) {
    const nome = granteeName(grant);
    return isGroupGrant(grant) ? `do grupo ${nome}` : `de ${nome}`;
}

/**
 * Quantas concessões da lista são a pessoa e quantas são a grupo.
 * @param {Array<Object>} grants
 * @returns {{pessoas: number, grupos: number}}
 */
export function granteeCounts(grants) {
    let pessoas = 0;
    let grupos = 0;
    for (const g of (Array.isArray(grants) ? grants : [])) {
        if (isGroupGrant(g)) grupos += 1;
        else pessoas += 1;
    }
    return { pessoas, grupos };
}

/**
 * Quem JÁ recebeu este recurso, nos DOIS eixos de beneficiário.
 *
 * O seletor de conceder tira daqui quem não pode ser oferecido de novo. Sem o eixo
 * de grupo a tela ofereceria um grupo que já tem acesso, o servidor devolveria 409 e
 * o usuário não teria como saber por quê: os ids vivem em colunas diferentes, então
 * um conjunto só não serve para os dois.
 *
 * @param {Array<Object>} grants - As concessões vivas do recurso.
 * @returns {{userIds: Set<string>, groupIds: Set<string>}}
 */
export function alreadyGranted(grants) {
    const userIds = new Set();
    const groupIds = new Set();
    for (const g of (Array.isArray(grants) ? grants : [])) {
        if (isGroupGrant(g)) groupIds.add(String(g.grantee_group_id));
        else if (g?.grantee_id != null) userIds.add(String(g.grantee_id));
    }
    return { userIds, groupIds };
}

/**
 * Como a lista de nomes cita UM caído: o grupo leva junto o tamanho dele.
 *
 * O tamanho entra aqui, na linha, e NÃO somado ao total da frase: uma pessoa pode
 * estar em dois grupos e também ter concessão própria, então somar membros daria um
 * número inflado, e um aviso com número inflado é um aviso que ninguém acredita na
 * segunda vez.
 *
 * @param {Object} grant
 * @returns {string}
 */
function granteeListLabel(grant) {
    const nome = granteeName(grant);
    const membros = groupMemberCount(grant);
    if (!membros) return nome;
    return `${nome} (${membros} ${membros === 1 ? 'pessoa' : 'pessoas'})`;
}

/**
 * O resumo do que cai junto, verdadeiro nos três casos (só pessoas, só grupos,
 * misto).
 *
 * "N pessoas perdem o acesso" era verdade enquanto beneficiário era sinônimo de
 * pessoa e vira mentira com um grupo no meio. A saída é contar cada tipo pelo nome:
 * "2 pessoas e 1 grupo perdem o acesso". O verbo concorda com o TOTAL de
 * concessões, não com a última parcela, porque é o total que cai.
 *
 * @param {Array<Object>} caidos
 * @returns {string}
 */
function fallenSummary(caidos) {
    const { pessoas, grupos } = granteeCounts(caidos);
    const partes = [];
    if (pessoas > 0) partes.push(`${pessoas} ${pessoas === 1 ? 'pessoa' : 'pessoas'}`);
    if (grupos > 0) partes.push(`${grupos} ${grupos === 1 ? 'grupo' : 'grupos'}`);
    const verbo = (pessoas + grupos) === 1 ? 'perde' : 'perdem';
    return `${partes.join(' e ')} ${verbo} o acesso`;
}

/**
 * A frase de confirmação da revogação, já com o alcance da poda.
 *
 * É a razão de este módulo existir: sem a contagem, o texto diria "isto pode
 * afetar outras pessoas", que é a forma de avisar sem informar. Com ela, o aviso
 * nomeia quantos caem e os primeiros nomes.
 *
 * A redação é a de `fallenSummary` e a de `granteeSubject`: o alvo aparece
 * preposicionado ("de Ana", "do grupo Equipe Alfa") e o que cai é contado por tipo,
 * porque um beneficiário coletivo no meio da poda invalida qualquer frase que diga
 * só "pessoas". O tamanho de cada grupo vai na CITAÇÃO dele, nunca somado ao total.
 *
 * @param {Array<Object>} grants - As concessões vivas do recurso.
 * @param {string} rootId
 * @param {number} [maxNomes] - Quantos nomes citar antes de resumir o resto.
 * @returns {string}
 */
export function revocationWarning(grants, rootId, maxNomes = 3) {
    const alvo = (Array.isArray(grants) ? grants : []).find((g) => String(g?.id) === String(rootId));
    const quem = granteeSubject(alvo);
    const caidos = descendantGrants(grants, rootId);

    if (caidos.length === 0) {
        return `Remover o acesso ${quem} a este recurso?`;
    }

    const nomes = caidos.slice(0, maxNomes).map(granteeListLabel);
    const resto = caidos.length - nomes.length;
    const lista = resto > 0 ? `${nomes.join(', ')} e mais ${resto}` : nomes.join(', ');

    return `Remover o acesso ${quem} a este recurso? ` +
        `Quem recebeu acesso ATRAVÉS ${quem} perde junto: ${fallenSummary(caidos)} (${lista}).`;
}
