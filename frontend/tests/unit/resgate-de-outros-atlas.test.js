// Path: tests/unit/resgate-de-outros-atlas.test.js

/**
 * @fileoverview O RESGATE DOS ATLAS QUE A ABA DEIXOU (`preserveUnsyncedWorkOfOtherAtlases`) e as
 * frases dele, em node.
 *
 * O spec de navegador (`tests/e2e-ui/sessao-perdida-poupa-fila-de-outro-atlas.repro.spec.js`) prova o
 * caminho feliz de ponta a ponta; este arquivo prende as REGRAS, uma por caso, com o mundo dublado:
 * quem é pulado (descarte confirmado pela marca ou pela cerca, montado por outra aba viva, já
 * resgatado, fila vazia), quem entra (contagem desconhecida), o teto de atlas locais caindo no veto
 * com o prazo que RESTA, o veto vencido contado como perdido, e as frases de cada desfecho.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const HORA = 3_600_000;
const PRAZO = 24 * HORA;

const mundo = vi.hoisted(() => ({
    remotos: [],
    registro: [],
    filas: new Map(),
    nomes: new Map(),
    cercados: new Set(),
    montadosPorOutra: new Set(),
    vetos: new Map(),
    vetoGrava: true,
    adotados: [],
}));

vi.mock('@store/remote-atlas.api.js', () => ({
    listRemoteAtlases: async () => mundo.remotos.map(r => ({ ...r })),
    retainRemoteAtlasForRescue: async (id) => {
        if (!mundo.vetoGrava) return false;
        if (!mundo.vetos.has(id)) mundo.vetos.set(id, Date.now());
        return true;
    },
    releaseRemoteAtlasRescueVeto: (id) => { mundo.vetos.delete(id); },
    remoteAtlasRescueVetoSince: (id) => mundo.vetos.get(id) ?? 0,
    RESCUE_VETO_GRACE_MS: 24 * 60 * 60 * 1000,
}));

vi.mock('@store/local-atlas.api.js', () => ({
    MAX_LOCAL_ATLASES: 10,
    adoptRemoteAtlasAsLocal: vi.fn(async (atlasId, name, options) => {
        mundo.adotados.push({ atlasId, name, options });
        const entrada = { id: `slot-${atlasId}`, name, dbSuffix: `remote-${atlasId}` };
        mundo.registro.push(entrada);
        return { ok: true, atlas: entrada };
    }),
}));

vi.mock('@store/atlas-namespace.js', () => ({
    StoreName: { OPERATION_QUEUE: 'operationQueue', ATLAS: 'atlas' },
    ATLAS_RECORD_KEY: 'current_atlas',
    remoteScope: (id) => ({ kind: 'remote', atlasId: id, dbSuffix: `remote-${id}` }),
    readLocalAtlasRegistry: async () => mundo.registro.map(e => ({ ...e })),
    reconcileDurablePointers: async () => ({}),
    getActiveScope: () => null,
    atlasMountLockName: (suffix) => `mount#${suffix}`,
    hasMountLockSupport: () => true,
    getStoreFor: (storeId, scope) => {
        if (storeId === 'atlas') {
            return { getItem: async () => ({ name: mundo.nomes.get(scope.atlasId) ?? null }) };
        }
        const fila = mundo.filas.get(scope.atlasId);
        if (fila === 'falha') throw new Error('fila ilegível');
        const ops = fila ?? 0;
        return {
            keys: async () => Array.from({ length: ops }, (_, i) => `op_${i}`),
            getItem: async () => ({ scopeSuffix: scope.dbSuffix }),
        };
    },
}));

vi.mock('@store/sync/operation-queue.js', () => ({
    operationQueue: { countByState: async () => ({ pendentes: 0, preparadas: 0, problemas: 0 }) },
    operationBelongsToScope: (op, suffix) => op.scopeSuffix === suffix,
}));

vi.mock('@store/store-origin.js', () => ({
    markStoreLocal: async () => {},
    loadStoreOrigin: async () => null,
    StoreOriginKind: { REMOTE: 'remote', LOCAL: 'local' },
}));

vi.mock('@store/remote-write-fence.js', () => ({
    remoteWritesDiscarded: (scope) => mundo.cercados.has(scope?.atlasId),
}));

vi.mock('@utils/tab-lock.js', () => ({
    otherClientHoldsLock: async (_locks, name) => mundo.montadosPorOutra.has(name.replace('mount#remote-', '')),
}));

const saida = await import('../../src/js/session/unsynced-work-exit.js');
const frases = await import('../../src/js/session/unsynced-work-phrases.js');

/** Um atlas de servidor registrado, com N ops na fila e um nome no disco. */
function atlasRemoto(id, { ops = 1, nome = `Atlas ${id}`, ...marcas } = {}) {
    mundo.remotos.push({ atlasId: id, dbSuffix: `remote-${id}`, ...marcas });
    mundo.filas.set(id, ops);
    mundo.nomes.set(id, nome);
}

beforeEach(() => {
    mundo.remotos = [];
    mundo.registro = [{ id: 'local-1', name: 'Meu Atlas', dbSuffix: 'local-1' }];
    mundo.filas = new Map();
    mundo.nomes = new Map();
    mundo.cercados = new Set();
    mundo.montadosPorOutra = new Set();
    mundo.vetos = new Map();
    mundo.vetoGrava = true;
    mundo.adotados = [];
});

describe('preserveUnsyncedWorkOfOtherAtlases: quem entra e quem é pulado', () => {
    it('resgata o que tem pendência, com makeCurrent:false, e pula o montado pelo chamador', async () => {
        atlasRemoto('a');
        atlasRemoto('montado');
        const r = await saida.preserveUnsyncedWorkOfOtherAtlases({ exceptAtlasId: 'montado' });
        expect(r.rescued).toEqual([{ atlasId: 'a', name: 'Atlas a' }]);
        expect(mundo.adotados).toEqual([{ atlasId: 'a', name: 'Atlas a', options: { makeCurrent: false } }]);
    });

    it('fila vazia não entra; contagem desconhecida entra (conservador)', async () => {
        atlasRemoto('vazio', { ops: 0 });
        atlasRemoto('ilegivel', { ops: 'falha' });
        const r = await saida.preserveUnsyncedWorkOfOtherAtlases();
        expect(r.rescued.map(x => x.atlasId)).toEqual(['ilegivel']);
        expect(r.pendingOps).toBeNaN();
    });

    it('pula o descarte confirmado pela MARCA e pela CERCA', async () => {
        atlasRemoto('marcado', { discardRequested: true });
        atlasRemoto('cercado');
        mundo.cercados.add('cercado');
        const r = await saida.preserveUnsyncedWorkOfOtherAtlases();
        expect(r).toMatchObject({ rescued: [], retained: [], lost: [] });
        expect(mundo.adotados).toEqual([]);
    });

    it('pula o atlas que OUTRA aba viva tem montado', async () => {
        atlasRemoto('vivo-em-outra-aba');
        mundo.montadosPorOutra.add('vivo-em-outra-aba');
        const r = await saida.preserveUnsyncedWorkOfOtherAtlases();
        expect(r.rescued).toEqual([]);
        expect(mundo.adotados).toEqual([]);
    });

    it('não resgata duas vezes o que já é atlas local', async () => {
        atlasRemoto('ja');
        mundo.registro.push({ id: 'slot-ja', name: 'Já resgatado', dbSuffix: 'remote-ja' });
        const r = await saida.preserveUnsyncedWorkOfOtherAtlases();
        expect(r.rescued).toEqual([]);
        expect(mundo.adotados).toEqual([]);
    });
});

describe('preserveUnsyncedWorkOfOtherAtlases: teto e veto', () => {
    it('no teto de atlas locais, retém com o prazo que RESTA e não descarta', async () => {
        mundo.registro = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, dbSuffix: `l${i}` }));
        atlasRemoto('cheio');
        mundo.vetos.set('cheio', Date.now() - 5.5 * HORA);
        const r = await saida.preserveUnsyncedWorkOfOtherAtlases();
        expect(r.rescued).toEqual([]);
        expect(r.retained).toHaveLength(1);
        expect(r.retained[0].atlasId).toBe('cheio');
        expect(r.retained[0].remainingMs).toBeGreaterThan(18 * HORA);
        // O PRAZO QUE RESTA, e não as 24 h cheias: o veto guarda o PRIMEIRO carimbo.
        expect(r.retained[0].remainingMs).toBeLessThanOrEqual(18.5 * HORA);
        expect(saida.otherAtlasesRescueMessage(r).message).toContain('por 18 horas');
    });

    it('um veto VENCIDO não protege nada: o atlas conta como perdido', async () => {
        mundo.registro = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, dbSuffix: `l${i}` }));
        atlasRemoto('vencido');
        mundo.vetos.set('vencido', Date.now() - 25 * HORA);
        const r = await saida.preserveUnsyncedWorkOfOtherAtlases();
        expect(r.retained).toEqual([]);
        expect(r.lost).toEqual([{ atlasId: 'vencido', name: 'Atlas vencido' }]);
    });

    it('sem onde gravar o veto, o atlas conta como perdido', async () => {
        mundo.registro = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, dbSuffix: `l${i}` }));
        mundo.vetoGrava = false;
        atlasRemoto('semveto');
        const r = await saida.preserveUnsyncedWorkOfOtherAtlases();
        expect(r.lost.map(x => x.atlasId)).toEqual(['semveto']);
    });
});

describe('as frases dos outros atlas', () => {
    it('um resgatado, no singular; dois, no plural e nomeados', () => {
        expect(frases.otherAtlasesRescueNotice({ rescued: ['Alfa'] }).message)
            .toBe('O trabalho não enviado de outro atlas foi guardado neste computador como o atlas local "Alfa". Entre de novo e use "Enviar ao servidor".');
        expect(frases.otherAtlasesRescueNotice({ rescued: ['Alfa', 'Bravo'] }).message)
            .toContain('como os atlas locais "Alfa" e "Bravo".');
    });

    it('retido diz o prazo; perdido não promete ação nenhuma e é erro', () => {
        const retido = frases.otherAtlasesRescueNotice({ retained: ['Charlie'], graceMs: 3 * HORA });
        expect(retido).toEqual({
            message: 'Não foi possível guardar como atlas local o trabalho não enviado de "Charlie". Ele fica neste computador por 3 horas: entre de novo e abra esse atlas nesse prazo.',
            tone: 'warning',
        });
        const perdido = frases.otherAtlasesRescueNotice({ lost: ['Delta'] });
        expect(perdido.tone).toBe('error');
        expect(perdido.message).toBe('NÃO foi possível guardar neste computador o trabalho não enviado de "Delta", e ele foi descartado.');
        expect(perdido.message).not.toMatch(/não feche|entre de novo/i);
    });

    it('nada a dizer é null, e o canal da URL ignora código desconhecido', () => {
        expect(frases.otherAtlasesRescueNotice({})).toBeNull();
        expect(frases.otherAtlasesExitNotice('toString,xyz')).toBeNull();
        expect(frases.otherAtlasesExitNotice(null)).toBeNull();
        const url = frases.otherAtlasesExitNotice('guardado,retido', { graceMs: PRAZO });
        expect(url.tone).toBe('warning');
        expect(url.message).toContain('como atlas locais');
        expect(url.message).toContain('por até 24 horas');
        expect(frases.otherAtlasesExitNotice('perdido').tone).toBe('error');
    });
});

describe('preserveUnsyncedWorkOnLostSession: cada atlas com o seu desfecho', () => {
    it('o montado sem pendência e um outro resgatado: o desfecho do montado fica NADA, e o outro viaja em others', async () => {
        atlasRemoto('outro');
        atlasRemoto('montado', { ops: 0 });
        const r = await saida.preserveUnsyncedWorkOnLostSession({ atlasId: 'montado' });
        expect(r.outcome).toBe(frases.ExitOutcome.NADA);
        expect(r.pendingOps).toBe(0);
        expect(r.others).toEqual([frases.OtherAtlasesOutcome.GUARDADO]);
        expect(r.message).toContain('"Atlas outro"');
    });
});
