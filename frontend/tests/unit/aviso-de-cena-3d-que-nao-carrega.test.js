// Path: tests/unit/aviso-de-cena-3d-que-nao-carrega.test.js
//
// A SEXTA SUPERFICIE: a cena 3D de primeira pessoa (Gaussian splatting), o TERCEIRO visualizador
// que baixa os proprios bytes e, ate 2026-08-24, o unico dos tres que ainda falhava calado.
//
// O DEFEITO MEDIDO. `openFirstPersonScene` (`3d_models_viewer_tool/add_3d_models_viewer_control.js`)
// tinha por tratamento de erro `console.error('Error opening first-person viewer:', error)` e mais
// nada; e o proprio `doOpenFirstPersonViewer` NAO propaga: ele engole a falha de carga, mostra um
// toast literal e retorna. Ou seja, quem clicava em "Entrar na cena" e nao entrava recebia um
// toast de sete palavras, sem nome de cena, sem codigo do servidor, e o mapa nao guardava nada.
//
// O QUE CADA BLOCO PROVA, E O QUE ELE NAO PROVA:
//
//  1. CONCORDANCIA. Prova que "cena 3D" e FEMININA nas quatro formas e que ela nao e "modelo 3D":
//     as duas moram na mesma lista (`config.tilesets`) e sao coisas diferentes no catalogo
//     ("Cenas 3D" contra "Modelos 3D"). NAO prova redacao.
//  2. A SUPERFICIE. Prova que ela acusa sem `sourceId` nenhum, que o painel e UM so, que o codigo
//     medido sai impresso sem interpretacao e que o botao de tentar de novo NAO se desenha (pedir
//     de novo seria reabrir o visualizador, que e navegacao). Prova tambem que a chave dela e
//     distinta das outras duas, senao uma apagaria a acusacao da outra.
//  3. O ESTILO NOVO NAO ABSOLVE A CENA, que e o invariante do `rebuiltByStyle: false`: trocar de
//     mapa base nao pede a cena de novo. (O controle negativo DAQUELA propriedade mora no arquivo
//     irmao, `aviso-de-3d-e-360-que-nao-carregam.test.js`, bloco 5, porque a propriedade e da
//     fabrica compartilhada e nao deste modulo.)
//  4. PAINEL E TOAST NAO DIVERGEM. Prova que a frase do toast e a MESMA que o painel escreve, por
//     construcao e nao por coincidencia de redacao: as duas saem de `layerLoadFailureNotice` com o
//     mesmo substantivo.
//  5. OS SITIOS. Prova, POR ESTRUTURA, que as chamadas existem onde a falha acontece. E teste de
//     fonte e vale so o que teste de fonte vale: prende o SITIO, que e o que nenhum teste de
//     comportamento alcanca aqui (o motor de splatting nao carrega em node, e o modulo do
//     visualizador importa `@manycore/aholo-viewer` na primeira linha). Os padroes sao expressoes
//     de chamada, nao palavras soltas.
//  6. O STATUS E OBSERVAVEL, e este e o achado que separa esta superficie da do Cesium: o splat e
//     baixado por um `fetch` NOSSO, entao o codigo vem de `Response.status` e viaja como CAMPO do
//     erro. Nada de ler numero de dentro de prosa (`statusOfCesiumTileFailure`).
//
// CONTROLE NEGATIVO, conferido caso a caso (cada reversao deixa VERMELHO o `it` nomeado): o
// `noun` de `createLoaderFailureSurface` em `scene3d-failure.js`, a entrada `CENA_3D` da
// `NOUN_TABLE`, a chave `SCENE_3D_SURFACE`, o `erro.status = response.status`, e cada uma das
// cinco chamadas que o bloco 5 nomeia (attach, detach, report do controle, report do
// visualizador, clear do visualizador).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { FAILURE_COALESCE_MS, getLayerFailureNotice } =
    await import('../../src/js/terrain/layer-failure-notice.js');
const {
    SURFACE_NOUN, layerDisplayName, layerLoadFailureNotice,
    layerRetryStillFailingNotice, loadFailureHeadline,
} = await import('../../src/js/terrain/data-layer-phrases.js');
const { scene3dFailures, scene3dLoadFailureMessage, SCENE_3D_SURFACE } =
    await import('../../src/js/first_person_3d_tool/scene3d-failure.js');
const { MODEL_3D_SURFACE } = await import('../../src/js/3d_models_viewer_tool/model3d-failure.js');
const { PHOTO_360_SURFACE } = await import('../../src/js/street_view_tool/photo360-failure.js');
const { requestStatus } = await import('../../src/js/utilities/request-failure.js');

// ---------------------------------------------------------------------------
// Duplos (mesmo molde de aviso-de-3d-e-360-que-nao-carregam.test.js)
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

/** O UNICO no com aquele `data-testid`, falhando alto quando ele sumiu ou duplicou. */
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
    // O reporter e SINGLETON de modulo: sem isto o mapa de um caso vaza para o proximo.
    scene3dFailures.detach();
    vi.useRealTimers();
    globalThis.document = originalDocument;
});

// ---------------------------------------------------------------------------
// 1. Concordancia
// ---------------------------------------------------------------------------

describe('a concordancia da cena 3D', () => {
    it('a cena 3D e FEMININA, e nao herda o masculino do modelo que mora na mesma lista', () => {
        expect(layerLoadFailureNotice(['Museu'], SURFACE_NOUN.CENA_3D))
            .toBe('A cena 3D "Museu" não pôde ser carregada.');
        expect(layerLoadFailureNotice(['A', 'B'], SURFACE_NOUN.CENA_3D))
            .toBe('2 cenas 3D não puderam ser carregadas: "A" e "B".');
        expect(layerRetryStillFailingNotice(['Museu'], SURFACE_NOUN.CENA_3D))
            .toBe('A cena 3D "Museu" continua sem carregar após a nova tentativa.');
    });

    it('a queda sem nome usa a palavra do catalogo, e nao "camada"', () => {
        expect(layerDisplayName('', SURFACE_NOUN.CENA_3D)).toBe('Cena 3D sem nome');
        expect(layerDisplayName(null, SURFACE_NOUN.CENA_3D)).toBe('Cena 3D sem nome');
    });

    it('cena e modelo sao substantivos DISTINTOS: uma frase so os fundiria numa contagem falsa', () => {
        const headline = loadFailureHeadline({
            groups: [
                { noun: SURFACE_NOUN.CENA_3D, names: ['Museu'] },
                { noun: SURFACE_NOUN.MODELO_3D, names: ['Comando'] },
            ],
        });
        expect(headline).toBe(
            'O modelo 3D "Comando" não pôde ser carregado. '
            + 'A cena 3D "Museu" não pôde ser carregada.'
        );
        expect(headline).not.toContain('2 ');
    });

    it('a ordem das frases continua fixa com quatro substantivos, e nao a ordem da falha', () => {
        expect(loadFailureHeadline({
            groups: [
                { noun: SURFACE_NOUN.FOTO_360, names: ['F'] },
                { noun: SURFACE_NOUN.CENA_3D, names: ['S'] },
                { noun: SURFACE_NOUN.MODELO_3D, names: ['M'] },
                { noun: SURFACE_NOUN.CAMADA, names: ['C'] },
            ],
        })).toBe(
            'A camada "C" não pôde ser carregada. '
            + 'O modelo 3D "M" não pôde ser carregado. '
            + 'A cena 3D "S" não pôde ser carregada. '
            + 'A foto 360° "F" não pôde ser carregada.'
        );
    });

    it('nenhum chamador antigo muda de frase por causa do substantivo novo', () => {
        expect(layerLoadFailureNotice(['Molduras']))
            .toBe('A camada "Molduras" não pôde ser carregada.');
        expect(layerLoadFailureNotice(['Comando'], SURFACE_NOUN.MODELO_3D))
            .toBe('O modelo 3D "Comando" não pôde ser carregado.');
    });
});

// ---------------------------------------------------------------------------
// 2. A superficie no painel
// ---------------------------------------------------------------------------

describe('a cena 3D acusa no painel do mapa', () => {
    it('acusa sem `sourceId` nenhum, e o painel nasce UM so', () => {
        scene3dFailures.attach(map);
        expect(scene3dFailures.report('cena-museu', { name: 'Museu', status: 403 })).toBe(true);
        passaARajada();

        expect(mensagem()).toBe('A cena 3D "Museu" não pôde ser carregada.');
        expect(aviso().hidden).toBe(false);
    });

    it('o detalhe imprime o codigo observado e NAO o interpreta', () => {
        scene3dFailures.attach(map);
        scene3dFailures.report('cena-museu', { name: 'Museu', status: 403 });
        passaARajada();

        expect(detalhe()).toContain('O servidor respondeu 403.');
        expect(detalhe()).toContain('não é conhecido daqui');
        expect(detalhe()).not.toMatch(/você não tem acesso/i);
    });

    it('sem codigo nenhum (o chunk que nao chegou) o painel nao inventa numero', () => {
        scene3dFailures.attach(map);
        scene3dFailures.report('cena-museu', { name: 'Museu' });
        passaARajada();

        expect(detalhe()).not.toMatch(/respondeu/);
        expect(mensagem()).toBe('A cena 3D "Museu" não pôde ser carregada.');
    });

    it('sem nome nenhum a frase ainda existe, com a palavra do catalogo', () => {
        scene3dFailures.attach(map);
        scene3dFailures.report('cena-museu', {});
        passaARajada();

        expect(mensagem()).toBe('A cena 3D "Cena 3D sem nome" não pôde ser carregada.');
    });

    it('o botao de tentar de novo NAO se desenha: pedir de novo seria reabrir o visualizador', () => {
        scene3dFailures.attach(map);
        scene3dFailures.report('cena-museu', { name: 'Museu' });
        passaARajada();

        expect(unico(map.container, 'camada-inacessivel-tentar-de-novo').hidden).toBe(true);
    });

    it('sem mapa atacado nao acusa e nao explode: a falha e o pior momento para um segundo erro', () => {
        expect(scene3dFailures.isAttached()).toBe(false);
        expect(scene3dFailures.report('cena-museu', { name: 'Museu' })).toBe(false);
        expect(() => scene3dFailures.clear('cena-museu')).not.toThrow();
        expect(allByTestId(map.container, 'camada-inacessivel-aviso')).toHaveLength(0);
    });

    it('camada e cena juntas: UM painel, DUAS frases, os dois codigos numa linha so', () => {
        registrarCamadas();
        scene3dFailures.attach(map);
        falhaDeTile('data-molduras', 403);
        scene3dFailures.report('cena-museu', { name: 'Museu', status: 404 });
        passaARajada();

        expect(mensagem()).toBe(
            'A camada "Molduras" não pôde ser carregada. '
            + 'A cena 3D "Museu" não pôde ser carregada.'
        );
        expect(detalhe()).toContain('O servidor respondeu 403, 404.');
    });

    it('a retirada e por cena: reabrir uma nao absolve a outra', () => {
        scene3dFailures.attach(map);
        scene3dFailures.report('cena-museu', { name: 'Museu' });
        scene3dFailures.report('cena-quartel', { name: 'Quartel' });
        passaARajada();

        scene3dFailures.clear('cena-museu');
        expect(mensagem()).toBe('A cena 3D "Quartel" não pôde ser carregada.');
        expect(aviso().hidden).toBe(false);

        scene3dFailures.clear('cena-quartel');
        expect(aviso().hidden).toBe(true);
    });

    it('as tres chaves de superficie de visualizador sao distintas, senao uma apagaria a outra', () => {
        expect(new Set([SCENE_3D_SURFACE, MODEL_3D_SURFACE, PHOTO_360_SURFACE]).size).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// 3. O estilo novo nao absolve a cena
// ---------------------------------------------------------------------------

describe('o que um estilo novo absolve, e o que ele nao absolve', () => {
    it('`style.load` derruba a camada e NAO derruba a cena 3D', () => {
        registrarCamadas();
        scene3dFailures.attach(map);
        falhaDeTile('data-molduras', 403);
        scene3dFailures.report('cena-museu', { name: 'Museu' });
        passaARajada();

        map.emit('style.load');

        // A camada esta sendo pedida de novo agora; a cena nao esta: trocar de mapa base nao
        // reabre visualizador nenhum.
        expect(mensagem()).toBe('A cena 3D "Museu" não pôde ser carregada.');
        expect(aviso().hidden).toBe(false);
    });

    it('retentar as camadas nao faz a cena dizer que foi retentada', () => {
        registrarCamadas();
        scene3dFailures.attach(map);
        falhaDeTile('data-molduras', 403);
        scene3dFailures.report('cena-museu', { name: 'Museu' });
        passaARajada();

        unico(map.container, 'camada-inacessivel-tentar-de-novo').click();

        expect(retryCalls).toEqual(['molduras']);
        expect(mensagem()).toBe('A cena 3D "Museu" não pôde ser carregada.');
        expect(mensagem()).not.toContain('nova tentativa');
    });
});

// ---------------------------------------------------------------------------
// 4. Painel e toast nao divergem
// ---------------------------------------------------------------------------

describe('a frase do toast e a frase do painel', () => {
    it('sao a MESMA sentenca, por construcao: as duas saem do mesmo construtor', () => {
        scene3dFailures.attach(map);
        scene3dFailures.report('cena-museu', { name: 'Museu' });
        passaARajada();

        expect(scene3dLoadFailureMessage('Museu')).toBe(mensagem());
    });

    it('o toast tambem cai na palavra do catalogo quando a cena nao tem nome', () => {
        expect(scene3dLoadFailureMessage(undefined))
            .toBe('A cena 3D "Cena 3D sem nome" não pôde ser carregada.');
    });
});

// ---------------------------------------------------------------------------
// 5. Os sitios
// ---------------------------------------------------------------------------

describe('os sitios da acusacao existem onde a falha acontece', () => {
    const fonte = (rel) => readFileSync(
        fileURLToPath(new URL(`../../src/js/${rel}`, import.meta.url)), 'utf8'
    );

    it('o controle liga a superficie ao mapa em `onAdd` e a devolve em `onRemove`', () => {
        const controle = fonte('3d_models_viewer_tool/add_3d_models_viewer_control.js');
        expect(controle).toContain('scene3dFailures.attach(map);');
        expect(controle).toContain('scene3dFailures.detach();');
    });

    it('o `catch` do controle, que era so um console.error, acusa o chunk que nao chegou', () => {
        const controle = fonte('3d_models_viewer_tool/add_3d_models_viewer_control.js');
        expect(controle).toMatch(/scene3dFailures\.report\(sceneId, \{ name: this\._sceneName\(sceneId\) \}\)/);
    });

    it('o visualizador acusa no `catch` da carga, que e por onde passam as QUATRO portas', () => {
        const viewer = fonte('first_person_3d_tool/first_person_viewer.js');
        expect(viewer).toMatch(
            /scene3dFailures\.report\(sceneId, \{ name: scene\.name, status: requestStatus\(error\) \}\)/
        );
    });

    it('e retira a acusacao no ponto em que a cena e pedida de novo', () => {
        expect(fonte('first_person_3d_tool/first_person_viewer.js'))
            .toContain('scene3dFailures.clear(sceneId);');
    });

    it('o toast do visualizador sai do construtor compartilhado, e nao de um literal', () => {
        const viewer = fonte('first_person_3d_tool/first_person_viewer.js');
        expect(viewer).toContain('showError(scene3dLoadFailureMessage(scene.name));');
        expect(viewer).not.toContain("showError('Erro ao carregar a cena 3D')");
    });

    it('o modulo da superficie NAO arrasta o motor lazy para o payload do controle', () => {
        const modulo = fonte('first_person_3d_tool/scene3d-failure.js');
        // O controle e eager; um import do motor aqui puxaria ~1,9 MB de splatting para ele. A
        // assercao e sobre os IMPORTS e nao sobre o texto do arquivo, senao o proprio cabecalho,
        // que explica por que o motor nao entra, satisfaria a busca ao dize-lo.
        const imports = [...modulo.matchAll(/^import .*from '([^']+)';$/gm)].map(m => m[1]);
        expect(imports).toEqual([
            '@js/terrain/layer-failure-notice.js',
            '@js/terrain/data-layer-phrases.js',
        ]);
        // Nenhuma outra forma de import (lateral, multilinha) escondendo um terceiro alvo.
        expect(modulo.match(/from '/g)).toHaveLength(imports.length);
    });
});

// ---------------------------------------------------------------------------
// 6. O status observavel
// ---------------------------------------------------------------------------

describe('o status do splat viaja como CAMPO, e nao dentro da prosa', () => {
    it('o `fetch` do splat carimba `status` no erro, que e o que `requestStatus` le', () => {
        expect(fonte3d()).toContain('erro.status = response.status;');
    });

    it('um erro carimbado assim entrega o codigo; um erro so com o numero no texto nao entrega', () => {
        const carimbado = new Error('HTTP 403 em https://x/cena/scene.sog');
        carimbado.status = 403;
        expect(requestStatus(carimbado)).toBe(403);

        // O que existia antes: o numero so na mensagem, invisivel para quem le o campo.
        expect(requestStatus(new Error('HTTP 403 em https://x/cena/scene.sog'))).toBeNull();
    });

    it('sem resposta nenhuma (rede caida, chunk ausente) nao ha codigo, e isso e honesto', () => {
        expect(requestStatus(new TypeError('Failed to fetch'))).toBeNull();
        expect(requestStatus(undefined)).toBeNull();
    });

    function fonte3d() {
        return readFileSync(
            fileURLToPath(new URL('../../src/js/first_person_3d_tool/first_person_viewer.js', import.meta.url)),
            'utf8'
        );
    }
});
