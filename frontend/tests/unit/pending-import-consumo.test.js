// Path: tests/unit/pending-import-consumo.test.js

/**
 * @fileoverview O `.ebgeo` que "Seus atlas" deixa para o mapa some do banco global em TODO caminho,
 * e o caminho que interessa é o que falha.
 *
 * A ENTREGA E O SEU CUSTO. A tela não tem store nem importador, então ela grava os bytes do arquivo
 * sob `GlobalKey.PENDING_IMPORT` e navega; o boot do mapa consome. Acontece que o banco global é o
 * ÚNICO que nenhum expurgo deste repositório alcança (nem o wipe de atlas, nem a destruição de
 * namespace, nem a varredura de logout). Um consumidor que só apagasse a entrega no SUCESSO deixaria
 * um arquivo de megabytes preso ali para sempre e o re-tentaria a cada F5, falhando igual. Por isso
 * `takePendingImport` lê-e-apaga incondicionalmente, e por isso o consumo tem UMA tentativa: o
 * arquivo continua no disco do usuário.
 *
 * `tests/unit/atlas-namespace.test.js` já prende o lado de baixo (a chave é removida antes de ser
 * validada). O que faltava é o lado de cima, que é onde o lixo nasce: o consumidor do boot decide
 * ACEITAR ou DECLINAR em quatro ramos, e em três deles não há import nenhum. Se qualquer um desses
 * ramos passar a sair antes do `takePendingImport` — a forma natural de escrever "só apago quando
 * der certo" — a entrega vira permanente, sem erro nenhum.
 *
 * O consumidor mora em `deep-link/pending-import.js` e não em `index.js` pelo motivo que
 * `route-decision.js` já registra: `index.js` roda `initApp()` no import, então nada dele é
 * alcançável por teste. O que É injetado aqui são os efeitos do mapa (o importador e o toast); a
 * leitura e o apagamento vêm do módulo REAL, senão este arquivo estaria medindo o próprio dublê.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { databases, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();
    function makeStore({ name, storeName = null }) {
        const key = `${name}::${storeName || 'keyvaluepairs'}`;
        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);
        return {
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); })
        };
    }
    return { databases, makeStore, resetFake: () => databases.clear() };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(async () => {})
    }
}));

const GLOBAL_DISK = 'ebgeo_global::keyvaluepairs';
const SLOT = 'slot-do-arquivo';
const BYTES = new Uint8Array([1, 2, 3, 4]).buffer;

let ns;
let consumir;
let avisos;

/** @returns {boolean} Se a entrega ainda está no disco falso. Lido pelas CHAVES, não pela API. */
function entregaNoDisco() {
    return databases.get(GLOBAL_DISK)?.has('pending_import') ?? false;
}

/** Um importador de mentira que registra o que recebeu. */
function importadorFalso(impl) {
    const processFileDirectly = vi.fn(impl ?? (async () => {}));
    return { service: { processFileDirectly }, processFileDirectly };
}

beforeEach(async () => {
    vi.resetModules();
    resetFake();
    avisos = [];
    // O MESMO grafo de módulos para os dois: `pending-import.js` tem que enxergar a instância de
    // `atlas-namespace.js` que este teste semeia, ou o sujeito e o instrumento seriam duas cópias.
    ns = await import('@store/atlas-namespace.js');
    ({ consumePendingEbgeoImport: consumir } = await import('@js/deep-link/pending-import.js'));
});

/**
 * @param {Object} [options]
 * @returns {Promise<boolean>} O retorno do consumidor.
 */
function consumo({ hasDeepLink = false, importador = importadorFalso().service } = {}) {
    return consumir({
        hasDeepLink,
        getImporter: () => importador,
        notify: (message, level) => avisos.push({ message, level })
    });
}

/** Semeia a entrega e monta o slot local que a tela teria criado para ela. */
async function entregaPronta() {
    await ns.savePendingImport({ atlasId: SLOT, name: 'Operação Alfa', data: BYTES });
    ns.activateScope(ns.localScope(SLOT, SLOT));
    // Positiva antes das negativas: sem ela, "a entrega sumiu" não distingue consumo de uma
    // entrega que nunca foi gravada.
    expect(entregaNoDisco()).toBe(true);
}

describe('o .ebgeo pendente: o caminho feliz', () => {
    it('importa no slot que a tela criou, com o nome do arquivo, e assume o boot', async () => {
        await entregaPronta();
        const { service, processFileDirectly } = importadorFalso();

        const assumiu = await consumo({ importador: service });

        expect(assumiu).toBe(true);
        expect(processFileDirectly).toHaveBeenCalledTimes(1);
        const [arquivo, aditivo] = processFileDirectly.mock.calls[0];
        expect(arquivo).toBeInstanceOf(File);
        expect(arquivo.name).toBe('Operação Alfa.ebgeo');
        expect(new Uint8Array(await arquivo.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
        // Não aditivo: o slot foi criado vazio para este arquivo, e é o modo que substitui.
        expect(aditivo).toBe(false);
        expect(avisos).toEqual([]);
        expect(entregaNoDisco()).toBe(false);
    });

    it('a entrega já sumiu do disco NO INSTANTE em que o importador roda', async () => {
        // A ordem é a propriedade: apagar depois de importar deixaria a chave de pé se o importador
        // travasse a aba no meio, e o F5 seguinte reimportaria o mesmo arquivo.
        await entregaPronta();
        let existiaDuranteOImport = null;
        const { service } = importadorFalso(async () => { existiaDuranteOImport = entregaNoDisco(); });

        await consumo({ importador: service });

        expect(existiaDuranteOImport).toBe(false);
    });
});

describe('o .ebgeo pendente: a entrega some também quando NÃO é importada', () => {
    it('importador que LANÇA: a entrega já foi apagada, e o usuário ouve o erro', async () => {
        // O caso que vira lixo se ninguém testar. O arquivo falhou ao abrir (arquivo corrompido,
        // versão futura), e o único jeito de a próxima carga não repetir a mesma falha é a entrega
        // já não existir.
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        await entregaPronta();
        const { service } = importadorFalso(async () => { throw new Error('arquivo corrompido'); });

        const assumiu = await consumo({ importador: service });

        // Assumiu o boot mesmo falhando: a cadeia de roteamento não pode rodar por cima de um
        // importador que já mexeu no escopo montado.
        expect(assumiu).toBe(true);
        expect(entregaNoDisco()).toBe(false);
        expect(avisos).toEqual([
            { message: 'Não foi possível abrir o arquivo .ebgeo.', level: 'error' }
        ]);
        expect(erro).toHaveBeenCalled();
        erro.mockRestore();
    });

    it('importador AUSENTE (controle não registrado): apaga, avisa e devolve o boot', async () => {
        await entregaPronta();

        const assumiu = await consumo({ importador: null });

        expect(assumiu).toBe(false);
        expect(entregaNoDisco()).toBe(false);
        expect(avisos[0].level).toBe('error');
        expect(avisos[0].message).toContain('Seus atlas');
    });

    it('deep link na URL: declina (um arquivo nunca entra num atlas de servidor) e apaga', async () => {
        await entregaPronta();
        const { service, processFileDirectly } = importadorFalso();

        const assumiu = await consumo({ hasDeepLink: true, importador: service });

        expect(assumiu).toBe(false);
        expect(processFileDirectly).not.toHaveBeenCalled();
        expect(entregaNoDisco()).toBe(false);
        expect(avisos[0].level).toBe('warning');
        expect(avisos[0].message).toContain('outro projeto');
    });

    it('escopo REMOTO montado: declina e apaga', async () => {
        await ns.savePendingImport({ atlasId: SLOT, name: 'Operação Alfa', data: BYTES });
        ns.activateScope(ns.remoteScope('11111111-1111-4111-8111-111111111111'));
        expect(entregaNoDisco()).toBe(true);
        const { service, processFileDirectly } = importadorFalso();

        expect(await consumo({ importador: service })).toBe(false);
        expect(processFileDirectly).not.toHaveBeenCalled();
        expect(entregaNoDisco()).toBe(false);
    });

    it('a aba foi parar em OUTRO atlas local: declina e apaga', async () => {
        // Import não aditivo SUBSTITUI o atlas em que cai: importar aqui apagaria o trabalho de um
        // slot que o usuário não escolheu para este arquivo.
        await ns.savePendingImport({ atlasId: SLOT, name: 'Operação Alfa', data: BYTES });
        ns.activateScope(ns.localScope('outro-slot', 'outro-slot'));
        const { service, processFileDirectly } = importadorFalso();

        expect(await consumo({ importador: service })).toBe(false);
        expect(processFileDirectly).not.toHaveBeenCalled();
        expect(entregaNoDisco()).toBe(false);
    });

    it('registro podre (versão de outro deploy): declina calado, e ele também some', async () => {
        // Nem toast: não houve gesto do usuário nesta aba a que responder, e o registro é ilegível.
        await ns.getGlobalStore().setItem('pending_import', { version: 99, atlasId: SLOT });
        ns.activateScope(ns.localScope(SLOT, SLOT));
        const { service, processFileDirectly } = importadorFalso();

        expect(await consumo({ importador: service })).toBe(false);
        expect(processFileDirectly).not.toHaveBeenCalled();
        expect(entregaNoDisco()).toBe(false);
        expect(avisos).toEqual([]);
    });
});

describe('o .ebgeo pendente: o boot NORMAL, que é o caso de quase todo mundo', () => {
    it('sem entrega nenhuma: não avisa, não importa, e devolve o boot para a cadeia', async () => {
        ns.activateScope(ns.localScope(SLOT, SLOT));
        const { service, processFileDirectly } = importadorFalso();

        expect(await consumo({ importador: service })).toBe(false);
        expect(processFileDirectly).not.toHaveBeenCalled();
        expect(avisos).toEqual([]);
    });

    it('banco global ilegível: o boot segue, em vez de morrer numa leitura opcional', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        ns.activateScope(ns.localScope(SLOT, SLOT));
        ns.getGlobalStore().getItem.mockRejectedValueOnce(new Error('idb morto'));
        const { service, processFileDirectly } = importadorFalso();

        expect(await consumo({ importador: service })).toBe(false);
        expect(processFileDirectly).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('e o consumidor é o que o boot do mapa realmente chama', () => {
    it('index.js importa este módulo e não guarda uma segunda cópia da decisão', async () => {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const fonte = readFileSync(
            fileURLToPath(new URL('../../src/js/index.js', import.meta.url)), 'utf8'
        );
        expect(fonte).toContain("from './deep-link/pending-import.js'");
        // E não lê mais a entrega por conta própria: duas cópias da regra é como uma delas para de
        // apagar sem ninguém notar.
        expect(fonte).not.toContain('takePendingImport');
    });
});
