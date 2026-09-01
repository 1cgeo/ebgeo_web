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
 * "Nenhuma requisição registrada nas últimas 24 horas" ao lado de duas seções dizendo "leitor
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
 * Medida contra o arquivo real, ela dá 3 = 3 nas três seções de log e não acusa nenhuma.
 *
 * O QUE A CONTAGEM COBRA A MAIS DO QUE DEVERIA, dito antes que alguém a afrouxe: ela é um piso
 * por SOMA, então uma seção futura que desenhe dois vazios distintos cobertos por uma nota só
 * seria acusada sem estar errada. Se esse dia chegar, o conserto é classificar a seção (como
 * `@nao-le-log` faz com a que lê o banco), e nunca baixar o piso, que devolveria exatamente o
 * silêncio que a latência tinha.
 *
 * A LISTA DE SEÇÕES É DERIVADA DO CÓDIGO, e essa é a metade que faz o guarda sobreviver. Ela não
 * é escrita aqui: a varredura acha todo método `_pintarX(host, resultado, janela)` da classe, ou
 * seja, todo pintor que recebe o desfecho de uma das rotas de `/diag`. Uma quinta seção nasce já
 * cobrada, e é essa a diferença entre um guarda e uma lista que envelhece. `_pintarCarregando`
 * fica de fora pela ASSINATURA (não recebe `resultado`), e não por nome.
 *
 * A SAÍDA DECLARADA. Nem toda seção da aba lê arquivo de log: "Erros do navegador" vem do BANCO,
 * e nela `diretorioAusente` e `truncado` não existem. Ela escapa da varredura escrevendo
 * `@nao-le-log` no próprio JSDoc, com o motivo ao lado, que é o padrão de censo da casa (a seção
 * nova reprova até ser CLASSIFICADA). A declaração é cobrada dos dois lados: quem se declara fora
 * não pode chamar `leitorCego`, senão a marca está mentindo sobre a própria seção.
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

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const ARQUIVO = 'src/js/admin/diag-tab.js';
const FONTE = readFileSync(path.join(RAIZ, ARQUIVO), 'utf8');

/** A marca de saída, escrita no JSDoc da seção que não lê arquivo de log. */
const MARCA_SEM_LOG = '@nao-le-log';

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

describe('as seções da aba Diagnóstico que leem arquivo de log', () => {
    const secoes = secoesDaAba();

    it('a varredura acha as seções, senão ela passaria verde sem verificar nada', () => {
        // A COBERTURA VAZIA É O MODO DE FALHA DESTE ARQUIVO: uma expressão que deixe de casar
        // (uma indentação diferente, um `#pintar` privado, a classe virando função) esvazia a
        // lista e todo o resto abaixo passa sobre zero itens. Daí o piso e o corpo mínimo.
        expect(secoes.length).toBeGreaterThanOrEqual(4);
        expect(secoes.map((s) => s.nome)).toContain('_pintarPulso');
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
            if (!secao.corpo.includes('leitorCego(')) {
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
        expect(comOrdem.length).toBeGreaterThanOrEqual(3);
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
        // E a saída não é gratuita: hoje existe exatamente UMA seção declarada fora (a que lê o
        // banco). Zero significaria que a marca deixou de ser lida e a varredura virou vácuo.
        expect(secoes.filter((s) => s.bloco.includes(MARCA_SEM_LOG)).length).toBe(1);
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
