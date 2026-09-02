// Path: js/admin/defeito-phrases.js

/**
 * @fileoverview O que a seção "Defeitos" da aba Diagnóstico DIZ, e como ela decide o que
 * desenhar, em funções puras testáveis em node. ZERO IMPORTS, como os irmãos
 * (`diag-phrases.js`, `grant-phrases.js`, `catalog-delete-phrases.js`): `admin.html` boota sem a
 * store, e um import daqui a arrastaria de volta pelo caminho transitivo.
 *
 * O DEFEITO É UMA ENTIDADE COM CICLO DE VIDA, e é isso que separa esta seção das duas que ela
 * substituiu. Até 2026-09-01 a aba tinha uma lista de erros do SERVIDOR (varredura do arquivo de
 * log) e outra de erros do NAVEGADOR (tabela), lado a lado, e o mesmo defeito visto pelas duas
 * portas aparecia duas vezes sem que nada as ligasse. Pior: nenhuma das duas tinha estado, então
 * um defeito consertado continuava na tela com a mesma cara de um que ninguém olhou, e a única
 * forma de "resolver" era esperar a janela passar por cima dele. O que substitui as duas é
 * `GET /diag/defeitos`, que é uma tabela só (`origem = 'servidor'` é o filtro que isola o que o
 * backend registrou sobre si) e carrega `estado`, quem resolveu, em que release e em que commit.
 *
 * A VARREDURA DO LOG NÃO SUMIU, ELA SAIU DA TELA: `npm run diag -- erros` continua lendo o
 * arquivo, com os endereços agregados por assinatura que a lista de servidor mostrava. Quem diz
 * isso na tela é `escopoNotice`, em uma linha, porque uma seção que desaparece sem explicação se
 * lê como funcionalidade perdida.
 *
 * ─── AS DUAS PALAVRAS "NOVO", QUE NÃO SIGNIFICAM A MESMA COISA ───
 *
 * Esta é a confusão que a seção inteira precisa não cometer, porque as duas contas convivem na
 * mesma tela:
 *
 *  - o FILTRO "só novos" (`?novos=1`) recorta pela JANELA: o servidor compara `primeira_em` com o
 *    começo do período consultado. Trocar a janela muda o conjunto;
 *  - o SELO "novo" de cada linha compara `primeiraEm` com a MARCA DA ÚLTIMA VISITA desta pessoa,
 *    que mora no `localStorage` do navegador dela. Trocar a janela não muda nada, e a marca é
 *    pessoal: dois administradores lendo a mesma lista veem selos diferentes, e isso é o certo.
 *
 * Elas coincidem com frequência, e é justamente isso que torna a confusão barata de cometer e
 * cara de ver. `filtroNovosHint` e `novoChipTitulo` nomeiam cada uma pelo que ela é.
 *
 * ─── O NÚMERO DE OCORRÊNCIAS CONTINUA SENDO VITALÍCIO ───
 *
 * `defeitos.ocorrencias` é um contador que o upsert incrementa desde a primeira vez que a
 * assinatura apareceu, e nada o zera, enquanto a janela filtra `ultima_em`. Ele também conta
 * RELATO e não ocorrência, porque o cliente deduplica uma assinatura por sessão. As duas metades
 * dessa honestidade foram compradas caro na lista anterior e continuam valendo aqui: ver
 * `contagemNotice`, e o crachá segue nomeado por `contagemHistoricaUnidade` (`diag-phrases.js`).
 *
 * ─── O INSTANTE CHEGA EM EPOCH MS, E ESTE ARQUIVO NÃO O PARSEIA ───
 *
 * Toda data do payload de `/diag/defeitos` é epoch ms (`primeiraEm`, `ultimaEm`, `resolvidoEm`,
 * `em` da ocorrência, `t` da migalha). `tempoRelativo` recebe NÚMEROS e devolve vazio para
 * qualquer outra coisa; a leitura tolerante das três formas em que uma data pode chegar é
 * `instanteDe` (`./instante.js`), e a formatação absoluta é `horaLocal`/`horaLocalCompleta`
 * (`diag-phrases.js`). Uma segunda cópia de qualquer uma das duas aqui divergiria da primeira no
 * dia em que alguém consertasse um ramo, com as duas suítes verdes: onde uma frase daqui precisa
 * de data escrita, ela RECEBE o texto já formatado (é o mesmo arranjo de `extensionSummary`, em
 * `grant-phrases.js`).
 *
 * TODO TEXTO DAQUI SAI PARA A TELA POR `textContent`. Mensagem, pilha, user agent, URL e migalha
 * vêm do navegador de quem visita a página pública: é texto arbitrário de terceiro, e este
 * arquivo não monta uma linha de HTML.
 */

// ===== o ciclo de vida =====

/**
 * Os quatro estados de `defeitos.estado`.
 *
 * ELES SÃO O ESPELHO DE `backend/src/modules/diag/estados-de-defeito.js`, que por sua vez espelha
 * o CHECK da migração `018_defeitos_e_ocorrencias.sql`. A cópia está declarada aqui em voz alta
 * porque não há import possível entre os dois pacotes; o dia em que um valor novo nascer, ele
 * entra nos três, e o sintoma de esquecer este é o mais suave dos três (o chip cai em
 * `desconhecido` e a linha continua legível), o que é deliberado: falhar aberto numa tela de
 * leitura é melhor que sumir com a linha.
 * @type {Readonly<Object<string, string>>}
 */
export const ESTADO_DE_DEFEITO = Object.freeze({
    ABERTO: 'aberto',
    RESOLVIDO: 'resolvido',
    IGNORADO: 'ignorado',
    REGREDIU: 'regrediu',
});

/**
 * Os quatro, na ordem do ciclo de vida (nasce, os dois desfechos humanos, o que só a máquina
 * escreve), com o rótulo e o tom que a folha de estilo usa.
 *
 * A ORDEM NÃO É ALFABÉTICA de propósito, e é a mesma do espelho do servidor: alfabética faria um
 * leitor procurar significado na vizinhança e não achar nenhum.
 * @type {ReadonlyArray<{valor: string, rotulo: string, tom: string, descricao: string}>}
 */
export const ESTADOS = Object.freeze([
    Object.freeze({
        valor: ESTADO_DE_DEFEITO.ABERTO,
        rotulo: 'Aberto',
        tom: 'aberto',
        descricao: 'Nasceu e ninguém decidiu nada sobre ele.',
    }),
    Object.freeze({
        valor: ESTADO_DE_DEFEITO.RESOLVIDO,
        rotulo: 'Resolvido',
        tom: 'resolvido',
        descricao: 'Alguém afirmou que consertou. Se voltar a ocorrer numa release diferente '
            + 'daquela do conserto, o servidor o marca como regressão sozinho.',
    }),
    Object.freeze({
        valor: ESTADO_DE_DEFEITO.IGNORADO,
        rotulo: 'Ignorado',
        tom: 'ignorado',
        descricao: 'Alguém afirmou que NÃO vai consertar. É o único estado que nada move: '
            + 'ocorrência nova não o reabre, senão ignorar não calaria ruído nenhum.',
    }),
    Object.freeze({
        valor: ESTADO_DE_DEFEITO.REGREDIU,
        rotulo: 'Regrediu',
        tom: 'regrediu',
        descricao: 'Estava resolvido e voltou a ocorrer numa release diferente daquela em que '
            + 'foi resolvido. É a única transição automática do produto.',
    }),
]);

/**
 * O rótulo de um estado. Estado que este build não conhece sai por ele mesmo, e não como
 * travessão: um valor que o servidor inventou depois deste build ainda localiza a linha, e
 * apagá-lo esconderia justamente a novidade.
 * @param {*} estado
 * @returns {string}
 */
export function estadoLabel(estado) {
    const achado = ESTADOS.find((e) => e.valor === estado);
    if (achado) return achado.rotulo;
    const texto = typeof estado === 'string' ? estado.trim() : '';
    return texto || 'Sem estado';
}

/**
 * O tom do chip, para a folha de estilo.
 *
 * O DESCONHECIDO TEM TOM PRÓPRIO, pela mesma razão de `faixaEstado` e `estadoDaLatencia`
 * (`diag-phrases.js`): pintar de verde um estado que ninguém classificou afirmaria conserto sobre
 * um valor que este build não entende.
 * @param {*} estado
 * @returns {string}
 */
export function estadoTom(estado) {
    const achado = ESTADOS.find((e) => e.valor === estado);
    return achado ? achado.tom : 'desconhecido';
}

/**
 * O que o estado significa, para o `title` do chip.
 * @param {*} estado
 * @returns {string}
 */
export function estadoDescricao(estado) {
    const achado = ESTADOS.find((e) => e.valor === estado);
    return achado ? achado.descricao : 'Estado que esta versão da tela não conhece.';
}

/**
 * Os três atos que a tela oferece.
 * @type {Readonly<Object<string, string>>}
 */
export const ACAO = Object.freeze({
    RESOLVER: 'resolver',
    IGNORAR: 'ignorar',
    REABRIR: 'reabrir',
});

/**
 * Cada ato, com o rótulo, o estado que ele pede ao servidor e a frase do voo.
 *
 * `estadoAlvo` É O CONTRATO COM O `PATCH`, e é por isso que ele mora ao lado do rótulo: o corpo
 * da requisição é `{ estado }`, e escrever a string no sítio do clique é o erro de digitação que
 * o CHECK do banco só acusa em produção, dentro do caminho que existe para registrar falhas.
 * @type {ReadonlyArray<{valor: string, rotulo: string, estadoAlvo: string, emVoo: string}>}
 */
export const ACOES = Object.freeze([
    Object.freeze({
        valor: ACAO.RESOLVER,
        rotulo: 'Resolver',
        estadoAlvo: ESTADO_DE_DEFEITO.RESOLVIDO,
        emVoo: 'Marcando como resolvido…',
    }),
    Object.freeze({
        valor: ACAO.IGNORAR,
        rotulo: 'Ignorar',
        estadoAlvo: ESTADO_DE_DEFEITO.IGNORADO,
        emVoo: 'Marcando como ignorado…',
    }),
    Object.freeze({
        valor: ACAO.REABRIR,
        rotulo: 'Reabrir',
        estadoAlvo: ESTADO_DE_DEFEITO.ABERTO,
        emVoo: 'Reabrindo…',
    }),
]);

/**
 * Os atos que uma linha naquele estado desenha.
 *
 * A LISTA É POR ESTADO E NÃO POR PAPEL, e essa distinção decide a afordância: a aba inteira é do
 * administrador global (`ABAS_DO_ADMINISTRADOR`), então não existe aqui bloqueio por POSTO a
 * desenhar. O que existe é o ato que não faz sentido naquele estado (resolver o que já está
 * resolvido), e ele simplesmente não é oferecido.
 *
 * `regrediu` OFERECE OS MESMOS DOIS DE `aberto`, e é a leitura certa: uma regressão é um defeito
 * aberto de novo, com história. `ignorado` e `resolvido` oferecem só o retorno, porque o caminho
 * de volta é o mesmo dos dois.
 *
 * Estado desconhecido devolve LISTA VAZIA em vez de todos os atos: oferecer transição a partir de
 * um estado que este build não entende é convidar a escrever por cima de um ciclo de vida novo.
 * @param {*} estado
 * @returns {ReadonlyArray<string>}
 */
export function acoesDoEstado(estado) {
    switch (estado) {
        case ESTADO_DE_DEFEITO.ABERTO:
        case ESTADO_DE_DEFEITO.REGREDIU:
            return Object.freeze([ACAO.RESOLVER, ACAO.IGNORAR]);
        case ESTADO_DE_DEFEITO.RESOLVIDO:
        case ESTADO_DE_DEFEITO.IGNORADO:
            return Object.freeze([ACAO.REABRIR]);
        default:
            return Object.freeze([]);
    }
}

/** @param {*} acao @returns {string} */
export function acaoLabel(acao) {
    const achado = ACOES.find((a) => a.valor === acao);
    return achado ? achado.rotulo : '';
}

/**
 * O estado que o `PATCH` deve pedir, ou `null` para um ato que não existe.
 * @param {*} acao
 * @returns {string|null}
 */
export function estadoAlvoDaAcao(acao) {
    const achado = ACOES.find((a) => a.valor === acao);
    return achado ? achado.estadoAlvo : null;
}

/**
 * A frase do botão enquanto a requisição está em voo.
 *
 * ELA É O TEXTO DO `aria-disabled`, e não de um `disabled`. Botão desabilitado não dispara clique,
 * e o clique é como o motivo chega à pessoa (convenção da casa, §UI Architecture). Aqui o bloqueio
 * é de ESTADO (há um pedido em voo, e ele termina), então o comando continua desenhado e recusa
 * nomeando o estado.
 * @param {*} acao
 * @returns {string}
 */
export function acaoEmVooLabel(acao) {
    const achado = ACOES.find((a) => a.valor === acao);
    return achado ? achado.emVoo : 'Enviando…';
}

/** @returns {string} */
export function acaoEmVooNotice() {
    return 'Há um pedido em voo para este defeito. Espere a resposta: o número e o estado que a '
        + 'linha vai mostrar são os que o servidor devolver, não os que o clique pediu.';
}

/**
 * O que o toast diz depois de o servidor responder.
 *
 * ELE LÊ O ITEM DA RESPOSTA, NUNCA O PEDIDO, e essa é a regra que une os módulos de frase desta
 * casa: o número (e aqui o estado) que a frase diz tem de ser o que o servidor mandou. Um botão
 * que pedisse "resolvido" e anunciasse "resolvido" sem olhar a resposta anunciaria o pedido, e o
 * servidor tem a última palavra sobre a transição.
 * @param {Object} [item] - O defeito devolvido pelo `PATCH`.
 * @returns {string}
 */
export function acaoSucessoNotice(item) {
    const estado = item?.estado;
    const rotulo = estadoLabel(estado).toLowerCase();
    const release = releaseLabel(item?.resolvidoNaRelease);
    const commit = typeof item?.resolvidoNoCommit === 'string' ? item.resolvidoNoCommit.trim() : '';
    if (estado === ESTADO_DE_DEFEITO.RESOLVIDO) {
        const onde = release ? ` na release ${release}` : '';
        const qual = commit ? `, commit ${commit}` : '';
        return `Defeito marcado como resolvido${onde}${qual}.`;
    }
    return `Defeito marcado como ${rotulo}.`;
}

/** @param {*} acao @returns {string} */
export function acaoFalhaNotice(acao) {
    const rotulo = acaoLabel(acao);
    return rotulo
        ? `Não foi possível ${rotulo.toLowerCase()} este defeito.`
        : 'Não foi possível mudar o estado deste defeito.';
}

/**
 * O rótulo do campo de commit, que é opcional de propósito.
 *
 * O COMMIT É A ÚNICA COISA QUE O `PATCH` ACEITA ALÉM DO ESTADO, e ele não pode ser obrigatório:
 * resolver sem saber o hash (um conserto de configuração, um defeito de terceiro que sumiu) é
 * desfecho legítimo, e exigir o campo faria a pessoa inventar um valor para atravessar o
 * formulário, que é pior que o campo vazio.
 * @returns {string}
 */
export function commitLabel() {
    return 'Commit do conserto (opcional)';
}

/** @returns {string} */
export function commitPlaceholder() {
    return 'ex.: 680bb69';
}

/**
 * Por que anotar o commit compra alguma coisa.
 * @returns {string}
 */
export function commitHint() {
    return 'A release do conserto o servidor carimba sozinho, e é ela que decide a regressão. O '
        + 'commit é para quem for ler esta linha depois achar o que mudou.';
}

/** @returns {string} */
export function confirmarLabel() {
    return 'Confirmar';
}

/** @returns {string} */
export function cancelarLabel() {
    return 'Cancelar';
}

// ===== o vocabulário de origem e de página =====

/**
 * As onze origens, na ordem do espelho do servidor (`backend/src/modules/diag/origens-de-erro.js`)
 * e do CHECK.
 *
 * A DÉCIMA PRIMEIRA QUEBRA A REGRA DAS DEZ PRIMEIRAS, e a tela precisa dizer isso: as dez dizem
 * por qual porta o erro entrou no coletor DO NAVEGADOR, e `servidor` diz que não houve navegador
 * nenhum. É por isso que ela é o filtro que separa as duas metades do produto nesta lista.
 * @type {ReadonlyArray<{valor: string, rotulo: string}>}
 */
export const ORIGENS = Object.freeze([
    Object.freeze({ valor: 'boot', rotulo: 'Boot' }),
    Object.freeze({ valor: 'nao-tratado', rotulo: 'Não tratado' }),
    Object.freeze({ valor: 'rejeicao', rotulo: 'Rejeição' }),
    Object.freeze({ valor: 'console', rotulo: 'Console' }),
    Object.freeze({ valor: 'store', rotulo: 'Store' }),
    Object.freeze({ valor: 'ws', rotulo: 'Colaboração' }),
    Object.freeze({ valor: 'maplibre', rotulo: 'Mapa 2D' }),
    Object.freeze({ valor: 'cesium', rotulo: '3D' }),
    Object.freeze({ valor: 'sv360', rotulo: '360' }),
    Object.freeze({ valor: 'indisponivel', rotulo: 'Indisponível' }),
    Object.freeze({ valor: 'servidor', rotulo: 'Servidor' }),
]);

/**
 * O rótulo de uma origem.
 *
 * A AUSÊNCIA TEM NOME PRÓPRIO, e não é travessão: a esmagadora maioria das linhas antigas tem
 * `origem` nula porque o cliente não declarava o campo, e chamar isso de "sem dado" faria a
 * coluna parecer quebrada na maior parte da tabela. Origem que este build não conhece sai por ela
 * mesma, para que a novidade apareça em vez de sumir.
 * @param {*} origem
 * @returns {string}
 */
export function origemLabel(origem) {
    const achado = ORIGENS.find((o) => o.valor === origem);
    if (achado) return achado.rotulo;
    const texto = typeof origem === 'string' ? origem.trim() : '';
    return texto || 'Não declarada';
}

/**
 * As quatro páginas do produto, como o filtro as oferece.
 *
 * SÃO QUATRO PORQUE O APP TEM QUATRO, e a lista é a mesma de `rollupOptions.input`. O campo
 * `pagina` do relato é texto livre (o cliente o preenche), então o filtro é uma CONVENIÊNCIA
 * sobre os valores esperados e nunca uma promessa de completude: uma página que o cliente
 * declare com outro nome continua na lista sem filtro, e é por isso que o seletor não tenta
 * derivar as opções do payload.
 * @type {ReadonlyArray<{valor: string, rotulo: string}>}
 */
export const PAGINAS = Object.freeze([
    Object.freeze({ valor: 'index.html', rotulo: 'Mapa' }),
    Object.freeze({ valor: 'atlas.html', rotulo: 'Seus atlas' }),
    Object.freeze({ valor: 'admin.html', rotulo: 'Administração' }),
    Object.freeze({ valor: 'calibracao.html', rotulo: 'Calibração 360' }),
]);

// ===== os filtros =====

/** O valor do "todos" nos seletores. String vazia porque é o que um `<select>` devolve. */
export const FILTRO_TODOS = '';

/** @returns {string} */
export function filtroEstadoLabel() {
    return 'Estado';
}

/** @returns {string} */
export function filtroEstadoTodos() {
    return 'Todos os estados';
}

/** @returns {string} */
export function filtroOrigemLabel() {
    return 'Origem';
}

/** @returns {string} */
export function filtroOrigemTodas() {
    return 'Todas as origens';
}

/** @returns {string} */
export function filtroReleaseLabel() {
    return 'Release';
}

/** @returns {string} */
export function filtroReleasePlaceholder() {
    return 'exata, como no payload';
}

/** @returns {string} */
export function filtroPaginaLabel() {
    return 'Página';
}

/** @returns {string} */
export function filtroPaginaTodas() {
    return 'Todas as páginas';
}

/** @returns {string} */
export function filtroNovosLabel() {
    return 'Só os que nasceram na janela';
}

/**
 * A distinção entre as duas palavras "novo" desta tela. Ver o `@fileoverview`.
 * @returns {string}
 */
export function filtroNovosHint() {
    return 'Este recorte é da JANELA (a primeira ocorrência caiu dentro dela). O selo "novo" de '
        + 'cada linha é outra conta: ele compara com a sua última visita a esta aba.';
}

/**
 * O filtro de release é EXATO, e a tela precisa dizer isso.
 *
 * O servidor compara `release = $4`, sem `ILIKE` e sem prefixo. Como a release do cliente é
 * `versao+hash` (`versaoDoBuild`, em `session/erro-telemetria.js`), digitar só a versão devolve
 * ZERO linhas, e zero linhas com filtro preenchido se lê como "não há defeito nessa versão".
 * @returns {string}
 */
export function filtroReleaseHint() {
    return 'A comparação é exata: a release do cliente é "versão+hash", então a versão sozinha '
        + 'não casa com nada.';
}

/**
 * A recusa do seletor de janela enquanto a leitura está em voo.
 *
 * ELE ERA `disabled`, e a troca é a convenção da casa: bloqueio REVERSÍVEL desenha o comando e
 * recusa o gesto NOMEANDO o estado, porque um controle desabilitado não dispara evento nenhum e a
 * pessoa fica sem saber por que o clique não fez nada. Aqui o estado dura o tempo de uma
 * requisição, e é justamente por ser curto que o silêncio se lê como tela travada.
 * @returns {string}
 */
export function janelaEmVooNotice() {
    return 'A aba ainda está lendo o servidor. Espere a resposta antes de trocar a janela: o que '
        + 'está na tela é do recorte anterior.';
}

// ===== o tempo relativo =====

const MINUTO = 60_000;
const HORA = 3_600_000;
const DIA = 86_400_000;

/**
 * O desencontro banal entre o relógio do servidor e o do navegador, tolerado em toda comparação
 * entre um instante que veio do servidor e o `Date.now()` daqui. Ver `tempoRelativo` e `ehNovo`.
 */
const FOLGA_DE_RELOGIO = MINUTO;

/**
 * "há 5 minutos" a partir de dois instantes em EPOCH MS.
 *
 * POR QUE RELATIVO NA COLUNA E ABSOLUTO NO `title`: a pergunta da coluna é "isto ainda está
 * acontecendo?", e a resposta é uma distância, não uma data. Correlacionar com o log do servidor
 * exige o absoluto com segundos, e esse continua alcançável (`horaLocalCompleta`), sem gastar a
 * largura da linha.
 *
 * A DATA NO FUTURO É DITA, e não arredondada para "agora mesmo": ela significa relógio de cliente
 * adiantado, que é informação de diagnóstico, e escondê-la faria a linha parecer normal. A folga
 * de um minuto absorve o desencontro banal entre o relógio do servidor e o do navegador.
 *
 * AS FRONTEIRAS SÃO 60 MINUTOS E 24 HORAS, e não 90 e 36 como a primeira versão: com as maiores,
 * o singular de hora e o de dia ficavam INALCANÇÁVEIS (o arredondamento de 90 minutos já dá duas
 * horas, e o de 36 horas já dá dois dias), ou seja, dois ramos de concordância que nenhum valor
 * de entrada exercitava. Quem achou foi o teste, ao cobrar "há 1 hora" e receber "há 60 minutos".
 *
 * Recebe NÚMEROS e nada mais: ver o `@fileoverview` sobre por que este arquivo não parseia data.
 * @param {*} quandoMs
 * @param {*} agoraMs
 * @returns {string} Vazio quando qualquer das duas pontas não é número finito.
 */
export function tempoRelativo(quandoMs, agoraMs) {
    if (!Number.isFinite(quandoMs) || !Number.isFinite(agoraMs)) return '';
    const delta = agoraMs - quandoMs;
    if (delta < -FOLGA_DE_RELOGIO) return 'com data no futuro';
    if (delta < 45_000) return 'agora mesmo';
    if (delta < 60 * MINUTO) {
        const n = Math.round(delta / MINUTO);
        return n === 1 ? 'há 1 minuto' : `há ${n} minutos`;
    }
    if (delta < 24 * HORA) {
        const n = Math.round(delta / HORA);
        return n === 1 ? 'há 1 hora' : `há ${n} horas`;
    }
    const n = Math.round(delta / DIA);
    return n === 1 ? 'há 1 dia' : `há ${n} dias`;
}

// ===== a ordem da lista =====

/** @param {*} v @returns {number} */
function numeroOuZero(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Os defeitos, do mais RECENTE para o mais antigo.
 *
 * A ORDEM É A MESMA PELA QUAL O SERVIDOR CORTA, e essa coincidência é a regra, não um detalhe.
 * `LIST_DEFEITOS` faz `ORDER BY d.ultima_em DESC LIMIT $7`: reordenar a lista aqui por
 * `ocorrencias` desenharia um pódio que se lê como "os defeitos que mais dóem" e é, na verdade,
 * "os mais frequentes de sempre entre os cinquenta que dispararam por último". O defeito de
 * número cinquenta e um, com o dobro da contagem do primeiro, nem estava na amostra. É a mesma
 * correção que a lista de erros de navegador pagou em 2026-09-01, e ela vale aqui pelos mesmos
 * dois motivos: a contagem é vitalícia (não fala da janela) e o corte é por recência.
 *
 * O desempate é pela contagem e depois pelo id, para que duas leituras da mesma lista desenhem a
 * mesma ordem.
 * @param {*} itens
 * @returns {Array<Object>}
 */
export function ordenarDefeitos(itens) {
    if (!Array.isArray(itens)) return [];
    return [...itens].sort((a, b) => numeroOuZero(b?.ultimaEm) - numeroOuZero(a?.ultimaEm)
        || numeroOuZero(b?.ocorrencias) - numeroOuZero(a?.ocorrencias)
        || String(a?.id ?? '').localeCompare(String(b?.id ?? '')));
}

// ===== o que é novo desde a última visita =====

/**
 * Se este defeito nasceu depois da marca da última visita.
 *
 * SEM MARCA, NADA É NOVO, e falhar assim é a decisão: a primeira visita de uma pessoa (ou um
 * `localStorage` limpo, ou um navegador que o recuse) marcaria a lista INTEIRA como novidade, que
 * é o alarme que ensina a ignorar alarme. Quem diz que a marca falta é `primeiraVisitaNotice`.
 * A FOLGA DE UM MINUTO É A MESMA DE `tempoRelativo`, e pelo mesmo motivo: `primeiraEm` vem do
 * relógio do SERVIDOR e a marca vem do `Date.now()` do NAVEGADOR, então um desencontro banal
 * entre os dois faria a linha que a pessoa acabou de ler reaparecer marcada como novidade na
 * visita seguinte. Ela erra para o lado de NÃO marcar, que é o mesmo lado da marca ausente.
 * @param {Object} [item]
 * @param {*} marcaMs
 * @returns {boolean}
 */
export function ehNovo(item, marcaMs) {
    if (!Number.isFinite(marcaMs)) return false;
    const nasceu = item?.primeiraEm;
    return Number.isFinite(nasceu) && nasceu > marcaMs + FOLGA_DE_RELOGIO;
}

/**
 * Quantos da lista nasceram depois da marca.
 * @param {*} itens
 * @param {*} marcaMs
 * @returns {number}
 */
export function contarNovos(itens, marcaMs) {
    if (!Array.isArray(itens)) return 0;
    return itens.filter((i) => ehNovo(i, marcaMs)).length;
}

/** @returns {string} */
export function novoChipLabel() {
    return 'novo';
}

/**
 * O `title` do selo, que é onde a segunda palavra "novo" se distingue da primeira.
 * @param {string} [quando] - A marca da última visita, já formatada por quem chama.
 * @returns {string}
 */
export function novoChipTitulo(quando) {
    const onde = quando ? ` (${quando})` : '';
    return `Apareceu pela primeira vez depois da sua última visita a esta aba${onde}. É uma marca `
        + 'do seu navegador, e não um estado do defeito: outro administrador vê outra coisa.';
}

/**
 * A linha que conta quantos são novos desde a última visita.
 *
 * ZERO TEM FRASE PRÓPRIA, e ela não é silêncio: "nenhum defeito novo desde a sua última visita" é
 * a boa notícia que a pessoa veio buscar, e calar faria a ausência do selo parecer marca que não
 * carregou.
 * @param {*} quantos
 * @param {string} [quando] - A marca, já formatada.
 * @returns {string}
 */
export function novosDesdeNotice(quantos, quando) {
    if (!Number.isFinite(quantos) || quantos < 0) return '';
    const desde = quando ? ` desde a sua última visita, em ${quando}` : ' desde a sua última visita';
    if (quantos === 0) return `Nenhum defeito novo${desde}.`;
    if (quantos === 1) return `1 defeito apareceu pela primeira vez${desde}.`;
    return `${quantos} defeitos apareceram pela primeira vez${desde}.`;
}

/** @returns {string} */
export function primeiraVisitaNotice() {
    return 'Esta é a primeira visita registrada neste navegador, então nada aqui está marcado '
        + 'como novo. A marca é local e pessoal: limpar os dados do navegador a apaga.';
}

// ===== a saúde por release =====

/** Quantas releases o cartão do topo mostra. */
export const TETO_DE_RELEASES = 3;

/**
 * As releases mais recentes vistas na LISTA CARREGADA, com quantos defeitos nasceram em cada uma
 * e quantos regrediram.
 *
 * ELA É DERIVADA NO CLIENTE, e o alcance dela é exatamente o da lista que está na tela: a janela,
 * os filtros e o teto da consulta. Isso não é aproximação de um número que existe em algum lugar,
 * é uma conta diferente, e `saudeNotice` diz isso em voz alta. Pedir ao servidor um resumo por
 * release seria outra rota; enquanto ela não existe, a alternativa recusada é pior que a conta
 * limitada: um cartão que se apresentasse como "a saúde das releases" mentiria sobre o alcance.
 *
 * "NOVOS" É `primeiraRelease`, e não `ultimaRelease`: a pergunta do cartão é "o que esta build
 * trouxe", e um defeito que nasceu três builds atrás e continua ocorrendo não é novidade desta.
 * As duas colunas contam coisas independentes, então um defeito pode entrar nas duas.
 *
 * A ORDEM É POR AVISTAMENTO MAIS RECENTE, e não alfabética nem por nome de versão: nome de
 * release não é ordenável (é `versao+hash`), e a única ordem que o payload sustenta é a do
 * relógio.
 * @param {*} itens
 * @param {{limite?: number}} [opts]
 * @returns {Array<{release: string, defeitos: number, novos: number, regressoes: number,
 *   ultimaEm: number}>}
 */
export function saudeDasReleases(itens, { limite = TETO_DE_RELEASES } = {}) {
    if (!Array.isArray(itens)) return [];
    const porRelease = new Map();
    for (const item of itens) {
        const release = typeof item?.ultimaRelease === 'string' ? item.ultimaRelease.trim() : '';
        if (!release) continue;
        const atual = porRelease.get(release) ?? {
            release, defeitos: 0, novos: 0, regressoes: 0, ultimaEm: 0,
        };
        atual.defeitos += 1;
        const nasceuAqui = typeof item?.primeiraRelease === 'string'
            && item.primeiraRelease.trim() === release;
        if (nasceuAqui) atual.novos += 1;
        if (item?.estado === ESTADO_DE_DEFEITO.REGREDIU) atual.regressoes += 1;
        atual.ultimaEm = Math.max(atual.ultimaEm, numeroOuZero(item?.ultimaEm));
        porRelease.set(release, atual);
    }
    const teto = Number.isFinite(limite) && limite > 0 ? Math.floor(limite) : TETO_DE_RELEASES;
    return [...porRelease.values()]
        .sort((a, b) => b.ultimaEm - a.ultimaEm || a.release.localeCompare(b.release))
        .slice(0, teto);
}

/**
 * Os três números que cada release mostra no cartão, com o rótulo e o que ele significa.
 *
 * "NASCIDOS AQUI" E NÃO "NOVOS", e a palavra saiu de propósito: esta tela já carrega DUAS contas
 * chamadas "novo" (o filtro, que é da janela, e o selo da linha, que é da última visita desta
 * pessoa), e o cartão introduzia uma TERCEIRA, que é da BUILD. Três sentidos para a mesma palavra
 * na mesma tela é o tipo de ambiguidade que ninguém percebe estar cometendo: a pessoa lê o número
 * do cartão como se fosse a contagem do selo. O rótulo que não repete a palavra resolve sem nota
 * de rodapé, e o `titulo` diz a conta inteira para quem parar em cima.
 *
 * O `campo` é a chave do objeto que `saudeDasReleases` devolve, e é ele que amarra rótulo e
 * número: sem isso a tela escreveria os três literais na ordem certa e ninguém notaria a troca de
 * dois deles.
 * @type {ReadonlyArray<{campo: string, rotulo: string, titulo: string}>}
 */
export const NUMEROS_DA_SAUDE = Object.freeze([
    Object.freeze({
        campo: 'novos',
        rotulo: 'nascidos aqui',
        titulo: 'Defeitos cuja PRIMEIRA ocorrência foi vista nesta release. É outra conta de '
            + '"novo": o filtro acima é da janela, o selo de cada linha é da sua última visita, e '
            + 'este é da build.',
    }),
    Object.freeze({
        campo: 'regressoes',
        rotulo: 'regressões',
        titulo: 'Defeitos desta release que estavam resolvidos e voltaram a ocorrer numa build '
            + 'diferente daquela em que foram consertados.',
    }),
    Object.freeze({
        campo: 'defeitos',
        rotulo: 'defeitos',
        titulo: 'Todos os defeitos da lista carregada cuja última ocorrência foi vista nesta '
            + 'release.',
    }),
]);

// ----- a saúde por release VINDA DO SERVIDOR -----

/**
 * De ONDE o cartão de saúde tirou os números desta carga.
 *
 * SÃO TRÊS E NÃO DOIS, e o terceiro é o que a primeira versão colapsava. Ela tinha um booleano,
 * então "o pulso foi recusado", "este servidor não manda o bloco" e "o servidor mandou o bloco
 * como `null` porque o banco não respondeu" caíam todos no mesmo `false`, e a frase acusava
 * VERSÃO ANTERIOR nos três. Duas dessas três são falhas de AGORA, e mandar o administrador
 * atualizar o servidor por causa de um banco que não respondeu é a mesma classe de erro que a
 * aba Uso paga em `HORIZONTE.DESCONHECIDO`: afirmar causa que não se sabe.
 * @type {Readonly<Object<string, string>>}
 */
export const FONTE_DA_SAUDE = Object.freeze({
    /** O servidor respondeu a lista: é ela que está na tela. */
    SERVIDOR: 'servidor',
    /** O campo não veio. É o que um servidor de versão anterior faz. */
    AUSENTE: 'ausente',
    /** O pulso falhou, ou o servidor mandou o bloco como nulo (o banco dele não respondeu). */
    INDISPONIVEL: 'indisponivel',
});

/**
 * O desfecho da leitura do resumo por release.
 *
 * A ORDEM DOS RAMOS É O CONTRATO, e é a mesma de `estadoDoHorizonte` na aba irmã: a falha da
 * REQUISIÇÃO vem antes de tudo, depois o `null` explícito (que é o servidor dizendo que não
 * conseguiu montar a lista), depois o campo AUSENTE, e só então o formato. Um `releases` que não
 * seja lista nem `null` é uma resposta que esta tela não sabe ler, e ela é INDISPONÍVEL e nunca
 * vazia: desenhar "nenhuma release" sobre um servidor que respondeu outra coisa é a afirmação
 * mais perigosa que uma tela de medição pode fazer.
 * @param {Object} [entrada]
 * @param {boolean} [entrada.pulsoFalhou] - A leitura de `/diag/status` foi recusada.
 * @param {*} [entrada.releases] - O campo, como o payload o trouxe.
 * @returns {string} Um valor de {@link FONTE_DA_SAUDE}.
 */
export function desfechoDaSaude({ pulsoFalhou = false, releases } = {}) {
    if (pulsoFalhou) return FONTE_DA_SAUDE.INDISPONIVEL;
    if (releases === null) return FONTE_DA_SAUDE.INDISPONIVEL;
    if (releases === undefined) return FONTE_DA_SAUDE.AUSENTE;
    return Array.isArray(releases) ? FONTE_DA_SAUDE.SERVIDOR : FONTE_DA_SAUDE.INDISPONIVEL;
}

/**
 * A saúde por release COMO O SERVIDOR A CONTA, normalizada e com a taxa derivada.
 *
 * ELA RESPONDE OUTRA PERGUNTA QUE {@link saudeDasReleases}, e é por isso que as duas coexistem em
 * vez de uma substituir a outra no código. A do cliente conta DEFEITOS sobre a lista carregada (a
 * janela, os filtros e o teto da consulta); esta conta SESSÕES sobre o histórico do servidor, que
 * é o denominador que faltava: "sete defeitos novos" não diz nada sem saber se a release rodou em
 * setenta sessões ou em sete mil. A tela prefere esta quando ela existe e diz qual está mostrando
 * ({@link saudeFonteNotice}), porque as duas contas dão números diferentes sobre a mesma coisa e
 * uma tela que não diz qual delas está no ar é uma tela em que não se pode confiar.
 *
 * A TAXA É DERIVADA AQUI, e não pedida ao servidor: ela é uma divisão entre dois números que já
 * vieram, e um terceiro campo com o mesmo conteúdo é a oportunidade de os dois divergirem. Ela é
 * `null` quando não há sessão, e nunca zero — 0% de zero sessões é uma afirmação sobre o conjunto
 * vazio, a mesma armadilha que `percentualLabel` fecha na aba Uso.
 *
 * A ORDEM É A DO SERVIDOR, preservada: ele é quem sabe qual release é a mais recente, e reordenar
 * aqui por nome não funcionaria de qualquer forma (`versao+hash` não é ordenável).
 * @param {*} releases
 * @param {{limite?: number}} [opts]
 * @returns {Array<{release: string, sessoes: number, sessoesComErro: number, taxa: number|null,
 *   defeitosNovos: number, regressoes: number}>}
 */
export function saudeDoServidor(releases, { limite = TETO_DE_RELEASES } = {}) {
    if (!Array.isArray(releases)) return [];
    const teto = Number.isFinite(limite) && limite > 0 ? Math.floor(limite) : TETO_DE_RELEASES;
    return releases
        .filter((r) => r && typeof r === 'object' && typeof r.release === 'string'
            && r.release.trim() !== '')
        .map((r) => {
            const sessoes = numeroOuZero(r.sessoes);
            const comErro = numeroOuZero(r.sessoesComErro);
            return {
                release: r.release.trim(),
                sessoes,
                sessoesComErro: comErro,
                taxa: sessoes > 0 ? (comErro / sessoes) * 100 : null,
                defeitosNovos: numeroOuZero(r.defeitosNovos),
                regressoes: numeroOuZero(r.regressoes),
            };
        })
        .slice(0, teto);
}

/**
 * Os números que cada release mostra quando o SERVIDOR é a fonte.
 *
 * SÃO CINCO, E A ORDEM É DE LEITURA: o denominador primeiro (quantas sessões), depois o numerador
 * (quantas com erro), depois a razão entre os dois, e só então as duas contagens de defeito. Um
 * cartão que começasse pela taxa mostraria "100%" de uma release com uma sessão, que é o número
 * mais alarmante e menos informativo desta tela.
 *
 * O `campo` AMARRA RÓTULO E NÚMERO, como em {@link NUMEROS_DA_SAUDE}: com os cinco literais
 * escritos no desenho, trocar dois de lugar não ficaria vermelho em lugar nenhum.
 * @type {ReadonlyArray<{campo: string, rotulo: string, formato: string, titulo: string}>}
 */
export const NUMEROS_DA_SAUDE_DO_SERVIDOR = Object.freeze([
    Object.freeze({
        campo: 'sessoes',
        rotulo: 'sessões',
        formato: 'contagem',
        titulo: 'Abas que relataram uso enquanto esta build estava no ar. É o denominador de tudo '
            + 'o mais nesta linha.',
    }),
    Object.freeze({
        campo: 'sessoesComErro',
        rotulo: 'com erro',
        formato: 'contagem',
        titulo: 'Dessas sessões, as que capturaram ao menos um erro de navegador.',
    }),
    Object.freeze({
        campo: 'taxa',
        rotulo: 'taxa',
        formato: 'percentual',
        titulo: 'A fração das sessões desta build que viu ao menos um erro. Sem sessão não há '
            + 'fração, e a tela mostra um travessão em vez de 0%.',
    }),
    Object.freeze({
        campo: 'defeitosNovos',
        rotulo: 'nascidos aqui',
        formato: 'contagem',
        titulo: 'Defeitos cuja PRIMEIRA ocorrência foi vista nesta release. É outra conta de '
            + '"novo": o filtro acima é da janela, e o selo de cada linha é da sua última visita.',
    }),
    Object.freeze({
        campo: 'regressoes',
        rotulo: 'regressões',
        formato: 'contagem',
        titulo: 'Defeitos que estavam resolvidos e voltaram a ocorrer numa build diferente '
            + 'daquela em que foram consertados.',
    }),
]);

/**
 * A taxa de erro de uma release, em percentual pt-BR.
 *
 * ELA MORA AQUI E A CONTAGEM MORA EM `diag-phrases.js`, e a assimetria não é descuido: este
 * arquivo é ZERO IMPORTS por contrato, então importar `contagemLabel` para escrever uma única
 * função de despacho custaria a propriedade que mantém `admin.html` sem a store. O despacho por
 * `formato` fica no desenho, que já tem as duas à mão.
 *
 * TRAVESSÃO E NÃO "0%" QUANDO NÃO HÁ SESSÃO: sem denominador não há fração, e escrever zero por
 * cento sobre uma release que ninguém usou afirmaria saúde a partir de ausência de dado. É a mesma
 * regra de `percentualLabel` na aba Uso, repetida aqui porque os dois arquivos são folhas
 * independentes de propósito.
 * @param {*} taxa
 * @returns {string}
 */
export function taxaDeErroLabel(taxa) {
    if (typeof taxa !== 'number' || !Number.isFinite(taxa) || taxa < 0) return '—';
    if (taxa > 0 && taxa < 0.1) return '<0,1%';
    return `${taxa.toFixed(1).replace('.', ',')}%`;
}

/**
 * QUAL DAS DUAS CONTAS ESTÁ NA TELA, dito em voz alta, e POR QUE quando não é a do servidor.
 *
 * ELA NÃO É OPCIONAL, e é a única frase deste arquivo que existe por causa de uma AMBIGUIDADE e
 * não de uma ausência: as duas contas têm o mesmo título ("Saúde por release"), os mesmos nomes de
 * release e dois rótulos em comum, e dão números diferentes. Sem esta linha, um administrador que
 * abrisse a aba antes e depois de o servidor ganhar o bloco veria os números mudarem sem nada
 * explicar, e a conclusão natural é que a tela está errada.
 *
 * O TERCEIRO RAMO NÃO AFIRMA CAUSA. Ele existe porque a primeira versão tinha dois e acusava
 * "versão anterior" também quando o pulso falhou e quando o próprio servidor mandou o bloco como
 * nulo: nos dois casos ele está atualizado e não conseguiu responder AGORA, e mandar o
 * administrador atualizar o servidor manda procurar o problema no lugar errado.
 * @param {*} fonte - Um valor de {@link FONTE_DA_SAUDE}.
 * @returns {string}
 */
export function saudeFonteNotice(fonte) {
    if (fonte === FONTE_DA_SAUDE.SERVIDOR) {
        return 'Contado pelo SERVIDOR, sobre o histórico dele: as sessões e os defeitos de cada '
            + 'build, independentemente da janela e dos filtros desta tela.';
    }
    const conta = 'Contado pelo CLIENTE, sobre os defeitos que esta lista carregou: a janela, os '
        + 'filtros e o teto da consulta valem aqui também. ';
    if (fonte === FONTE_DA_SAUDE.INDISPONIVEL) {
        return `${conta}Não deu para ler o resumo do servidor nesta carga, e daqui não dá para `
            + 'dizer se foi a requisição ou o banco dele; o que está acima é a conta do cliente.';
    }
    return `${conta}O servidor desta instalação não informa o resumo por release.`;
}

/**
 * O alcance da conta acima, dito na tela.
 * @returns {string}
 */
export function saudeNotice() {
    return 'Contado sobre os defeitos que esta lista carregou, e não sobre o histórico: a janela, '
        + 'os filtros e o teto da consulta valem aqui também.';
}

/** @returns {string} */
export function saudeVaziaNotice() {
    return 'Nenhum defeito da lista declara a release em que foi visto.';
}

/** @returns {string} */
export function saudeTitulo() {
    return 'Saúde por release';
}

/**
 * Qual build está no ar AGORA, segundo o próprio servidor (`/diag/status`, campo `release`).
 *
 * ELA É O NÚMERO QUE FALTAVA PARA O CARTÃO SIGNIFICAR ALGUMA COISA: "duas regressões na v2" só
 * pede providência se a v2 for a que está rodando. `null` é estado legítimo e declarado (a rota
 * manda `release: null` quando a instalação não carimbou `EBGEO_RELEASE`), e a frase o nomeia em
 * vez de calar, senão a ausência do rótulo se lê como dado que não carregou.
 * @param {*} release
 * @returns {string}
 */
export function buildNoArLabel(release) {
    const texto = typeof release === 'string' ? release.trim() : '';
    return texto ? `Build no ar: ${texto}` : 'Esta instalação não declarou qual build está no ar.';
}

/**
 * O nome de uma release, ou vazio.
 * @param {*} release
 * @returns {string}
 */
export function releaseLabel(release) {
    return typeof release === 'string' ? release.trim() : '';
}

/**
 * As duas releases de avistamento de um defeito, na coluna.
 *
 * "v1 → v2" DIZ MAIS QUE DUAS COLUNAS, porque a informação é o percurso: nascido e ainda vivo na
 * mesma build é um defeito desta build, e nascido três builds atrás é dívida. Quando as duas
 * coincidem a seta some, senão toda linha de defeito recente ganharia uma seta que não aponta
 * para lugar nenhum.
 * @param {Object} [item]
 * @returns {string}
 */
export function releasesDoDefeito(item) {
    const primeira = releaseLabel(item?.primeiraRelease);
    const ultima = releaseLabel(item?.ultimaRelease);
    if (!primeira && !ultima) return '';
    if (!primeira) return ultima;
    if (!ultima || primeira === ultima) return primeira;
    return `${primeira} → ${ultima}`;
}

/**
 * O `title` da coluna de releases.
 * @param {Object} [item]
 * @returns {string}
 */
export function releasesDetalhe(item) {
    const primeira = releaseLabel(item?.primeiraRelease);
    const ultima = releaseLabel(item?.ultimaRelease);
    if (!primeira && !ultima) return 'Nenhuma das ocorrências declarou a build.';
    if (primeira && ultima && primeira !== ultima) {
        return `Visto pela primeira vez na ${primeira} e pela última na ${ultima}.`;
    }
    return `Visto só na ${primeira || ultima}.`;
}

/**
 * O que a linha diz sobre um defeito já resolvido.
 * @param {Object} [item]
 * @param {string} [quando] - `resolvidoEm`, já formatado por quem chama.
 * @returns {string}
 */
export function resolucaoNotice(item, quando) {
    if (item?.estado !== ESTADO_DE_DEFEITO.RESOLVIDO
        && item?.estado !== ESTADO_DE_DEFEITO.REGREDIU) {
        return '';
    }
    const quem = typeof item?.resolvidoPorUsername === 'string' ? item.resolvidoPorUsername.trim() : '';
    const release = releaseLabel(item?.resolvidoNaRelease);
    const commit = typeof item?.resolvidoNoCommit === 'string' ? item.resolvidoNoCommit.trim() : '';
    if (!quem && !release && !commit && !quando) return '';
    const partes = [];
    partes.push(quem ? `Resolvido por ${quem}` : 'Resolvido');
    if (quando) partes.push(`em ${quando}`);
    if (release) partes.push(`na release ${release}`);
    if (commit) partes.push(`commit ${commit}`);
    return `${partes.join(', ')}.`;
}

// ===== a gaveta de ocorrências =====

/**
 * O resumo do `<details>` interno da gaveta.
 *
 * A PILHA CRUA É OUTRA COISA que a normalizada, e o rótulo tem de dizer isso: a normalizada é a
 * que casa com a assinatura e é a que se lê; a crua ainda tem o hash do bundle e é a única que
 * `npm run diag -- pilha` consegue resolver contra um `.map`.
 * @returns {string}
 */
export function pilhaBrutaResumo() {
    return 'Ver a pilha crua, antes da normalização';
}

/** @returns {string} */
export function gavetaAbrirLabel() {
    return 'Ver ocorrências';
}

/** @returns {string} */
export function gavetaFecharLabel() {
    return 'Fechar ocorrências';
}

/** @returns {string} */
export function ocorrenciasCarregandoNotice() {
    return 'Carregando as ocorrências…';
}

/** @returns {string} */
export function ocorrenciasFailureNotice() {
    return 'Não foi possível ler as ocorrências deste defeito.';
}

/**
 * O vazio da gaveta, que aqui NÃO é boa notícia e também não é falha.
 *
 * A rota devolve lista vazia (e não 404) para defeito que a poda apagou entre a listagem e o
 * clique, e é isso que a frase diz: um 404 leria como "a rota quebrou" em vez de "isto
 * envelheceu".
 * @returns {string}
 */
export function ocorrenciasEmptyNotice() {
    return 'Nenhuma ocorrência guardada para este defeito.';
}

/** @returns {string} */
export function ocorrenciasEmptyHint() {
    return 'A linha agregada sobrevive à poda por idade, e as ocorrências dela não: elas '
        + 'envelhecem junto com o log do servidor que as explica.';
}

/**
 * O cabeçalho da lista de ocorrências, com o teto dito em voz alta.
 *
 * O TETO É DE ESCRITA, e não de paginação: a tabela nunca guarda mais de vinte por defeito
 * (`DELETE_OCORRENCIAS_EXCEDENTES`, aplicado na mesma transação do insert), então "a próxima
 * página" não existe. Sem esta frase, vinte ocorrências ao lado de um crachá de nove mil relatos
 * se lê como lista cortada por uma consulta que alguém pode alargar.
 * @param {*} quantas
 * @returns {string}
 */
export function ocorrenciasTitulo(quantas) {
    if (!Number.isFinite(quantas) || quantas < 0) return 'Ocorrências guardadas';
    const n = Math.round(quantas);
    const quais = n === 1 ? '1 ocorrência guardada' : `${n} ocorrências guardadas`;
    return `${quais}, da mais recente para a mais antiga. O servidor guarda no máximo as 20 `
        + 'últimas de cada defeito, e apaga as anteriores na própria escrita.';
}

/** @returns {string} */
export function migalhasTitulo() {
    return 'O que aconteceu antes, nesta ocorrência';
}

/** @returns {string} */
export function migalhasVaziasNotice() {
    return 'Esta ocorrência não trouxe migalhas: ou o cliente é de uma versão anterior à trilha, '
        + 'ou nada aconteceu na aba antes do erro.';
}

/**
 * O rótulo de uma migalha na trilha. O vocabulário de `tipo` NÃO é fechado no servidor de
 * propósito, então o desconhecido sai por ele mesmo.
 * @param {Object} [migalha]
 * @returns {string}
 */
export function tipoDeMigalhaLabel(migalha) {
    const tipo = typeof migalha?.tipo === 'string' ? migalha.tipo.trim() : '';
    return tipo || 'sem tipo';
}

/**
 * O texto de uma migalha.
 * @param {Object} [migalha]
 * @returns {string}
 */
export function textoDeMigalhaLabel(migalha) {
    const texto = typeof migalha?.texto === 'string' ? migalha.texto.trim() : '';
    return texto || 'sem texto';
}

/**
 * A família do navegador, a partir do user agent.
 *
 * FAMÍLIA E NÃO A STRING INTEIRA, porque a pergunta da linha é "só num navegador?" e um user
 * agent completo ocupa a largura da tela para responder isso. O valor inteiro continua no `title`.
 *
 * A ORDEM DOS TESTES É O CONTRATO desta função, e é o erro clássico de quem a reescreve: o Edge
 * diz `Chrome` na própria string, e o Chrome diz `Safari`, então quem perguntar por Chrome antes
 * de Edge classifica todo Edge como Chrome. Ela é DELIBERADAMENTE grosseira: não devolve versão,
 * não distingue Chromium de Chrome e não tenta cobrir a cauda.
 * @param {*} userAgent
 * @returns {string}
 */
export function navegadorLabel(userAgent) {
    const ua = typeof userAgent === 'string' ? userAgent : '';
    if (!ua.trim()) return 'navegador não declarado';
    if (/\bEdg\//.test(ua)) return 'Edge';
    if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera';
    if (/\bFirefox\//.test(ua)) return 'Firefox';
    if (/\bChrome\//.test(ua)) return 'Chrome';
    if (/\bSafari\//.test(ua)) return 'Safari';
    return 'outro navegador';
}

/**
 * O id da aba, curto.
 *
 * OITO CARACTERES é o que basta para comparar duas ocorrências entre si na mesma tela, que é a
 * pergunta ("veio tudo da mesma aba?"). Quem precisa do valor inteiro (para
 * `diag -- linhas --filtro`) o tem no `title`.
 * @param {*} sessaoId
 * @returns {string}
 */
export function sessaoCurta(sessaoId) {
    const texto = typeof sessaoId === 'string' ? sessaoId.trim() : '';
    if (!texto) return '';
    return texto.length <= 8 ? texto : texto.slice(0, 8);
}

/**
 * A rota e o status de uma ocorrência de SERVIDOR.
 *
 * Só o defeito de origem `servidor` traz os dois campos (o agregador do backend os preenche), e
 * por isso a célula some no resto: uma coluna vazia em nove de cada dez linhas se lê como dado
 * que não chegou.
 * @param {Object} [ocorrencia]
 * @returns {string}
 */
export function rotaEStatusLabel(ocorrencia) {
    const rota = typeof ocorrencia?.rota === 'string' ? ocorrencia.rota.trim() : '';
    const status = ocorrencia?.statusCode;
    const temStatus = Number.isInteger(status) && status >= 100 && status <= 599;
    if (rota && temStatus) return `${rota} · ${status}`;
    if (rota) return rota;
    return temStatus ? String(status) : '';
}

// ===== as frases da seção =====

/** @returns {string} */
export function secaoTitulo() {
    return 'Defeitos';
}

/** @returns {string} */
export function secaoSubtitulo() {
    return 'O que quebrou, no navegador de quem usa e no próprio servidor, com o estado de cada '
        + 'um. Do mais recente para o mais antigo.';
}

/**
 * A linha que diz onde foi parar a lista que esta seção substituiu.
 *
 * A SEÇÃO DE ERROS DO SERVIDOR LIDA DO ARQUIVO SAIU DA TELA, e o que ela mostrava (os endereços
 * agregados por assinatura, a varredura de quantos arquivos e quantas linhas) continua inteiro no
 * terminal. Dizer isso custa uma linha e evita a leitura de que a capacidade foi perdida, que é o
 * que uma seção sumindo sem explicação comunica.
 * @returns {string}
 */
export function escopoNotice() {
    return 'Esta lista vem do banco, e não do arquivo de log: o 5xx do servidor entra aqui como '
        + 'defeito, e a varredura do log (com os endereços de onde cada pico veio) continua em '
        + '"npm run diag -- erros", no servidor.';
}

/**
 * O que o número ao lado de cada defeito significa. Ver o `@fileoverview`.
 * @returns {string}
 */
export function contagemNotice() {
    return 'O número de cada linha é o total acumulado desde a primeira vez que aquela assinatura '
        + 'apareceu, e não a contagem desta janela: a janela decide quais defeitos aparecem, '
        + 'nunca o tamanho do número. E ele conta RELATOS, não ocorrências, porque cada sessão '
        + 'relata a mesma assinatura uma vez só: um erro em laço vale 1.';
}

/** @param {string} quando - A janela em palavras, de `janelaEmPalavras`. @returns {string} */
export function defeitosEmptyNotice(quando) {
    return `Nenhum defeito ${quando}.`;
}

/** @returns {string} */
export function defeitosEmptyHint() {
    return 'É a boa notícia desta tela: o período fechou sem nenhuma falha registrada, nem do '
        + 'navegador nem do servidor.';
}

/**
 * O vazio COM FILTRO é outro vazio, e confundi-los é dizer que o sistema está saudável quando o
 * que está estreito é a pergunta.
 * @param {string} quando
 * @returns {string}
 */
export function defeitosFiltradosEmptyNotice(quando) {
    return `Nenhum defeito ${quando} para os filtros escolhidos.`;
}

/** @returns {string} */
export function defeitosFiltradosEmptyHint() {
    return 'Isto não é a boa notícia da tela: com outro recorte pode haver defeito. Limpe os '
        + 'filtros para ver a janela inteira.';
}

/** @returns {string} */
export function defeitosFailureNotice() {
    return 'Não foi possível ler os defeitos.';
}

/**
 * Se algum filtro está apertado, o que decide qual dos dois vazios desenhar.
 * @param {Object} [filtros]
 * @returns {boolean}
 */
export function temFiltroAtivo(filtros) {
    if (!filtros || typeof filtros !== 'object') return false;
    return Boolean(filtros.estado) || Boolean(filtros.origem)
        || Boolean(String(filtros.release ?? '').trim()) || Boolean(filtros.pagina)
        || filtros.novos === true;
}

/** @returns {string} */
export function limparFiltrosLabel() {
    return 'Limpar filtros';
}

/**
 * Os cabeçalhos da tabela, na ordem em que a seção os desenha.
 *
 * A CONTAGEM VEM LOGO DEPOIS DO ESTADO, e as duas primeiras colunas são a decisão da tela: quem
 * abre esta aba está escolhendo o que consertar primeiro, e as duas perguntas dessa escolha são
 * "isto está aberto?" e "quantos?".
 * @type {ReadonlyArray<string>}
 */
export const COLUNAS = Object.freeze([
    'Estado',
    'Relatos',
    'Origem',
    'Mensagem',
    'Página',
    'Releases',
    'Última vez',
    'Ações',
]);
