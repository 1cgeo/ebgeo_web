// Path: tests/unit/colar-nao-anuncia-sucesso-recusado.repro.test.js
// REPRO: "3 feição(ões) colada(s) com sucesso" sobre uma escrita que a store RECUSOU.
//
// ================= A CADEIA, MEDIDA ==========================================
//
// Um Leitor num atlas de servidor recebia "Duplicar Seleção" no menu do mapa (`_addDefaultOptions`
// consultava `hasSelected` e `locked`, e permissão NENHUMA). O item chamava `copy()` + `paste()`.
// `paste()` não tinha gate de papel, então fazia o trabalho inteiro — cunhava ids, duplicava blobs
// de imagem, gerava nomes — e chamava `addFeatures`, cujo `guardWrite(CREATE_FEATURE)` recusa e
// devolve `undefined` EM SILÊNCIO. Nada lia esse retorno. A colagem seguia para `updateMapSources`,
// `autoSelectPastedFeatures` e terminava em `ToastService.showSuccess`, lado a lado com o toast de
// recusa que `store-error-listener.js` já estava mostrando. No F5 as feições sumiam.
//
// Duas mensagens contraditórias na mesma tela é pior que uma mensagem errada: a pessoa acredita na
// que confirma o que ela quis fazer.
//
// ================= O QUE ESTE ARQUIVO PRENDE =================================
//
// Que `paste()` recuse ANTES do trabalho e DEVOLVA a contagem. Ele exercita a função de verdade,
// com a store, o toast e as ferramentas dubladas: o sujeito é a ORDEM das decisões dentro de
// `paste()`, não a store.
//
// O CONTROLE NEGATIVO É OBRIGATÓRIO AQUI e está logo abaixo de cada recusa: um `paste()` que
// recusasse SEMPRE passaria em todas as asserções de ausência. O caso "com permissão e sem trava"
// é o que prova que o verde tem conteúdo.
//
// O que ele NÃO alcança: que o MENU consulte a mesma permissão (isso é
// `menu-de-clipboard-por-estado.test.js` mais o Playwright), e que a frase da trava apareça na tela
// (quem a diz é `store-error-listener.js`, e aqui só se afirma que o evento sai com o `reason`
// certo).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// OS DUBLÊS
// ---------------------------------------------------------------------------

const addFeatures = vi.fn(async () => {});
const emitStoreError = vi.fn();
let mapaTravado = false;
let clipboard = { features: [], copiedAt: null, sourceMapName: 'Principal' };

vi.mock('@store', () => ({
    addFeatures: (...a) => addFeatures(...a),
    getImage: vi.fn(async () => null),
    getCurrentMapNameSync: () => 'Principal',
    getStorageTypeFromSource: (source) => `${source}s`,
    getSourceTypeFromStorage: (storage) => storage.replace(/s$/, ''),
    isUncopyableFeatureType: () => false,
    hasImageResource: () => false,
    getStateManager: () => ({
        getClipboard: () => clipboard,
        hasClipboardData: () => clipboard.features.length > 0,
        setClipboard: (features, sourceMapName) => {
            clipboard = { features, copiedAt: Date.now(), sourceMapName };
        },
        clearClipboard: () => { clipboard = { features: [], copiedAt: null, sourceMapName: null }; },
    }),
    isCurrentMapLockedSync: () => mapaTravado,
    buildLayerMappingForMove: vi.fn(async () => new Map()),
    emitStoreError: (...a) => emitStoreError(...a),
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operation-blocked' },
}));

let permissao = { allowed: true };
vi.mock('@store/sync/permission-guard.js', () => ({
    checkPermission: () => permissao,
    GuardAction: { CREATE_FEATURE: 'CREATE_FEATURE' },
}));

vi.mock('@store/denial-phrases.js', () => ({
    denialNotice: (capability) => `RECUSA(${capability})`,
}));

const toasts = { success: [], warning: [], error: [] };
let proximoId = 0;
vi.mock('@utils', () => ({
    IDUtils: {
        generateUniqueId: () => `id-${++proximoId}`,
        generateGeoJSONId: () => ++proximoId,
        generateFeatureName: async () => 'Feição',
        duplicateImageResource: vi.fn(async () => {}),
    },
    ToastService: {
        showSuccess: (m) => toasts.success.push(m),
        showWarning: (m) => toasts.warning.push(m),
        showError: (m) => toasts.error.push(m),
    },
}));

vi.mock('@layers/geojson-dispatcher.js', () => ({
    getGeoJsonDispatcher: () => ({ add: vi.fn() }),
}));

vi.mock('@js/draw_tools/point_tool/point-marker-symbols.js', () => ({
    generatePointImage: () => ({}),
    needsPerFeatureImage: () => false,
}));

vi.mock('@js/draw_tools/point_tool/point-custom-icons.js', () => ({
    parseCustomMarker: () => null,
    registerCustomFeatureImage: vi.fn(async () => {}),
}));

const ClipboardManager = (await import('../../src/js/tool_manager/clipboard_manager.js')).default;

// ---------------------------------------------------------------------------
// O SUJEITO
// ---------------------------------------------------------------------------

/** A point feature as the clipboard holds it. */
const item = (id, lng = 0, lat = 0) => ({
    type: 'point',
    feature: {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { id, source: 'point', nome: `Ponto ${id}`, layerId: 'default' },
    },
});

/** A control that pastes by adding the offset, which is what every real one does. */
const controlePonto = {
    canCopy: () => true,
    prepareForCopy: (f) => JSON.parse(JSON.stringify(f)),
    prepareForPaste: (f, offset) => ({
        ...f,
        geometry: {
            ...f.geometry,
            coordinates: [f.geometry.coordinates[0] + offset.dx, f.geometry.coordinates[1] + offset.dy],
        },
    }),
};

function montar() {
    const selectionManager = {
        controls: new Map([['point', controlePonto]]),
        ensureControlFor: vi.fn(async (type) => selectionManager.controls.get(type) ?? null),
        getAllSelectedFeatures: () => [],
        deselectAllFeatures: vi.fn(),
        toggleFeatureSelection: vi.fn(async () => {}),
        updateUI: vi.fn(),
    };
    const map = {
        getZoom: () => 12,
        getCenter: () => ({ lat: 0, lng: 0 }),
        getSource: () => null,
        hasImage: () => true,
        addImage: vi.fn(),
        removeImage: vi.fn(),
    };
    return new ClipboardManager(selectionManager, map);
}

beforeEach(() => {
    addFeatures.mockClear();
    emitStoreError.mockClear();
    toasts.success.length = 0;
    toasts.warning.length = 0;
    toasts.error.length = 0;
    permissao = { allowed: true };
    mapaTravado = false;
    proximoId = 0;
    clipboard = {
        features: [item('a', 0, 0), item('b', 1, 1), item('c', 2, 2)],
        copiedAt: Date.now(),
        sourceMapName: 'Principal',
    };
});

describe('paste() com o papel RECUSADO', () => {
    beforeEach(() => {
        permissao = { allowed: false, required: 'canEdit', action: 'CREATE_FEATURE' };
    });

    it('devolve 0 e NÃO chama addFeatures', async () => {
        const contagem = await montar().paste();

        expect(contagem).toBe(0);
        expect(addFeatures).not.toHaveBeenCalled();
    });

    it('NÃO anuncia sucesso — que é o defeito inteiro', async () => {
        await montar().paste();

        expect(toasts.success).toEqual([]);
        expect(toasts.success.join(' ')).not.toMatch(/colada/i);
    });

    it('avisa com a frase da CAPACIDADE que o gate consultou, não com um nome de papel', async () => {
        await montar().paste();

        // `denialNotice` é chaveada por `required`; qualquer coisa derivada do papel seria a
        // lista fechada que o censo por atlas proíbe.
        expect(toasts.warning).toEqual(['RECUSA(canEdit)']);
    });

    it('recusa ANTES do trabalho: nenhuma ferramenta é carregada, nenhum id é cunhado', async () => {
        // O ponto de a recusa ser a PRIMEIRA linha. Antes ela chegava depois de duplicar blobs
        // de imagem no IndexedDB, que ficavam órfãos.
        const manager = montar();
        await manager.paste();

        expect(manager.selectionManager.ensureControlFor).not.toHaveBeenCalled();
        expect(proximoId).toBe(0);
    });

    it('recusa igual quando o alvo veio do menu ("Colar Aqui"), não só no Ctrl+V', async () => {
        const contagem = await montar().paste({ targetLngLat: { lng: 10, lat: 20 } });

        expect(contagem).toBe(0);
        expect(addFeatures).not.toHaveBeenCalled();
    });

    it('CONTROLE NEGATIVO: com permissão, a mesma colagem escreve e anuncia', async () => {
        // Sem este caso, um `paste()` que recusasse sempre passaria em tudo acima.
        permissao = { allowed: true };

        const contagem = await montar().paste();

        expect(contagem).toBe(3);
        expect(addFeatures).toHaveBeenCalledTimes(1);
        expect(toasts.success).toEqual(['3 feição(ões) colada(s) com sucesso']);
        expect(toasts.warning).toEqual([]);
    });
});

describe('paste() com o mapa TRAVADO', () => {
    beforeEach(() => { mapaTravado = true; });

    it('devolve 0, não escreve, e não anuncia sucesso', async () => {
        const contagem = await montar().paste();

        expect(contagem).toBe(0);
        expect(addFeatures).not.toHaveBeenCalled();
        expect(toasts.success).toEqual([]);
    });

    it('DIZ que recusou, emitindo o mesmo evento que toda op de store emite para a trava', async () => {
        // A recusa muda era o outro metade do defeito: Ctrl+V num mapa travado não fazia nada e
        // não dizia nada, e a pessoa não tinha como aprender que o cadeado era o motivo.
        await montar().paste();

        expect(emitStoreError).toHaveBeenCalledTimes(1);
        const [evento, payload] = emitStoreError.mock.calls[0];
        expect(evento).toBe('store:operation-blocked');
        expect(payload.reason).toBe('map_locked');
    });

    it('não inventa uma frase própria: quem fala é o ouvinte da store', async () => {
        await montar().paste();
        expect(toasts.warning).toEqual([]);
        expect(toasts.error).toEqual([]);
    });

    it('CONTROLE NEGATIVO: destravado, a mesma colagem escreve e não emite bloqueio', async () => {
        mapaTravado = false;

        const contagem = await montar().paste();

        expect(contagem).toBe(3);
        expect(addFeatures).toHaveBeenCalledTimes(1);
        expect(emitStoreError).not.toHaveBeenCalled();
    });

    it('o POSTO é perguntado antes da TRAVA, porque a trava é reversível e o posto não', async () => {
        permissao = { allowed: false, required: 'canEdit' };

        await montar().paste();

        // Um Leitor num mapa travado tem de ouvir sobre o nível, não sobre o cadeado: destravar
        // não o faria escrever.
        expect(toasts.warning).toEqual(['RECUSA(canEdit)']);
        expect(emitStoreError).not.toHaveBeenCalled();
    });
});

describe('paste() com o clipboard VAZIO', () => {
    beforeEach(() => { clipboard = { features: [], copiedAt: null, sourceMapName: null }; });

    it('devolve 0 e avisa, sem escrever', async () => {
        const contagem = await montar().paste();

        expect(contagem).toBe(0);
        expect(addFeatures).not.toHaveBeenCalled();
        expect(toasts.warning).toEqual(['Nenhuma feição copiada']);
    });
});

describe('"Colar Aqui" ancora o conjunto no ponto do clique', () => {
    it('leva o CENTRO da caixa envolvente ao alvo, não a primeira feição', async () => {
        // Copiadas em (0,0), (1,1) e (2,2): centro da caixa em (1,1). Alvo (11,21) → dx 10, dy 20.
        await montar().paste({ targetLngLat: { lng: 11, lat: 21 } });

        const [porTipo] = addFeatures.mock.calls[0];
        const coordenadas = porTipo.points.map((f) => f.geometry.coordinates);
        expect(coordenadas).toEqual([[10, 20], [11, 21], [12, 22]]);
    });

    it('CONTROLE NEGATIVO: sem alvo, o deslocamento é o empurrão de 30 px de sempre', async () => {
        // Sem este caso, um `_resolvePasteOffset` que ignorasse `targetLngLat` e devolvesse
        // sempre o mesmo offset passaria no caso acima se o número coincidisse.
        await montar().paste();

        const [porTipo] = addFeatures.mock.calls[0];
        const [primeiraLng, primeiraLat] = porTipo.points[0].geometry.coordinates;
        expect(primeiraLng).not.toBe(10);
        expect(primeiraLng).toBeGreaterThan(0);
        expect(primeiraLat).toBeGreaterThan(0);
    });

    it('um conjunto sem coordenada usável cai no empurrão em vez de colar em NaN', async () => {
        clipboard = {
            features: [{
                type: 'point',
                feature: {
                    type: 'Feature',
                    id: 'x',
                    geometry: { type: 'Point', coordinates: [NaN, NaN] },
                    properties: { id: 'x', source: 'point', nome: 'X' },
                },
            }],
            copiedAt: Date.now(),
            sourceMapName: 'Principal',
        };

        await montar().paste({ targetLngLat: { lng: 5, lat: 5 } });

        const [porTipo] = addFeatures.mock.calls[0];
        // A geometria continua NaN (era NaN na origem), mas o OFFSET é finito: o teste é que
        // nada explodiu e que a colagem não foi cancelada em silêncio.
        expect(porTipo.points).toHaveLength(1);
        expect(toasts.success).toEqual(['1 feição(ões) colada(s) com sucesso']);
    });
});

describe('a trajetória temporal viaja com a feição colada', () => {
    beforeEach(() => {
        clipboard = {
            features: [{
                type: 'point',
                feature: {
                    type: 'Feature',
                    id: 'movel',
                    geometry: { type: 'Point', coordinates: [0, 0] },
                    properties: {
                        id: 'movel',
                        source: 'point',
                        nome: 'Móvel',
                        trajetoria: [{ t: 0, lng: 0, lat: 0 }, { t: 1000, lng: 1, lat: 1 }],
                        _temporalHome: [0, 0],
                    },
                },
            }],
            copiedAt: Date.now(),
            sourceMapName: 'Principal',
        };
    });

    it('translada a rota INTEIRA e o `_temporalHome` pelo mesmo delta', async () => {
        // `_temporalHome` é o que `cleanFeature` usa para reescrever a geometria de um Point na
        // entrada do repositório: deixá-lo para trás fazia a cópia aterrissar por cima da
        // original, com o toast de sucesso por cima.
        await montar().paste({ targetLngLat: { lng: 10, lat: 10 } });

        const [porTipo] = addFeatures.mock.calls[0];
        const props = porTipo.points[0].properties;

        // Centro da caixa de um único ponto em (0,0) → delta (10,10).
        expect(props.trajetoria).toEqual([
            { t: 0, lng: 10, lat: 10 },
            { t: 1000, lng: 11, lat: 11 },
        ]);
        expect(props._temporalHome).toEqual([10, 10]);
    });

    it('CONTROLE NEGATIVO: a feição de origem no clipboard não é mutada', async () => {
        await montar().paste({ targetLngLat: { lng: 10, lat: 10 } });

        expect(clipboard.features[0].feature.properties.trajetoria).toEqual([
            { t: 0, lng: 0, lat: 0 },
            { t: 1000, lng: 1, lat: 1 },
        ]);
        expect(clipboard.features[0].feature.properties._temporalHome).toEqual([0, 0]);
    });
});

describe('paste() espera a cópia ainda em voo', () => {
    it('Ctrl+C e Ctrl+V em sequência rápida colam a cópia NOVA, não o clipboard anterior', async () => {
        // `copy()` é assíncrona só por causa da ferramenta tardia. Um `paste()` que chegue
        // enquanto ela carrega lia o clipboard ANTERIOR (os três itens do beforeEach) e colava
        // o que a pessoa copiou da vez passada, sem erro nenhum. Medido no Playwright de
        // "Duplicar Seleção", que chamava copy() sem await: 2 linhas em vez de 4.
        const manager = montar();
        let liberar;
        const carga = new Promise((resolve) => { liberar = resolve; });
        manager.selectionManager.ensureControlFor = vi.fn(async () => { await carga; return controlePonto; });
        const feicao = (id) => ({
            type: 'Feature', id,
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { id, source: 'point', nome: id },
        });
        manager.selectionManager.getAllSelectedFeatures = () => [feicao('nova-1'), feicao('nova-2')];

        const copia = manager.copy(); // sem await: o segundo atalho chega antes da ferramenta
        const colagem = manager.paste();
        await Promise.resolve();
        await Promise.resolve();

        // CONTROLE: com a ferramenta ainda carregando, NADA foi colado, em especial não os
        // três itens antigos. Sem a espera em paste(), addFeatures já teria sido chamada aqui.
        expect(addFeatures).not.toHaveBeenCalled();

        liberar();
        expect(await copia).toBe(2);
        expect(await colagem).toBe(2);
        expect(addFeatures).toHaveBeenCalled();
        expect(toasts.success[0]).toMatch(/^2 /);
    });

    it('uma cópia que termina em zero não prende o paste: ele avisa que não há nada copiado', async () => {
        const manager = montar();
        manager.selectionManager.getAllSelectedFeatures = () => [];
        clipboard = { features: [], copiedAt: null, sourceMapName: null };

        const copia = manager.copy();
        const colados = await manager.paste();

        expect(await copia).toBe(0);
        expect(colados).toBe(0);
        expect(toasts.warning).toContain('Nenhuma feição copiada');
    });
});

describe('copy() carrega a ferramenta antes de decidir se a feição é copiável', () => {
    it('pede o controle de cada tipo distinto, uma vez', async () => {
        // Desde a carga tardia (2026-08-25) só seis controles são ansiosos. `filterCopiableFeatures`
        // lê `controls.get` DIRETO, então copiar uma feição de uma ferramenta nunca carregada
        // devolvia "Nenhuma feição válida para copiar" — indistinguível de uma recusa real.
        const manager = montar();
        const feicao = (id) => ({
            type: 'Feature', id,
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { id, source: 'point', nome: id },
        });

        const contagem = await manager.copy([feicao('a'), feicao('b')]);

        expect(contagem).toBe(2);
        expect(manager.selectionManager.ensureControlFor).toHaveBeenCalledTimes(1);
        expect(manager.selectionManager.ensureControlFor).toHaveBeenCalledWith('point');
    });

    it('devolve 0 (e não uma exceção) quando não há nada selecionado', async () => {
        const contagem = await montar().copy();

        expect(contagem).toBe(0);
        expect(toasts.warning).toEqual(['Nenhuma feição selecionada para copiar']);
    });

    it('descarta o item cujo `prepareForCopy` devolveu null em vez de o pôr no clipboard', async () => {
        const manager = montar();
        manager.selectionManager.controls.set('mudo', {
            canCopy: () => true,
            prepareForCopy: () => null,
        });

        const contagem = await manager.copy([{
            type: 'Feature', id: 'm',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { id: 'm', source: 'mudo', nome: 'Mudo' },
        }]);

        expect(contagem).toBe(0);
        expect(toasts.warning).toEqual(['Nenhuma feição válida para copiar']);
    });
});
