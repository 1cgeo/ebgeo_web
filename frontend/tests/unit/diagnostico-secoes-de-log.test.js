// Path: tests/unit/diagnostico-secoes-de-log.test.js

/**
 * @fileoverview A VARREDURA DAS SEÇÕES DA ABA "DIAGNÓSTICO" QUE LEEM ARQUIVO DE LOG, e o buraco
 * que ela fecha estava DECLARADO POR ESCRITO na suíte irmã.
 *
 * `diagnostico-frases.test.js` dizia, no quarto controle negativo: "Tirar a chamada de
 * `diag-tab.js` não deixa esta suíte vermelha". Era verdade, e o defeito entrou exatamente por
 * ali: `leitorCego` e `truncamentoNotice` estavam densamente presas como FUNÇÕES PURAS, e o
 * CONSUMIDOR delas não estava preso por nada. `_pintarPulso` nunca chamou nenhuma das duas, com o
 * `diretorioAusente` e o `truncado` chegando no PRÓPRIO payload dela. As consequências eram as
 * duas que as funções existem para impedir: com o log em arquivo desligado, o Pulso desenhava
 * "Nenhuma requisição registrada nas últimas 24 horas" ao lado de outra seção dizendo "leitor
 * cego"; e sob truncamento (o anel de leitura do serviço) ele mostrava o total DEPOIS do corte
 * como se fosse o total do período. O Pulso é o ÚNICO lugar da aba em que um NÚMERO sofre o
 * corte, o que torna a omissão mais grave ali do que em qualquer outra seção.
 *
 * O QUE ESTA SUÍTE EXIGE, e por que é estrutural e não de DOM. `diag-tab.js` é DOM mais rede e
 * não roda em node; montar um duplo do documento inteiro para afirmar isso custaria mais e
 * prenderia menos, porque o defeito não é de renderização, é de CHAMADA AUSENTE. A varredura lê o
 * arquivo como texto e cobra três propriedades de cada seção:
 *
 *   1. chamar `leitorCego(`, senão a seção afirma saúde a partir de um instrumento desligado;
 *   2. chamar `this._notasDaLeitura(`, que é a porta das três frases de ressalva (o que foi
 *      varrido, o corte da lista e o truncamento da janela);
 *   3. consultar o leitor cego ANTES de desenhar qualquer vazio (`emptyState` / `bomVazio`), que
 *      é a ordem escrita nos comentários das seções e a única que produz a frase certa: as rotas
 *      respondem com SUCESSO e lista vazia quando o diretório de log não existe;
 *   4. chamar a nota UMA VEZ POR DESFECHO INFORMATIVO, e não uma vez por seção.
 *
 * A QUARTA PROPRIEDADE É CONTAGEM, E NÃO ANÁLISE DE FLUXO, e essa distinção é o que a torna
 * escrevível. A primeira versão desta suíte cobrava só a PRESENÇA da chamada, e com isso deu
 * verde sobre `_pintarLatencia`, que a chamava apenas no ramo da tabela: a seção passava por
 * "seção que fala" enquanto o vazio dela ("nenhuma rota com latência medida nas últimas 24
 * horas") saía sem dizer o que foi varrido e sem acusar truncamento. Guarda que afirma o
 * contrário do que a tela faz é pior que guarda nenhum, porque agora existe um verde a favor do
 * defeito. A regra que fecha isso não precisa entender ramificação: cada `emptyState(`,
 * `bomVazio(` e `leitorCegoNotice(` do corpo é um desfecho que a pessoa LÊ, mais UM pelo
 * fall-through com dado, e o número de `this._notasDaLeitura(` não pode ser menor que essa soma.
 * Medida contra o arquivo real, ela dá 3 = 3 nas duas seções de log e não acusa nenhuma.
 *
 * O QUE A CONTAGEM COBRA A MAIS DO QUE DEVERIA, dito antes que alguém a afrouxe: ela é um piso
 * por SOMA, então uma seção futura que desenhe dois vazios distintos cobertos por uma nota só
 * seria acusada sem estar errada. Se esse dia chegar, o conserto é classificar a seção (como
 * `@nao-le-log` faz com a que lê o banco), e nunca baixar o piso, que devolveria exatamente o
 * silêncio que a latência tinha.
 *
 * A LISTA DE SEÇÕES É DERIVADA DO CÓDIGO, e essa é a metade que faz o guarda sobreviver. Ela não
 * é escrita aqui: a varredura acha todo método `_pintarX(host, resultado, janela)` da classe, ou
 * seja, todo pintor que recebe o desfecho de uma das rotas de `/diag`. Uma seção nova nasce já
 * cobrada, e é essa a diferença entre um guarda e uma lista que envelhece. `_pintarCarregando`
 * fica de fora pela ASSINATURA (não recebe `resultado`), e não por nome.
 *
 * ERAM QUATRO SEÇÕES ATÉ 2026-09-02, E HOJE SÃO TRÊS, o que é a prova de que a derivação vale a
 * pena: a lista de erros do SERVIDOR (varredura do arquivo de log) e a de erros do NAVEGADOR
 * (banco) viraram uma só, "Defeitos", sobre `GET /diag/defeitos`, que tem ciclo de vida. Nenhuma
 * linha desta varredura precisou saber os nomes delas. O que saiu junto foram os dois blocos que
 * prendiam o CONSUMIDOR daquelas seções: o dos endereços agregados por assinatura (a lista de
 * servidor não existe mais nesta tela, e a agregação continua em `npm run diag -- erros`) e o da
 * lista de navegador. O que os substitui, abaixo, prende o consumidor da seção nova, e a razão de
 * existir é a mesma que aqueles tinham: as frases estão presas como funções puras em
 * `defeito-frases.test.js`, e nada disso impede `diag-tab.js` de nunca chamá-las.
 *
 * AS DUAS SAÍDAS DECLARADAS, E ELAS DISPENSAM COISAS DIFERENTES. `@nao-le-log` é de quem não lê
 * arquivo de log ("Defeitos" vem do BANCO, e nela `diretorioAusente` e `truncado` não existem):
 * dispensa as duas chamadas. `@cegueira-por-bloco`, que nasceu em 2026-09-02 com a seção "Resumo",
 * dispensa SÓ o `leitorCego`, e o motivo é que a cegueira chega resolvida POR BLOCO: o payload dela
 * é o documento que `montarResumo` compõe no servidor, em que cada bloco carrega `disponivel`,
 * `motivo` e `premissa`, então com o diretório ausente os três cartões de arquivo já dizem que a
 * fonte deles não respondeu, e dizem melhor do que uma faixa de seção (eles nomeiam quais números
 * somem e deixam de pé os dois cartões de banco, que continuam valendo com o log fora). O que ela
 * NÃO dispensa é `_notasDaLeitura`, e é aí que está o dente: o TRUNCAMENTO não aparece em cartão
 * nenhum, aquela rota lê com anel, e sem a frase um pico no começo da janela some calado enquanto
 * seis cartões afirmam números sobre o período inteiro.
 *
 * As duas se escrevem no próprio JSDoc, com o motivo ao lado, que é o padrão de censo da casa (a
 * seção nova reprova até ser CLASSIFICADA), e cada uma é cobrada de três lados: quem se declara não
 * pode chamar `leitorCego` (senão a marca está mentindo sobre a própria seção), a lista de quem se
 * declara é asserida por NOME em igualdade absoluta (contagem deixaria uma seção trocar de lugar
 * com outra sem nada ficar vermelho), e cada declaração tem de trazer o motivo escrito. Uma marca
 * que passasse a dispensar as duas chamadas virou `@nao-le-log`, e é isso que deve estar escrito.
 *
 * O QUE ELA NÃO ALCANÇA, dito para que o verde não seja lido como mais do que é: ela vê CHAMADA,
 * não semântica. Uma `_notasDaLeitura` chamada num ramo morto, ou chamada com o payload errado,
 * passa verde aqui. O que ela impede é a classe que de fato aconteceu, que é a seção inteira
 * esquecer as duas chamadas.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCOS_DO_RESUMO } from '@js/admin/resumo-phrases.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const ARQUIVO = 'src/js/admin/diag-tab.js';
// Normalized to LF: a checkout on Windows materializes the file with CRLF, and the
// method-closing probe below ('\n    }\n') would then find nothing, turning every
// section into an empty body and the whole census red on a clean tree.
const FONTE = readFileSync(path.join(RAIZ, ARQUIVO), 'utf8').replace(/\r\n/g, '\n');

/** A marca de saída, escrita no JSDoc da seção que não lê arquivo de log. */
const MARCA_SEM_LOG = '@nao-le-log';

/**
 * A SEGUNDA marca, e ela dispensa MENOS que a primeira: a seção lê arquivo de log e continua
 * devendo `_notasDaLeitura` (a varredura e o truncamento), mas não chama `leitorCego` porque a
 * cegueira do arquivo chega resolvida POR BLOCO, e cada bloco a declara sozinho na tela.
 *
 * ELA NÃO É UM SEGUNDO NOME PARA A PRIMEIRA, e a diferença é o que a torna uma classificação e
 * não uma fresta: quem se declara aqui ainda é cobrado pela nota da leitura, e o piso por soma
 * continua valendo. Se um dia ela dispensar as duas coisas, ela virou `@nao-le-log` e é isso que
 * deve estar escrito.
 */
const MARCA_CEGUEIRA_POR_BLOCO = '@cegueira-por-bloco';

/**
 * Tira comentários do corpo, para que a busca por chamada não case com prosa. É o mesmo motivo de
 * `docs-integridade` exigir símbolo no código e não em comentário: comentário que cita
 * `leitorCego(` satisfaria a varredura sem chamar nada.
 * @param {string} texto
 * @returns {string}
 */
function semComentarios(texto) {
    return texto.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Os pintores de seção, DERIVADOS do arquivo: todo método `_pintarX` que recebe o `resultado` de
 * uma das rotas de `/diag`. O bloco vai do JSDoc até o fecho do método, porque a marca de saída
 * mora no JSDoc e as chamadas moram no corpo.
 * @returns {Array<{nome: string, bloco: string, corpo: string}>}
 */
function secoesDaAba() {
    const re = /^ {4}_pintar(\w+)\(([^)]*)\)\s*\{/gm;
    const achadas = [];
    let m = re.exec(FONTE);
    while (m) {
        const params = m[2].split(',').map((p) => p.trim());
        if (params.includes('resultado')) {
            // O fecho de um método da classe é o único `}` com quatro espaços de indentação. Sem
            // ele o recorte não existe, e a seção entra com corpo VAZIO de propósito: busca em
            // string vazia é sempre "não achou", e o piso de tamanho acusa a varredura quebrada
            // em vez de deixá-la devolver verde sobre nada.
            const fim = FONTE.indexOf('\n    }\n', m.index);
            const inicioDoc = FONTE.lastIndexOf('    /**', m.index);
            achadas.push({
                nome: `_pintar${m[1]}`,
                bloco: fim === -1 ? '' : FONTE.slice(inicioDoc === -1 ? m.index : inicioDoc, fim),
                corpo: fim === -1 ? '' : semComentarios(FONTE.slice(m.index, fim)),
            });
        }
        m = re.exec(FONTE);
    }
    return achadas;
}

/**
 * O corpo de um MÉTODO da classe, sem comentários. Mesmo recorte grosseiro de `secoesDaAba`, para
 * os métodos que não são pintores de seção (o ato de ciclo de vida, a linha, a gaveta).
 *
 * O `async?` NÃO É ZELO, é o conserto de uma cobertura vazia real: sem ele os dois métodos que
 * fazem rede (`_mudarEstado`, `_carregarOcorrencias`) não casavam, a fatia saía vazia e busca em
 * string vazia é sempre "não achou". Quem acusou foi o piso de tamanho de cada caso, que existe
 * exatamente para isso; sem o piso, os dois casos teriam passado VERDE sobre nada.
 * @param {string} nome
 * @returns {string}
 */
function corpoDeMetodo(nome) {
    const re = new RegExp(`^ {4}(?:async )?${nome}\\(`, 'm');
    const m = re.exec(FONTE);
    if (!m) return '';
    const fim = FONTE.indexOf('\n    }\n', m.index);
    return fim === -1 ? '' : semComentarios(FONTE.slice(m.index, fim));
}

/**
 * O corpo de uma FUNÇÃO de topo do módulo, sem comentários. Irmã de `corpoDeMetodo`, e ela existe
 * porque os construtores de DOM da aba não são métodos da classe: o fecho deles é o `}` na coluna
 * zero, e não o de quatro espaços.
 *
 * Devolve string vazia quando não acha, e é por isso que todo caso que a usa tem PISO DE TAMANHO:
 * busca em string vazia é sempre "não achou", o que faria a asserção passar verde sobre nada.
 * @param {string} nome
 * @returns {string}
 */
function fatiaDeFuncao(nome) {
    const re = new RegExp(`^function ${nome}\\(`, 'm');
    const m = re.exec(FONTE);
    if (!m) return '';
    const fim = FONTE.indexOf('\n}\n', m.index);
    return fim === -1 ? '' : semComentarios(FONTE.slice(m.index, fim));
}

describe('as seções da aba Diagnóstico que leem arquivo de log', () => {
    const secoes = secoesDaAba();

    it('a varredura acha as seções, senão ela passaria verde sem verificar nada', () => {
        // A COBERTURA VAZIA É O MODO DE FALHA DESTE ARQUIVO: uma expressão que deixe de casar
        // (uma indentação diferente, um `#pintar` privado, a classe virando função) esvazia a
        // lista e todo o resto abaixo passa sobre zero itens. Daí o piso e o corpo mínimo.
        expect(secoes.length).toBeGreaterThanOrEqual(4);
        expect(secoes.map((s) => s.nome)).toContain('_pintarPulso');
        expect(secoes.map((s) => s.nome)).toContain('_pintarDefeitos');
        expect(secoes.map((s) => s.nome)).toContain('_pintarResumo');
        // O corpo recortado tem de ser um corpo de verdade: um `indexOf` que devolvesse -1 no
        // fecho do método daria uma fatia vazia, e busca em string vazia é sempre "não achou".
        const curtas = secoes.filter((s) => s.corpo.length < 200).map((s) => s.nome);
        expect(curtas).toEqual([]);
        // E o pintor que NÃO recebe `resultado` fica de fora por assinatura, não por nome: sem
        // isso a lista derivada arrastaria `_pintarCarregando`, que não tem payload nenhum.
        expect(secoes.map((s) => s.nome)).not.toContain('_pintarCarregando');
    });

    it('toda seção que lê o log chama `leitorCego` e `_notasDaLeitura`', () => {
        const faltas = [];
        for (const secao of secoes) {
            if (secao.bloco.includes(MARCA_SEM_LOG)) continue;
            // A SEGUNDA MARCA DISPENSA SÓ O `leitorCego`, e a nota continua cobrada logo abaixo:
            // é ela que carrega o truncamento, que nenhum bloco declara sozinho.
            if (!secao.bloco.includes(MARCA_CEGUEIRA_POR_BLOCO) && !secao.corpo.includes('leitorCego(')) {
                faltas.push(`${ARQUIVO} › ${secao.nome}: não chama leitorCego(), então desenha a `
                    + 'boa notícia sem saber se o leitor estava ligado');
            }
            if (!secao.corpo.includes('this._notasDaLeitura(')) {
                faltas.push(`${ARQUIVO} › ${secao.nome}: não chama this._notasDaLeitura(), então `
                    + 'não diz o que foi varrido nem que a janela foi truncada');
            }
        }
        expect(faltas).toEqual([]);
    });

    it('o leitor cego é consultado ANTES de qualquer vazio desenhado', () => {
        // A ORDEM É O CONSERTO, e invertê-la é sutil: as rotas respondem 200 com lista vazia (e,
        // no pulso, com total zero) quando o diretório de log não existe, então o ramo de vazio
        // colocado primeiro captura o caso cego e nunca devolve o controle.
        const faltas = [];
        for (const secao of secoes) {
            if (secao.bloco.includes(MARCA_SEM_LOG)) continue;
            const cego = secao.corpo.indexOf('leitorCego(');
            const vazios = ['emptyState(', 'bomVazio(']
                .map((t) => secao.corpo.indexOf(t))
                .filter((i) => i !== -1);
            if (cego === -1 || vazios.length === 0) continue;
            const primeiroVazio = Math.min(...vazios);
            if (cego > primeiroVazio) {
                faltas.push(`${ARQUIVO} › ${secao.nome}: desenha o vazio antes de perguntar por `
                    + 'leitorCego(), e o vazio do leitor cego é indistinguível do vazio saudável');
            }
        }
        expect(faltas).toEqual([]);
        // Controle da própria varredura: ela só tem o que ordenar se as duas coisas existirem.
        const comOrdem = secoes.filter((s) => !s.bloco.includes(MARCA_SEM_LOG)
            && s.corpo.includes('leitorCego(')
            && (s.corpo.includes('emptyState(') || s.corpo.includes('bomVazio(')));
        expect(comOrdem.length).toBeGreaterThanOrEqual(2);
    });

    it('a nota sai UMA VEZ POR DESFECHO INFORMATIVO, e não uma vez por seção', () => {
        // `_pintarLatencia` passava nos dois casos acima chamando a nota só no ramo da tabela.
        // Contar é o suficiente: não é preciso saber QUAL ramo ficou mudo para saber que um
        // ficou.
        const conta = (texto, token) => texto.split(token).length - 1;
        const faltas = [];
        for (const secao of secoes) {
            if (secao.bloco.includes(MARCA_SEM_LOG)) continue;
            // Cada vazio e cada bloco de leitor cego é um desfecho que a pessoa lê; o `+ 1` é o
            // fall-through com dado, que toda seção tem e nenhum literal marca.
            const informativos = conta(secao.corpo, 'emptyState(')
                + conta(secao.corpo, 'bomVazio(')
                + conta(secao.corpo, 'leitorCegoNotice(')
                + 1;
            const notas = conta(secao.corpo, 'this._notasDaLeitura(');
            if (notas < informativos) {
                faltas.push(`${ARQUIVO} › ${secao.nome}: ${informativos} desfechos informativos e `
                    + `só ${notas} chamada(s) de this._notasDaLeitura(), então pelo menos um deles `
                    + 'sai sem dizer o que foi varrido nem acusar truncamento');
            }
        }
        expect(faltas).toEqual([]);
    });

    it('quem se declara fora da varredura não pode consultar o leitor de log', () => {
        // A marca é uma DECLARAÇÃO, e declaração que contradiz o próprio corpo é pior que marca
        // nenhuma: ela silencia a varredura dizendo algo falso sobre a seção.
        const contraditorias = secoes
            .filter((s) => s.bloco.includes(MARCA_SEM_LOG) && s.corpo.includes('leitorCego('))
            .map((s) => `${ARQUIVO} › ${s.nome}: declara ${MARCA_SEM_LOG} e mesmo assim chama `
                + 'leitorCego()');
        expect(contraditorias).toEqual([]);
        // E A SAÍDA NÃO É GRATUITA: a lista de quem se declara fora é asserida por NOME e em
        // igualdade absoluta, e não por contagem. Contagem deixaria uma seção nova trocar de lugar
        // com outra sem nada ficar vermelho, e é justamente a declaração que precisa ser conferida
        // por quem lê. Zero significaria que a marca deixou de ser lida e a varredura virou vácuo.
        expect(secoes.filter((s) => s.bloco.includes(MARCA_SEM_LOG)).map((s) => s.nome))
            .toEqual(['_pintarDefeitos']);
        // E cada declaração traz o MOTIVO junto, senão a marca é um interruptor que desliga a
        // varredura sem prestar contas.
        for (const secao of secoes.filter((s) => s.bloco.includes(MARCA_SEM_LOG))) {
            expect(secao.bloco.length, secao.nome).toBeGreaterThan(400);
        }
    });

    it('quem se declara com cegueira POR BLOCO também não consulta o leitor, e paga a nota', () => {
        // A SEGUNDA MARCA É MAIS ESTREITA, e as três asserções abaixo são o que a mantém assim: ela
        // dispensa o `leitorCego` (a cegueira chega resolvida por bloco), continua devendo a nota
        // da leitura, e é ASSERIDA POR NOME. Sem a terceira, ela viraria a fresta por onde uma
        // seção qualquer sai da varredura escrevendo uma palavra no JSDoc.
        const marcadas = secoes.filter((s) => s.bloco.includes(MARCA_CEGUEIRA_POR_BLOCO));
        expect(marcadas.map((s) => s.nome)).toEqual(['_pintarResumo']);
        for (const secao of marcadas) {
            expect(secao.corpo, `${secao.nome} declara ${MARCA_CEGUEIRA_POR_BLOCO} e chama leitorCego()`)
                .not.toContain('leitorCego(');
            expect(secao.corpo, `${secao.nome} não chama this._notasDaLeitura()`)
                .toContain('this._notasDaLeitura(');
            // E ela passa o ENVELOPE, não o payload nu: no topo daquela resposta `arquivos`,
            // `linhas` e `truncado` não existem, e a nota sairia muda sobre um documento que
            // varreu o log.
            expect(secao.corpo).toContain('this._notasDaLeitura(host, payload?.janela)');
            // As duas marcas são exclusivas: uma seção que carregasse as duas estaria dizendo que
            // lê e que não lê o log.
            expect(secao.bloco).not.toContain(MARCA_SEM_LOG);
        }
    });
});

describe('a seção de Resumo, do lado do CONSUMIDOR', () => {
    // POR QUE ESTRUTURAL, E POR QUE AQUI: as frases estão presas como funções puras em
    // `resumo-frases.test.js`, e nada disso impede `diag-tab.js` de nunca chamá-las. É o mesmo
    // buraco que esta suíte nasceu para fechar no Pulso ("a mentira era do consumidor"), e aqui
    // ele é maior, porque a seção se declara FORA da varredura de log: o que substitui `leitorCego`
    // e `_notasDaLeitura` nela é `_cartaoDeResumo`, e é ele que precisa estar preso.
    //
    // CONTROLES NEGATIVOS (o que fica vermelho ao voltar cada peça ao óbvio):
    //  - desenhar o corpo de um cartão antes de perguntar pelo desfecho: o segundo caso reprova, e
    //    é o que impede zero de sair ao lado de `disponivel: false`;
    //  - colapsar "ausente" e "sem fonte" numa frase só: o segundo caso reprova;
    //  - deixar a premissa de fora do caminho: o segundo caso reprova;
    //  - trocar a tabela de corpos por um encadeamento de `if`: o terceiro caso reprova, e é o que
    //    impede o cartão novo de cair no ramo de outro sem nada de errado na tela.

    const secao = secoesDaAba().find((s) => s.nome === '_pintarResumo');

    it('a seção se declara com cegueira por bloco, com o motivo, e a grade cai junta', () => {
        expect(secao).toBeTruthy();
        expect(secao.bloco).toContain(MARCA_CEGUEIRA_POR_BLOCO);
        // O MOTIVO NOMEIA A FUNÇÃO DO SERVIDOR, que é o que torna a declaração conferível: quem
        // duvidar abre `montarResumo` e vê a cegueira resolvida por bloco.
        expect(secao.bloco).toContain('montarResumo');
        // A ROTA É UMA SÓ, então payload irreconhecível é FALHA de seção (com botão), e nunca seis
        // cartões dizendo "o servidor não informou": seis frases se leem como seis fatos.
        expect(secao.corpo).toContain('resumoReconhecido(payload)');
        // A JANELA DA FRASE É A QUE O SERVIDOR MEDIU (`periodo.desde`), com o estado local só como
        // queda: os dois coincidem hoje, e no dia em que a rota aparar a janela quem lê precisa ver
        // o que foi medido, e não o que foi pedido.
        expect(secao.corpo).toContain('payload?.periodo?.desde');
        expect(secao.corpo).toContain('janelaEmPalavras(desdeMedido || janela)');
        // E A HORA DA COMPOSIÇÃO SAI NA TELA: `gerado_em` chegava e não aparecia, e a aba não
        // recarrega sozinha, então nada dizia que o cartão podia ter duas horas de idade.
        expect(secao.corpo).toContain('compostoEmNotice(payload, horaLocal)');
        expect(secao.corpo).toContain('failureState(');
        expect(secao.corpo).toContain('BLOCOS_DO_RESUMO');
        expect(secao.corpo).toContain('this._cartaoDeResumo(');
        // E ela NÃO desenha número nenhum por fora do cartão: o único caminho até um valor é
        // `_cartaoDeResumo`, que cobra a premissa antes.
        expect(secao.corpo).not.toContain('contagemLabel(');
        expect(secao.corpo).not.toContain('tile(');
    });

    it('nenhum cartão desenha número sem antes ter passado pelo desfecho e pela premissa', () => {
        // ELE É O `cabecalhoDeBloco` DO COMANDO, e a propriedade que se cobra é a mesma: os dois
        // ramos de ausência de fonte RETORNAM antes do corpo, e a premissa entra no caminho que
        // sobra. Seis cabeçalhos escritos à mão seriam seis chances de esquecer um, e o esquecido
        // desenharia zero com cara de boa notícia.
        const corpo = corpoDeMetodo('_cartaoDeResumo');
        expect(corpo.length).toBeGreaterThan(400);
        expect(corpo).toContain('desfechoDoBloco(bloco)');
        expect(corpo).toContain('blocoAusenteNotice()');
        expect(corpo).toContain('semFonteNotice(bloco)');
        expect(corpo).toContain('premissaDoBloco(bloco)');
        expect(corpo).toContain('CORPO_DO_RESUMO[definicao.id](bloco, {');
        // O TRUNCAMENTO ATRAVESSA ATÉ O CORPO, porque a premissa de bloco não o carrega e o efeito
        // dele é de quem compara duas janelas: o anel descarta o mais ANTIGO, que é a base do
        // delta. Sem esta linha o aviso ficaria só no rodapé da seção, longe da coluna que ele
        // desmente.
        expect(corpo).toContain('payload?.janela?.truncado === true');

        // A ORDEM É O CONTRATO: os dois desfechos sem fonte vêm ANTES da premissa, e a premissa
        // antes do corpo. Invertê-los é sutil e devolve exatamente o defeito que a seção existe
        // para impedir.
        const ausente = corpo.indexOf('blocoAusenteNotice()');
        const semFonte = corpo.indexOf('semFonteNotice(bloco)');
        const premissa = corpo.indexOf('premissaDoBloco(bloco)');
        const despacho = corpo.indexOf('CORPO_DO_RESUMO[definicao.id](bloco, {');
        expect(ausente).toBeLessThan(semFonte);
        expect(semFonte).toBeLessThan(premissa);
        expect(premissa).toBeLessThan(despacho);
        // E os dois ramos sem fonte SAEM da função: sem o `return` o corpo seria desenhado logo
        // abaixo da frase que diz que não há fonte.
        expect(corpo.slice(ausente, premissa)).toMatch(/return art;[\s\S]*return art;/);
        // O desfecho sai também como DADO, que é o que uma captura de tela consegue afirmar.
        expect(corpo).toContain("art.dataset.desfecho = desfecho");
    });

    it('todo cartão declarado tem corpo registrado, e o despacho é TABELA e não `if`', () => {
        // A LISTA VEM DO MÓDULO DE FRASES, e não escrita aqui: um cartão novo nasce cobrado.
        const tabela = FONTE.slice(
            FONTE.indexOf('const CORPO_DO_RESUMO = Object.freeze({'),
            FONTE.indexOf('});', FONTE.indexOf('const CORPO_DO_RESUMO = Object.freeze({')),
        );
        expect(tabela.length).toBeGreaterThan(100);
        const faltas = BLOCOS_DO_RESUMO
            .filter((b) => !new RegExp(`\\b${b.id}:\\s*corpoDe`).test(tabela))
            .map((b) => `${ARQUIVO}: o cartão "${b.id}" não tem corpo registrado em CORPO_DO_RESUMO`);
        expect(faltas).toEqual([]);
        // E a tabela não tem entrada a mais: um corpo órfão é um cartão que ninguém desenha.
        const chaves = [...tabela.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
        expect(chaves.sort()).toEqual(BLOCOS_DO_RESUMO.map((b) => b.id).sort());
    });

    it('o resumo NÃO espera as irmãs, e mesmo assim carrega a guarda de geração', () => {
        // O `allSettled` PROTEGE CONTRA FALHA, NÃO CONTRA LATÊNCIA: ele resolve no mais lento, e o
        // resumo é o mais caro do conjunto (uma passada sobre o DOBRO da janela de log, mais a
        // lista de defeitos). Dentro dele, o Pulso, os Defeitos e a Latência ficavam em
        // "Carregando…" esperando um cartão que nenhuma delas precisa, e o seletor de janela ficava
        // recusando o gesto pelo mesmo tempo. A asserção é estrutural porque o defeito é de
        // ARRANJO: não há nada de errado em nenhuma das quatro chamadas.
        const carregar = corpoDeMetodo('_carregar');
        expect(carregar.length).toBeGreaterThan(400);
        expect(carregar).toContain('settle(() => pedirDiag(rotas.resumo)).then(');
        // Ele fica FORA da lista do `allSettled`, e é isso que a próxima reescrita desfaz sem
        // perceber, porque juntar as quatro parece arrumação.
        const allSettled = carregar.slice(carregar.indexOf('Promise.allSettled(['));
        expect(allSettled).not.toContain('rotas.resumo');
        // E as três irmãs continuam juntas: separá-las também seria mudança, e sem base.
        for (const rota of ['rotas.status', 'rotas.defeitos', 'rotas.lento']) {
            expect(allSettled, rota).toContain(rota);
        }
        // A GUARDA VIAJA JUNTO. Sem ela, a resposta lenta de uma janela abandonada pintaria por
        // cima da rápida da janela nova, que é a corrida que o contador de geração existe para
        // cobrir; e ela não pode ser a do `await`, porque este caminho não passa por lá.
        const destino = corpoDeMetodo('_resumoRespondeu');
        expect(destino.length).toBeGreaterThan(80);
        expect(destino).toContain('!this._alive || geracao !== this._geracao');
        expect(destino).toContain('return');
        // E ele NÃO devolve o seletor de janela: fazer isso aqui devolveria o atraso que a
        // separação removeu, porque o gesto voltaria a esperar o mais lento.
        expect(destino).not.toContain('_carregando');
        expect(destino).not.toContain('aria-disabled');
    });

    it('todo cartão que publica um "anterior" acusa o truncamento, e são DOIS', () => {
        // O ANEL DESCARTA O MAIS ANTIGO, que é exatamente a janela de comparação: sob truncamento a
        // latência compara uma janela cheia com uma pela metade, e a contagem de query lenta
        // "anterior" é de um pedaço dela. Os dois cartões publicam um número daquela janela, então
        // os dois devem a ressalva; deixá-la só na latência silenciaria metade do defeito.
        for (const nome of ['corpoDeLatencia', 'corpoDeQueriesLentas']) {
            const corpo = fatiaDeFuncao(nome);
            expect(corpo.length, nome).toBeGreaterThan(150);
            expect(corpo, `${nome} não acusa o truncamento ao lado do número da janela anterior`)
                .toContain('deltaTruncadoNotice()');
            expect(corpo, `${nome} ignora o contexto que carrega o truncamento`)
                .toContain('contexto?.truncado === true');
        }
        // E ela é a MESMA frase nos dois: duas redações do mesmo fato divergiriam no primeiro
        // conserto, e as duas apareceriam na mesma grade.
        expect(semComentarios(FONTE).split('deltaTruncadoNotice()').length - 1).toBe(2);
    });

    it('o TOTAL do pulso resumido também acusa o corte, e com OUTRA frase', () => {
        // O ANEL COME AS REQUISIÇÕES MAIS ANTIGAS, então o total sai SUB-RELATADO: "156
        // requisições" vira um piso, e comparar com ontem passa a ser comparar um total com um
        // pedaço. O ladrilho era o único número da grade que sofria o corte sem dizer.
        const corpo = fatiaDeFuncao('corpoDeStatus');
        expect(corpo.length).toBeGreaterThan(200);
        expect(corpo).toContain('contexto?.truncado === true');
        expect(corpo).toContain('totalTruncadoNotice()');
        // A FRASE É OUTRA, e não a do delta: lá falta a BASE de comparação, aqui o número em si
        // está incompleto. Reusar uma descreveria um problema que não é o daquele ladrilho e
        // deixaria o que é passar batido.
        expect(corpo).not.toContain('deltaTruncadoNotice()');
        // E ela sai nos DOIS desfechos do cartão, o vazio inclusive: um total zero sob truncamento
        // é o caso em que a boa notícia é mais fácil de acreditar e mais fácil de estar errada.
        expect(corpo.split('truncado,').length - 1).toBe(2);
    });

    it('o cartão de defeitos escreve a mensagem de terceiro por `textContent`, como o resto da aba', () => {
        // A MENSAGEM DO TOPO É TEXTO DE TERCEIRO, pelo mesmo caminho da tabela de baixo: ela vem do
        // navegador de quem visitou a página pública. A varredura de `innerHTML` já é do arquivo
        // inteiro; o que este caso prende é que o corte é de LAYOUT e o texto inteiro fica no
        // `title`, senão a única cópia da mensagem na tela seria a cortada.
        const corpo = fatiaDeFuncao('corpoDeDefeitos');
        expect(corpo.length).toBeGreaterThan(200);
        expect(corpo).toContain('resumirTexto(item?.mensagem');
        expect(corpo).toContain('mensagem.title = item.mensagem');
        expect(corpo).toContain('textContent');
    });
});

describe('o ladrilho de erros do pulso, do lado do consumidor', () => {
    it('o estado do ladrilho vem de `estadoDaContagemDeErros`, e não de um ternário local', () => {
        // O DEFEITO ERA UM TERNÁRIO: `contagem > 0 ? 'erro' : 'ok'` pinta de VERDE o campo que não
        // chegou, ao lado de um travessão dizendo que o número falta. A asserção mira a CHAMADA
        // porque é ela que traz os três estados; o comportamento dos três está preso em
        // `diagnostico-frases.test.js`.
        const corpo = semComentarios(FONTE);
        expect(corpo).toContain('estadoDaContagemDeErros(dados?.erros)');
        expect(corpo).not.toMatch(/\?\s*'erro'\s*:\s*'ok'/);
    });
});

describe('a seção de Defeitos, do lado do CONSUMIDOR', () => {
    // POR QUE ESTRUTURAL, E POR QUE AQUI: as frases e os vocabulários estão presos como funções
    // puras em `defeito-frases.test.js`, e nada disso impede `diag-tab.js` de nunca chamá-las, que
    // é exatamente o buraco que esta suíte nasceu para fechar no Pulso ("a mentira era do
    // consumidor"). Os dois blocos que este substitui prendiam as duas seções que a de Defeitos
    // fundiu.
    //
    // CONTROLES NEGATIVOS (o que fica vermelho ao voltar cada peça ao óbvio):
    //  - ordenar a lista por `ocorrencias` em vez de `ordenarDefeitos`: o primeiro caso reprova, e
    //    é o que impede o pódio sobre a amostra que o servidor cortou por recência;
    //  - usar `contagemDetalhe` no crachá: o segundo reprova, e é o que impede o número vitalício
    //    de voltar a se anunciar como contagem da janela;
    //  - trocar `aria-disabled` por `disabled` no botão em voo: o quarto reprova, e é o que
    //    mantém o clique (que é como o motivo chega à pessoa) chegando;
    //  - pintar a linha com o estado PEDIDO em vez do devolvido: o quinto reprova.

    const secao = secoesDaAba().find((s) => s.nome === '_pintarDefeitos');

    it('a seção se declara fora da varredura de log, com o motivo, e pega a lista do payload', () => {
        expect(secao).toBeTruthy();
        expect(secao.bloco).toContain(MARCA_SEM_LOG);
        // A lista vem por `listaDoPayload`, que é o que faz payload malformado virar FALHA e não
        // "nenhum defeito": a boa notícia mais perigosa do produto.
        expect(secao.corpo).toContain("listaDoPayload(payload, 'itens')");
        expect(secao.corpo).toContain('estadoDaSecao(');
        expect(secao.corpo).toContain('ordenarDefeitos(itens)');
    });

    it('o vazio COM filtro não é a boa notícia verde do vazio sem filtro', () => {
        // CONFUNDIR OS DOIS É AFIRMAR SAÚDE quando o que está estreito é a pergunta: um filtro de
        // estado `ignorado` numa instalação sem nenhum ignorado desenharia "nenhum defeito nas
        // últimas 24 horas" com a cara verde de sistema íntegro.
        expect(secao.corpo).toContain('temFiltroAtivo(this._filtros)');
        expect(secao.corpo).toContain('defeitosFiltradosEmptyNotice(');
        expect(secao.corpo).toContain('bomVazio(defeitosEmptyNotice(');
        // E o ramo do filtro NÃO passa por `bomVazio`: ele é o `emptyState` cinzento da casa.
        const filtrado = secao.corpo.indexOf('defeitosFiltradosEmptyNotice(');
        const verde = secao.corpo.indexOf('bomVazio(defeitosEmptyNotice(');
        expect(filtrado).toBeLessThan(verde);
    });

    it('o crachá é nomeado por RELATO ACUMULADO, e não pelo detalhe da janela', () => {
        const corpo = corpoDeMetodo('_linhaDeDefeito');
        expect(corpo.length).toBeGreaterThan(200);
        expect(corpo).toContain('contagemHistoricaDetalhe(');
        expect(corpo).toContain('contagemHistoricaUnidade(');
        // `contagemDetalhe` diz "12.000 ocorrências", que é falso duas vezes: o número é
        // acumulado de sempre, e conta relatos (uma sessão relata a mesma assinatura uma vez só).
        expect(corpo).not.toContain('contagemDetalhe(');
        // E o tempo da coluna é RELATIVO, com o absoluto no `title`: a pergunta da coluna é se
        // isto ainda está acontecendo, e a resposta é uma distância.
        expect(corpo).toContain('tempoRelativo(');
        expect(corpo).toContain('intervaloDeOcorrencias(');
    });

    it('a nota do recorte diz o corte, os novos desde a visita e o que o número significa', () => {
        const corpo = corpoDeMetodo('_repintarDerivados');
        expect(corpo.length).toBeGreaterThan(200);
        // "N de M", pela MESMA função das outras seções: um segundo jeito de dizer a mesma coisa
        // divergiria na primeira correção.
        expect(corpo).toContain("cortadaNotice(this._defeitos.length, this._totalDeDefeitos, 'defeitos')");
        expect(corpo).toContain('contarNovos(');
        expect(corpo).toContain('novosDesdeNotice(');
        // A PRIMEIRA VISITA TEM FRASE PRÓPRIA: sem marca, nada é novo, e calar faria a ausência do
        // selo parecer marca que não carregou.
        expect(corpo).toContain('primeiraVisitaNotice()');
        expect(corpo).toContain('contagemNotice()');
    });

    it('as DUAS palavras "novo" desta tela continuam sendo duas', () => {
        // O FILTRO é da JANELA (`?novos=1`, comparado com o começo do período pelo servidor) e o
        // SELO é da última visita desta pessoa (`localStorage`). Ligar o selo ao filtro (ou o
        // filtro à marca) faria a tela dizer duas coisas com uma conta só, e as duas ficariam
        // erradas em metade dos casos.
        const rota = semComentarios(FONTE.slice(
            FONTE.indexOf('function rotaDeDefeitos('),
            FONTE.indexOf('\n}\n', FONTE.indexOf('function rotaDeDefeitos(')),
        ));
        expect(rota).toContain("q.set('novos', '1')");
        expect(rota).toContain('filtros.novos');
        expect(rota).not.toContain('marcaDeVisita');
        const linha = corpoDeMetodo('_celulaDeEstado');
        expect(linha).toContain('ehNovo(item, this._marcaDeVisita)');
        expect(linha).not.toContain('filtros');
    });

    it('o botão em voo usa `aria-disabled`, e NUNCA a propriedade `disabled`', () => {
        // Botão desabilitado não dispara clique, e o clique é como o motivo chega à pessoa. O
        // bloqueio aqui é de ESTADO (há um pedido em voo, e ele termina), não de posto.
        const corpo = corpoDeMetodo('_botaoDeAcao');
        expect(corpo.length).toBeGreaterThan(200);
        expect(corpo).toContain("setAttribute('aria-disabled', 'true')");
        expect(corpo).toContain('acaoEmVooNotice()');
        expect(corpo).not.toMatch(/\.disabled\s*=/);
        // E o clique recusado FALA: sem isto o `aria-disabled` seria só decoração de leitor de
        // tela, e a pessoa clicaria num botão que não faz nem diz nada.
        expect(corpo).toContain('showError(acaoEmVooNotice())');
        // O MESMO VALE PARA O "CONFIRMAR" do formulário de commit, que é o outro caminho até o
        // `PATCH`: ele tinha um `return` mudo com pedido em voo.
        expect(corpoDeMetodo('_formularioDeCommit')).toContain('showError(acaoEmVooNotice())');
    });

    it('NENHUM comando desta aba usa a propriedade `disabled`, o seletor de janela inclusive', () => {
        // A VARREDURA É DO ARQUIVO INTEIRO, e não de um método, porque o sítio que sobrava era
        // justamente o que ninguém olhava: `_carregar` desligava o `<select>` da janela com
        // `.disabled = true` durante a leitura. Um seletor que não responde por um segundo e não
        // diz nada se lê como tela travada, e um controle desabilitado não dispara evento nenhum,
        // então não há por onde o motivo chegar.
        const corpo = semComentarios(FONTE);
        expect(corpo).not.toMatch(/\.disabled\s*=/);
        // E a recusa do seletor é a da casa: nomeia o estado e devolve o controle ao valor que
        // está na tela, porque um `<select>` com `aria-disabled` muda de valor de verdade.
        const seletor = corpoDeMetodo('_seletorDeJanela');
        expect(seletor.length).toBeGreaterThan(200);
        expect(seletor).toContain('showError(janelaEmVooNotice())');
        expect(seletor).toContain('select.value = this._janela');
        expect(corpoDeMetodo('_carregar')).toContain("setAttribute('aria-disabled', 'true')");
    });

    it('o estado de tela que o repinte não pode perder está guardado FORA do DOM', () => {
        // O REPINTE É INTEIRO (`_pintarLinhas` reconstrói o corpo da tabela), e ele roda quando a
        // resposta das ocorrências chega, ou seja, enquanto a pessoa lê. O hash digitado no campo
        // de commit e a pilha aberta se perdiam ali, calados. O que os salva é serem lidos de um
        // `Map`/`Set` na recriação, e não o valor que estava no nó destacado.
        const commit = corpoDeMetodo('_formularioDeCommit');
        expect(commit).toContain('this._commitDigitado.get(item?.id)');
        expect(commit).toContain('this._commitDigitado.set(item?.id, input.value)');
        const gaveta = corpoDeMetodo('_conteudoDaGaveta');
        expect(gaveta).toContain('this._pilhasAbertas.has(item?.id)');
        expect(gaveta).toContain("'toggle'");
    });

    it('os ouvintes de LINHA têm escopo próprio, limpo a cada repinte', () => {
        // COM O ESCOPO DA ABA (`'view'`, que só `_render` limpa) cada repinte acrescentava uma
        // entrada por ouvinte de cada linha, todas segurando nós já destacados da árvore. A
        // primeira linha do repinte tem de ser a limpeza, senão ela limparia o que acabou de
        // registrar.
        const corpo = corpoDeMetodo('_pintarLinhas');
        expect(corpo).toContain("clearScopedListeners(this, 'linhas')");
        const limpeza = corpo.indexOf("clearScopedListeners(this, 'linhas')");
        const primeiroNo = corpo.indexOf('this._tbody.replaceChildren()');
        expect(limpeza).toBeLessThan(primeiroNo);
        // E NENHUM ouvinte de linha pode ficar no escopo da aba: a varredura é dos cinco métodos
        // que o repinte reconstrói.
        for (const nome of ['_celulaDeMensagem', '_botaoDeAcao', '_formularioDeCommit',
            '_linhaDeOcorrencia', '_conteudoDaGaveta']) {
            const m = corpoDeMetodo(nome);
            expect(m.length, nome).toBeGreaterThan(100);
            expect(m, `${nome} registra ouvinte no escopo da aba`)
                .not.toContain("addScopedDomListener(this, 'view'");
        }
    });

    it('a marca da última visita é gravada na SAÍDA, e não na montagem', () => {
        // GRAVAR NA MONTAGEM fazia ir à aba vizinha e voltar apagar todos os selos "novo", porque
        // o painel desmonta e remonta a aba a cada troca. O evento de saída é o `cleanup` que
        // `mount` devolve.
        const corpo = corpoDeMetodo('mount');
        expect(corpo.length).toBeGreaterThan(200);
        expect(corpo).toContain('lerMarcaDeVisita(this._userId)');
        const leitura = corpo.indexOf('lerMarcaDeVisita(this._userId)');
        const escrita = corpo.indexOf('escreverMarcaDeVisita(this._userId');
        expect(escrita).toBeGreaterThan(-1);
        // A escrita mora DEPOIS, dentro do callback devolvido, junto do `_alive = false`.
        expect(escrita).toBeGreaterThan(leitura);
        expect(corpo.slice(escrita - 200, escrita)).toContain('this._alive = false');
    });

    it('a linha é relida da RESPOSTA do servidor, e nunca do que o clique pediu', () => {
        const corpo = corpoDeMetodo('_mudarEstado');
        expect(corpo.length).toBeGreaterThan(200);
        // O estado pedido sai do vocabulário, e não de uma string literal no sítio do clique.
        expect(corpo).toContain('estadoAlvoDaAcao(acao)');
        // A linha reescrita é a que veio do `PATCH`.
        expect(corpo).toContain('await mudarEstadoDoDefeito(');
        expect(corpo).toContain('this._defeitos.map((d) => (d.id === id ? atualizado : d))');
        expect(corpo).toContain('acaoSucessoNotice(atualizado)');
        // E nada escreve o estado pedido por cima do item que está na tela.
        expect(corpo).not.toMatch(/item\.estado\s*=/);
        // Resposta irreconhecível recarrega, em vez de passar por sucesso silencioso.
        expect(corpo).toContain('this._carregar()');
    });

    it('a gaveta lê as ocorrências na primeira abertura, e a lista ausente é FALHA', () => {
        const alterna = corpoDeMetodo('_alternarGaveta');
        expect(alterna.length).toBeGreaterThan(100);
        expect(alterna).toContain('this._ocorrencias.has(id)');
        expect(alterna).toContain('this._carregarOcorrencias(item)');

        const carrega = corpoDeMetodo('_carregarOcorrencias');
        expect(carrega.length).toBeGreaterThan(200);
        expect(carrega).toContain("listaDoPayload(dados, 'itens')");
        // MESMA DECISÃO DE `estadoDaSecao`: lista ausente não vira "nenhuma ocorrência". Aqui ela
        // importa igual, porque o vazio desta gaveta tem significado próprio (a poda passou).
        expect(carrega).toContain('Array.isArray(itens)');
        expect(carrega).toContain('erro:');
    });

    it('nada da seção monta HTML: o dado desta aba é texto de terceiro', () => {
        // Mensagem, pilha, user agent, URL e MIGALHA vêm do navegador de quem visita a página
        // pública. O arquivo inteiro é varrido, e não só a seção: uma única exceção aqui vale
        // pelo resto.
        const corpo = semComentarios(FONTE);
        expect(corpo).not.toContain('innerHTML');
        expect(corpo).not.toContain('insertAdjacentHTML');
        const migalhas = semComentarios(FONTE.slice(
            FONTE.indexOf('function blocoDeMigalhas('),
            FONTE.indexOf('\n}\n', FONTE.indexOf('function blocoDeMigalhas(')),
        ));
        expect(migalhas.length).toBeGreaterThan(200);
        expect(migalhas).toContain('textContent');
        expect(migalhas).toContain('textoDeMigalhaLabel(');
    });
});
