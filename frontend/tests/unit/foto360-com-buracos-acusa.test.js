// Path: tests/unit/foto360-com-buracos-acusa.test.js
/**
 * @fileoverview A FOTO 360 QUE DESENHA COM BURACOS DEIXA DE SER MUDA.
 *
 * O QUE ESTAVA ABERTO. O painel de superficie que nao carrega ja cobria a foto 360 quando ela
 * falha INTEIRA (metadado ou panoramica), pelas duas metades de `loadPhoto`. A terceira porta,
 * o tile isolado da piramide, era engolida dentro de `tile-loader.js`: um `log()` de depuracao e
 * segue o baile. Para o visitante de link publico com foto EMPRESTADA, um 403 por tile e o
 * cenario mais provavel do produto, e a tela dizia exatamente nada.
 *
 * O DESENHO, E POR QUE ELE E ASSIM. `tile-loader.js` e COPIA de `ebgeo_360`, com delta declarado
 * em `.claude/rules/common-tasks.md`. Entao o arquivo copiado ganhou o MENOR trecho possivel: uma
 * opcao `onTileErro` e duas chamadas, que entregam o FATO cru (chave e codigo). Toda a politica
 * mora fora, em `createTileHoleWatch` (`photo360-failure.js`), que e onde este arquivo bate.
 *
 * O QUE CADA BLOCO PROVA, E O QUE ELE NAO PROVA:
 *
 *  1. O LIMIAR. Prova que tres buracos ficam calados e o quarto acusa, que os codigos coletados
 *     ANTES do limiar chegam junto, que a mesma chave repetida nunca acusa sozinha, e que a
 *     contagem e POR FOTO. NAO prova que quatro seja o numero certo: quatro e decisao, com o
 *     racional escrito na constante, e o teste existe para que trocar o numero seja um ato
 *     deliberado e nao um acidente.
 *  2. O CARREGADOR REAL CHAMA. Dirige `createTileLoader` de verdade, com o three duplicado e a
 *     rede falsa, e prova que o 403 do tile e a queda de rede chegam ao `onTileErro` com chave e
 *     status (o segundo com `status: null`, porque nao houve resposta). NAO prova nada sobre o
 *     desenho: o canvas e duplo.
 *  3. AUSENTE, E INERTE. A pagina de calibracao monta o MESMO carregador sem a opcao, e la nao ha
 *     mapa nem painel. Prova que sem ela nada quebra e que o `log` da origem continua recebendo a
 *     mesma linha, que e a propriedade que mantem a copia parecida com o ebgeo_360.
 *  4. OS SITIOS E A DECLARACAO. Teste de FONTE, e vale so o que teste de fonte vale: prende a
 *     fiacao do visualizador (que nao carrega em node, porque quer WebGL) e prende a DECLARACAO
 *     do sexto trecho na regra. Sem a declaracao, a proxima conferencia com o `ebgeo_360` le o
 *     trecho como conserto perdido e o desfaz.
 *
 * CONTROLE NEGATIVO, conferido caso a caso e anotado no relatorio da tarefa: apagar a chamada de
 * `onTileErro` no ramo `!resposta.ok` derruba o bloco 2; apagar a do `catch` derruba o bloco 2;
 * apagar o `if (onTileErro)` derruba o bloco 3; trocar o `Map` por um contador de eventos em
 * `createTileHoleWatch` derruba o bloco 1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { montarEscada } from '@js/street_view_tool/pyramid-math.js';
import { createTileHoleWatch, TILE_HOLE_MIN } from '@js/street_view_tool/photo360-failure.js';

vi.mock('../../src/vendor/three/three.module.js', () => ({
    SRGBColorSpace: 'srgb',
    RepeatWrapping: 1000,
    ClampToEdgeWrapping: 1001,
    LinearFilter: 1006,
    CanvasTexture: class {
        constructor(imagem) {
            this.image = imagem;
            this.needsUpdate = false;
        }

        dispose() {
            this.descartada = true;
        }
    }
}));

/** Lado do tile na piramide do acervo. */
const TILE = 512;

/** Camera de monitor: pede o nivel nativo, entao o lote de tiles nao fica vazio. */
const MONITOR = { lon: 0, lat: 0, fov: 75, largura: 1904, altura: 985 };

// ---------------------------------------------------------------------------
// 1. O LIMIAR
// ---------------------------------------------------------------------------

/**
 * Um vigia com foto controlavel e as acusacoes coletadas.
 * @param {Object} [opcoes]
 * @param {number} [opcoes.minimo]
 * @returns {Object}
 */
function vigia({ minimo } = {}) {
    const acusacoes = [];
    const estado = { foto: 'IMG_0031' };
    const alvo = createTileHoleWatch({
        foto: () => estado.foto,
        acusar: (id, status) => acusacoes.push({ id, status }),
        ...(minimo === undefined ? {} : { minimo }),
    });
    return { alvo, acusacoes, estado };
}

describe('quantos buracos valem uma acusacao', () => {
    it('o limiar de fabrica e quatro, e o numero e o que o vigia usa', () => {
        // Assercao ABSOLUTA antes de qualquer comparacao relativa: um `TILE_HOLE_MIN`
        // ausente deixaria `minimo = undefined` e `size < undefined` sempre falso, ou
        // seja o primeiro buraco acusaria, com este arquivo verde por comparar consigo.
        expect(TILE_HOLE_MIN).toBe(4);

        const { alvo, acusacoes } = vigia();
        for (let i = 1; i <= 3; i++) {
            expect(alvo.tileFalhou({ chave: `2/${i}/0`, status: 403 })).toBe(false);
        }
        expect(acusacoes).toEqual([]);

        expect(alvo.tileFalhou({ chave: '2/4/0', status: 403 })).toBe(true);
        expect(acusacoes.length).toBe(4);
    });

    it('os codigos vistos ANTES do limiar chegam junto, e nao so o que cruzou a linha', () => {
        const { alvo, acusacoes } = vigia();
        alvo.tileFalhou({ chave: '2/1/0', status: 403 });
        alvo.tileFalhou({ chave: '2/2/0', status: 404 });
        alvo.tileFalhou({ chave: '2/3/0', status: null });
        alvo.tileFalhou({ chave: '2/4/0', status: 500 });

        expect(acusacoes.map((a) => a.id)).toEqual(
            ['IMG_0031', 'IMG_0031', 'IMG_0031', 'IMG_0031'],
        );
        expect(acusacoes.map((a) => a.status)).toEqual([403, 404, null, 500]);
    });

    it('depois de acusada, cada buraco novo segue direto, sem repetir os antigos', () => {
        const { alvo, acusacoes } = vigia();
        for (let i = 1; i <= 4; i++) alvo.tileFalhou({ chave: `2/${i}/0`, status: 403 });
        acusacoes.length = 0;

        expect(alvo.tileFalhou({ chave: '2/5/0', status: 403 })).toBe(true);
        expect(acusacoes).toEqual([{ id: 'IMG_0031', status: 403 }]);
    });

    it('A MESMA CHAVE repetida nunca acusa sozinha, por mais vezes que caia', () => {
        // ESTE E O DISCRIMINANTE do desenho: o tile perdido nao entra no cache, entao a
        // proxima reavaliacao o pede de novo, e um tile teimoso produz uma enxurrada de
        // eventos com UM buraco so na tela. Contar eventos acusaria a rede ruim.
        const { alvo, acusacoes } = vigia();
        for (let i = 0; i < 20; i++) {
            expect(alvo.tileFalhou({ chave: '2/7/3', status: 503 })).toBe(false);
        }
        expect(acusacoes).toEqual([]);
    });

    it('a contagem e POR FOTO: quatro panoramicas com um buraco cada nao dizem nada', () => {
        // AS CHAVES SAO DIFERENTES DE PROPOSITO, e este detalhe e o teste. A primeira
        // versao usava a MESMA chave nas quatro fotos, e assim ela media a deduplicacao
        // de chave outra vez, nao a troca de foto: apagar o `faltando.clear()` da troca
        // deixava tudo verde, medido. Com chaves distintas, um vigia que nao esquece a
        // foto anterior chega a quatro e acusa.
        const { alvo, acusacoes, estado } = vigia();
        ['a', 'b', 'c', 'd'].forEach((nome, i) => {
            estado.foto = nome;
            expect(alvo.tileFalhou({ chave: `2/${i}/0`, status: 403 })).toBe(false);
        });
        expect(acusacoes).toEqual([]);
    });

    it('trocar de foto tambem apaga a ACUSACAO ja feita, e nao so a contagem', () => {
        // A outra metade da troca: sem zerar `acusada`, a foto seguinte herdaria o estado
        // de acusada da anterior e gritaria no primeiro buraco dela.
        const { alvo, acusacoes, estado } = vigia();
        for (let i = 1; i <= 4; i++) alvo.tileFalhou({ chave: `2/${i}/0`, status: 403 });
        expect(acusacoes.length).toBe(4);
        acusacoes.length = 0;

        estado.foto = 'IMG_0032';
        expect(alvo.tileFalhou({ chave: '2/1/0', status: 403 })).toBe(false);
        expect(acusacoes).toEqual([]);
    });

    it('`esquecer` zera a contagem da foto corrente, e so dela', () => {
        const { alvo, acusacoes } = vigia();
        for (let i = 1; i <= 3; i++) alvo.tileFalhou({ chave: `2/${i}/0`, status: 403 });

        // Foto errada: nao mexe em nada, e o quarto buraco ainda acusa.
        alvo.esquecer('OUTRA');
        expect(alvo.tileFalhou({ chave: '2/4/0', status: 403 })).toBe(true);
        acusacoes.length = 0;

        alvo.esquecer('IMG_0031');
        for (let i = 1; i <= 3; i++) {
            expect(alvo.tileFalhou({ chave: `3/${i}/0`, status: 403 })).toBe(false);
        }
        expect(acusacoes).toEqual([]);
    });

    it('sem foto em foco, ou sem chave, nao ha o que contar', () => {
        const { alvo, acusacoes, estado } = vigia({ minimo: 1 });
        estado.foto = null;
        expect(alvo.tileFalhou({ chave: '2/1/0', status: 403 })).toBe(false);
        estado.foto = 'IMG_0031';
        expect(alvo.tileFalhou({ status: 403 })).toBe(false);
        expect(alvo.tileFalhou()).toBe(false);
        expect(acusacoes).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// 2 e 3. O CARREGADOR REAL
// ---------------------------------------------------------------------------

/**
 * O descritor que ESTE servidor emite.
 * @returns {Object}
 */
function descritor() {
    return {
        schemaVersion: 1,
        tileSize: TILE,
        base: 'image?quality=preview',
        template: 'tiles/{level}/{x}/{y}?v=4242',
        levels: montarEscada(1024, 512, TILE, 2)
    };
}

/**
 * Instala o ambiente de navegador. O descritor chega; TODO tile falha do modo pedido.
 * @param {{modo: 'http'|'rede', status?: number}} falhaDoTile
 * @returns {string[]} as URLs pedidas, na ordem
 */
function instalarNavegador(falhaDoTile) {
    const pedidas = [];
    const corpoDescritor = new TextEncoder().encode(JSON.stringify(descritor())).buffer;

    vi.stubGlobal('document', {
        createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) })
    });
    vi.stubGlobal('location', { href: 'http://teste.local/', origin: 'http://teste.local' });
    vi.stubGlobal('fetch', async (url) => {
        const endereco = String(url);
        pedidas.push(endereco);
        if (endereco.includes('tiles.json')) {
            return {
                ok: true,
                status: 200,
                headers: { get: () => null },
                async arrayBuffer() { return corpoDescritor; }
            };
        }
        if (falhaDoTile.modo === 'rede') throw new TypeError('Failed to fetch');
        return {
            ok: false,
            status: falhaDoTile.status,
            headers: { get: () => null },
            async arrayBuffer() { return new ArrayBuffer(0); }
        };
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: TILE, height: TILE, close() {} }));
    return pedidas;
}

/**
 * Carrega uma foto cujos tiles falham, e devolve o que o carregador contou.
 * @param {{modo: 'http'|'rede', status?: number}} falhaDoTile
 * @param {boolean} comCallback - se a opcao `onTileErro` e passada (o mapa) ou nao (a calibracao)
 * @returns {Promise<{falhas: Object[], linhas: string[], pedidas: string[]}>}
 */
async function umaFotoQueFalha(falhaDoTile, comCallback) {
    const pedidas = instalarNavegador(falhaDoTile);
    const falhas = [];
    const linhas = [];

    const { createTileLoader } = await import('@js/street_view_tool/tile-loader.js');
    const carregador = createTileLoader({
        gl: null,
        base: 'http://teste.local/api/v1/sv360',
        onLog: (msg) => linhas.push(msg),
        ...(comCallback ? { onTileErro: (f) => falhas.push(f) } : {}),
    });
    try {
        carregador.atualizarCamera(MONITOR);
        await carregador.carregarFoto('foto-emprestada');
        return { falhas, linhas, pedidas };
    } finally {
        carregador.dispose();
    }
}

describe('o carregador de tiles avisa quando um tile nao chega', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('o 403 de cada tile chega ao `onTileErro` com a chave e o codigo', async () => {
        const { falhas, pedidas } = await umaFotoQueFalha({ modo: 'http', status: 403 }, true);

        // Houve pedido de tile: sem isto o resto seria cobertura vazia (zero falhas
        // porque zero tentativas), e passaria verde com o callback nunca ligado.
        expect(pedidas.filter((u) => u.includes('/tiles/')).length).toBeGreaterThan(0);
        expect(falhas.length).toBe(pedidas.filter((u) => u.includes('/tiles/')).length);
        for (const f of falhas) {
            expect(f.status).toBe(403);
            expect(f.chave).toMatch(/^\d+\/\d+\/\d+$/);
        }
        // Chaves DISTINTAS: e sobre elas que o limiar do bloco 1 conta.
        expect(new Set(falhas.map((f) => f.chave)).size).toBe(falhas.length);
    });

    it('a queda de rede chega com `status: null`, porque resposta nao houve', async () => {
        const { falhas, pedidas } = await umaFotoQueFalha({ modo: 'rede' }, true);

        expect(pedidas.filter((u) => u.includes('/tiles/')).length).toBeGreaterThan(0);
        expect(falhas.length).toBeGreaterThan(0);
        for (const f of falhas) {
            expect(f.status).toBe(null);
            expect(f.chave).toMatch(/^\d+\/\d+\/\d+$/);
        }
    });

    it('SEM a opcao (o caso da calibracao) nada quebra e o `log` da origem continua igual',
        async () => {
            const { falhas, linhas, pedidas } = await umaFotoQueFalha(
                { modo: 'http', status: 403 }, false,
            );

            expect(falhas).toEqual([]);
            const tiles = pedidas.filter((u) => u.includes('/tiles/'));
            expect(tiles.length).toBeGreaterThan(0);
            // A linha de log e a MESMA do ebgeo_360, caractere por caractere na forma.
            const doTile = linhas.filter((l) => l.startsWith('tile '));
            expect(doTile.length).toBe(tiles.length);
            for (const l of doTile) expect(l).toMatch(/^tile \d+\/\d+\/\d+: HTTP 403$/);

            // A EXIGENCIA E DE IGUALDADE, e nao de presenca, porque foi medindo que este
            // bloco se mostrou vazio na primeira versao: sem o `if (onTileErro)`, a chamada
            // solta estoura um TypeError DENTRO do `try` de `baixarTile`, o `catch` o
            // engole e o log continua trazendo a linha HTTP esperada. Contar so as linhas
            // certas passava verde com a guarda apagada; contar TODAS as linhas de tile
            // reprova, porque a guarda ausente acrescenta uma segunda por tile
            // (`tile x/y/z: onTileErro is not a function`).
            expect(linhas.filter((l) => l.includes('is not a function'))).toEqual([]);
        });
});

// ---------------------------------------------------------------------------
// 4. OS SITIOS E A DECLARACAO
// ---------------------------------------------------------------------------

/**
 * @param {string} relativo - caminho a partir da raiz do repositorio
 * @returns {string}
 */
function fonte(relativo) {
    return readFileSync(fileURLToPath(new URL(`../../../${relativo}`, import.meta.url)), 'utf8');
}

describe('a fiacao do sexto trecho, por estrutura', () => {
    it('o carregador copiado chama `onTileErro` nos DOIS pontos, e so sob guarda', () => {
        const loader = fonte('frontend/src/js/street_view_tool/tile-loader.js');
        expect(loader).toContain(
            'if (onTileErro) onTileErro({ chave: item.chave, status: resposta.status });',
        );
        expect(loader).toContain(
            'if (onTileErro) onTileErro({ chave: item.chave, status: null });',
        );
        // A guarda e o que mantem a calibracao viva: duas chamadas, duas guardas.
        expect(loader.match(/if \(onTileErro\)/g)?.length).toBe(2);
    });

    it('o visualizador liga o carregador ao vigia, e o vigia ao painel', () => {
        const viewer = fonte('frontend/src/js/street_view_tool/street_view_viewer.js');
        expect(viewer).toContain('onTileErro: (falha) => buracosDeTile.tileFalhou(falha)');
        expect(viewer).toMatch(/const buracosDeTile = createTileHoleWatch\(\{/);
        expect(viewer).toMatch(/acusar: \(id, status\) => photo360Failures\.report\(id, \{/);
        // Retratacao pareada: o painel e o contador esquecem no mesmo ponto.
        expect(viewer).toContain('photo360Failures.clear(photoName);');
        expect(viewer).toContain('buracosDeTile.esquecer(photoName);');
    });

    it('o sexto trecho esta DECLARADO na regra, senao a proxima conferencia o desfaz', () => {
        // Este e o guarda mais barato do lote e o que protege o mecanismo inteiro: a regra
        // manda ler "diferenca maior que os trechos declarados" como conserto nao portado.
        const regra = fonte('.claude/rules/common-tasks.md');
        expect(regra).toContain('onTileErro');
        expect(regra).toContain('photo360-failure.js');
    });
});
