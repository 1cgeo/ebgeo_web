// Path: js/admin/diag-phrases.js

/**
 * @fileoverview O que a aba "Diagnóstico" DIZ, e como ela decide o que desenhar, em funções puras
 * testáveis em node. ZERO IMPORTS de fora do painel, como os irmãos (`grant-phrases.js`,
 * `group-phrases.js`, `catalog-delete-phrases.js`): `admin.html` boota sem a store, e um import
 * daqui a arrastaria de volta pelo caminho transitivo. O único import é `./instante.js`, que é
 * folha pelo mesmo contrato e existe porque a aba Uso escrevia a mesma leitura de data byte a byte.
 *
 * A ABA RESPONDE UMA PERGUNTA SÓ, feita três vezes: "o que está quebrado agora?". As três seções
 * (pulso de requisições, defeitos, latência por rota) leem a MESMA janela de tempo, e é por isso
 * que a janela mora na aba e não em cada seção: comparar o pico de 5xx da última hora com a
 * latência dos últimos sete dias não responde nada.
 *
 * ERAM QUATRO ATÉ 2026-09-02, e as duas listas de erro viraram uma. A de erros do SERVIDOR vinha
 * da varredura do arquivo de log e a de erros do NAVEGADOR vinha do banco, lado a lado, sem nada
 * ligando o mesmo defeito visto pelas duas portas, e nenhuma das duas tinha ESTADO: um defeito
 * consertado ficava na tela com a mesma cara de um que ninguém olhou. As duas foram substituídas
 * pela seção "Defeitos" (`GET /diag/defeitos`), cujo vocabulário mora em `defeito-phrases.js`.
 * O que este arquivo perdeu junto foi a família de frases daquelas duas listas, os endereços
 * agregados por assinatura e as duas ordenações delas; a varredura do log continua no terminal
 * (`npm run diag -- erros`), com os endereços, e quem diz isso na tela é `escopoNotice`
 * (`defeito-phrases.js`). O que ficou aqui é o que as três seções COMPARTILHAM.
 *
 * A CONTAGEM É A INFORMAÇÃO, e é a decisão que atravessa este arquivo inteiro. Mil ocorrências de
 * um defeito e uma de outro não podem ter o mesmo peso na tela: quem abre esta aba está
 * escolhendo o que consertar primeiro, e uma lista em que tudo pesa igual devolve a escolha para
 * a pessoa sem nenhum dado a mais do que ela já tinha. Daí `pesoDaContagem`, que é uma escada
 * LOGARÍTMICA e não linear (1, 2-9, 10-99, 100+), porque a diferença que importa entre dois
 * defeitos é de ordem de grandeza, não de unidade.
 *
 * MAS A CONTAGEM DE UM DEFEITO NÃO É DA JANELA, e tratá-la como se fosse foi o defeito que
 * `contagemHistoricaDetalhe` existe para desfazer. `defeitos.ocorrencias` é um contador VITALÍCIO
 * (o upsert o incrementa desde a primeira vez que a assinatura apareceu e nada o zera), enquanto
 * a janela filtra `ultima_em`; e ele conta RELATO, não ocorrência, porque o cliente deduplica uma
 * assinatura por sessão. É por isso que a lista de defeitos é ordenada por RECÊNCIA, que é o
 * critério pelo qual o servidor a corta (ver `ordenarDefeitos`, em `defeito-phrases.js`).
 *
 * O VAZIO É UMA BOA NOTÍCIA E TEM DE PARECER UMA. "Nenhum erro nas últimas 24 horas" é o melhor
 * desfecho possível desta tela, e desenhá-lo com a mesma cara de uma falha de carregamento ensina
 * a pessoa a ler saúde como defeito. Por isso `estadoDaSecao` separa QUATRO estados e não dois, e
 * por isso as frases de vazio nomeiam a janela: "nenhum erro" sem período é uma afirmação sobre a
 * história inteira do sistema, que nenhuma destas rotas fez.
 *
 * O ESTADO `FALHA` ABSORVE O PAYLOAD MALFORMADO, e essa é a decisão que mais custa se for tomada
 * ao contrário. Uma resposta sem a lista esperada (contrato quebrado, rota que ainda não existe e
 * respondeu 404 com corpo de erro, proxy que devolveu HTML) NÃO pode virar "nenhum erro": seria a
 * boa notícia mais perigosa do produto, um verde que afirma saúde justamente quando o instrumento
 * parou de medir. Lista ausente é falha, e falha tem botão. O array NU é aceito ao lado do
 * envelope pela razão inversa e simétrica: um servidor que devolva a lista crua tem dado de
 * verdade para mostrar, e chamá-lo de falha esconderia erro real.
 *
 * TODO TEXTO DAQUI SAI PARA A TELA POR `textContent`. Mensagem, pilha, user agent e URL vêm de
 * erro do NAVEGADOR de quem visita a página pública: é texto arbitrário de terceiro, e este
 * arquivo não monta uma linha de HTML. `resumirTexto` existe para o layout, nunca como sanitização.
 */

/**
 * As janelas que a aba oferece, na ordem do seletor.
 *
 * O TETO É SETE DIAS, e é do servidor: a rota apara qualquer coisa maior. Oferecer "30 dias" aqui
 * desenharia um controle que promete um recorte que a resposta não tem, que é o defeito que o
 * seletor de período da Auditoria já pagou uma vez (filtro que alargava a janela em silêncio).
 *
 * `frase` é a forma que entra nas frases de vazio ("nenhum erro NAS ÚLTIMAS 24 HORAS"), e ela é
 * campo próprio em vez de derivada do rótulo porque as duas flexões divergem em português.
 * @type {ReadonlyArray<{valor: string, rotulo: string, frase: string}>}
 */
export const JANELAS = Object.freeze([
    Object.freeze({ valor: '1h', rotulo: 'Última hora', frase: 'na última hora' }),
    Object.freeze({ valor: '24h', rotulo: 'Últimas 24 horas', frase: 'nas últimas 24 horas' }),
    Object.freeze({ valor: '7d', rotulo: 'Últimos 7 dias', frase: 'nos últimos 7 dias' }),
]);

/**
 * A janela de abertura.
 *
 * VINTE E QUATRO HORAS, e não uma hora: a aba abre para responder "o que quebrou?", e uma hora é
 * curta demais para um defeito que aconteceu de manhã ainda aparecer à tarde. Sete dias seria o
 * outro extremo, misturando o incidente de ontem com o de terça.
 * @type {string}
 */
export const JANELA_PADRAO = '24h';

/** O teto imposto pelo servidor, repetido aqui só para o seletor não oferecer além dele. */
export const JANELA_TETO = '7d';

/**
 * Whether `valor` is one of the windows this build offers.
 * @param {*} valor
 * @returns {boolean}
 */
export function janelaValida(valor) {
    return typeof valor === 'string' && JANELAS.some((j) => j.valor === valor);
}

/**
 * A janela a usar. Falha FECHADA no padrão: um valor estranho (URL antiga, estado corrompido)
 * consulta 24 horas, e nunca uma janela que o servidor recusaria.
 * @param {*} valor
 * @returns {string}
 */
export function normalizarJanela(valor) {
    return janelaValida(valor) ? valor : JANELA_PADRAO;
}

/**
 * O rótulo do seletor para uma janela.
 * @param {*} valor
 * @returns {string}
 */
export function rotuloDeJanela(valor) {
    const j = JANELAS.find((x) => x.valor === normalizarJanela(valor));
    return j.rotulo;
}

/**
 * A janela em forma de complemento de frase ("nas últimas 24 horas").
 * @param {*} valor
 * @returns {string}
 */
export function janelaEmPalavras(valor) {
    const j = JANELAS.find((x) => x.valor === normalizarJanela(valor));
    return j.frase;
}

/**
 * Os quatro estados de uma seção. São QUATRO e não dois porque "carregando" e "vazio" são desfechos
 * opostos que a mesma tela desenharia igual se o vocabulário fosse binário.
 * @type {Readonly<Object<string, string>>}
 */
export const ESTADO = Object.freeze({
    CARREGANDO: 'carregando',
    FALHA: 'falha',
    VAZIO: 'vazio',
    LISTA: 'lista',
});

/**
 * O estado que uma seção deve desenhar.
 *
 * A ORDEM DOS RAMOS É O CONTRATO: carregando vence tudo (uma requisição em voo não sabe ainda se
 * vai falhar), depois a falha explícita, e só então o formato do payload. Ver o `@fileoverview`
 * sobre por que a lista ausente é FALHA e nunca vazio.
 *
 * @param {Object} [entrada]
 * @param {boolean} [entrada.carregando]
 * @param {*} [entrada.erro] - Qualquer valor não nulo conta como falha (um `ApiError`, um `Error`
 *   de rede, ou o `reason` de um `allSettled`).
 * @param {*} [entrada.itens] - A lista já extraída do payload, ou `null`/`undefined` quando o
 *   payload não tinha lista nenhuma.
 * @returns {string} Um valor de {@link ESTADO}.
 */
export function estadoDaSecao({ carregando = false, erro = null, itens = null } = {}) {
    if (carregando) return ESTADO.CARREGANDO;
    if (erro !== null && erro !== undefined) return ESTADO.FALHA;
    if (!Array.isArray(itens)) return ESTADO.FALHA;
    return itens.length === 0 ? ESTADO.VAZIO : ESTADO.LISTA;
}

/**
 * A lista de um payload, aceitando o envelope e o array nu.
 *
 * Devolve `null` (e não `[]`) quando não há lista: é o que faz `estadoDaSecao` distinguir "o
 * servidor disse que não houve erro" de "o servidor não disse nada que eu entenda".
 * @param {*} payload
 * @param {string} campo - O nome do campo da lista no envelope (`grupos`, `rotas`, `itens`).
 * @returns {Array<*>|null}
 */
export function listaDoPayload(payload, campo) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object' && Array.isArray(payload[campo])) {
        return payload[campo];
    }
    return null;
}

const FORMATADOR_DE_NUMERO = new Intl.NumberFormat('pt-BR');

/**
 * A contagem, agrupada em milhares. Um travessão para o que não é contagem: escrever "0" sobre um
 * campo ausente inventa um fato, e num painel de diagnóstico o fato inventado é justamente "não
 * aconteceu nada".
 * @param {*} n
 * @returns {string}
 */
export function contagemLabel(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
    return FORMATADOR_DE_NUMERO.format(Math.round(n));
}

/**
 * A contagem por extenso, para o `title` e para o leitor de tela: o número grande sozinho não diz
 * do que ele é contagem.
 * @param {*} n
 * @returns {string}
 */
export function contagemDetalhe(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'sem contagem';
    const inteiro = Math.round(n);
    return inteiro === 1 ? '1 ocorrência' : `${FORMATADOR_DE_NUMERO.format(inteiro)} ocorrências`;
}

/**
 * As quatro classes de peso visual de uma contagem.
 * @type {Readonly<Object<string, string>>}
 */
export const PESO = Object.freeze({
    UNICA: 'unica',
    POUCAS: 'poucas',
    MUITAS: 'muitas',
    MASSA: 'massa',
});

/**
 * O peso visual de uma contagem, numa escada LOGARÍTMICA.
 *
 * POR QUE LOG E NÃO LINEAR: entre um defeito com 3 ocorrências e outro com 7 não há decisão a
 * tomar; entre 7 e 700 há. Uma escala linear gastaria os quatro degraus na faixa baixa, que é
 * onde eles não separam nada.
 *
 * O DESCONHECIDO CAI NO DEGRAU MAIS BAIXO, de propósito: o peso é ALARME, e alarmar por um número
 * que não chegou é a forma de fazer a pessoa parar de olhar para o alarme. Quem diz que a
 * contagem falta é `contagemLabel`, com o travessão.
 * @param {*} n
 * @returns {string} Um valor de {@link PESO}.
 */
export function pesoDaContagem(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 2) return PESO.UNICA;
    if (n < 10) return PESO.POUCAS;
    if (n < 100) return PESO.MUITAS;
    return PESO.MASSA;
}

// A leitura de instante mora em `./instante.js`, compartilhada com a outra aba do painel:
// as duas frentes a escreveram identica no mesmo dia, e ela e a peca com ramos suficientes
// para divergir sem ninguem notar. Reexportada para os consumidores (e os testes) deste
// modulo nao mudarem de porta por causa de uma extracao interna.
import { instanteDe } from './instante.js';

export { instanteDe };


/**
 * A hora LOCAL de um instante, curta (dia e hora do relógio de quem lê).
 *
 * LOCAL, E NÃO UTC: quem lê esta aba está correlacionando com o que acabou de acontecer na tela
 * dele, e um instante em UTC obriga a pessoa a fazer a conta de fuso no meio de um diagnóstico.
 * @param {*} valor
 * @param {{timeZone?: string}} [opts] - `timeZone` existe para o teste ser determinístico; a tela
 *   nunca o passa, e é isso que a mantém no fuso de quem lê.
 * @returns {string} Vazio quando não há instante.
 */
export function horaLocal(valor, { timeZone } = {}) {
    const d = instanteDe(valor);
    if (!d) return '';
    return d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        ...(timeZone ? { timeZone } : {}),
    });
}

/**
 * A hora local COM segundos, para o `title`: correlacionar com um log de servidor precisa do
 * segundo, e a linha da tabela não tem largura para ele.
 * @param {*} valor
 * @param {{timeZone?: string}} [opts]
 * @returns {string}
 */
export function horaLocalCompleta(valor, { timeZone } = {}) {
    const d = instanteDe(valor);
    if (!d) return '';
    return d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        ...(timeZone ? { timeZone } : {}),
    });
}

/**
 * A janela de vida de um grupo de erros ("de X até Y"), para o `title` da última ocorrência.
 *
 * UM DEFEITO QUE COMEÇOU HÁ CINCO DIAS E UM QUE COMEÇOU HÁ CINCO MINUTOS pedem reações
 * diferentes, e a coluna mostra só o fim. Quando as duas pontas coincidem (ocorrência única) a
 * frase não repete a data.
 * @param {*} primeira
 * @param {*} ultima
 * @param {{timeZone?: string}} [opts]
 * @returns {string} Vazio quando nenhuma das pontas se resolve.
 */
export function intervaloDeOcorrencias(primeira, ultima, { timeZone } = {}) {
    const a = horaLocalCompleta(primeira, { timeZone });
    const b = horaLocalCompleta(ultima, { timeZone });
    if (!a && !b) return '';
    if (!a) return `Última ocorrência em ${b}`;
    if (!b) return `Primeira ocorrência em ${a}`;
    if (a === b) return `Ocorrência única em ${a}`;
    return `Da primeira em ${a} até a última em ${b}`;
}

/**
 * As faixas de status que o painel sempre desenha, na ordem de leitura.
 * @type {ReadonlyArray<string>}
 */
export const FAIXAS = Object.freeze(['2xx', '3xx', '4xx', '5xx']);

/**
 * A família de uma faixa, para a cor. Faixa que este build não conhece NÃO herda a cor de outra:
 * pintar um `1xx` de verde afirmaria saúde sobre um valor que ninguém classificou.
 * @param {*} faixa
 * @returns {string}
 */
export function faixaEstado(faixa) {
    switch (faixa) {
        case '2xx': return 'ok';
        case '3xx': return 'redirecionamento';
        case '4xx': return 'cliente';
        case '5xx': return 'servidor';
        default: return 'desconhecida';
    }
}

/**
 * As faixas a desenhar, a partir do mapa `porFaixa` da rota.
 *
 * AS QUATRO CONHECIDAS APARECEM SEMPRE, inclusive zeradas, e isso é a decisão: "zero respostas
 * 5xx" é a informação que a pessoa veio buscar, e uma barra que simplesmente não é desenhada se
 * lê como dado que não chegou. Faixa desconhecida entra depois delas, em ordem alfabética, para
 * que um `1xx` inventado pelo servidor apareça em vez de sumir.
 *
 * Mapa ausente devolve lista VAZIA, e não quatro zeros: aí o dado é que não chegou.
 * @param {*} porFaixa
 * @returns {Array<{faixa: string, total: number, estado: string}>}
 */
export function faixasOrdenadas(porFaixa) {
    if (!porFaixa || typeof porFaixa !== 'object' || Array.isArray(porFaixa)) return [];
    const conhecidas = FAIXAS.map((faixa) => ({
        faixa,
        total: numeroOuZero(porFaixa[faixa]),
        estado: faixaEstado(faixa),
    }));
    const extras = Object.keys(porFaixa)
        .filter((k) => !FAIXAS.includes(k))
        .sort()
        .map((faixa) => ({ faixa, total: numeroOuZero(porFaixa[faixa]), estado: faixaEstado(faixa) }));
    return [...conhecidas, ...extras];
}

/** @param {*} v @returns {number} */
function numeroOuZero(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * A taxa de erro do período, em percentual pt-BR.
 *
 * TRÊS CASAS DE SAÍDA QUE NÃO SÃO O NÚMERO: sem total não há taxa (`null`, e a tela não desenha o
 * chip), SEM A CONTAGEM DE ERROS também não há, e uma taxa positiva menor que um décimo de por
 * cento vira "<0,1%" em vez de "0,0%", porque arredondar um erro real para zero é dizer que ele
 * não houve.
 *
 * A SEGUNDA SAÍDA É IRMÃ DE `estadoDaContagemDeErros`, e por isso pergunta a ele: enquanto o
 * numerador ausente virava zero por `numeroOuZero`, esta função desenhava um chip VERDE de "0%" ao
 * lado de um ladrilho que já dizia, com um travessão, que o número de erros não chegou. Duas
 * afirmações opostas sobre o mesmo campo, na mesma linha da tela, e a mentirosa era a verde.
 * @param {{total?: *, erros?: *}} [entrada]
 * @returns {string|null}
 */
export function taxaDeErro({ total, erros } = {}) {
    if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null;
    if (estadoDaContagemDeErros(erros) === CONTAGEM.DESCONHECIDA) return null;
    const n = numeroOuZero(erros);
    const pct = (n / total) * 100;
    if (pct === 0) return '0%';
    if (pct < 0.1) return '<0,1%';
    return `${pct.toFixed(1).replace('.', ',')}%`;
}

/**
 * Uma latência em milissegundos, legível.
 *
 * A UNIDADE MUDA NO SEGUNDO porque é onde a leitura muda: abaixo disso a pessoa compara números
 * de três dígitos, acima disso ela já decidiu que está lento e quer a ordem de grandeza.
 * @param {*} ms
 * @returns {string}
 */
export function latenciaLabel(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
    if (ms > 0 && ms < 1) return '<1 ms';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/**
 * Os estados de latência. `DESCONHECIDA` existe pelo mesmo motivo de `faixaEstado`: um p95 que não
 * chegou não pode ser pintado de verde.
 * @type {Readonly<Object<string, string>>}
 */
export const LATENCIA = Object.freeze({
    OK: 'ok',
    ATENCAO: 'atencao',
    LENTA: 'lenta',
    DESCONHECIDA: 'desconhecida',
});

/**
 * O estado de uma rota a partir do p95.
 *
 * O P95 É O NÚMERO, e não a média: a média de mil chamadas rápidas com cinquenta travadas continua
 * parecendo rápida, e é justamente a cauda que a pessoa está sentindo quando diz "está lento".
 * Os cortes (300 ms e 1 s) são a régua de percepção usual: abaixo de 300 ms a resposta se lê como
 * imediata, acima de 1 s a pessoa já saiu do fluxo.
 * @param {*} p95
 * @returns {string} Um valor de {@link LATENCIA}.
 */
export function estadoDaLatencia(p95) {
    if (typeof p95 !== 'number' || !Number.isFinite(p95) || p95 < 0) return LATENCIA.DESCONHECIDA;
    if (p95 < 300) return LATENCIA.OK;
    if (p95 < 1000) return LATENCIA.ATENCAO;
    return LATENCIA.LENTA;
}

/**
 * Os estados do ladrilho de contagem do pulso.
 * @type {Readonly<Object<string, string>>}
 */
export const CONTAGEM = Object.freeze({
    OK: 'ok',
    ERRO: 'erro',
    DESCONHECIDA: 'desconhecida',
});

/**
 * O estado do ladrilho "Erros" do pulso, a partir da contagem.
 *
 * TRÊS ESTADOS E NÃO DOIS, pela mesma razão de `faixaEstado` e de `estadoDaLatencia`: AUSÊNCIA DE
 * DADO NÃO É AUSÊNCIA DE ERRO. A forma anterior era `contagem > 0 ? 'erro' : 'ok'`, que pinta de
 * VERDE um campo que não chegou (rota antiga, contrato mudado, payload aparado por um proxy),
 * bem ao lado de um travessão dizendo que o número falta. É a boa notícia mais barata do produto:
 * o número desapareceu e a tela afirmou saúde.
 *
 * Contagem NEGATIVA cai em `DESCONHECIDA` junto com o resto, para casar com `contagemLabel`, que
 * já desenha travessão nela: o ladrilho não pode ter cor de fato onde o texto diz "sem número".
 * @param {*} n
 * @returns {string} Um valor de {@link CONTAGEM}.
 */
export function estadoDaContagemDeErros(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return CONTAGEM.DESCONHECIDA;
    return n > 0 ? CONTAGEM.ERRO : CONTAGEM.OK;
}

/**
 * Corta um texto longo para caber numa linha de lista, preservando o começo.
 *
 * ISTO É LAYOUT, NUNCA SANITIZAÇÃO. A mensagem e a pilha vêm do navegador de quem visitou a página
 * pública, e o que as torna seguras é sair por `textContent`; cortar só impede que uma mensagem de
 * cinquenta mil caracteres empurre a lista para fora da tela. O texto inteiro continua na tela, no
 * `title` e no bloco expansível.
 * @param {*} texto
 * @param {number} [max]
 * @returns {string}
 */
export function resumirTexto(texto, max = 160) {
    if (typeof texto !== 'string') return '';
    const limpo = texto.replace(/\s+/g, ' ').trim();
    if (!limpo) return '';
    const teto = Number.isFinite(max) && max > 1 ? Math.floor(max) : 160;
    if (limpo.length <= teto) return limpo;
    return `${limpo.slice(0, teto - 1)}…`;
}

/**
 * A mensagem de um defeito, que é o que a pessoa lê primeiro na linha.
 * @param {Object} item
 * @returns {string}
 */
export function mensagemLabel(item) {
    const mensagem = typeof item?.mensagem === 'string' ? item.mensagem.trim() : '';
    if (mensagem) return resumirTexto(mensagem);
    const assinatura = typeof item?.assinatura === 'string' ? item.assinatura.trim() : '';
    if (assinatura) return resumirTexto(assinatura);
    return 'Erro sem mensagem';
}

/**
 * Quem estava na tela quando o defeito aconteceu.
 *
 * "anônimo" NÃO É FALTA DE DADO aqui, é o estado normal da metade pública do produto: o mapa é o
 * produto de quem não entrou. Escrever um travessão faria a linha parecer incompleta.
 * @param {Object} item
 * @returns {string}
 */
export function usuarioLabel(item) {
    const username = typeof item?.username === 'string' ? item.username.trim() : '';
    if (username) return username;
    const userId = typeof item?.userId === 'string' ? item.userId.trim() : '';
    if (userId) return userId;
    return 'anônimo';
}

/**
 * Onde o defeito aconteceu. A página é o recorte útil (`index.html` contra `atlas.html`
 * já separa dois produtos), e a URL inteira é o segundo melhor.
 * @param {Object} item
 * @returns {string}
 */
export function paginaLabel(item) {
    const pagina = typeof item?.pagina === 'string' ? item.pagina.trim() : '';
    if (pagina) return resumirTexto(pagina, 80);
    const url = typeof item?.url === 'string' ? item.url.trim() : '';
    if (url) return resumirTexto(url, 80);
    return '—';
}

/**
 * O nome de uma rota na tabela de latência.
 * @param {Object} linha
 * @returns {string}
 */
export function rotaLabel(linha) {
    const rota = typeof linha?.rota === 'string' ? linha.rota.trim() : '';
    return rota ? resumirTexto(rota, 80) : 'rota sem nome';
}

/**
 * As rotas, da mais lenta para a mais rápida POR P95.
 *
 * POR P95 E NÃO POR MÉDIA nem por `max`: o `max` é uma chamada só, que pode ser um cliente que
 * dormiu, e a média esconde a cauda. O p95 é o que corresponde a "está lento" para uma pessoa em
 * vinte tentativas.
 * @param {*} rotas
 * @returns {Array<Object>}
 */
export function ordenarRotas(rotas) {
    if (!Array.isArray(rotas)) return [];
    return [...rotas].sort((a, b) => numeroOuZero(b?.p95) - numeroOuZero(a?.p95)
        || numeroOuZero(b?.n) - numeroOuZero(a?.n)
        || String(a?.rota ?? '').localeCompare(String(b?.rota ?? '')));
}

// ===== as frases de cada seção =====

/** @returns {string} */
export function tabSubtitle() {
    return 'A saúde do servidor e dos navegadores: o que falhou, quantas vezes, e o que está lento.';
}

/** @returns {string} */
export function janelaLabel() {
    return 'Janela';
}

/**
 * A dica do seletor de janela.
 *
 * ELA DIZIA "o servidor não guarda além de 7d", E ERA FALSO (visto na captura de tela de
 * 2026-08-30, antes de a aba entrar). O servidor GUARDA trinta dias de log
 * (`LOG_RETENTION_DAYS`); o teto de 7d é da CONSULTA, e existe porque ler trinta arquivos
 * numa requisição HTTP seria derrubar o servidor pela porta do diagnóstico. A diferença não
 * é sutil para quem opera: a primeira frase manda a pessoa desistir de investigar um
 * incidente de dez dias atrás que está inteiro no disco, alcançável por `npm run diag`.
 * Documentação que engana é pior que documentação ausente, e uma frase na tela é
 * documentação.
 * @returns {string}
 */
export function janelaHint() {
    return `As três seções leem a mesma janela. Aqui o teto de consulta é ${JANELA_TETO}; o log em disco guarda mais, e o comando diag alcança.`;
}

/** @param {*} janela @returns {string} */
export function pulsoEmptyNotice(janela) {
    return `Nenhuma requisição registrada ${janelaEmPalavras(janela)}.`;
}

/** @returns {string} */
export function pulsoEmptyHint() {
    return 'Ou o servidor foi reiniciado agora, ou o registro de requisições não está sendo escrito.';
}

/** @returns {string} */
export function pulsoFailureNotice() {
    return 'Não foi possível ler o pulso de requisições do servidor.';
}


/**
 * O que a varredura do servidor leu, dito em voz alta.
 *
 * SEM ISTO O VAZIO É AMBÍGUO: "nenhum erro" depois de ler zero arquivo é uma afirmação sobre o
 * leitor, não sobre o servidor, e as duas se desenham igual.
 * @param {{arquivos?: *, linhas?: *}} [resumo]
 * @returns {string}
 */
export function serverErrorsScanNotice({ arquivos, linhas } = {}) {
    const a = typeof arquivos === 'number' && Number.isFinite(arquivos) ? arquivos : null;
    const l = typeof linhas === 'number' && Number.isFinite(linhas) ? linhas : null;
    if (a === null && l === null) return '';
    const partes = [];
    if (a !== null) partes.push(a === 1 ? '1 arquivo de log' : `${contagemLabel(a)} arquivos de log`);
    if (l !== null) partes.push(l === 1 ? '1 linha lida' : `${contagemLabel(l)} linhas lidas`);
    return partes.join(', ');
}

/**
 * O leitor de log está CEGO: não achou o diretório.
 *
 * ISTO NÃO É VAZIO, e a distinção é a razão de esta função existir. As duas seções que leem
 * arquivo de log (erros do servidor e latência) respondem com sucesso e lista vazia quando o
 * diretório não existe, e desenhar a boa notícia aí seria afirmar saúde a partir de um instrumento
 * desligado. É a mesma classe da "cobertura vazia passa verde": a pergunta certa é o que este
 * verde estaria provando se o servidor estivesse pegando fogo.
 * @param {*} payload
 * @returns {boolean}
 */
export function leitorCego(payload) {
    return payload?.diretorioAusente === true;
}

/** @returns {string} */
export function leitorCegoNotice() {
    return 'O servidor não encontrou o diretório de log, então esta seção não leu nada. '
        + '"Nenhum erro" aqui seria uma afirmação sobre o leitor, e não sobre o servidor.';
}

/**
 * A janela foi TRUNCADA: havia mais linhas do que a leitura comporta, e as mais antigas do período
 * ficaram de fora. Sem esta frase, um pico no começo da janela some sem nada dizer.
 * @param {*} payload
 * @returns {string}
 */
export function truncamentoNotice(payload) {
    if (payload?.truncado !== true) return '';
    return 'A janela tem mais linhas do que esta leitura comporta: os registros mais ANTIGOS do '
        + 'período ficaram de fora. Estreite a janela para alcançar o começo dela.';
}

/**
 * A lista foi CORTADA pelo limite da consulta.
 *
 * SEM ISTO, VINTE É INDISTINGUÍVEL DE VINTE QUE ERAM QUATROCENTOS, e quem lê conclui que viu tudo.
 * O servidor manda a contagem ANTES do corte justamente para esta frase existir.
 * @param {*} mostrados
 * @param {*} total
 * @param {string} unidade - No plural ("assinaturas", "rotas").
 * @returns {string}
 */
export function cortadaNotice(mostrados, total, unidade) {
    if (typeof mostrados !== 'number' || !Number.isFinite(mostrados)) return '';
    if (typeof total !== 'number' || !Number.isFinite(total)) return '';
    if (total <= mostrados) return '';
    return `Mostrando ${contagemLabel(mostrados)} de ${contagemLabel(total)} ${unidade}.`;
}


/**
 * A unidade que acompanha o número na tela, para quem não lê a nota.
 *
 * ELA VAI DENTRO DO PRÓPRIO CRACHÁ porque a nota da seção é um parágrafo, e parágrafo se pula. Duas
 * palavras coladas ao número são o que sobrevive a um olhar de dois segundos, que é o modo como
 * esta lista é lida de verdade.
 * @returns {string}
 */
export function contagemHistoricaUnidade() {
    return 'relatos no total';
}

/**
 * O `title` do crachá de um defeito: o número por extenso COM as duas pontas do
 * intervalo, que é o que o transforma de número solto em fato datado.
 * @param {Object} [item]
 * @param {{timeZone?: string}} [opts] - `timeZone` existe para o teste ser determinístico.
 * @returns {string}
 */
export function contagemHistoricaDetalhe(item, { timeZone } = {}) {
    const n = item?.ocorrencias;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'sem contagem';
    const inteiro = Math.round(n);
    const quantos = inteiro === 1 ? '1 relato' : `${FORMATADOR_DE_NUMERO.format(inteiro)} relatos`;
    const primeira = horaLocalCompleta(item?.primeiraEm, { timeZone });
    const ultima = horaLocalCompleta(item?.ultimaEm, { timeZone });
    if (primeira && ultima && primeira !== ultima) {
        return `${quantos} no total, o primeiro em ${primeira} e o último em ${ultima}.`;
    }
    if (ultima) return `${quantos} no total, em ${ultima}.`;
    if (primeira) return `${quantos} no total, desde ${primeira}.`;
    // SEM DATA NENHUMA a frase ainda tem de dizer que o número é acumulado, porque é justamente
    // aqui que ele fica sozinho na tela e volta a se parecer com contagem da janela.
    return `${quantos} no total, desde a primeira vez que esta assinatura apareceu.`;
}

/** @param {*} janela @returns {string} */
export function slowEmptyNotice(janela) {
    return `Nenhuma rota com latência medida ${janelaEmPalavras(janela)}.`;
}

/** @returns {string} */
export function slowEmptyHint() {
    return 'Sem tráfego no período não há percentil a calcular.';
}

/** @returns {string} */
export function slowFailureNotice() {
    return 'Não foi possível ler a latência por rota.';
}

/**
 * Por que a coluna em destaque é o p95, dito na tela.
 * @returns {string}
 */
export function slowScopeNotice() {
    return 'O p95 é a coluna que corresponde a "está lento": em vinte chamadas, uma passa dele. '
        + 'A média esconde a cauda e o máximo é uma chamada só.';
}

