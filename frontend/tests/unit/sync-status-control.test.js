// Path: tests/unit/sync-status-control.test.js

/**
 * @fileoverview A LUZ COLETA OS SETE SINAIS, e o verde dela exige os sete (achado F14).
 *
 * `sync-status-pendencias.test.js` cobra a DECISÃO (a função pura). Este arquivo cobra a COLETA,
 * que é a outra metade e a que de fato regrediu: até 2026-09-13 o controle lia só o censo da fila
 * (`countByState`) e somava os três números num só, então três pendências inteiras nunca chegavam
 * à decisão e o atributo pintado era verde com elas de pé:
 *
 *   - a quarentena global, que sobrevive ao fim de uma sessão à espera de decisão;
 *   - as pendências de upload de figura, que não têm operação incremental nenhuma;
 *   - a recuperação em curso, que reescreve os bancos por baixo da leitura.
 *
 * ELE MEDE O QUE VAI PARA O DOM, e não o retorno de um método: o que a pessoa lê é
 * `data-work`/`data-tone` no crachá, então é isso que se afirma. O documento é um duplo mínimo, no
 * molde de `aviso-de-camada-que-nao-carrega.test.js`, porque o ambiente é node e não há jsdom.
 *
 * A IDENTIDADE DO ESCOPO É ASSERIDA, e não é zelo: `storeWritesPaused` consulta um `WeakMap`
 * chaveado por OBJETO, e `remoteScope()` devolve objeto novo a cada chamada. Passar um escopo
 * recém-construído em vez do ativo devolveria `false` para sempre, em silêncio, e a luz voltaria a
 * ficar verde durante a recuperação sem que nada acusasse.
 *
 * CONTROLE NEGATIVO, conferido em 2026-09-13 restaurando a coleta antiga (só `countByState`, com
 * os três números somados em `pending`, sem quarentena, sem blobs e sem recuperação): 6 casos
 * reprovados aqui, e os três primeiros pela razão exata do achado, saindo `enviado`/`ok`.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Estado que os duplos leem, e que cada caso arruma
// ---------------------------------------------------------------------------

const ESCOPO_ATIVO = { kind: 'remote', atlasId: 'a1', dbSuffix: 'remote__a1' };

const cenario = {
    autenticado: true,
    remoto: true,
    conexao: 'online',
    censo: { pendentes: 0, preparadas: 0, problemas: 0 },
    censoErro: null,
    quarentena: [],
    blobs: [],
    blobsErro: null,
    pausado: false,
    /** Os escopos que o controle passou a `storeWritesPaused`, para conferir a IDENTIDADE. */
    escoposConsultados: [],
};

vi.mock('@store/services.js', () => ({
    getEventBus: () => ({ on() {}, off() {}, subscribe() { return () => {}; } }),
}));

vi.mock('@store/sync/connection-state.js', () => ({
    connectionState: { getState: () => cenario.conexao },
    ConnectionStates: Object.freeze({
        ONLINE: 'online', CONNECTING: 'connecting', RECONNECTING: 'reconnecting', OFFLINE: 'offline',
    }),
}));

vi.mock('@store/sync/session-context.js', () => ({
    sessionContext: { isAuthenticated: () => cenario.autenticado },
}));

vi.mock('@store/store-origin.js', () => ({ isRemoteStoreSync: () => cenario.remoto }));

vi.mock('@store/sync/operation-queue.js', () => ({
    operationQueue: {
        async countByState() {
            if (cenario.censoErro) throw cenario.censoErro;
            return cenario.censo;
        },
    },
}));

vi.mock('@store/sync/quarantine-registry.js', () => ({
    listQuarantinedOperations: async () => cenario.quarentena,
}));

vi.mock('@store/sync/blob-upload-queue.js', () => ({
    BlobUploadState: Object.freeze({
        PENDENTE: 'pendente', CONFIRMADO: 'confirmado', RECUSADO: 'recusado',
    }),
    listarPendenciasDeBlob: async () => {
        if (cenario.blobsErro) throw cenario.blobsErro;
        return cenario.blobs;
    },
}));

vi.mock('@store/write-coordinator.js', () => ({
    storeWritesPaused: (scope) => {
        cenario.escoposConsultados.push(scope);
        return cenario.pausado;
    },
}));

vi.mock('@store/atlas-namespace.js', () => ({ getActiveScope: () => ESCOPO_ATIVO }));

vi.mock('@store/sync/resource-access.service.js', () => ({
    isResourceAccessDegraded: () => false,
    onResourceAccessHealthChanged: () => () => {},
    retryVisibleResources: async () => true,
}));

// O laço de limpeza não é o assunto aqui, e o real precisa de um barramento de verdade.
vi.mock('@utils/event-cleanup.js', () => ({
    setupCleanup() {},
    subscribe() {},
    addDomListener() {},
    trackTimer() {},
    cleanup() {},
    removeElement() {},
}));

// ---------------------------------------------------------------------------
// Documento mínimo
// ---------------------------------------------------------------------------

/** Só o que `onAdd` e `_render` tocam. */
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
        setAttribute(name, value) { el.attributes[name] = value; },
        getAttribute(name) { return el.attributes[name]; },
        appendChild(child) { el.children.push(child); return child; },
        append(...kids) { for (const kid of kids) el.appendChild(kid); },
        addEventListener() {},
        removeEventListener() {},
    };
    return el;
}

const documentoOriginal = globalThis.document;
globalThis.document = { createElement: makeElement, addEventListener() {}, hidden: false };
afterAll(() => {
    if (documentoOriginal === undefined) delete globalThis.document;
    else globalThis.document = documentoOriginal;
});

const { SyncStatusControl } = await import('../../src/js/account/sync-status.control.js');

/**
 * Monta o controle, faz UMA leitura e devolve o que foi pintado.
 * @returns {Promise<{work: string, tone: string, label: string, title: string}>}
 */
async function pintar() {
    const control = new SyncStatusControl();
    const container = control.onAdd({});
    await control._readQueue();
    return {
        work: container.getAttribute('data-work'),
        tone: container.getAttribute('data-tone'),
        label: container.children
            .find((c) => c.getAttribute('data-testid') === 'sync-status-label')?.textContent,
        title: container.getAttribute('title'),
    };
}

beforeEach(() => {
    Object.assign(cenario, {
        autenticado: true,
        remoto: true,
        conexao: 'online',
        censo: { pendentes: 0, preparadas: 0, problemas: 0 },
        censoErro: null,
        quarentena: [],
        blobs: [],
        blobsErro: null,
        pausado: false,
        escoposConsultados: [],
    });
});

describe('o crachá pinta o que coletou', () => {
    it('CONTROLE DE VÁCUO: sem pendência nenhuma, conectado, o atributo é verde', async () => {
        // Sem este caso todo "não é verde" abaixo passaria com um controle que nunca pinta verde.
        const pintado = await pintar();
        expect(pintado.work).toBe('enviado');
        expect(pintado.tone).toBe('ok');
        expect(pintado.label).toBe('Tudo enviado');
    });

    it('QUARENTENA com a fila em zero NÃO fica verde', async () => {
        // A regressão por extenso: até este lote o controle não lia este registro, e a fila em zero
        // pintava verde sobre trabalho guardado esperando decisão da pessoa.
        cenario.quarentena = [{ atlasId: 'a1' }, { atlasId: 'a1' }];
        const pintado = await pintar();
        expect(pintado.work).toBe('conflito');
        expect(pintado.tone).toBe('warn');
        expect(pintado.title).toContain('2 alterações');
    });

    it('UPLOAD DE FIGURA pendente com a fila em zero NÃO fica verde', async () => {
        cenario.blobs = [
            { estado: 'pendente' },
            { estado: 'confirmado' },
        ];
        const pintado = await pintar();
        expect(pintado.work).toBe('upload-pendente');
        // Confirmado não conta: contá-lo deixaria a luz âmbar para sempre depois da primeira
        // figura, e aviso permanente é aviso que se aprende a ignorar.
        expect(pintado.label).toBe('Imagens: 1');
    });

    it('upload RECUSADO em definitivo entra na contagem e sobe o tom para alarme', async () => {
        cenario.blobs = [{ estado: 'recusado' }, { estado: 'pendente' }];
        const pintado = await pintar();
        expect(pintado.work).toBe('upload-pendente');
        expect(pintado.tone).toBe('warn');
        expect(pintado.label).toBe('Imagens: 2');
    });

    it('RECUPERAÇÃO em curso com a fila em zero NÃO fica verde', async () => {
        cenario.pausado = true;
        const pintado = await pintar();
        expect(pintado.work).toBe('recuperando');
        expect(pintado.tone).toBe('busy');
    });

    it('RECUSA na fila sai como recusa, e não como envio em curso', async () => {
        // Antes deste lote os três números do censo eram SOMADOS num só, então uma recusa saía
        // como "Enviando 1…", isto é, prometendo progresso que não existe.
        cenario.censo = { pendentes: 0, preparadas: 0, problemas: 1 };
        const pintado = await pintar();
        expect(pintado.work).toBe('recusa');
        expect(pintado.label).toBe('Recusas: 1');
    });

    it('preparada conta como trabalho à espera, e não como problema', async () => {
        cenario.censo = { pendentes: 1, preparadas: 2, problemas: 0 };
        const pintado = await pintar();
        expect(pintado.work).toBe('enviando');
        expect(pintado.title).toContain('3 alterações');
    });
});

describe('a coleta falha FECHADA', () => {
    it('censo ilegível apaga TODOS os números, e nenhum deles vira zero', async () => {
        cenario.censoErro = new Error('IndexedDB fora');
        cenario.quarentena = [{ atlasId: 'a1' }];
        const pintado = await pintar();
        // Não pode sair 'conflito' a partir de uma leitura que a mesma `Promise.all` abortou: ali o
        // número da quarentena nunca foi atribuído, e usar o valor anterior seria censo inventado.
        expect(pintado.work).toBe('desconhecido');
        expect(pintado.tone).toBe('unknown');
    });

    it('pendência de blob ilegível também apaga tudo', async () => {
        cenario.blobsErro = new Error('imagens fora');
        const pintado = await pintar();
        expect(pintado.work).toBe('desconhecido');
    });

    it('antes da primeira leitura o crachá diz que está verificando', async () => {
        const control = new SyncStatusControl();
        const container = control.onAdd({});
        expect(container.getAttribute('data-work')).toBe('verificando');
    });
});

describe('a recuperação é perguntada pelo escopo ATIVO', () => {
    it('o objeto passado é o mesmo que `getActiveScope` devolve, por identidade', async () => {
        await pintar();
        expect(cenario.escoposConsultados.length).toBeGreaterThan(0);
        for (const scope of cenario.escoposConsultados) expect(scope).toBe(ESCOPO_ATIVO);
    });
});

describe('atlas local e visitante', () => {
    it('atlas local não lê a fila e continua neutro', async () => {
        cenario.remoto = false;
        cenario.quarentena = [{ atlasId: 'a1' }];
        const pintado = await pintar();
        expect(pintado.work).toBe('local');
        expect(pintado.tone).toBe('idle');
    });

    it('visitante anônimo esconde o crachá inteiro', async () => {
        cenario.autenticado = false;
        const control = new SyncStatusControl();
        const container = control.onAdd({});
        expect(container.hidden).toBe(true);
    });
});
