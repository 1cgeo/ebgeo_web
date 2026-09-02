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
 * A SAÍDA DECLARADA. Nem toda seção da aba lê arquivo de log: "Defeitos" vem do BANCO, e nela
 * `diretorioAusente` e `truncado` não existem. Ela escapa da varredura escrevendo `@nao-le-log`
 * no próprio JSDoc, com o motivo ao lado, que é o padrão de censo da casa (a seção nova reprova
 * até ser CLASSIFICADA). A declaração é cobrada dos dois lados: quem se declara fora não pode
 * chamar `leitorCego`, senão a marca está mentindo sobre a própria seção.
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
// Normalized to LF: a checkout on Windows materializes the file with CRLF, and the
// method-closing probe below ('\n    }\n') would then find nothing, turning every
// section into an empty body and the whole census red on a clean tree.
const FONTE = readFileSync(path.join(RAIZ, ARQUIVO), 'utf8').replace(/\r\n/g, '\n');

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

describe('as seções da aba Diagnóstico que leem arquivo de log', () => {
    const secoes = secoesDaAba();

    it('a varredura acha as seções, senão ela passaria verde sem verificar nada', () => {
        // A COBERTURA VAZIA É O MODO DE FALHA DESTE ARQUIVO: uma expressão que deixe de casar
        // (uma indentação diferente, um `#pintar` privado, a classe virando função) esvazia a
        // lista e todo o resto abaixo passa sobre zero itens. Daí o piso e o corpo mínimo.
        expect(secoes.length).toBeGreaterThanOrEqual(3);
        expect(secoes.map((s) => s.nome)).toContain('_pintarPulso');
        expect(secoes.map((s) => s.nome)).toContain('_pintarDefeitos');
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
