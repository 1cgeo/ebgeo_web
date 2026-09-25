// Path: tests/unit/editor-de-trajetoria-gestos.repro.test.js
//
// TRÊS ACHADOS DO EDITOR DE TRAJETÓRIA, num arnês só porque os três são o MESMO gesto visto de
// ângulos diferentes: descer numa alça, mover, soltar.
//
// E5 — NO TOQUE, O EDITOR SÓ REMOVIA PONTO-CHAVE. O arrasto de alça escutava
// `map.on('mousedown'|'mousemove'|'mouseup')`, que são ouvintes de MOUSE que o MapLibre registra
// no DOM e não sintetiza a partir do toque (o contêiner declara `touch-action: none` e o próprio
// MapLibre dá `preventDefault` no `touchmove`, então o gesto é consumido e nenhum evento de
// compatibilidade nasce). No tablet as alças apareciam e não obedeciam: mover e inserir eram
// inalcançáveis, e só o toque longo, que é de `touchstart`, funcionava.
//
// E3 — CLICAR NUM PONTO MÉDIO INSERIA E DESSELECIONAVA NO MESMO GESTO (medido no navegador: 3
// pontos-chave viravam 4 e a seleção ia a zero, com o painel fechando). O `preventDefault` da
// descida cancela os eventos de mouse de compatibilidade e NÃO cancela o `click`, e a regra de
// fim de arrasto de 2026-09-20 só descarta cliques que ANDARAM mais de 3px. Inserir por clique
// não anda, então o clique chegava inteiro ao gerente de seleção, caía longe do ícone da feição
// e era lido como "clicou no vazio".
//
// E2 — NENHUMA EDIÇÃO DE TRAJETÓRIA ERA DESFAZÍVEL, salvo o arrasto do PRIMEIRO ponto-chave, que
// cai noutro caminho de escrita. Aqui se prende a metade do EDITOR (que cada gesto pede a
// entrada de desfazer, e que o cancelamento do modo de acréscimo não pede); a metade da store
// está em `desfazer-escrita-de-propriedade.repro.test.js`.
//
// O QUE ESTE ARQUIVO NÃO ALCANÇA: MapLibre e DOM reais. O mapa é falso, mas o que ele devolve em
// `queryRenderedFeatures` é derivado da MESMA `buildHandleCollection` que desenha as alças, e a
// projeção é uma conta declarada (grau × 100 = pixel), de modo que a consulta por CAIXA é de
// verdade exercitada.
//
// O ANEL DA PARTIDA (dono, 2026-09-24): a alça do ponto-chave 0 ficava no centro do símbolo, onde a
// pessoa pega o símbolo, e virou um anel cujo miolo é da feição. O arnês acerta a alça pelo DISCO
// PINTADO (raio mais traço, como o MapLibre), porque é isso que faz o anel ser pegável a 18px do
// centro; o que decide o miolo é o editor, e é isso que os casos do anel prendem.

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    buildHandleCollection,
    ANCHOR_RING_RADIUS_PX,
    ANCHOR_RING_STROKE_PX,
} from '../../src/js/temporal/trajectory-tool/trajectory-edit-geometry.js';
import { showToast } from '@utils/index.js';

const VERTEX_LAYER = 'trajectory-edit-vertex-layer';
const MIDPOINT_LAYER = 'trajectory-edit-midpoint-layer';

const servicos = vi.hoisted(() => ({
    escritas: [],
    selecionadas: [],
    /** When set, replaces the ledger `updateFeature` (the gated store of the ordering case). */
    gravarNaStore: null,
}));

vi.mock('@utils/index.js', () => ({ showToast: vi.fn(), showSuccess: vi.fn() }));
vi.mock('@js/snapping/snapping.service.js', () => ({ getSnappingService: () => null }));
vi.mock('../../src/js/temporal/temporal-render.service.js', () => ({
    updateSourceFeatureProperty: vi.fn(),
}));

vi.mock('@store', () => ({
    registerControl: () => {},
    getControl: () => null,
    getEventBus: () => ({ on: () => () => {} }),
    getStateManager: () => ({
        subscribe: () => () => {},
        getSelectedFeatures: () => servicos.selecionadas,
    }),
    updateFeatureProperty: (...args) => { servicos.escritas.push(args); },
    // Desde 2026-09-24 o gesto grava por `updateFeature` com `transform` (o que ele mudou, sobre a
    // trajetória GUARDADA, sob a trava). O livro-razão registra essa escrita na mesma forma, com o
    // valor que a transformação produz sobre a feição do arnês e a marca de desfazer que a store
    // aplica a uma escrita no mapa corrente (null = corrente, `shouldRecordUndo`).
    updateFeature: (tipo, feature, mapa, opcoes = {}) => {
        if (servicos.gravarNaStore) return servicos.gravarNaStore(tipo, feature, mapa, opcoes);
        const atual = JSON.parse(JSON.stringify(feature));
        const escrita = typeof opcoes.transform === 'function' ? opcoes.transform(atual) : feature;
        servicos.escritas.push([tipo, feature.properties.id, 'trajetoria', escrita.properties.trajetoria,
            mapa ?? null, { recordUndo: mapa == null }]);
        return Promise.resolve();
    },
    getStorageTypeFromSource: (fonte) => `${fonte}s`,
    getMapTemporalConfigSync: () => ({ unidade: 'DIA' }),
}));

let TrajectoryEditControl;
beforeAll(async () => {
    ({ TrajectoryEditControl } = await import('@js/temporal/trajectory-tool/trajectory-edit-control.js'));
}, 120000);

/** Projeção declarada do arnês: um grau vale cem pixels, sem deslocamento. */
const px = (grau) => grau * 100;

/** Rota de três pernas: pixels 100, 200 e 300 nos dois eixos. */
const ROTA = () => ([
    { t: 1000, lng: 1, lat: 1 },
    { t: 2000, lng: 2, lat: 2 },
    { t: 3000, lng: 3, lat: 3 },
]);

function feicaoComRota() {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 1] },
        properties: { id: 'ponto-1', source: 'point', trajetoria: ROTA() },
    };
}

/** Contêiner do canvas: guarda os ouvintes para que o teste possa DISPARAR ponteiro. */
function containerFalso() {
    const ouvintes = new Map();
    return {
        ouvintes,
        capturas: [],
        addEventListener(tipo, fn) {
            if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set());
            ouvintes.get(tipo).add(fn);
        },
        removeEventListener(tipo, fn) { ouvintes.get(tipo)?.delete(fn); },
        setPointerCapture(id) { this.capturas.push(id); },
        releasePointerCapture(id) { this.capturas = this.capturas.filter((c) => c !== id); },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        conta(tipo) { return ouvintes.get(tipo)?.size ?? 0; },
        disparar(tipo, evento) {
            for (const fn of [...(ouvintes.get(tipo) || [])]) fn(evento);
        },
    };
}

function mapaFalso(container, alvo) {
    const camadas = new Set();
    const fontes = new Map();
    const canvasOuvintes = new Map();
    const canvas = {
        style: { cursor: '' },
        addEventListener(tipo, fn) {
            if (!canvasOuvintes.has(tipo)) canvasOuvintes.set(tipo, new Set());
            canvasOuvintes.get(tipo).add(fn);
        },
        removeEventListener(tipo, fn) { canvasOuvintes.get(tipo)?.delete(fn); },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        disparar(tipo, evento) { for (const fn of [...(canvasOuvintes.get(tipo) || [])]) fn(evento); },
    };
    return {
        canvas,
        camadas, fontes, consultas: 0,
        getCanvas: () => canvas,
        getCanvasContainer: () => container,
        on() {}, off() {},
        dragPan: { enable() {}, disable() {} },
        getLayer: (id) => (camadas.has(id) ? { id } : undefined),
        getSource: (id) => fontes.get(id),
        addSource: (id) => fontes.set(id, { setData() {} }),
        addLayer: ({ id }) => camadas.add(id),
        removeLayer: (id) => camadas.delete(id),
        removeSource: (id) => fontes.delete(id),
        unproject: ([x, y]) => ({ lng: x / 100, lat: y / 100 }),
        project: ([lng, lat]) => ({ x: px(lng), y: px(lat) }),
        // O que está DESENHADO é a coleção de alças da rota viva, projetada pela conta acima. O
        // acerto é o do MapLibre para círculo: o disco de raio mais traço (o traço é pintado FORA do
        // raio) tocando a caixa, ou o ponto, da consulta. Os raios são os da pintura do editor.
        queryRenderedFeatures(caixa, opcoes) {
            this.consultas += 1;
            const pedidas = opcoes?.layers || [];
            const [[x1, y1], [x2, y2]] = typeof caixa[0] === 'number' ? [caixa, caixa] : caixa;
            const desenhadas = buildHandleCollection(alvo.feicao?.properties?.trajetoria).features;
            const camadaDe = (f) => (f.properties.handleType === 'vertex' ? VERTEX_LAYER : MIDPOINT_LAYER);
            const raioDe = (f) => {
                if (f.properties.handleType === 'midpoint') return 6 + 2;
                return f.properties.index === 0 ? ANCHOR_RING_RADIUS_PX + ANCHOR_RING_STROKE_PX : 9 + 2.5;
            };
            return desenhadas
                // O vértice fica ACIMA do ponto médio no estilo, então vem primeiro.
                .filter((f) => pedidas.includes(camadaDe(f)))
                .filter((f) => {
                    const [lng, lat] = f.geometry.coordinates;
                    const cx = px(lng);
                    const cy = px(lat);
                    const nx = Math.min(Math.max(cx, x1), x2);
                    const ny = Math.min(Math.max(cy, y1), y2);
                    return Math.hypot(cx - nx, cy - ny) <= raioDe(f);
                })
                .map((f) => ({ ...f, layer: { id: camadaDe(f) } }));
        },
    };
}

/** Documento falso, só o bastante para a barra do modo de acréscimo. */
function documentoFalso() {
    const elemento = () => ({
        className: '', innerHTML: '', textContent: '', dataset: {}, type: '',
        addEventListener() {}, removeEventListener() {}, remove() {},
        querySelector: () => elemento(),
        appendChild() {},
    });
    return {
        body: { appendChild() {} },
        createElement: () => elemento(),
        addEventListener() {}, removeEventListener() {},
    };
}

const evento = (x, y, extra = {}) => ({
    pointerId: 1, isPrimary: true, button: 0,
    clientX: x, clientY: y,
    preventDefault() {},
    ...extra,
});

let alvo;
let container;
let mapa;
let editor;

beforeEach(() => {
    servicos.escritas = [];
    servicos.gravarNaStore = null;
    alvo = { feicao: feicaoComRota() };
    servicos.selecionadas = [{ id: 'ponto-1' }];
    vi.stubGlobal('document', documentoFalso());
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});

    container = containerFalso();
    mapa = mapaFalso(container, alvo);
    editor = new TrajectoryEditControl();
    editor.onAdd(mapa, null);
    editor.show(alvo.feicao);
});

afterEach(() => {
    editor.onRemove();
    vi.unstubAllGlobals();
});

/** A escrita de trajetória que chegou à store, se chegou. */
function escritaDeRota() {
    return servicos.escritas.filter((a) => a[2] === 'trajetoria');
}

describe('E5: o arrasto de alça é de PONTEIRO, então funciona com o dedo', () => {
    it('PISO: o editor escuta `pointerdown` no contêiner do canvas', () => {
        expect(container.conta('pointerdown')).toBe(1);
    });

    it('REPRO: descer, mover e soltar por PONTEIRO move o ponto-chave', () => {
        container.disparar('pointerdown', evento(px(2), px(2)));   // vértice 2
        container.disparar('pointermove', evento(px(2.5), px(2.5)));
        container.disparar('pointerup', evento(px(2.5), px(2.5)));

        const rota = alvo.feicao.properties.trajetoria;
        expect(rota[1].lng).toBeCloseTo(2.5, 10);
        expect(rota[1].lat).toBeCloseTo(2.5, 10);
        // O instante do ponto-chave não se mexe num arrasto de posição.
        expect(rota[1].t).toBe(2000);
    });

    it('a captura de ponteiro é tomada e devolvida, e os ouvintes do arrasto não vazam', () => {
        container.disparar('pointerdown', evento(px(2), px(2)));
        expect(container.capturas).toEqual([1]);
        expect(container.conta('pointermove')).toBe(1);
        expect(container.conta('pointercancel')).toBe(1);

        container.disparar('pointerup', evento(px(2), px(2)));
        expect(container.capturas).toEqual([]);
        expect(container.conta('pointermove')).toBe(0);
        expect(container.conta('pointerup')).toBe(0);
        expect(container.conta('pointercancel')).toBe(0);
    });

    it('`pointercancel` no meio do gesto DESCARTA, e não insere ponto-chave nenhum', () => {
        // Um toque numa alça de ponto médio interrompido pelo sistema é indistinguível de um
        // toque completo, e o toque completo INSERE. Cancelar não pode escrever.
        container.disparar('pointerdown', evento(px(1.5), px(1.5))); // ponto médio 1-2
        container.disparar('pointercancel', evento(px(1.5), px(1.5)));

        expect(alvo.feicao.properties.trajetoria).toHaveLength(3);
        expect(escritaDeRota()).toEqual([]);
        expect(container.capturas).toEqual([]);
    });

    it('o ponteiro NÃO primário (segundo dedo) não começa um arrasto', () => {
        container.disparar('pointerdown', evento(px(2), px(2), { isPrimary: false, pointerId: 2 }));
        expect(container.conta('pointermove')).toBe(0);
    });

    it('o botão direito não começa arrasto: ele é do menu de contexto', () => {
        container.disparar('pointerdown', evento(px(2), px(2), { button: 2 }));
        expect(container.conta('pointermove')).toBe(0);
    });

    it('descer FORA de qualquer alça não começa arrasto', () => {
        container.disparar('pointerdown', evento(px(7), px(7)));
        expect(container.conta('pointermove')).toBe(0);
    });

    it('esconder o editor solta o ouvinte de descida', () => {
        editor.hide();
        expect(container.conta('pointerdown')).toBe(0);
    });

    it('a consulta de alça é uma CAIXA, e alcança um toque a alguns pixels do centro', () => {
        // A alça tem 9px de raio e a ponta de um dedo cobre bem mais. Um ponto exato acertaria
        // igual; o que esta folga compra é o toque deslocado.
        container.disparar('pointerdown', evento(px(2) + 4, px(2) - 4));
        expect(container.conta('pointermove')).toBe(1);
    });
});

describe('E3: clicar numa alça não é clicar no vazio', () => {
    it('REPRO: clicar (sem andar) num ponto médio INSERE, e a alça segue sob o cursor', () => {
        const ponto = { x: px(1.5), y: px(1.5) };
        container.disparar('pointerdown', evento(ponto.x, ponto.y));
        container.disparar('pointerup', evento(ponto.x, ponto.y));

        // O gesto inseriu: 3 pontos-chave viraram 4, com o instante no meio dos vizinhos.
        expect(alvo.feicao.properties.trajetoria).toHaveLength(4);
        expect(alvo.feicao.properties.trajetoria[1].t).toBe(1500);
        // E o predicado que o gerente de seleção consulta reconhece o ponto do clique, agora
        // ocupado pelo VÉRTICE recém-criado. Sem isto, o mesmo gesto desselecionava a feição.
        expect(editor.isHandleAt(ponto)).toBe(true);
    });

    it('clicar num VÉRTICE sem arrastar também é da alça (e não move o ponto-chave)', () => {
        const ponto = { x: px(3), y: px(3) };
        container.disparar('pointerdown', evento(ponto.x, ponto.y));
        container.disparar('pointerup', evento(ponto.x, ponto.y));

        expect(alvo.feicao.properties.trajetoria[2]).toEqual({ t: 3000, lng: 3, lat: 3 });
        expect(escritaDeRota()).toEqual([]); // clique em vértice não grava
        expect(editor.isHandleAt(ponto)).toBe(true);
    });

    it('CONTROLE: clique longe de toda alça NÃO é da alça, e a desseleção segue o curso dela', () => {
        expect(editor.isHandleAt({ x: px(7), y: px(7) })).toBe(false);
    });

    it('sem feição mostrada o predicado é falso, sem consultar o mapa', () => {
        editor.hide();
        const antes = mapa.consultas;
        expect(editor.isHandleAt({ x: px(2), y: px(2) })).toBe(false);
        expect(mapa.consultas).toBe(antes);
    });

    it.each([
        ['ponto ausente', null],
        ['ponto indefinido', undefined],
    ])('%s: falso, e não levanta', (_r, ponto) => {
        expect(editor.isHandleAt(ponto)).toBe(false);
    });

    it('a consulta que levanta degrada para falso (estilo em reconstrução)', () => {
        mapa.queryRenderedFeatures = () => { throw new Error('style reloading'); };
        expect(editor.isHandleAt({ x: px(2), y: px(2) })).toBe(false);
    });
});

describe('E3: a fiação no gerente de seleção', () => {
    const fonte = readFileSync(new URL('../../src/js/tool_manager/selection_manager.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n');

    it('`_handleMapClick` consulta o predicado, ao lado da isenção do modo de acréscimo', () => {
        const inicio = fonte.indexOf('    _handleMapClick = (e) => {');
        expect(inicio).toBeGreaterThan(-1);
        const corpo = fonte.slice(inicio, fonte.indexOf('\n    }\n', inicio));

        const isencao = corpo.indexOf("getControl('TrajectoryEditControl')?.isHandleAt?.(e.point)");
        expect(isencao).toBeGreaterThan(-1);
        // Antes de qualquer desseleção, senão a recusa chega tarde demais.
        expect(isencao).toBeLessThan(corpo.indexOf('this.deselectAllFeatures('));
    });
});

describe('E2: um gesto, uma entrada de Ctrl+Z', () => {
    it('REPRO: arrastar um ponto-chave grava PEDINDO desfazer', () => {
        container.disparar('pointerdown', evento(px(2), px(2)));
        container.disparar('pointermove', evento(px(2.5), px(2.5)));
        container.disparar('pointerup', evento(px(2.5), px(2.5)));

        const escritas = escritaDeRota();
        expect(escritas).toHaveLength(1);
        expect(escritas[0][5]).toEqual({ recordUndo: true });
        // …e pelo tipo de ARMAZENAMENTO, não pelo de fonte, senão a escrita falha calada.
        expect(escritas[0][0]).toBe('points');
    });

    it('inserir por ponto médio grava UMA vez, pedindo desfazer', () => {
        container.disparar('pointerdown', evento(px(1.5), px(1.5)));
        container.disparar('pointerup', evento(px(1.5), px(1.5)));

        const escritas = escritaDeRota();
        expect(escritas).toHaveLength(1);
        expect(escritas[0][5]).toEqual({ recordUndo: true });
    });

    it('remover um ponto-chave pelo botão direito grava UMA vez, pedindo desfazer', () => {
        mapa.canvas.disparar('contextmenu', {
            clientX: px(3), clientY: px(3),
            preventDefault() {}, stopPropagation() {},
        });

        const escritas = escritaDeRota();
        expect(escritas).toHaveLength(1);
        expect(escritas[0][5]).toEqual({ recordUndo: true });
        expect(escritas[0][3]).toHaveLength(2);
    });

    it('o ponto inicial (âncora) continua sem remoção: ele é a partida da feição', () => {
        // No ANEL, a 18px do centro: o miolo é da feição desde 2026-09-24 (casos do anel abaixo).
        let recusado = false;
        mapa.canvas.disparar('contextmenu', {
            clientX: px(1) - 18, clientY: px(1),
            preventDefault() { recusado = true; }, stopPropagation() {},
        });

        expect(recusado, 'o botão direito no anel é do editor').toBe(true);
        expect(alvo.feicao.properties.trajetoria).toHaveLength(3);
        expect(escritaDeRota()).toEqual([]);
    });

    it('a SESSÃO INTEIRA de "Adicionar no mapa" é UMA entrada, não uma por clique', () => {
        editor.startAdding();
        editor._onClick({ lngLat: { lng: 4, lat: 4 } });
        editor._onClick({ lngLat: { lng: 5, lat: 5 } });
        // Nada persistiu ainda: o acréscimo mexe só no array vivo.
        expect(escritaDeRota()).toEqual([]);

        editor._exitAdding(true);

        const escritas = escritaDeRota();
        expect(escritas).toHaveLength(1);
        expect(escritas[0][5]).toEqual({ recordUndo: true });
        expect(escritas[0][3]).toHaveLength(5);
    });

    it('CANCELAR o acréscimo repõe o instantâneo e NÃO pede desfazer', () => {
        editor.startAdding();
        editor._onClick({ lngLat: { lng: 4, lat: 4 } });

        editor._exitAdding(false);

        const escritas = escritaDeRota();
        expect(escritas).toHaveLength(1);
        // A escrita acontece (repor o instantâneo), mas uma entrada de Ctrl+Z ali desfaria uma
        // mudança que ninguém fez.
        expect(escritas[0][5]).toEqual({ recordUndo: false });
        expect(escritas[0][3]).toHaveLength(3);
    });
});

describe('dois gestos antes de a primeira gravacao terminar (ordem de escrita)', () => {
    /**
     * Uma store falsa com a propriedade que importa da real: as gravacoes deste cliente sao
     * aplicadas EM ORDEM (a trava do documento e FIFO), e cada uma so resolve quando o teste solta.
     */
    function storeComPortao() {
        const guardada = { valor: ROTA() };
        const fila = [];
        servicos.gravarNaStore = (tipo, feature, mapa, opcoes) => new Promise((resolve) => {
            fila.push(() => {
                const atual = { ...feature, properties: { ...feature.properties, trajetoria: JSON.parse(JSON.stringify(guardada.valor)) } };
                guardada.valor = opcoes.transform(atual).properties.trajetoria;
                resolve();
            });
        });
        return {
            guardada,
            async soltarTudo() {
                while (fila.length) { fila.shift()(); await Promise.resolve(); }
                await new Promise((r) => setTimeout(r, 0));
            },
        };
    }

    it('arrastar o MESMO ponto duas vezes antes da 1a gravacao grava so a posicao final', async () => {
        const store = storeComPortao();
        container.disparar('pointerdown', evento(px(2), px(2)));
        container.disparar('pointermove', evento(px(2.5), px(2.5)));
        container.disparar('pointerup', evento(px(2.5), px(2.5)));
        container.disparar('pointerdown', evento(px(2.5), px(2.5)));
        container.disparar('pointermove', evento(px(2.8), px(2.8)));
        container.disparar('pointerup', evento(px(2.8), px(2.8)));

        await store.soltarTudo();

        const esperado = [
            { t: 1000, lng: 1, lat: 1 },
            { t: 2000, lng: 2.8, lat: 2.8 },
            { t: 3000, lng: 3, lat: 3 },
        ];
        expect(store.guardada.valor).toEqual(esperado);
        expect(alvo.feicao.properties.trajetoria).toEqual(esperado);
    });

    it('inserir pelo ponto medio e arrastar o ponto novo antes da 1a gravacao nao duplica', async () => {
        const store = storeComPortao();
        container.disparar('pointerdown', evento(px(1.5), px(1.5)));
        container.disparar('pointerup', evento(px(1.5), px(1.5)));
        container.disparar('pointerdown', evento(px(1.5), px(1.5)));
        container.disparar('pointermove', evento(px(1.7), px(1.2)));
        container.disparar('pointerup', evento(px(1.7), px(1.2)));

        await store.soltarTudo();

        expect(store.guardada.valor).toHaveLength(4);
        expect(new Set(store.guardada.valor.map((k) => k.t)).size, 'nenhum instante repetido').toBe(4);
        expect(store.guardada.valor.some((k) => k.lng === 1.7 && k.lat === 1.2)).toBe(true);
    });
});

describe('o ANEL da partida: o miolo é da feição, o anel é a alça (dono, 2026-09-24)', () => {
    /** O centro da partida na tela (ponto-chave 0 em 1,1). */
    const centro = { x: px(1), y: px(1) };

    it('REPRO: descer no CENTRO do símbolo não é descer na alça, e o arrasto fica com o corpo', () => {
        // Antes do anel a descida aqui pegava a alça 0 e movia só a partida, deformando a rota.
        container.disparar('pointerdown', evento(centro.x, centro.y));
        expect(container.conta('pointermove'), 'o editor tomou a descida do miolo').toBe(0);
        expect(editor.isHandleAt(centro)).toBe(false);
    });

    it('CONTROLE: descer no ANEL, a 18px do centro, é da alça', () => {
        container.disparar('pointerdown', evento(centro.x - 18, centro.y));
        expect(container.conta('pointermove')).toBe(1);
        expect(editor.isHandleAt({ x: centro.x - 18, y: centro.y })).toBe(true);
    });

    it('arrastar o anel move só a partida, e o que o ponteiro andou: sem salto até o ponteiro', () => {
        container.disparar('pointerdown', evento(centro.x - 18, centro.y));
        container.disparar('pointermove', evento(centro.x - 18 - 30, centro.y + 30));
        container.disparar('pointerup', evento(centro.x - 18 - 30, centro.y + 30));

        const rota = alvo.feicao.properties.trajetoria;
        // A partida andou (-30, +30) px a partir do CENTRO, e não foi parar sob o ponteiro.
        expect(rota[0].lng).toBeCloseTo(0.7, 10);
        expect(rota[0].lat).toBeCloseTo(1.3, 10);
        expect(rota[0].t).toBe(1000);
        expect(rota.slice(1)).toEqual(ROTA().slice(1));
    });

    it('as outras alças continuam indo ao ponteiro: a compensação é só do anel', () => {
        container.disparar('pointerdown', evento(px(2) + 4, px(2) - 4));
        container.disparar('pointermove', evento(px(2.5) + 4, px(2.5) - 4));
        container.disparar('pointerup', evento(px(2.5) + 4, px(2.5) - 4));

        const rota = alvo.feicao.properties.trajetoria;
        expect(rota[1].lng).toBeCloseTo(2.54, 10);
        expect(rota[1].lat).toBeCloseTo(2.46, 10);
    });

    it('o botão direito no miolo não é do editor: o menu da feição abre, sem aviso da âncora', () => {
        vi.mocked(showToast).mockClear();
        let recusado = false;
        mapa.canvas.disparar('contextmenu', {
            clientX: centro.x, clientY: centro.y,
            preventDefault() { recusado = true; }, stopPropagation() {},
        });

        expect(recusado).toBe(false);
        expect(showToast).not.toHaveBeenCalled();
        expect(escritaDeRota()).toEqual([]);
    });

    describe('no toque, o toque longo segue a mesma regra', () => {
        beforeEach(() => {
            // O toque longo só se liga num aparelho de toque, e liga-se no `show`.
            editor.hide();
            vi.stubGlobal('navigator', { maxTouchPoints: 1 });
            vi.useFakeTimers();
            editor.show(alvo.feicao);
            vi.mocked(showToast).mockClear();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        const tocarLongo = (x, y) => {
            container.disparar('touchstart', { touches: [{ clientX: x, clientY: y }] });
            vi.advanceTimersByTime(600);
            container.disparar('touchend', {});
        };

        it('CONTROLE: o toque longo num vértice comum remove o ponto-chave', () => {
            tocarLongo(px(3), px(3));
            expect(alvo.feicao.properties.trajetoria).toHaveLength(2);
        });

        it('no ANEL, a partida continua sem remoção, com o aviso', () => {
            tocarLongo(centro.x - 18, centro.y);
            expect(showToast).toHaveBeenCalledWith('O ponto inicial (posição da feição) não pode ser removido.', 'info');
            expect(alvo.feicao.properties.trajetoria).toHaveLength(3);
        });

        it('no MIOLO, o toque longo não é do editor: nenhum aviso da âncora', () => {
            tocarLongo(centro.x, centro.y);
            expect(showToast).not.toHaveBeenCalled();
            expect(alvo.feicao.properties.trajetoria).toHaveLength(3);
        });
    });
});
