// Path: tests/unit/teto-de-analise-do-splat.test.js
//
// O DEFEITO: um Worker que nao carrega deixava o motor de primeira pessoa PENDURADO PARA SEMPRE,
// calado, e a tela congelada em "Carregando o modelo 3D... 19,1 MB de 19,1 MB".
//
// A CAUSA, CONFIRMADA POR LEITURA do pacote de terceiro pinado
// (`node_modules/@manycore/aholo-viewer/dist/index.js`, 2026-09-22):
//
//   - `parseSplatData` (~linha 61947) monta um `deferred`, pega um worker do pool e liga
//     `worker.onmessage` e SO ELE. Nao ha `onerror` nem `addEventListener('error')` em lugar
//     nenhum daquele caminho, entao a promessa so se decide por MENSAGEM, ou nunca.
//   - A fabrica do worker (~linha 61938) cria um blob de modulo cujo corpo inteiro e
//     `import "<base>/splat-worker.js";`, e MEMOIZA a URL do blob em escopo de modulo
//     (`SplatWorkerBlobUrl`). Um `base` que responde 404 continua errado pelo resto da vida da
//     pagina: todo worker seguinte importa o mesmo endereco morto. Ou seja, a pagina fica
//     ENVENENADA, e "tente de novo" seria falso. Dai a frase mandar recarregar.
//   - `new Worker(urlQue404)` nao lanca: ele dispara um evento `error` que aquele motor nao escuta.
//
// MEDIDO NO NAVEGADOR (ontem, 2026-09-21): worker alcancavel, `parse` em 439 ms; worker recusado,
// mais de 280 s sem uma linha de erro. Daqui sai o teto de 30 s, cerca de setenta vezes a medida.
//
// O QUE CADA BLOCO PROVA, E O QUE ELE NAO PROVA:
//
//  1. O TETO, na folha pura, com relogio falso. Prova que um motor mudo REJEITA no teto, que um
//     motor que responde antes resolve SEM o teto disparar, que um motor que rejeita entrega o erro
//     ORIGINAL e que a promessa abandonada nao vira rejeicao nao tratada. NAO prova que o motor de
//     verdade pendura: isso esta lido acima, no bundle.
//  2. A FRASE. Prova que a frase do teto CONTEM, palavra por palavra, a frase que o painel escreve,
//     que ela nomeia o numero de segundos e que ela manda recarregar. NAO prova redacao.
//  3. OS SITIOS, por texto de fonte, porque `first_person_viewer.js` importa
//     `@manycore/aholo-viewer` na primeira linha e nao carrega em node (mesma razao do bloco 5 de
//     `aviso-de-cena-3d-que-nao-carrega.test.js`). Prova que a chamada esta envolvida pelo teto,
//     que o `catch` escolhe a frase pelo CAMPO e nao pela prosa, e que a cadeia que tira a tela do
//     estado de carregando continua ligada.
//
// CONTROLE NEGATIVO (por copia de arquivo, nunca por git): apagar o teto de
// `splat-parse-timeout.js`, deixando `comTetoDeAnalise` devolver a promessa como veio, deixa
// VERMELHOS os dois `it` do bloco 1 que medem o motor mudo, em menos de um segundo e sem pendurar
// a suite: o sentinela de tempo do bloco 1 existe justamente para isso.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    comTetoDeAnalise,
    isSplatParseTimeout,
    SPLAT_PARSE_TIMEOUT,
    TEMPO_LIMITE_DE_ANALISE_MS,
} from '../../src/js/first_person_3d_tool/splat-parse-timeout.js';
import {
    scene3dLoadFailureMessage,
    scene3dEngineTimeoutMessage,
} from '../../src/js/first_person_3d_tool/scene3d-failure.js';

/** O `parse` do motor com o worker recusado: uma promessa que nunca se decide. */
function motorMudo() {
    return new Promise(() => {});
}

/** Um sentinela de tempo, para que "pendurado" vire um RESULTADO em vez de virar um timeout da suite. */
function sentinela(ms, valor) {
    return new Promise((resolve) => { setTimeout(() => resolve(valor), ms); });
}

/**
 * Corre o teto contra o sentinela e devolve o que se decidiu primeiro.
 *
 * Sem ele, o controle negativo (teto removido) nao daria vermelho: daria uma suite pendurada ate
 * o limite global de 20 s, que e vermelho tambem, mas lento e sem nomear nada.
 */
async function corridaCom(promessaDoMotor, { ms, ate }) {
    const corrida = Promise.race([
        comTetoDeAnalise(promessaDoMotor, { ms }).then(
            (valor) => ({ desfecho: 'resolveu', valor }),
            (erro) => ({ desfecho: 'rejeitou', erro })
        ),
        sentinela(ate, { desfecho: 'PENDURADA' }),
    ]);
    await vi.advanceTimersByTimeAsync(ate);
    return corrida;
}

// ---------------------------------------------------------------------------
// 1. O teto
// ---------------------------------------------------------------------------

describe('o teto de analise do splat', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('(a) motor que nunca responde: rejeita NO TETO, e nao fica pendurado', async () => {
        const fim = await corridaCom(motorMudo(), { ms: 50, ate: 500 });

        expect(fim.desfecho, 'a promessa ficou pendurada: o teto nao disparou').toBe('rejeitou');
        expect(fim.erro).toBeInstanceOf(Error);
        expect(isSplatParseTimeout(fim.erro)).toBe(true);
        expect(fim.erro.code).toBe(SPLAT_PARSE_TIMEOUT);
        expect(fim.erro.timeoutMs).toBe(50);
        expect(fim.erro.message).toContain('50 ms');
    });

    it('(a2) o teto dispara NO PRAZO, nem antes nem so no dobro dele', async () => {
        const pendente = comTetoDeAnalise(motorMudo(), { ms: 1000 }).then(
            () => 'resolveu', (erro) => erro
        );
        let estado = 'esperando';
        pendente.then((valor) => { estado = valor; });

        await vi.advanceTimersByTimeAsync(999);
        expect(estado, 'o teto disparou ANTES do prazo').toBe('esperando');

        // Corrida com sentinela pela mesma razao de `corridaCom`: sem ela, o controle negativo
        // penduraria este caso ate o limite global em vez de nomea-lo.
        const corrida = Promise.race([pendente, sentinela(2000, 'PENDURADA')]);
        await vi.advanceTimersByTimeAsync(2000);
        expect(isSplatParseTimeout(await corrida)).toBe(true);
    });

    it('(b) motor que responde em 100 ms: resolve com o valor, sem o teto', async () => {
        const dados = { splat: 'ok' };
        const fim = await corridaCom(sentinela(100, dados), { ms: 30000, ate: 300 });

        expect(fim.desfecho).toBe('resolveu');
        expect(fim.valor).toBe(dados);
        // O temporizador foi CANCELADO: um teto que sobrevive ao sucesso segura o processo e, em
        // teste, faz o `vi.useRealTimers()` do proximo caso herdar lixo.
        expect(vi.getTimerCount()).toBe(0);
    });

    it('(c) motor que rejeita: rejeita com o erro ORIGINAL, nunca com o do teto', async () => {
        const original = new Error('RawSplatData is not supported create splat');
        original.status = 415;
        const fim = await corridaCom(Promise.reject(original), { ms: 50, ate: 500 });

        expect(fim.desfecho).toBe('rejeitou');
        expect(fim.erro).toBe(original);
        expect(isSplatParseTimeout(fim.erro)).toBe(false);
        // O campo que o painel le continua chegando: o teto nao pode apagar um status MEDIDO.
        expect(fim.erro.status).toBe(415);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('(d) rejeicao ATRASADA, depois do teto, nao vira rejeicao nao tratada', async () => {
        const naoTratadas = [];
        const escuta = (erro) => naoTratadas.push(erro);
        process.on('unhandledRejection', escuta);
        try {
            const atrasada = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('o worker respondeu tarde')), 200);
            });
            const fim = await corridaCom(atrasada, { ms: 50, ate: 500 });
            expect(isSplatParseTimeout(fim.erro)).toBe(true);

            // Deixa o laco de eventos girar de verdade: e nele que uma rejeicao orfa apareceria.
            vi.useRealTimers();
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(naoTratadas).toEqual([]);
        } finally {
            process.off('unhandledRejection', escuta);
        }
    });

    it('(e) o teto padrao e 30 s, cerca de setenta vezes os 439 ms medidos', () => {
        expect(TEMPO_LIMITE_DE_ANALISE_MS).toBe(30000);
        expect(TEMPO_LIMITE_DE_ANALISE_MS / 439).toBeGreaterThan(60);
    });

    it('(f) bordas: nao-promessa resolve como esta, e `ms` invalido cai no padrao', async () => {
        const fim = await corridaCom('ja pronto', { ms: 50, ate: 100 });
        expect(fim).toEqual({ desfecho: 'resolveu', valor: 'ja pronto' });

        for (const ruim of [0, -1, NaN, Infinity, null, undefined, '30']) {
            const caiuNoPadrao = await corridaCom(motorMudo(), {
                ms: ruim, ate: TEMPO_LIMITE_DE_ANALISE_MS + 1000,
            });
            expect(caiuNoPadrao.desfecho, `ms=${String(ruim)}`).toBe('rejeitou');
            expect(caiuNoPadrao.erro.timeoutMs, `ms=${String(ruim)}`).toBe(TEMPO_LIMITE_DE_ANALISE_MS);
        }
    });

    it('(g) `isSplatParseTimeout` nao explode com entrada que nao e erro', () => {
        for (const valor of [null, undefined, 0, '', 'splat-parse-timeout', {}, new Error('x')]) {
            expect(isSplatParseTimeout(valor)).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// 2. A frase
// ---------------------------------------------------------------------------

describe('a frase do teto', () => {
    it('CONTEM a frase do painel, palavra por palavra: as duas nao podem divergir', () => {
        const painel = scene3dLoadFailureMessage('Forte de Copacabana');
        expect(painel).toBe('A cena 3D "Forte de Copacabana" não pôde ser carregada.');
        expect(scene3dEngineTimeoutMessage('Forte de Copacabana', 30000)).toContain(painel);
    });

    it('nomeia o motor, o prazo em segundos e a unica saida que existe', () => {
        const frase = scene3dEngineTimeoutMessage('Forte de Copacabana', 30000);
        expect(frase).toBe(
            'A cena 3D "Forte de Copacabana" não pôde ser carregada. '
            + 'O motor de cenas 3D não respondeu em 30 segundos. '
            + 'Recarregue a página para tentar de novo.'
        );
    });

    it('sem prazo confiavel, diz "no tempo limite" em vez de imprimir NaN na tela', () => {
        for (const ruim of [undefined, null, NaN, 0, -5, 'trinta']) {
            const frase = scene3dEngineTimeoutMessage('Cena', ruim);
            expect(frase, `tempo=${String(ruim)}`).toContain('não respondeu no tempo limite.');
            expect(frase).not.toMatch(/NaN|undefined|null/);
        }
    });

    it('herda a concordancia FEMININA de "cena 3D", e a cena sem nome continua nomeada', () => {
        expect(scene3dEngineTimeoutMessage(null, 30000))
            .toContain('A cena 3D "Cena 3D sem nome" não pôde ser carregada.');
        expect(scene3dEngineTimeoutMessage('Cena', 30000)).toContain('carregada');
        expect(scene3dEngineTimeoutMessage('Cena', 30000)).not.toContain('carregado');
    });

    it('arredonda o prazo para segundos inteiros', () => {
        expect(scene3dEngineTimeoutMessage('Cena', 1499)).toContain('em 1 segundos');
        expect(scene3dEngineTimeoutMessage('Cena', 45000)).toContain('em 45 segundos');
    });
});

// ---------------------------------------------------------------------------
// 3. Os sitios
// ---------------------------------------------------------------------------

describe('os sitios, no visualizador que nao carrega em node', () => {
    const fonte = (rel) => readFileSync(
        fileURLToPath(new URL(`../../src/js/${rel}`, import.meta.url)), 'utf8'
    );

    it('a chamada do motor esta ENVOLVIDA pelo teto, e nao apenas acompanhada dele', () => {
        const viewer = fonte('first_person_3d_tool/first_person_viewer.js');
        expect(viewer).toMatch(
            /await comTetoDeAnalise\(SplatLoader\.parseSplatData\(/
        );
        // O que existia antes, e que e o defeito: a chamada crua, sem teto nenhum.
        expect(viewer).not.toMatch(/await SplatLoader\.parseSplatData\(/);
    });

    it('o `catch` escolhe a frase pelo CAMPO do erro, nunca lendo a prosa da mensagem', () => {
        const viewer = fonte('first_person_3d_tool/first_person_viewer.js');
        expect(viewer).toContain('if (isSplatParseTimeout(error)) {');
        expect(viewer).toContain('showError(scene3dEngineTimeoutMessage(');
        // O outro ramo segue intacto: o teto nao e o unico jeito de uma cena nao abrir.
        expect(viewer).toContain('showError(scene3dLoadFailureMessage(scene.name));');
    });

    it('a tela sai do estado de carregando pela cadeia que o `catch` ja chamava', () => {
        const viewer = fonte('first_person_3d_tool/first_person_viewer.js');
        // O `catch` derruba a cena inteira...
        expect(viewer).toMatch(/cleanupFirstPersonFeatures\(\);/);
        // ...e e o fim daquela funcao que esconde a sobreposicao de carga.
        expect(viewer).toMatch(/function cleanupFirstPersonFeatures\(\)[\s\S]*?setFirstPersonUiVisible\(false\);\r?\n\}/);
        expect(viewer).toMatch(/if \(!visible\) \{[\s\S]*?hideLoadingFp\(\);/);
    });

    it('a segunda abertura nao fica presa atras da primeira: o slot e limpo em `finally`', () => {
        const viewer = fonte('first_person_3d_tool/first_person_viewer.js');
        expect(viewer).toMatch(/\} finally \{\r?\n\s*fpState\.openPromise = null;\r?\n\s*\}/);
    });

    it('o ajudante do teto tem ZERO imports, que e o que o mantem carregavel em node', () => {
        const folha = fonte('first_person_3d_tool/splat-parse-timeout.js');
        expect(folha.match(/from '/g)).toBeNull();
        expect(folha).not.toMatch(/^import /m);
    });
});
