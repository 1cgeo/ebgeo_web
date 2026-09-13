// Path: tests/unit/pendencias-linhas.test.js
//
// O MONTADOR DE LINHAS do painel de pendências, que é a parte decidível em node: quais linhas a
// tela mostra, com que classe, que nome e que motivo, a partir do que as três fontes devolveram.
//
// O QUE ESTE VERDE PROVA, E O QUE ELE NÃO PROVA. Ele prova a tradução e as três saídas de estado
// (lista, vazio, falha). Ele NÃO prova que a fila leu certo, nem que a tela desenhou o que o
// modelo diz: a primeira metade é das suítes da fila, a segunda é da captura do Playwright.
//
// Os dois espelhos no fim são o que impede a tela de emudecer sozinha: uma classe nova em
// `IssueClass` e um tipo novo em `EntityType` reprovam aqui até serem classificados, em vez de
// aparecerem na tela como linha sem etiqueta ou como nome técnico.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    montarPendencias,
    classeDeProblema,
    PendenciaEstado,
} from '@js/account/pendencias/pendencias-rows.js';
import {
    PendenciaClasse,
    PendenciaOrigem,
    MOTIVO_DESCONHECIDO,
    classeLabel,
    classeExplicacao,
    contadoresVisiveis,
    dataLabel,
    tipoDeEntidadeLabel,
    tituloDoPainel,
    unidadeLabel,
} from '@js/account/pendencias/pendencias-phrases.js';
import { IssueClass } from '@store/sync/issue-classes.js';
import { EntityType } from '@store/sync/operation-types.js';

const ARQ_PAINEL = fileURLToPath(
    new URL('../../src/js/account/pendencias/pendencias-panel.js', import.meta.url),
);
const ARQ_FRASES = fileURLToPath(
    new URL('../../src/js/account/pendencias/pendencias-phrases.js', import.meta.url),
);
const ARQ_CSS = fileURLToPath(new URL('../../src/css/pendencias.css', import.meta.url));

const op = (extra = {}) => ({
    id: 'op-1',
    entityType: 'layer',
    entityId: 'camada-1',
    operationType: 'update',
    mapId: 'mapa-1',
    timestamp: 1_700_000_000_000,
    data: { name: 'Talhão 3' },
    ...extra,
});

const conflito = {
    rejected: true,
    status: 'conflict',
    reason: 'Os mesmos campos foram alterados no servidor.',
    conflict: { fields: ['nome', 'estilo'], entityVersion: 8, serverData: null },
};

describe('montarPendencias: as três fontes viram uma lista', () => {
    it('traduz um conflito da fila com nome de item, nome de mapa e unidades em disputa', () => {
        const modelo = montarPendencias({
            problemas: [{
                operation: op(),
                result: conflito,
                recordedAt: 1_700_000_100_000,
                classe: IssueClass.CONFLITO,
                bloqueadaPor: null,
            }],
            nomeDoMapa: (id) => (id === 'mapa-1' ? 'Principal' : null),
        });

        expect(modelo.estado).toBe(PendenciaEstado.LISTA);
        expect(modelo.total).toBe(1);
        const [linha] = modelo.linhas;
        expect(linha.classe).toBe(PendenciaClasse.CONFLITO);
        expect(linha.classeLabel).toBe('Conflito');
        expect(linha.origem).toBe(PendenciaOrigem.FILA);
        expect(linha.entidade).toMatchObject({ tipo: 'layer', tipoLabel: 'Camada', nome: 'Talhão 3' });
        expect(linha.mapa).toEqual({ id: 'mapa-1', nome: 'Principal' });
        expect(linha.motivo).toBe('Os mesmos campos foram alterados no servidor.');
        expect(linha.unidades).toEqual([
            { unidade: 'nome', label: 'Nome' },
            { unidade: 'estilo', label: 'Estilo' },
        ]);
        expect(linha.quandoLabel).toBe(dataLabel(1_700_000_100_000));
        expect(modelo.contadores).toEqual({ [PendenciaClasse.CONFLITO]: 1 });
    });

    it('nomeia quem bloqueia a dependência e não lhe atribui motivo nenhum', () => {
        const modelo = montarPendencias({
            problemas: [
                {
                    operation: op({ id: 'culpada' }),
                    result: { rejected: true, reason: 'Apenas o dono pode excluir um mapa' },
                    recordedAt: 20,
                    classe: IssueClass.RECUSA,
                    bloqueadaPor: null,
                },
                {
                    operation: op({ id: 'atras' }),
                    result: null,
                    recordedAt: null,
                    classe: IssueClass.DEPENDENCIA,
                    bloqueadaPor: 'culpada',
                },
            ],
        });

        const atras = modelo.linhas.find((linha) => linha.operationId === 'atras');
        expect(atras.classe).toBe(PendenciaClasse.DEPENDENCIA);
        expect(atras.bloqueadaPor).toBe('culpada');
        expect(atras.motivo).toBeNull();
        expect(atras.unidades).toEqual([]);
        // A recusa continua sendo recusa, e as duas contam separado.
        expect(modelo.contadores).toEqual({
            [PendenciaClasse.RECUSA]: 1,
            [PendenciaClasse.DEPENDENCIA]: 1,
        });
    });

    it('a quarentena preserva a CLASSE original e declara a origem', () => {
        const modelo = montarPendencias({
            quarentena: [
                {
                    atlasId: 'atlas-a',
                    savedAt: 900,
                    recordedAt: 800,
                    operation: op({ id: 'preservada', entityType: 'map', data: { name: 'Setor 2' } }),
                    issue: conflito,
                },
                {
                    atlasId: 'atlas-a',
                    savedAt: 900,
                    recordedAt: 700,
                    operation: op({ id: 'antiga', protocolVersion: 1 }),
                    issue: { rejected: true, status: 'review', reason: 'Versão incompatível.' },
                },
            ],
        });

        const [preservada, antiga] = modelo.linhas;
        expect(preservada.classe).toBe(PendenciaClasse.CONFLITO);
        expect(preservada.origem).toBe(PendenciaOrigem.QUARENTENA);
        expect(preservada.origemLabel).toBe('Guardada de uma sessão anterior');
        expect(preservada.atlasId).toBe('atlas-a');
        expect(antiga.classe).toBe(PendenciaClasse.REVISAO);
        expect(antiga.classeLabel).toBe('Quarentena de protocolo');
    });

    it('separa figura à espera de envio de figura recusada e ignora a confirmada', () => {
        const modelo = montarPendencias({
            uploads: [
                { tentativaId: 't1', imageId: 'img-1', estado: 'pendente', criadoEm: 10, atualizadoEm: 10 },
                {
                    tentativaId: 't2', imageId: 'img-2', estado: 'recusado', criadoEm: 20,
                    atualizadoEm: 30, ultimoErro: 'Os bytes desta imagem não estão mais neste computador.',
                },
                { tentativaId: 't3', imageId: 'img-3', estado: 'confirmado', criadoEm: 40, atualizadoEm: 40 },
            ],
        });

        expect(modelo.total).toBe(2);
        expect(modelo.linhas.map((linha) => linha.classe)).toEqual([
            PendenciaClasse.UPLOAD_RECUSADO,
            PendenciaClasse.UPLOAD_PENDENTE,
        ]);
        expect(modelo.linhas[0].entidade).toMatchObject({ tipo: 'imagem', tipoLabel: 'Figura', id: 'img-2' });
        expect(modelo.linhas[0].motivo).toBe('Os bytes desta imagem não estão mais neste computador.');
        expect(modelo.linhas[1].motivo).toBeNull();
    });

    it('ordena da mais recente para a mais antiga e joga a sem data para o fim', () => {
        const modelo = montarPendencias({
            problemas: [
                { operation: op({ id: 'velha', timestamp: 100 }), result: {}, recordedAt: 100, classe: IssueClass.RECUSA },
                { operation: op({ id: 'sem-data', timestamp: undefined }), result: {}, recordedAt: null, classe: IssueClass.RECUSA },
                { operation: op({ id: 'nova', timestamp: 300 }), result: {}, recordedAt: 300, classe: IssueClass.RECUSA },
            ],
        });
        expect(modelo.linhas.map((linha) => linha.operationId)).toEqual(['nova', 'velha', 'sem-data']);
        expect(modelo.linhas[2].quandoLabel).toBeNull();
    });
});

describe('montarPendencias: os três estados da lista', () => {
    it('a falha de leitura NUNCA se desenha como lista vazia', () => {
        const modelo = montarPendencias({ falhaDeLeitura: true });
        expect(modelo.estado).toBe(PendenciaEstado.FALHA);
        expect(modelo.estado).not.toBe(PendenciaEstado.VAZIO);
        expect(modelo.linhas).toEqual([]);
        expect(modelo.total).toBe(0);
    });

    it('a falha vence mesmo quando alguma fonte trouxe conteúdo', () => {
        // CONTROLE NEGATIVO DA REGRA: uma leitura parcial NÃO pode virar lista, senão a tela
        // afirma por omissão que a fonte muda está vazia.
        const modelo = montarPendencias({
            falhaDeLeitura: true,
            problemas: [{ operation: op(), result: conflito, recordedAt: 1, classe: IssueClass.CONFLITO }],
        });
        expect(modelo.estado).toBe(PendenciaEstado.FALHA);
        expect(modelo.linhas).toHaveLength(0);
    });

    it('nada guardado e leitura boa é o estado vazio honesto', () => {
        const modelo = montarPendencias({});
        expect(modelo.estado).toBe(PendenciaEstado.VAZIO);
        expect(modelo.contadores).toEqual({});
        expect(tituloDoPainel(modelo.total)).toBe('Pendências');
    });

    it('descarta entrada malformada em vez de desenhar linha sem item', () => {
        const modelo = montarPendencias({
            problemas: [null, {}, { operation: null }],
            quarentena: [null, { atlasId: 'a' }],
            uploads: [null],
        });
        expect(modelo.estado).toBe(PendenciaEstado.VAZIO);
    });
});

describe('montarPendencias: nomes, ids e unidades desconhecidas', () => {
    it('cai no id quando nome de mapa e nome de item não resolvem', () => {
        const modelo = montarPendencias({
            problemas: [{
                operation: op({ data: null }),
                result: {},
                recordedAt: 1,
                classe: IssueClass.RECUSA,
            }],
            nomeDoMapa: () => null,
        });
        expect(modelo.linhas[0].entidade.nome).toBeNull();
        expect(modelo.linhas[0].entidade.id).toBe('camada-1');
        expect(modelo.linhas[0].mapa).toEqual({ id: 'mapa-1', nome: null });
    });

    it('lê o nome da feição de properties.nome e ignora string vazia', () => {
        const feicao = montarPendencias({
            problemas: [{
                operation: op({ entityType: 'feature', data: { properties: { nome: 'Ponto A' } } }),
                result: {}, recordedAt: 1, classe: IssueClass.RECUSA,
            }],
        });
        expect(feicao.linhas[0].entidade.nome).toBe('Ponto A');

        const vazia = montarPendencias({
            problemas: [{
                operation: op({ data: { name: '   ' } }), result: {}, recordedAt: 1, classe: IssueClass.RECUSA,
            }],
        });
        expect(vazia.linhas[0].entidade.nome).toBeNull();
    });

    it('mostra a unidade que este build não conhece com o token cru', () => {
        const modelo = montarPendencias({
            problemas: [{
                operation: op(),
                result: { status: 'conflict', conflict: { fields: ['unidadeQueOServidorInventou'] } },
                recordedAt: 1,
                classe: IssueClass.CONFLITO,
            }],
        });
        expect(modelo.linhas[0].unidades).toEqual([
            { unidade: 'unidadeQueOServidorInventou', label: 'unidadeQueOServidorInventou' },
        ]);
    });

    it('declara que o servidor não deu motivo em vez de deixar o campo em branco', () => {
        const modelo = montarPendencias({
            problemas: [{ operation: op(), result: { rejected: true }, recordedAt: 1, classe: IssueClass.RECUSA }],
        });
        expect(modelo.linhas[0].motivo).toBe(MOTIVO_DESCONHECIDO);
    });

    it('não deixa mapa nulo virar objeto com id vazio', () => {
        const modelo = montarPendencias({
            problemas: [{ operation: op({ mapId: null }), result: {}, recordedAt: 1, classe: IssueClass.RECUSA }],
        });
        expect(modelo.linhas[0].mapa).toBeNull();
    });
});

describe('as frases', () => {
    it('conta só a classe que tem alguma linha', () => {
        const visiveis = contadoresVisiveis({
            [PendenciaClasse.CONFLITO]: 2,
            [PendenciaClasse.RECUSA]: 0,
        });
        expect(visiveis).toEqual([{ classe: PendenciaClasse.CONFLITO, label: 'Conflito', quantidade: 2 }]);
        expect(contadoresVisiveis({})).toEqual([]);
        expect(contadoresVisiveis(undefined)).toEqual([]);
    });

    it('o título carrega a contagem e concorda no singular', () => {
        expect(tituloDoPainel(0)).toBe('Pendências');
        expect(tituloDoPainel(1)).toBe('Pendências (1)');
        expect(tituloDoPainel(12)).toBe('Pendências (12)');
        expect(tituloDoPainel(Number.NaN)).toBe('Pendências');
    });

    it('a data recusa o que não é data em vez de imprimir lixo', () => {
        expect(dataLabel(0)).toBeNull();
        expect(dataLabel(null)).toBeNull();
        expect(dataLabel(Number.NaN)).toBeNull();
        expect(dataLabel(Number.POSITIVE_INFINITY)).toBeNull();
        expect(dataLabel(-5)).toBeNull();
        expect(dataLabel(Date.UTC(2026, 8, 13, 12, 0))).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    });

    it('toda classe desta tela tem rótulo e explicação', () => {
        for (const classe of Object.values(PendenciaClasse)) {
            expect(classeLabel(classe)).not.toBe(classe);
            expect(classeExplicacao(classe).length).toBeGreaterThan(20);
        }
    });
});

describe('os dois espelhos, que impedem a tela de emudecer sozinha', () => {
    it('toda classe de problema da FILA cai numa classe desta tela', () => {
        const conhecidas = new Set(Object.values(PendenciaClasse));
        for (const classe of Object.values(IssueClass)) {
            const traduzida = classeDeProblema(classe);
            expect(conhecidas.has(traduzida)).toBe(true);
        }
        // E as três que se distinguem continuam distintas: um mapeamento que colapsasse tudo em
        // RECUSA passaria na asserção acima.
        expect(classeDeProblema(IssueClass.CONFLITO)).toBe(PendenciaClasse.CONFLITO);
        expect(classeDeProblema(IssueClass.DEPENDENCIA)).toBe(PendenciaClasse.DEPENDENCIA);
        expect(classeDeProblema(IssueClass.REVISAO)).toBe(PendenciaClasse.REVISAO);
        expect(classeDeProblema(IssueClass.RECUSA)).toBe(PendenciaClasse.RECUSA);
        // Classe que este build não conhece cai no ramo conservador e APARECE.
        expect(classeDeProblema('classe-do-futuro')).toBe(PendenciaClasse.RECUSA);
    });

    it('todo tipo de entidade do sync tem nome de tela', () => {
        const semRotulo = Object.values(EntityType)
            .filter((tipo) => tipoDeEntidadeLabel(tipo) === tipo);
        expect(semRotulo).toEqual([]);
        // Tipo desconhecido não some: aparece com o nome técnico.
        expect(tipoDeEntidadeLabel('tipoNovo')).toBe('tipoNovo');
        expect(tipoDeEntidadeLabel(undefined)).toBe('Item');
        expect(unidadeLabel(undefined)).toBe('');
    });
});

describe('estrutura: o painel nunca escreve HTML cru', () => {
    // A linha carrega nome de mapa, nome de feição e a frase de recusa do SERVIDOR, e as três são
    // conteúdo que outra pessoa escreveu. `innerHTML` aqui é XSS com dado de colaboração, e o
    // caminho não passa por nenhuma revisão automática: a regra de lint da casa
    // (`no-unescaped-innerhtml`) só dispara sobre um léxico de campos, e `motivo` não está nele.
    // OS COMENTÁRIOS SAEM ANTES DA VARREDURA, e essa é a parte que a primeira versão errou: o
    // próprio `fileoverview` do painel PROMETE não usar `innerHTML`, então uma busca textual sobre
    // o arquivo inteiro acusava a promessa. Fragilidade aceita, declarada: a remoção é textual, e
    // uma ocorrência escrita como `el['innerHTML']` passaria.
    const semComentarios = (texto) => texto
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^([^\n'"`]*?)\/\/.*$/gm, '$1');
    const fonte = semComentarios(readFileSync(ARQ_PAINEL, 'utf8'));

    it('não usa innerHTML, outerHTML nem insertAdjacentHTML', () => {
        for (const proibido of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
            expect(fonte.includes(proibido)).toBe(false);
        }
        // CONTROLE NEGATIVO DA VARREDURA: com o comentário removido, o CÓDIGO ainda é lido.
        expect(semComentarios('/* innerHTML */\nno.textContent = x;')).not.toContain('innerHTML');
        expect(semComentarios('no.innerHTML = motivo; // fora da convenção')).toContain('innerHTML');
    });

    it('escreve texto por textContent e nós por createElement', () => {
        expect(fonte).toContain('textContent');
        expect(fonte).toContain('document.createElement');
        // CONTROLE NEGATIVO DA PRÓPRIA VARREDURA: ela precisa saber acusar. Uma fonte sintética
        // com a chamada proibida reprova pela mesma regra.
        const sintetica = 'no.innerHTML = linha.motivo;';
        expect(sintetica.includes('innerHTML')).toBe(true);
    });

    it('as frases continuam num folha de zero imports', () => {
        const frases = readFileSync(ARQ_FRASES, 'utf8');
        expect(/^\s*import\s/m.test(frases)).toBe(false);
    });
});

/**
 * O TOPO DO PAINEL E OS AVISOS DELE, que é o que a captura de B5d mostrou errado.
 *
 * A leitura da imagem achou dois balões laranja `position: fixed` no topo do painel, cobrindo a
 * fileira de contadores. São avisos do serviço da casa, que nasce em `top-center` acima de todo
 * modal, e o painel é alto o bastante para o topo dele encostar naquela faixa. Duas providências, e
 * as duas são estruturais, porque a aparência só se verifica lendo imagem:
 *
 *   - todo aviso que ESTE painel levanta nasce no rodapé, senão ele cobre a lista de que fala;
 *   - contador e comando deixam de dividir a mesma fileira, e a pílula do contador não quebra em
 *     duas linhas.
 *
 * O QUE ISTO NÃO ALCANÇA, declarado: o aviso de recusa que `sync-flush.js` levanta continua no
 * topo, porque aquele arquivo é de outro dono. É dele que vinham os dois balões da imagem.
 */
describe('estrutura: o topo do painel e o lugar dos avisos', () => {
    const fonte = readFileSync(ARQ_PAINEL, 'utf8');
    const css = readFileSync(ARQ_CSS, 'utf8');

    /**
     * Os argumentos de cada chamada de aviso, por contagem de parênteses.
     *
     * Contar parênteses e não casar até o `;` mais próximo: as chamadas são multilinha e uma delas
     * carrega um ternário com template literal dentro, onde o primeiro `;` não é o fim da chamada.
     * @param {string} texto - Fonte.
     * @returns {string[]} Um item por chamada.
     */
    function chamadasDeAviso(texto) {
        const achadas = [];
        const inicio = /show(?:Toast|Error|Success|Warning)\(/g;
        let m;
        while ((m = inicio.exec(texto)) !== null) {
            let profundidade = 1;
            let i = m.index + m[0].length;
            while (i < texto.length && profundidade > 0) {
                if (texto[i] === '(') profundidade += 1;
                else if (texto[i] === ')') profundidade -= 1;
                i += 1;
            }
            achadas.push(texto.slice(m.index, i));
        }
        return achadas;
    }

    it('todo aviso deste painel nasce fora do topo, que é onde o painel está', () => {
        const chamadas = chamadasDeAviso(fonte);
        // PISO: sem ele, um arquivo que deixasse de avisar qualquer coisa passaria por vacuidade.
        expect(chamadas.length).toBeGreaterThanOrEqual(8);
        const semLugar = chamadas.filter((c) => !c.includes('AVISO_DO_PAINEL'));
        expect(semLugar).toEqual([]);
        // E o lugar é o rodapé de fato, não uma constante com qualquer valor.
        expect(fonte).toMatch(/AVISO_DO_PAINEL\s*=\s*Object\.freeze\(\{\s*position:\s*'bottom-center'/);
    });

    it('CONTROLE NEGATIVO da varredura de avisos: ela acusa a chamada sem lugar', () => {
        const sintetica = "showError(ACEITE_FALHOU);\nshowSuccess(x, AVISO_DO_PAINEL);";
        const chamadas = chamadasDeAviso(sintetica);
        expect(chamadas).toHaveLength(2);
        expect(chamadas.filter((c) => !c.includes('AVISO_DO_PAINEL'))).toHaveLength(1);
    });

    it('contador e comando não dividem a mesma fileira', () => {
        expect(fonte).toContain("'pendencias__contadores'");
        expect(fonte).toContain("'pendencias__resumo-acoes'");
        // As duas classes que o JS escreve precisam existir no CSS, senão a separação é só DOM.
        expect(css).toContain('.pendencias__contadores');
        expect(css).toContain('.pendencias__resumo-acoes');
        // E o resumo é uma COLUNA: em linha, as duas voltariam a disputar a mesma largura.
        expect(css).toMatch(/\.pendencias__resumo\s*\{[^}]*flex-direction:\s*column/);
    });

    it('a pílula do contador cabe numa linha', () => {
        expect(css).toMatch(/\.pendencias__contador\s*\{[^}]*white-space:\s*nowrap/);
    });
});
