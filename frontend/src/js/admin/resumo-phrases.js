// Path: js/admin/resumo-phrases.js

/**
 * @fileoverview O que a seção "Resumo" da aba Diagnóstico DIZ, em funções puras testáveis em node.
 * ZERO IMPORTS, como `defeito-phrases.js` e pelo mesmo motivo: `admin.html` boota sem a store, e
 * um import daqui a arrastaria de volta pelo caminho transitivo.
 *
 * ELA É O `npm run diag -- resumo` NA TELA. A decisão do dono, em 2026-09-02, foi que o relatório
 * de uma tela não vira digesto diário por e-mail: ele aparece no painel, onde já está quem pode
 * agir. O servidor compõe o MESMO documento que o comando imprime (`montarResumo`,
 * `backend/src/utils/diag-consulta.js`), e o que este arquivo faz é traduzir aquele documento para
 * as palavras da tela. A semântica é espelhada, o texto não: o comando escreve para um terminal de
 * largura fixa (colunas alinhadas, "(s)" no plural) e a tela escreve para uma pessoa lendo prosa.
 *
 * ─── A REGRA QUE VALE PARA OS SEIS CARTÕES, E É A RAZÃO DESTE ARQUIVO EXISTIR ───
 *
 * **Cartão cuja fonte não respondeu DIZ isso, e nunca desenha zero.** É a mesma regra do relatório
 * no terminal, e ela vale aqui por um motivo a mais: num relatório de uma tela a boa notícia falsa
 * aparece ao lado de cinco verdadeiras e ganha a credibilidade delas. Por isso o desfecho é
 * TERNÁRIO e não binário (`desfechoDoBloco`), e o terceiro é o que uma tela tem e um comando não:
 * o servidor pode ser de uma versão ANTERIOR e simplesmente não mandar o bloco. Chamar isso de
 * "sem fonte" mandaria procurar o problema no log ou no banco, quando o que falta é a implantação.
 *
 * **E todo cartão publica a PREMISSA, inclusive na boa notícia** (`premissaDoBloco`), que é a mesma
 * correção que `resumirAmostras` levou em 2026-09-01: uma frase tranquilizadora sem a premissa
 * visível mentiu por meses. Os dois blocos de banco declaram se a lista veio PARCIAL (o topo é o
 * maior DENTRE OS QUE VIERAM); os três blocos de arquivo declaram arquivos abertos e linhas lidas,
 * que é o que torna uma contagem baixa falsificável.
 *
 * ─── O QUE NÃO SE FORMATA AQUI, E POR QUÊ ───
 *
 * A LATÊNCIA EM MILISSEGUNDOS NÃO É FORMATADA NESTE ARQUIVO. `latenciaLabel` mora em
 * `diag-phrases.js` (que importa `./instante.js` e portanto não é folha), e uma segunda régua de
 * "quando ms vira s" divergiria da tabela de latência logo abaixo, na MESMA tela. Então
 * `deltaNotice` recebe o formatador do chamador, que é o único ponto com os dois módulos à mão. É
 * o mesmo despacho já documentado em `numeroDaSaude` (`diag-tab.js`).
 *
 * A DURAÇÃO DE UM INTERVALO, ao contrário, é local (`duracaoLegivel`): ela não existe em nenhum
 * outro módulo deste pacote, e o irmão dela vive no comando, do outro lado da fronteira.
 *
 * NENHUMA STRING DE UI CARREGA CRASE. A tela desenha tudo por `textContent`, então a crase de
 * markdown chega ao olho da pessoa como um caractere solto em volta do comando que ela deveria
 * destacar. Comando e nome de variável saem entre aspas duplas, como `escopoNotice`
 * (`defeito-phrases.js`) já faz. A crase continua valendo aqui dentro, no JSDoc, que é prosa para
 * quem lê o código.
 */

const FORMATADOR_DE_NUMERO = new Intl.NumberFormat('pt-BR');

const SEGUNDO = 1000;

/**
 * Os TRÊS desfechos de um bloco do resumo.
 *
 * `AUSENTE` E `SEM_FONTE` NÃO SÃO A MESMA COISA, e colapsá-los é o erro que esta constante existe
 * para impedir: o primeiro é o servidor que não conhece o bloco (implantação anterior a ele) e o
 * segundo é o servidor que conhece, tentou e não conseguiu ler a fonte. A providência é oposta
 * (atualizar a implantação contra olhar o log ou o banco), e uma frase só mandaria metade das
 * pessoas para o lugar errado.
 * @type {Readonly<Object<string, string>>}
 */
export const RESUMO_DESFECHO = Object.freeze({
    AUSENTE: 'ausente',
    SEM_FONTE: 'sem-fonte',
    DISPONIVEL: 'disponivel',
});

/**
 * Os seis cartões, na ordem em que são desenhados.
 *
 * `campo` É O BLOCO DO PAYLOAD e `id` é o cartão, e os dois divergem em UM caso: "Queries lentas"
 * lê `latencia.queriesLentas`, porque no documento do servidor aquela contagem mora DENTRO do
 * bloco de latência (ela responde à mesma pergunta por outro andar). O cartão é separado porque a
 * tela tem grade e o terminal tem linhas, mas a fonte e a indisponibilidade são as do bloco de
 * latência, e é por isso que `campo` aponta para lá: um cartão com fonte própria inventaria um
 * sexto bloco que o servidor não tem.
 * @type {ReadonlyArray<{id: string, campo: string, titulo: string}>}
 */
export const BLOCOS_DO_RESUMO = Object.freeze([
    Object.freeze({ id: 'defeitos', campo: 'defeitos', titulo: 'Defeitos' }),
    Object.freeze({ id: 'latencia', campo: 'latencia', titulo: 'Latência (p95)' }),
    Object.freeze({ id: 'saude', campo: 'saude', titulo: 'Saúde do processo' }),
    Object.freeze({ id: 'indisponivel', campo: 'indisponivel', titulo: 'Indisponibilidade' }),
    Object.freeze({ id: 'status', campo: 'status', titulo: 'Pulso resumido' }),
    Object.freeze({ id: 'queriesLentas', campo: 'latencia', titulo: 'Queries lentas' }),
]);

/**
 * O bloco `campo` do payload, ou `null` quando ele não veio.
 *
 * O ARRAY NÃO CONTA COMO BLOCO, e a checagem é explícita porque `typeof [] === 'object'`: um
 * payload aparado por proxy que devolvesse listas no lugar dos blocos passaria por "bloco
 * presente" e o cartão leria `disponivel` de um array, que é `undefined`, caindo em SEM_FONTE com
 * motivo nenhum. Melhor dizer que o servidor não informou.
 * @param {*} payload
 * @param {string} campo
 * @returns {Object|null}
 */
export function blocoDoPayload(payload, campo) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const bloco = payload[campo];
    if (!bloco || typeof bloco !== 'object' || Array.isArray(bloco)) return null;
    return bloco;
}

/**
 * O payload é reconhecível como um resumo?
 *
 * BASTA UM BLOCO, e não todos: um servidor que ganhe um sétimo bloco continua sendo entendido, e
 * um que perca um deixa aquele cartão dizer AUSENTE sozinho. Zero blocos conhecidos é outra coisa
 * (404 com corpo de erro, HTML de proxy, contrato trocado) e vira FALHA na tela, nunca uma grade
 * de seis cartões vazios, que se leria como sistema sem nada a relatar.
 * @param {*} payload
 * @returns {boolean}
 */
export function resumoReconhecido(payload) {
    return BLOCOS_DO_RESUMO.some((b) => blocoDoPayload(payload, b.campo) !== null);
}

/**
 * O desfecho de um bloco.
 * @param {*} bloco - Já extraído por {@link blocoDoPayload}.
 * @returns {string} Um valor de {@link RESUMO_DESFECHO}.
 */
export function desfechoDoBloco(bloco) {
    if (!bloco || typeof bloco !== 'object' || Array.isArray(bloco)) return RESUMO_DESFECHO.AUSENTE;
    return bloco.disponivel === true ? RESUMO_DESFECHO.DISPONIVEL : RESUMO_DESFECHO.SEM_FONTE;
}

/** @returns {string} */
export function resumoTitulo() {
    return 'Resumo';
}

/** @returns {string} */
export function resumoSubtitulo() {
    return 'O relatório de uma tela: o que quebrou, o que está devagar e se o processo esteve de pé';
}

/**
 * De onde a seção vem, dito na tela.
 *
 * ELA NOMEIA O COMANDO porque o resumo já existia no terminal antes de existir aqui, e as duas
 * saídas compartilham a composição: quem quiser o mesmo relatório com o detalhe que não cabe numa
 * grade tem o comando, e saber disso é o que impede a próxima pessoa de escrever um terceiro.
 * @returns {string}
 */
export function resumoEscopoNotice() {
    return 'Os mesmos números de "npm run diag -- resumo", compostos pelo servidor. Cada cartão diz '
        + 'de onde veio: bloco cuja fonte não respondeu não desenha número nenhum, porque zero se '
        + 'leria como "nada aconteceu".';
}

/**
 * Quando o servidor compôs este documento.
 *
 * ELE NÃO É A HORA DA TELA, e é por isso que a frase existe: a aba não recarrega sozinha, então um
 * resumo lido às onze pode ter sido composto às nove, e todas as contagens dele são de então. Sem a
 * hora, a única pista de que a tela envelheceu seria a pessoa lembrar quando abriu a página.
 *
 * `formatarHora` VEM DE FORA pelo mesmo motivo de `deltaNotice` e `janelaAnteriorNotice`: a leitura
 * de instante da casa mora em `instante.js`, atrás de `diag-phrases.js`, que não é folha. Sem
 * formatador não há frase, e não há queda para um segundo formato escrito aqui.
 * @param {*} payload
 * @param {Function} formatarHora - `(epochMs: number) => string`.
 * @returns {string}
 */
export function compostoEmNotice(payload, formatarHora) {
    if (typeof formatarHora !== 'function') return '';
    const t = payload?.gerado_em;
    if (typeof t !== 'number' || !Number.isFinite(t)) return '';
    const texto = formatarHora(t);
    return texto ? `Composto às ${texto}.` : '';
}

/** @returns {string} */
export function resumoFailureNotice() {
    return 'O servidor não informou o resumo desta janela.';
}

/**
 * A resposta chegou e não é um resumo.
 *
 * ISTO É FALHA E NUNCA VAZIO, pela mesma razão de `listaDoPayload` devolver `null`: uma grade de
 * seis cartões dizendo "o servidor não informou" se leria como seis fatos, quando o fato é um só e
 * é sobre a resposta inteira.
 * @returns {string}
 */
export function resumoDesconhecidoNotice() {
    return 'A resposta do servidor não tem nenhum dos blocos do resumo. Esta implantação pode ser '
        + 'anterior à rota, ou a resposta veio aparada no caminho.';
}

/** @returns {string} */
export function blocoAusenteNotice() {
    return 'Este servidor não informou este bloco. É implantação anterior a ele, e não uma leitura '
        + 'que falhou: nada se afirma aqui.';
}

/**
 * A fonte do bloco não respondeu, com o motivo que o servidor deu.
 *
 * O MOTIVO VEM DO SERVIDOR E A RESSALVA É DAQUI, e a segunda metade é a que não pode faltar: sem
 * ela um cartão vazio parece um cartão que ainda está carregando.
 * @param {*} bloco
 * @returns {string}
 */
export function semFonteNotice(bloco) {
    const motivo = typeof bloco?.motivo === 'string' ? bloco.motivo.trim() : '';
    const base = motivo || 'a fonte deste bloco não respondeu.';
    return `Sem fonte: ${base} Nenhum número é desenhado aqui de propósito.`;
}

/**
 * A premissa de um bloco disponível: o que foi lido para chegar naqueles números.
 *
 * DUAS FORMAS, uma por fonte, e a do banco carrega a palavra que salva o topo de mentir: com a
 * lista PARCIAL, "os que mais ocorreram" são os que mais ocorreram DENTRE OS QUE VIERAM, porque a
 * consulta corta por recência e não por contagem.
 * @param {*} bloco
 * @returns {string}
 */
export function premissaDoBloco(bloco) {
    const p = bloco?.premissa;
    if (!p || typeof p !== 'object') return '';
    if (p.fonte === 'banco') {
        const vistos = numeroOuNulo(p.vistos);
        const total = numeroOuNulo(p.total);
        if (vistos === null || total === null) return 'Premissa: a leitura do banco não declarou quanto viu.';
        const base = `Premissa: ${plural(vistos, 'defeito', 'defeitos')} de ${numero(total)} na janela.`;
        return p.parcial === true
            ? `${base} LISTA PARCIAL: o topo é o maior dentre os que vieram.`
            : base;
    }
    const arquivos = numeroOuNulo(p.arquivos);
    const linhas = numeroOuNulo(p.linhas);
    if (arquivos === null && linhas === null) return 'Premissa: a leitura do log não declarou o que abriu.';
    const partes = [];
    if (arquivos !== null) partes.push(plural(arquivos, 'arquivo de log', 'arquivos de log'));
    if (linhas !== null) partes.push(plural(linhas, 'linha lida', 'linhas lidas'));
    return `Premissa: ${partes.join(', ')} na janela.`;
}

// ===== bloco 1: defeitos =====

/**
 * Quantos nasceram e quantos voltaram.
 *
 * "NOVO" AQUI É DA JANELA (`primeira_em` dentro dela), e não o selo da última visita desta pessoa,
 * que é outra palavra "novo" da mesma tela. Um defeito nascido hoje e já resolvido continua sendo
 * novo, e é justamente o que se quer ver depois de um dia de trabalho.
 * @param {*} bloco
 * @returns {string}
 */
export function defeitosResumoNotice(bloco) {
    const novos = numeroOuNulo(bloco?.novos);
    const regressoes = numeroOuNulo(bloco?.regressoes);
    if (novos === null && regressoes === null) return 'Sem contagem de novos nem de regressões.';
    const partes = [];
    if (novos !== null) partes.push(`${plural(novos, 'defeito novo', 'defeitos novos')} na janela`);
    if (regressoes !== null) partes.push(plural(regressoes, 'regressão', 'regressões'));
    return `${capitalizar(partes.join(', '))}.`;
}

/**
 * O recorte por procedência, que é TERNÁRIO e não binário.
 *
 * O TERCEIRO BALDE É O MAIOR NA PRÁTICA: a maioria das linhas não declara origem, e somá-las ao
 * lado do navegador inventaria procedência, enquanto escondê-las faria as duas contagens não
 * fecharem com o total.
 * @param {*} porOrigem
 * @returns {string}
 */
export function origensNotice(porOrigem) {
    const servidor = numeroOuNulo(porOrigem?.servidor);
    const cliente = numeroOuNulo(porOrigem?.cliente);
    const sem = numeroOuNulo(porOrigem?.semOrigem);
    if (servidor === null && cliente === null && sem === null) return '';
    const partes = [];
    if (servidor !== null) partes.push(`${numero(servidor)} do servidor`);
    if (cliente !== null) partes.push(`${numero(cliente)} do navegador`);
    if (sem !== null) partes.push(`${numero(sem)} sem origem declarada`);
    return `Origem: ${partes.join(', ')}.`;
}

/** @returns {string} */
export function defeitosVazioNotice() {
    return 'Nenhum defeito na janela.';
}

/** @returns {string} */
export function topoTitulo() {
    return 'Os que mais ocorreram';
}

// ===== bloco 2: latência =====

/**
 * Os tons de um delta de p95, para a folha de estilo.
 *
 * CINCO E NÃO TRÊS, e os dois que sobram são os que não têm cor de juízo: `SEM_BASE` é a rota que
 * não existia na janela anterior (deploy que a criou, ou janela anterior fora do arquivo), e
 * pintá-la de vermelho gritaria exatamente onde não há nada a dizer; `DESCONHECIDO` é o p95 que
 * não chegou, e ele não pode ser verde pela mesma razão de `estadoDaLatencia`.
 * @type {Readonly<Object<string, string>>}
 */
export const DELTA = Object.freeze({
    PIORA: 'piora',
    MELHORA: 'melhora',
    ESTAVEL: 'estavel',
    SEM_BASE: 'sem-base',
    DESCONHECIDO: 'desconhecido',
});

/**
 * O tom de uma linha de rota.
 * @param {*} rota
 * @returns {string} Um valor de {@link DELTA}.
 */
export function deltaTom(rota) {
    if (numeroOuNulo(rota?.p95) === null) return DELTA.DESCONHECIDO;
    const delta = rota?.delta;
    if (typeof delta !== 'number' || !Number.isFinite(delta)) return DELTA.SEM_BASE;
    if (delta > 0) return DELTA.PIORA;
    if (delta < 0) return DELTA.MELHORA;
    return DELTA.ESTAVEL;
}

/**
 * O delta de uma rota, com o SINAL explícito e a ausência de base NOMEADA.
 *
 * O SINAL É EXPLÍCITO NOS DOIS SENTIDOS ("+30 ms" e "-30 ms") porque a coluna é uma COMPARAÇÃO, e
 * um número sem sinal ao lado de outro se lê como o valor, não como a diferença.
 *
 * `formatarMs` VEM DE FORA, e o motivo está no `@fileoverview`: a régua de "quando ms vira s" é a
 * mesma da tabela de latência logo abaixo, e ela mora em `diag-phrases.js`, que não é folha. Sem
 * formatador não há frase, e não há queda para uma segunda régua escrita aqui.
 * @param {*} rota
 * @param {Function} formatarMs - `(ms: number) => string`.
 * @returns {string}
 */
export function deltaNotice(rota, formatarMs) {
    if (typeof formatarMs !== 'function') return '';
    const p95 = numeroOuNulo(rota?.p95);
    if (p95 === null) return 'sem p95 medido';
    const delta = rota?.delta;
    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
        return `${formatarMs(p95)} (sem base na janela anterior)`;
    }
    const anterior = numeroOuNulo(rota?.p95Anterior);
    // O SINAL É POSTO À MÃO E SOBRE O MÓDULO, e não delegado ao formatador: `latenciaLabel` recusa
    // número negativo (devolve travessão), então formatar `-30` direto apagaria a diferença toda.
    const magnitude = formatarMs(Math.abs(delta));
    const assinado = delta > 0 ? `+${magnitude}` : (delta < 0 ? `-${magnitude}` : magnitude);
    const pct = typeof rota?.deltaPct === 'number' && Number.isFinite(rota.deltaPct)
        ? ` / ${rota.deltaPct > 0 ? '+' : ''}${porcentagem(rota.deltaPct)}`
        : '';
    const era = anterior === null ? '' : `era ${formatarMs(anterior)}, `;
    return `${formatarMs(p95)} (${era}${assinado}${pct})`;
}

/** @returns {string} */
export function rotasVaziasNotice() {
    return 'Nenhuma requisição com duração na janela.';
}

/**
 * Por que estas rotas, e não as mais lentas.
 * @returns {string}
 */
export function maisChamadasNotice() {
    return 'São as MAIS CHAMADAS, não as mais lentas: o que um deploy piora de forma visível é o '
        + 'que o produto de fato usa.';
}

/**
 * A janela foi TRUNCADA, e é o DELTA que isso corrói.
 *
 * ELA NÃO É A MESMA RESSALVA DA SEÇÃO, e é por isso que existe uma segunda: lá embaixo
 * `truncamentoNotice` diz que os registros mais antigos do período ficaram de fora, o que já vale
 * para toda a aba. Aqui a consequência é específica e pior, porque o mais antigo que o anel
 * descarta É a janela de comparação: o p95 de agora continua medido e o p95 "anterior" passa a ser
 * de um pedaço dela, então o delta compara uma janela cheia com uma janela pela metade e a leitura
 * natural ("piorou") é a errada. Só esta porta trunca: o comando lê em fluxo e não tem anel.
 * @returns {string}
 */
export function deltaTruncadoNotice() {
    return 'A leitura foi truncada, e o que o anel descarta são os registros mais ANTIGOS, ou seja, '
        + 'a própria janela de comparação: o delta acima pode estar medido contra uma base '
        + 'incompleta. Estreite a janela antes de concluir que piorou.';
}

/**
 * A janela anterior, que é a base do delta.
 * @param {*} bloco
 * @param {Function} formatarHora - `(epochMs: number) => string`.
 * @returns {string}
 */
export function janelaAnteriorNotice(bloco, formatarHora) {
    if (typeof formatarHora !== 'function') return '';
    const j = bloco?.premissa?.janelaAnterior;
    const inicio = numeroOuNulo(j?.inicio);
    const fim = numeroOuNulo(j?.fim);
    if (inicio === null || fim === null) return '';
    const a = formatarHora(inicio);
    const b = formatarHora(fim);
    if (!a || !b) return '';
    return `Comparado com ${a} a ${b}, que é a janela imediatamente anterior, do mesmo tamanho.`;
}

// ===== bloco 6: queries lentas =====

/**
 * A contagem de query lenta, contra a janela anterior.
 * @param {*} q
 * @returns {string}
 */
export function queriesLentasNotice(q) {
    const janela = numeroOuNulo(q?.janela);
    const anterior = numeroOuNulo(q?.anterior);
    if (janela === null) return 'O servidor não informou a contagem de query lenta.';
    const agora = plural(janela, 'query lenta', 'queries lentas');
    if (anterior === null) return `${capitalizar(agora)} na janela.`;
    return `${capitalizar(agora)} na janela, ${numero(anterior)} na anterior.`;
}

/** @returns {string} */
export function queriesLentasHint() {
    return 'O limiar é a variável SLOW_QUERY_MS. As linhas saem em "npm run diag -- linhas '
        + '--filtro db: query lenta", e não no relatório de erros: query lenta é o produto '
        + 'funcionando devagar, não falhando.';
}

/**
 * De onde este cartão tira os números, dito porque ele NÃO tem bloco próprio.
 * @returns {string}
 */
export function queriesLentasFonteNotice() {
    return 'Mesma fonte do cartão de Latência: o servidor conta as duas coisas no mesmo bloco.';
}

// ===== bloco 3: saúde =====

/**
 * As situações que a série de amostras pode estar, e o que cada uma significa em português.
 *
 * ELAS SÃO TOKENS DO SERVIDOR, e despejá-los crus na tela ("3 amostras: amostra-unica") entrega ao
 * leitor um identificador de código no lugar de uma frase. A tabela é a mesma forma de `estadoLabel`
 * e `origemLabel`, e por isso herda a propriedade que importa: o valor que este build não conhece
 * SAI COMO VEIO, em vez de virar "situação desconhecida", porque o token cru é o que se procura no
 * código e é a única coisa verdadeira que a tela tem a dizer sobre ele.
 * @type {ReadonlyArray<{valor: string, rotulo: string}>}
 */
export const SITUACOES_DA_SERIE = Object.freeze([
    Object.freeze({ valor: 'sem-amostras', rotulo: 'nenhuma amostra na janela' }),
    Object.freeze({ valor: 'amostra-unica', rotulo: 'uma amostra só, sem distância para medir' }),
    Object.freeze({ valor: 'medida', rotulo: 'série medida' }),
]);

/**
 * O rótulo de uma situação da série.
 * @param {*} situacao
 * @returns {string}
 */
export function situacaoDaSerieLabel(situacao) {
    const achado = SITUACOES_DA_SERIE.find((s) => s.valor === situacao);
    if (achado) return achado.rotulo;
    const texto = typeof situacao === 'string' ? situacao.trim() : '';
    return texto || 'situação não declarada';
}

/**
 * A duração de um intervalo, legível.
 *
 * A UNIDADE MENOR SÓ APARECE QUANDO ELA DISTINGUE ALGUMA COISA: "5 min 0 s" faz quem lê conferir
 * duas vezes um número que é redondo. Vazio para o que não é duração, porque "0 s" sobre um campo
 * ausente afirmaria que a última amostra acabou de sair.
 * @param {*} ms
 * @returns {string}
 */
export function duracaoLegivel(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
    const seg = Math.round(ms / SEGUNDO);
    if (seg < 60) return `${seg} s`;
    const min = Math.floor(seg / 60);
    if (min < 60) return seg % 60 ? `${min} min ${seg % 60} s` : `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
    const d = Math.floor(h / 24);
    return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/**
 * Os buracos na série de amostras, com a PREMISSA da conta junto.
 *
 * TRÊS DESFECHOS, e os dois primeiros existem para não dizer "nenhuma amostra faltando" quando
 * ninguém contou nada: `situacao` diferente de `medida` (série curta demais) e `faltantes` nulo (o
 * intervalo não foi estimável). Foi uma frase de boa notícia sem premissa visível que mentiu por
 * meses no comando, e o conserto é o mesmo aqui.
 * @param {*} bloco
 * @returns {string}
 */
export function saudeSituacaoNotice(bloco) {
    const amostras = numeroOuNulo(bloco?.amostras);
    const quantas = amostras === null ? 'Sem contagem de amostras' : capitalizar(plural(amostras, 'amostra', 'amostras'));
    if (bloco?.situacao !== 'medida') {
        return `${quantas}: ${situacaoDaSerieLabel(bloco?.situacao)}. Nada se afirma sobre buraco `
            + 'na série.';
    }
    const faltantes = numeroOuNulo(bloco?.faltantes);
    if (faltantes === null) {
        return `${quantas}, mas o INTERVALO não foi estimável: nada se afirma sobre buraco. Isto não `
            + 'é "nada faltou".';
    }
    const esperadas = numeroOuNulo(bloco?.esperadas);
    const buracos = numeroOuNulo(bloco?.buracos);
    const de = esperadas === null ? '' : ` de ${numero(esperadas)}`;
    const em = buracos === null ? '' : ` em ${plural(buracos, 'buraco', 'buracos')}`;
    return `${quantas}, ${numero(faltantes)} faltando${de}${em}, supondo ${intervaloEmPalavras(bloco)}.`;
}

/**
 * De onde veio o intervalo que divide a contagem de faltantes.
 *
 * ELE SAI SEMPRE, informado ou inferido, porque a contagem é uma conta sobre uma premissa e
 * premissa invisível não se confere.
 * @param {*} bloco
 * @returns {string}
 */
export function intervaloEmPalavras(bloco) {
    const ms = numeroOuNulo(bloco?.intervaloMs);
    const texto = ms === null ? 'um intervalo que o servidor não declarou' : `intervalo de ${duracaoLegivel(ms)}`;
    if (ms === null) return texto;
    return bloco?.intervaloOrigem === 'informado'
        ? `${texto}, informado`
        : `${texto}, INFERIDO da própria série`;
}

/** @param {*} bloco @returns {string} */
export function estimativaFragilNotice(bloco) {
    if (bloco?.estimativaFragil !== true) return '';
    return 'ESTIMATIVA FRÁGIL do intervalo: confirme com "npm run diag -- saude --intervalo" antes '
        + 'de concluir.';
}

/** @param {*} bloco @returns {string} */
export function maiorBuracoNotice(bloco) {
    const ms = numeroOuNulo(bloco?.maiorBuracoMs);
    if (ms === null) return '';
    return `Maior buraco: ${duracaoLegivel(ms)}.`;
}

/**
 * Há quanto tempo saiu a última amostra, e se ela está atrasada.
 *
 * O ATRASO É A ÚNICA FRASE DESTA SEÇÃO QUE FALA DO PRESENTE: os buracos são história, e uma
 * amostra atrasada é a suspeita de que o processo esteja fora AGORA.
 * @param {*} bloco
 * @returns {string}
 */
export function ultimaAmostraNotice(bloco) {
    const texto = duracaoLegivel(bloco?.desdeUltimaMs);
    if (!texto) return 'O servidor não disse há quanto tempo foi a última amostra.';
    const base = `Última amostra há ${texto}.`;
    return bloco?.ultimaAtrasada === true
        ? `${base} ATRASADA: o processo pode estar fora agora.`
        : base;
}

/**
 * O espaço livre no disco do log, na última amostra.
 *
 * É INDÍCIO E NUNCA VEREDITO, e a ressalva anda colada ao número: quando o disco enche, o log em
 * arquivo se desliga e a série some sem o processo ter morrido, mas o processo também pode ter
 * morrido por outro motivo com o disco cheio por coincidência. Não há limiar escrito em lugar
 * nenhum: o número vai cru, e o juízo é de quem lê.
 * @param {*} disco
 * @returns {string}
 */
export function discoNotice(disco) {
    const livre = numeroOuNulo(disco?.livreMb);
    const total = numeroOuNulo(disco?.totalMb);
    if (livre === null) return '';
    const de = total === null ? '' : ` de ${numero(total)} MB`;
    return `Disco do log na última amostra: ${numero(livre)} MB livres${de} (indício, não veredito).`;
}

// ===== bloco 4: indisponibilidade =====

/**
 * A queda vista pelo NAVEGADOR.
 * @param {*} bloco
 * @returns {string}
 */
export function indisponivelNotice(bloco) {
    const assinaturas = numeroOuNulo(bloco?.defeitos);
    const ocorrencias = numeroOuNulo(bloco?.ocorrencias);
    if (assinaturas === null) return 'O servidor não informou a contagem de indisponibilidade.';
    const base = capitalizar(plural(assinaturas, 'assinatura', 'assinaturas'));
    const cauda = ocorrencias === null ? '' : `, ${plural(ocorrencias, 'ocorrência', 'ocorrências')}`;
    return `${base} de origem "indisponivel"${cauda}.`;
}

/**
 * A ressalva sai SEMPRE, com zero inclusive, e é a única do resumo sobre uma boa notícia.
 *
 * O ZERO AQUI É O MAIS FÁCIL DE LER ERRADO: o relato dessa tela ENFILEIRA quando o servidor está
 * fora (está fora por definição) e só chega na próxima carga bem-sucedida da página, então uma
 * queda EM CURSO ainda não chegou.
 * @returns {string}
 */
export function indisponivelRessalva() {
    return 'Zero aqui NÃO prova disponibilidade: o relato dessa tela é enfileirado no cliente e só '
        + 'chega na próxima carga bem-sucedida. Lido ao lado da Saúde, ele desambigua o buraco na '
        + 'série: buraco COM relato é queda, buraco SEM relato é, mais provavelmente, o log em '
        + 'arquivo tendo se desligado.';
}

// ===== bloco 5: pulso resumido =====

/** @returns {string} */
export function statusVazioNotice() {
    return 'Nenhuma requisição registrada na janela.';
}

/**
 * O total do pulso resumido sob TRUNCAMENTO, e o fato aqui é OUTRO.
 *
 * NÃO É A FRASE DO DELTA, e reusá-la seria dizer a coisa errada com convicção: lá o problema é a
 * BASE de comparação (o anel come a janela anterior e o delta fica sem contra o quê medir), e aqui
 * o problema é o PRÓPRIO número, que sai menor do que foi porque as requisições mais antigas do
 * período não entraram na conta. Quem lê "156 requisições" precisa saber que 156 é um piso, e não
 * um total, senão a comparação com ontem é entre um total e um pedaço.
 * @returns {string}
 */
export function totalTruncadoNotice() {
    return 'A leitura foi truncada: as requisições mais ANTIGAS do período ficaram de fora, então '
        + 'estes números são um PISO e não o total da janela. Estreite a janela para alcançar o '
        + 'começo dela.';
}

/** @returns {string} */
export function statusDetalheNotice() {
    return 'A distribuição por faixa está no Pulso de requisições, logo abaixo.';
}

// ===== utilitários locais =====

/** @param {*} v @returns {number|null} */
function numeroOuNulo(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** @param {number} n @returns {string} */
function numero(n) {
    return FORMATADOR_DE_NUMERO.format(Math.round(n));
}

/**
 * "1 defeito" / "0 defeitos" / "12 defeitos". O ZERO VAI NO PLURAL, que é o português correto e o
 * que o singular estragaria justamente no desfecho mais comum de uma tela saudável.
 * @param {number} n @param {string} um @param {string} varios
 * @returns {string}
 */
function plural(n, um, varios) {
    return `${numero(n)} ${Math.round(Math.abs(n)) === 1 ? um : varios}`;
}

/** @param {number} pct @returns {string} */
function porcentagem(pct) {
    const texto = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
    return `${texto.replace('.', ',')}%`;
}

/** @param {string} texto @returns {string} */
function capitalizar(texto) {
    return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}
