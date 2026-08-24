// Path: js/catalog/access-origin-phrases.js

/**
 * @fileoverview O vocabulário do eixo de acesso PRIVADO nas superfícies de leitura (o cartão do
 * catálogo e o seletor de camada base), como funções puras: o selo por PROCEDÊNCIA, o filtro de
 * acesso da grade e o prazo de uma concessão.
 *
 * POR QUE ELE EXISTE. O selo "Privado" carregava UMA frase para TRÊS origens de acesso
 * diferentes, e a frase era "só quem recebeu acesso enxerga este item". Ela é falsa exatamente
 * para o perfil que mais vê selo na tela: o CREDENCIADO enxerga todo o acervo privado por PAPEL,
 * sem ter recebido nada de ninguém. Dizer a ele que recebeu acesso é ensinar errado o modelo de
 * permissão do produto na única tela em que ele o encontra.
 *
 * A PROPRIEDADE QUE DECIDE A TELA NÃO É "PRIVADO", É A VOLATILIDADE. Das três origens, só o
 * EMPRÉSTIMO some sozinho quando a pessoa troca de atlas; papel e concessão viajam com ela. O
 * produto já dizia isso de um lado só, para quem EMPRESTA ({@link lendingScopeNote}, em
 * `js/catalog/visibility-phrases.js`); aqui é o outro lado da mesma frase, para quem RECEBE. As
 * duas redações são irmãs de propósito: o sintoma "o recurso sumiu" chega muito depois da causa,
 * e quem o sofre é quem lê esta, não aquela.
 *
 * `null` É ESTADO LEGÍTIMO E FREQUENTE, não linha pela metade: servidor que ainda não manda a
 * procedência, e soma de recursos que falhou. O caso `null` devolve uma frase VERDADEIRA sem
 * afirmar origem nenhuma, que é o comportamento de hoje menos a mentira. Inventar uma origem
 * padrão seria escolher uma das três para estar errada em silêncio.
 *
 * ZERO IMPORTS, como `visibility-phrases.js`, `admin/group-phrases.js` e
 * `projects/shared-atlas-badge.js`. Aqui isso é contrato e não estilo: um dos consumidores é o
 * seletor de camada base, que vive no chunk `ui-components`, e o outro é o cartão, no `core`;
 * qualquer import daqui chegaria aos dois, e a este módulo cabe só texto e aritmética.
 *
 * O CLASSIFICADOR E O PREDICADO DO FILTRO MORAM AQUI JUNTO COM AS FRASES, e a razão é que os
 * três compartilham UM vocabulário (`papel`, `concessao`, `emprestimo`). Separá-los em dois
 * arquivos põe a mesma lista fechada em dois lugares, que é a forma de ela divergir na primeira
 * revisão.
 */

/**
 * As três origens que o servidor sabe distinguir, na grafia do payload.
 *
 * SÃO EXATAMENTE AS TRÊS DO PREDICADO DO SERVIDOR, e a ordem delas aqui é a de estabilidade
 * decrescente: papel não depende de nada, concessão depende de uma linha viva, empréstimo
 * depende do atlas que está aberto agora.
 * @readonly
 */
export const ACCESS_ORIGIN = Object.freeze({
    PAPEL: 'papel',
    CONCESSAO: 'concessao',
    EMPRESTIMO: 'emprestimo',
});

const ORIGENS = Object.freeze([ACCESS_ORIGIN.PAPEL, ACCESS_ORIGIN.CONCESSAO, ACCESS_ORIGIN.EMPRESTIMO]);

/**
 * A origem em forma canônica, ou `null` para qualquer coisa que não seja uma das três.
 *
 * FALHA PARA `null`, E NÃO PARA UM PADRÃO. Um valor fora da lista é um servidor mais novo que
 * este build (ou lixo), e as duas leituras possíveis são "não sei" e "chutei". A primeira tem
 * frase própria; a segunda produziria um selo que afirma com confiança a origem errada.
 * @param {*} valor
 * @returns {'papel'|'concessao'|'emprestimo'|null}
 */
export function normalizeAccessOrigin(valor) {
    const limpo = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
    return ORIGENS.includes(limpo) ? limpo : null;
}

/**
 * O selo de recurso privado: rótulo, rótulo curto, `title` e se ele é volátil.
 *
 * O RÓTULO SÓ MUDA NO CASO VOLÁTIL, e essa assimetria é o desenho inteiro. Papel e concessão
 * respondem à mesma pergunta prática ("continuo vendo isto amanhã, em qualquer atlas?") com o
 * mesmo sim, então distingui-los no rótulo gastaria a atenção da pessoa num detalhe sem
 * consequência; a diferença entre eles vale a linha do `title`, não a do selo. O empréstimo
 * responde não, e é o único que precisa se anunciar de longe.
 *
 * `rotuloCurto` EXISTE POR MEDIDA DE TELA, não por gosto: o selo da camada base mora sobre uma
 * miniatura de duas colunas, onde "Privado neste atlas" não cabe sem quebrar linha.
 *
 * @param {*} origem - `'papel'`, `'concessao'`, `'emprestimo'`, ou qualquer coisa (inclusive
 *   `null`) para o caso sem procedência conhecida.
 * @param {{sujeito?: string}} [opcoes] - O sujeito da frase, para a superfície que não fala de
 *   "recurso" (o seletor de camada base fala de "camada base").
 * @returns {{origem: 'papel'|'concessao'|'emprestimo'|null, rotulo: string, rotuloCurto: string,
 *   title: string, volatil: boolean}}
 */
export function privateBadgePhrase(origem, { sujeito } = {}) {
    const quem = String(sujeito ?? '').trim() || 'Recurso privado';
    const canonica = normalizeAccessOrigin(origem);

    if (canonica === ACCESS_ORIGIN.EMPRESTIMO) {
        return {
            origem: canonica,
            rotulo: 'Privado neste atlas',
            rotuloCurto: 'Emprestado',
            title: `${quem} emprestado por este atlas: você deixa de enxergá-lo ao sair daqui, `
                + 'a menos que tenha acesso próprio a ele.',
            volatil: true,
        };
    }

    if (canonica === ACCESS_ORIGIN.PAPEL) {
        return {
            origem: canonica,
            rotulo: 'Privado',
            rotuloCurto: 'Privado',
            title: `${quem}: você o enxerga pelo seu papel na plataforma, sem depender de `
                + 'concessão nem do atlas que estiver aberto.',
            volatil: false,
        };
    }

    if (canonica === ACCESS_ORIGIN.CONCESSAO) {
        return {
            origem: canonica,
            rotulo: 'Privado',
            rotuloCurto: 'Privado',
            title: `${quem}: você recebeu acesso a ele, e continua enxergando-o em qualquer `
                + 'atlas enquanto a concessão valer.',
            volatil: false,
        };
    }

    return {
        origem: null,
        rotulo: 'Privado',
        rotuloCurto: 'Privado',
        title: `${quem}: nem todo mundo do sistema enxerga este item.`,
        volatil: false,
    };
}

/**
 * As chaves do filtro de acesso da grade do catálogo.
 *
 * `PRIVADO` É SUPERCONJUNTO DAS TRÊS ORIGENS, de propósito: quem só quer separar o acervo
 * público do restrito não deveria precisar entender o eixo de procedência para fazê-lo, e quem
 * quer estreitar mais tem as três abaixo. União dentro do grupo, então ligar `PRIVADO` junto de
 * `EMPRESTIMO` absorve o segundo em vez de produzir uma interseção vazia.
 * @readonly
 */
export const ACCESS_FILTER = Object.freeze({
    PUBLICO: 'publico',
    PRIVADO: 'privado',
    PAPEL: ACCESS_ORIGIN.PAPEL,
    CONCESSAO: ACCESS_ORIGIN.CONCESSAO,
    EMPRESTIMO: ACCESS_ORIGIN.EMPRESTIMO,
});

/**
 * A classe de acesso de um item, que é o que o filtro e o contador comparam.
 *
 * `'privado'` (sem origem) É UMA CLASSE, e não um erro a corrigir: é o item privado cuja
 * procedência este build não conhece. Ele conta e filtra como privado, e só não responde às
 * três chaves de origem, que é a única coisa honesta a fazer com um dado ausente.
 *
 * @param {{privado?: boolean, origem?: *}} [item]
 * @returns {'publico'|'papel'|'concessao'|'emprestimo'|'privado'}
 */
export function classifyAccess({ privado, origem } = {}) {
    if (!privado) return ACCESS_FILTER.PUBLICO;
    return normalizeAccessOrigin(origem) ?? ACCESS_FILTER.PRIVADO;
}

/** @param {string} classe @returns {boolean} Se a classe é uma das quatro privadas. */
function ehPrivada(classe) {
    return classe !== ACCESS_FILTER.PUBLICO;
}

/**
 * As chaves de filtro válidas de uma coleção qualquer, sem repetição e na ordem canônica.
 *
 * A NORMALIZAÇÃO É DO MÓDULO E NÃO DO CHAMADOR porque três chamadores diferentes passam a
 * mesma coleção (o predicado, o contador e a frase do estado vazio), e uma chave inválida
 * tratada de três jeitos produz contador que não bate com a lista.
 * @param {*} chaves - Array, Set, ou qualquer iterável.
 * @returns {string[]}
 */
export function normalizeAccessFilters(chaves) {
    const brutas = chaves == null ? [] : Array.from(
        typeof chaves[Symbol.iterator] === 'function' && typeof chaves !== 'string' ? chaves : []
    );
    const validas = Object.values(ACCESS_FILTER);
    const vistas = new Set(brutas.filter((c) => validas.includes(c)));
    return validas.filter((c) => vistas.has(c));
}

/**
 * Se um item passa pelo filtro de acesso.
 *
 * NENHUM FILTRO ATIVO PASSA TUDO, como o filtro de tipo já faz: o estado inicial da grade é o
 * acervo inteiro, e não o vazio.
 *
 * @param {string} classe - Saída de {@link classifyAccess}.
 * @param {*} ativos - As chaves ligadas (array ou Set).
 * @returns {boolean}
 */
export function matchesAccessFilter(classe, ativos) {
    const ligados = normalizeAccessFilters(ativos);
    if (ligados.length === 0) return true;
    if (ligados.includes(classe)) return true;
    return ehPrivada(classe) && ligados.includes(ACCESS_FILTER.PRIVADO);
}

/**
 * Quantos itens cada chave de filtro mostraria SOZINHA.
 *
 * ESTE É O CONTRATO DO CONTADOR, e ele é o mesmo do contador de tipo que já existia: o número
 * ao lado de uma chave é o tamanho da lista que aquela chave, ligada sozinha e sem busca,
 * produz. Contador que responde a outra pergunta (quantos sobram DEPOIS dos outros filtros)
 * discorda da lista no instante em que dois filtros se cruzam, e contador que discorda da lista
 * é pior que contador nenhum.
 *
 * @param {string[]} classes - Uma classe por item do acervo.
 * @returns {Object<string, number>}
 */
export function countByAccessFilter(classes) {
    const lista = Array.isArray(classes) ? classes : [];
    const contagem = Object.fromEntries(Object.values(ACCESS_FILTER).map((c) => [c, 0]));
    for (const classe of lista) {
        if (classe === ACCESS_FILTER.PUBLICO) {
            contagem[ACCESS_FILTER.PUBLICO] += 1;
            continue;
        }
        contagem[ACCESS_FILTER.PRIVADO] += 1;
        if (normalizeAccessOrigin(classe)) contagem[classe] += 1;
    }
    return contagem;
}

/** Os rótulos e as dicas das cinco chaves de filtro. @readonly */
const FILTER_TEXT = Object.freeze({
    [ACCESS_FILTER.PUBLICO]: Object.freeze({
        label: 'Público',
        title: 'Itens do acervo público, que qualquer pessoa enxerga.',
    }),
    [ACCESS_FILTER.PRIVADO]: Object.freeze({
        label: 'Privado',
        title: 'Todo item restrito que você enxerga, seja qual for o motivo.',
    }),
    [ACCESS_FILTER.PAPEL]: Object.freeze({
        label: 'Pelo meu papel',
        title: 'Itens restritos que você enxerga pelo seu papel na plataforma.',
    }),
    [ACCESS_FILTER.CONCESSAO]: Object.freeze({
        label: 'Concedidos a mim',
        title: 'Itens restritos a que alguém concedeu acesso a você.',
    }),
    [ACCESS_FILTER.EMPRESTIMO]: Object.freeze({
        label: 'Emprestados por este atlas',
        title: 'Itens restritos que você só enxerga enquanto estiver neste atlas.',
    }),
});

/**
 * O rótulo de uma chave de filtro de acesso, ou string vazia para chave desconhecida.
 * @param {string} chave
 * @returns {string}
 */
export function accessFilterLabel(chave) {
    return FILTER_TEXT[chave]?.label ?? '';
}

/**
 * O `title` de uma chave de filtro de acesso, ou string vazia para chave desconhecida.
 * @param {string} chave
 * @returns {string}
 */
export function accessFilterTitle(chave) {
    return FILTER_TEXT[chave]?.title ?? '';
}

/** "a, b e c" @param {string[]} itens @returns {string} */
function listar(itens) {
    if (itens.length <= 1) return itens[0] ?? '';
    return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/** Um contador de tela como inteiro não negativo. @param {*} valor @returns {number} */
function toCount(valor) {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * A frase do estado VAZIO da grade, nomeando o que a esvaziou.
 *
 * "NENHUM ITEM ENCONTRADO" É UMA CAIXA BRANCA, e era o que a grade dizia: a pessoa que ligou
 * três filtros e uma busca fica sem saber qual deles apagou a lista, e a saída óbvia (desligar
 * tudo) é a que ela não toma justamente porque não sabe o que ligou. A frase nomeia as
 * restrições ativas e diz o gesto que devolve itens.
 *
 * SEM RESTRIÇÃO NENHUMA A FRASE É OUTRA, e não uma variação da mesma: lista vazia com filtro
 * zerado significa acervo vazio, e mandar desligar um filtro que não existe é um conselho
 * impossível de seguir.
 *
 * E O ACERVO VAZIO DE QUEM NÃO ENTROU LEVA UM CONVITE, que é a única saída que essa pessoa
 * tem daquela tela. O catálogo do visitante anônimo é o público do deploy e mais nada: o
 * privado que uma conta alcança nem chega ao cliente. Não mostrar o restrito é correto por
 * sigilo; não mencionar que entrar muda a lista é perda de descoberta, e a pessoa fica sem
 * gesto nenhum a tomar.
 *
 * O CONVITE NÃO CONTA NADA E NÃO SE REPETE. Ele diz que a lista PODE crescer, nunca que
 * existem N itens restritos: afirmar existência a quem não entrou é o oráculo de enumeração
 * que a cláusula 5.6 fecha de propósito. E ele some para quem já entrou, senão vira ruído na
 * tela de todo mundo que já tomou a decisão que ele sugere.
 *
 * `autenticado` É PARÂMETRO, E NUNCA UM IMPORT AQUI DENTRO. Este módulo é folha de zero
 * imports por contrato (dois chunks diferentes o consomem), então quem sabe da sessão é o
 * chamador, que já a tem em mãos.
 *
 * @param {{temBusca?: boolean, tiposAtivos?: *, acessosAtivos?: *, autenticado?: boolean}} [estado]
 *   `autenticado` DEFAULTA A `true` de propósito: sem saber quem está olhando, o silêncio é o
 *   desfecho seguro, e um convite para entrar mostrado a quem já entrou é pior que convite
 *   nenhum.
 * @returns {string}
 */
export function catalogEmptyNotice({
    temBusca = false, tiposAtivos = 0, acessosAtivos = [], autenticado = true
} = {}) {
    const partes = [];
    if (temBusca) partes.push('a busca');

    const tipos = toCount(tiposAtivos);
    if (tipos > 0) partes.push(tipos === 1 ? 'o filtro de tipo' : 'os filtros de tipo');

    const acessos = normalizeAccessFilters(acessosAtivos);
    if (acessos.length > 0) {
        const nomes = acessos.map((c) => accessFilterLabel(c)).filter(Boolean).join(', ');
        partes.push(`o filtro de acesso (${nomes})`);
    }

    if (partes.length === 0) {
        const vazio = 'O catálogo não tem nenhum item para mostrar.';
        // Só no ramo do vazio DE VERDADE: com filtro ligado o gesto útil é desligá-lo, e um
        // convite ao lado dele disputaria a atenção com o conselho que resolve a tela.
        return autenticado ? vazio
            : `${vazio} Entrar na sua conta pode revelar itens que só quem tem acesso enxerga.`;
    }
    return `Nenhum item passa por ${listar(partes)}. Desligue um filtro ou limpe a busca para `
        + 'ver mais itens.';
}

/**
 * Uma data do servidor em dd/mm/aaaa, ou string vazia quando não há data utilizável.
 *
 * A DATA PURA (`2026-09-01`) É FORMATADA PELOS DÍGITOS, e não por `Date`, porque `new Date` a
 * lê como meia-noite UTC: no fuso do Brasil ela vira o dia ANTERIOR na hora de exibir, e um
 * prazo que aparece um dia mais cedo do que é vale menos que prazo nenhum. Com hora junto o
 * instante é absoluto e a conversão para o fuso local é a leitura certa.
 * @param {*} valor
 * @returns {string}
 */
function dataCurta(valor) {
    if (typeof valor === 'string') {
        const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
        if (soData) return `${soData[3]}/${soData[2]}/${soData[1]}`;
    }
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return '';
    return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * O instante em que um prazo expira, em ms, ou `NaN`.
 *
 * A DATA PURA VALE ATÉ O FIM DO DIA, e não a partir da meia-noite: "expira em 01/09" que some
 * do catálogo no começo do dia 01 contradiz o que a própria tela diz. Com hora junto, o
 * servidor já disse o instante.
 * @param {*} valor
 * @returns {number}
 */
function instanteDoPrazo(valor) {
    if (typeof valor === 'string') {
        const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
        if (soData) {
            return new Date(
                Number(soData[1]), Number(soData[2]) - 1, Number(soData[3]), 23, 59, 59, 999
            ).getTime();
        }
    }
    return new Date(valor).getTime();
}

/**
 * O chip de PRAZO de um acesso, ou `null` quando não há prazo conhecido.
 *
 * POR QUE NO CARTÃO, E NÃO SÓ NO MODAL DE CONCESSÃO. O prazo já era mostrado, mas dentro do
 * modal de compartilhar, que só abre por um botão gateado por `canShareResource`: quem recebeu
 * com nível `view` (a maioria de quem tem prazo) nunca alcança aquele chip. Para essa pessoa o
 * recurso aparece um dia e some noutro, e nada explica qualquer um dos dois lados, porque a
 * morte da concessão mora no predicado do servidor e não emite evento nenhum. É o mesmo buraco
 * que o selo de atlas compartilhado (`js/projects/shared-atlas-badge.js`) fechou no eixo de
 * ATLAS, e a decisão do dono registrada lá (selo na tela, não e-mail) vale aqui pela mesma
 * razão: resolve o caso comum sem depender do relay de e-mail estar de pé.
 *
 * `null` PARA AUSENTE E PARA LIXO, no mesmo ramo: concessão sem prazo é o caso normal (a
 * maioria não expira), então "sem data" não é anomalia e não deve desenhar nada. Data ilegível
 * cai aqui junto porque o chip só pode existir se disser um dia certo.
 *
 * @param {*} valor - O `expires_at` do servidor (ISO com hora, ou data pura).
 * @param {{agora?: number}} [opcoes] - O instante de referência, injetável para teste.
 * @returns {{estado: 'futuro'|'hoje'|'vencido', rotulo: string, title: string}|null}
 */
export function accessExpiryPhrase(valor, { agora = Date.now() } = {}) {
    if (valor == null || valor === '') return null;
    const instante = instanteDoPrazo(valor);
    if (!Number.isFinite(instante)) return null;
    const texto = dataCurta(valor);
    if (!texto) return null;

    const referencia = Number.isFinite(agora) ? agora : Date.now();

    if (instante <= referencia) {
        return {
            estado: 'vencido',
            rotulo: `acesso expirou em ${texto}`,
            title: 'O prazo deste acesso já passou. O item sai do seu catálogo na próxima vez '
                + 'que a lista for carregada.',
        };
    }

    const fimDeHoje = new Date(referencia);
    fimDeHoje.setHours(23, 59, 59, 999);
    if (instante <= fimDeHoje.getTime()) {
        return {
            estado: 'hoje',
            rotulo: 'acesso expira hoje',
            title: 'Depois de hoje o acesso deixa de valer sozinho, sem aviso: o item some do '
                + 'seu catálogo.',
        };
    }

    return {
        estado: 'futuro',
        rotulo: `acesso expira em ${texto}`,
        title: 'Depois desta data o acesso deixa de valer sozinho, sem aviso: o item some do '
            + 'seu catálogo.',
    };
}
