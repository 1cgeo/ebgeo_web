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
