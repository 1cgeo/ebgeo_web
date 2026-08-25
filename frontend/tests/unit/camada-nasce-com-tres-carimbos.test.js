// Path: tests/unit/camada-nasce-com-tres-carimbos.test.js

/**
 * @fileoverview ONDE A CAMADA NASCE (`layers/layer.manager.js`), e o que ela carrega ao nascer.
 *
 * O QUE ESTA SUITE PRENDE:
 *
 *  1. OS TRES CARIMBOS, e a AUSENCIA dos outros tres. Atlas, Map e Group carregam seis campos de
 *     sync; feicao e CAMADA carregam so `createdAt`, `updatedAt` e `version`. A camada e a que
 *     surpreende, porque ela E entidade de escrita incremental por sync, com op propria: codigo
 *     que espere `ownerId`, `dirty` ou `deleted` numa camada le `undefined` sem erro nenhum. A
 *     asserção e sobre o CONJUNTO EXATO de chaves, nos tres nascedouros (criar, criar para
 *     importacao, duplicar mapa), porque um teste que so olhasse os tres presentes passaria verde
 *     no dia em que alguem acrescentasse os outros por engano.
 *  2. `version` monotonico e `updatedAt` reescrito a cada atualizacao, incluindo o degrau a
 *     partir de camada legada sem `version` (`(oldLayer.version || 0) + 1`).
 *  3. Os predicados de estado: `isFeatureEffectivelyVisible` / `...Locked`, com a igualdade
 *     ESTRITA que os define (`visivel === false`, `bloqueado === true`) e o fallback `?? true` /
 *     `?? false` da camada. Sao eles que decidem se a feicao aparece e se ela aceita edicao.
 *  4. `_getNextLayerOrder`, `getLayers` (ordenacao) e `getUnlockedLayerIds`.
 *  5. `setLayerOpacity`, incluindo o desfecho ASSIMETRICO de `undefined` e `null` (o primeiro vira
 *     1, o segundo vira 0), fixado como OBSERVADO.
 *  6. `deleteLayer`: a ultima camada renasce, a camada ativa apagada troca por outra, e a troca e
 *     pela ordem de INSERCAO do Map, nao pelo campo `order`.
 *
 * O QUE ELA NAO ALCANCA, declarado:
 *
 *  - A PERSISTENCIA. `_persistLayersAsync` passa por `DebouncedPersist` (300 ms) e por
 *    `setLayersRepo`, que e IndexedDB namespaceado por atlas. Nada aqui espera pelo disco; o que
 *    se afirma e o estado do `memoryStore` e as ops registradas.
 *  - `loadLayersToMemory` / `duplicateMapLayers` alem do carimbo: os dois leem repositorio real.
 *    Um deles e exercitado com o repositorio dublado so para observar o carimbo da copia.
 *  - `layers.locked` NAO tem imposicao no servidor (so `maps.locked` tem). Esta suite mede o que
 *    o CLIENTE faz com o campo; ela nao afirma nada sobre gate remoto, e nao deve ser lida como
 *    prova de que travar uma camada protege algo do outro lado.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const loggedOps = [];
vi.mock('../../src/js/store/sync/index.js', () => ({
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' },
    logLayerOperation: (...args) => loggedOps.push(args),
}));
vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: { resolveToId: (name) => `uuid-of-${name}` },
}));

const repo = { layers: {}, activeId: {} };
vi.mock('../../src/js/store/index.js', async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        setLayersRepo: async (mapName, arr) => { repo.layers[mapName] = arr; },
        getLayersRepo: async (mapName) => repo.layers[mapName] || [],
        setActiveLayerIdRepo: async (mapName, id) => { repo.activeId[mapName] = id; },
        getActiveLayerIdRepo: async (mapName) => repo.activeId[mapName] || 'default',
    };
});

const { createLayerManager } = await import('../../src/js/layers/layer.manager.js');

/** The three sync fields a layer (and a feature) carries. */
const CARIMBOS = ['createdAt', 'updatedAt', 'version'];
/** The three a layer deliberately does NOT carry (Atlas/Map/Group do). */
const NAO_CARIMBOS = ['ownerId', 'dirty', 'deleted'];

const MAP = 'MapaDeTeste';
let lm;
let emitted;

beforeEach(() => {
    loggedOps.length = 0;
    repo.layers = {};
    repo.activeId = {};
    emitted = [];
    lm = createLayerManager({ emit: (type, payload) => emitted.push([type, payload]) });
    // The memoryStore is a module singleton shared with the whole store barrel: reset the slice
    // this suite owns instead of trusting whatever ran before it in the same process.
    lm.memoryStore.layers = {};
    lm.memoryStore.activeLayerId = null;
    lm.memoryStore.currentMap = MAP;
});

describe('1. os tres carimbos, e a ausencia dos outros tres', () => {
    it('createLayer poe EXATAMENTE createdAt, updatedAt e version, e nada de ownerId/dirty/deleted', () => {
        const layer = lm.createLayer('Alfa', MAP);
        for (const campo of CARIMBOS) expect(layer[campo]).toBeDefined();
        for (const campo of NAO_CARIMBOS) expect(campo in layer).toBe(false);
        expect(Object.keys(layer).sort()).toEqual(
            ['createdAt', 'id', 'locked', 'name', 'opacity', 'order', 'updatedAt', 'version', 'visible'].sort()
        );
        expect(layer.version).toBe(1);
        expect(layer.createdAt).toBe(layer.updatedAt);
    });

    it('createLayerForImport nasce com o mesmo conjunto de campos', () => {
        const layer = lm.createLayerForImport('Importada', MAP);
        for (const campo of NAO_CARIMBOS) expect(campo in layer).toBe(false);
        expect(layer.version).toBe(1);
    });

    it('a copia por duplicateMapLayers reescreve os tres e nao inventa os outros tres', async () => {
        repo.layers.Origem = [
            { id: 'default', name: 'Padrao', visible: true, locked: false, order: 0, version: 9, createdAt: 1, updatedAt: 2 },
            { id: 'l2', name: 'Outra', visible: true, locked: false, order: 1, version: 4, createdAt: 1, updatedAt: 2 },
        ];
        repo.activeId.Origem = 'l2';
        const mapping = await lm.duplicateMapLayers('Origem', 'Destino');
        expect(repo.layers.Destino).toHaveLength(2);
        for (const copia of repo.layers.Destino) {
            expect(copia.version).toBe(1);
            expect(copia.createdAt).toBe(copia.updatedAt);
            for (const campo of NAO_CARIMBOS) expect(campo in copia).toBe(false);
        }
        // 'default' mantem o id; a outra ganha id novo, e o mapa de traducao registra as duas.
        expect(mapping.get('default')).toBe('default');
        expect(mapping.get('l2')).not.toBe('l2');
        expect(repo.activeId.Destino).toBe(mapping.get('l2'));
    });

    it('createLayer registra UMA op de sync, carimbada com o UUID do mapa e nao com o nome', () => {
        const layer = lm.createLayer('Alfa', MAP);
        expect(loggedOps).toHaveLength(1);
        const [tipo, layerId, mapId, payload] = loggedOps[0];
        expect(tipo).toBe('create');
        expect(layerId).toBe(layer.id);
        expect(mapId).toBe(`uuid-of-${MAP}`);
        expect(payload).toBe(layer);
    });

    it('createLayerForImport NAO emite LAYERS_CHANGED, e createLayer emite', () => {
        lm.createLayerForImport('I', MAP);
        expect(emitted).toHaveLength(0);
        lm.createLayer('C', MAP);
        expect(emitted).toHaveLength(1);
        expect(emitted[0][1]).toEqual({ mapName: MAP });
    });

    it('BORDA: nome vazio cai no gerador de nome unico, e nome com zero NAO', () => {
        // `name || gerado` engole a string vazia, que e o unico falsy plausivel aqui.
        const vazio = lm.createLayer('', MAP);
        expect(vazio.name).not.toBe('');
        expect(vazio.name).toContain('Nova Camada');
        const zero = lm.createLayer('0', MAP);
        expect(zero.name).toBe('0');
    });
});

describe('2. version e updatedAt sobem a cada atualizacao', () => {
    it('cada renomeacao soma um em version e reescreve updatedAt', () => {
        const l = lm.createLayer('A', MAP);
        const antes = l.updatedAt;
        const r1 = lm.renameLayer(l.id, 'B', MAP);
        expect(r1.version).toBe(2);
        expect(r1.name).toBe('B');
        expect(r1.updatedAt).toBeGreaterThanOrEqual(antes);
        const r2 = lm.renameLayer(l.id, 'C', MAP);
        expect(r2.version).toBe(3);
    });

    it('camada legada SEM version comeca do zero e vai para 1, sem NaN', () => {
        lm.memoryStore.layers[MAP] = new Map([['legada', { id: 'legada', name: 'X', visible: true }]]);
        const out = lm.renameLayer('legada', 'Y', MAP);
        expect(out.version).toBe(1);
        expect(Number.isFinite(out.version)).toBe(true);
    });

    it('camada inexistente lanca, em vez de criar em silencio', () => {
        expect(() => lm.renameLayer('nao-existe', 'Z', MAP)).toThrow(/not found/);
        expect(() => lm.setActiveLayer('nao-existe', MAP)).toThrow(/not found/);
    });

    it('reorderLayers so registra op para a camada que MUDOU de posicao', () => {
        const a = lm.createLayer('A', MAP);
        const b = lm.createLayer('B', MAP);
        loggedOps.length = 0;
        // 'default' ja esta em 0; a e b em 1 e 2. Trocar a por b move as duas.
        lm.reorderLayers(['default', b.id, a.id], MAP);
        const ids = loggedOps.map(([, layerId]) => layerId);
        expect(ids).toHaveLength(2);
        expect(new Set(ids)).toEqual(new Set([a.id, b.id]));
        expect(a.order).toBe(2);
        expect(b.order).toBe(1);
        // Repetir a mesma ordem nao registra nada: a comparacao e por valor.
        loggedOps.length = 0;
        lm.reorderLayers(['default', b.id, a.id], MAP);
        expect(loggedOps).toHaveLength(0);
    });

    it('CONSERTADO: id fantasma nao lanca e nao CONSOME mais o indice', () => {
        const a = lm.createLayer('A', MAP); // nasce com order 1
        loggedOps.length = 0;
        expect(() => lm.reorderLayers(['fantasma', a.id], MAP)).not.toThrow();
        // O indice conta as camadas que EXISTEM, nao as posicoes do array recebido. Antes `a`
        // ficava em 1 porque o fantasma ocupava o 0, e um id ja apagado que sobrevivesse na lista
        // da UI empurrava a pilha inteira para baixo, sem erro nenhum.
        expect(a.order).toBe(0);
        expect(loggedOps).toHaveLength(1);
    });

    it('CONSERTADO: varios fantasmas intercalados nao abrem buracos na pilha', () => {
        const a = lm.createLayer('A', MAP);
        const b = lm.createLayer('B', MAP);
        loggedOps.length = 0;
        lm.reorderLayers(['f1', b.id, 'f2', 'f3', a.id, 'f4'], MAP);
        expect(b.order).toBe(0);
        expect(a.order).toBe(1);
    });

    it('CONTROLE: sem fantasma nenhum a ordem continua sendo a do array', () => {
        const a = lm.createLayer('A', MAP);
        const b = lm.createLayer('B', MAP);
        lm.reorderLayers([b.id, a.id], MAP);
        expect(b.order).toBe(0);
        expect(a.order).toBe(1);
    });
});

describe('3. os predicados de estado, e a igualdade ESTRITA que os define', () => {
    beforeEach(() => {
        lm.memoryStore.layers[MAP] = new Map([
            ['default', { id: 'default', name: 'Padrao', visible: true, locked: false }],
            ['oculta', { id: 'oculta', name: 'Oculta', visible: false, locked: false }],
            ['travada', { id: 'travada', name: 'Travada', visible: true, locked: true }],
            ['muda', { id: 'muda', name: 'Sem flags' }],
        ]);
        lm.memoryStore.activeLayerId = 'default';
    });

    it('feicao nula, sem properties ou com properties vazia e VISIVEL', () => {
        expect(lm.isFeatureEffectivelyVisible(null, MAP)).toBe(true);
        expect(lm.isFeatureEffectivelyVisible(undefined, MAP)).toBe(true);
        expect(lm.isFeatureEffectivelyVisible({}, MAP)).toBe(true);
        expect(lm.isFeatureEffectivelyVisible({ properties: {} }, MAP)).toBe(true);
    });

    it('SO `visivel === false` esconde: 0, "", "false" e null NAO escondem', () => {
        const esconde = (v) => lm.isFeatureEffectivelyVisible({ properties: { visivel: v } }, MAP);
        expect(esconde(false)).toBe(false);
        for (const quaseFalso of [0, '', 'false', null, undefined, NaN]) {
            expect(esconde(quaseFalso)).toBe(true);
        }
    });

    it('a camada oculta esconde a feicao que nao se declara, e a camada sem flag NAO', () => {
        expect(lm.isFeatureEffectivelyVisible({ properties: { layerId: 'oculta' } }, MAP)).toBe(false);
        // `layer?.visible ?? true`: camada sem a chave e tratada como visivel.
        expect(lm.isFeatureEffectivelyVisible({ properties: { layerId: 'muda' } }, MAP)).toBe(true);
        // Camada que nem existe cai no mesmo fallback.
        expect(lm.isFeatureEffectivelyVisible({ properties: { layerId: 'sumida' } }, MAP)).toBe(true);
    });

    it('layerId ausente resolve para "default"', () => {
        lm.memoryStore.layers[MAP].get('default').visible = false;
        expect(lm.isFeatureEffectivelyVisible({ properties: {} }, MAP)).toBe(false);
    });

    it('BORDA: layerId vazio tambem cai em "default" (o `||` engole a string vazia)', () => {
        lm.memoryStore.layers[MAP].get('default').visible = false;
        expect(lm.isFeatureEffectivelyVisible({ properties: { layerId: '' } }, MAP)).toBe(false);
    });

    it('SO `bloqueado === true` trava: a string "true" NAO trava', () => {
        const trava = (v) => lm.isFeatureEffectivelyLocked({ properties: { bloqueado: v } }, MAP);
        expect(trava(true)).toBe(true);
        for (const quaseVerdade of ['true', 1, 'sim', {}]) {
            expect(trava(quaseVerdade)).toBe(false);
        }
    });

    it('feicao nula NAO esta travada (o oposto do default de visibilidade)', () => {
        expect(lm.isFeatureEffectivelyLocked(null, MAP)).toBe(false);
        expect(lm.isFeatureEffectivelyLocked({ properties: {} }, MAP)).toBe(false);
    });

    it('a camada travada trava a feicao, e a camada sem flag NAO', () => {
        expect(lm.isFeatureEffectivelyLocked({ properties: { layerId: 'travada' } }, MAP)).toBe(true);
        expect(lm.isFeatureEffectivelyLocked({ properties: { layerId: 'muda' } }, MAP)).toBe(false);
        expect(lm.isFeatureEffectivelyLocked({ properties: { layerId: 'sumida' } }, MAP)).toBe(false);
    });

    it('getVisibleLayerIds e getUnlockedLayerIds discriminam por truthiness, e diferem no ausente', () => {
        // `filter(l => l.visible)` exige truthy; `filter(l => !l.locked)` aceita o ausente.
        expect(lm.getVisibleLayerIds(MAP).sort()).toEqual(['default', 'travada']);
        expect(lm.getUnlockedLayerIds(MAP).sort()).toEqual(['default', 'muda', 'oculta']);
        // A camada sem a flag `visible` FICA DE FORA da lista de visiveis, e dentro da de
        // destravadas: a assimetria e do desenho, e e o que faz a camada legada continuar
        // editavel enquanto nao desenha.
        expect(lm.getVisibleLayerIds(MAP)).not.toContain('muda');
    });

    it('setActiveLayer recusa camada travada, nomeando o motivo', () => {
        expect(() => lm.setActiveLayer('travada', MAP)).toThrow(/locked/);
        expect(lm.memoryStore.activeLayerId).toBe('default');
        expect(lm.setActiveLayer('oculta', MAP).id).toBe('oculta');
        expect(lm.memoryStore.activeLayerId).toBe('oculta');
    });
});

describe('4. ordem: proxima ordem, ordenacao e o vazio que evita -Infinity', () => {
    it('mapa vazio devolve 0, e nao -Infinity vindo de Math.max()', () => {
        lm.memoryStore.layers.Vazio = new Map();
        expect(lm._getNextLayerOrder('Vazio')).toBe(0);
        expect(Number.isFinite(lm._getNextLayerOrder('Vazio'))).toBe(true);
    });

    it('a proxima ordem e o maximo + 1, inclusive com ordens negativas', () => {
        lm.memoryStore.layers.N = new Map([
            ['a', { id: 'a', order: -5 }],
            ['b', { id: 'b', order: -2 }],
        ]);
        expect(lm._getNextLayerOrder('N')).toBe(-1);
    });

    it('BORDA: `order || 0` trata 0 e ausente do mesmo jeito, entao a proxima e 1', () => {
        lm.memoryStore.layers.Z = new Map([
            ['a', { id: 'a', order: 0 }],
            ['b', { id: 'b' }],
        ]);
        expect(lm._getNextLayerOrder('Z')).toBe(1);
    });

    it('getLayers ordena por order, com o ausente valendo 0', () => {
        lm.memoryStore.layers[MAP] = new Map([
            ['c', { id: 'c', order: 5 }],
            ['a', { id: 'a' }],
            ['b', { id: 'b', order: 2 }],
        ]);
        expect(lm.getLayers(MAP).map(l => l.id)).toEqual(['a', 'b', 'c']);
    });

    it('mapa desconhecido nasce com a camada padrao em vez de estourar', () => {
        const camadas = lm.getLayers('MapaNovo');
        expect(camadas).toHaveLength(1);
        expect(camadas[0].id).toBe('default');
    });
});

describe('5. opacidade: clamp, nao-finito e a assimetria de null contra undefined', () => {
    let alvo;
    beforeEach(() => { alvo = lm.createLayer('A', MAP); });

    it('0 e preservado (nao vira 1), e 1 e o teto', () => {
        expect(lm.setLayerOpacity(alvo.id, 0, MAP).opacity).toBe(0);
        expect(lm.setLayerOpacity(alvo.id, 1, MAP).opacity).toBe(1);
    });

    it('clampa fora de [0,1] pelos dois lados', () => {
        expect(lm.setLayerOpacity(alvo.id, -3, MAP).opacity).toBe(0);
        expect(lm.setLayerOpacity(alvo.id, 7, MAP).opacity).toBe(1);
    });

    it('nao-finito cai no padrao 1 (Number.isFinite, nao `?? 1`)', () => {
        expect(lm.setLayerOpacity(alvo.id, NaN, MAP).opacity).toBe(1);
        expect(lm.setLayerOpacity(alvo.id, Infinity, MAP).opacity).toBe(1);
        expect(lm.setLayerOpacity(alvo.id, undefined, MAP).opacity).toBe(1);
        expect(lm.setLayerOpacity(alvo.id, 'abc', MAP).opacity).toBe(1);
    });

    it('CONSERTADO: `null`, `undefined` e string vazia caem TODOS no padrao 1', () => {
        // `Number(null) === 0` passava pelo Number.isFinite e era clampado para 0, enquanto
        // `Number(undefined)` e NaN e caia no padrao. Os tres chegam de "nenhuma escolha" e saiam
        // em pontas opostas da escala: uma camada sumia da tela por um null.
        expect(lm.setLayerOpacity(alvo.id, null, MAP).opacity).toBe(1);
        expect(lm.setLayerOpacity(alvo.id, undefined, MAP).opacity).toBe(1);
        expect(lm.setLayerOpacity(alvo.id, '', MAP).opacity).toBe(1);
    });

    it('CONTROLE: o zero EXPLICITO continua sendo zero, e nao virou padrao junto', () => {
        // Sem este par o conserto acima seria indistinguivel de proibir a transparencia total.
        expect(lm.setLayerOpacity(alvo.id, 0, MAP).opacity).toBe(0);
        expect(lm.setLayerOpacity(alvo.id, '0', MAP).opacity).toBe(0);
    });

    it('numero em string e aceito e convertido', () => {
        expect(lm.setLayerOpacity(alvo.id, '0.25', MAP).opacity).toBe(0.25);
    });

    it('escrever a opacidade que ja vale NAO registra op nem sobe version', () => {
        lm.setLayerOpacity(alvo.id, 0.5, MAP);
        const versaoDepois = alvo.version;
        loggedOps.length = 0;
        const igual = lm.setLayerOpacity(alvo.id, 0.5, MAP);
        expect(igual.version).toBe(versaoDepois);
        expect(loggedOps).toHaveLength(0);
    });

    it('CONTROLE: opacidade diferente registra op, provando que o caso acima discrimina', () => {
        lm.setLayerOpacity(alvo.id, 0.5, MAP);
        loggedOps.length = 0;
        lm.setLayerOpacity(alvo.id, 0.6, MAP);
        expect(loggedOps).toHaveLength(1);
    });
});

describe('6. apagar camada: a ultima renasce, e a ativa troca pela ordem de INSERCAO', () => {
    it('apagar a unica camada cria uma padrao nova e a ativa', () => {
        lm.getLayers(MAP); // ensures the default layer exists
        const out = lm.deleteLayer('default', MAP);
        expect(out.success).toBe(true);
        expect(out.createdDefaultLayer).not.toBeNull();
        // A nova recebe id proprio, senao ela seria apagada pela linha seguinte do proprio metodo.
        expect(out.createdDefaultLayer.id).not.toBe('default');
        expect(lm.memoryStore.activeLayerId).toBe(out.createdDefaultLayer.id);
        expect(lm.getLayers(MAP)).toHaveLength(1);
    });

    it('apagar camada nao-ativa nao mexe na ativa e nao cria padrao', () => {
        const a = lm.createLayer('A', MAP);
        lm.setActiveLayer(a.id, MAP);
        const b = lm.createLayer('B', MAP);
        const out = lm.deleteLayer(b.id, MAP);
        expect(out.createdDefaultLayer).toBeNull();
        expect(lm.memoryStore.activeLayerId).toBe(a.id);
    });

    it('apagar a ATIVA escolhe a primeira DESTRAVADA na ordem de insercao, ignorando `order`', () => {
        // 'default' entra primeiro (ordem 0). 'alta' recebe order 99, 'baixa' recebe order 100,
        // mas e 'default' quem herda, porque a varredura e sobre o Map e nao sobre a ordenacao.
        const alta = lm.createLayer('Alta', MAP);
        const baixa = lm.createLayer('Baixa', MAP);
        alta.order = 99;
        baixa.order = 100;
        lm.memoryStore.layers[MAP].get('default').order = 500;
        lm.setActiveLayer(alta.id, MAP);
        lm.deleteLayer(alta.id, MAP);
        expect(lm.memoryStore.activeLayerId).toBe('default');
        // Controle: se a escolha fosse por `order`, a herdeira seria `baixa` (100 < 500).
        expect(lm.memoryStore.activeLayerId).not.toBe(baixa.id);
    });

    it('se todas as sobreviventes estao travadas, uma delas e DESTRAVADA para poder receber o foco', () => {
        const outra = lm.createLayer('Outra', MAP);
        lm.memoryStore.layers[MAP].get('default').locked = true;
        lm.setActiveLayer(outra.id, MAP);
        lm.deleteLayer(outra.id, MAP);
        expect(lm.memoryStore.activeLayerId).toBe('default');
        expect(lm.memoryStore.layers[MAP].get('default').locked).toBe(false);
    });

    it('apagar camada inexistente lanca e nao registra op', () => {
        loggedOps.length = 0;
        expect(() => lm.deleteLayer('fantasma', MAP)).toThrow(/not found/);
        expect(loggedOps).toHaveLength(0);
    });

    it('a op de delete leva a camada APAGADA como estado anterior', () => {
        const a = lm.createLayer('A', MAP);
        loggedOps.length = 0;
        lm.deleteLayer(a.id, MAP);
        expect(loggedOps).toHaveLength(1);
        const [tipo, layerId, mapId, payload, anterior] = loggedOps[0];
        expect(tipo).toBe('delete');
        expect(layerId).toBe(a.id);
        expect(mapId).toBe(`uuid-of-${MAP}`);
        expect(payload).toBeNull();
        expect(anterior.id).toBe(a.id);
    });
});
