// Path: js/admin/grant-phrases.js

/**
 * @fileoverview O que a aba "Concessões" DIZ sobre uma concessão de recurso privado, em funções
 * puras, testáveis em node. ZERO IMPORTS, como os irmãos (`group-phrases.js`,
 * `catalog-delete-phrases.js`): `admin.html` boota sem a store, e um import daqui a arrastaria de
 * volta pelo caminho transitivo.
 *
 * POR QUE A ABA EXISTE, e portanto por que estas frases existem. Até agora a ÚNICA superfície de
 * concessão era o modal de UM recurso (`catalog/resource-share.modal.js`), alcançável a partir do
 * cartão daquele recurso no catálogo. Para revogar alguma coisa era preciso LEMBRAR qual recurso
 * havia sido concedido, achá-lo, abrir o modal e procurar a linha. Quem concede acesso ao acervo
 * privado é definido por conceder, e o produto não tinha a tela do meio: sem ela some a revisão
 * periódica (a higiene natural de quem distribui acesso com prazo) e some a resposta a "por que
 * Fulano vê isto?" pelo lado de quem concedeu.
 *
 * O VENCIMENTO É O PONTO DO LADO DE QUEM RECEBEU, e não decoração de coluna. A morte de uma
 * concessão mora no PREDICADO do servidor: no dia seguinte o recurso simplesmente não vem mais,
 * sem evento, sem aviso e sem nada para o usuário ler. O `fileoverview` de `expiryLabel`
 * (`catalog/resource-share.modal.js`) já dizia que mostrar o prazo "é a única coisa que separa
 * isso de o recurso sumiu do meu catálogo" — e dizia isso dentro de um modal que só quem CONCEDE
 * alcança. Quem recebeu com nível `view` nunca viu aquele chip. Esta é a primeira superfície do
 * produto que fala com quem recebeu, e é por isso que o estado do prazo aqui é um VALOR
 * (`EXPIRY_STATE`) e não uma string: a linha vencida e a que vence em três dias pedem tratamentos
 * diferentes na tela, e um rótulo só não deixaria a tela distingui-los.
 *
 * O VOCABULÁRIO DO GRUPO É O QUE O PRODUTO JÁ USA, e não um segundo. `viaGroup` é a única
 * transferência de autoridade do sistema que NÃO gera linha própria em `resource_grants`: quem
 * está num grupo que recebeu o recurso enxerga por membresia, e perde o acesso ao sair do grupo.
 * `granteeGroupOwnerLabel` (`catalog/grant-tree.js`) nomeia o outro lado desse mesmo mecanismo (de
 * quem é o grupo que recebeu), e as frases daqui espelham aquele vocabulário na PALAVRA "grupo" e
 * no fato anunciado, sem importá-lo: aquele arquivo é do mapa e este é da página de administração,
 * como já acontece entre `groupOwnerLabel` e `granteeGroupOwnerLabel`.
 *
 * O DESCONHECIDO É TRATADO EM VOZ ALTA, nos dois vocabulários fechados daqui (tipo de recurso e
 * nível). O padrão é o de `ui/role-labels.js`: um valor que o servidor invente depois deste build
 * vira o próprio texto cru, nunca o rótulo de outro valor. Cair no primeiro item conhecido é a
 * despromoção silenciosa, e num eixo de ACESSO ela mente sobre o que a pessoa pode fazer.
 */

/**
 * Os tipos de recurso privado que o acervo tem, em pt-BR.
 *
 * As chaves são as do servidor (`resource_grants.resource_type`), as mesmas que
 * `apiClient.setResourceVisibility` e o modal de compartilhamento usam.
 * @type {Readonly<Object<string, string>>}
 */
export const RESOURCE_TYPE_LABELS = Object.freeze({
    tileset: 'Modelo 3D',
    data_layer: 'Camada de dados',
    analysis_layer: 'Camada de análise',
    sv360_project: 'Projeto 360',
});

/**
 * Whether `type` is one of the resource types this build knows.
 * @param {*} type
 * @returns {boolean}
 */
export function isKnownResourceType(type) {
    return typeof type === 'string' && Object.hasOwn(RESOURCE_TYPE_LABELS, type);
}

/**
 * O rótulo de um tipo de recurso. Um tipo novo vira o próprio valor cru, e não o rótulo de outro
 * tipo: numa lista de acesso, chamar um "Projeto 360" de "Camada de dados" é dizer à pessoa que
 * ela concedeu outra coisa.
 * @param {*} type
 * @returns {string}
 */
export function resourceTypeLabel(type) {
    if (isKnownResourceType(type)) return RESOURCE_TYPE_LABELS[type];
    if (typeof type === 'string' && type.trim()) return type.trim();
    return 'Recurso';
}

/**
 * O nome que a linha mostra para o recurso.
 *
 * O ID É O ÚLTIMO RECURSO, e não um travessão: sem nome, o id (slug ou uuid) ainda permite achar
 * o recurso no catálogo, e um travessão deixaria a linha inacionável. Ele fica no `title`, sempre,
 * porque dois recursos podem ter o mesmo nome de exibição e só o id os separa.
 * @param {{resourceName?: string, resourceId?: string}} grant
 * @returns {string}
 */
export function resourceDisplayName(grant) {
    const nome = (grant?.resourceName || '').trim();
    if (nome) return nome;
    const id = (grant?.resourceId || '').trim();
    return id || 'Recurso sem nome';
}

/**
 * A frase do `title` do recurso: o tipo e o id, que é o que identifica sem ambiguidade.
 * @param {{resourceType?: string, resourceId?: string}} grant
 * @returns {string}
 */
export function resourceIdentityTitle(grant) {
    const tipo = resourceTypeLabel(grant?.resourceType);
    const id = (grant?.resourceId || '').trim();
    return id ? `${tipo} · ${id}` : tipo;
}

/**
 * Os níveis de concessão, espelhados de `GRANT_LEVELS` (`catalog/catalog.constants.js`).
 *
 * ESPELHO E NÃO IMPORT, pela mesma razão do vocabulário de grupo: aquele arquivo importa
 * `forma-3d.js` e é do mapa. São dois valores e eles são contrato do servidor; o teto do espelho
 * é asserido em `tests/unit/concessoes-frases.test.js`, que lê os dois arquivos.
 * @type {Readonly<Object<string, string>>}
 */
export const GRANT_LEVEL_LABELS = Object.freeze({
    view: 'Ver',
    view_share: 'Ver e compartilhar',
});

/**
 * Whether `level` is one of the grant levels this build knows.
 * @param {*} level
 * @returns {boolean}
 */
export function isKnownGrantLevel(level) {
    return typeof level === 'string' && Object.hasOwn(GRANT_LEVEL_LABELS, level);
}

/**
 * O rótulo de um nível. Nível desconhecido vira o valor cru: cair em "Ver" diria à pessoa que ela
 * NÃO pode repassar quando talvez possa, e cair em "Ver e compartilhar" diria o contrário.
 * @param {*} level
 * @returns {string}
 */
export function grantLevelLabel(level) {
    if (isKnownGrantLevel(level)) return GRANT_LEVEL_LABELS[level];
    if (typeof level === 'string' && level.trim()) return level.trim();
    return '';
}

/**
 * A frase que explica o nível, para o `title` do chip. O `view_share` é o que carrega
 * consequência: quem o tem cria concessões novas penduradas na sua.
 * @param {*} level
 * @returns {string}
 */
export function grantLevelDescription(level) {
    if (level === 'view') return 'Pode ver o recurso, e não pode repassá-lo a mais ninguém.';
    if (level === 'view_share') {
        return 'Pode ver o recurso E repassá-lo. O que for repassado pende desta concessão, '
            + 'e cai junto se ela cair.';
    }
    const cru = grantLevelLabel(level);
    if (!cru) return '';
    return `Nível "${cru}" definido pelo servidor. Esta versão do aplicativo não sabe descrevê-lo.`;
}

/** Quantos dias de antecedência ainda contam como "vence logo". */
export const EXPIRY_SOON_DAYS = 7;

/**
 * OS ESTADOS DE UM PRAZO, como valor e não como booleano.
 *
 * "Vencida" e "vence em três dias" pedem tratamentos diferentes na tela (a primeira já não entrega
 * nada, a segunda é a única que ainda dá tempo de renovar), e um booleano "está perto de vencer"
 * colapsaria as duas. O quinto estado, SEM_PRAZO, não deveria existir (toda concessão vence, no
 * máximo em um ano) e é justamente por isso que ele é dito por extenso em vez de virar branco: se
 * o servidor mandar `expiresAt` nulo, a tela precisa dizer que não sabe, e não fingir que é eterno.
 * @enum {string}
 */
export const EXPIRY_STATE = Object.freeze({
    /** O servidor não mandou prazo utilizável. */
    SEM_PRAZO: 'sem-prazo',
    /** A data já passou: o predicado do servidor já não honra esta linha. */
    VENCIDA: 'vencida',
    /** Vence hoje. */
    HOJE: 'hoje',
    /** Vence dentro de {@link EXPIRY_SOON_DAYS} dias. */
    PROXIMA: 'proxima',
    /** Vence, e ainda falta bastante. */
    DISTANTE: 'distante',
});

/**
 * Uma data utilizável, ou null.
 * @param {*} value
 * @returns {Date|null}
 */
function toDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** @param {number} n @returns {string} */
function pad2(n) {
    return String(n).padStart(2, '0');
}

/**
 * Uma data em pt-BR (dd/mm/aaaa), ou string vazia quando não há data utilizável.
 *
 * FORMATADA À MÃO, e não por `toLocaleDateString`: esta função é testada em node, e o resultado de
 * um `toLocale*` depende do ICU do runtime. O formato é o mesmo que
 * `catalog/resource-share.modal.js` produz com `{day:'2-digit', month:'2-digit', year:'numeric'}`.
 * @param {*} value
 * @returns {string}
 */
export function shortDate(value) {
    const d = toDate(value);
    if (!d) return '';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * QUANTOS DIAS DE CALENDÁRIO faltam até o vencimento, ou null quando não há prazo.
 *
 * A CONTA É POR DIA DE CALENDÁRIO, e não pela diferença de instantes, e isso não é detalhe: uma
 * concessão que vence amanhã às 09:00, olhada hoje às 23:00, dista 0,4 dia — e "faltam 0 dias" é
 * falso para quem lê um calendário. As duas datas são niveladas à meia-noite LOCAL, que é o dia
 * que a pessoa vê na tela.
 *
 * @param {*} expiresAt - `expires_at` do servidor.
 * @param {*} [now] - O instante de referência; o padrão é agora.
 * @returns {number|null} Negativo para prazo já vencido.
 */
export function daysUntilExpiry(expiresAt, now = Date.now()) {
    const alvo = toDate(expiresAt);
    const base = toDate(now);
    if (!alvo || !base) return null;
    const diaAlvo = new Date(alvo.getFullYear(), alvo.getMonth(), alvo.getDate()).getTime();
    const diaBase = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
    return Math.round((diaAlvo - diaBase) / 86400000);
}

/**
 * O estado do prazo desta concessão.
 * @param {*} expiresAt
 * @param {*} [now]
 * @returns {string} um valor de {@link EXPIRY_STATE}
 */
export function expiryState(expiresAt, now = Date.now()) {
    const dias = daysUntilExpiry(expiresAt, now);
    if (dias === null) return EXPIRY_STATE.SEM_PRAZO;
    if (dias < 0) return EXPIRY_STATE.VENCIDA;
    if (dias === 0) return EXPIRY_STATE.HOJE;
    return dias <= EXPIRY_SOON_DAYS ? EXPIRY_STATE.PROXIMA : EXPIRY_STATE.DISTANTE;
}

/**
 * O CHIP DE PRAZO INTEIRO: o estado (para a classe), o texto e a frase que o explica.
 *
 * Devolve os três juntos porque a tela precisa dos três e calculá-los em chamadas separadas abriria
 * a porta para um chip cuja cor discorda do próprio texto.
 *
 * `perspective` muda a FRASE e nunca o estado: para quem concedeu, o vencimento é o fim de um
 * empréstimo que ele pode renovar concedendo de novo; para quem recebeu, é o dia em que o recurso
 * some do catálogo sem aviso, que é o fato que esta aba existe para contar.
 *
 * @param {*} expiresAt
 * @param {{now?: *, perspective?: 'issued'|'received'}} [options]
 * @returns {{state: string, label: string, title: string, days: number|null}}
 */
export function expiryChip(expiresAt, { now = Date.now(), perspective = 'received' } = {}) {
    const state = expiryState(expiresAt, now);
    const dias = daysUntilExpiry(expiresAt, now);
    const data = shortDate(expiresAt);
    const recebido = perspective !== 'issued';

    if (state === EXPIRY_STATE.SEM_PRAZO) {
        return {
            state,
            days: null,
            label: 'Sem prazo registrado',
            title: 'O servidor não informou a data de vencimento desta concessão. Toda concessão '
                + 'vence (no máximo em um ano), então a ausência aqui é falta de informação, e não '
                + 'acesso permanente.',
        };
    }
    if (state === EXPIRY_STATE.VENCIDA) {
        return {
            state,
            days: dias,
            label: `Venceu em ${data}`,
            title: recebido
                ? 'Este acesso já não vale. O recurso deixou de aparecer no seu catálogo no dia '
                  + 'seguinte, sem aviso: peça de novo a quem concedeu.'
                : 'Esta concessão já não entrega acesso nenhum. Para reativá-la, conceda o recurso '
                  + 'de novo.',
        };
    }
    if (state === EXPIRY_STATE.HOJE) {
        return {
            state,
            days: 0,
            label: `Vence hoje (${data})`,
            title: recebido
                ? 'A partir de amanhã este recurso some do seu catálogo, sem aviso nenhum.'
                : 'A partir de amanhã esta pessoa deixa de ver o recurso, sem aviso nenhum.',
        };
    }
    const falta = dias === 1 ? 'falta 1 dia' : `faltam ${dias} dias`;
    if (state === EXPIRY_STATE.PROXIMA) {
        return {
            state,
            days: dias,
            label: `Vence em ${data} (${falta})`,
            title: recebido
                ? 'Depois desta data o recurso some do seu catálogo, sem aviso: é agora que dá '
                  + 'tempo de pedir a renovação.'
                : 'Depois desta data o acesso deixa de valer sozinho. Conceda de novo para renovar.',
        };
    }
    return {
        state,
        days: dias,
        label: `Vence em ${data}`,
        title: recebido
            ? 'Depois desta data o acesso deixa de valer sozinho, sem aviso.'
            : 'Depois desta data o acesso deixa de valer sozinho, sem aviso para quem recebeu.',
    };
}

/**
 * A NOTA DE CABEÇALHO DA LISTA DE RECEBIDOS, que é o motivo de esta aba falar com quem recebeu.
 * @returns {string}
 */
export function receivedExpiryNotice() {
    return 'Todo acesso concedido tem prazo, e ele acaba em silêncio: no dia seguinte o recurso '
        + 'simplesmente não aparece mais no seu catálogo, sem aviso e sem erro. Esta coluna é o '
        + 'único lugar em que esse prazo é visível antes da hora.';
}

/**
 * DE QUEM É O ACESSO QUE ESTA LINHA DÁ, do lado de quem concedeu.
 *
 * Pessoa e GRUPO são beneficiários de naturezas diferentes, e a linha precisa dizer qual: conceder
 * a um grupo entrega ao DONO daquele grupo o poder de acrescentar beneficiários sem passar por
 * quem concedeu. É o mesmo fato que `granteeGroupOwnerLabel` (`catalog/grant-tree.js`) anuncia do
 * lado do recurso.
 * @param {{granteeKind?: string, granteeName?: string}} grant
 * @returns {string}
 */
export function granteeLabel(grant) {
    const nome = (grant?.granteeName || '').trim();
    if (grant?.granteeKind === 'group') return nome || 'Grupo';
    return nome || 'Usuário';
}

/**
 * Se esta concessão foi a um coletivo.
 * @param {{granteeKind?: string}} grant
 * @returns {boolean}
 */
export function isGroupGrant(grant) {
    return grant?.granteeKind === 'group';
}

/**
 * A frase que acompanha o beneficiário COLETIVO, e string vazia para pessoa.
 *
 * O contraste é o que faz a frase informar: se toda linha trouxesse um rótulo, o coletivo deixaria
 * de saltar.
 * @param {{granteeKind?: string, granteeName?: string}} grant
 * @returns {string}
 */
export function granteeGroupNotice(grant) {
    if (!isGroupGrant(grant)) return '';
    const nome = (grant?.granteeName || '').trim();
    const alvo = nome ? `"${nome}"` : 'este grupo';
    return `Quem estiver no grupo ${alvo} vê o recurso. Quem administra o grupo pode pôr mais `
        + 'gente lá dentro sem passar por você, e o acesso vai junto.';
}

/**
 * QUEM ME DEU ESTE ACESSO, do lado de quem recebeu.
 * @param {{grantorName?: string}} grant
 * @returns {string}
 */
export function grantorLabel(grant) {
    const nome = (grant?.grantorName || '').trim();
    // Concessão sem concedente é a da administração (`granted_by` nulo no servidor), e dizê-lo por
    // extenso é melhor que um travessão: quem lê "pelo sistema" sabe a quem NÃO pedir renovação.
    return nome || 'Concedido pelo sistema';
}

/**
 * O CAMINHO DE GRUPO, que é a transferência de autoridade sem linha própria.
 *
 * `viaGroup` diz que a pessoa vê o recurso por ser MEMBRO de um grupo que o recebeu, e não por uma
 * concessão feita a ela. A consequência que ela não adivinha é a de saída: sair do grupo derruba o
 * acesso, e não há linha em `resource_grants` para revogar nem para renovar. É o mesmo mecanismo
 * que `granteeGroupOwnerLabel` (`catalog/grant-tree.js`) torna visível do outro lado.
 *
 * @param {{id?: string, name?: string}|null|undefined} viaGroup
 * @returns {string} String vazia quando o acesso é direto.
 */
export function viaGroupLabel(viaGroup) {
    if (!viaGroup) return '';
    const nome = (viaGroup?.name || '').trim();
    return nome ? `Pelo grupo "${nome}"` : 'Por um grupo';
}

/**
 * A frase que explica o caminho de grupo, para o `title` do rótulo acima.
 * @param {{id?: string, name?: string}|null|undefined} viaGroup
 * @returns {string}
 */
export function viaGroupNotice(viaGroup) {
    if (!viaGroup) return '';
    const nome = (viaGroup?.name || '').trim();
    const alvo = nome ? `"${nome}"` : 'esse grupo';
    return `Você vê este recurso por ser membro do grupo ${alvo}, e não por uma concessão feita a `
        + 'você. Se sair do grupo, ou se alguém tirar você dele, o acesso cai junto.';
}

/**
 * O ESTADO VAZIO DE CADA LADO, e eles dizem coisas diferentes.
 * @returns {string}
 */
export function issuedEmptyNotice() {
    return 'Você não concedeu acesso a nenhum recurso privado.';
}

/** @returns {string} */
export function issuedEmptyHint() {
    return 'Conceder se faz no cartão do recurso, no catálogo. O que for concedido aparece aqui, '
        + 'com o prazo e com o botão de revogar.';
}

/** @returns {string} */
export function receivedEmptyNotice() {
    return 'Ninguém concedeu a você acesso a um recurso privado.';
}

/** @returns {string} */
export function receivedEmptyHint() {
    return 'Isto conta só os acessos concedidos a você (ou a um grupo seu). O que você enxerga '
        + 'pelo seu papel, ou por ser público, não é concessão e não entra nesta lista.';
}

/**
 * A FALHA DE LEITURA, escrita para NÃO se parecer com lista vazia — a mesma distinção de
 * `groupsLoadFailureNotice` (`group-phrases.js`), e pela mesma razão: quem lê a frase de vazio
 * depois de um erro conclui que não tem acesso nenhum, o que é afirmar uma coisa falsa.
 * @returns {string}
 */
export function issuedFailureNotice() {
    return 'Não foi possível carregar o que você concedeu. Isto é falha ao consultar o servidor, '
        + 'não ausência de concessões.';
}

/** @returns {string} */
export function receivedFailureNotice() {
    return 'Não foi possível carregar o que concederam a você. Isto é falha ao consultar o '
        + 'servidor, não ausência de acessos.';
}

/**
 * O AVISO ANTES DE REVOGAR, daqui, e ele é QUALITATIVO por medição, não por preguiça.
 *
 * O irmão `revocationWarning` (`catalog/grant-tree.js`) cita quantas concessões caem junto porque
 * ele recebe a ÁRVORE inteira daquele recurso, que o modal acabou de ler. Esta lista é de recursos
 * DIFERENTES e não carrega árvore nenhuma: inventar um número aqui seria fabricar aritmética, que
 * é o defeito que `group-phrases.js` já evita no caso simétrico (`leaveGroupWarning`). O número
 * existe depois do ato, e é o do servidor, que {@link issuedRevocationSummary} relata.
 *
 * @param {{resourceName?: string, resourceId?: string, granteeKind?: string, granteeName?: string}} grant
 * @returns {string}
 */
export function issuedRevocationWarning(grant) {
    const recurso = resourceDisplayName(grant);
    const quem = granteeLabel(grant);
    const alvo = isGroupGrant(grant)
        ? `do grupo "${quem}", e de todas as pessoas que estão dentro dele,`
        : `de ${quem}`;
    return `Isto tira o acesso ${alvo} a "${recurso}", e derruba também o que tiver sido repassado `
        + 'a partir desta concessão. Esta tela não sabe quantos acessos caem: o número só aparece '
        + 'depois do ato. Quem alcançar o recurso por outro caminho continua alcançando.';
}

/**
 * O TOAST DEPOIS DE REVOGAR, com os números do SERVIDOR.
 *
 * As três listas da resposta viram DUAS frases, e a divisão é a de
 * `catalog/resource-share.modal.js`: `revoked` é quem perdeu o acesso, e `reparented` mais
 * `trimmed` são quem CONTINUA com ele por outro caminho — do ponto de vista de quem acabou de
 * revogar, os dois últimos são a mesma notícia. Sem a segunda frase, um número menor que o
 * esperado se lê como poda incompleta.
 *
 * Zero não vira frase, pela mesma regra de `memberRemovalSummary`: "0 concessões mantidas"
 * transforma o caso comum num susto.
 *
 * @param {{revoked?: Array, reparented?: Array, trimmed?: Array}} result
 * @returns {string}
 */
export function issuedRevocationSummary(result) {
    const tamanho = (v) => (Array.isArray(v) ? v.length : 0);
    const caidas = tamanho(result?.revoked);
    const mantidas = tamanho(result?.reparented) + tamanho(result?.trimmed);
    let frase = caidas > 1
        ? `Acesso removido. ${caidas} concessões caíram junto.`
        : 'Acesso removido.';
    if (mantidas > 0) {
        frase += mantidas === 1
            ? ' 1 concessão foi mantida por outro caminho de acesso.'
            : ` ${mantidas} concessões foram mantidas por outro caminho de acesso.`;
    }
    return frase;
}

/**
 * POR QUE UMA LINHA RECEBIDA NÃO TEM BOTÃO DE REVOGAR.
 *
 * Espaço vazio se lê como tela quebrada (é a mesma lição de `groupOwnerCannotLeaveNotice`), e a
 * pergunta que a pessoa faz olhando esta lista é justamente "posso me livrar disto?". A resposta
 * honesta é que o ato pertence a quem concedeu.
 * @returns {string}
 */
export function receivedNotRevocableNotice() {
    return 'Só quem concedeu (ou o administrador do sistema) remove este acesso. Se você não quer '
        + 'mais vê-lo, peça a quem concedeu.';
}

/**
 * O QUE ESTA ABA NÃO MOSTRA, dito em voz alta.
 *
 * Sem esta linha a lista se lê como "todo o meu acesso", e ela não é: acesso por papel global, por
 * recurso público e por empréstimo do atlas não são concessões e não têm linha em
 * `resource_grants`. Quem conclui o contrário acha que perdeu acesso que nunca esteve aqui.
 * @returns {string}
 */
export function grantsScopeNotice() {
    return 'Esta aba mostra CONCESSÕES de recurso privado do acervo, uma a uma. Acesso que vem do '
        + 'seu papel, de um recurso público ou de um atlas compartilhado não é concessão e não '
        + 'aparece aqui.';
}

/**
 * O QUE A ABA NÃO LISTA PARA QUEM ADMINISTRA O SISTEMA, e é a única frase daqui que depende de
 * papel global.
 *
 * A ABA INTEIRA REPOUSA NUMA PROPRIEDADE DA CONSULTA: `grants/issued` filtra por `granted_by =
 * <quem pergunta>`, sem ramo de papel, e o gate de revogação (`requireGrantRevoker`, no servidor)
 * tem um ramo estreito que pergunta por AUTORIA. Para o credenciado e para o produtor os dois
 * conjuntos coincidem, e por isso "o que eu concedi" é também "o que o servidor me deixa revogar".
 *
 * PARA O ADMINISTRADOR ELES NÃO COINCIDEM, e a diferença é só em UMA direção: o ramo LARGO daquele
 * gate é administração do sistema, então ele revoga também o que não originou. Nenhuma linha da
 * lista fica desonesta por isso (toda linha de `issued` é dele, e ele pode revogá-la pelos dois
 * ramos), mas a lista SUBDECLARA o alcance dele, e uma tela que subdeclara autoridade ensina a
 * pessoa a concluir que a autoridade não existe. Daí a frase, e daí ela nomear a saída real: o
 * cartão do recurso, no catálogo, que é a outra superfície de concessão do produto.
 *
 * @param {{isAdmin?: boolean}} [principal]
 * @returns {string} String vazia para quem não administra o sistema.
 */
export function issuedReachNotice({ isAdmin = false } = {}) {
    if (!isAdmin) return '';
    return 'Você administra o sistema, e por isso pode revogar também concessões que outras '
        + 'pessoas fizeram. Esta aba lista SÓ as suas: as demais se alcançam pelo cartão do '
        + 'recurso, no catálogo, inclusive as que aparecem em Recebidos por mim.';
}

/**
 * A dica do botão de renovar, NESTA aba.
 *
 * IRMÃ, E NÃO A MESMA, de `extendGrantHint` (`catalog/grant-tree.js`): aquela manda ler o prazo
 * no seletor da seção "Conceder acesso", que é uma seção do modal de recurso e não existe aqui.
 * Duas telas com o mesmo botão e seletores em lugares diferentes precisam de duas dicas, senão
 * uma delas aponta para um controle que a pessoa não acha.
 *
 * DIZ QUE O SERVIDOR APARA, e essa metade é a que precisa sobreviver a qualquer reescrita: o
 * prazo pedido é um pedido. O `LEAST` do servidor corta pelo teto de quem concedeu E pelo teto de
 * um ano contado do NASCIMENTO da concessão, então uma linha velha estica pouco por construção.
 * Prometer o prazo escolhido seria prometer o que só o servidor decide.
 * @returns {string}
 */
export function issuedExtensionHint() {
    return 'Estender o prazo desta concessão pelo tempo escolhido acima, contado a partir de '
        + 'hoje. O servidor apara pelo teto de quem concedeu e pelo limite de um ano desde que '
        + 'a concessão nasceu, então o prazo efetivo pode vir menor.';
}

/**
 * O rótulo do seletor de prazo da seção "Concedidos por mim".
 * @returns {string}
 */
export function issuedExtensionTermLabel() {
    return 'Renovar por';
}
