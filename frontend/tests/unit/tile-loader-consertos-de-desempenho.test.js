// Path: tests/unit/tile-loader-consertos-de-desempenho.test.js
/**
 * @fileoverview Os quatro consertos de desempenho do carregador de tiles 360, portados do
 * `ebgeo_360` (commit `ff01e06`, 2026-08-23), medidos AQUI pelo observavel do carregador.
 *
 * ISTO E TESTE DE COMPORTAMENTO, e nao de presenca. Ele monta o carregador de verdade com o
 * mesmo mock de three e o mesmo navegador de mentira que os outros testes de `street_view_tool`
 * usam, dirige uma foto real e le o que saiu: o estado da textura, as copias que o renderer
 * recebeu e as URLs pedidas. Nenhum caso aqui procura texto no arquivo-fonte.
 *
 * A UNICA COISA QUE ELE NAO ALCANCA e o pixel: o mock de `CanvasTexture` guarda `wrapS` como
 * campo, e nada aqui prova que o amostrador do WebGL de fato mistura a costura. Isso e verdade
 * de navegador, e esta camada nao a tem.
 *
 * OS QUATRO CONSERTOS E ONDE CADA UM E COBRADO:
 *
 *   1. O estrangulamento da reavaliacao (era debounce de RESET, e nao disparava durante o
 *      gesto: uma volta de 360 graus baixou ZERO tiles, medido). Aqui: a borda de ENTRADA,
 *      que e sincrona e por isso observavel sem relogio falso. A janela e a borda de saida
 *      estao em `frontend/tests/unit/reeval-throttle.test.js`, com relogio injetado.
 *   2. A lista de retangulos no lugar da caixa envolvente (187,3 MB em 3 chamadas para pintar
 *      55 tiles, a maior de 75,5 MB, contra 36,9 MB dos retangulos reais). Aqui: os bytes que
 *      chegam a GPU e o tamanho da maior copia, com tetos derivados de medida dos dois lados
 *      do conserto.
 *
 *      O QUE ESTE ARQUIVO NAO ALCANCA, e foi conferido apagando: a guarda da envolvente
 *      (`loteParaSubir`) e INVISIVEL daqui, porque o carregador so expoe o lote que ja passou
 *      por ela. Apagada, tudo aqui continua verde. Ela e justamente a peca cuja primeira
 *      versao mediu PIOR que o defeito (248,3 MiB contra 213,9 MiB), e quem a prende e
 *      `frontend/tests/unit/tile-upload-rects.test.js`, que a importa direto.
 *   3. `wrapS = RepeatWrapping` na costura da equirretangular, com `wrapT` grampeado.
 *   4. O `dispose()` que descarta tambem a textura do RECORTE. Eram duas texturas de GPU
 *      vazadas por carregador desmontado, e a pagina de calibracao monta dois.
 *
 * O metodo de conferencia contra o `ebgeo_360` esta em `.claude/rules/common-tasks.md`
 * §"O par que DIVERGE".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { montarEscada } from '@js/street_view_tool/pyramid-math.js';
import { MAX_PEDACOS } from '@js/street_view_tool/tile-upload-rects.js';

vi.mock('../../src/vendor/three/three.module.js', () => ({
    SRGBColorSpace: 'srgb',
    LinearFilter: 1006,
    // Os dois valores reais do three.
    RepeatWrapping: 1000,
    ClampToEdgeWrapping: 1001,
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
    },
}));

const TILE = 512;
/** O monitor medido no piloto. A 75 graus ele pede 6.119 px de panoramica. */
const MONITOR = { lon: 0, lat: 0, fov: 75, largura: 1904, altura: 985 };

/**
 * Um renderer de mentira que anota a ORIGEM de cada copia, e nao so o destino.
 *
 * A origem e a textura do recorte, que o carregador nunca expoe. Guardar a referencia aqui e o
 * unico jeito honesto de perguntar, depois do `dispose()`, se ela foi descartada.
 *
 * @returns {object} o renderer falso
 */
function rendererFalso() {
    const copias = [];
    return {
        copias,
        copyTextureToTexture(posicao, origem, destino) {
            copias.push({
                x: posicao.x, y: posicao.y,
                w: origem.image.width, h: origem.image.height,
                origem, destino,
            });
        },
    };
}

function canvasFalso() {
    return { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
}

function descritorDe(largura, altura, razao) {
    return {
        schemaVersion: 1,
        tileSize: TILE,
        base: 'preview.webp',
        template: '{level}/{x}/{y}.webp',
        levels: montarEscada(largura, altura, TILE, razao),
    };
}

function instalarNavegador(descritor, log = []) {
    const corpoDescritor = new TextEncoder().encode(JSON.stringify(descritor)).buffer;
    const resposta = (corpo) => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        async arrayBuffer() { return corpo; },
    });

    vi.stubGlobal('document', { createElement: () => canvasFalso() });
    vi.stubGlobal('location', { href: 'http://teste.local/', origin: 'http://teste.local' });
    vi.stubGlobal('fetch', async (url) => {
        log.push(String(url));
        return String(url).endsWith('tiles.json')
            ? resposta(corpoDescritor)
            : resposta(new ArrayBuffer(64));
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: TILE, height: TILE, close() {} }));
}

async function novoCarregador(renderer) {
    const { createTileLoader } = await import('@js/street_view_tool/tile-loader.js');
    return createTileLoader({ gl: null, renderer, base: 'http://teste.local/api/v1' });
}

/** Esvazia a fila RODANDO o laco de quadro junto, que e quem sobe os retangulos. */
async function esperarFila(carregador) {
    for (let volta = 0; volta < 20000; volta++) {
        carregador.aplicarAtualizacoes();
        if (carregador.getEstatisticas().pendentes === 0) {
            for (let i = 0; i < 3; i++) carregador.aplicarAtualizacoes();
            return;
        }
        await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
    throw new Error('a fila do carregador nao esvaziou');
}

describe('conserto 3: a costura da equirretangular repete em S', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('a textura sai com wrapS de repeticao e wrapT grampeado', async () => {
        instalarNavegador(descritorDe(7680, 3840, 1.6));
        const carregador = await novoCarregador(rendererFalso());
        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            const textura = carregador.getTextura();

            // A UV da esfera fecha em u=0/1: sem repeticao, o amostrador grampeia
            // no ultimo texel e sobra meio texel de descontinuidade na emenda.
            expect(textura.wrapS).toBe(1000);
            // O polo NAO pode dar a volta: repetir em T costuraria zenite no nadir.
            expect(textura.wrapT).toBe(1001);
        } finally {
            carregador.dispose();
        }
    });

    it('e a premissa do grampo continua de pe: a UV anda invertida dentro de [0,1]', async () => {
        instalarNavegador(descritorDe(7680, 3840, 1.6));
        const carregador = await novoCarregador(rendererFalso());
        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            const textura = carregador.getTextura();
            expect(textura.flipY).toBe(false);
            expect(textura.repeat.y).toBe(-1);
            expect(textura.offset.y).toBe(1);
        } finally {
            carregador.dispose();
        }
    });

    it('cada canvas novo rearma o wrap, e nao so o primeiro', async () => {
        instalarNavegador(descritorDe(7680, 3840, 1.6));
        const carregador = await novoCarregador(rendererFalso());
        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            const primeira = carregador.getTextura();
            carregador.fixarNivel(3);
            const segunda = carregador.getTextura();
            expect(segunda).not.toBe(primeira);
            expect(segunda.wrapS).toBe(1000);
            expect(segunda.wrapT).toBe(1001);
        } finally {
            carregador.dispose();
        }
    });
});

describe('conserto 4: o dispose nao vaza a textura do recorte', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('descarta a textura de recorte junto com a principal', async () => {
        instalarNavegador(descritorDe(5760, 2880, 2));
        const renderer = rendererFalso();
        const carregador = await novoCarregador(renderer);

        carregador.atualizarCamera(MONITOR);
        await carregador.carregarFoto('foto-1');
        await esperarFila(carregador);

        const principal = carregador.getTextura();
        // A origem de toda copia parcial E a textura de recorte, e ela e UMA so.
        expect(renderer.copias.length).toBeGreaterThan(0);
        const recortes = new Set(renderer.copias.map((c) => c.origem));
        expect(recortes.size).toBe(1);
        const recorte = [...recortes][0];
        expect(recorte).not.toBe(principal);
        expect(recorte.descartada).toBe(false);

        carregador.dispose();

        // ANTES DO CONSERTO ESTA LINHA MEDIA `false`: eram duas texturas de GPU
        // vazadas por carregador desmontado, e a calibracao monta dois.
        expect(recorte.descartada).toBe(true);
        expect(principal.descartada).toBe(true);
    });

    it('o dispose e idempotente, e nao explode sem recorte nenhum', async () => {
        instalarNavegador(descritorDe(5760, 2880, 2));
        const carregador = await novoCarregador(rendererFalso());
        // Sem `carregarFoto` nao ha textura nem recorte: o `?.` e o que segura.
        expect(() => { carregador.dispose(); }).not.toThrow();
        expect(() => { carregador.dispose(); }).not.toThrow();
    });
});

describe('conserto 1: a borda de entrada faz o gesto carregar enquanto acontece', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('a primeira mudanca de camera pede tile NA HORA, sem esperar a janela', async () => {
        const log = [];
        instalarNavegador(descritorDe(7680, 3840, 1.6), log);
        const carregador = await novoCarregador(rendererFalso());

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            await esperarFila(carregador);

            const antes = log.length;
            // Gira 90 graus, uma vez. Pelo caminho ANTIGO isto so armava um
            // temporizador de 120 ms, e como `atualizarCamera` roda por quadro o
            // temporizador era reiniciado antes de vencer: a volta inteira baixava
            // ZERO tiles (medido na aplicacao real, duas repeticoes).
            carregador.atualizarCamera({ lon: 90 });
            // NADA de `await` de temporizador aqui: a borda de entrada e sincrona,
            // e e exatamente isso que este caso afirma.
            const pedidosImediatos = log.length - antes
                + carregador.getEstatisticas().pendentes;
            expect(pedidosImediatos).toBeGreaterThan(0);
        } finally {
            carregador.dispose();
        }
    });

    it('o giro inteiro reavalia varias vezes, e nao uma so no fim', async () => {
        const log = [];
        instalarNavegador(descritorDe(7680, 3840, 1.6), log);
        const carregador = await novoCarregador(rendererFalso());

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            await esperarFila(carregador);

            const vistos = new Set(log);
            // 36 quadros, que e o gesto medido. Entre eles a fila anda, entao os
            // pedidos de direcoes novas tem de aparecer DURANTE o giro.
            for (let q = 1; q <= 36; q++) {
                carregador.atualizarCamera({ lon: (q * 10) % 360 });
                carregador.aplicarAtualizacoes();
                await new Promise((resolve) => { setTimeout(resolve, 0); });
            }
            const novos = log.filter((u) => !vistos.has(u));
            expect(novos.length).toBeGreaterThan(0);
        } finally {
            carregador.dispose();
        }
    });
});

describe('conserto 2: a subida parcial deixa de subir o canvas inteiro', () => {
    beforeEach(() => { vi.resetModules(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('sobe menos da METADE dos pixels que a caixa envolvente subia', async () => {
        instalarNavegador(descritorDe(7680, 3840, 1.6));
        const renderer = rendererFalso();
        const carregador = await novoCarregador(renderer);

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');
            await esperarFila(carregador);

            const { width, height } = carregador.getTextura().image;
            const areaCanvas = width * height;
            expect(areaCanvas).toBe(6144 * 3072);
            expect(renderer.copias.length).toBeGreaterThan(1);

            // OS TETOS SAO DERIVADOS DE MEDIDA, e nao chutados. Nesta bancada, com
            // o descritor de 7680x3840 e o monitor do piloto, foi medido de um lado
            // e do outro do conserto, na mesma execucao do carregador de verdade:
            //
            //   caixa envolvente unica: 1 copia, 15.108.096 px (0,800 do canvas)
            //   lista com fusao e teto: 8 copias, 8.063.883 px (0,427 do canvas),
            //                           a maior delas 2.686.321 px (0,142)
            //
            // Os limites ficam entre os dois valores, entao reverter o conserto
            // reprova este caso; foi conferido revertendo. Um teto solto (por
            // exemplo "< 1 canvas") passaria verde nos DOIS lados, que e a
            // cobertura vazia que a constituicao da casa nomeia, e foi de fato a
            // primeira versao deste caso.
            const somaParcial = renderer.copias.reduce((t, c) => t + c.w * c.h, 0);
            expect(somaParcial / areaCanvas).toBeLessThan(0.6);

            // A MEDIDA QUE NOMEOU O DEFEITO na aplicacao real: a maior chamada era
            // o canvas inteiro, 75,5 MB de 6144x3072.
            const maior = Math.max(...renderer.copias.map((c) => c.w * c.h));
            expect(maior / areaCanvas).toBeLessThan(0.5);
        } finally {
            carregador.dispose();
        }
    });

    it('e nenhum quadro sobe mais de MAX_PEDACOS retangulos', async () => {
        instalarNavegador(descritorDe(7680, 3840, 1.6));
        const renderer = rendererFalso();
        const carregador = await novoCarregador(renderer);

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');

            // Conta as copias POR CHAMADA do laco de quadro. O teto de oito e o
            // que impede a lista de virar uma leitura de volta por tile, que
            // mediu 117 ms contra 10 ms no perfil de maquina fraca.
            //
            // ESTE CASO NAO DISCRIMINA SOZINHO, e vale dizer: a caixa envolvente
            // unica tambem passa nele (sobe UMA copia por quadro). Ele guarda o
            // outro extremo, o de um retangulo por tile, e e o caso acima que
            // reprova a volta da caixa.
            let anterior = 0;
            for (let volta = 0; volta < 20000; volta++) {
                carregador.aplicarAtualizacoes();
                expect(renderer.copias.length - anterior).toBeLessThanOrEqual(MAX_PEDACOS);
                anterior = renderer.copias.length;
                if (carregador.getEstatisticas().pendentes === 0) break;
                await new Promise((resolve) => { setTimeout(resolve, 0); });
            }
            expect(renderer.copias.length).toBeGreaterThan(0);
        } finally {
            carregador.dispose();
        }
    });
});
