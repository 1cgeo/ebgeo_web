// Path: js/admin/uso-phrases.js

/**
 * @fileoverview O que a aba "Uso" DIZ, e como ela decide o que desenhar, em funções puras
 * testáveis em node. ZERO IMPORTS, como os irmãos (`diag-phrases.js`, `grant-phrases.js`,
 * `group-phrases.js`): `admin.html` boota sem a store, e um import daqui a arrastaria de volta
 * pelo caminho transitivo.
 *
 * A ABA RESPONDE UMA PERGUNTA: quem usa, o quê, e quanto. Uma rota só (`/uso/resumo`), uma janela
 * só, e três blocos que a resposta traz juntos porque só juntos eles significam alguma coisa: um
 * pico de produção sem saber quantas pessoas entraram no mesmo período pode ser mil feições de uma
 * pessoa ou dez de cem.
 *
 * O ERRO MAIS FÁCIL DE COMETER AQUI É ROTULAR UM NÚMERO DE HOJE COMO SE FOSSE DO PERÍODO, e é o
 * mais difícil de notar depois: "42 contas ativas" ao lado de "nos últimos 30 dias" lê como
 * crescimento e é um estoque. Por isso o REGIME não é prosa escrita à mão em cada ladrilho: ele é
 * campo obrigatório de cada métrica (`METRICAS_DE_PESSOAS`, `METRICAS_DE_ATLAS`), a tela o escreve
 * a partir do campo, e o teste cobra que cada métrica tenha o seu. Duas contagens são de HOJE
 * (`contasAtivas` e `atlas.vivos`, que são estoques) e todo o resto é DO PERÍODO. Escrever a frase
 * à mão em oito ladrilhos é a forma de errar um deles sem nada ficar vermelho.
 *
 * O HORIZONTE É A PARTE QUE NÃO PODE FALTAR, e é a razão de este arquivo existir em vez de a aba
 * formatar números inline. `operations` é uma tabela PODÁVEL: um administrador pode ter apagado o
 * passado. Sem aviso, "a produção caiu" e "o histórico foi apagado" desenham EXATAMENTE a mesma
 * tela, e a leitura errada é a que a pessoa vai fazer, porque é a que o gráfico sugere. Três
 * decisões daí:
 *
 *   1. **São DUAS fontes, não uma, e elas limitam METADES DIFERENTES da tela.**
 *      `operacoesDesde` é o começo de `operations`, e alcança tudo que se conta a partir dela: a
 *      produção inteira (total, quebra por tipo, série diária), os atlas mais ativos, "Produziram"
 *      e "Com edição". `trilhaDesde` é o começo de `audit_trail`, e alcança UM número só,
 *      "Entraram", porque é a trilha que registra o login. Elas podem ser podadas em datas
 *      diferentes, e um aviso só, genérico, mandaria desconfiar dos números errados.
 *
 *      **E TRÊS NÚMEROS NÃO TÊM HORIZONTE NENHUM**, o que é o avesso da mesma armadilha: "Contas
 *      novas", "Criados" e "Excluídos" saem das tabelas `users` e `atlas` por data própria, não de
 *      um registro podável, então nenhuma das duas fontes os limita e nenhum aviso pode dizer que
 *      sim. Reunir os oito números sob "o histórico foi podado" faria a tela desconfiar de três
 *      contagens que estão inteiras. (A primeira versão desta lista dizia exatamente isso, e
 *      estava errada: foi conferida contra `backend/src/modules/uso/uso.queries.js`.)
 *   2. **A frase NÃO afirma causa.** Uma instalação de uma semana e uma instalação podada ontem
 *      produzem o mesmo `operacoesDesde`, e este arquivo não tem como distingui-las. Dizer "o
 *      histórico foi podado" inventaria um fato; dizer "o dado alcança apenas desde X" é o que se
 *      sabe. É a mesma régua de `failureState`, que não manda ninguém depurar a própria internet.
 *   3. **`null` e `undefined` são estados DIFERENTES.** `null` é o contrato dizendo "não há dado
 *      nenhum"; `undefined` é um servidor que não respondeu o campo. Colapsar os dois faz um
 *      servidor antigo anunciar poda que não houve, ou uma poda total passar calada.
 *
 * O VAZIO TEM DOIS SENTIDOS E ELES NÃO SE MISTURAM. "Instalação sem uso nenhum" (não existe atlas,
 * ninguém entrou, nada foi produzido) é a tela vazia inteira, com frase honesta. "Período parado"
 * (o acervo existe, e nesta janela não houve movimento) NÃO é tela vazia: os estoques de hoje
 * continuam sendo fato e continuam na tela, e o que ganha frase é a metade do período. Colapsar os
 * dois esconderia de um administrador o tamanho do próprio acervo por causa de uma semana quieta.
 *
 * E O ZERO SE DESENHA, NUNCA SE OMITE. Dia sem produção é uma barra de altura zero sobre uma linha
 * de base visível, e não um buraco na série: buraco se lê como dado que não chegou, que é a
 * afirmação oposta. O preenchimento de dias (`preencherDias`) existe justamente para não depender
 * de o servidor ter lembrado de mandar o zero.
 *
 * DUAS SEÇÕES NÃO RESPONDEM "QUANTO", RESPONDEM "O QUE ACONTECE DEPOIS", e elas leem o MESMO
 * payload de um jeito que o resto da aba não lê. O funil de entrada
 * ({@link PASSOS_DO_FUNIL}) e a coorte de retenção ({@link COLUNAS_DE_RETENCAO}) recortam pelo
 * período a COORTE, e não o fato medido: quem se cadastrou na janela conta no segundo passo mesmo
 * criando o atlas depois dela, e a coorte de uma semana é acompanhada nas quatro semanas
 * seguintes, que podem estar fora do período. Sem isso, a coorte mais recente sempre pareceria a
 * pior, por ter tido menos tempo, e o relatório mediria idade em vez de comportamento. As duas
 * seções são `REGIME.PERIODO` porque é o período que as define; o que ele NÃO fecha é a contagem,
 * e é o que {@link funilHint} e {@link retencaoHint} dizem em voz alta.
 *
 * AS DUAS TÊM UM PISO CADA, E ELES TÊM ORIGENS DIFERENTES, que é o que impede uma frase só. O do
 * funil é de HORIZONTE: o terceiro passo sai de `operations`, que é podável, e por isso ele reusa
 * os quatro estados de {@link HORIZONTE} ({@link funilPisoNotice}). O da retenção NÃO é de
 * horizonte: `audit_trail` não é podada, e o piso vem do `LOGIN` ser best-effort. Fundi-los faria
 * a tela mandar procurar uma poda que não houve.
 *
 * DESDE 2026-09-02 A ABA TEM DUAS METADES COM FONTES DIFERENTES, e é a distinção mais cara de
 * perder deste arquivo. Tudo acima vem do que o SERVIDOR já registrava (operações de sync, trilha
 * de auditoria, `users`, `atlas`): ele mede o que ACONTECEU. As quatro seções de uso do produto
 * (sessões, mais usados, desempenho no cliente e indisponibilidade vista da ponta) vêm do que
 * NAVEGADORES RELATARAM, por um lote sem fila, e por isso todo número delas é um PISO: um zero ali
 * significa "ninguém fez" OU "ninguém conseguiu contar", e a tela não sabe qual. A seção própria
 * delas, mais abaixo, carrega as três consequências que precisam estar escritas NA TELA.
 *
 * TODO TEXTO DAQUI SAI PARA A TELA POR `textContent`. Nome de atlas e nome de dono são dado de
 * usuário; este arquivo não monta uma linha de HTML.
 */

// ===== a janela =====

/**
 * As janelas que a aba oferece, na ordem do seletor.
 *
 * TRÊS, E O TETO DO SERVIDOR É 365d: aqui o limite é de LEITURA, não de capacidade. Sete dias
 * mostra a semana, trinta mostra o mês (é o padrão, e é a pergunta que se faz mais), noventa mostra
 * a tendência. Um seletor com doze opções não ajuda a responder nenhuma delas melhor.
 *
 * `frase` é campo próprio, e não derivada do rótulo, porque as duas flexões divergem em português.
 * @type {ReadonlyArray<{valor: string, rotulo: string, frase: string, dias: number}>}
 */
export const JANELAS = Object.freeze([
    Object.freeze({ valor: '7d', rotulo: 'Últimos 7 dias', frase: 'nos últimos 7 dias', dias: 7 }),
    Object.freeze({ valor: '30d', rotulo: 'Últimos 30 dias', frase: 'nos últimos 30 dias', dias: 30 }),
    Object.freeze({ valor: '90d', rotulo: 'Últimos 90 dias', frase: 'nos últimos 90 dias', dias: 90 }),
]);

/** A janela de abertura: o mês é a pergunta usual de quem abre um painel de uso. */
export const JANELA_PADRAO = '30d';

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
 * consulta 30 dias, e nunca uma janela que o servidor recusaria.
 * @param {*} valor
 * @returns {string}
 */
export function normalizarJanela(valor) {
    return janelaValida(valor) ? valor : JANELA_PADRAO;
}

/** @param {*} valor @returns {{valor: string, rotulo: string, frase: string, dias: number}} */
function janelaDe(valor) {
    const alvo = normalizarJanela(valor);
    return JANELAS.find((j) => j.valor === alvo);
}

/**
 * O rótulo do seletor para uma janela.
 * @param {*} valor
 * @returns {string}
 */
export function rotuloDeJanela(valor) {
    return janelaDe(valor).rotulo;
}

/**
 * A janela em forma de complemento de frase ("nos últimos 30 dias").
 * @param {*} valor
 * @returns {string}
 */
export function janelaEmPalavras(valor) {
    return janelaDe(valor).frase;
}

/**
 * Quantos dias a janela pede.
 * @param {*} valor
 * @returns {number}
 */
export function diasDaJanela(valor) {
    return janelaDe(valor).dias;
}

// ===== números =====

const FORMATADOR_DE_NUMERO = new Intl.NumberFormat('pt-BR');

/** @param {*} v @returns {boolean} */
function numeroContavel(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** @param {*} v @returns {number} */
function numeroOuZero(v) {
    return numeroContavel(v) ? v : 0;
}

/**
 * Uma contagem, agrupada em milhares. Um travessão para o que não é contagem.
 *
 * ZERO É NÚMERO E APARECE COMO "0"; ausente, NaN e NEGATIVO viram travessão. A distinção é a
 * inteira: "0 pessoas entraram" é um fato medido, e escrever "0" sobre um campo que não chegou
 * inventaria justamente esse fato. Negativo entra no travessão porque contagem negativa é defeito
 * do outro lado, e desenhá-la seria repassar o defeito como se fosse medida.
 * @param {*} n
 * @returns {string}
 */
export function numeroLabel(n) {
    if (!numeroContavel(n)) return '—';
    return FORMATADOR_DE_NUMERO.format(Math.round(n));
}

/**
 * Uma média com uma casa decimal, em pt-BR. Travessão pelas mesmas razões de {@link numeroLabel}.
 * @param {*} n
 * @returns {string}
 */
export function mediaLabel(n) {
    if (!numeroContavel(n)) return '—';
    return FORMATADOR_DE_NUMERO.format(Math.round(n * 10) / 10);
}

/**
 * A fração de um total, como percentual pt-BR.
 *
 * DUAS SAÍDAS QUE NÃO SÃO O NÚMERO: sem total não há fração (`null`, e a tela não desenha nada), e
 * uma fatia positiva menor que um décimo de por cento vira "<0,1%" em vez de "0,0%", porque
 * arredondar produção real para zero é dizer que ela não houve.
 * @param {*} parte
 * @param {*} total
 * @returns {string|null}
 */
export function percentualLabel(parte, total) {
    if (!numeroContavel(total) || total <= 0) return null;
    const pct = (numeroOuZero(parte) / total) * 100;
    if (pct <= 0) return '0%';
    if (pct < 0.1) return '<0,1%';
    return `${pct.toFixed(1).replace('.', ',')}%`;
}

// ===== instantes e dias =====

// A leitura de instante mora em `./instante.js`, compartilhada com a outra aba do painel:
// as duas frentes a escreveram identica no mesmo dia, e ela e a peca com ramos suficientes
// para divergir sem ninguem notar. Reexportada para os consumidores (e os testes) deste
// modulo nao mudarem de porta por causa de uma extracao interna.
import { instanteDe } from './instante.js';

export { instanteDe };


/**
 * A data LOCAL de um instante ("12/08/2026").
 *
 * LOCAL, E NÃO UTC: o administrador está comparando com o calendário dele. `timeZone` existe para
 * o teste ser determinístico; a tela nunca o passa.
 * @param {*} valor
 * @param {{timeZone?: string}} [opts]
 * @returns {string} Vazio quando não há instante.
 */
export function dataLocal(valor, { timeZone } = {}) {
    const d = instanteDe(valor);
    if (!d) return '';
    return d.toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        ...(timeZone ? { timeZone } : {}),
    });
}

const DIA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILISSEGUNDOS_POR_DIA = 86400000;

/**
 * As partes de um dia `AAAA-MM-DD`, ou `null`.
 *
 * A VALIDAÇÃO É POR IDA E VOLTA, e não por faixa: `2026-02-30` passa em qualquer teste de
 * `mes <= 12 && dia <= 31` e não existe. Construir a data em UTC e conferir se ela devolve as
 * mesmas três partes rejeita o dia inventado sem uma tabela de meses.
 * @param {*} dia
 * @returns {{ano: number, mes: number, diaDoMes: number, ms: number}|null}
 */
export function partesDoDia(dia) {
    if (typeof dia !== 'string') return null;
    const m = DIA_RE.exec(dia.trim());
    if (!m) return null;
    const ano = Number(m[1]);
    const mes = Number(m[2]);
    const diaDoMes = Number(m[3]);
    const ms = Date.UTC(ano, mes - 1, diaDoMes);
    const d = new Date(ms);
    if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== diaDoMes) {
        return null;
    }
    return { ano, mes, diaDoMes, ms };
}

/** @param {*} dia @returns {boolean} */
export function diaValido(dia) {
    return partesDoDia(dia) !== null;
}

/**
 * "DD/MM" — o rótulo do eixo, onde só cabem cinco caracteres.
 * @param {*} dia
 * @returns {string} Vazio quando o dia não se resolve.
 */
export function rotuloCurtoDeDia(dia) {
    const p = partesDoDia(dia);
    if (!p) return '';
    return `${String(p.diaDoMes).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}`;
}

/**
 * "DD/MM/AAAA" — o dia inteiro, para o `title` da barra.
 *
 * MONTADO À MÃO, e não por `Intl` sobre uma `Date`: o dia do contrato é um rótulo de calendário,
 * sem hora e sem fuso, e passá-lo por uma data faria "2026-08-30" virar 29/08 para quem está a
 * oeste de Greenwich. É um erro de um dia, que é o tamanho exato de erro que ninguém percebe.
 * @param {*} dia
 * @returns {string}
 */
export function rotuloLongoDeDia(dia) {
    const p = partesDoDia(dia);
    if (!p) return '';
    return `${String(p.diaDoMes).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;
}

/**
 * O dia seguinte, em `AAAA-MM-DD`.
 *
 * ARITMÉTICA EM UTC de propósito: somar 24 horas a uma data local erra nos dois dias do ano em que
 * o relógio muda, e o preenchimento da série passaria a repetir ou pular um dia uma vez por
 * semestre, num gráfico em que ninguém iria procurar.
 * @param {*} dia
 * @returns {string} Vazio quando o dia não se resolve.
 */
export function diaSeguinte(dia) {
    const p = partesDoDia(dia);
    if (!p) return '';
    const d = new Date(p.ms + MILISSEGUNDOS_POR_DIA);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Quantos dias INTEIROS separam dois instantes, arredondando para cima o dia começado.
 * @param {*} de
 * @param {*} ate
 * @returns {number|null} `null` quando alguma ponta não se resolve, ou quando `ate` precede `de`.
 */
export function diasEntre(de, ate) {
    const a = instanteDe(de);
    const b = instanteDe(ate);
    if (!a || !b) return null;
    const delta = b.getTime() - a.getTime();
    if (delta < 0) return null;
    return Math.max(1, Math.ceil(delta / MILISSEGUNDOS_POR_DIA));
}

// ===== o horizonte: até onde o dado alcança =====

/**
 * Os quatro desfechos de uma fonte de dado diante da janela pedida.
 * @type {Readonly<Object<string, string>>}
 */
export const HORIZONTE = Object.freeze({
    COBRE: 'cobre',
    ENCURTADO: 'encurtado',
    VAZIO: 'vazio',
    DESCONHECIDO: 'desconhecido',
});

/**
 * O desfecho de uma fonte diante da janela pedida.
 *
 * A ORDEM DOS RAMOS É O CONTRATO. `undefined` (servidor que não respondeu o campo) vem antes de
 * tudo e é DESCONHECIDO; `null` é o contrato afirmando que não há dado nenhum, e é VAZIO. Colapsar
 * os dois num `!= null` faz um servidor antigo anunciar uma poda que não houve, e uma poda total
 * passar calada — os dois sentidos do mesmo erro, que é como se sabe que a distinção é a certa.
 *
 * SEM TOLERÂNCIA de alguns segundos, e é deliberado: qualquer começo posterior ao pedido significa
 * que o trecho mostrado é mais curto que o pedido, e é isso que a tela precisa dizer. Uma
 * instalação jovem cai aqui junto com uma podada, e a frase não escolhe entre as duas porque este
 * arquivo não tem como saber qual é.
 *
 * @param {Object} [entrada]
 * @param {*} [entrada.desde] - Epoch ms do início da janela, como o servidor a ecoou.
 * @param {*} [entrada.alcance] - Epoch ms do começo do dado, `null` para "não há dado".
 * @returns {string} Um valor de {@link HORIZONTE}.
 */
export function estadoDoHorizonte({ desde, alcance } = {}) {
    if (alcance === undefined) return HORIZONTE.DESCONHECIDO;
    if (alcance === null) return HORIZONTE.VAZIO;
    const inicioDoDado = instanteDe(alcance);
    if (!inicioDoDado) return HORIZONTE.DESCONHECIDO;
    const inicioPedido = instanteDe(desde);
    // Sem saber o que foi pedido não dá para afirmar que o pedido foi atendido.
    if (!inicioPedido) return HORIZONTE.DESCONHECIDO;
    return inicioDoDado.getTime() > inicioPedido.getTime()
        ? HORIZONTE.ENCURTADO
        : HORIZONTE.COBRE;
}

/**
 * As DUAS fontes do horizonte, com o que cada uma limita.
 *
 * `alcance` NOMEIA OS NÚMEROS DA TELA, e não a tabela do banco: "operations foi podada" não diz a
 * ninguém quais dos oito números daquela tela ficaram curtos. Um aviso que não localiza o estrago
 * só ensina a desconfiar de tudo, que é o mesmo que não desconfiar de nada.
 *
 * OS DOIS RECORTES FORAM CONFERIDOS CONTRA AS CONSULTAS (`backend/src/modules/uso/uso.queries.js`),
 * e não deduzidos do nome da fonte, que é onde a dedução erra: "trilha de auditoria" sugere as
 * contas novas e os atlas criados, e nenhum dos dois sai dela. Ver o `@fileoverview` sobre os três
 * números que não têm horizonte nenhum.
 * @type {ReadonlyArray<{chave: string, fonte: string, alcanca: string}>}
 */
export const FONTES_DE_HORIZONTE = Object.freeze([
    Object.freeze({
        chave: 'operacoesDesde',
        fonte: 'o registro de produção',
        alcanca: 'a produção inteira (gráfico diário, quebra por tipo e atlas mais ativos), '
            + '"Produziram", "Com edição" e o terceiro passo do funil de entrada',
    }),
    Object.freeze({
        chave: 'trilhaDesde',
        fonte: 'a trilha de auditoria',
        alcanca: 'o número de quem "Entrou"',
    }),
]);

/**
 * A frase de uma fonte que NÃO cobre a janela pedida.
 *
 * ELA NÃO AFIRMA CAUSA (ver o `@fileoverview`), e nomeia o que ficou curto. A cláusula final é a
 * razão de a frase existir: sem ela, quem lê um gráfico curto conclui queda de uso, que é a leitura
 * que o desenho sugere e a única que a tela não pode deixar sozinha.
 * @param {Object} [entrada]
 * @param {{fonte?: string, alcanca?: string}} [entrada.fonte]
 * @param {*} [entrada.alcance] - Epoch ms do começo do dado.
 * @param {*} [entrada.janela]
 * @param {*} [entrada.agora] - Injetado no teste; a tela usa o relógio.
 * @param {string} [entrada.timeZone]
 * @returns {string}
 */
export function horizonteEncurtadoNotice({ fonte, alcance, janela, agora, timeZone } = {}) {
    const nome = fonte?.fonte ?? 'o registro';
    const alvo = fonte?.alcanca ?? 'os números do período';
    const data = dataLocal(alcance, { timeZone });
    const pedidos = diasDaJanela(janela);
    const cobertos = diasEntre(alcance, agora ?? Date.now());
    const quanto = cobertos !== null && cobertos < pedidos
        ? ` — ${cobertos} dos ${pedidos} dias pedidos`
        : '';
    const desde = data ? ` desde ${data}` : '';
    return `Você pediu ${janelaEmPalavras(janela)}, mas ${nome} só alcança${desde}${quanto}. `
        // O ALVO ENTRA ENTRE PARÊNTESES, e não como sujeito, pela MESMA razão já escrita em
        // `horizonteVazioNotice` — que esta frase não seguiu, e o preço apareceu na tela: com
        // `alcanca` valendo 'o número de quem "Entrou"' (singular), saía "o número ... MOSTRAM".
        // Cada entrada nova de `FONTES_DE_HORIZONTE` teria de concordar em gênero e número com um
        // verbo que mora noutro arquivo, e a primeira que não concordasse sairia agramatical em
        // silêncio, porque nenhum teste lê português. Com um sujeito FIXO ("o que depende dele"),
        // o texto variável vira aposto e a concordância deixa de depender de quem escreve a lista.
        + `Então o que depende dele (${alvo}) mostra um trecho mais curto que o pedido: uma queda `
        + 'aí pode ser histórico que não existe mais, e não uso menor.';
}

/**
 * A frase de uma fonte SEM dado nenhum.
 * @param {{fonte?: string, alcanca?: string}} [fonte]
 * @returns {string}
 */
export function horizonteVazioNotice(fonte) {
    const nome = fonte?.fonte ?? 'o registro';
    const alvo = fonte?.alcanca ?? 'os números do período';
    // A FRASE É MONTADA COM O ALVO ENTRE PARÊNTESES, e não com ele de sujeito, porque o alvo é
    // texto variável: começá-la por ele obrigaria cada entrada de `FONTES_DE_HORIZONTE` a concordar
    // em gênero e número com o verbo, e a primeira entrada nova sairia agramatical em silêncio.
    return `Não há uma linha sequer em ${nome}: ou nada foi registrado ainda, ou o histórico foi `
        + `apagado por inteiro. O que depende dele (${alvo}) está zerado por essa razão, e não por `
        + 'falta de uso.';
}

/**
 * A frase de uma fonte cujo alcance o servidor não informou.
 *
 * ELA É DE VOZ BAIXA de propósito, e a tela a desenha como nota e não como aviso: um servidor de
 * versão anterior não é um incidente, e alarmar a cada carga ensina a ignorar o alarme — que é
 * justamente o que não pode acontecer com os outros dois, que são o incidente de verdade.
 * @param {{fonte?: string}} [fonte]
 * @returns {string}
 */
export function horizonteDesconhecidoNotice(fonte) {
    const nome = fonte?.fonte ?? 'o registro';
    return `O servidor não informou até onde ${nome} alcança, então não dá para afirmar que o `
        + 'período abaixo está completo.';
}

/**
 * O alcance de uma fonte dentro do bloco `horizonte`, preservando a distinção que decide tudo.
 *
 * O CAMPO AUSENTE E O CAMPO `undefined` SÃO O MESMO CASO, e os dois têm de sair daqui como
 * `undefined`, que {@link estadoDoHorizonte} lê como DESCONHECIDO: um bloco `horizonte` que não
 * veio não pode virar silêncio. Um `bloco[chave]` direto sobre um payload sem o campo já produz
 * `undefined`, mas o `Object.hasOwn` deixa a intenção escrita e sobrevive a um bloco que herde a
 * chave de outro lugar.
 * @param {*} horizonte
 * @param {string} chave
 * @returns {*}
 */
function alcanceDaFonte(horizonte, chave) {
    const bloco = objeto(horizonte) ? horizonte : {};
    return Object.hasOwn(bloco, chave) ? bloco[chave] : undefined;
}

/**
 * O desfecho de UMA fonte do horizonte, pela chave dela no bloco.
 *
 * ELE EXISTE PARA QUE HAJA UMA LEITURA SÓ. Os avisos do topo da aba e o piso do funil perguntam a
 * mesma coisa sobre a mesma fonte, e duas leituras da mesma chave divergem no dia em que alguém
 * corrigir uma delas: a tela passaria a avisar que a produção está curta e, três seções abaixo,
 * a apresentar o terceiro passo do funil como se estivesse inteiro.
 * @param {Object} [entrada]
 * @param {*} [entrada.desde]
 * @param {*} [entrada.horizonte]
 * @param {string} [entrada.chave]
 * @returns {string} Um valor de {@link HORIZONTE}.
 */
export function estadoDaFonte({ desde, horizonte, chave } = {}) {
    return estadoDoHorizonte({ desde, alcance: alcanceDaFonte(horizonte, chave) });
}

/**
 * Os avisos de horizonte a desenhar, um por fonte que mereça frase.
 *
 * A GUARDA DE CADA FONTE É INDEPENDENTE, e isso já custou um defeito na família de `origins` e
 * `expirations` do catálogo: um `continue` compartilhado fazia um payload com metade dos campos
 * perder a outra metade inteira. Aqui a consequência seria pior, porque a metade perdida é
 * justamente o aviso.
 * @param {Object} [entrada]
 * @param {*} [entrada.desde]
 * @param {*} [entrada.horizonte] - O bloco `horizonte` da resposta.
 * @param {*} [entrada.janela]
 * @param {*} [entrada.agora]
 * @param {string} [entrada.timeZone]
 * @returns {Array<{chave: string, estado: string, texto: string}>}
 */
export function avisosDeHorizonte({ desde, horizonte, janela, agora, timeZone } = {}) {
    const avisos = [];
    for (const fonte of FONTES_DE_HORIZONTE) {
        const alcance = alcanceDaFonte(horizonte, fonte.chave);
        const estado = estadoDoHorizonte({ desde, alcance });
        if (estado === HORIZONTE.COBRE) continue;
        let texto = '';
        if (estado === HORIZONTE.ENCURTADO) {
            texto = horizonteEncurtadoNotice({ fonte, alcance, janela, agora, timeZone });
        } else if (estado === HORIZONTE.VAZIO) {
            texto = horizonteVazioNotice(fonte);
        } else {
            texto = horizonteDesconhecidoNotice(fonte);
        }
        avisos.push({ chave: fonte.chave, estado, texto });
    }
    return avisos;
}

/**
 * Se algum aviso é GRAVE, isto é, se algum trecho da tela está mais curto que o pedido ou vazio.
 * O desconhecido não entra: ele é a nota de voz baixa.
 * @param {*} avisos
 * @returns {boolean}
 */
export function horizonteCompromete(avisos) {
    if (!Array.isArray(avisos)) return false;
    return avisos.some((a) => a?.estado === HORIZONTE.ENCURTADO || a?.estado === HORIZONTE.VAZIO);
}

// ===== o estado da tela =====

/**
 * Os quatro estados da aba. São QUATRO e não dois pela mesma razão da aba Diagnóstico: "carregando"
 * e "vazio" são desfechos opostos que um vocabulário binário desenharia igual.
 * @type {Readonly<Object<string, string>>}
 */
export const ESTADO = Object.freeze({
    CARREGANDO: 'carregando',
    FALHA: 'falha',
    VAZIO: 'vazio',
    DADOS: 'dados',
});

/**
 * O bloco `data` de uma resposta, aceitando o envelope e o objeto nu.
 *
 * Devolve `null` quando não há nada que se pareça com a resposta desta rota, e é isso que faz
 * `estadoDaTela` distinguir "o servidor disse que não houve uso" de "o servidor não disse nada que
 * eu entenda". Um 404 com corpo de erro, ou um proxy devolvendo HTML, cai no segundo.
 * @param {*} payload
 * @returns {Object|null}
 */
export function dadosDoPayload(payload) {
    const candidatos = [payload, payload?.data];
    for (const c of candidatos) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        // O PISO DE RECONHECIMENTO são os três blocos: um objeto qualquer não é esta resposta.
        // Basta UM deles porque um servidor pode crescer campos, mas nenhum é opcional a ponto de
        // a resposta inteira não trazer nenhum.
        if (objeto(c.pessoas) || objeto(c.atlas) || objeto(c.producao)) return c;
    }
    return null;
}

/** @param {*} v @returns {boolean} */
function objeto(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Uma instalação em que NADA aconteceu ainda: não existe atlas, ninguém entrou e nada foi
 * produzido.
 *
 * REPARE NO QUE NÃO ENTRA NO TESTE: `contasAtivas`. Uma instalação nova tem pelo menos a conta de
 * quem está lendo esta tela, e exigir zero contas faria o estado nunca acontecer. O que faz de uma
 * instalação "nova" é a ausência de ACERVO e de MOVIMENTO, não a de gente.
 * @param {*} dados
 * @returns {boolean}
 */
export function instalacaoSemUso(dados) {
    if (!objeto(dados)) return false;
    const atlas = objeto(dados.atlas) ? dados.atlas : {};
    const pessoas = objeto(dados.pessoas) ? dados.pessoas : {};
    const producao = objeto(dados.producao) ? dados.producao : {};
    return numeroOuZero(atlas.vivos) === 0
        && numeroOuZero(atlas.criados) === 0
        && numeroOuZero(pessoas.entraram) === 0
        && numeroOuZero(producao.total) === 0;
}

/**
 * Um PERÍODO parado sobre um acervo que existe. Não é tela vazia (ver o `@fileoverview`): é a
 * metade do período que ganha frase, enquanto os estoques de hoje continuam na tela.
 * @param {*} dados
 * @returns {boolean}
 */
export function periodoSemMovimento(dados) {
    if (!objeto(dados)) return false;
    const atlas = objeto(dados.atlas) ? dados.atlas : {};
    const pessoas = objeto(dados.pessoas) ? dados.pessoas : {};
    const producao = objeto(dados.producao) ? dados.producao : {};
    // A SESSÃO ENTRA NA CONTA DESDE QUE ELA EXISTE, e ela é o termo que os outros cinco não
    // alcançam: o EBGeo roda ANÔNIMO por desenho, então uma janela inteira de visitantes que
    // olharam o mapa e não produziram nada deixa os cinco números acima em zero. Sem este termo, o
    // período seria declarado PARADO e as quatro seções de uso, que são justamente as que têm o
    // que mostrar, não seriam desenhadas. Servidor de versão anterior não manda `sessoes`, e aí o
    // termo vale zero e nada muda.
    const sessoes = objeto(dados.sessoes) ? dados.sessoes : {};
    return numeroOuZero(producao.total) === 0
        && numeroOuZero(atlas.criados) === 0
        && numeroOuZero(atlas.excluidos) === 0
        && numeroOuZero(pessoas.novasContas) === 0
        && numeroOuZero(pessoas.entraram) === 0
        && numeroOuZero(sessoes.total) === 0;
}

/**
 * O estado que a aba deve desenhar.
 *
 * A ORDEM DOS RAMOS É O CONTRATO: carregando vence tudo, depois a falha explícita, depois o formato
 * do payload, e só então o conteúdo. Payload irreconhecível é FALHA e nunca vazio, pela mesma razão
 * que a aba Diagnóstico paga: um "nada aconteceu" desenhado sobre um instrumento desligado é a
 * afirmação mais perigosa que uma tela de medição pode fazer.
 * @param {Object} [entrada]
 * @param {boolean} [entrada.carregando]
 * @param {*} [entrada.erro]
 * @param {*} [entrada.dados] - Já passado por {@link dadosDoPayload}.
 * @returns {string} Um valor de {@link ESTADO}.
 */
export function estadoDaTela({ carregando = false, erro = null, dados = null } = {}) {
    if (carregando) return ESTADO.CARREGANDO;
    if (erro !== null && erro !== undefined) return ESTADO.FALHA;
    if (!objeto(dados)) return ESTADO.FALHA;
    return instalacaoSemUso(dados) ? ESTADO.VAZIO : ESTADO.DADOS;
}

// ===== as métricas, e o regime de cada uma =====

/**
 * Os dois regimes de um número desta tela.
 *
 * ELES SÃO CAMPO, E NÃO PROSA: ver o `@fileoverview`. `HOJE` é estoque (quantos existem agora),
 * `PERIODO` é fluxo (quantos na janela). Um ladrilho sem regime é um ladrilho que mente por
 * omissão, e é por isso que o teste cobra o campo em vez de cobrar a frase.
 * @type {Readonly<Object<string, string>>}
 */
export const REGIME = Object.freeze({ HOJE: 'hoje', PERIODO: 'periodo' });

/**
 * As métricas de pessoas, na ordem de leitura: o estoque primeiro, o fluxo depois.
 * @type {ReadonlyArray<{chave: string, rotulo: string, regime: string, detalhe: string}>}
 */
export const METRICAS_DE_PESSOAS = Object.freeze([
    Object.freeze({
        chave: 'contasAtivas',
        rotulo: 'Contas ativas',
        regime: REGIME.HOJE,
        detalhe: 'contas ativas neste momento',
    }),
    Object.freeze({
        chave: 'novasContas',
        rotulo: 'Contas novas',
        regime: REGIME.PERIODO,
        detalhe: 'contas criadas',
    }),
    Object.freeze({
        chave: 'entraram',
        rotulo: 'Entraram',
        regime: REGIME.PERIODO,
        detalhe: 'pessoas distintas que fizeram login',
    }),
    Object.freeze({
        chave: 'editaram',
        rotulo: 'Produziram',
        regime: REGIME.PERIODO,
        detalhe: 'pessoas distintas que geraram alguma operação',
    }),
]);

/**
 * As métricas de atlas, na mesma ordem: estoque, depois fluxo.
 * @type {ReadonlyArray<{chave: string, rotulo: string, regime: string, detalhe: string}>}
 */
export const METRICAS_DE_ATLAS = Object.freeze([
    Object.freeze({
        chave: 'vivos',
        rotulo: 'Atlas existentes',
        regime: REGIME.HOJE,
        detalhe: 'atlas que existem neste momento',
    }),
    Object.freeze({
        chave: 'criados',
        rotulo: 'Criados',
        regime: REGIME.PERIODO,
        detalhe: 'atlas criados',
    }),
    Object.freeze({
        chave: 'excluidos',
        rotulo: 'Excluídos',
        regime: REGIME.PERIODO,
        detalhe: 'atlas excluídos',
    }),
    Object.freeze({
        chave: 'comEdicao',
        rotulo: 'Com edição',
        regime: REGIME.PERIODO,
        detalhe: 'atlas que receberam ao menos uma operação',
    }),
]);

/**
 * O regime em palavras, sob o número.
 * @param {*} regime
 * @param {*} janela
 * @returns {string}
 */
export function regimeLabel(regime, janela) {
    return regime === REGIME.HOJE ? 'hoje' : janelaEmPalavras(janela);
}

/**
 * A métrica por extenso, para o `title`: "pessoas distintas que fizeram login nos últimos 30 dias".
 * @param {*} metrica
 * @param {*} janela
 * @returns {string}
 */
export function metricaDetalhe(metrica, janela) {
    const detalhe = typeof metrica?.detalhe === 'string' ? metrica.detalhe : '';
    if (!detalhe) return '';
    return metrica?.regime === REGIME.HOJE ? detalhe : `${detalhe} ${janelaEmPalavras(janela)}`;
}

/**
 * Lê um bloco da resposta com uma tabela de métricas, devolvendo o que a tela desenha.
 *
 * O VALOR AUSENTE NÃO VIRA ZERO: ele vira travessão, por {@link numeroLabel}. Num painel de uso, o
 * zero inventado é a afirmação "não aconteceu nada", que é exatamente o que ninguém pode inventar.
 * @param {*} bloco
 * @param {ReadonlyArray<Object>} metricas
 * @param {*} janela
 * @returns {Array<{chave: string, rotulo: string, regime: string, valor: *, texto: string, regimeTexto: string, detalhe: string}>}
 */
export function lerMetricas(bloco, metricas, janela) {
    const fonte = objeto(bloco) ? bloco : {};
    const lista = Array.isArray(metricas) ? metricas : [];
    return lista.map((m) => ({
        chave: m.chave,
        rotulo: m.rotulo,
        regime: m.regime,
        valor: fonte[m.chave],
        texto: numeroLabel(fonte[m.chave]),
        regimeTexto: regimeLabel(m.regime, janela),
        detalhe: metricaDetalhe(m, janela),
    }));
}

// ===== a produção por tipo de entidade =====

/**
 * Os nomes em pt-BR dos tipos de entidade que o sync produz.
 *
 * A CHAVE É O `entityType` DO CLIENTE (`store/sync/operation-types.js`), que é o que o servidor
 * grava cru na coluna `entity_type`. Esta tabela é uma tradução de EXIBIÇÃO e não uma segunda
 * definição do vocabulário: ela não valida nada, e um tipo que este build não conhece continua
 * aparecendo na tela com a chave crua (ver {@link entidadeLabel}). Sumir com o desconhecido seria
 * esconder produção real, que é o oposto do que esta aba existe para fazer.
 * @type {Readonly<Object<string, string>>}
 */
export const ENTIDADE_LABEL = Object.freeze({
    atlas: 'Atlas',
    map: 'Mapas',
    feature: 'Feições',
    layer: 'Camadas',
    group: 'Grupos de camadas',
    marker3d: 'Marcadores 3D',
    measurement3d: 'Medições 3D',
    viewshed3d: 'Visibilidade 3D',
    cameraPosition3d: 'Câmeras 3D',
    orientation360: 'Orientações 360',
    marker360: 'Marcadores 360',
    mapPosition: 'Enquadramentos de mapa',
    baseLayer: 'Camadas de fundo',
    mapNotes: 'Anotações de mapa',
    gridStyle: 'Estilos de grade',
    mapTemporal: 'Linhas do tempo',
    catalogLayer: 'Camadas do catálogo',
    briefing: 'Briefings',
    slide: 'Slides',
    comment: 'Comentários',
    setting: 'Configurações',
});

/**
 * O nome de um tipo de entidade.
 *
 * O DESCONHECIDO SOBREVIVE COM A CHAVE CRUA, e é decisão: um tipo novo do servidor tem produção de
 * verdade por trás, e trocá-lo por "Outros" o fundiria com os demais desconhecidos numa linha que
 * não localiza nada. Sem chave nenhuma, "Sem tipo" — que é honesto e é raro.
 * @param {*} entidade
 * @returns {string}
 */
export function entidadeLabel(entidade) {
    if (typeof entidade !== 'string') return 'Sem tipo';
    const chave = entidade.trim();
    if (!chave) return 'Sem tipo';
    return ENTIDADE_LABEL[chave] ?? chave;
}

/**
 * A produção por tipo, do maior para o menor, com a fatia de cada um.
 *
 * ORDENAR AQUI E NÃO CONFIAR NA ROTA é a mesma decisão da aba Diagnóstico: a tela promete que a
 * primeira linha é a maior, e a promessa não pode depender de um `ORDER BY` que ninguém aqui
 * verifica. O desempate é pelo RÓTULO, e não pela chave crua, para que a ordem lida seja a ordem
 * vista.
 *
 * O TOTAL DA FATIA É A SOMA DA LISTA, e não `producao.total`: os dois podem divergir (um tipo
 * podado, um recorte do servidor), e uma barra de 140% seria a tela denunciando a si mesma sem
 * explicar nada. A soma própria mantém a barra como proporção do que está desenhado, que é o que
 * ela parece dizer.
 * @param {*} porEntidade
 * @returns {Array<{entidade: string, rotulo: string, total: number, fatia: string|null}>}
 */
export function producaoPorEntidade(porEntidade) {
    if (!Array.isArray(porEntidade)) return [];
    const linhas = porEntidade
        .filter((l) => objeto(l))
        .map((l) => ({
            entidade: typeof l.entidade === 'string' ? l.entidade : '',
            rotulo: entidadeLabel(l.entidade),
            total: numeroOuZero(l.total),
        }));
    const soma = linhas.reduce((acc, l) => acc + l.total, 0);
    return linhas
        .sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
        .map((l) => ({ ...l, fatia: percentualLabel(l.total, soma) }));
}

/** O piso de altura (e de largura) de uma barra com produção: ver {@link geometriaDaSerie}. */
export const PISO_DA_BARRA_PCT = 2;

/** @param {number} n @returns {number} */
function arredondarPct(n) {
    return Math.round(n * 10) / 10;
}

/**
 * A largura da barra de um tipo, em percentual do MAIOR (e não do total).
 *
 * DO MAIOR, PORQUE A BARRA É COMPARAÇÃO e não composição: com vinte tipos, a fatia do total deixa
 * todas as barras invisíveis e a lista deixa de mostrar a única coisa que ela poderia mostrar. A
 * proporção do total continua na tela, em número, ao lado (`fatia`).
 * @param {*} total
 * @param {*} maximo
 * @returns {number} 0 a 100.
 */
export function larguraDaBarra(total, maximo) {
    if (!numeroContavel(maximo) || maximo <= 0) return 0;
    const n = numeroOuZero(total);
    if (n <= 0) return 0;
    return Math.max(PISO_DA_BARRA_PCT, arredondarPct((n / maximo) * 100));
}

// ===== a série diária =====

/**
 * O teto de dias que o preenchimento aceita gerar.
 *
 * ELE EXISTE CONTRA O PAYLOAD ABSURDO, não contra a janela: um `dia` de 1970 ao lado de um de hoje
 * mandaria o preenchimento cunhar vinte mil entradas e travar a aba. O teto é a maior janela do
 * servidor (365 dias) com folga.
 */
export const MAX_DIAS_DA_SERIE = 400;

/**
 * A série diária pronta para desenhar: ordenada, sem dia repetido e SEM BURACO.
 *
 * O PREENCHIMENTO NÃO É REDUNDANTE com o contrato. O servidor promete mandar o zero, e a promessa é
 * exatamente o tipo de coisa que se quebra numa otimização de consulta ("por que mandar linhas
 * vazias?"). O custo de preencher é nada; o custo de confiar é um gráfico em que o dia parado
 * simplesmente não existe, e um buraco se lê como dado que não chegou — a afirmação oposta à
 * verdadeira.
 *
 * DIA REPETIDO SOMA, e não sobrescreve: duas linhas para o mesmo dia são duas parcelas da mesma
 * produção, e ficar com a última perderia a outra em silêncio.
 *
 * DIA INVÁLIDO SAI, e não vira zero: um rótulo que não é data não tem posição no eixo, e inventar
 * uma seria desenhar produção no dia errado.
 * @param {*} porDia
 * @returns {Array<{dia: string, total: number}>}
 */
export function preencherDias(porDia) {
    if (!Array.isArray(porDia)) return [];
    const soma = new Map();
    for (const linha of porDia) {
        if (!objeto(linha)) continue;
        const p = partesDoDia(linha.dia);
        if (!p) continue;
        const chave = linha.dia.trim();
        soma.set(chave, (soma.get(chave) ?? 0) + numeroOuZero(linha.total));
    }
    // ISO de largura fixa ordena lexicograficamente na mesma ordem em que ordena cronologicamente,
    // e é por isso que o `sort` de string basta aqui.
    const dias = [...soma.keys()].sort();
    if (dias.length === 0) return [];
    const primeiro = dias[0];
    const ultimo = dias[dias.length - 1];
    const vao = diasEntre(partesDoDia(primeiro).ms, partesDoDia(ultimo).ms) ?? 0;
    // Fora do teto o preenchimento não acontece, e a série sai como veio (ordenada e somada): é
    // melhor um gráfico com buraco que uma aba travada, e o caso só existe com payload absurdo.
    if (vao > MAX_DIAS_DA_SERIE) {
        return dias.map((dia) => ({ dia, total: soma.get(dia) }));
    }
    const serie = [];
    let cursor = primeiro;
    while (cursor && cursor <= ultimo) {
        serie.push({ dia: cursor, total: soma.get(cursor) ?? 0 });
        cursor = diaSeguinte(cursor);
    }
    return serie;
}

/**
 * A geometria do gráfico: uma barra por dia, com a altura em percentual da mais alta.
 *
 * TRÊS INVARIANTES, e cada um existe contra uma leitura errada específica:
 *
 *   1. **`total > 0` nunca desenha altura zero.** Um dia com uma operação ao lado de um dia com dez
 *      mil arredondaria para zero e ficaria idêntico ao dia parado. Daí o piso
 *      ({@link PISO_DA_BARRA_PCT}), que mente sobre a MAGNITUDE (2% para um valor de 0,01%) e diz a
 *      verdade sobre a EXISTÊNCIA, que é a pergunta que a barra mínima responde.
 *   2. **`total === 0` desenha altura zero E se marca `zero`.** A folha de estilo precisa da marca
 *      para pousar a barra na linha de base em vez de sumir com ela: o dia parado tem de ocupar a
 *      largura dele no eixo.
 *   3. **Série toda zerada tem `maximo === 0` e nenhuma barra.** Não se normaliza por zero, e não
 *      se inventa uma altura: a tela desenha a linha de base e diz em palavras que o período não
 *      teve produção.
 *
 * O RÓTULO É RALEADO, e não escrito em todas as barras: noventa rótulos de cinco caracteres em
 * setecentos pixels viram uma tarja preta. Primeiro e último sempre aparecem, porque são as pontas
 * do período; os do meio saem espaçados por igual.
 *
 * O `title` DE CADA BARRA CHEGA DE FORA, e é o único parâmetro desta função que não é geometria.
 * A razão é que a aba desenha TRÊS séries com a mesma matemática e três substantivos diferentes
 * (operações, sessões, telas), e a alternativa seria copiar a função inteira por causa de uma
 * palavra — que é como uma delas acabaria com o rótulo da outra depois de um "corrigir aqui".
 *
 * @param {*} serie - Já passada por {@link preencherDias}.
 * @param {{maxRotulos?: number, tituloDe?: (dia: string, total: number) => string}} [opts]
 * @returns {{maximo: number, dias: number, barras: Array<{dia: string, total: number, alturaPct: number, zero: boolean, rotulo: string, titulo: string, mostrarRotulo: boolean}>}}
 */
export function geometriaDaSerie(serie, { maxRotulos = 8, tituloDe = tituloDeBarra } = {}) {
    const linhas = Array.isArray(serie) ? serie.filter((l) => objeto(l) && diaValido(l.dia)) : [];
    const dias = linhas.length;
    if (dias === 0) return { maximo: 0, dias: 0, barras: [] };
    const maximo = linhas.reduce((acc, l) => Math.max(acc, numeroOuZero(l.total)), 0);
    const teto = Number.isFinite(maxRotulos) && maxRotulos >= 2 ? Math.floor(maxRotulos) : 2;
    // O PASSO é escolhido para que caibam no máximo `teto` rótulos, sempre incluindo o índice 0; o
    // último entra por nome próprio, para que a ponta direita nunca fique sem data.
    const passo = Math.max(1, Math.ceil(dias / teto));
    const barras = linhas.map((l, i) => {
        const total = numeroOuZero(l.total);
        const zero = total <= 0;
        const alturaPct = zero || maximo <= 0
            ? 0
            : Math.max(PISO_DA_BARRA_PCT, arredondarPct((total / maximo) * 100));
        return {
            dia: l.dia,
            total,
            alturaPct,
            zero,
            rotulo: rotuloCurtoDeDia(l.dia),
            titulo: (typeof tituloDe === 'function' ? tituloDe : tituloDeBarra)(l.dia, total),
            mostrarRotulo: i === 0 || i === dias - 1 || i % passo === 0,
        };
    });
    return { maximo, dias, barras };
}

/**
 * O `title` de uma barra: a data inteira e a contagem por extenso. O rótulo do eixo tem cinco
 * caracteres e o ano não cabe nele; aqui cabe.
 * @param {*} dia
 * @param {*} total
 * @returns {string}
 */
export function tituloDeBarra(dia, total) {
    const data = rotuloLongoDeDia(dia);
    const n = numeroOuZero(total);
    const quanto = n === 1 ? '1 operação' : `${numeroLabel(n)} operações`;
    return data ? `${data}: ${quanto}` : quanto;
}

/**
 * O resumo da série, que é o que a legenda do gráfico diz.
 *
 * A MÉDIA É SOBRE OS DIAS DESENHADOS, e não sobre os dias pedidos: com o horizonte encurtado os
 * dois divergem, e dividir por dias que não estão no gráfico produziria uma média que não
 * corresponde a nenhuma barra. Quem conta a diferença é o aviso de horizonte.
 * @param {*} serie
 * @returns {{dias: number, total: number, media: number|null, pico: {dia: string, total: number}|null}}
 */
export function resumoDaSerie(serie) {
    const linhas = Array.isArray(serie) ? serie.filter((l) => objeto(l) && diaValido(l.dia)) : [];
    if (linhas.length === 0) return { dias: 0, total: 0, media: null, pico: null };
    let total = 0;
    let pico = null;
    for (const l of linhas) {
        const n = numeroOuZero(l.total);
        total += n;
        // O primeiro pico vence o empate: com dois dias iguais, o mais antigo é o que começou.
        if (!pico || n > pico.total) pico = { dia: l.dia, total: n };
    }
    return { dias: linhas.length, total, media: total / linhas.length, pico };
}

/**
 * A legenda do gráfico, a partir do resumo.
 * @param {*} resumo
 * @returns {string}
 */
export function resumoDaSerieLabel(resumo) {
    const dias = numeroOuZero(resumo?.dias);
    if (dias === 0) return '';
    const partes = [dias === 1 ? '1 dia desenhado' : `${numeroLabel(dias)} dias desenhados`];
    partes.push(`média de ${mediaLabel(resumo?.media)} por dia`);
    const pico = resumo?.pico;
    if (pico && numeroOuZero(pico.total) > 0) {
        partes.push(`pico de ${numeroLabel(pico.total)} em ${rotuloLongoDeDia(pico.dia)}`);
    }
    return `${partes.join(', ')}.`;
}

// ===== os atlas mais ativos =====

/** Quantos atlas a lista mostra. Dez é o que cabe sem virar uma segunda tabela de tudo. */
export const LIMITE_TOP = 10;

/**
 * Os atlas mais ativos, do maior para o menor, cortados no limite.
 *
 * ORDENAR E CORTAR AQUI pela mesma razão de `producaoPorEntidade`. O desempate é pelo NOME, para
 * que duas leituras da mesma lista desenhem a mesma ordem: uma tabela que se remexe sozinha entre
 * dois cliques no seletor faz a pessoa desconfiar do dado certo.
 * @param {*} top
 * @param {number} [limite]
 * @returns {Array<{id: string, nome: string, dono: string, operacoes: number}>}
 */
export function ordenarTopAtlas(top, limite = LIMITE_TOP) {
    if (!Array.isArray(top)) return [];
    const teto = Number.isFinite(limite) && limite > 0 ? Math.floor(limite) : LIMITE_TOP;
    return top
        .filter((l) => objeto(l))
        .map((l) => ({
            id: typeof l.id === 'string' ? l.id : '',
            nome: atlasNomeLabel(l),
            dono: donoLabel(l),
            operacoes: numeroOuZero(l.operacoes),
        }))
        .sort((a, b) => b.operacoes - a.operacoes || a.nome.localeCompare(b.nome, 'pt-BR'))
        .slice(0, teto);
}

/**
 * O nome de um atlas na lista. Atlas sem nome existe (o campo é editável e aceita o vazio), e uma
 * célula em branco se lê como coluna quebrada.
 * @param {*} item
 * @returns {string}
 */
export function atlasNomeLabel(item) {
    const nome = typeof item?.nome === 'string' ? item.nome.trim() : '';
    return nome || 'Atlas sem nome';
}

/**
 * O dono de um atlas.
 *
 * "não informado" E NÃO UM TRAVESSÃO: todo atlas tem dono, então a ausência aqui é do servidor e
 * não do fato, e o travessão sugeriria um atlas órfão que não existe.
 * @param {*} item
 * @returns {string}
 */
export function donoLabel(item) {
    const dono = typeof item?.dono === 'string' ? item.dono.trim() : '';
    return dono || 'não informado';
}

// ===== as frases da aba =====

/** @returns {string} */
export function tabSubtitle() {
    return 'Quem usa o EBGeo, o que se produz nele e quanto, no período escolhido.';
}

/** @returns {string} */
export function janelaLabel() {
    return 'Período';
}

/**
 * A dica do seletor, e ela existe para dizer a coisa que a tela inteira pode ser lida ao contrário:
 * dois dos números NÃO são do período.
 * @returns {string}
 */
export function janelaHint() {
    return 'O período vale para tudo abaixo, menos "Contas ativas" e "Atlas existentes", que são o '
        + 'que existe hoje. Cada número diz embaixo de si a qual dos dois ele pertence.';
}

/** @param {*} desde @param {{timeZone?: string}} [opts] @returns {string} */
export function periodoLabel(desde, { timeZone } = {}) {
    const data = dataLocal(desde, { timeZone });
    return data ? `De ${data} até hoje.` : '';
}

/** @returns {string} */
export function falhaNotice() {
    return 'Não foi possível ler o resumo de uso.';
}

/** @returns {string} */
export function vazioNotice() {
    return 'Nenhum uso registrado ainda: não há atlas, ninguém entrou e nada foi produzido.';
}

/** @returns {string} */
export function vazioHint() {
    return 'É o estado de uma instalação nova. Assim que alguém criar o primeiro atlas, os números '
        + 'e o gráfico aparecem aqui.';
}

/** @param {*} janela @returns {string} */
export function periodoParadoNotice(janela) {
    return `Nenhum movimento ${janelaEmPalavras(janela)}: ninguém entrou, nada foi criado e nada `
        + 'foi produzido.';
}

/** @returns {string} */
export function periodoParadoHint() {
    return 'O acervo continua de pé, e os dois números de hoje acima o mostram. Amplie o período '
        + 'para alcançar o último movimento.';
}

/** @param {*} janela @returns {string} */
export function producaoVaziaNotice(janela) {
    return `Nenhuma operação registrada ${janelaEmPalavras(janela)}.`;
}

/** @param {*} janela @returns {string} */
export function topVazioNotice(janela) {
    return `Nenhum atlas recebeu edição ${janelaEmPalavras(janela)}.`;
}

/** @returns {string} */
export function topHint() {
    return 'A contagem é de operações de sync recebidas pelo servidor, e não de horas de uso.';
}

/** @returns {string} */
export function graficoLegenda() {
    return 'Cada barra é um dia. Dia sem produção fica na linha de base, e não some do eixo.';
}

// ===== o funil de entrada =====

/**
 * Os três passos do funil, na ordem em que se desce.
 *
 * O REGIME DOS TRÊS É `PERIODO`, e é preciso ler o que isso significa aqui, porque não é o mesmo
 * que nos ladrilhos: o que pertence ao período é a COORTE (quem criou conta nele), e não o
 * momento em que a pessoa desceu o degrau seguinte. Alguém que se cadastrou no último dia da
 * janela e criou o atlas depois dela CONTA no segundo passo, de propósito. A alternativa fecharia
 * a conversão no fim do período e faria a coorte mais recente parecer a que menos converte, quando
 * ela é apenas a que teve menos tempo. É a razão de {@link funilHint} existir.
 *
 * `mediana` É A CHAVE DA MEDIANA NO PAYLOAD, e o primeiro passo não tem nenhuma: a distância entre
 * o cadastro e ele próprio é zero por definição, e desenhar "mediana de 0 h" ali seria uma medida
 * inventada com cara de resultado.
 *
 * `denominador` É CAMPO E NÃO DERIVAÇÃO DO RÓTULO, e a razão é gramatical, a mesma que
 * `horizonteEncurtadoNotice` paga logo acima. Os rótulos estão na terceira pessoa do PLURAL
 * ("Criaram conta"), e a conversão os encaixa depois de "de quem", que em português rege
 * SINGULAR: derivar a frase minusculando o rótulo produz "de quem criaram conta". Foi MEDIDO,
 * saiu agramatical na primeira rodada, e nenhum teste lê português sozinho, então o degrau novo
 * que alguém acrescentar tem de trazer a própria flexão em vez de herdar uma regra que não
 * existe.
 *
 * `dependeDaProducao` MARCA O ÚNICO PASSO COM HORIZONTE. Cadastro e atlas saem de `users` e
 * `atlas`, que não são podáveis; a primeira edição sai de `operations`, que é. É esse campo, e não
 * a posição na lista, que decide qual passo ganha a ressalva de piso: um passo novo entre os dois
 * primeiros herdaria a ressalva errada se ela fosse "o último".
 * @type {ReadonlyArray<{chave: string, rotulo: string, denominador: string, regime: string, detalhe: string, mediana: string|null, dependeDaProducao: boolean}>}
 */
export const PASSOS_DO_FUNIL = Object.freeze([
    Object.freeze({
        chave: 'cadastraram',
        rotulo: 'Criaram conta',
        denominador: 'criou conta',
        regime: REGIME.PERIODO,
        detalhe: 'contas criadas no período',
        mediana: null,
        dependeDaProducao: false,
    }),
    Object.freeze({
        chave: 'criaramAtlas',
        rotulo: 'Criaram o primeiro atlas',
        denominador: 'criou o primeiro atlas',
        regime: REGIME.PERIODO,
        detalhe: 'dessas contas, as que passaram a ser donas de ao menos um atlas',
        mediana: 'horasAteAtlas',
        dependeDaProducao: false,
    }),
    Object.freeze({
        chave: 'produziram',
        rotulo: 'Fizeram a primeira edição',
        denominador: 'fez a primeira edição',
        regime: REGIME.PERIODO,
        detalhe: 'dessas, as que geraram ao menos uma operação de sync depois de criar o atlas',
        mediana: 'horasAteProducao',
        dependeDaProducao: true,
    }),
]);

/** A chave do horizonte que limita o funil. Ver {@link PASSOS_DO_FUNIL}. */
export const FONTE_DO_PISO_DO_FUNIL = 'operacoesDesde';

/**
 * A mediana de horas até um passo, em palavras.
 *
 * `null` E NÃO TRAVESSÃO quando não há mediana, e a diferença é de desenho: a tela simplesmente
 * NÃO escreve a linha, em vez de escrever um travessão que se lê como "medimos e não deu nada".
 * Ninguém ter chegado ao passo é a informação, e ela já está na contagem ao lado.
 *
 * ZERO É MEDIDA E APARECE ("mediana de 0 h"): quem cria o atlas no mesmo minuto do cadastro é o
 * caso mais interessante da tabela, não um vazio.
 *
 * A UNIDADE É `h` E NÃO "horas" por uma razão gramatical e não de espaço: símbolo de unidade não
 * flexiona, então "1 h" e "2 h" saem certos sem um ramo de plural que alguém teria de manter.
 * @param {*} horas
 * @returns {string|null}
 */
export function medianaLabel(horas) {
    if (!numeroContavel(horas)) return null;
    return `mediana de ${mediaLabel(horas)} h`;
}

/**
 * A conversão de um passo em relação ao ANTERIOR, com o denominador NOMEADO.
 *
 * O DENOMINADOR VAI NA FRASE, e é isso que a torna legível. "40%" sozinho num funil é ambíguo
 * entre "40% de quem se cadastrou" e "40% de quem criou o primeiro atlas", e os dois números
 * existem e são diferentes. Escrever de quem é a porcentagem custa cinco palavras e remove a
 * única leitura errada possível.
 *
 * PASSO ANTERIOR VAZIO NÃO VIRA 0%: sem denominador não há fração, e {@link percentualLabel}
 * devolve `null`, que a tela não desenha. "0% de quem criou conta" quando ninguém criou conta é
 * uma afirmação sobre o conjunto vazio.
 * @param {*} total - a contagem deste passo
 * @param {*} anterior - a contagem do passo anterior
 * @param {*} denominador - a flexão SINGULAR do passo anterior ('criou conta'), do campo
 *   `denominador` de {@link PASSOS_DO_FUNIL} e NUNCA derivada do rótulo
 * @returns {string|null}
 */
export function conversaoLabel(total, anterior, denominador) {
    const pct = percentualLabel(total, anterior);
    if (pct === null) return null;
    const nome = typeof denominador === 'string' ? denominador.trim() : '';
    if (!nome) return pct;
    return `${pct} de quem ${nome}`;
}

/**
 * Os três passos prontos para desenhar.
 *
 * A LARGURA É FRAÇÃO DO PRIMEIRO PASSO, e não do anterior: é ela que faz o funil PARECER um
 * funil. A conversão em palavras é do anterior (ver {@link conversaoLabel}), e as duas coexistem
 * porque respondem a perguntas diferentes: a barra mostra quanto sobrou do topo, e a frase mostra
 * quanto passou do degrau de cima.
 *
 * O PISO É PROPRIEDADE DO PASSO, e chega de fora: quem sabe o estado do horizonte é a aba, que já
 * o leu por {@link estadoDaFonte}. Recalculá-lo aqui exigiria receber `desde` e `horizonte` e
 * abriria a segunda leitura que {@link estadoDaFonte} existe para impedir.
 * @param {*} funil - o bloco `funil` da resposta
 * @param {{piso?: boolean}} [opts] - `piso` quando o registro de produção não cobre a janela
 * @returns {Array<{chave: string, rotulo: string, regime: string, detalhe: string, total: number, texto: string, largura: number, conversao: string|null, mediana: string|null, piso: boolean}>}
 */
export function funilPassos(funil, { piso = false } = {}) {
    const fonte = objeto(funil) ? funil : {};
    const topo = numeroOuZero(fonte[PASSOS_DO_FUNIL[0].chave]);
    return PASSOS_DO_FUNIL.map((passo, i) => {
        const total = numeroOuZero(fonte[passo.chave]);
        const anterior = i === 0 ? null : PASSOS_DO_FUNIL[i - 1];
        return {
            chave: passo.chave,
            rotulo: passo.rotulo,
            regime: passo.regime,
            detalhe: passo.detalhe,
            total,
            texto: numeroLabel(fonte[passo.chave]),
            largura: larguraDaBarra(total, topo),
            conversao: anterior
                ? conversaoLabel(total, numeroOuZero(fonte[anterior.chave]), anterior.denominador)
                : null,
            mediana: passo.mediana ? medianaLabel(fonte[passo.mediana]) : null,
            piso: piso && passo.dependeDaProducao,
        };
    });
}

/**
 * A ressalva do passo que depende do registro de produção, a partir do estado do horizonte.
 *
 * ELA REUSA OS QUATRO ESTADOS DE {@link HORIZONTE} em vez de inventar um vocabulário próprio, e a
 * consequência que importa é o DESCONHECIDO: um servidor que não informou o alcance também produz
 * ressalva, porque não afirmar que o passo está completo é diferente de afirmar que está. A falha
 * é FECHADA, e é o inverso do que se escreve sem pensar (`estado === ENCURTADO`).
 *
 * OS DOIS PRIMEIROS PASSOS SÃO NOMEADOS COMO ÍNTEGROS em cada frase, porque uma ressalva que não
 * localiza o estrago ensina a desconfiar do funil inteiro, e dois terços dele estão certos.
 * @param {*} estado - um valor de {@link HORIZONTE}
 * @returns {string} Vazio quando não há ressalva.
 */
export function funilPisoNotice(estado) {
    if (estado === HORIZONTE.ENCURTADO) {
        return 'O último passo é um PISO: o registro de produção não alcança o começo do período, '
            + 'então quem editou antes disso não aparece nele, e a conversão desenhada é a menor '
            + 'possível. Os dois primeiros passos não dependem dele e estão inteiros.';
    }
    if (estado === HORIZONTE.VAZIO) {
        return 'Não há uma linha sequer no registro de produção, então o último passo está zerado '
            + 'por essa razão, e não porque ninguém editou. Os dois primeiros passos não '
            + 'dependem dele e continuam valendo.';
    }
    if (estado === HORIZONTE.DESCONHECIDO) {
        return 'O servidor não informou até onde o registro de produção alcança, então o último '
            + 'passo é um piso: não dá para afirmar que ele está completo.';
    }
    return '';
}

/**
 * Se o último passo do funil precisa ser lido como piso.
 *
 * TUDO QUE NÃO É `COBRE` É PISO. Ver {@link funilPisoNotice} sobre a falha fechada.
 * @param {*} estado - um valor de {@link HORIZONTE}
 * @returns {boolean}
 */
export function funilTemPiso(estado) {
    return estado !== HORIZONTE.COBRE;
}

/** @returns {string} */
export function funilTitulo() {
    return 'Funil de entrada';
}

/** @param {*} janela @returns {string} */
export function funilSubtitulo(janela) {
    return `De quem criou conta ${janelaEmPalavras(janela)}, quantos chegaram ao primeiro atlas e `
        + 'à primeira edição';
}

/**
 * A ressalva que a tela inteira pode ser lida ao contrário: o período define QUEM entra no funil,
 * e não até quando a conversão é contada.
 * @returns {string}
 */
export function funilHint() {
    return 'O período escolhe a coorte (quem criou conta nele); os dois passos seguintes contam '
        + 'até hoje, mesmo que a pessoa tenha chegado lá depois do fim do período. Sem isso, a '
        + 'coorte mais recente pareceria a que menos converte só por ter tido menos tempo.';
}

/**
 * A nota que declara o que o funil NÃO conta, e ela não é opcional: o número pareceria baixo sem
 * explicação nenhuma numa instalação em que trabalhar no atlas de outra pessoa é o normal.
 * @returns {string}
 */
export function funilEscopoHint() {
    return 'O terceiro passo conta a edição no atlas que a própria pessoa criou. Quem só edita '
        + 'atlas de outra pessoa não aparece nele, e é essa restrição que mantém cada passo como '
        + 'subconjunto do anterior.';
}

/**
 * Se o servidor INFORMOU o bloco do funil.
 *
 * BLOCO AUSENTE NÃO É ZERO, e colapsar os dois é o mesmo defeito que `estadoDoHorizonte` existe
 * para impedir, uma seção abaixo. Um servidor de versão anterior não manda `funil`, e a leitura
 * ingênua (três zeros, logo "nenhuma conta foi criada no período") CONTRADIZ o ladrilho "Contas
 * novas" que está na mesma tela, com o número certo, algumas linhas acima. Duas afirmações
 * opostas na mesma tela custam mais que uma seção que não aparece: elas ensinam a não acreditar
 * em nenhuma das duas.
 * @param {*} funil
 * @returns {boolean}
 */
export function funilInformado(funil) {
    return objeto(funil);
}

/**
 * A frase do bloco que o servidor não informou.
 *
 * É NOTA DE VOZ BAIXA, e não aviso, pela mesma régua de {@link horizonteDesconhecidoNotice}:
 * versão anterior do servidor não é incidente, e alarmar a cada carga ensina a ignorar o alarme.
 * @returns {string}
 */
export function funilNaoInformadoNotice() {
    return 'O servidor não informou o funil de entrada, então ele não é desenhado aqui. '
        + 'Daqui não dá para dizer se é um servidor de versão anterior ou se ele não '
        + 'conseguiu montar o bloco desta vez, e nenhum dos dois quer dizer que ninguém '
        + 'tenha criado conta no período.';
}

/** @param {*} janela @returns {string} */
export function funilVazioNotice(janela) {
    return `Nenhuma conta foi criada ${janelaEmPalavras(janela)}, então não há funil para `
        + 'desenhar.';
}

/** @returns {string} */
export function funilVazioHint() {
    return 'Amplie o período para alcançar a última leva de cadastros.';
}

// ===== a coorte de retenção =====

/**
 * As colunas da tabela de retenção, uma por semana acompanhada.
 *
 * QUATRO SEMANAS, e o número é contrato com o servidor (`SEMANAS_DE_RETENCAO`, em
 * `backend/src/modules/uso/uso.service.js`, mais os `w1`..`w4` da consulta): esta lista lê o array
 * `retidos` POR POSIÇÃO, então uma coluna a mais aqui leria `undefined` e uma a menos esconderia
 * uma semana que o servidor mandou.
 *
 * O RÓTULO É "S+1" E NÃO "Semana 1" por causa da largura: a tabela tem cinco colunas e o cabeçalho
 * não pode ser mais largo que a célula. O que a coluna significa fica no `title`, que é
 * `detalhe`.
 * @type {ReadonlyArray<{semana: number, rotulo: string, detalhe: string}>}
 */
export const COLUNAS_DE_RETENCAO = Object.freeze([
    Object.freeze({ semana: 1, rotulo: 'S+1', detalhe: 'entraram na semana seguinte à do cadastro' }),
    Object.freeze({ semana: 2, rotulo: 'S+2', detalhe: 'entraram na segunda semana após o cadastro' }),
    Object.freeze({ semana: 3, rotulo: 'S+3', detalhe: 'entraram na terceira semana após o cadastro' }),
    Object.freeze({ semana: 4, rotulo: 'S+4', detalhe: 'entraram na quarta semana após o cadastro' }),
]);

/** O texto de uma célula cuja semana ainda não terminou. */
export const CELULA_ABERTA = 'ainda não';

/**
 * O rótulo de uma coorte: a semana em que aquelas contas nasceram.
 *
 * O SERVIDOR MANDA A SEGUNDA-FEIRA COMO 'AAAA-MM-DD', e o rótulo é montado à mão por
 * {@link rotuloLongoDeDia} pela mesma razão dele: passar essa string por uma `Date` faria a
 * semana recuar um dia para quem está a oeste de Greenwich, e a coorte passaria a ser nomeada
 * pelo domingo anterior.
 * @param {*} semana
 * @returns {string} Vazio quando a semana não se resolve.
 */
export function rotuloDeCoorte(semana) {
    const data = rotuloLongoDeDia(semana);
    return data ? `Semana de ${data}` : '';
}

/**
 * Uma célula da tabela, nos TRÊS estados que ela tem.
 *
 * OS TRÊS SÃO DIFERENTES E SÓ UM DELES É NÚMERO, e colapsá-los é o defeito desta seção:
 *
 *   - `null` é o contrato dizendo "esta semana ainda não terminou por inteiro". Ela ainda vai
 *     crescer, então publicá-la como número final ensinaria a desconfiar da tabela quando o valor
 *     mudasse na carga seguinte; e um ZERO ali se lê como abandono, que é a afirmação oposta.
 *   - um número é a medida, e é PISO (ver {@link retencaoHint}).
 *   - qualquer outra coisa (a posição que o servidor não mandou, lixo) é DESCONHECIDA e vira
 *     travessão. Ela não pode virar "ainda não", que seria inventar o motivo do vazio.
 * @param {*} valor
 * @param {*} cadastrados
 * @param {{semana: number, detalhe: string}} coluna
 * @returns {{semana: number, texto: string, percentual: string|null, aberta: boolean, desconhecida: boolean, titulo: string}}
 */
export function celulaDeRetencao(valor, cadastrados, coluna) {
    const quantas = numeroOuZero(cadastrados);
    const detalhe = typeof coluna?.detalhe === 'string' ? coluna.detalhe : '';
    const semana = typeof coluna?.semana === 'number' ? coluna.semana : 0;
    if (valor === null) {
        return {
            semana,
            texto: CELULA_ABERTA,
            percentual: null,
            aberta: true,
            desconhecida: false,
            titulo: 'Esta semana ainda não passou por inteiro, e o número só fecha quando ela '
                + 'passa: publicá-lo agora seria mostrar um valor que ainda vai crescer.',
        };
    }
    if (!numeroContavel(valor)) {
        return {
            semana,
            texto: '—',
            percentual: null,
            aberta: false,
            desconhecida: true,
            titulo: 'O servidor não informou esta semana.',
        };
    }
    return {
        semana,
        texto: `${numeroLabel(valor)} de ${numeroLabel(quantas)}`,
        percentual: percentualLabel(valor, quantas),
        aberta: false,
        desconhecida: false,
        titulo: `Pelo menos ${numeroLabel(valor)} de ${numeroLabel(quantas)}: ${detalhe}.`,
    };
}

/**
 * As linhas da tabela de retenção, da coorte mais antiga para a mais nova.
 *
 * A ORDEM É CRESCENTE de propósito, e é a que o servidor já devolve. A coorte mais antiga é a
 * única com as quatro semanas fechadas, e é ela que serve de referência para ler as de cima;
 * inverter a ordem poria no topo justamente a linha com mais células abertas, e a tabela se leria
 * como um instrumento que não mede nada.
 *
 * SEMANA QUE NÃO SE RESOLVE SAI DA LISTA, e não vira linha sem rótulo: uma coorte que a tela não
 * consegue nomear não tem como ser comparada com as outras.
 * @param {*} semanas - o array `retencao.semanas` da resposta
 * @returns {Array<{semana: string, rotulo: string, cadastrados: number, cadastradosTexto: string, celulas: Array<Object>}>}
 */
export function linhasDeRetencao(semanas) {
    if (!Array.isArray(semanas)) return [];
    return semanas
        .filter((l) => objeto(l) && diaValido(l.semana))
        .map((l) => {
            const cadastrados = numeroOuZero(l.cadastrados);
            const retidos = Array.isArray(l.retidos) ? l.retidos : [];
            return {
                semana: l.semana.trim(),
                rotulo: rotuloDeCoorte(l.semana),
                cadastrados,
                cadastradosTexto: numeroLabel(l.cadastrados),
                celulas: COLUNAS_DE_RETENCAO.map(
                    (c, i) => celulaDeRetencao(retidos[i], cadastrados, c)
                ),
            };
        })
        // ISO de largura fixa ordena lexicograficamente na mesma ordem em que ordena
        // cronologicamente, como na série diária.
        .sort((a, b) => (a.semana < b.semana ? -1 : a.semana > b.semana ? 1 : 0));
}

/** @returns {string} */
export function retencaoTitulo() {
    return 'Retenção por semana de cadastro';
}

/** @param {*} janela @returns {string} */
export function retencaoSubtitulo(janela) {
    return `De quem criou conta em cada semana ${janelaEmPalavras(janela)}, quantos voltaram a `
        + 'entrar nas quatro semanas seguintes';
}

/**
 * A ressalva da tabela, e ela tem DUAS metades que não podem ser fundidas.
 *
 * A PRIMEIRA É O PISO, e ele NÃO vem de poda: `audit_trail` não é podada, então esta seção não
 * tem horizonte nenhum a descontar. O que ela tem é o `LOGIN` best-effort: a linha da trilha é
 * escrita fora do caminho da requisição, e uma falha ali some da conta. Dizer "piso" sem dizer de
 * onde ele vem faria a pessoa procurar poda que não houve.
 *
 * A SEGUNDA É A ÂNCORA. A semana é contada a partir da SEGUNDA-FEIRA da coorte, e não do instante
 * de cada cadastro, e sem isso "S+1" parece prometer sete dias corridos por pessoa.
 * @returns {string}
 */
export function retencaoHint() {
    return 'Cada célula é "pelo menos": o login é registrado em best-effort, então uma falha de '
        + 'escrita da trilha some da conta. As semanas são contadas a partir da segunda-feira da '
        + 'coorte, e não do instante de cada cadastro, para que a mesma célula signifique o mesmo '
        + 'intervalo para todo mundo da linha.';
}

/**
 * Se o servidor INFORMOU o bloco da retenção.
 *
 * O PISO DE RECONHECIMENTO É `semanas` SER UM ARRAY, e não o bloco existir: um `retencao` sem a
 * lista não é uma coorte vazia, é uma resposta que esta tela não sabe ler. Ver
 * {@link funilInformado} sobre por que a lista vazia e o bloco ausente não podem ter a mesma
 * frase.
 * @param {*} retencao
 * @returns {boolean}
 */
export function retencaoInformada(retencao) {
    return Array.isArray(objeto(retencao) ? retencao.semanas : undefined);
}

/**
 * A frase da tabela que o servidor não informou. Nota de voz baixa, como a irmã do funil.
 * @returns {string}
 */
export function retencaoNaoInformadaNotice() {
    return 'O servidor não informou a retenção por semana de cadastro, então a tabela não é '
        + 'desenhada aqui. '
        + 'Daqui não dá para dizer se é um servidor de versão anterior ou se ele não '
        + 'conseguiu montar o bloco desta vez, e nenhum dos dois quer dizer que ninguém '
        + 'tenha criado conta no período.';
}

/** @param {*} janela @returns {string} */
export function retencaoVaziaNotice(janela) {
    return `Nenhuma conta foi criada ${janelaEmPalavras(janela)}, então não há coorte para `
        + 'acompanhar.';
}

/** @returns {string} */
export function retencaoVaziaHint() {
    return 'A primeira linha aparece na semana em que alguém criar conta.';
}

/** O cabeçalho da coluna que nomeia a coorte. @returns {string} */
export function retencaoColunaCoorte() {
    return 'Coorte';
}

/** O cabeçalho da coluna do tamanho da coorte. @returns {string} */
export function retencaoColunaTamanho() {
    return 'Contas';
}

// =================================================================================================
// AS QUATRO SEÇÕES DE USO DO PRODUTO
//
// ELAS SÃO A ÚNICA PARTE DESTA ABA QUE VEM DE INSTRUMENTAÇÃO DO CLIENTE, e essa é a diferença que
// atravessa tudo o que vem daqui para baixo. As seções acima contam o que o SERVIDOR já registrava
// (operações de sync, trilha de auditoria, linhas de `users` e `atlas`): elas medem o que
// aconteceu. Estas quatro contam o que NAVEGADORES RELATARAM, e por isso um zero aqui tem dois
// sentidos que a tela não consegue separar sozinha — ninguém fez, ou ninguém conseguiu contar.
//
// TRÊS CONSEQUÊNCIAS QUE PRECISAM ESTAR ESCRITAS NA TELA, e não só aqui:
//
//   1. **NÃO HÁ FILA DO LADO DO USO** (`session/uso-lote.js`), então um lote que não sai morre.
//      Toda contagem daqui é um PISO.
//   2. **A INSTRUMENTAÇÃO TEM IDADE**, e ela é mais nova que qualquer outra fonte desta aba. Pedir
//      90 dias a uma instrumentação de uma semana devolve uma semana, e o gráfico de sessões
//      pareceria uma queda catastrófica ao lado de um gráfico de produção inteiro. É o que
//      {@link usoHorizonteNotice} diz.
//   3. **A TELA DE INDISPONIBILIDADE CONTA MENOS DO QUE O NOME PROMETE.** Ver
//      {@link disponibilidadeHint}: com o servidor fora, a descarga que aquela tela dispara falha
//      por definição.
// =================================================================================================

/**
 * A chave do horizonte que limita as quatro seções de uso.
 *
 * ELA NÃO É UMA QUINTA ENTRADA DE {@link FONTES_DE_HORIZONTE}, e a recusa é deliberada. Aquelas
 * duas fontes falam de PODA: as frases delas dizem "ou o histórico foi apagado por inteiro", e
 * `operations` e `audit_trail` são de fato podáveis. O horizonte do uso não é poda, é IDADE: a
 * instrumentação nasceu num dia, e antes dele não havia o que registrar. Pôr as duas coisas sob a
 * mesma frase mandaria o administrador procurar um expurgo que nunca houve, que é exatamente a
 * classe de erro que o aviso de horizonte existe para impedir.
 */
export const FONTE_DO_HORIZONTE_DE_USO = 'usoDesde';

/**
 * A frase do alcance das quatro seções de uso, a partir do estado do horizonte.
 *
 * OS QUATRO ESTADOS DE {@link HORIZONTE} SÃO REUSADOS, e o que muda é só o que cada um significa
 * aqui. `COBRE` não desenha nada (é o caso normal, e um aviso a cada carga vira ruído);
 * `ENCURTADO` diz desde quando se mede; `VAZIO` diz que nenhum navegador relatou ainda, que é o
 * estado de uma instalação recém-atualizada; `DESCONHECIDO` é o servidor de versão anterior, e é
 * a única das quatro em que a tela não pode afirmar nada.
 * @param {*} estado - Um valor de {@link HORIZONTE}.
 * @param {Object} [opcoes]
 * @param {*} [opcoes.alcance] - Epoch ms do começo do dado.
 * @param {*} [opcoes.janela]
 * @param {string} [opcoes.timeZone]
 * @returns {string} Vazio quando não há o que dizer.
 */
export function usoHorizonteNotice(estado, { alcance, janela, timeZone } = {}) {
    if (estado === HORIZONTE.ENCURTADO) {
        const data = dataLocal(alcance, { timeZone });
        const desde = data ? ` desde ${data}` : '';
        return `O uso do produto é medido${desde}, e você pediu ${janelaEmPalavras(janela)}: as `
            + 'quatro seções abaixo cobrem só o trecho medido. Um começo baixo aqui é a idade da '
            + 'medição, e não uma queda de uso.';
    }
    if (estado === HORIZONTE.VAZIO) {
        return 'Nenhum navegador relatou uso ainda. É o estado de uma instalação que acabou de '
            + 'receber a medição: as quatro seções abaixo se preenchem à medida que as pessoas '
            + 'usarem o produto.';
    }
    if (estado === HORIZONTE.DESCONHECIDO) {
        return 'O servidor não informou desde quando o uso do produto é medido, então não dá para '
            + 'afirmar que as quatro seções abaixo cobrem o período inteiro.';
    }
    return '';
}

/**
 * A ressalva que vale para as QUATRO seções e não se repete em cada uma.
 *
 * ELA DIZ A COISA QUE O NÚMERO NÃO DIZ: a contagem chega por um lote que o navegador manda a cada
 * trinta segundos e na saída da página, sem fila. Uma aba fechada no instante errado, uma rede que
 * caiu, um bloqueador: em todos esses casos o lote some, e o que se lê é menos do que aconteceu.
 * @returns {string}
 */
export function usoDoProdutoHint() {
    return 'Estas quatro seções vêm do navegador de quem usa, e não do servidor: cada número é um '
        + 'PISO. O lote é mandado a cada 30 segundos e na saída da página, sem fila, então o que '
        + 'não sai é perdido em vez de guardado.';
}

// ===== sessões =====

/**
 * Se o servidor INFORMOU o bloco de sessões. Mesma régua de {@link funilInformado}: bloco ausente
 * não é zero, e desenhar "nenhuma sessão" sobre um servidor de versão anterior seria afirmar o
 * contrário do que se sabe.
 * @param {*} sessoes
 * @returns {boolean}
 */
export function sessoesInformado(sessoes) {
    return objeto(sessoes);
}

/** @returns {string} */
export function sessoesNaoInformadoNotice() {
    return 'O servidor não informou as sessões do produto, então esta seção não é desenhada '
        + 'aqui. '
        + 'Daqui não dá para dizer se é um servidor de versão anterior ou se ele não '
        + 'conseguiu montar o bloco desta vez, e nenhum dos dois quer dizer que ninguém '
        + 'tenha usado o EBGeo no período.';
}

/**
 * As sessões ANÔNIMAS: o total menos as autenticadas.
 *
 * DERIVADA, E COM PISO EM ZERO. Ela é a métrica que o produto mais precisa e a que o servidor não
 * manda pronta: o EBGeo roda anônimo por desenho, e a fração de quem usa sem entrar é a pergunta.
 * O piso existe porque a subtração é entre dois números medidos por consultas diferentes, e um
 * negativo na tela se lê como tela quebrada em vez de como divergência de fonte.
 * @param {*} sessoes
 * @returns {number|null} `null` quando alguma das duas pontas não é contagem.
 */
export function sessoesAnonimas(sessoes) {
    const total = objeto(sessoes) ? sessoes.total : undefined;
    const autenticadas = objeto(sessoes) ? sessoes.autenticadas : undefined;
    if (!numeroContavel(total) || !numeroContavel(autenticadas)) return null;
    return Math.max(0, total - autenticadas);
}

/**
 * Uma duração em segundos, por extenso e curta.
 *
 * TRÊS FAIXAS, e a razão é de leitura e não de precisão: abaixo de um minuto o segundo é a única
 * unidade que diz alguma coisa ("38 s"), entre um minuto e uma hora o segundo é ruído ("12 min"),
 * e acima de uma hora o minuto ainda importa ("1 h 20 min"). Uma unidade só produziria "4820 s"
 * ou "0,1 h", e nenhum dos dois se lê.
 *
 * O SÍMBOLO NÃO FLEXIONA (`s`, `min`, `h`), o que resolve o plural sem um ramo — a mesma razão de
 * {@link medianaLabel}.
 * @param {*} segundos
 * @returns {string} Travessão quando não é contagem, pela régua de {@link numeroLabel}.
 */
export function duracaoLabel(segundos) {
    if (!numeroContavel(segundos)) return '—';
    const s = Math.round(segundos);
    if (s < 60) return `${s} s`;
    const minutos = Math.round(s / 60);
    if (minutos < 60) return `${minutos} min`;
    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/**
 * Os ladrilhos da seção de sessões.
 *
 * TODOS SÃO `PERIODO`, e nenhum é estoque: uma sessão é um evento, não um saldo. A tabela existe
 * pelo mesmo motivo das outras duas (`METRICAS_DE_PESSOAS`, `METRICAS_DE_ATLAS`): escrever a
 * legenda de regime à mão em cinco ladrilhos é a forma de errar um deles sem nada ficar vermelho.
 *
 * `derivada` MARCA O QUE NÃO VEM PRONTO DO SERVIDOR. Hoje é um só (as anônimas), e o campo existe
 * para que {@link lerMetricasDeSessoes} não precise de uma lista de exceções escrita ao lado.
 * @type {ReadonlyArray<{chave: string, rotulo: string, regime: string, detalhe: string,
 *   formato?: string, derivada?: boolean}>}
 */
export const METRICAS_DE_SESSOES = Object.freeze([
    Object.freeze({
        chave: 'total',
        rotulo: 'Sessões',
        regime: REGIME.PERIODO,
        detalhe: 'abas que relataram uso',
    }),
    Object.freeze({
        chave: 'usuariosDistintos',
        rotulo: 'Pessoas distintas',
        regime: REGIME.PERIODO,
        detalhe: 'contas distintas por trás dessas sessões (a visita anônima não entra)',
    }),
    Object.freeze({
        chave: 'anonimas',
        rotulo: 'Sessões anônimas',
        regime: REGIME.PERIODO,
        detalhe: 'sessões sem ninguém autenticado, que é o modo em que o EBGeo roda por desenho',
        derivada: true,
    }),
    Object.freeze({
        chave: 'duracaoMedianaS',
        rotulo: 'Duração mediana',
        regime: REGIME.PERIODO,
        detalhe: 'metade das sessões durou mais que isto, e metade menos',
        formato: 'duracao',
    }),
    Object.freeze({
        chave: 'comErro',
        rotulo: 'Sessões com erro',
        regime: REGIME.PERIODO,
        detalhe: 'sessões em que ao menos um erro de navegador foi capturado',
    }),
]);

/**
 * Os cinco ladrilhos de sessões, prontos para desenhar.
 *
 * Irmã de {@link lerMetricas}, e separada dela por causa das duas propriedades que aquela não tem:
 * uma métrica DERIVADA (as anônimas) e um FORMATO que não é contagem (a duração). Alargar
 * `lerMetricas` para as duas coisas faria as três seções pagarem por uma.
 * @param {*} sessoes
 * @param {*} janela
 * @returns {Array<Object>}
 */
export function lerMetricasDeSessoes(sessoes, janela) {
    const fonte = objeto(sessoes) ? sessoes : {};
    const anonimas = sessoesAnonimas(sessoes);
    return METRICAS_DE_SESSOES.map((m) => {
        const valor = m.derivada ? anonimas : fonte[m.chave];
        return {
            chave: m.chave,
            rotulo: m.rotulo,
            regime: m.regime,
            valor,
            texto: m.formato === 'duracao' ? duracaoLabel(valor) : numeroLabel(valor),
            regimeTexto: regimeLabel(m.regime, janela),
            detalhe: metricaDetalhe(m, janela),
        };
    });
}

/**
 * A série diária de sessões, na mesma forma que o gráfico de produção já desenha.
 *
 * ELA ACEITA DUAS CHAVES PARA A CONTAGEM (`total` e `sessoes`), e isso é tolerância declarada e
 * não descuido: o contrato desta seção nasceu junto com o servidor que a alimenta, e a série de
 * produção, que é a irmã dela, usa `total`. Ler as duas custa uma linha e evita que uma diferença
 * de nome vire um gráfico vazio sem erro nenhum. Dia inválido sai, dia repetido soma, buraco é
 * preenchido: tudo isso é {@link preencherDias}, reusada de propósito para que as duas séries da
 * aba tenham exatamente o mesmo comportamento.
 * @param {*} porDia
 * @returns {Array<{dia: string, total: number}>}
 */
export function serieDeSessoes(porDia) {
    if (!Array.isArray(porDia)) return [];
    return preencherDias(porDia.map((l) => (objeto(l)
        ? { dia: l.dia, total: numeroContavel(l.total) ? l.total : l.sessoes }
        : l)));
}

/**
 * A ressalva de que DOIS dos cinco ladrilhos saem de um conjunto menor que os outros três.
 *
 * `usuariosDistintos` e `duracaoMedianaS` são calculados sobre as sessões AINDA RETIDAS (a linha
 * por sessão é podada por idade), enquanto o total, as autenticadas e as com erro vêm do agregado
 * diário, que sobrevive à poda. Numa janela cuja retenção já passou, os dois primeiros vêm vazios
 * ao lado de um total cheio, e sem esta frase a leitura é "o servidor perdeu o dado" ou, pior,
 * "mil sessões e zero pessoas".
 *
 * ELA SÓ APARECE QUANDO A DIVERGÊNCIA É VISÍVEL, e é isso que a impede de virar ruído: com
 * sessões retidas na janela, os cinco números concordam e não há o que explicar.
 * @param {*} sessoes
 * @returns {string} Vazio quando não há ressalva.
 */
export function sessoesRetidasNotice(sessoes) {
    if (!objeto(sessoes)) return '';
    const total = numeroOuZero(sessoes.total);
    const retidas = sessoes.sessoesRetidas;
    if (total === 0) return '';
    if (!numeroContavel(retidas) || retidas > 0) return '';
    return 'As pessoas distintas e a duração mediana saem das sessões ainda guardadas uma a uma, '
        + 'e nesta janela não sobrou nenhuma: a retenção já as removeu. O total, as anônimas e as '
        + 'com erro vêm do resumo diário, que não é podado, e continuam valendo.';
}

/** @returns {string} */
export function sessoesTitulo() {
    return 'Sessões';
}

/** @param {*} janela @returns {string} */
export function sessoesSubtitulo(janela) {
    return `Abas que relataram uso ${janelaEmPalavras(janela)}, quem estava por trás delas e `
        + 'quanto tempo duraram';
}

/** @param {*} janela @returns {string} */
export function sessoesVaziaNotice(janela) {
    return `Nenhuma sessão relatada ${janelaEmPalavras(janela)}.`;
}

/** @returns {string} */
export function sessoesVaziaHint() {
    return 'Ou ninguém abriu o EBGeo no período, ou nenhum lote conseguiu chegar ao servidor. As '
        + 'duas coisas desenham esta mesma tela.';
}

/** @returns {string} */
export function sessoesGraficoLegenda() {
    return 'Cada barra é um dia. Dia sem sessão fica na linha de base, e não some do eixo.';
}

/**
 * O `title` de uma barra da série de sessões.
 *
 * Irmã de {@link tituloDeBarra} e separada dela pela palavra: uma barra que diga "operações" numa
 * seção que conta sessões é o tipo de cópia que ninguém revisa depois de colar.
 * @param {*} dia @param {*} total
 * @returns {string}
 */
export function tituloDeBarraDeSessao(dia, total) {
    const data = rotuloLongoDeDia(dia);
    const n = numeroOuZero(total);
    const quanto = n === 1 ? '1 sessão' : `${numeroLabel(n)} sessões`;
    return data ? `${data}: ${quanto}` : quanto;
}

// ===== ferramentas mais usadas =====

/**
 * Os nomes em pt-BR dos EVENTOS de uso.
 *
 * A CHAVE É O EVENTO DO CATÁLOGO (`session/eventos-de-uso.js`), e esta tabela é uma tradução de
 * EXIBIÇÃO, nunca uma segunda definição do vocabulário — a mesma régua de {@link ENTIDADE_LABEL}.
 * Ela não valida nada, e um evento que este build não conhece continua aparecendo na tela com a
 * chave crua (ver {@link eventoDeUsoLabel}). Sumir com o desconhecido esconderia uso real, que é o
 * oposto do que esta aba existe para fazer.
 * @type {Readonly<Object<string, string>>}
 */
export const EVENTO_DE_USO_LABEL = Object.freeze({
    'pagina.vista': 'Página aberta',
    'atlas.aberto': 'Atlas aberto',
    'ferramenta.ativada': 'Ferramenta',
    'medicao.aberta': 'Medição',
    'visualizador3d.aberto': 'Visualizador 3D',
    'visualizador360.aberto': 'Visualizador 360',
    'primeira-pessoa.aberto': 'Primeira pessoa',
    'briefing.apresentado': 'Briefing apresentado',
    'temporal.ativado': 'Linha do tempo',
    'pdf.exportado': 'PDF exportado',
    'ebgeo.exportado': 'Arquivo .ebgeo gerado',
    'ebgeo.importado': 'Arquivo .ebgeo aberto',
    'indisponivel.visto': 'Tela de indisponibilidade',
});

/**
 * Os nomes em pt-BR das FERRAMENTAS do mapa, indexados pelo `tipoDeUi` de
 * `tool_manager/tool-registry.js`.
 *
 * ELA ENVELHECE, E O DESENHO ADMITE ISSO. A lista de ferramentas cresce a cada `new-tool`, e nada
 * obriga quem cria uma a vir aqui; é a mesma situação de {@link ENTIDADE_LABEL}, e a saída é a
 * mesma: a ferramenta que este build não conhece aparece com o id cru, que é feio e é honesto.
 * Trocá-la por "Outra" fundiria todas as desconhecidas numa linha que não localiza nada.
 * @type {Readonly<Object<string, string>>}
 */
export const FERRAMENTA_LABEL = Object.freeze({
    point: 'Ponto',
    line: 'Linha',
    polygon: 'Polígono',
    text: 'Texto',
    image: 'Imagem',
    brush: 'Pincel',
    rectangle: 'Retângulo',
    circle: 'Círculo',
    ellipse: 'Elipse',
    sector: 'Setor',
    azimuth_distance: 'Azimute e distância',
    militarysymbol: 'Símbolo militar',
    coordinationmeasure: 'Medida de coordenação',
    declination: 'Declinação magnética',
    arrow: 'Seta',
    boundary: 'Limite',
    occupiedfront: 'Frente ocupada',
    los: 'Linha de visada',
    visibility: 'Visibilidade',
    measurementdistance: 'Medir distância',
    measurementarea: 'Medir área',
    measurementangle: 'Medir ângulo',
    vectortileinfo: 'Informação de camada',
    rectangleselection: 'Seleção por caixa',
});

/**
 * O nome de um evento de uso.
 * @param {*} evento
 * @returns {string}
 */
export function eventoDeUsoLabel(evento) {
    if (typeof evento !== 'string') return 'Sem evento';
    const chave = evento.trim();
    if (!chave) return 'Sem evento';
    return Object.hasOwn(EVENTO_DE_USO_LABEL, chave) ? EVENTO_DE_USO_LABEL[chave] : chave;
}

/**
 * O NOME DE CADA QUALIFICADOR, POR EVENTO.
 *
 * INDEXADA PELO EVENTO, E NÃO UMA TABELA ÚNICA, porque `prop` é um vocabulário POR EVENTO
 * (`PROPS_PERMITIDAS`, em `session/eventos-de-uso.js`): `local` é uma procedência de atlas e
 * `folha` é um motor de PDF, e nada impede que amanhã nasça uma ferramenta com um desses ids. Uma
 * tabela única faria a coluna "Alvo" chamar um PDF de ferramenta, e a divergência só apareceria
 * na tela de quem estivesse lendo o relatório.
 *
 * SÓ OS EVENTOS COM LISTA FECHADA ENTRAM. Os que não têm qualificador nenhum não têm o que
 * traduzir, e `ferramenta.ativada` é o único LIVRE, com tabela própria ({@link FERRAMENTA_LABEL})
 * porque ela cresce a cada `new-tool` e a lista dela não é contrato de nada.
 * @type {Readonly<Object<string, Readonly<Object<string, string>>>>}
 */
export const PROP_LABEL_POR_EVENTO = Object.freeze({
    'ferramenta.ativada': FERRAMENTA_LABEL,
    // A procedência do atlas, que é a pergunta de produto mais cara de responder por outro meio:
    // quanto do uso é offline, quanto é de servidor, e quanto é visita sem conta nenhuma.
    'atlas.aberto': Object.freeze({
        local: 'Local',
        servidor: 'Servidor',
        publico: 'Público',
    }),
    // Os DOIS motores do mesmo painel, e a diferença não é de tamanho: a folha única sai
    // georreferenciada por GDAL, o mosaico sai por jsPDF e não sai.
    'pdf.exportado': Object.freeze({
        folha: 'Folha única',
        mosaico: 'Mosaico',
    }),
});

/**
 * O nome de um alvo (`prop`), quando ele tem um.
 *
 * A TABELA É ESCOLHIDA PELO EVENTO ({@link PROP_LABEL_POR_EVENTO}), e é por isso que esta função
 * recebe os dois campos. Ver lá o porquê de não haver uma tabela só.
 * @param {*} evento
 * @param {*} prop
 * @returns {string} Vazio quando não há `prop`.
 */
export function propDeUsoLabel(evento, prop) {
    if (typeof prop !== 'string' || !prop.trim()) return '';
    const chave = prop.trim();
    const tabela = Object.hasOwn(PROP_LABEL_POR_EVENTO, evento)
        ? PROP_LABEL_POR_EVENTO[evento]
        : null;
    if (tabela && Object.hasOwn(tabela, chave)) return tabela[chave];
    // A RESERVA DO DESCONHECIDO, e não o caminho normal: um qualificador que este build não
    // conhece aparece cru, que é feio e é honesto, como em {@link entidadeLabel}.
    return chave;
}

/** Quantas linhas a tabela de ferramentas mostra. O servidor já corta em 20; este é o teto local. */
export const LIMITE_DE_FERRAMENTAS = 20;

/**
 * As linhas da tabela "mais usadas", da maior para a menor.
 *
 * ORDENAR AQUI E NÃO CONFIAR NA ROTA, pela mesma razão de {@link ordenarTopAtlas}: a tela promete
 * que a primeira linha é a maior, e a promessa não pode depender de um `ORDER BY` que ninguém aqui
 * verifica. O desempate é pelo RÓTULO já traduzido, para que a ordem lida seja a ordem vista.
 *
 * A FATIA É SOBRE A SOMA DA LISTA, e não sobre um total do servidor, pelo mesmo argumento de
 * {@link producaoPorEntidade}: a lista é um recorte (as vinte mais), e uma fatia calculada sobre
 * um total maior somaria menos de 100% sem explicar por quê.
 * @param {*} ferramentas
 * @param {number} [limite]
 * @returns {Array<{evento: string, prop: string, rotulo: string, alvo: string, bruto: string,
 *   contagem: number, fatia: string|null}>}
 */
export function linhasDeFerramentas(ferramentas, limite = LIMITE_DE_FERRAMENTAS) {
    if (!Array.isArray(ferramentas)) return [];
    const teto = Number.isFinite(limite) && limite > 0
        ? Math.floor(limite)
        : LIMITE_DE_FERRAMENTAS;
    const linhas = ferramentas
        .filter((l) => objeto(l))
        .map((l) => {
            const evento = typeof l.evento === 'string' ? l.evento.trim() : '';
            const prop = typeof l.prop === 'string' ? l.prop.trim() : '';
            return {
                evento,
                prop,
                rotulo: eventoDeUsoLabel(evento),
                alvo: propDeUsoLabel(evento, prop),
                // O ID CRU VAI PARA O `title`, e não some da tela: é ele que se procura no código
                // quando alguém quiser saber de onde a contagem veio.
                bruto: prop ? `${evento} ${prop}` : evento,
                contagem: numeroOuZero(l.contagem),
            };
        });
    const soma = linhas.reduce((acc, l) => acc + l.contagem, 0);
    return linhas
        .sort((a, b) => b.contagem - a.contagem
            || a.rotulo.localeCompare(b.rotulo, 'pt-BR')
            || a.alvo.localeCompare(b.alvo, 'pt-BR'))
        .slice(0, teto)
        .map((l) => ({ ...l, fatia: percentualLabel(l.contagem, soma) }));
}

/** @returns {string} */
export function ferramentasTitulo() {
    return 'Mais usados';
}

/** @param {*} janela @returns {string} */
export function ferramentasSubtitulo(janela) {
    return `O que as pessoas acionaram ${janelaEmPalavras(janela)}, do mais para o menos`;
}

/** @param {*} janela @returns {string} */
export function ferramentasVaziaNotice(janela) {
    return `Nenhum acionamento relatado ${janelaEmPalavras(janela)}.`;
}

/** @returns {string} */
export function ferramentasHint() {
    return 'A contagem é de ACIONAMENTOS, e não de tempo de uso: abrir a mesma ferramenta dez '
        + 'vezes conta dez. Reativar a que já está ativa não conta, porque desligar não é ligar.';
}

/** @returns {string} */
export function ferramentasNaoInformadoNotice() {
    return 'O servidor não informou o que foi mais usado, então esta seção não é desenhada '
        + 'aqui. '
        + 'Daqui não dá para dizer se é um servidor de versão anterior ou se ele não '
        + 'conseguiu montar o bloco desta vez, e nenhum dos dois quer dizer que ninguém '
        + 'tenha acionado nada no período.';
}

// ===== desempenho no cliente =====

/** O texto de um p75 que não tem amostra nenhuma. */
export const SEM_AMOSTRA = 'sem amostra';

/**
 * Um p75 em milissegundos.
 *
 * AUSÊNCIA NUNCA VIRA ZERO, e aqui a regra é ainda mais dura que em {@link numeroLabel}: zero
 * milissegundos é a MELHOR nota possível, então um campo que não chegou desenhado como "0 ms"
 * anunciaria desempenho perfeito sobre uma medição que não houve. Daí a frase em palavras
 * ({@link SEM_AMOSTRA}) em vez do travessão, que é ambíguo entre "não medimos" e "deu zero".
 * @param {*} ms
 * @returns {string}
 */
export function p75Label(ms) {
    if (!numeroContavel(ms)) return SEM_AMOSTRA;
    return `${numeroLabel(ms)} ms`;
}

/**
 * O CLS, que é o único número desta aba sem unidade.
 *
 * TRÊS CASAS DECIMAIS porque a faixa inteira que interessa cabe abaixo de 0,25 (o limiar de "ruim"
 * do padrão é 0,25 e o de "bom" é 0,1): com uma casa, metade das instalações desenharia "0,1" e a
 * outra metade "0,0", e a coluna deixaria de discriminar.
 * @param {*} valor
 * @returns {string}
 */
export function clsLabel(valor) {
    if (!numeroContavel(valor)) return SEM_AMOSTRA;
    return valor.toFixed(3).replace('.', ',');
}

/**
 * O nome de uma das quatro páginas.
 *
 * O NOME DO PRODUTO, e não o do arquivo: `index.html` não diz nada a quem lê um relatório, e
 * "Administração" é o rótulo que aquela página tem para o administrador (para as outras audiências
 * ela se chama outra coisa, mas quem lê ESTA tela é sempre o administrador).
 * @param {*} pagina
 * @returns {string}
 */
export function paginaDeUsoLabel(pagina) {
    if (typeof pagina !== 'string' || !pagina.trim()) return 'Sem página';
    const chave = pagina.trim();
    const NOMES = { mapa: 'Mapa', atlas: 'Seus atlas', admin: 'Administração', calibracao: 'Calibração' };
    return Object.hasOwn(NOMES, chave) ? NOMES[chave] : chave;
}

/**
 * As colunas da tabela de desempenho, com o que cada uma significa.
 *
 * A TABELA É DADO E NÃO LITERAL NA TELA, pela mesma razão de `NUMEROS_DA_SAUDE` em
 * `defeito-phrases.js`: com os quatro cabeçalhos escritos na aba, trocar duas colunas de lugar não
 * ficaria vermelho em lugar nenhum.
 *
 * O `formato` DECIDE A FUNÇÃO DE TEXTO, e é por isso que o CLS não precisa de um caso especial no
 * desenho: ele é a única coluna adimensional, e a diferença mora aqui.
 * @type {ReadonlyArray<{campo: string, rotulo: string, formato: string, detalhe: string}>}
 */
export const COLUNAS_DE_DESEMPENHO = Object.freeze([
    Object.freeze({
        campo: 'lcpP75Ms',
        rotulo: 'LCP p75',
        formato: 'ms',
        detalhe: 'Largest Contentful Paint: quanto tempo até o maior conteúdo da tela aparecer. '
            + 'Três em cada quatro cargas foram mais rápidas que este número.',
    }),
    Object.freeze({
        campo: 'inpP75Ms',
        rotulo: 'INP p75',
        formato: 'ms',
        detalhe: 'Interaction to Next Paint: quanto tempo a interface demorou para responder à '
            + 'pior interação da sessão.',
    }),
    Object.freeze({
        campo: 'clsP75',
        rotulo: 'CLS p75',
        formato: 'cls',
        detalhe: 'Cumulative Layout Shift: quanto a página se mexeu sozinha enquanto carregava. '
            + 'Abaixo de 0,100 é bom; acima de 0,250 é ruim.',
    }),
    Object.freeze({
        campo: 'tempoAteMapaP75Ms',
        rotulo: 'Até o mapa',
        formato: 'ms',
        detalhe: 'Do início do aplicativo até o MapLibre terminar de carregar. Só a página do '
            + 'mapa tem esta medida.',
    }),
    Object.freeze({
        campo: 'amostras',
        rotulo: 'Amostras',
        formato: 'amostras',
        detalhe: 'Sobre quantas medidas o percentil foi calculado. A UNIDADE muda com a fonte da '
            + 'linha (sessões ou dias), e por isso ela vem escrita ao lado do número: um p75 '
            + 'sobre poucas amostras não é um percentil, é um exemplo.',
    }),
]);

/**
 * As DUAS fontes de uma linha de desempenho, e o que a palavra "amostra" significa em cada uma.
 *
 * O SERVIDOR MANDA `origem` JUSTAMENTE PARA QUE A TELA NÃO MINTA AQUI. Quando as sessões daquela
 * janela ainda existem uma a uma, o p75 é o percentil de verdade e `amostras` conta SESSÕES;
 * quando a retenção já as levou, o que resta é o agregado diário, e a linha passa a ser a mediana
 * dos p75 de cada dia, com `amostras` contando DIAS. Os dois números têm o mesmo nome, grandezas
 * diferentes e ordens de grandeza diferentes ("412" contra "30"), e sem a unidade escrita ao lado
 * a segunda leitura é indistinguível de uma queda brutal de uso.
 * @type {Readonly<Object<string, {unidadeSingular: string, unidadePlural: string, detalhe: string}>>}
 */
export const ORIGENS_DE_DESEMPENHO = Object.freeze({
    sessoes: Object.freeze({
        unidadeSingular: 'sessão',
        unidadePlural: 'sessões',
        detalhe: 'Percentil calculado sobre as sessões desta janela, uma a uma. É o p75 de '
            + 'verdade.',
    }),
    diario: Object.freeze({
        unidadeSingular: 'dia',
        unidadePlural: 'dias',
        detalhe: 'As sessões desta janela já foram podadas, então o número é a MEDIANA dos p75 '
            + 'de cada dia, e não o p75 do período. É a melhor resposta que sobra, e não a mesma '
            + 'conta.',
    }),
});

/**
 * O texto da célula de amostras: o número mais a unidade que a fonte daquela linha define.
 *
 * A UNIDADE NUNCA É OMITIDA, nem quando a origem é desconhecida: sem ela a coluna volta a ser o
 * número ambíguo que `ORIGENS_DE_DESEMPENHO` existe para desfazer. Origem que este build não
 * conhece cai em "amostras", que é vago e é honesto.
 * @param {*} amostras
 * @param {*} origem
 * @returns {string}
 */
export function amostrasLabel(amostras, origem) {
    const n = numeroOuZero(amostras);
    const info = typeof origem === 'string' && Object.hasOwn(ORIGENS_DE_DESEMPENHO, origem)
        ? ORIGENS_DE_DESEMPENHO[origem]
        : null;
    const unidade = info
        ? (n === 1 ? info.unidadeSingular : info.unidadePlural)
        : 'amostras';
    return `${numeroLabel(amostras)} ${unidade}`;
}

/**
 * O `title` da célula de amostras: o que aquela fonte significa.
 * @param {*} origem
 * @returns {string}
 */
export function origemDeDesempenhoDetalhe(origem) {
    if (typeof origem === 'string' && Object.hasOwn(ORIGENS_DE_DESEMPENHO, origem)) {
        return ORIGENS_DE_DESEMPENHO[origem].detalhe;
    }
    return 'O servidor não declarou a fonte desta linha, então não dá para dizer se as amostras '
        + 'são sessões ou dias.';
}

/**
 * O texto de uma célula de desempenho, pelo formato declarado na coluna.
 * @param {*} valor
 * @param {*} formato
 * @returns {string}
 */
export function celulaDeDesempenho(valor, formato, origem) {
    if (formato === 'cls') return clsLabel(valor);
    if (formato === 'amostras') return amostrasLabel(valor, origem);
    if (formato === 'contagem') return numeroLabel(valor);
    return p75Label(valor);
}

/**
 * As linhas da tabela de desempenho, uma por página.
 *
 * A ORDEM É A DAS QUATRO PÁGINAS e não a do servidor: elas são um conjunto FIXO e pequeno, e uma
 * ordem que mude entre duas cargas faz a pessoa desconfiar do dado certo (o mesmo argumento de
 * {@link ordenarTopAtlas}). Página que o servidor não conhece vai para o fim, com o id cru.
 * @param {*} desempenho
 * @returns {Array<{pagina: string, origem: string, rotulo: string, celulas: Array<Object>, amostras: number}>}
 */
export function linhasDeDesempenho(desempenho) {
    if (!Array.isArray(desempenho)) return [];
    const ordem = ['mapa', 'atlas', 'admin', 'calibracao'];
    return desempenho
        .filter((l) => objeto(l))
        .map((l) => {
            const pagina = typeof l.pagina === 'string' ? l.pagina.trim() : '';
            const origem = typeof l.origem === 'string' ? l.origem : '';
            return {
                pagina,
                origem,
                rotulo: paginaDeUsoLabel(pagina),
                amostras: numeroOuZero(l.amostras),
                celulas: COLUNAS_DE_DESEMPENHO.map((c) => ({
                    campo: c.campo,
                    rotulo: c.rotulo,
                    // A COLUNA DE AMOSTRAS TROCA O `title` PELO DA FONTE, e é a única que troca:
                    // o que ela precisa dizer não é o que a coluna mede (isso está no cabeçalho),
                    // é o que a UNIDADE daquela linha significa.
                    detalhe: c.formato === 'amostras'
                        ? origemDeDesempenhoDetalhe(origem)
                        : c.detalhe,
                    texto: celulaDeDesempenho(l[c.campo], c.formato, origem),
                    // `vazia` é o que a folha de estilo usa para tirar o peso do "sem amostra":
                    // ele ocupa a mesma célula de um número e não é um.
                    vazia: c.formato !== 'contagem' && c.formato !== 'amostras'
                        && !numeroContavel(l[c.campo]),
                })),
            };
        })
        .sort((a, b) => {
            const ia = ordem.indexOf(a.pagina);
            const ib = ordem.indexOf(b.pagina);
            const pa = ia === -1 ? ordem.length : ia;
            const pb = ib === -1 ? ordem.length : ib;
            return pa - pb || a.rotulo.localeCompare(b.rotulo, 'pt-BR');
        });
}

/** @returns {string} */
export function desempenhoTitulo() {
    return 'Desempenho no cliente';
}

/** @param {*} janela @returns {string} */
export function desempenhoSubtitulo(janela) {
    return `Como o produto respondeu no navegador de quem usa, ${janelaEmPalavras(janela)}, por `
        + 'página';
}

/**
 * A ressalva do percentil, e ela tem DUAS metades que nenhuma outra seção tem.
 *
 * A PRIMEIRA É O PERÍODO INTEIRO: o p75 é calculado sobre a janela toda, e não por dia, então uma
 * semana ruim no meio de noventa dias desaparece dentro do número. Quem procura "quando piorou"
 * não acha aqui.
 *
 * A SEGUNDA É A DO DIA QUE NÃO FECHOU, e ela é a mesma ressalva das células abertas da tabela de
 * retenção: as amostras de hoje ainda estão chegando, então o número de hoje ainda se move, e uma
 * comparação feita de manhã com a de ontem compara um dia inteiro com um pedaço de dia.
 * @returns {string}
 */
export function desempenhoHint() {
    return 'O p75 é calculado sobre o período inteiro, e não por dia: uma semana ruim no meio de '
        + 'noventa some dentro do número. E o dia de hoje ainda não fechou, então estes valores '
        + 'ainda se movem até a virada.';
}

/** @param {*} janela @returns {string} */
export function desempenhoVaziaNotice(janela) {
    return `Nenhuma medida de desempenho chegou ${janelaEmPalavras(janela)}.`;
}

/** @returns {string} */
export function desempenhoVaziaHint() {
    return 'As três métricas padronizadas (LCP, INP e CLS) dependem de o navegador saber medi-las: '
        + 'o INP, por exemplo, não existe no Safari. Uma tabela vazia pode ser ausência de uso ou '
        + 'ausência de suporte.';
}

/** @returns {string} */
export function desempenhoNaoInformadoNotice() {
    return 'O servidor não informou o desempenho no cliente, então esta seção não é desenhada '
        + 'aqui. '
        + 'Daqui não dá para dizer se é um servidor de versão anterior ou se ele não '
        + 'conseguiu montar o bloco desta vez, e nenhum dos dois quer dizer que ninguém '
        + 'tenha usado o EBGeo no período.';
}

// ===== indisponibilidade vista pelo cliente =====

/**
 * A série diária das telas de indisponibilidade.
 *
 * A CHAVE DA CONTAGEM É `vistos`, que é o nome do contrato. Ela passa por {@link preencherDias}
 * como as outras duas séries, para que o dia sem incidente seja uma barra de altura zero e não um
 * buraco — e aqui isso vale o dobro: num gráfico de FALHA, o buraco se leria como "não medimos",
 * que é a leitura mais perigosa possível.
 * @param {*} disponibilidade
 * @returns {Array<{dia: string, total: number}>}
 */
export function serieDeDisponibilidade(disponibilidade) {
    if (!Array.isArray(disponibilidade)) return [];
    return preencherDias(disponibilidade.map((l) => (objeto(l)
        ? { dia: l.dia, total: l.vistos }
        : l)));
}

/** @returns {string} */
export function disponibilidadeTitulo() {
    return 'Indisponibilidade vista pelo cliente';
}

/** @param {*} janela @returns {string} */
export function disponibilidadeSubtitulo(janela) {
    return `Quantas vezes a tela "EBGeo indisponível" foi ao ar ${janelaEmPalavras(janela)}`;
}

/**
 * A ressalva SEM A QUAL ESTA SEÇÃO MENTE, e ela é o motivo de a seção existir com este nome.
 *
 * A tela de indisponibilidade tem DUAS causas: o servidor não respondeu, ou o nosso código quebrou
 * com o servidor de pé. O relato de USO desta tela é mandado na hora e não tem fila, então na
 * PRIMEIRA causa ele falha por definição — o servidor que deveria recebê-lo é justamente o que
 * está fora. O que chega aqui é quase só a segunda causa.
 *
 * A QUEDA DE SERVIDOR NÃO SE PERDE, e a frase precisa dizer para onde ela foi, senão a ressalva
 * vira só uma desculpa: ela é contada pelo lado dos DEFEITOS, onde o relato ENFILEIRA e sai no
 * próximo boot que conseguir falar.
 * @returns {string}
 */
export function disponibilidadeHint() {
    return 'Esta contagem é quase só da tela por ERRO DO PROGRAMA: quando a causa é o servidor '
        + 'fora, o relato de uso não tem para onde ir e se perde. A queda de servidor aparece na '
        + 'aba Diagnóstico, entre os defeitos de origem "indisponivel", porque aquele relato '
        + 'espera a próxima carga da página em vez de morrer.';
}

/**
 * A legenda do gráfico de indisponibilidade, e ela NÃO é {@link disponibilidadeHint}.
 *
 * A CAPTURA MOSTROU AS DUAS FRASES NA MESMA SEÇÃO, uma na legenda e outra na nota logo abaixo,
 * palavra por palavra. Repetir uma ressalva não a reforça: ela passa a ser lida como erro de
 * montagem, e a segunda ocorrência ensina a pular a primeira. A legenda diz o que a BARRA é (é o
 * papel dela, como nas outras duas séries) e a ressalva de causa fica só na nota.
 * @returns {string}
 */
export function disponibilidadeGraficoLegenda() {
    return 'Cada barra é um dia. Aqui o zero é a boa notícia, e por isso o dia sem incidente fica '
        + 'na linha de base em vez de sumir do eixo.';
}

/** @param {*} janela @returns {string} */
export function disponibilidadeVaziaNotice(janela) {
    return `Nenhuma tela de indisponibilidade relatada ${janelaEmPalavras(janela)}.`;
}

/** @returns {string} */
export function disponibilidadeNaoInformadoNotice() {
    return 'O servidor não informou a indisponibilidade vista pelo cliente, então esta seção '
        + 'não é desenhada aqui. '
        + 'Daqui não dá para dizer se é um servidor de versão anterior ou se ele não '
        + 'conseguiu montar o bloco desta vez, e nenhum dos dois quer dizer que ninguém '
        + 'tenha visto a tela no período.';
}

/**
 * O `title` de uma barra da série de indisponibilidade.
 * @param {*} dia @param {*} total
 * @returns {string}
 */
export function tituloDeBarraDeIndisponibilidade(dia, total) {
    const data = rotuloLongoDeDia(dia);
    const n = numeroOuZero(total);
    const quanto = n === 1 ? '1 tela' : `${numeroLabel(n)} telas`;
    return data ? `${data}: ${quanto}` : quanto;
}
