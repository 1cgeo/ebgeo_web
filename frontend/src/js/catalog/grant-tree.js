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
 * SÃO DUAS TRAVESSIAS, E A DIFERENÇA ENTRE ELAS É O AVISO. `descendantGrants` é o fecho
 * INGÊNUO (tudo o que pende), e `fallenGrants` é o que o servidor de fato derruba depois
 * da preservação de alcançabilidade. As duas guardas são as mesmas nas duas: só
 * concessões VIVAS entram (a listagem já devolve só vivas) e há teto de profundidade. O
 * teto não é paranoia decorativa: aqui a entrada é um JSON que chegou pela rede, e uma
 * travessia sem teto sobre dado hostil trava a aba em vez de mostrar um aviso.
 *
 * O ESPELHAMENTO COM `REVOKE_SUBTREE_PRESERVING_REACH` (servidor) É PARCIAL POR
 * CONSTRUÇÃO, e essa é a propriedade mais importante deste arquivo. O nome do lado de lá
 * mudou junto com a semântica, e o cliente NÃO consegue reproduzir o braço de GRUPO,
 * porque a listagem não carrega a composição do grupo. A vida do concedente ELE
 * CONSEGUE, desde 2026-08-21: a listagem passou a mandar `granted_by_vivo` justamente
 * porque esse era o braço em que a divergência fazia o aviso mentir para o lado
 * perigoso. O recorte exato e a direção do erro estão em `fallenGrants`. Este arquivo não
 * é a autoridade sobre quem cai; ele é a melhor frase possível ANTES do clique, e a
 * resposta do servidor é quem diz o que aconteceu.
 *
 * O BENEFICIÁRIO TEM DOIS TIPOS, e a frase precisa ser verdadeira nos dois. Uma
 * concessão é a uma PESSOA ou a um GRUPO, nunca aos dois (o banco cobra
 * `CHECK (num_nonnulls(grantee_id, grantee_group_id) = 1)`), então numa concessão a
 * grupo os campos de pessoa vêm NULOS. Contar tudo como "pessoa" fazia o aviso
 * mentir em dois lugares ao mesmo tempo: chamava um grupo de doze de "Usuário" e
 * dizia "N pessoas perdem o acesso" quando um dos N era um grupo. As funções deste
 * arquivo discriminam pelo campo (`isGroupGrant`), nunca pela ausência de nome.
 *
 * DESDE 2026-08-23 ELE CARREGA TAMBÉM QUEM PODE REVOGAR (`revokeAvailability`), e não é
 * assunto novo: é a mesma pergunta ("o que este clique faz de verdade") um passo antes. A
 * tela desenhava o botão em toda linha, então a pessoa que não concedeu atravessava o aviso
 * destrutivo inteiro para receber 403 no fim. A regra é do SERVIDOR e mora aqui só porque é
 * aritmética sobre o payload, testável em node, como o resto do arquivo.
 *
 * E DESDE 2026-08-24 ELE CARREGA O QUE A TELA DIZ NOS ESTADOS QUE NÃO SÃO A LISTA (o alcance
 * que a lista não cobre, a busca que falhou, a leitura recusada, o efeito real da revogação e
 * o desfecho de estender um prazo). O critério de moradia é o mesmo de sempre: nada disso é
 * DOM, tudo isso é decidido por comparação sobre o payload, e frase de ato irreversível que
 * mora dentro de um construtor de HTML não é testável em node. O arquivo continua com ZERO
 * imports, e isso é contrato (`frontend/tests/unit/compartilhar-sem-a-store.test.js` mede o
 * grafo que ele acrescenta a uma página que boota sem a store).
 */

/** O mesmo teto de `REVOKE_SUBTREE_PRESERVING_REACH`. Manter os dois iguais é o ponto. */
export const MAX_GRANT_DEPTH = 32;

/**
 * Se esta concessão já NÃO entrega acesso porque quem a concedeu foi desativado
 * (conta ou OM), o que D8(b) transformou em morte de caminho no servidor.
 *
 * É O ÚNICO LUGAR ONDE A COMPARAÇÃO ACONTECE, e ela é com `false`, nunca a negação
 * nua. `undefined` é "a listagem não mandou o campo" (servidor antigo, implantação em
 * duas etapas), e ali o certo é o comportamento de antes; `!granted_by_vivo` trataria
 * TODA linha como morta, o que faz o resgate de `fallenGrants` sumir e a tela marcar o
 * recurso inteiro como sem efeito. Concessão sem concedente (`granted_by` nulo, a da
 * administração) vem com o campo VERDADEIRO do servidor por construção, então este
 * predicado nunca a acusa.
 *
 * @param {{granted_by_vivo?: boolean}} grant
 * @returns {boolean}
 */
export function isGrantorDead(grant) {
    return grant?.granted_by_vivo === false;
}

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
 * Os que REALMENTE caem junto com `rootId`, depois da preservação de alcançabilidade.
 *
 * É {@link descendantGrants} menos quem o servidor RESGATA. Desde 2026-08-21 a poda
 * deixou de derrubar todo descendente: um filho cujo CONCEDENTE ainda tenha `view_share`
 * vivo sobre o mesmo recurso, FORA do alcance da poda, é re-pendurado nesse outro pai em
 * vez de revogado (decisão do dono: "se B não caiu, D não deve cair"). Quando um
 * descendente é resgatado, a subárvore dele sai junto — é a mesma regra do braço
 * recursivo de `podados` no servidor, que não desce por um nó resgatado.
 *
 * `descendantGrants` FICA INTACTA e continua sendo o fecho ingênuo, porque é dela que
 * sai o conjunto de exclusão: "fora do alcance da poda" só se sabe calculando o alcance
 * primeiro.
 *
 * O ALCANCE DESTA FUNÇÃO É ESTREITO, E A DIREÇÃO DO ERRO PRECISA SER SUPERESTIMAR. Um
 * aviso que assusta a mais e o usuário revoga assim mesmo custa menos que um aviso que
 * tranquiliza e derruba alguém sem avisar, e a revogação é irreversível.
 *
 * O QUE SUPERESTIMA, e é seguro: o braço de GRUPO do servidor não é computável aqui.
 * `LIST_GRANTS_FOR_RESOURCE` devolve `grantee_group_id` e `grantee_group_member_count`,
 * nunca a lista de membros, então o cliente não tem como saber se o concedente pertence
 * ao grupo que recebeu o outro `view_share`. Esta função conta o descendente como CAÍDO
 * e avisa que N caem quando caem N-1.
 *
 * O QUE SUBESTIMAVA, E FOI CORRIGIDO EM 2026-08-21, porque a mesma prosa que declarava a
 * direção acima também a afirmava para a VIDA DO CONCEDENTE, onde ela era falsa. O
 * servidor exige `fn_principal_vivo(granted_by)` no pai alternativo (D8(b)); a listagem
 * não mandava esse fato, então o cliente resgatava por um `view_share` que o servidor
 * recusa — o aviso dizia "ninguém cai" e o toast seguinte contava uma queda. A listagem
 * passou a devolver `granted_by_vivo`, e o resgate abaixo o exige. Repare que a linha de
 * concedente morto CONTINUA na lista de propósito (ela é revogável, e some da tela seria
 * pior): o que mudou é ela deixar de valer como caminho de acesso.
 *
 * O QUE AINDA SUBESTIMA, e não foi fechado: o TETO DE PROFUNDIDADE. O servidor desliga o
 * resgate INTEIRO quando a travessia trunca em 32 (`teto.truncado`), enquanto esta função
 * continua resgatando até `MAX_GRANT_DEPTH`. Numa árvore de mais de 32 níveis o aviso
 * subestima. Nenhuma árvore medida chega perto disso, e fechar exigiria replicar aqui a
 * regra de truncamento do servidor — mas é buraco conhecido, não invariante.
 *
 * @param {Array<{id: string, parent_grant_id: string|null, granted_by?: string|null,
 *   grant_level?: string, grantee_id?: string|null, granted_by_vivo?: boolean}>} grants -
 *   As concessões VIVAS do recurso, como a listagem as devolve.
 * @param {string} rootId - A concessão que se pretende revogar.
 * @returns {Array<Object>} Os que caem, em ordem de nível, sem a raiz.
 */
export function fallenGrants(grants, rootId) {
    const lista = Array.isArray(grants) ? grants : [];
    if (rootId == null) return [];

    // O ALCANCE, que é o conjunto de exclusão. A raiz entra nele porque ela também está
    // sendo revogada: um pai alternativo que seja a própria raiz não salva ninguém.
    const alcance = new Set([String(rootId)]);
    for (const g of descendantGrants(lista, rootId)) alcance.add(String(g?.id ?? ''));

    // Quem tem `view_share` vivo FORA do alcance, por pessoa. Só o eixo pessoal: ver o
    // recorte declarado acima.
    const compartilhamPorPessoa = new Map();
    for (const g of lista) {
        if (g?.grant_level !== 'view_share') continue;
        if (alcance.has(String(g?.id ?? ''))) continue;
        // D8(b): concessão de concedente MORTO não é caminho de acesso, então não
        // resgata ninguém. O predicado é `isGrantorDead` e não a comparação escrita à
        // mão porque ele é o MESMO fato que o marcador da lista mostra: duas cópias da
        // comparação divergem, e a divergência aqui é o aviso pré-clique discordando do
        // que a tela acabou de afirmar sobre a mesma linha.
        if (isGrantorDead(g)) continue;
        const dono = g?.grantee_id;
        if (dono == null) continue;
        const chave = String(dono);
        if (!compartilhamPorPessoa.has(chave)) compartilhamPorPessoa.set(chave, []);
        compartilhamPorPessoa.get(chave).push(String(g.id));
    }

    /** Se este nó é resgatado: o concedente dele tem outro `view_share` fora do alcance. */
    const resgatado = (g) => {
        const por = g?.granted_by;
        if (por == null) return false;
        const outros = compartilhamPorPessoa.get(String(por)) ?? [];
        // `!== g.id` porque o próprio nó pode ser um `view_share` do próprio concedente
        // em outra linha; um nó nunca é o pai de si mesmo.
        return outros.some((id) => id !== String(g?.id ?? ''));
    };

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
            if (!id || vistos.has(id)) continue;
            vistos.add(id);
            // O RESGATADO NÃO CAI E A SUBÁRVORE DELE NÃO É PERCORRIDA: o servidor
            // re-pendura o nó e para de descer por ali, então os netos continuam
            // pendurados num pai que sobreviveu.
            if (resgatado(g)) continue;
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
 * DE QUEM É O GRUPO que recebeu esta concessão, ou `''` quando ela é a uma pessoa.
 *
 * A DELEGAÇÃO SÓ APARECE AQUI. Conceder um recurso privado a um grupo entrega ao DONO
 * daquele grupo o poder de acrescentar beneficiários sem passar por quem concedeu: ele
 * põe mais gente lá dentro e o acesso segue junto, sem linha nova em `resource_grants`
 * e sem passar pelo gate de repasse. A lista "quem tem acesso" é a única superfície
 * onde essa transferência de autoridade é visível, e enquanto ela mostrava só o nome do
 * grupo a parte delegada do mecanismo não aparecia em tela nenhuma. É por isso que o
 * servidor passou a mandar `grantee_group_owner_*` junto de cada concessão coletiva.
 *
 * Espelha `groupOwnerLabel` (`js/admin/group-phrases.js`) na frase e no ramo do órfão,
 * e NÃO o importa: aquele arquivo é da página de administração e este roda dentro do
 * mapa. São duas telas com o mesmo vocabulário, não um módulo compartilhado.
 *
 * Grupo SEM dono é estado real (o backfill da migração adota `created_by`, que pode ser
 * nulo em linha antiga) e dizê-lo por extenso importa: um grupo órfão não entrega
 * acesso a ninguém, porque o predicado de resolução exige dono vivo.
 *
 * @param {{grantee_group_id?: string|null, grantee_group_owner_nome?: string,
 *   grantee_group_owner_username?: string}} grant
 * @returns {string} A frase pronta, ou string vazia para concessão a pessoa.
 */
export function granteeGroupOwnerLabel(grant) {
    if (!isGroupGrant(grant)) return '';
    const nome = (grant?.grantee_group_owner_nome || '').trim();
    const username = (grant?.grantee_group_owner_username || '').trim();
    if (nome && username) return `Dono: ${nome} (@${username})`;
    if (nome) return `Dono: ${nome}`;
    if (username) return `Dono: @${username}`;
    return 'Sem dono definido';
}

/**
 * O rótulo de uma `<option>` do seletor de grupo: nome, tamanho e, só quando o grupo é de
 * OUTRA pessoa, de quem ele é.
 *
 * O SUFIXO NASCEU NO MESMO COMMIT QUE TORNOU O HOMÔNIMO LEGAL. A unicidade de nome de
 * grupo deixou de ser global e passou a ser POR DONO (`(owner_id, LOWER(name))`), então
 * dois donos diferentes podem ter uma "Equipe Alfa" e o servidor não impede. Quem vê
 * grupo alheio nesta lista é só o administrador global (a listagem é recortada pelo
 * predicado de posse), e para ele duas linhas idênticas significam escolher o coletivo
 * errado ao conceder um recurso privado, sem erro nenhum e sem desfazer prático.
 *
 * O GRUPO PRÓPRIO NÃO GANHA SUFIXO, e essa é a metade que faz o sufixo informar: se
 * toda linha dissesse "Dono: eu", a linha alheia deixaria de saltar.
 *
 * Comparação por `String(...)`: o id vem do JSON da rede e o do visitante vem da sessão,
 * e uma comparação estrita entre tipos diferentes esconderia o grupo próprio atrás de um
 * sufixo. `viewerId` ausente (sessão não lida) trata TODO grupo como alheio, que é o
 * lado seguro: rótulo a mais é ruído, rótulo a menos é a ambiguidade que isto fecha.
 *
 * @param {{id?: string, name?: string, member_count?: number,
 *   owner_id?: string|null, owner_nome?: string, owner_username?: string}} group
 * @param {string|null} [viewerId] - Quem está olhando.
 * @returns {string}
 */
export function groupOptionLabel(group, viewerId = null) {
    // `|| 'Grupo'`, e não `??`: nome vazio é ausência, como em `granteeName`, e uma
    // opção sem texto é uma linha invisível dentro do seletor.
    const nome = String(group?.name || 'Grupo');
    const membros = Number(group?.member_count);
    const quantos = Number.isFinite(membros) && membros > 0
        ? `${membros} ${membros === 1 ? 'pessoa' : 'pessoas'}`
        : 'sem membros';
    const proprio = viewerId != null && group?.owner_id != null
        && String(group.owner_id) === String(viewerId);
    if (proprio) return `${nome} (${quantos})`;
    const dono = (group?.owner_nome || '').trim()
        || (group?.owner_username ? `@${String(group.owner_username).trim()}` : '');
    return dono ? `${nome} (${quantos}) · de ${dono}` : `${nome} (${quantos}) · sem dono definido`;
}

/**
 * O MARCADOR da linha cujo concedente morreu, ou `null` quando ela vale.
 *
 * A LISTA SE CHAMA "QUEM TEM ACESSO" E ESTAVA AFIRMANDO ACESSO QUE O PREDICADO DO
 * SERVIDOR JÁ NEGA. A linha continua ali de propósito (ela é a única superfície por
 * onde alguém a revoga de vez, e reativar a OM a devolve), mas sem marcador ela é
 * indistinguível de uma concessão viva: quem olha conta uma pessoa a mais com acesso e
 * quem administra deixa de revogar a aresta que uma cascata futura ainda alcança.
 *
 * SEM `title` O CHIP SERIA UM ENIGMA. "sem efeito" diz o estado e não a causa, e a causa
 * é acionável (reativar a conta ou a OM devolve o acesso, revogar encerra a linha), então
 * ela vai por extenso na dica em vez de virar um rótulo comprido no meio da linha.
 *
 * @param {{granted_by_vivo?: boolean}} grant
 * @returns {{label: string, title: string}|null}
 */
export function deadGrantorChip(grant) {
    if (!isGrantorDead(grant)) return null;
    return {
        label: 'sem efeito',
        title: 'Quem concedeu este acesso teve a conta ou a OM desativada, e por isso esta '
            + 'linha já não entrega acesso a ninguém. Ela continua aqui só para poder ser '
            + 'revogada; reativar a conta ou a OM devolve o acesso.',
    };
}

/**
 * DE QUEM veio esta concessão, na frase que a linha exibe embaixo do nome.
 *
 * O NOME CONTINUA VISÍVEL QUANDO O CONCEDENTE MORRE, e é o ponto desta função. Quem
 * decide entre revogar e pedir a reativação da OM precisa saber DE QUEM a concessão
 * veio; esconder o nome trocaria uma afirmação errada ("recebido de X", com X já
 * desativado) por uma tela sem informação nenhuma. O que muda é só o verbo: a frase
 * deixa de afirmar um acesso vigente e passa a narrar a origem no passado.
 *
 * `granted_by` nulo é a concessão da ADMINISTRAÇÃO (raiz sem concedente), e ela nunca
 * cai no ramo de morto: ver {@link isGrantorDead}.
 *
 * @param {{granted_by_nome?: string, granted_by_username?: string,
 *   granted_by_vivo?: boolean}} grant
 * @returns {string}
 */
export function grantOriginLabel(grant) {
    // `||` e não `??`, como em `granteeName`: string vazia é ausência de nome, não nome.
    const concedente = grant?.granted_by_nome || grant?.granted_by_username || '';
    if (!concedente) return 'concedido pela administração';
    return isGrantorDead(grant) ? `veio de ${concedente}` : `recebido de ${concedente}`;
}

/**
 * Os dois desfechos de "esta pessoa pode remover ESTA concessão?".
 *
 * Enum, e não booleano, pela mesma razão de `LEAVE_AVAILABILITY` (`js/admin/group-phrases.js`):
 * a tela desenha COISAS DIFERENTES nos dois ramos (botão num, nota no outro), e um booleano
 * empurra o segundo ramo para o vazio, que é o que se lê como tela quebrada.
 */
export const REVOKE_AVAILABILITY = Object.freeze({
    /** O servidor aceitaria a revogação. */
    PODE: 'pode',
    /** O servidor recusaria: quem olha não concedeu esta linha e não administra o sistema. */
    NAO_CONCEDEU: 'nao-concedeu',
});

/**
 * QUEM O SERVIDOR ACEITA COMO REVOGADOR DESTA LINHA, espelhado de `GRANT_REVOKER_ACTOR`
 * (`backend/src/middleware/resource-access.js`).
 *
 * EXISTE PORQUE A TELA OFERECIA O ATO A TODO MUNDO. `_renderGrantItem` emitia o botão
 * "Remover acesso" em toda linha da árvore, e o caminho que isso produz é o pior possível
 * para um ato irreversível: a pessoa clica, recebe o diálogo destrutivo COMPLETO (que nomeia
 * quem perde acesso e conta a queda da subárvore), confirma, e só então toma 403. Ela
 * atravessa inteiro um aviso sobre uma consequência que nunca teve como causar.
 *
 * SÃO DUAS SITUAÇÕES DO LADO DE LÁ, E SÓ DUAS: quem CONCEDEU aquela linha
 * (`g.granted_by = $2`) e o administrador GLOBAL (`u.role = 'admin'`). O credenciado saiu do
 * ramo curinga na fase F9 e não volta aqui: ler todo recurso privado e desfazer a concessão
 * de outra pessoa são poderes diferentes.
 *
 * REPARE QUE ISTO NÃO É LISTA FECHADA DE PAPEL, e o desenho do servidor é o que garante
 * isso: o ramo largo pergunta por UM papel (quem administra o sistema) e o ramo estreito não
 * pergunta por papel nenhum, pergunta por AUTORIA. Papel novo entra por `granted_by` sem que
 * ninguém edite esta função.
 *
 * `granted_by` AUSENTE OU NULO FECHA, e a direção não é escolha de estilo: no servidor
 * `g.granted_by = $2::uuid` com `granted_by` nulo devolve NULL, que não é `true`, então
 * `requireGrantRevoker` recusa. A concessão da ADMINISTRAÇÃO (raiz sem concedente) é
 * exatamente essa linha, e só o administrador global a remove. Fechar aqui é reproduzir o
 * servidor, não ser conservador com ele; e mesmo que não fosse, a direção fechada é a certa
 * para um ato irreversível, porque o custo de esconder um botão que funcionaria é um pedido
 * a quem concedeu, e o de mostrar um que não funciona é o diálogo destrutivo acima.
 *
 * `isAdmin` é comparado com `true` ESTRITO: o chamador passa `sessionContext.isAdmin()`, e
 * um dia em que essa chamada devolver `undefined` (sessão ainda não lida) a comparação
 * frouxa abriria o ramo largo por acidente.
 *
 * NÃO É FRONTEIRA DE SEGURANÇA. O servidor redecide a cada requisição; isto é o que impede
 * a tela de PROMETER o que ele vai negar.
 *
 * A JANELA EM QUE ELE ERRA É CONHECIDA E DELIBERADA, e vale escrevê-la: `isAdmin` vem do JWT,
 * enquanto o servidor (`GRANT_REVOKER_ACTOR`) resolve o papel no BANCO e exige, além dele, conta
 * e OM de lotação ativas. Um administrador rebaixado com token ainda válido continua vendo o
 * botão e continua levando 403, pela duração do access token. Fechar isso exigiria consultar o
 * servidor a cada linha desenhada, que é caro e não impede nada que o servidor já não impeça.
 *
 * O QUE MUDOU EM 2026-08-24 não foi a janela, foi o que a pessoa lê ao cair nela: a tela de
 * recusa (`_renderDenied`, `catalog/resource-share.modal.js`) afirmava "você recebeu este recurso
 * apenas para ver", o que era falso justamente para quem chega aqui por esta janela (e para o
 * produtor cujo escopo mudou). Ela parou de afirmar a causa. Higiene que mente é pior que
 * higiene que falta.
 *
 * @param {{granted_by?: string|null}} grant - A concessão desenhada na linha.
 * @param {{userId?: string|null, isAdmin?: boolean}} actor - Quem está olhando.
 * @returns {string} Um valor de {@link REVOKE_AVAILABILITY}.
 */
export function revokeAvailability(grant, actor) {
    if (actor?.isAdmin === true) return REVOKE_AVAILABILITY.PODE;
    const concedente = grant?.granted_by;
    const quem = actor?.userId;
    if (concedente == null || quem == null) return REVOKE_AVAILABILITY.NAO_CONCEDEU;
    // `String(...)` dos dois lados: o id da concessão vem do JSON da rede e o do visitante
    // vem da sessão, como em `groupOptionLabel`.
    return String(concedente) === String(quem)
        ? REVOKE_AVAILABILITY.PODE
        : REVOKE_AVAILABILITY.NAO_CONCEDEU;
}

/**
 * A NOTA QUE OCUPA O LUGAR DO BOTÃO quando o servidor recusaria a revogação.
 *
 * ESPAÇO VAZIO SE LÊ COMO TELA QUEBRADA, e o padrão da casa é dizer por que não há botão
 * (precedente: a nota do dono que não pode sair do grupo, `js/admin/groups-tab.js`). Aqui a
 * causa é acionável, e é isso que a torna vale a pena escrever: quem concedeu tem NOME no
 * payload da listagem (`granted_by_nome`/`granted_by_username`), então a nota diz a quem
 * pedir em vez de deixar a pessoa concluir que o acesso é irremovível.
 *
 * O RÓTULO É CURTO E A CAUSA VAI NO `title`, pela mesma divisão de `deadGrantorChip`: a
 * linha já carrega chip de prazo, chip de cascata e o nível, e um parágrafo no meio dela
 * empurraria tudo para fora da tela.
 *
 * SEM CONCEDENTE É OUTRA FRASE, não a mesma com um buraco: a concessão da administração não
 * tem a quem pedir, e mandar procurar "quem concedeu" seria mandar procurar ninguém.
 *
 * @param {{granted_by_nome?: string, granted_by_username?: string}} grant
 * @returns {{label: string, title: string}}
 */
export function revokeBlockedNotice(grant) {
    // `||` e não `??`, como em `grantOriginLabel`: string vazia é ausência de nome.
    const concedente = grant?.granted_by_nome || grant?.granted_by_username || '';
    const label = 'só quem concedeu remove';
    if (!concedente) {
        return {
            label,
            title: 'Esta concessão foi feita pela administração, e não por uma pessoa a quem '
                + 'pedir. Só um administrador do sistema pode removê-la.',
        };
    }
    return {
        label,
        title: `Quem concedeu este acesso foi ${concedente}, e só quem concedeu (ou um `
            + 'administrador do sistema) pode removê-lo. Peça a remoção a essa pessoa.',
    };
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
 * A ORAÇÃO "quem perde o acesso": o sujeito que o chamador já flexionou, o verbo
 * concordando com a CONTAGEM, e o ramo ZERO dizendo o CONTRÁRIO de uma perda.
 *
 * EXISTE PORQUE A MESMA REGRA JÁ FOI ERRADA EM DOIS DIÁLOGOS DESTRUTIVOS. Um sintagma
 * nominal ("3 pessoas", "sem membros", "2 pessoas e 1 grupo") é feito para caber numa
 * meta de linha, e ele está certo como sintagma; o que ele não sabe é conjugar. Colar um
 * verbo fixo no plural ao lado dele produz "1 pessoa perdem o acesso" e, pior, "sem
 * membros perdem o acesso" — um `destructive: true` afirmando uma perda que não vai
 * acontecer, que é a forma de gastar a credibilidade do aviso justamente no dia em que
 * ele for verdadeiro. A conjugação mora aqui, uma vez, e não em cada frase.
 *
 * O RAMO ZERO NÃO É A MESMA FRASE MAIS CURTA, É A FRASE CONTRÁRIA, na mesma linha do que
 * `groupDeletionWarning` (`js/admin/group-phrases.js`) já faz com o grupo vazio: quando
 * ninguém cai, o texto tem de dizer que ninguém cai. Por isso ele descarta o sujeito.
 *
 * A CONTAGEM É NORMALIZADA COMO EM {@link groupMemberCount}: string de `COUNT`, `null`,
 * `NaN` e negativo colapsam em 0. É o mesmo motivo dos dois lados — nenhuma dessas
 * entradas descreve uma perda, e todas elas conjugariam no plural por acidente.
 *
 * @param {*} count - Quantos caem. Só o número decide o verbo.
 * @param {string} [subject] - O sujeito já flexionado. Ignorado no ramo zero; vazio
 *   degrada para o próprio número, que continua verdadeiro, em vez de abrir a frase
 *   com um espaço.
 * @returns {string}
 */
export function accessLossClause(count, subject = '') {
    const n = Number(count);
    const total = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
    if (total === 0) return 'ninguém perde o acesso';
    const sujeito = String(subject ?? '').trim() || String(total);
    return `${sujeito} ${total === 1 ? 'perde' : 'perdem'} o acesso`;
}

/**
 * O resumo do que cai junto, verdadeiro nos três casos (só pessoas, só grupos,
 * misto).
 *
 * "N pessoas perdem o acesso" era verdade enquanto beneficiário era sinônimo de
 * pessoa e vira mentira com um grupo no meio. A saída é contar cada tipo pelo nome:
 * "2 pessoas e 1 grupo perdem o acesso". O verbo concorda com o TOTAL de
 * concessões, não com a última parcela, porque é o total que cai — e quem conjuga é
 * {@link accessLossClause}, para que a regra não exista em duas cópias.
 *
 * @param {Array<Object>} caidos
 * @returns {string}
 */
function fallenSummary(caidos) {
    const { pessoas, grupos } = granteeCounts(caidos);
    const partes = [];
    if (pessoas > 0) partes.push(`${pessoas} ${pessoas === 1 ? 'pessoa' : 'pessoas'}`);
    if (grupos > 0) partes.push(`${grupos} ${grupos === 1 ? 'grupo' : 'grupos'}`);
    return accessLossClause(pessoas + grupos, partes.join(' e '));
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
    // `fallenGrants`, e NÃO `descendantGrants`: depois da preservação de alcançabilidade
    // o fecho ingênuo passou a contar como caído quem o servidor resgata, e um aviso que
    // mente sobre o alcance de um ato irreversível é a mesma classe de defeito que a doc
    // desatualizada.
    const caidos = fallenGrants(grants, rootId);

    if (caidos.length === 0) {
        return `Remover o acesso ${quem} a este recurso?`;
    }

    const nomes = caidos.slice(0, maxNomes).map(granteeListLabel);
    const resto = caidos.length - nomes.length;
    const lista = resto > 0 ? `${nomes.join(', ')} e mais ${resto}` : nomes.join(', ');

    return `Remover o acesso ${quem} a este recurso? ` +
        `Quem recebeu acesso ATRAVÉS ${quem} perde junto: ${fallenSummary(caidos)} (${lista}).`;
}

/* ===================================================================================
 * O QUE A TELA DIZ FORA DA LISTA: alcance, falha, recusa, efeito e prazo estendido.
 * =================================================================================== */

/**
 * O QUE A LISTA "QUEM TEM ACESSO" NÃO ALCANÇA, dito na própria lista.
 *
 * A frase anterior nomeava TRÊS origens que não aparecem ali (administradores, credenciados e
 * produtores da OM dona) e parava no meio. Faltavam as DUAS que mudam a decisão de quem
 * concede, e as duas são justamente as que a listagem não tem como enumerar:
 *
 *   1. O EMPRÉSTIMO POR ATLAS. `LIST_GRANTS_FOR_RESOURCE` lê `resource_grants` e só, enquanto
 *      `fn_granted_resource_ids` entrega o recurso a quem abre um atlas cujo DONO o enxerga
 *      (cláusula 6.1). Nenhuma dessas pessoas tem linha nesta lista.
 *   2. O VISITANTE ANÔNIMO DE LINK PÚBLICO, que herda o empréstimo (cláusula 6.3) e não tem
 *      conta para aparecer em lista nenhuma.
 *
 * A CONSEQUÊNCIA É A RAZÃO DE A FRASE EXISTIR: a tela podia dizer que três pessoas têm acesso
 * enquanto um atlas público emprestava o recurso para qualquer um com o link, e quem revogasse
 * a única linha da lista concluiria que fechou o acesso.
 *
 * SEM NÚMERO, E A AUSÊNCIA É MEDIDA, não preguiça: o servidor sabe responder
 * (`atlasesLendingResource`, `backend/src/modules/resource-access/resource-access.notify.js`),
 * mas nenhuma rota expõe essa contagem ao cliente hoje, e as quatro rotas do módulo de acesso
 * são visibilidade, listagem de concessões, concessão e revogação. Um número inventado aqui
 * seria pior que a frase qualitativa, pela mesma razão escrita no `@fileoverview` de
 * `catalog/visibility-phrases.js`.
 *
 * O VOCABULÁRIO É O DE LÁ, DE PROPÓSITO ("empresta", "quem entra pelo link público"), e este
 * módulo não importa aquele: as duas frases respondem perguntas OPOSTAS (lá, o que acontece
 * ao RETIRAR um empréstimo deste atlas; aqui, quem enxerga este recurso sem estar na lista), e
 * nenhuma das funções de lá cabe nesta tela sem mentir sobre o sujeito. É o mesmo arranjo de
 * {@link granteeGroupOwnerLabel} com `groupOwnerLabel`.
 *
 * @returns {string}
 */
export function grantsListScopeNote() {
    return 'Esta lista mostra só as concessões diretas, a pessoas e a grupos. Enxergam este '
        + 'recurso SEM aparecer aqui: administradores, credenciados e produtores da OM dona, '
        + 'que o veem por papel; e todo mundo que abrir um atlas cujo dono o enxerga, inclusive '
        + 'quem entra pelo link público. Remover uma linha daqui não fecha esses dois caminhos: '
        + 'o empréstimo se desfaz na configuração do atlas que empresta.';
}

/**
 * A FALHA DA BUSCA DE PESSOAS, escrita para NÃO se parecer com "ninguém encontrado".
 *
 * As duas eram a MESMA tela em branco: `_renderResultsInto` escrevia string vazia no ramo sem
 * resultado (o que tornava o "Nenhum usuário encontrado" de `_renderResults` inalcançável) e o
 * `catch` da busca chamava exatamente esse par. Quem lê um painel vazio depois de um erro de
 * rede conclui que a pessoa procurada não existe, que é afirmar uma coisa falsa; a distinção
 * entre "não achei" e "não perguntei" só existe se estiver no texto. Irmã de
 * `groupsLoadFailureNotice` (`js/admin/group-phrases.js`), e não a mesma função, porque aquela
 * fala dos GRUPOS de quem pergunta.
 *
 * @returns {string}
 */
export function searchFailureNotice() {
    return 'Não foi possível buscar pessoas agora. Isto é falha ao consultar o servidor, '
        + 'não ausência de resultados: tente de novo.';
}

/**
 * Os desfechos da leitura da lista que a tela desenha DIFERENTE.
 *
 * Enum, e não booleano, pela mesma razão de {@link REVOKE_AVAILABILITY}: o que muda entre os
 * ramos não é o texto, é a OFERTA. Só um deles tem "Tentar novamente" que possa resolver.
 */
export const LOAD_FAILURE = Object.freeze({
    /** 403: o servidor não autoriza esta pessoa a conceder este recurso. */
    SEM_AUTORIDADE: 'sem-autoridade',
    /** 404: o recurso não existe mais (apagado ou despublicado noutra sessão). */
    SUMIU: 'sumiu',
    /** Qualquer outra: rede, 500, timeout. É a única em que repetir pode resolver. */
    FALHA: 'falha',
});

/**
 * O QUE A TELA DIZ QUANDO A LISTAGEM NÃO VEIO, por STATUS, e se ela deve oferecer repetir.
 *
 * O `retry` É O PRODUTO PRINCIPAL, como o `null` de `visibilityChangeWarning`: um botão
 * "Tentar novamente" sobre um recurso que foi APAGADO é um convite a repetir um pedido que
 * nunca vai mudar de resposta, e o custo dele não é o clique, é a pessoa concluir que a tela
 * está quebrada em vez de entender que o recurso acabou.
 *
 * O RAMO 403 NÃO AFIRMA A CAUSA, e essa metade já estava certa no código desde 2026-08-24: o
 * servidor emite 403 por três caminhos indistinguíveis daqui (não ter papel global de dado,
 * não produzir aquele recurso, não ter `view_share`), e a sentença única "você recebeu este
 * recurso apenas para ver" era falsa em pelo menos dois deles, inclusive para o credenciado,
 * que não recebeu nada e vê por papel. É a mesma lição de `denialNotice`
 * (`js/store/denial-phrases.js`): a frase deriva da CAPACIDADE negada, nunca do papel de quem
 * lê. O que este ramo acrescenta é só a moradia: em função pura, testável, ao lado das irmãs.
 *
 * HONESTIDADE SOBRE O RAMO 404: pela rota de LISTAGEM ele é raro, e para o credenciado hoje
 * ele é inalcançável, porque `requireResourceShare` deixa passar quem tem papel global antes
 * de qualquer pergunta sobre existência, e `listGrantsForResource` devolve lista vazia para um
 * recurso que já não existe. Quem chega aqui de fato é o 404 das ESCRITAS (revogar ou estender
 * uma concessão que outra sessão já removeu, `requireGrantRevoker` -> `NotFoundError('Grant')`).
 * O ramo existe nos dois porque o mesmo vocabulário serve aos dois pontos.
 *
 * @param {*} status - O `status` do `ApiError`, ou nada quando a falha é de rede.
 * @returns {{kind: string, paragrafos: string[], retry: boolean}}
 */
export function loadFailureState(status) {
    const n = Number(status);
    if (n === 403) {
        return {
            kind: LOAD_FAILURE.SEM_AUTORIDADE,
            paragrafos: [
                'O servidor não autorizou você a conceder este recurso.',
                'Isso acontece quando o seu acesso a ele não inclui compartilhar, ou quando ele '
                + 'deixou de ser mantido por você. Se você acabou de mudar de papel ou de OM, '
                + 'recarregue a página: a tela pode estar com a informação anterior.',
            ],
            retry: false,
        };
    }
    if (n === 404) {
        return {
            kind: LOAD_FAILURE.SUMIU,
            paragrafos: [
                'Este recurso não existe mais.',
                'Ele foi apagado ou deixou de ser publicado enquanto esta tela estava aberta. '
                + 'Não há o que tentar de novo aqui: feche e volte ao catálogo.',
            ],
            retry: false,
        };
    }
    return {
        kind: LOAD_FAILURE.FALHA,
        paragrafos: ['Não foi possível carregar quem tem acesso a este recurso.'],
        retry: true,
    };
}

/**
 * O ATRASO MÁXIMO COM QUE UMA REVOGAÇÃO É HONRADA nos bytes de um modelo 3D, em ms.
 *
 * ESPELHO DE `TTL_MS` (`backend/src/modules/nomes/assets3d-acesso.js`), conferido no código em
 * 2026-08-24: o gate do asset 3D memoiza a decisão por recurso e por chamador, porque o Cesium
 * abre um pedido por tile por LOD e uma consulta por pedido cairia no mesmo pool de dez
 * conexões do sync e do `/api/config`. Se o número de lá mudar, este muda junto; um número que
 * o produto não entrega é pior que nenhum.
 * @type {number}
 */
export const REVOCATION_LAG_MS = 30_000;

/**
 * O QUE A REVOGAÇÃO AINDA NÃO TERMINOU DE FAZER quando a rota responde.
 *
 * O toast declarava o acesso removido no instante em que a resposta chegava, e para o modelo
 * 3D isso é falso por até {@link REVOCATION_LAG_MS}. Some-se a cláusula 10.3: a revogação NÃO
 * é empurrada em tempo real para quem não está numa sala de atlas que empresta o recurso, e
 * essa metade vale para TODO tipo. O texto não vira tratado: ele só para de afirmar uma
 * instantaneidade que o sistema não entrega.
 *
 * O RAMO DO 3D É POR TIPO porque o memo é do gate de ASSET (`gateDeAsset3d`), e é o único
 * caminho de leitura com decisão memoizada. Dizer "30 segundos" numa camada de dados seria
 * inventar um atraso que aquele caminho não tem.
 *
 * @param {string} [resourceType] - `tileset` | `data_layer` | `analysis_layer` | `sv360_project`.
 * @returns {string}
 */
export function revocationLagNotice(resourceType) {
    const segundos = Math.round(REVOCATION_LAG_MS / 1000);
    const memo = resourceType === 'tileset'
        ? `Os dados do modelo 3D podem continuar chegando a quem já o tinha aberto por até ${segundos} segundos. `
        : '';
    return `${memo}Quem não está num atlas que empreste este recurso só percebe a mudança no `
        + 'próximo carregamento.';
}

/**
 * O TOAST DEPOIS DA REVOGAÇÃO, com os números do SERVIDOR e sem a instantaneidade que não há.
 *
 * As DUAS listas de mantidas continuam somadas de propósito: do ponto de vista de quem acabou
 * de revogar, `reparented` (re-pendurada noutro `view_share` vivo) e `trimmed` (mantida, com o
 * prazo aparado pelo teto do pai novo) são a mesma notícia, "continua com acesso". Sem essa
 * frase, um `revoked` menor que o esperado se lê como poda incompleta.
 *
 * @param {{revoked?: Array, reparented?: Array, trimmed?: Array}} resposta - A resposta da rota.
 * @param {string} [resourceType] - Para o ramo do 3D em {@link revocationLagNotice}.
 * @returns {string}
 */
export function revocationSummary(resposta, resourceType) {
    const derrubadas = Array.isArray(resposta?.revoked) ? resposta.revoked.length : 0;
    const mantidas = (Array.isArray(resposta?.reparented) ? resposta.reparented.length : 0)
        + (Array.isArray(resposta?.trimmed) ? resposta.trimmed.length : 0);
    const caiu = derrubadas > 1
        ? `Acesso removido: ${derrubadas} concessões caíram junto.`
        : 'Acesso removido.';
    const manteve = mantidas > 0
        ? ` ${mantidas} ${mantidas === 1 ? 'concessão foi mantida' : 'concessões foram mantidas'}`
          + ' por outro caminho de acesso.'
        : '';
    return `${caiu}${manteve} ${revocationLagNotice(resourceType)}`;
}

/** Um dia em ms, para a aritmética de prazo. */
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * A escada de prazos que as DUAS telas de concessão oferecem.
 *
 * MORA AQUI, e não na tela, porque são duas telas: o modal de um recurso (onde se concede e se
 * estende) e a aba Concessões do painel (onde se revisa e se renova). Enquanto a lista era um
 * `const` privado do modal, a aba só tinha duas saídas, e as duas ruins: copiar os cinco pares,
 * que diverge na primeira revisão e faz a mesma palavra significar prazos diferentes em duas
 * telas do mesmo produto, ou importar o modal inteiro para ler uma lista de cinco itens.
 *
 * UM ANO É O TETO DO SERVIDOR, e por isso é o último degrau e o padrão: `LEAST` apara qualquer
 * pedido maior, então oferecer "2 anos" seria desenhar uma opção que o servidor recusa em
 * silêncio. E ele é o PADRÃO para não mudar o comportamento de quem não escolhe nada.
 *
 * @type {ReadonlyArray<{dias: number, label: string}>}
 */
export const GRANT_TERMS = Object.freeze([
    Object.freeze({ dias: 7, label: '7 dias' }),
    Object.freeze({ dias: 30, label: '30 dias' }),
    Object.freeze({ dias: 90, label: '90 dias' }),
    Object.freeze({ dias: 180, label: '180 dias' }),
    Object.freeze({ dias: 365, label: '1 ano (padrão)' }),
]);

/** O padrão do servidor, e por isso o degrau pré-selecionado nas duas telas. */
export const GRANT_TERM_DEFAULT_DAYS = 365;

/**
 * O instante ISO que a tela PEDE ao estender um prazo, ou `null` para entrada inutilizável.
 *
 * SEMPRE DEVOLVE DATA, ao contrário de `vencimentoEmDias` (`catalog/resource-share.modal.js`),
 * que devolve nulo no prazo padrão para deixar o servidor definir "um ano". A diferença é do
 * contrato: `POST /grants` aceita `expiresAt` ausente, e o `PATCH` de estender é uma rota cujo
 * corpo INTEIRO é `{ expiresAt }`, então omitir seria não pedir nada.
 *
 * MEIO-DIA UTC pela mesma razão do irmão: um prazo cravado no instante do clique vence "um dia
 * antes" na leitura de quem só olha a data. Para todo prazo oferecido (7 dias em diante) o
 * resultado continua no futuro, que é o que o `Joi.date().iso().greater('now')` do servidor
 * exige.
 *
 * @param {*} dias - Quantos dias a partir de agora.
 * @param {*} [agora] - Epoch ms, injetável para teste.
 * @returns {string|null}
 */
export function extensionDeadline(dias, agora = Date.now()) {
    const n = Number(dias);
    const base = Number(agora);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (!Number.isFinite(base)) return null;
    const d = new Date(base + n * DIA_MS);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCHours(12, 0, 0, 0);
    return d.toISOString();
}

/**
 * O DIA de uma data ISO, como inteiro, ou `null` quando não há data utilizável.
 *
 * A comparação de prazo é por DIA e não por instante, e isso é decisão: a tela mostra
 * `dd/mm/aaaa`, então "veio menos do que pedi" só é uma afirmação verdadeira para quem lê se a
 * DATA visível for anterior. Comparar instantes acusaria aparo em dois casos normais: o teto
 * de um ano do servidor (`NOW() + 1 ano`) fica algumas horas antes dos 365 dias ancorados ao
 * meio-dia UTC, e o relógio do cliente não é o do servidor.
 */
function diaDe(iso) {
    if (iso == null || iso === '') return null;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? null : Math.floor(t / DIA_MS);
}

/**
 * Os desfechos de um pedido de extensão, do ponto de vista de quem clicou.
 */
export const EXTENSION_OUTCOME = Object.freeze({
    /** O prazo novo é o pedido (ou a diferença não aparece na data mostrada). */
    ESTENDIDO: 'estendido',
    /** O servidor aparou pelo teto de quem concedeu: veio MENOS do que se pediu. */
    APARADO: 'aparado',
    /** O teto já era a data atual: o clique não mudou nada. */
    INALTERADO: 'inalterado',
    /** A resposta não trouxe data utilizável. */
    INDETERMINADO: 'indeterminado',
});

/**
 * O QUE DE FATO ACONTECEU AO ESTENDER, comparando o pedido, o efetivo e o prazo anterior.
 *
 * O `expiresAt` DA RESPOSTA É O EFETIVO, pós-clamp, e pode ser MENOR que o pedido: uma
 * concessão não pode sobreviver à de quem a originou, então o servidor corta pelo teto do pai
 * (`LEAST(...)`). Um botão que pede 180 dias, recebe 20 e mostra 180 é pior que não ter botão,
 * e é por isso que este desfecho existe como valor e não como booleano: a tela precisa dizer
 * uma frase diferente, não esconder uma.
 *
 * A ORDEM DOS RAMOS É A REGRA. "Não mudou nada" vence "veio menos": quando o teto do pai já é
 * a data que a linha tinha, dizer "estendido, porém menos" afirmaria uma mudança que não
 * houve. Sem `anterior` (o payload não trouxe `expires_at`) o ramo simplesmente não se aplica,
 * em vez de virar uma comparação com zero.
 *
 * @param {{pedido?: *, efetivo?: *, anterior?: *}} [params] - Datas ISO.
 * @returns {string} Um valor de {@link EXTENSION_OUTCOME}.
 */
export function extensionOutcome({ pedido, efetivo, anterior } = {}) {
    const dEfetivo = diaDe(efetivo);
    if (dEfetivo === null) return EXTENSION_OUTCOME.INDETERMINADO;
    const dAnterior = diaDe(anterior);
    if (dAnterior !== null && dEfetivo <= dAnterior) return EXTENSION_OUTCOME.INALTERADO;
    const dPedido = diaDe(pedido);
    if (dPedido !== null && dEfetivo < dPedido) return EXTENSION_OUTCOME.APARADO;
    return EXTENSION_OUTCOME.ESTENDIDO;
}

/**
 * O TOAST DEPOIS DE ESTENDER, e ele nomeia o EFETIVO em todos os ramos.
 *
 * A data chega já formatada, como em `memberAdmissionTitle` (`js/admin/group-phrases.js`): a
 * formatação é da tela (locale) e esta função é de vocabulário. Data ausente cai no ramo
 * indeterminado mesmo que o desfecho diga outra coisa, porque uma frase que promete "até" e
 * não completa a data é pior que a genérica.
 *
 * @param {string} outcome - Um valor de {@link EXTENSION_OUTCOME}.
 * @param {string} [quando] - A data efetiva, já em pt-BR.
 * @returns {string}
 */
export function extensionSummary(outcome, quando) {
    const data = String(quando ?? '').trim();
    if (!data || outcome === EXTENSION_OUTCOME.INDETERMINADO) {
        return 'Prazo atualizado. O servidor não informou a nova data de vencimento.';
    }
    if (outcome === EXTENSION_OUTCOME.INALTERADO) {
        return `O prazo não mudou: continua até ${data}, que já é o teto de quem concedeu `
            + 'este acesso.';
    }
    if (outcome === EXTENSION_OUTCOME.APARADO) {
        return `Prazo estendido até ${data}, menos do que foi pedido: uma concessão não vale `
            + 'depois da de quem a originou, e o servidor aparou por esse teto.';
    }
    return `Prazo estendido até ${data}.`;
}

/**
 * A DICA DO BOTÃO DE ESTENDER, que é onde o acoplamento com o seletor de prazo fica dito.
 *
 * O botão não abre diálogo: estender é ADITIVO (ninguém perde nada), e confirmar ato aditivo é
 * como se treina o operador a clicar em "Confirmar" sem ler, que é a assimetria escrita no
 * `@fileoverview` de `catalog/visibility-phrases.js`. O preço de não perguntar é que o prazo
 * usado precisa estar visível ANTES do clique, e ele é o do seletor "Prazo" da seção de baixo.
 *
 * SEM NÚMERO NESTA FRASE, de propósito: ela é assada no HTML da linha, e o seletor muda sem
 * redesenhar a lista. Um "estender por 30 dias" congelado no `title` mentiria no instante em
 * que a pessoa trocasse o prazo.
 * @returns {string}
 */
export function extendGrantHint() {
    return 'Estender o prazo desta concessão, contado a partir de hoje, pelo prazo escolhido '
        + 'em "Conceder acesso". O servidor apara pelo teto de quem concedeu.';
}
