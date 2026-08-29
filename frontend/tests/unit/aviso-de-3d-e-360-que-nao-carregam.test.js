// Path: tests/unit/aviso-de-3d-e-360-que-nao-carregam.test.js
//
// AS DUAS SUPERFICIES QUE NAO PASSAM PELO MAPA: o modelo 3D (Cesium) e a foto 360 (Three.js).
//
// POR QUE ESTE ARQUIVO EXISTE. Ate 2026-08-24 o painel de superficie que nao carregou cobria
// TRES superficies, e as tres tem a mesma origem: um `error` do MapLibre com `sourceId`. O 3D e o
// 360 ficavam de fora por uma razao real, escrita na regra de arquitetura, que e NAO passarem por
// aquele evento: cada um baixa os proprios bytes. A decisao do dono naquele dia foi liga-los ao
// MESMO painel pela outra porta, a que o mapa base ja usava: acusar DIRETO, do proprio caminho de
// falha de carga. Para o visitante de link publico isso fecha a ultima superficie muda, e ele e o
// unico perfil sem via de diagnostico nenhuma.
//
// O QUE CADA BLOCO PROVA, E O QUE ELE NAO PROVA:
//
//  1. CONCORDANCIA. Prova que "modelo 3D" e masculino e "foto 360°" e feminina em todas as
//     formas (singular, plural, nova tentativa, nome ausente). NAO prova redacao: prova que uma
//     frase unica feminina, que e o que existia, mentiria sobre o modelo.
//  2. AGREGACAO POR SUBSTANTIVO. Prova que camada e modelo falhando JUNTOS produzem UM painel com
//     DUAS frases, uma contagem por substantivo, e os codigos HTTP dos dois somados numa linha
//     so. NAO prova o intervalo de coalescencia (700 ms e decisao, nao invariante).
//  3. A SUPERFICIE DIRETA. Prova que quem nao tem `sourceId` nenhum acusa mesmo assim, que o
//     painel nasce, e que o botao de tentar de novo NAO se desenha para ela (pedir de novo seria
//     reabrir o visualizador, que e navegacao e nao novo pedido).
//  4. RETIRADA. Prova que a acusacao do 3D sai sozinha e deixa a da camada de pe, e vice-versa.
//  5. ESTILO NOVO NAO ABSOLVE O 3D. E o invariante que nasceu com esta mudanca: `style.load`
//     rebaixa toda fonte do mapa porque todas estao sendo pedidas de novo, e NAO pede o modelo 3D
//     de novo. Sem a distincao, trocar de mapa base perdoava um modelo que continua quebrado.
//  6. A NOVA TENTATIVA E POR GRUPO. Prova que retentar as camadas nao faz o modelo 3D dizer
//     "continua sem carregar apos a nova tentativa", que e uma tentativa que nunca aconteceu.
//  7. O STATUS DENTRO DA PROSA DO CESIUM. Prova o formato medido no bundle vendorizado e prova o
//     `null` de tudo que nao e ele. NAO prova que o Cesium so emita aquele formato.
//  8. OS SITIOS. Prova, POR ESTRUTURA, que as chamadas existem onde tem de existir: o `attach` nos
//     dois controles, o `report` no `tileFailed` e no `catch` da raiz do 3D, o `report` e o
//     `clear` no `loadPhoto` do 360. E teste de FONTE, e vale so o que teste de fonte vale: ele
//     prende o SITIO, que e o que o controle negativo de um teste de comportamento nao alcanca
//     aqui (os dois motores nao carregam em node), e nao prende o comportamento. Os padroes sao
//     expressoes de chamada, nao palavras soltas, para que um comentario que cite o nome nao
//     satisfaca a busca.
//
// CONTROLE NEGATIVO, conferido caso a caso (cada reversao deixa VERMELHO o `it` nomeado): o
// `noun` de `createLoaderFailureSurface`, o `rebuiltByStyle: false`, o `&& typeof ...retry ===
// 'function'` do `_renderNotice`, o `report` de `_handleMapError` continuar existindo, e cada uma
// das seis chamadas que o bloco 8 nomeia.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { FAILURE_COALESCE_MS, getLayerFailureNotice } =
    await import('../../src/js/terrain/layer-failure-notice.js');
const {
    SURFACE_NOUN, layerDisplayName, layerLoadFailureNotice,
    layerRetryStillFailingNotice, loadFailureHeadline,
} = await import('../../src/js/terrain/data-layer-phrases.js');
const { model3dFailures, statusOfCesiumTileFailure, MODEL_3D_SURFACE } =
    await import('../../src/js/3d_models_viewer_tool/model3d-failure.js');
const { photo360Failures, PHOTO_360_SURFACE } =
    await import('../../src/js/street_view_tool/photo360-failure.js');

// ---------------------------------------------------------------------------
// Duplos (mesmo molde de aviso-de-camada-que-nao-carrega.test.js)
// ---------------------------------------------------------------------------

/** Elemento minimo: so o que `_ensureNotice` e `_renderNotice` tocam. */
function makeElement(tagName) {
    const el = {
        tagName,
        className: '',
        textContent: '',
        type: '',
        hidden: false,
        dataset: {},
        attributes: {},
        children: [],
        parentNode: null,
        _listeners: {},
        setAttribute(name, value) { el.attributes[name] = value; },
        getAttribute(name) { return el.attributes[name]; },
        appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
        append(...kids) { for (const kid of kids) el.appendChild(kid); },
        addEventListener(type, handler) {
            (el._listeners[type] = el._listeners[type] || []).push(handler);
        },
        removeEventListener(type, handler) {
            const bucket = el._listeners[type];
            if (!bucket) return;
            const i = bucket.indexOf(handler);
            if (i >= 0) bucket.splice(i, 1);
        },
        click() { for (const handler of (el._listeners.click || []).slice()) handler(); },
        remove() {
            if (!el.parentNode) return;
            const i = el.parentNode.children.indexOf(el);
            if (i >= 0) el.parentNode.children.splice(i, 1);
            el.parentNode = null;
        },
    };
    return el;
}

/** Todos os descendentes com um `data-testid`, em profundidade. */
function allByTestId(root, testid) {
    const found = [];
    const walk = (node) => {
        if (node.dataset?.testid === testid) found.push(node);
        for (const child of node.children || []) walk(child);
    };
    walk(root);
    return found;
}

/**
 * O UNICO no com aquele `data-testid`, falhando alto quando ele sumiu ou duplicou.
 * Pegar o primeiro ficaria verde com dois paineis na tela, que e um dos defeitos que o painel
 * unico existe para impedir.
 */
function unico(root, testid) {
    const found = allByTestId(root, testid);
    expect(found.length, `esperado UM no com data-testid="${testid}", achados ${found.length}`).toBe(1);
    return found[0];
}

/** Mapa duplo: so o estilo e o barramento de eventos que o aviso escuta. */
function makeMap() {
    const handlers = {};
    const container = makeElement('div');
    return {
        container,
        styleSources: {},
        getContainer() { return container; },
        getStyle() { return { sources: this.styleSources }; },
        on(type, handler) { (handlers[type] = handlers[type] || []).push(handler); },
        off(type, handler) {
            const bucket = handlers[type];
            if (!bucket) return;
            const i = bucket.indexOf(handler);
            if (i >= 0) bucket.splice(i, 1);
        },
        emit(type, event) { for (const handler of (handlers[type] || []).slice()) handler(event); },
    };
}

let map;
let originalDocument;
let retryCalls;

/** Uma superficie de CAMADA como as duas reais (dado e analise): resolve `sourceId` e retenta. */
function registrarCamadas() {
    getLayerFailureNotice(map).registerSurface('data', {
        resolveLayerId: (sourceId) => (sourceId === 'data-molduras' ? 'molduras' : null),
        layerName: () => 'Molduras',
        isVisible: () => true,
        retry: (layerId) => retryCalls.push(layerId),
    });
}

/** Um `error` do MapLibre no formato medido no bundle vendorizado. */
function falhaDeTile(sourceId, status) {
    map.emit('error', { sourceId, error: status === undefined ? {} : { status } });
}

function passaARajada() {
    vi.advanceTimersByTime(FAILURE_COALESCE_MS);
}

function mensagem() {
    return unico(map.container, 'camada-inacessivel-mensagem').textContent;
}

function detalhe() {
    return unico(map.container, 'camada-inacessivel-detalhe').textContent;
}

function aviso() {
    return unico(map.container, 'camada-inacessivel-aviso');
}

beforeEach(() => {
    originalDocument = globalThis.document;
    globalThis.document = { createElement: makeElement };
    vi.useFakeTimers();
    retryCalls = [];
    map = makeMap();
});

afterEach(() => {
    // Os dois reporters sao SINGLETONS de modulo: sem isto o mapa de um caso vaza para o proximo.
    model3dFailures.detach();
    photo360Failures.detach();
    vi.useRealTimers();
    globalThis.document = originalDocument;
});

// ---------------------------------------------------------------------------
// 1. Concordancia
// ---------------------------------------------------------------------------

describe('a concordancia de cada substantivo', () => {
    it('o modelo 3D e MASCULINO, e a frase feminina unica mentiria sobre ele', () => {
        expect(layerLoadFailureNotice(['Comando'], SURFACE_NOUN.MODELO_3D))
            .toBe('O modelo 3D "Comando" não pôde ser carregado.');
        expect(layerLoadFailureNotice(['A', 'B'], SURFACE_NOUN.MODELO_3D))
            .toBe('2 modelos 3D não puderam ser carregados: "A" e "B".');
        expect(layerRetryStillFailingNotice(['Comando'], SURFACE_NOUN.MODELO_3D))
            .toBe('O modelo 3D "Comando" continua sem carregar após a nova tentativa.');
    });

    it('a foto 360 e FEMININA e traz o grau', () => {
        expect(layerLoadFailureNotice(['IMG_0031'], SURFACE_NOUN.FOTO_360))
            .toBe('A foto 360° "IMG_0031" não pôde ser carregada.');
        expect(layerLoadFailureNotice(['A', 'B', 'C'], SURFACE_NOUN.FOTO_360))
            .toBe('3 fotos 360° não puderam ser carregadas: "A", "B" e "C".');
    });

    it('a camada continua exatamente como era: nenhum chamador antigo muda de frase', () => {
        expect(layerLoadFailureNotice(['Molduras']))
            .toBe('A camada "Molduras" não pôde ser carregada.');
        expect(layerDisplayName(null)).toBe('Camada sem nome');
    });

    it('o ultimo recurso do nome tambem concorda, em vez de chamar tudo de camada', () => {
        expect(layerDisplayName('', SURFACE_NOUN.MODELO_3D)).toBe('Modelo 3D sem nome');
        expect(layerDisplayName(null, SURFACE_NOUN.FOTO_360)).toBe('Foto 360° sem nome');
    });

    it('a ordem das frases e fixa, e nao a ordem em que falharam', () => {
        const headline = loadFailureHeadline({
            groups: [
                { noun: SURFACE_NOUN.FOTO_360, names: ['F'] },
                { noun: SURFACE_NOUN.MODELO_3D, names: ['M'] },
                { noun: SURFACE_NOUN.CAMADA, names: ['C'] },
            ],
        });
        expect(headline).toBe(
            'A camada "C" não pôde ser carregada. '
            + 'O modelo 3D "M" não pôde ser carregado. '
            + 'A foto 360° "F" não pôde ser carregada.'
        );
    });

    it('nada falhando continua sendo frase vazia, para nao existir aviso sobre nada', () => {
        expect(loadFailureHeadline({ groups: [{ noun: SURFACE_NOUN.MODELO_3D, names: [] }] })).toBe('');
    });
});

// ---------------------------------------------------------------------------
// 2, 3 e 4. O painel
// ---------------------------------------------------------------------------

describe('o modelo 3D acusa no painel do mapa', () => {
    it('acusa sem `sourceId` nenhum, e o painel nasce UM so', () => {
        model3dFailures.attach(map);
        expect(model3dFailures.report('t1', { name: 'Comando', status: 404 })).toBe(true);
        passaARajada();

        expect(mensagem()).toBe('O modelo 3D "Comando" não pôde ser carregado.');
        expect(aviso().hidden).toBe(false);
    });

    it('o detalhe imprime o codigo observado e NAO o interpreta', () => {
        model3dFailures.attach(map);
        model3dFailures.report('t1', { name: 'Comando', status: 403 });
        passaARajada();

        expect(detalhe()).toContain('O servidor respondeu 403.');
        expect(detalhe()).toContain('não é conhecido daqui');
        expect(detalhe()).not.toMatch(/você não tem acesso/i);
    });

    it('o botao de tentar de novo NAO se desenha: pedir de novo seria reabrir o visualizador', () => {
        model3dFailures.attach(map);
        model3dFailures.report('t1', { name: 'Comando' });
        passaARajada();

        expect(unico(map.container, 'camada-inacessivel-tentar-de-novo').hidden).toBe(true);
    });

    it('sem mapa atacado nao acusa e nao explode: a falha e o pior momento para um segundo erro', () => {
        expect(model3dFailures.isAttached()).toBe(false);
        expect(model3dFailures.report('t1', { name: 'Comando' })).toBe(false);
        expect(() => model3dFailures.clear('t1')).not.toThrow();
        expect(allByTestId(map.container, 'camada-inacessivel-aviso')).toHaveLength(0);
    });

    it('camada e modelo juntos: UM painel, DUAS frases, os dois codigos numa linha so', () => {
        registrarCamadas();
        model3dFailures.attach(map);
        falhaDeTile('data-molduras', 403);
        falhaDeTile('data-molduras', 403);
        model3dFailures.report('t1', { name: 'Comando', status: 404 });
        passaARajada();

        expect(mensagem()).toBe(
            'A camada "Molduras" não pôde ser carregada. '
            + 'O modelo 3D "Comando" não pôde ser carregado.'
        );
        expect(detalhe()).toContain('O servidor respondeu 403, 404.');
    });

    it('a retirada e por superficie: cada uma sai sozinha e deixa a outra de pe', () => {
        registrarCamadas();
        model3dFailures.attach(map);
        falhaDeTile('data-molduras', 403);
        model3dFailures.report('t1', { name: 'Comando' });
        passaARajada();

        model3dFailures.clear('t1');
        expect(mensagem()).toBe('A camada "Molduras" não pôde ser carregada.');
        expect(aviso().hidden).toBe(false);

        map.emit('sourcedata', { sourceId: 'data-molduras', isSourceLoaded: true });
        expect(aviso().hidden).toBe(true);
    });

    it('devolver a superficie leva junto o que ela acusava', () => {
        registrarCamadas();
        model3dFailures.attach(map);
        falhaDeTile('data-molduras', 403);
        model3dFailures.report('t1', { name: 'Comando' });
        passaARajada();

        model3dFailures.detach();
        expect(mensagem()).toBe('A camada "Molduras" não pôde ser carregada.');
    });

    it('a foto 360 usa a mesma porta e o mesmo painel', () => {
        photo360Failures.attach(map);
        photo360Failures.report('IMG_0031', { name: 'IMG_0031', status: 403 });
        passaARajada();

        expect(mensagem()).toBe('A foto 360° "IMG_0031" não pôde ser carregada.');
    });

    it('as duas chaves de superficie sao distintas, senao uma apagaria a outra', () => {
        expect(MODEL_3D_SURFACE).not.toBe(PHOTO_360_SURFACE);
    });
});

// ---------------------------------------------------------------------------
// 5 e 6. Os dois invariantes que nasceram com a mudanca
// ---------------------------------------------------------------------------

describe('o que um estilo novo absolve, e o que ele nao absolve', () => {
    it('`style.load` derruba a camada e NAO derruba o modelo 3D', () => {
        registrarCamadas();
        model3dFailures.attach(map);
        falhaDeTile('data-molduras', 403);
        model3dFailures.report('t1', { name: 'Comando' });
        passaARajada();

        map.emit('style.load');

        // A camada esta sendo pedida de novo agora; o modelo 3D nao esta.
        expect(mensagem()).toBe('O modelo 3D "Comando" não pôde ser carregado.');
        expect(aviso().hidden).toBe(false);
    });

    it('so o 3D acusado: `style.load` deixa o painel de pe em vez de esconder', () => {
        model3dFailures.attach(map);
        model3dFailures.report('t1', { name: 'Comando' });
        passaARajada();

        map.emit('style.load');
        expect(aviso().hidden).toBe(false);
        expect(mensagem()).toBe('O modelo 3D "Comando" não pôde ser carregado.');
    });
});

describe('a nova tentativa e por grupo', () => {
    it('retentar as camadas nao faz o modelo 3D dizer que foi retentado', () => {
        registrarCamadas();
        model3dFailures.attach(map);
        falhaDeTile('data-molduras', 403);
        model3dFailures.report('t1', { name: 'Comando' });
        passaARajada();

        unico(map.container, 'camada-inacessivel-tentar-de-novo').click();

        expect(retryCalls).toEqual(['molduras']);
        // A camada saiu da lista (esta sendo pedida de novo) e o modelo continua acusado, com a
        // frase do PRIMEIRO desfecho: ninguem pediu este modelo de novo.
        expect(mensagem()).toBe('O modelo 3D "Comando" não pôde ser carregado.');
        expect(mensagem()).not.toContain('nova tentativa');
    });

    it('a camada que falha DE NOVO continua dizendo que foi retentada', () => {
        registrarCamadas();
        model3dFailures.attach(map);
        falhaDeTile('data-molduras', 403);
        passaARajada();
        unico(map.container, 'camada-inacessivel-tentar-de-novo').click();
        falhaDeTile('data-molduras', 403);
        passaARajada();

        expect(mensagem()).toBe('A camada "Molduras" continua sem carregar após a nova tentativa.');
    });
});

// ---------------------------------------------------------------------------
// 7. O status dentro da prosa do Cesium
// ---------------------------------------------------------------------------

describe('statusOfCesiumTileFailure', () => {
    it('le o formato medido no bundle vendorizado', () => {
        expect(statusOfCesiumTileFailure('Request has failed. Status Code: 403')).toBe(403);
        expect(statusOfCesiumTileFailure('Request has failed. Status Code: 404')).toBe(404);
        expect(statusOfCesiumTileFailure('Request has failed. Status Code: 500')).toBe(500);
    });

    it('sem resposta nao inventa codigo, que e o caso da rede caida', () => {
        expect(statusOfCesiumTileFailure('Request has failed.')).toBeNull();
        expect(statusOfCesiumTileFailure('Failed to load: https://x/0/0/0.b3dm')).toBeNull();
        expect(statusOfCesiumTileFailure(undefined)).toBeNull();
        expect(statusOfCesiumTileFailure(null)).toBeNull();
        expect(statusOfCesiumTileFailure({})).toBeNull();
        expect(statusOfCesiumTileFailure('Status Code: 99')).toBeNull();
    });

    it('um codigo lido NAO e interpretado, so impresso', () => {
        const status = statusOfCesiumTileFailure('Request has failed. Status Code: 403');
        expect(layerLoadFailureNotice(['Comando'], SURFACE_NOUN.MODELO_3D))
            .not.toContain(String(status));
    });
});

// ---------------------------------------------------------------------------
// 8. Os sitios
// ---------------------------------------------------------------------------

describe('os sitios da acusacao existem onde a falha acontece', () => {
    const fonte = (rel) => readFileSync(
        fileURLToPath(new URL(`../../src/js/${rel}`, import.meta.url)), 'utf8'
    );

    it('os dois controles ligam a superficie ao mapa em `onAdd` e a devolvem em `onRemove`', () => {
        const modelos = fonte('3d_models_viewer_tool/add_3d_models_viewer_control.js');
        expect(modelos).toContain('model3dFailures.attach(map);');
        expect(modelos).toContain('model3dFailures.detach();');

        const streetview = fonte('street_view_tool/add_street_view_control.js');
        expect(streetview).toContain('photo360Failures.attach(map);');
        expect(streetview).toContain('photo360Failures.detach();');
    });

    it('o 3D acusa nos DOIS caminhos: o documento raiz e o filho que nao chega', () => {
        const map3d = fonte('3d_models_viewer_tool/map_3d.js');
        // O filho: unico canal do modelo que abre vazio sem rejeitar promessa nenhuma.
        expect(map3d).toMatch(/tileset\.tileFailed\.addEventListener\(/);
        expect(map3d).toMatch(/reportModel3dFailure\(tilesetConfig, statusOfCesiumTileFailure\(/);
        // A raiz: o `catch` por onde passam as quatro portas do visualizador.
        expect(map3d).toMatch(/reportModel3dFailure\(\s*config\.tilesets/);
        // E a retirada, no ponto em que se pede de novo.
        expect(map3d).toContain('model3dFailures.clear(tilesetId);');
    });

    it('o 360 acusa e retira dentro de `loadPhoto`, por onde passam abrir e navegar', () => {
        const viewer = fonte('street_view_tool/street_view_viewer.js');
        expect(viewer).toContain('photo360Failures.clear(photoName);');
        expect(viewer).toMatch(/photo360Failures\.report\(photoName, \{/);
        // AS DUAS METADES que podem falhar chamam o mesmo anunciante, e cada uma e cobrada pela
        // sua forma: a do metadado ainda nao tem metadado nenhum para nomear a foto, a da
        // textura tem. Contar as ocorrencias do nome ficaria verde com as duas no mesmo ramo.
        expect(viewer).toContain('anunciarFalhaDaFoto(photoName, null, error);');
        expect(viewer).toContain('anunciarFalhaDaFoto(photoName, data, error);');
    });

    it('o status viaja como CAMPO nos dois pedidos do 360, e nao so dentro da frase', () => {
        // Tiles-only (2026-08-29): os DOIS pedidos de rede do 360 sao o METADADO
        // (streetview-api.service) e o TILES.JSON (tile-loader). A rota de imagem inteira
        // saiu, e com ela o fetch de blob do proprio visualizador que carimbava o status.
        expect(fonte('street_view_tool/streetview-api.service.js')).toContain('error.status = response.status;');
        expect(fonte('street_view_tool/tile-loader.js')).toContain('erro.status = resposta.status;');
    });
});
