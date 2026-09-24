// Path: tests/integration/slide-colunas-do-servidor-na-entrada.repro.test.js
//
// AS DUAS PORTAS POR ONDE AS COLUNAS DO SERVIDOR ENTRAVAM NO SLIDE LOCAL (2026-09-24).
//
// O eco da propria op (o servidor normaliza o payload e o devolve com `map_id`, `base_layer`,
// `briefing_id`, `_mapName`, e o cliente o aplica com `localRepair`) e o retrato (que espalha cada
// coluna da linha antes dos apelidos camelCase) gravavam no slide local as colunas do servidor ao
// lado dos campos do cliente. Elas envelheciam ali, porque o editor so' escreve o camelCase, e a
// edicao seguinte as levava de volta: o servidor grava a coluna quando as duas grafias chegam, e a
// troca de mapa base, de interruptor, de instante ou de mapa do slide ficava so' na tela do autor
// (`frontend/tests/e2e-ui/briefing-vista-do-slide-cobertura.spec.js`).
//
// A metade de ESCRITA (a op nunca leva a coluna) esta' em
// `frontend/tests/store/slide-com-colunas-do-servidor.repro.test.js`; esta e' a de ENTRADA, que
// tambem impede o editor de redesenhar o formulario a cada recibo por uma chave que so' existe num
// dos lados.
//
// CONTROLE NEGATIVO: sem `clientSlideShape` no ramo SLIDE de `applyRemoteOperation` o primeiro caso
// fica vermelho; sem ele no retrato, o segundo.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { localRepository } from '../../src/js/store/repositories/local.repository.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { applyRemoteOperation, applyRemoteSnapshot, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';
import { updateSlide } from '../../src/js/store/briefing.operations.js';
import { SERVER_SLIDE_ALIASES } from '../../src/js/store/sync/slide-shape.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: () => ({ allowed: true })
}));

beforeEach(() => {
    vi.restoreAllMocks();
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key),
    });
    activateScope(remoteScope(crypto.randomUUID()));
    enableOperationLogging();
    setRemoteHandlerEventBus({ emit: vi.fn() });
});

/** A slide as the server hands it back: every row column plus the client's aliases. */
function slideComColunas(bId, sId) {
    return {
        id: sId, briefing_id: bId, title: 'Base', content: '', mode: '2d',
        map_id: crypto.randomUUID(), model_id: null, photo_id: null, _mapName: 'Mapa',
        position: { center: [-43, -22], zoom: 10, bearing: 0, pitch: 0 }, orientation: null,
        temporal_cursor: 1790000000000, base_layer: 'carta-topografica', temporal_enabled: true,
        controls: {}, version: 4,
        mapId: 'Mapa', modelId: null, photoId: null,
        temporalCursor: 1790000000000, baseLayer: 'carta-topografica', temporalEnabled: true, order: 0,
    };
}

const semColunas = (slide) => SERVER_SLIDE_ALIASES.filter((key) => Object.hasOwn(slide, key));

describe('o slide local nao guarda as colunas do servidor', () => {
    it('o eco da propria op (localRepair) grava o slide no formato do cliente, e a edicao seguinte sai limpa', async () => {
        const bId = crypto.randomUUID();
        const sId = crypto.randomUUID();
        await localRepository.saveBriefing(bId, { id: bId, name: 'Plano', slides: [{ id: sId, order: 0, title: 'Base', mapId: 'Mapa' }] });

        await applyRemoteOperation({ id: crypto.randomUUID(), entityType: 'slide', operationType: 'update',
            entityId: sId, mapId: bId, serverVersion: 30, localRepair: true, data: slideComColunas(bId, sId) });
        const gravado = (await localRepository.getBriefing(bId)).slides[0];
        expect(semColunas(gravado), 'nenhuma coluna do servidor no slide gravado').toEqual([]);
        expect(gravado).toMatchObject({ title: 'Base', baseLayer: 'carta-topografica', temporalEnabled: true });

        await updateSlide(bId, sId, { baseLayer: 'carta-ortoimagem', temporalEnabled: false });
        const op = (await operationQueue.getAll()).filter((o) => o.entityType === 'slide' && o.entityId === sId).at(-1);
        expect(semColunas(op.data), 'a op da edicao nao leva coluna velha').toEqual([]);
        expect(op.data).toMatchObject({ baseLayer: 'carta-ortoimagem', temporalEnabled: false });
    });

    it('o retrato grava os slides no formato do cliente', async () => {
        const bId = crypto.randomUUID();
        const sId = crypto.randomUUID();
        await applyRemoteSnapshot({ atlas: { ...createAtlas('Remoto'), id: getActiveScope().atlasId },
            maps: [], currentVersion: 1,
            briefings: [{ id: bId, name: 'Plano', description: '', settings: {}, version: 2, slides: [slideComColunas(bId, sId)] }] });
        const gravado = (await localRepository.getBriefing(bId)).slides[0];
        expect(semColunas(gravado), 'nenhuma coluna do servidor no slide do retrato').toEqual([]);
        expect(gravado).toMatchObject({ id: sId, mapId: 'Mapa', baseLayer: 'carta-topografica', temporalCursor: 1790000000000 });
    });

    it('EDGE: um payload sem nenhuma coluna do servidor chega intacto', async () => {
        const bId = crypto.randomUUID();
        const sId = crypto.randomUUID();
        await localRepository.saveBriefing(bId, { id: bId, name: 'Plano', slides: [{ id: sId, order: 0, title: 'Antes' }] });
        const payload = { id: sId, order: 0, title: 'Do colega', mapId: 'Mapa', baseLayer: null, temporalEnabled: null };
        await applyRemoteOperation({ id: crypto.randomUUID(), entityType: 'slide', operationType: 'update',
            entityId: sId, mapId: bId, serverVersion: 31, data: payload });
        const gravado = (await localRepository.getBriefing(bId)).slides[0];
        expect(gravado).toMatchObject(payload);
    });
});
