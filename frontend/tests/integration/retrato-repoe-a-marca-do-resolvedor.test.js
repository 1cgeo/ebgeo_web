// Path: tests/integration/retrato-repoe-a-marca-do-resolvedor.test.js

/**
 * @fileoverview Regressao D1/O3 no caminho REAL do retrato: com IndexedDB de verdade
 * (fake-indexeddb), escopo remoto de verdade e o resolvedor de verdade.
 *
 * POR QUE AQUI, E NAO EM `remote-operation-handler.test.js`. A ativaçao da geraçao (o trecho que
 * troca o indice nome<->id e reconcilia o mapa corrente) so' roda no ramo de escopo REMOTO de
 * `applyRemoteSnapshot`, que exige namespace, ponteiro de geraçao e pausa de escrita. Aquele
 * arquivo aplica retratos em escopo local, onde o ramo inteiro e' pulado: um caso escrito la'
 * seria verde sem nunca ter executado a linha que interessa. Este arquivo e' irmao de
 * `tests/integration/snapshot-generation.test.js`, de onde vem o arnes.
 *
 * O QUE ELE PRENDE:
 *   D1 — depois do retrato a marca do resolvedor e' VERDADEIRA. `mapResolver.clear()` mais um
 *        laço de `registerMap` deixava o indice cheio e a marca falsa, e como toda abertura de
 *        atlas de servidor aplica um retrato, a marca ficava falsa pelo resto da sessao remota,
 *        desligando a via rapida de `LocalRepository.getMap`/`_resolveMapKey` e mandando a
 *        contagem de cores para uma chave por NOME (`_resolveSettingsKey`).
 *   O3 — quando o retrato muda o nome do mapa corrente, ou o retira, o tratador ANUNCIA
 *        (`CURRENT_MAP_STALE_REMOTELY`). Sem o anuncio a aba fica apontando para um mapa
 *        que o disco nao tem, e a escrita seguinte cunha o mapa FANTASMA.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { localRepository, getEmptyMapData } from '../../src/js/store/repositories/local.repository.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';
import { applyRemoteSnapshot, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { EventTypes } from '../../src/js/events/event_types.js';

const MAP_ID = '52000000-0000-4000-8000-000000000002';
const OUTRO_ID = '52000000-0000-4000-8000-000000000003';
const VELHO = 'Mapa Alfa';
const NOVO = 'Mapa Bravo';

const storage = new Map();
let scope;
let bus;
let contador = 0;

const doc = (id, name) => ({ ...getEmptyMapData(), id, name });

/** Um retrato do servidor com os mapas pedidos, sempre numa versao ainda nao encenada. */
const retrato = (mapas, currentVersion) => ({
    atlas: { ...createAtlas('Remoto'), id: scope.atlasId },
    maps: mapas,
    briefings: [],
    currentVersion,
});

/** Poe a aba DENTRO de um mapa, como `setCurrentMap` faria (a chave de camada e' o sinal). */
function abaNoMapa(nome) {
    memoryStore.currentMap = nome;
    memoryStore.layers[nome] = new Map();
}

const anuncios = () => bus.emit.mock.calls
    .filter(([tipo]) => tipo === EventTypes.CURRENT_MAP_STALE_REMOTELY)
    .map(([, payload]) => payload);

beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    });
    // UM ESCOPO POR CASO: o ponteiro de geraçao e o cursor sobrevivem no `storage` compartilhado,
    // e um retrato cuja versao JA' e' o cursor da geraçao ativa e' recusado de proposito (o
    // atalho de idempotencia). Escopo novo a cada caso e' o que mantem cada medida independente.
    scope = remoteScope(`52000000-0000-4000-8000-00000000${String(++contador).padStart(4, '0')}`);
    activateScope(scope);
    await localRepository.saveAtlas({ ...createAtlas('Anterior'), id: scope.atlasId });
    await localRepository.saveMap(MAP_ID, doc(MAP_ID, VELHO));
    bus = { emit: vi.fn() };
    setRemoteHandlerEventBus(bus);
    mapResolver.clear();
    memoryStore.currentMap = null;
    memoryStore.layers = {};
});

describe('D1 — o retrato repoe a marca do resolvedor', () => {
    it('depois de ativar a geraçao, a marca e VERDADEIRA e o indice tem os mapas', async () => {
        await applyRemoteSnapshot(retrato([doc(MAP_ID, VELHO), doc(OUTRO_ID, 'Mapa Vizinho')], 11));

        expect(mapResolver.isInitialized).toBe(true);
        expect(mapResolver.resolveToId(VELHO)).toBe(MAP_ID);
        expect(mapResolver.resolveToName(OUTRO_ID)).toBe('Mapa Vizinho');
        expect(mapResolver.size).toBe(2);
    });

    it('um retrato SEM mapa nenhum tambem deixa a marca verdadeira', async () => {
        // A borda que reabriria o defeito pelo caso vazio: "nao ha mapa" e' uma resposta completa
        // sobre o conteudo do retrato, e nao um indice por construir.
        await applyRemoteSnapshot(retrato([], 12));

        expect(mapResolver.isInitialized).toBe(true);
        expect(mapResolver.size).toBe(0);
    });
});

describe('O3 — o retrato anuncia quando o mapa corrente ficou para tras', () => {
    it('mapa corrente RENOMEADO no retrato: anuncia o nome novo', async () => {
        abaNoMapa(VELHO);
        mapResolver.registerMap(VELHO, MAP_ID);

        await applyRemoteSnapshot(retrato([doc(MAP_ID, NOVO)], 13));

        expect(anuncios()).toEqual([{ mapId: MAP_ID, oldName: VELHO, newName: NOVO }]);
        // E o indice ja' esta' no estado NOVO quando o assinante roda, e e' por isso que ele nao
        // pode reusar a guarda do rename ao vivo (que pergunta pelo nome VELHO).
        expect(mapResolver.resolveToId(VELHO)).toBe(VELHO);
        expect(mapResolver.resolveToId(NOVO)).toBe(MAP_ID);
    });

    it('mapa corrente AUSENTE do retrato: anuncia com `newName` nulo', async () => {
        abaNoMapa(VELHO);
        mapResolver.registerMap(VELHO, MAP_ID);

        await applyRemoteSnapshot(retrato([doc(OUTRO_ID, 'Mapa Vizinho')], 14));

        expect(anuncios()).toEqual([{ mapId: MAP_ID, oldName: VELHO, newName: null }]);
    });

    it('retrato que NAO mexe no mapa corrente nao anuncia nada', async () => {
        abaNoMapa(VELHO);
        mapResolver.registerMap(VELHO, MAP_ID);

        await applyRemoteSnapshot(retrato([doc(MAP_ID, VELHO), doc(OUTRO_ID, 'Mapa Vizinho')], 15));

        expect(anuncios()).toEqual([]);
    });

    it('a ABERTURA de um atlas nao anuncia nada, nem quando o mapa padrao tem xara', async () => {
        // O CASO QUE A GUARDA EXISTE PARA IMPEDIR. Na abertura, `resetAtlasView` acabou de zerar a
        // memoria, entao `memoryStore.currentMap` e' o nome do mapa local padrao e NENHUM mapa
        // esta montado (`memoryStore.layers` esta vazio). Sem a guarda, um atlas que tivesse tido
        // um mapa com aquele nome faria a abertura ANUNCIAR uma perda que nao houve: um aviso
        // falso na tela e uma troca de mapa competindo com a que o proprio pipeline de abertura
        // faz na linha seguinte.
        memoryStore.currentMap = VELHO;
        memoryStore.layers = {};
        mapResolver.registerMap(VELHO, MAP_ID);

        await applyRemoteSnapshot(retrato([doc(OUTRO_ID, 'Mapa Vizinho')], 16));

        expect(anuncios()).toEqual([]);
    });

    it('sem mapa corrente nenhum, nada e anunciado', async () => {
        await applyRemoteSnapshot(retrato([doc(OUTRO_ID, 'Mapa Vizinho')], 17));

        expect(anuncios()).toEqual([]);
    });
});
