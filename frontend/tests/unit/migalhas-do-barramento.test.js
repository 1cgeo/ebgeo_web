// Path: tests/unit/migalhas-do-barramento.test.js

/**
 * @fileoverview A ESCUTA DO BARRAMENTO, e o que ela NÃO deixa passar.
 *
 * O CASO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR é o mesmo que `formaDeValor` fechou do outro lado da
 * telemetria: o payload de um evento deste produto carrega o `nome` que a pessoa escreveu, as
 * coordenadas decimais de onde ela está e o id de quem ela é, e telemetria é o tipo de dado que
 * acaba num log, num relatório e num anexo de e-mail. O caso de privacidade emite TODOS os eventos
 * observados com um payload hostil e procura os três vazamentos por texto.
 *
 * A LISTA DE EVENTOS VEM DO PRÓPRIO MÓDULO (`EVENTOS_OBSERVADOS`), e não escrita à mão aqui: uma
 * lista à mão deixaria o evento novo sem cobertura de privacidade no dia em que ele entrasse na
 * allowlist, que é justamente o dia em que ela é necessária.
 *
 * CONTROLE NEGATIVO conferido revertendo: troque `partes.push(rotulo)` por `partes.push(
 * JSON.stringify(payload))` e o caso de privacidade fica vermelho nos três termos; tire o
 * `REGRAS.get(evento)` e o caso do evento fora da allowlist fica vermelho.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventTypes } from '@events/event_types.js';
import { StoreErrorEvents } from '@store/store-errors.js';
import { migalhas, TipoDeMigalha } from '@js/session/migalhas.js';
import {
    EVENTOS_OBSERVADOS,
    instalarMigalhasDoBarramento,
} from '@js/session/migalhas-do-barramento.js';

/** Um barramento de mentira com a única superfície que a escuta usa. */
function criarBarramento() {
    const ouvintes = new Set();
    return {
        onAny(fn) {
            ouvintes.add(fn);
            return () => ouvintes.delete(fn);
        },
        emitir(evento, payload) {
            for (const fn of [...ouvintes]) fn(evento, payload);
        },
        quantos() {
            return ouvintes.size;
        },
    };
}

/**
 * O PAYLOAD HOSTIL: tudo que um evento deste produto de fato carrega e que não pode viajar.
 * @param {Object} [extra] - Os campos enumerados que o evento em questão tem.
 */
function payloadHostil(extra = {}) {
    return {
        properties: { nome: 'Cel Fulano', descricao: 'Posto do Cel Fulano' },
        geometry: { type: 'Point', coordinates: [-43.98765, -22.12345] },
        userId: 'u-1',
        feature: { id: 'f-1', properties: { nome: 'Cel Fulano' } },
        featureId: 'f-1',
        mapName: 'Mapa do Cel Fulano',
        ...extra,
    };
}

/** Os textos das migalhas registradas até agora. */
const textos = () => migalhas.listar().map((m) => m.texto);

let soltar = null;
let bus = null;

beforeEach(() => {
    migalhas.limpar();
    bus = criarBarramento();
    soltar = instalarMigalhasDoBarramento(bus);
});

afterEach(() => {
    // A assinatura é módulo-global de propósito (uma por página); soltá-la é o que mantém os casos
    // independentes.
    soltar?.();
    soltar = null;
    migalhas.limpar();
});

describe('PRIVACIDADE: o payload nunca viaja', () => {
    it('nenhum evento observado deixa escapar nome, coordenada ou id de pessoa', () => {
        // A guarda do próprio guarda: uma allowlist esvaziada faria este caso passar sem ter
        // emitido nada.
        expect(EVENTOS_OBSERVADOS.length).toBeGreaterThanOrEqual(12);

        for (const evento of EVENTOS_OBSERVADOS) {
            bus.emitir(evento, payloadHostil({
                // Os campos enumerados de TODOS os eventos, juntos, para que cada um leia o seu.
                mode: 'ONLINE', role: 'owner', currentState: 'ONLINE', previousState: 'OFFLINE',
                group: 'draw', kind: 'remote', reason: 'map_locked', operation: 'transaction',
            }));
        }

        const trilha = textos().join(' | ');
        expect(trilha, 'o nome escrito pela pessoa vazou').not.toContain('Fulano');
        expect(trilha, 'a coordenada vazou').not.toContain('43.98');
        expect(trilha, 'o id de usuário vazou').not.toContain('u-1');
        expect(trilha).not.toContain('f-1');
        expect(trilha).not.toContain('properties');
        expect(trilha).not.toContain('geometry');
        // E o piso: a trilha NÃO está vazia, senão o verde acima seria vácuo.
        expect(migalhas.tamanho()).toBeGreaterThan(0);
    });

    it('o `userId` de `SESSION_CHANGED` fica de fora, e `mode`/`role` entram', () => {
        bus.emitir(EventTypes.SESSION_CHANGED, { mode: 'ONLINE', userId: 'u-1', role: 'manager' });
        const [migalha] = migalhas.listar();
        expect(migalha.tipo).toBe(TipoDeMigalha.SESSAO);
        expect(migalha.texto).toContain('ONLINE');
        expect(migalha.texto).toContain('manager');
        expect(migalha.texto).not.toContain('u-1');
    });

    it('um `operation` que é texto de gente NÃO passa a porteira de forma', () => {
        // `layer.manager.js` monta `persist <rótulo> [<chave>]`, e a chave é o nome de um mapa. A
        // migalha degrada para o nome do evento sozinho, que é o desfecho certo.
        bus.emitir(StoreErrorEvents.STORE_PERSIST_ERROR, {
            operation: 'persist layers [Mapa do Cel Fulano]',
            error: 'QuotaExceededError',
        });
        expect(textos()).toEqual([StoreErrorEvents.STORE_PERSIST_ERROR]);
    });

    it('um `operation` que É símbolo passa', () => {
        bus.emitir(StoreErrorEvents.STORE_PERSIST_ERROR, { operation: 'transaction' });
        expect(textos()).toEqual([`${StoreErrorEvents.STORE_PERSIST_ERROR} transaction`]);
    });
});

describe('a ALLOWLIST: o que não está nela não produz migalha', () => {
    it('evento fora da lista é ignorado numa falta de chave', () => {
        bus.emitir(EventTypes.FEATURE_CREATED, payloadHostil());
        bus.emitir(EventTypes.TEMPORAL_CURSOR_CHANGED, { cursor: 1712345678901 });
        bus.emitir(EventTypes.PRESENCE_CURSORS_CHANGED, { mapId: 'm-1' });
        bus.emitir('evento:inventado', payloadHostil());
        expect(migalhas.tamanho()).toBe(0);
    });

    it('herança de protótipo não é evento observado', () => {
        // A chave vem de quem emitiu; um objeto literal responderia por `toString`.
        bus.emitir('toString', payloadHostil());
        bus.emitir('constructor', payloadHostil());
        expect(migalhas.tamanho()).toBe(0);
    });

    it('os três eventos de ERRO do store estão na lista (eles não moram em `EventTypes`)', () => {
        for (const evento of Object.values(StoreErrorEvents)) {
            expect(EVENTOS_OBSERVADOS).toContain(evento);
        }
    });

    it('`STORE_OPERATION_BLOCKED` carrega o motivo, e só ele', () => {
        bus.emitir(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'addFeature', reason: 'map_locked', mapName: 'Mapa do Cel Fulano',
        });
        expect(textos()).toEqual([`${StoreErrorEvents.STORE_OPERATION_BLOCKED} map_locked`]);
    });

    it('a conexão carrega o estado de DESTINO, nunca o anterior', () => {
        bus.emitir(EventTypes.CONNECTION_STATE_CHANGED, {
            previousState: 'RECONNECTING', currentState: 'ONLINE',
        });
        const [migalha] = migalhas.listar();
        expect(migalha.tipo).toBe(TipoDeMigalha.CONEXAO);
        expect(migalha.texto).toContain('ONLINE');
        expect(migalha.texto).not.toContain('RECONNECTING');
    });

    it('a barra de ferramentas carrega o GRUPO, que é enumerado', () => {
        bus.emitir(EventTypes.TOOLBAR_GROUP_OPENED, { group: 'military' });
        expect(textos()).toEqual([`${EventTypes.TOOLBAR_GROUP_OPENED} military`]);
    });

    it('a troca de atlas carrega o `kind`, nunca o id', () => {
        bus.emitir(EventTypes.ATLAS_SWITCHED, {
            kind: 'local', atlasId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', mapId: 'm-1',
        });
        expect(textos()).toEqual([`${EventTypes.ATLAS_SWITCHED} local`]);
    });

    it('os visualizadores pesados entram sem campo nenhum', () => {
        bus.emitir(EventTypes.VIEWER_3D_OPENED, { tilesetId: 'modelo-secreto' });
        bus.emitir(EventTypes.STREETVIEW_360_OPENED, { photoName: 'foto do quartel' });
        expect(textos()).toEqual([EventTypes.VIEWER_3D_OPENED, EventTypes.STREETVIEW_360_OPENED]);
    });

    it('a apresentação de briefing entra sem o id', () => {
        bus.emitir(EventTypes.BRIEFING_PRESENT_STARTED, { briefingId: 'b-1' });
        bus.emitir(EventTypes.BRIEFING_PRESENT_ENDED, { briefingId: 'b-1' });
        expect(textos()).toEqual([
            EventTypes.BRIEFING_PRESENT_STARTED, EventTypes.BRIEFING_PRESENT_ENDED,
        ]);
    });
});

describe('a escuta NUNCA quebra a entrega de evento', () => {
    it('payload com getter hostil não lança e não impede a migalha', () => {
        const hostil = {};
        Object.defineProperty(hostil, 'reason', {
            get() { throw new Error('getter explosivo'); },
            enumerable: true,
        });
        expect(() => bus.emitir(StoreErrorEvents.STORE_OPERATION_BLOCKED, hostil)).not.toThrow();
        expect(textos()).toEqual([StoreErrorEvents.STORE_OPERATION_BLOCKED]);
    });

    it('payload ausente ou primitivo não lança', () => {
        for (const payload of [undefined, null, 42, 'texto']) {
            expect(() => bus.emitir(EventTypes.VIEWER_3D_CLOSED, payload)).not.toThrow();
        }
        expect(migalhas.tamanho()).toBe(4);
    });
});

describe('a instalação: uma assinatura só, idempotente', () => {
    it('instala UMA assinatura e devolve como soltá-la', () => {
        expect(bus.quantos()).toBe(1);
        soltar();
        expect(bus.quantos()).toBe(0);
        soltar = null;
    });

    it('a segunda chamada NÃO dobra a assinatura (migalha duplicada é contagem falsa)', () => {
        const segunda = instalarMigalhasDoBarramento(bus);
        expect(bus.quantos()).toBe(1);
        bus.emitir(EventTypes.VIEWER_3D_OPENED, {});
        expect(migalhas.tamanho()).toBe(1);
        expect(segunda).toBe(soltar);
    });

    it('depois de soltar, uma nova instalação volta a funcionar', () => {
        soltar();
        soltar = instalarMigalhasDoBarramento(bus);
        expect(bus.quantos()).toBe(1);
        bus.emitir(EventTypes.VIEWER_3D_OPENED, {});
        expect(migalhas.tamanho()).toBe(1);
    });

    it('barramento sem `onAny` degrada para no-op, e não lança', () => {
        soltar();
        soltar = null;
        for (const ruim of [undefined, null, {}, { onAny: 'não é função' }]) {
            const remover = instalarMigalhasDoBarramento(ruim);
            expect(typeof remover).toBe('function');
            expect(() => remover()).not.toThrow();
        }
    });
});

describe('fiação: só o MAPA instala a escuta', () => {
    /** @returns {string} A fonte de um entry. */
    function fonte(relativo) {
        return readFileSync(fileURLToPath(new URL(`../../${relativo}`, import.meta.url)), 'utf8');
    }

    it('`index.js` importa e CHAMA `instalarMigalhasDoBarramento`', () => {
        const texto = fonte('src/js/index.js');
        expect(texto.length, 'o entry veio vazio: o caminho não resolve').toBeGreaterThan(500);
        expect(texto).toContain('migalhas-do-barramento.js');
        // A CHAMADA, e não só o import: um import sem chamada é fiação que não liga nada.
        expect(texto).toMatch(/instalarMigalhasDoBarramento\(/);
    });

    it('a chamada vem DEPOIS de `initServices()`, que é quem cria o barramento', () => {
        const texto = fonte('src/js/index.js');
        const servicos = texto.indexOf('initServices();');
        const escuta = texto.indexOf('instalarMigalhasDoBarramento(getEventBus())');
        expect(servicos, 'o `initServices()` sumiu do entry').toBeGreaterThan(-1);
        expect(escuta, 'a chamada da escuta sumiu do entry').toBeGreaterThan(-1);
        expect(escuta).toBeGreaterThan(servicos);
    });

    const SEM_MAPA = [
        'src/js/projects/projects-page.js',
        'src/js/admin/admin-page.js',
        'src/js/calibration/calibracao-page.js',
    ];

    it.each(SEM_MAPA)('%s NÃO importa a escuta (não há barramento lá)', (relativo) => {
        const texto = fonte(relativo);
        expect(texto.length, `${relativo} veio vazio: o caminho não resolve`).toBeGreaterThan(200);
        expect(texto).not.toContain('migalhas-do-barramento');
    });
});
