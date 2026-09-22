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
    mapIdsCitados,
    PendenciaEstado,
} from '@js/account/pendencias/pendencias-rows.js';
import {
    ESTADO_VAZIO_DETALHE,
    ESTADO_VAZIO_LOCAL_DETALHE,
    ESTADO_VAZIO_TITULO,
    PendenciaClasse,
    PendenciaOrigem,
    MOTIVO_DESCONHECIDO,
    classeLabel,
    classeExplicacao,
    contadoresVisiveis,
    dataLabel,
    estadoVazio,
    localDoItem,
    tipoDeEntidadeLabel,
    tituloDoPainel,
    transitoNota,
    transitoTitulo,
    unidadeLabel,
} from '@js/account/pendencias/pendencias-phrases.js';
// A luz de sync entra no MESMO processo porque o contrato é ENTRE as duas telas: comparar o número
// que cada uma diz exige as duas decisões rodando lado a lado, nunca uma cópia de uma delas.
import {
    describeSyncWork,
    SYNC_CONNECTION,
    SYNC_WORK_STATE,
} from '@js/account/sync-phrases.js';
import { IssueClass } from '@store/sync/issue-classes.js';
import { EntityType } from '@store/sync/operation-types.js';

const ARQ_PAINEL = fileURLToPath(
    new URL('../../src/js/account/pendencias/pendencias-panel.js', import.meta.url),
);
const ARQ_FRASES = fileURLToPath(
    new URL('../../src/js/account/pendencias/pendencias-phrases.js', import.meta.url),
);
const ARQ_CSS = fileURLToPath(new URL('../../src/css/pendencias.css', import.meta.url));
const ARQ_LEITURA = fileURLToPath(
    new URL('../../src/js/account/pendencias/pendencias-leitura.js', import.meta.url),
);

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
        expect(linha.mapa).toEqual({ id: 'mapa-1', nome: 'Principal', ausente: false });
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
        // Rótulo na língua de quem usa: "quarentena de protocolo" era vocabulário interno.
        expect(antiga.classeLabel).toBe('De versão anterior');
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
    it('cai no id quando o nome do item não resolve e o do mapa é DESCONHECIDO', () => {
        // `undefined` é "não deu para saber", e é o único desfecho em que o id vai para a tela.
        const modelo = montarPendencias({
            problemas: [{
                operation: op({ data: null }),
                result: {},
                recordedAt: 1,
                classe: IssueClass.RECUSA,
            }],
            nomeDoMapa: () => undefined,
        });
        expect(modelo.linhas[0].entidade.nome).toBeNull();
        expect(modelo.linhas[0].entidade.id).toBe('camada-1');
        expect(modelo.linhas[0].mapa).toEqual({ id: 'mapa-1', nome: null, ausente: false });
        expect(localDoItem(modelo.linhas[0].mapa)).toBe(', no mapa «mapa-1»');
    });

    it('DECLARA o mapa removido quando a leitura respondeu que ele não está mais no atlas', () => {
        // CAUSA-RAIZ que este caso prende, medida em 2026-09-15: a linha lia o nome do resolvedor
        // em memória, que fica VAZIO logo depois de um F5 num atlas de servidor, e a tela mostrava
        // «6a54a5f6-8ffb-4e9d-887a-b8686764fb9d» no lugar de «Mapa Tático». Lido o disco, sobram
        // dois vazios com significados opostos, e eles não podem virar a mesma frase.
        const modelo = montarPendencias({
            problemas: [{ operation: op(), result: {}, recordedAt: 1, classe: IssueClass.RECUSA }],
            nomeDoMapa: () => null,
        });
        expect(modelo.linhas[0].mapa).toEqual({ id: 'mapa-1', nome: null, ausente: true });
        expect(localDoItem(modelo.linhas[0].mapa)).toBe(', num mapa removido');
    });

    it('sem resolvedor nenhum, NADA é afirmado sobre o mapa: o padrão é desconhecido', () => {
        // O padrão não pode ser `null`: ele diria a toda linha de todo chamador que não injeta
        // resolvedor que o mapa dela foi removido, que é uma afirmação que ninguém mediu.
        const modelo = montarPendencias({
            problemas: [{ operation: op(), result: {}, recordedAt: 1, classe: IssueClass.RECUSA }],
        });
        expect(modelo.linhas[0].mapa).toEqual({ id: 'mapa-1', nome: null, ausente: false });
    });

    it('nome de mapa em branco não vira nome: ele conta como desconhecido', () => {
        const modelo = montarPendencias({
            problemas: [{ operation: op(), result: {}, recordedAt: 1, classe: IssueClass.RECUSA }],
            nomeDoMapa: () => '   ',
        });
        expect(modelo.linhas[0].mapa).toEqual({ id: 'mapa-1', nome: null, ausente: false });
    });

    it('os mapas citados saem do MESMO campo que as linhas leem', () => {
        // Se as duas leituras divergirem, a tabela de nomes é montada para um conjunto de mapas e
        // consultada para outro, e o sintoma é o id de volta na tela.
        const citados = mapIdsCitados({
            problemas: [
                { operation: op() },
                { operation: op({ mapId: 'mapa-2' }) },
                { operation: op() },
                { operation: op({ mapId: null }) },
                { operation: null },
                null,
            ],
            quarentena: [{ operation: op({ mapId: 'mapa-3' }) }],
        });
        expect(citados).toEqual(['mapa-1', 'mapa-2', 'mapa-3']);
        expect(mapIdsCitados()).toEqual([]);
        expect(mapIdsCitados({ problemas: [{ operation: op({ mapId: '' }) }] })).toEqual([]);
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
        // Linha que não cita mapa não ganha trecho de lugar nenhum, nem a frase do removido.
        expect(localDoItem(modelo.linhas[0].mapa)).toBe('');
        expect(localDoItem(undefined)).toBe('');
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

// ============================================================================
// A COMPARAÇÃO ENTRE A CÓPIA LOCAL E A DO SERVIDOR (B5, item 1)
// ============================================================================

describe('a linha de conflito de FEIÇÃO carrega a comparação', () => {
    // A ARITMÉTICA ESTÁ EM `tests/unit/comparacao-de-conflito.test.js`. O que se mede aqui é a
    // FIAÇÃO: que o montador junta as duas metades certas (o `data` do envelope guardado e o
    // `serverData` do recibo de conflito) e que ele não inventa comparação onde não há par.
    const feicao = (geometry, properties) => ({ type: 'Feature', geometry, properties });
    const pontoEm = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });

    const conflitoDeFeicao = (serverData) => ({
        rejected: true,
        status: 'conflict',
        reason: 'Os mesmos campos foram alterados no servidor.',
        conflict: { fields: ['geometry'], entityVersion: 12, serverData },
    });

    const linhaDeFeicao = (data, serverData) => montarPendencias({
        problemas: [{
            operation: op({ entityType: 'feature', entityId: 'f-1', data }),
            result: conflitoDeFeicao(serverData),
            recordedAt: 1_700_000_100_000,
            classe: IssueClass.CONFLITO,
            bloqueadaPor: null,
        }],
    }).linhas[0];

    it('junta o `data` local com o `serverData` do recibo', () => {
        const linha = linhaDeFeicao(
            feicao(pontoEm(-43.2, -22.9), { nome: 'Posto A' }),
            feicao(pontoEm(-43.2, -22.899), { nome: 'Posto B', confirmedVersion: 12 }),
        );

        expect(linha.comparacaoIndisponivel).toBe(false);
        expect(linha.comparacao.geometria.igual).toBe(false);
        expect(linha.comparacao.geometria.deslocamentoM).toBeGreaterThan(110);
        expect(linha.comparacao.propriedades).toEqual(['nome']);
    });

    it('sem `serverData`, a ausência é DECLARADA em vez de virar silêncio', () => {
        // Um bloco que some se lê como "não há diferença", que é o contrário do que aconteceu.
        const linha = linhaDeFeicao(feicao(pontoEm(0, 0), { nome: 'A' }), null);
        expect(linha.comparacao).toBeNull();
        expect(linha.comparacaoIndisponivel).toBe(true);
    });

    it('não é feição: nenhuma comparação, e nenhuma ausência anunciada', () => {
        // Para as outras entidades o que difere já está dito na lista de unidades em disputa, que
        // é a linguagem do próprio servidor.
        const modelo = montarPendencias({
            problemas: [{
                operation: op(),
                result: conflito,
                recordedAt: 1_700_000_100_000,
                classe: IssueClass.CONFLITO,
                bloqueadaPor: null,
            }],
        });
        expect(modelo.linhas[0].comparacao).toBeNull();
        expect(modelo.linhas[0].comparacaoIndisponivel).toBe(false);
    });

    it('uma pendência de figura não tem par a comparar', () => {
        const modelo = montarPendencias({
            uploads: [{ imageId: 'img-1', estado: 'pendente', criadoEm: 1_700_000_000_000 }],
        });
        expect(modelo.linhas[0].comparacao).toBeNull();
        expect(modelo.linhas[0].comparacaoIndisponivel).toBe(false);
    });

    it('ESTRUTURAL: o painel desenha o bloco, e as frases dele são folha de zero imports', () => {
        const painel = readFileSync(ARQ_PAINEL, 'utf8');
        expect(painel).toContain('pendencias__comparacao');
        expect(painel).toContain('data-testid');

        const frases = fileURLToPath(
            new URL('../../src/js/account/pendencias/comparacao-phrases.js', import.meta.url),
        );
        const modelo = fileURLToPath(
            new URL('../../src/js/account/pendencias/comparacao-de-conflito.js', import.meta.url),
        );
        for (const arquivo of [frases, modelo]) {
            expect(readFileSync(arquivo, 'utf8')).not.toMatch(/^import\s/m);
        }

        // E o CSS das classes novas existe: uma classe BEM sem regra é um bloco invisível que
        // passa verde em toda asserção de DOM.
        const css = readFileSync(ARQ_CSS, 'utf8');
        for (const classe of [
            '.pendencias__comparacao',
            '.pendencias__comparacao-rotulo',
            '.pendencias__comparacao-linha',
            '.pendencias__comparacao-linha--ausente',
        ]) {
            expect(css, `${classe} precisa de regra`).toContain(`${classe} {`);
        }
    });
});

// ============================================================================
// O CONTRATO ENTRE O CRACHÁ E O PAINEL (achado de 2026-09-15)
// ============================================================================

/**
 * O DEFEITO MEDIDO: com duas alterações na fila e nenhum problema, o crachá escrevia
 * "Enviando 2…" e o painel que ele abre escrevia "Nenhuma pendência". Duas superfícies lendo a
 * MESMA fila e se contradizendo, nos dois navegadores.
 *
 * O CONTRATO ADOTADO: o crachá conta o TRABALHO, o painel lista o que EXIGE DECISÃO, e o segundo é
 * um subconjunto do primeiro. Números diferentes são legítimos; frases que se contradizem, não. O
 * que está a caminho não vira linha (não há ação a oferecer sobre uma alteração que sai sozinha) e
 * é DITO, com o mesmo número e pela mesma expressão que alimenta o crachá.
 *
 * O QUE ESTE VERDE NÃO PROVA: que o leitor de disco somou os baldes certos. Isso é estrutural e
 * está no último bloco; o resto é a captura do Playwright.
 */
describe('o crachá e o painel não podem se contradizer sobre a mesma fila', () => {
    it('com trabalho na fila e nada a decidir, o painel NÃO diz "Nenhuma pendência"', () => {
        const modelo = montarPendencias({ aCaminho: 2 });
        expect(modelo.estado).toBe(PendenciaEstado.VAZIO);
        expect(modelo.aCaminho).toBe(2);

        const vazio = estadoVazio(modelo.aCaminho);
        expect(vazio.titulo).toBe('2 alterações a caminho');
        expect(vazio.titulo).not.toBe(ESTADO_VAZIO_TITULO);
        expect(vazio.detalhe).toMatch(/não exige decisão|Nada aqui exige decisão/);
        // E ela não repete a afirmação que era falsa: o servidor NÃO tem tudo.
        expect(vazio.detalhe).not.toContain('já foi aceito pelo servidor');
    });

    it('o número que o painel diz é o MESMO que o crachá mostra, pela mesma expressão', () => {
        // Um censo só, lido pelas duas telas: é isto que impede as duas aritméticas de divergirem.
        const censo = { pendentes: 2, preparadas: 1, problemas: 0 };
        const aCaminho = censo.pendentes + censo.preparadas;

        const cracha = describeSyncWork({
            remote: true,
            connection: SYNC_CONNECTION.ONLINE,
            pending: aCaminho,
            problemas: censo.problemas,
            quarentena: 0,
            uploads: 0,
        });
        const modelo = montarPendencias({ aCaminho });

        expect(cracha.state).toBe(SYNC_WORK_STATE.SENDING);
        expect(cracha.label).toBe('Enviando 3…');
        expect(modelo.aCaminho).toBe(cracha.pending);
        expect(estadoVazio(modelo.aCaminho).titulo).toContain('3');
    });

    it('CONTROLE NEGATIVO: o painel cego à fila reproduz a contradição', () => {
        // É o estado anterior à correção, escrito à mão: a leitura não passava `aCaminho`, então o
        // painel caía no ramo do zero e afirmava que o servidor tinha tudo, com a fila cheia.
        const cego = montarPendencias({});
        expect(cego.aCaminho).toBeNull();
        expect(estadoVazio(cego.aCaminho).titulo).toBe(ESTADO_VAZIO_TITULO);
        // A correção é exatamente o número chegar: com ele, a mesma função muda de frase.
        expect(estadoVazio(montarPendencias({ aCaminho: 2 }).aCaminho).titulo)
            .not.toBe(ESTADO_VAZIO_TITULO);
    });

    it('a fila medida em ZERO é o único caso que autoriza "tudo já foi aceito"', () => {
        const vazio = estadoVazio(montarPendencias({ aCaminho: 0 }).aCaminho);
        expect(vazio.titulo).toBe(ESTADO_VAZIO_TITULO);
        expect(vazio.detalhe).toBe(ESTADO_VAZIO_DETALHE);
    });

    it('o que NÃO é contagem nunca vira zero, e não afirma envio nenhum', () => {
        for (const valor of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -3, '2']) {
            expect(montarPendencias({ aCaminho: valor }).aCaminho).toBeNull();
            expect(estadoVazio(valor).detalhe).toBe(ESTADO_VAZIO_LOCAL_DETALHE);
            expect(estadoVazio(valor).detalhe).not.toBe(ESTADO_VAZIO_DETALHE);
        }
        // O atlas local é o caso REAL desse ramo, e a frase dele não fala de figura nem de recusa,
        // porque nenhuma das duas chega a ser lida ali.
        expect(ESTADO_VAZIO_LOCAL_DETALHE).not.toContain('figura');
    });

    it('a falha de leitura continua não afirmando nada, o número a caminho inclusive', () => {
        const modelo = montarPendencias({ falhaDeLeitura: true, aCaminho: 7 });
        expect(modelo.estado).toBe(PendenciaEstado.FALHA);
        expect(modelo.aCaminho).toBeNull();
    });

    it('as frases concordam no singular', () => {
        expect(transitoTitulo(1)).toBe('1 alteração a caminho');
        expect(transitoTitulo(2)).toBe('2 alterações a caminho');
        expect(estadoVazio(1).titulo).toBe('1 alteração a caminho');
        expect(transitoNota(1)).toContain('1 alteração a caminho, que sai sozinha');
        expect(transitoNota(4)).toContain('4 alterações a caminho, que saem sozinhas');
    });

    it('com lista, a nota diz o que está a caminho; sem nada a caminho, não diz nada', () => {
        expect(transitoNota(0)).toBeNull();
        expect(transitoNota(null)).toBeNull();
        expect(transitoNota(Number.NaN)).toBeNull();
        expect(transitoNota(-1)).toBeNull();
        expect(transitoNota(3)).toContain('3 alterações a caminho');
    });

    it('o que está a caminho NÃO entra na contagem do título nem nos contadores', () => {
        // Ele não exige decisão, então não é uma pendência a decidir: contá-lo no título faria o
        // painel prometer três decisões e mostrar uma.
        const modelo = montarPendencias({
            aCaminho: 5,
            problemas: [{
                operation: op(),
                result: conflito,
                recordedAt: 1_700_000_100_000,
                classe: IssueClass.CONFLITO,
                bloqueadaPor: null,
            }],
        });
        expect(modelo.total).toBe(1);
        expect(tituloDoPainel(modelo.total)).toBe('Pendências (1)');
        expect(contadoresVisiveis(modelo.contadores).map((c) => c.classe))
            .toEqual([PendenciaClasse.CONFLITO]);
        expect(modelo.aCaminho).toBe(5);
    });

    it('ESTRUTURAL: o leitor soma os MESMOS baldes do crachá, e o painel desenha a nota', () => {
        const leitura = readFileSync(ARQ_LEITURA, 'utf8');
        // A FUNÇÃO COMPARTILHADA, e não uma segunda aritmética aqui: quem prende isso de verdade é
        // `pendencias-leitor-unico.test.js`, que exige a definição num lugar só nos dois leitores.
        expect(leitura).toContain('countByState()');
        expect(leitura).toContain('aCaminhoDoCenso(censo)');

        const painel = readFileSync(ARQ_PAINEL, 'utf8');
        expect(painel).toContain('estadoVazio(modelo.aCaminho)');
        expect(painel).toContain('transitoNota(modelo.aCaminho)');
        // A classe BEM da nota precisa de regra, senão é um bloco invisível que passa verde.
        expect(readFileSync(ARQ_CSS, 'utf8')).toContain('.pendencias__transito {');
    });
});
