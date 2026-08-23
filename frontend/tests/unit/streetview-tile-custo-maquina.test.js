// Path: tests/unit/streetview-tile-custo-maquina.test.js
/**
 * @fileoverview As tres regras que baixaram o custo do 360 em maquina fraca.
 *
 * O QUE ELAS CONSERTAM, medido antes de mexer, numa troca de foto a 1904x985 no
 * perfil de CPU seis vezes mais lenta:
 *
 *   1. O carregador descartava a textura que ainda estava na esfera. O three a
 *      recriava no quadro seguinte: DUAS alocacoes de 6144x3072 no mesmo salto,
 *      144 MB alocados contra 72 MB na estacao, e 432 MB subidos contra 216 MB.
 *   2. O canvas se refazia a qualquer degrau de 1024 px. Um ciclo de zoom de 75
 *      a 10 graus alocava quatro canvas, subia 369 MB e travava 622 ms, SEM
 *      baixar um tile novo.
 *   3. O teto da textura era o do driver. Video integrado anuncia 16384, e a
 *      textura de 7680x3840 custa 113 MB de memoria compartilhada, mais outro
 *      tanto no canvas de origem.
 *
 * O teste mede o OBSERVAVEL do carregador (o objeto textura, a largura do canvas
 * e as URLs pedidas), e nunca uma copia da formula.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { montarEscada } from '@js/street_view_tool/pyramid-math.js';

vi.mock('../../src/vendor/three/three.module.js', () => ({
    SRGBColorSpace: 'srgb',
    // Os dois valores reais do three: a costura da equirretangular repete em S
    // e o polo continua grampeado em T. Ver o conserto em `reconstruirCanvas`.
    RepeatWrapping: 1000,
    ClampToEdgeWrapping: 1001,
    LinearFilter: 1006,
    Vector2: class {
        constructor(x, y) { this.x = x; this.y = y; }
    },
    CanvasTexture: class {
        constructor(imagem) {
            this.image = imagem;
            this.needsUpdate = false;
            this.descartada = false;
            this.flipY = true;
            this.repeat = { x: 1, y: 1, set(x, y) { this.x = x; this.y = y; } };
            this.offset = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } };
        }

        dispose() {
            this.descartada = true;
        }
    }
}));

/**
 * Um renderer de mentira que so anota as copias pedidas.
 *
 * Ele nao desenha nada, e nao precisa: o que este teste quer saber e QUANTAS
 * copias parciais aconteceram, ONDE, e se a textura grande parou de ser
 * re-especificada inteira.
 */
function rendererFalso() {
    const copias = [];
    return {
        copias,
        copyTextureToTexture(posicao, origem, destino) {
            copias.push({
                x: posicao.x,
                y: posicao.y,
                w: origem.image.width,
                h: origem.image.height,
                destino
            });
        }
    };
}

const TILE = 512;

/** O monitor medido no piloto. A 75 graus ele pede 6.119 px de panoramica. */
const MONITOR = { lon: 0, lat: 0, fov: 75, largura: 1904, altura: 985 };

function canvasFalso() {
    return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} })
    };
}

function descritorDe(largura, altura, razao) {
    return {
        schemaVersion: 1,
        tileSize: TILE,
        base: 'preview.webp',
        template: '{level}/{x}/{y}.webp',
        levels: montarEscada(largura, altura, TILE, razao)
    };
}

function instalarNavegador(descritor, log = []) {
    const corpoDescritor = new TextEncoder().encode(JSON.stringify(descritor)).buffer;
    const resposta = (corpo) => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        async arrayBuffer() { return corpo; }
    });

    vi.stubGlobal('document', { createElement: () => canvasFalso() });
    vi.stubGlobal('location', { href: 'http://teste.local/', origin: 'http://teste.local' });
    vi.stubGlobal('fetch', async (url) => {
        log.push(String(url));
        return String(url).endsWith('tiles.json')
            ? resposta(corpoDescritor)
            : resposta(new ArrayBuffer(64));
    });
    vi.stubGlobal('createImageBitmap', async () => ({
        width: TILE,
        height: TILE,
        close() {}
    }));
}

async function novoCarregador(renderer) {
    const { createTileLoader } = await import('@js/street_view_tool/tile-loader.js');
    return createTileLoader({ gl: null, renderer, base: 'http://teste.local/api/v1' });
}

/**
 * Espera a fila esvaziar RODANDO O LACO DE QUADRO junto.
 *
 * O `aplicarAtualizacoes` no meio nao e enfeite: e ele que sobe o retangulo
 * acumulado. Sem chamar, os tiles chegam ao canvas e nunca chegam a GPU, e o
 * teste mediria uma coisa que o visualizador de verdade nao faz.
 */
async function esperarFila(carregador) {
    for (let volta = 0; volta < 20000; volta++) {
        carregador.aplicarAtualizacoes();
        if (carregador.getEstatisticas().pendentes === 0) {
            // Mais alguns quadros: o ultimo tile a chegar ainda tem um
            // retangulo pendente quando a fila zera.
            for (let i = 0; i < 3; i++) carregador.aplicarAtualizacoes();
            return;
        }
        await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
    throw new Error('a fila do carregador nao esvaziou');
}

describe('a textura que ainda esta na esfera', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('NAO e descartada quando o canvas se refaz', async () => {
        instalarNavegador(descritorDe(7680, 3840, 1.6));
        const carregador = await novoCarregador();

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            const primeira = carregador.getTextura();
            expect(primeira).toBeTruthy();

            // Fixar um nivel diferente obriga a reconstrucao na hora, sem
            // esperar o debounce da camera.
            carregador.fixarNivel(3);
            const segunda = carregador.getTextura();
            expect(segunda).not.toBe(primeira);

            // O CORACAO DO TESTE. Descartada aqui, a antiga continuaria no
            // material do visualizador ate o primeiro tile novo pintar, e o
            // three a recriaria do zero no quadro seguinte: uma alocacao e uma
            // subida do canvas inteiro, invisiveis na tela.
            expect(primeira.descartada).toBe(false);
        } finally {
            carregador.dispose();
        }
    });

    it('o `dispose` do carregador ainda descarta a que e dele', async () => {
        instalarNavegador(descritorDe(5760, 2880, 2));
        const carregador = await novoCarregador();
        carregador.atualizarCamera(MONITOR);
        await carregador.carregarFoto('foto-2');
        const textura = carregador.getTextura();

        carregador.dispose();

        expect(textura.descartada).toBe(true);
    });
});

describe('a banda morta do tamanho do canvas', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('aproximar dentro da banda NAO refaz o canvas', async () => {
        instalarNavegador(descritorDe(7680, 3840, 1.6));
        const carregador = await novoCarregador();

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            const antes = carregador.getTextura();
            expect(antes.image.width).toBe(6144);

            // Campo de 75 para 40 graus. A largura util quase dobra, mas o teto
            // do nivel a segura em 7680, e 7680/6144 e 1,25x: dentro da banda.
            carregador.atualizarCamera({ fov: 40 });
            carregador.fixarNivel(null);

            const depois = carregador.getTextura();
            expect(depois).toBe(antes);
            expect(depois.image.width).toBe(6144);
        } finally {
            carregador.dispose();
        }
    });

    it('fechar o campo ate 10 graus tambem nao refaz', async () => {
        instalarNavegador(descritorDe(7680, 3840, 1.6));
        const carregador = await novoCarregador();

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            const antes = carregador.getTextura();

            for (const fov of [60, 45, 30, 20, 10]) {
                carregador.atualizarCamera({ fov });
                carregador.fixarNivel(null);
            }

            // Era este o ciclo que alocava quatro canvas e subia 369 MB.
            expect(carregador.getTextura()).toBe(antes);
        } finally {
            carregador.dispose();
        }
    });
});

describe('o teto de textura da maquina', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('aperta em maquina com pouca memoria ou poucos nucleos', async () => {
        const { tetoDaMaquina } = await import('@js/street_view_tool/tile-loader.js');
        expect(tetoDaMaquina({ deviceMemory: 4, hardwareConcurrency: 8 })).toBe(4096);
        expect(tetoDaMaquina({ deviceMemory: 8, hardwareConcurrency: 4 })).toBe(4096);
        expect(tetoDaMaquina({ deviceMemory: 2, hardwareConcurrency: 2 })).toBe(4096);
    });

    it('NAO aperta quando a maquina nao se descreve', async () => {
        const { tetoDaMaquina } = await import('@js/street_view_tool/tile-loader.js');
        // Firefox e Safari nao publicam `deviceMemory`. Borrar a foto de quem
        // ninguem mediu seria pior que pagar memoria numa maquina boa.
        expect(tetoDaMaquina({})).toBe(16384);
        expect(tetoDaMaquina(undefined)).toBe(16384);
        expect(tetoDaMaquina({ deviceMemory: 8, hardwareConcurrency: 16 })).toBe(16384);
    });
});

// A SEGUNDA ONDA DE TILES ESTEVE AQUI, com dois testes, e os dois foram
// apagados junto do codigo. A ideia era pedir o campo visivel primeiro e a
// margem depois, e a medida reprovou: a troca de foto no perfil de maquina
// fraca foi de 1.255 ms para 2.276 ms, e o giro de 1.496 ms para 2.618 ms. O
// motivo esta escrito no lugar de onde ela saiu, em `pedirTiles`. Fica a nota
// para ninguem reescrever os testes antes de reescrever o desenho.

describe('a subida parcial da textura', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('sobe um retangulo por tile, e a textura inteira uma vez so', async () => {
        instalarNavegador(descritorDe(7680, 3840, 1.6));
        const renderer = rendererFalso();
        const carregador = await novoCarregador(renderer);

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            await esperarFila(carregador);

            const estat = carregador.getEstatisticas();
            // Uma subida INTEIRA, a que cria a textura na GPU e leva o fundo.
            expect(estat.uploads).toBe(1);
            expect(estat.uploadsParciais).toBeGreaterThan(0);
            expect(renderer.copias.length).toBe(estat.uploadsParciais);

            // A ECONOMIA E O PONTO. Pelo caminho antigo, os mesmos tiles
            // custavam tres a seis re-especificacoes do canvas de 72 MB. Aqui o
            // total tem de caber em menos de dois canvas, contando a subida
            // inteira inicial.
            const canvasBytes = 6144 * 3072 * 4;
            expect(estat.bytesParaGpu).toBeLessThan(canvasBytes * 2);
        } finally {
            carregador.dispose();
        }
    });

    it('cada retangulo cai em inteiros e dentro do canvas', async () => {
        instalarNavegador(descritorDe(5760, 2880, 2));
        const renderer = rendererFalso();
        const carregador = await novoCarregador(renderer);

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            await esperarFila(carregador);

            const { width, height } = carregador.getTextura().image;
            expect(renderer.copias.length).toBeGreaterThan(0);
            for (const c of renderer.copias) {
                expect(Number.isInteger(c.x)).toBe(true);
                expect(Number.isInteger(c.y)).toBe(true);
                expect(c.x).toBeGreaterThanOrEqual(0);
                expect(c.y).toBeGreaterThanOrEqual(0);
                // `texSubImage2D` recusa retangulo que passe da borda, e recusa
                // em silencio pela via do erro de WebGL: a textura fica sem o
                // tile e nada avisa.
                expect(c.x + c.w).toBeLessThanOrEqual(width);
                expect(c.y + c.h).toBeLessThanOrEqual(height);
            }
        } finally {
            carregador.dispose();
        }
    });

    it('a UV compensa o flipY desligado', async () => {
        instalarNavegador(descritorDe(7680, 3840, 1.6));
        const carregador = await novoCarregador(rendererFalso());

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            const t = carregador.getTextura();

            // As tres linhas andam juntas. Sem a inversao da UV a panoramica
            // sai de cabeca para baixo, e nenhum teste de bytes pegaria isso.
            expect(t.flipY).toBe(false);
            expect(t.repeat.y).toBe(-1);
            expect(t.offset.y).toBe(1);
        } finally {
            carregador.dispose();
        }
    });

    it('sem renderer, nada muda: textura inteira e flipY de sempre', async () => {
        instalarNavegador(descritorDe(7680, 3840, 1.6));
        const carregador = await novoCarregador(undefined);

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            await esperarFila(carregador);

            const t = carregador.getTextura();
            expect(t.flipY).toBe(true);
            expect(t.repeat.y).toBe(1);
            expect(carregador.getEstatisticas().uploadsParciais).toBe(0);
            expect(carregador.getEstatisticas().uploads).toBeGreaterThan(0);
        } finally {
            carregador.dispose();
        }
    });
});
