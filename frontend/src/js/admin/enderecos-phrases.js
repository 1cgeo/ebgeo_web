// Path: js/admin/enderecos-phrases.js

/**
 * @fileoverview As palavras da seção "Endereços de acesso" da aba Diagnóstico: os endereços IP
 * distintos que falaram com o servidor na janela, com as contas vistas em cada um (pedido do dono,
 * 2026-09-22).
 *
 * O DADO É O `ip` QUE O SERVIDOR JÁ CARIMBAVA em toda linha de requisição do log em arquivo, lido
 * por `GET /api/v1/diag/enderecos` (a porta HTTP de `npm run diag -- enderecos`). A tela não
 * guarda nada e não calcula nada: ela desenha o documento que o servidor compôs, e as frases daqui
 * são as ressalvas que o impedem de ser lido ao contrário.
 *
 * AS TRÊS LEITURAS ERRADAS QUE ESTAS FRASES EXISTEM PARA DESFAZER:
 *
 *   - "um endereço é uma pessoa": ele é o que o servidor viu depois do proxy reverso, e numa rede
 *     com NAT pode ser uma organização inteira;
 *   - "agora é presença": é TRÁFEGO recente, uma requisição nos últimos minutos, e não o painel de
 *     presença, que é outra pergunta e outro código;
 *   - "a primeira vez visto é a primeira de sempre": é a primeira DENTRO DA JANELA.
 *
 * OS NOMES DAS CONTAS SÃO A METADE DE BANCO do documento, e caem sozinhos: com o Postgres fora o
 * servidor manda `contas.disponivel: false` e um motivo, a lista de endereços continua valendo, e
 * as contas aparecem pelo identificador. O desfecho é TERNÁRIO como o dos cartões do Resumo, porque
 * "o servidor não mandou o bloco" (implantação anterior) e "mandou dizendo que não conseguiu" pedem
 * providências opostas.
 *
 * FOLHA DE ZERO IMPORTS, como `defeito-phrases.js` e `resumo-phrases.js`: testável em node e sem
 * arrastar nada para `admin.html`. A contagem e a hora NÃO são formatadas aqui: a régua delas é
 * `contagemLabel`/`horaLocalCompleta` (`diag-phrases.js`), e a função que precisa de uma recebe o
 * formatador do chamador, para não haver uma segunda régua de número na MESMA tela.
 *
 * O ENDEREÇO E O NOME SÃO DADO EXTERNO, e nada aqui monta HTML: estas funções devolvem TEXTO, e o
 * consumidor o põe por `textContent`.
 */

/** Os três desfechos do bloco de nomes das contas. */
export const DESFECHO_DAS_CONTAS = Object.freeze({
    DISPONIVEL: 'disponivel',
    SEM_FONTE: 'sem-fonte',
    AUSENTE: 'ausente',
});

/** Os tipos de rótulo da célula de contas, que viram modificador de classe na tela. */
export const TIPO_DE_ROTULO = Object.freeze({
    CONTA: 'conta',
    INATIVA: 'inativa',
    REMOVIDA: 'removida',
    SEM_NOME: 'sem-nome',
    MAIS: 'mais',
    ANONIMO: 'anonimo',
});

/** O padrão do "agora", só para a frase quando o servidor não informa (5 min). */
const AGORA_PADRAO_MS = 5 * 60_000;

/** @param {*} n @returns {boolean} */
function contagem(n) {
    return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/** O formatador de reserva, quando o chamador não passa o da casa (só os testes o fazem). */
function contarPadrao(n) {
    return String(n);
}

// ===== o documento =====

/**
 * O servidor mandou um documento que esta seção sabe ler?
 *
 * A ROTA É UMA SÓ, então payload irreconhecível é FALHA de seção (com botão), e nunca uma lista
 * vazia com cara de "ninguém usou": um servidor de versão anterior responde 404 ou um documento
 * sem estes campos, e a pior leitura possível seria a boa notícia.
 * @param {*} payload
 * @returns {boolean}
 */
export function enderecosReconhecido(payload) {
    return Boolean(payload) && typeof payload === 'object'
        && Array.isArray(payload.enderecos)
        && contagem(payload.distintos);
}

/**
 * O desfecho do bloco de nomes.
 * @param {*} contas - `payload.contas`
 * @returns {string} um valor de {@link DESFECHO_DAS_CONTAS}
 */
export function desfechoDasContas(contas) {
    if (!contas || typeof contas !== 'object') return DESFECHO_DAS_CONTAS.AUSENTE;
    if (contas.disponivel === false) return DESFECHO_DAS_CONTAS.SEM_FONTE;
    if (contas.disponivel === true && contas.porId && typeof contas.porId === 'object') {
        return DESFECHO_DAS_CONTAS.DISPONIVEL;
    }
    return DESFECHO_DAS_CONTAS.AUSENTE;
}

/**
 * Os minutos do "agora", a partir do que o servidor declarou.
 * @param {*} recenteMs
 * @returns {number}
 */
export function minutosDeAgora(recenteMs) {
    const ms = contagem(recenteMs) && recenteMs > 0 ? recenteMs : AGORA_PADRAO_MS;
    return Math.max(1, Math.round(ms / 60_000));
}

// ===== cabeçalho e ressalvas =====

/** @returns {string} */
export function enderecosTitulo() {
    return 'Endereços de acesso';
}

/**
 * @param {string} janelaFrase - "nas últimas 24 horas", de `janelaEmPalavras`
 * @returns {string}
 */
export function enderecosSubtitulo(janelaFrase) {
    return `Os endereços IP que falaram com o servidor ${janelaFrase}, do mais recente para o mais antigo`;
}

/**
 * A linha acima da tabela: o que um endereço É, quem vê isto e onde ir para além da janela.
 * @returns {string}
 */
export function enderecosEscopoNotice() {
    return 'Cada endereço é o que o servidor viu na conexão, depois do proxy reverso: numa rede com '
        + 'NAT, um endereço pode ser uma organização inteira. As contas são as que tinham sessão nas '
        + 'requisições daquele endereço, e o resto conta como anônimo, inclusive o visitante de link '
        + 'público. Só o administrador vê esta lista, que alcança sete dias; o log guarda mais, '
        + 'e o comando "npm run diag -- enderecos --desde 30d" o lê no servidor.';
}

/** @returns {string} */
export function enderecosFailureNotice() {
    return 'Não foi possível carregar os endereços de acesso.';
}

/** @returns {string} */
export function enderecosDesconhecidoNotice() {
    return 'O servidor respondeu num formato que o EBGeo não reconhece aqui; ele pode ser de uma '
        + 'versão anterior.';
}

/**
 * O vazio desta seção NÃO é boa notícia: servidor que não registrou requisição nenhuma na janela
 * reiniciou agora ou parou de escrever o log.
 * @param {string} janelaFrase
 * @returns {string}
 */
export function enderecosEmptyNotice(janelaFrase) {
    return `Nenhuma requisição com endereço registrada ${janelaFrase}.`;
}

/** @returns {string} */
export function enderecosEmptyHint() {
    return 'Um servidor em uso registra requisições o tempo todo; zero aqui é sinal para conferir se '
        + 'o log em arquivo está sendo escrito, e não sinal de que ninguém usou.';
}

/** @returns {string} */
export function usandoAgoraRotulo() {
    return 'Usando agora';
}

/**
 * O `title` do ladrilho e do selo "agora": a premissa do número.
 * @param {*} recenteMs
 * @returns {string}
 */
export function usandoAgoraTitulo(recenteMs) {
    const m = minutosDeAgora(recenteMs);
    return `Endereços com pelo menos uma requisição nos últimos ${m} minutos. É tráfego, e não `
        + 'presença: uma aba parada há mais tempo que isso não aparece aqui.';
}

/** @returns {string} */
export function agoraChipLabel() {
    return 'agora';
}

/**
 * The SINGLE-address caveat, written for the administrator and without claiming one cause.
 *
 * The usual cause is deploy, not usage: `TRUST_PROXY_HOPS` not matching the number of proxies
 * between the browser and the server (measured 2026-09-22 on the test stack: one hop short, and
 * every request was logged with the address of the outermost proxy), or a proxy in front that
 * does not pass the address on. A single real client is still possible, hence "costuma".
 *
 * The repeated address is NAMED when the document carries it, because it is what the
 * administrator compares against the proxy addresses; the "not determinable" sentinel is not an
 * address and is left out.
 * @param {*} payload
 * @returns {string}
 */
export function enderecoUnicoNotice(payload) {
    if (payload?.distintos !== 1) return '';
    const unico = Array.isArray(payload.enderecos) ? payload.enderecos[0] : null;
    const ip = unico?.indeterminado !== true && typeof unico?.ip === 'string' ? unico.ip.trim() : '';
    const qual = ip ? ` (${ip})` : '';
    return `Todos os acessos chegaram de um só endereço${qual}. Isso costuma indicar que o número de `
        + 'proxies confiados (TRUST_PROXY_HOPS) não bate com o caminho até o servidor, ou que um proxy '
        + 'à frente não repassa o endereço de quem acessa.';
}

/**
 * As requisições que ficaram fora da lista por não terem endereço (linhas anteriores ao campo).
 * @param {*} payload
 * @param {{contar?: (n: number) => string}} [opts]
 * @returns {string}
 */
export function semEnderecoNotice(payload, { contar = contarPadrao } = {}) {
    const n = payload?.semEndereco;
    if (!contagem(n) || n === 0) return '';
    return n === 1
        ? '1 requisição da janela não registrou endereço (linha anterior ao campo) e ficou fora da lista.'
        : `${contar(n)} requisições da janela não registraram endereço (linhas anteriores ao campo) e ficaram fora da lista.`;
}

/**
 * A ressalva do bloco de nomes quando ele não veio inteiro. Vazia quando os nomes estão aí.
 * @param {*} contas - `payload.contas`
 * @returns {string}
 */
export function contasNotice(contas) {
    const desfecho = desfechoDasContas(contas);
    if (desfecho === DESFECHO_DAS_CONTAS.SEM_FONTE) {
        const motivo = typeof contas?.motivo === 'string' && contas.motivo.trim()
            ? ` (${contas.motivo.trim()})`
            : '';
        return `Os nomes das contas não puderam ser lidos${motivo}. Os endereços vêm do log e `
            + 'continuam valendo; as contas aparecem pelo identificador.';
    }
    if (desfecho === DESFECHO_DAS_CONTAS.AUSENTE) {
        return 'O servidor não informou os nomes das contas, e elas aparecem pelo identificador.';
    }
    return '';
}

// ===== a tabela =====

/**
 * As colunas, com o que cada uma significa no `title` do cabeçalho.
 * @type {ReadonlyArray<{rotulo: string, titulo: string}>}
 */
export const COLUNAS_DE_ENDERECOS = Object.freeze([
    Object.freeze({ rotulo: 'Endereço', titulo: 'O endereço IP que o servidor viu na conexão.' }),
    Object.freeze({ rotulo: 'Última', titulo: 'A requisição mais recente deste endereço.' }),
    Object.freeze({
        rotulo: 'Primeira',
        titulo: 'A primeira requisição DENTRO DA JANELA, e não a primeira de sempre.',
    }),
    Object.freeze({ rotulo: 'Requisições', titulo: 'Quantas requisições este endereço fez na janela.' }),
    Object.freeze({
        rotulo: 'Abas',
        titulo: 'Abas do navegador que se identificaram. É um piso: pedidos que não carregam o '
            + 'identificador de aba não entram.',
    }),
    Object.freeze({ rotulo: 'Contas', titulo: 'As contas com sessão nas requisições deste endereço.' }),
]);

/**
 * O texto do endereço.
 * @param {*} item
 * @returns {string}
 */
export function enderecoLabel(item) {
    if (item?.indeterminado === true) return 'não determinável';
    return typeof item?.ip === 'string' && item.ip.trim() ? item.ip.trim() : '—';
}

/**
 * O `title` do endereço: o valor cru, e o que o sentinela significa.
 * @param {*} item
 * @returns {string}
 */
export function enderecoTitulo(item) {
    if (item?.indeterminado === true) {
        return 'O servidor olhou a conexão e não havia endereço (ela já tinha sido encerrada).';
    }
    return typeof item?.ip === 'string' ? item.ip : '';
}

/**
 * O `title` da contagem de requisições, com as que falharam.
 * @param {*} item
 * @param {{contar?: (n: number) => string}} [opts]
 * @returns {string}
 */
export function requisicoesTitulo(item, { contar = contarPadrao } = {}) {
    if (!contagem(item?.requisicoes)) return '';
    const total = item.requisicoes === 1 ? '1 requisição' : `${contar(item.requisicoes)} requisições`;
    if (!contagem(item?.comErro)) return total;
    return `${total}, ${contar(item.comErro)} com status de erro (400 ou mais)`;
}

/** @param {string} id @returns {string} */
function idCurto(id) {
    return `${id.slice(0, 8)}…`;
}

/**
 * Os rótulos da célula de contas de UM endereço, na ordem em que o servidor os mandou.
 *
 * CADA CONTA É UM RÓTULO, e o anônimo é UM rótulo só, com a contagem no `title`: somar o anônimo
 * como "conta" inventaria usuários, e o visitante de link público é anônimo pela mesma regra dos
 * três canais de telemetria. Conta que o banco não achou é "removida", nunca um nome inventado; e
 * com o bloco de nomes cego, a conta sai pelo identificador curto, com o inteiro no `title`.
 *
 * `Object.hasOwn` E NÃO `porId[id]`: o id vem do log, e uma chave como `__proto__` num objeto comum
 * devolveria o protótipo em vez de "não achei".
 *
 * @param {*} item - um endereço do payload
 * @param {*} contas - `payload.contas`
 * @param {{contar?: (n: number) => string, hora?: (t: *) => string}} [opts]
 * @returns {Array<{texto: string, titulo: string, tipo: string}>}
 */
export function rotulosDasContas(item, contas, { contar = contarPadrao, hora = () => '' } = {}) {
    const rotulos = [];
    const disponivel = desfechoDasContas(contas) === DESFECHO_DAS_CONTAS.DISPONIVEL;
    const porId = disponivel ? contas.porId : {};
    const lista = Array.isArray(item?.contas) ? item.contas : [];

    for (const c of lista) {
        const id = typeof c?.userId === 'string' ? c.userId : '';
        if (!id) continue;
        const vezes = contagem(c.requisicoes)
            ? (c.requisicoes === 1 ? '1 requisição' : `${contar(c.requisicoes)} requisições`)
            : '';
        const quando = hora(c.ultima);
        const detalhe = [vezes, quando ? `a última em ${quando}` : ''].filter(Boolean).join(', ');
        const conta = Object.hasOwn(porId, id) ? porId[id] : null;

        if (!disponivel) {
            rotulos.push({ texto: idCurto(id), titulo: [id, detalhe].filter(Boolean).join(' · '), tipo: TIPO_DE_ROTULO.SEM_NOME });
            continue;
        }
        if (!conta) {
            rotulos.push({
                texto: `${idCurto(id)} (removida)`,
                titulo: [`A conta ${id} não existe mais no banco.`, detalhe].filter(Boolean).join(' '),
                tipo: TIPO_DE_ROTULO.REMOVIDA,
            });
            continue;
        }
        const login = typeof conta.username === 'string' && conta.username ? conta.username : idCurto(id);
        const nome = typeof conta.nome === 'string' && conta.nome.trim() ? conta.nome.trim() : '';
        const inativa = conta.ativo === false;
        rotulos.push({
            texto: inativa ? `${login} (inativa)` : login,
            titulo: [nome, inativa ? 'conta desativada' : '', detalhe].filter(Boolean).join(' · '),
            tipo: inativa ? TIPO_DE_ROTULO.INATIVA : TIPO_DE_ROTULO.CONTA,
        });
    }

    const distintas = contagem(item?.contasDistintas) ? item.contasDistintas : lista.length;
    if (distintas > lista.length) {
        const resto = distintas - lista.length;
        rotulos.push({
            texto: resto === 1 ? '+1 conta' : `+${contar(resto)} contas`,
            titulo: 'As menos ativas deste endereço, fora do teto de contas por linha.',
            tipo: TIPO_DE_ROTULO.MAIS,
        });
    }

    if (contagem(item?.anonimas) && item.anonimas > 0) {
        const n = item.anonimas;
        const base = n === 1 ? '1 requisição sem conta' : `${contar(n)} requisições sem conta`;
        const publico = contagem(item?.deLinkPublico) && item.deLinkPublico > 0
            ? `, ${contar(item.deLinkPublico)} de visitante de link público`
            : '';
        rotulos.push({ texto: 'anônimo', titulo: `${base}${publico}`, tipo: TIPO_DE_ROTULO.ANONIMO });
    }
    return rotulos;
}
