// Path: tests/unit/briefing-autosave-descarrega.test.js

/**
 * @fileoverview O AUTOSAVE DO EDITOR DE BRIEFING DESCARREGA NOS TRÊS PONTOS DE RISCO.
 *
 * O QUE ESTÁ EM JOGO, e não é durabilidade de gravação. A store de briefing já é write-ahead: o
 * que ela promete é que uma edição que CHEGA nela ou é durável ou deixa intenção recuperável. O
 * editor, porém, segura a edição em MEMÓRIA por 1500 ms antes de chamá-la (`_scheduleAutosave`),
 * e até 2026-09-13 só três caminhos internos descarregavam essa represa (capturar posição,
 * importar slides, navegar a prévia). Fechar a aba, perder a conexão ou trocar de atlas dentro
 * daquela janela perdia a edição ANTES de a store saber que ela existia, e nenhuma garantia da
 * store alcança isso.
 *
 * COMO ESTE ARQUIVO MEDE. Ele monta uma instância pela PROTOTYPE (a classe real, sem DOM: o
 * ambiente é node) e dirige os dois métodos que decidem — `_wireAutosaveFlushTriggers` e
 * `_flushAutosave` — com `_save` espionado, um `window` duplo e o barramento duplo. Os
 * ajudantes de limpeza são os REAIS (`@utils/event-cleanup.js`), porque parte do que se afirma
 * aqui é que `cleanup` retira tudo: o editor abre e fecha muitas vezes por sessão, e ouvinte de
 * `window` que sobrevive ao fechamento acumula e grava briefing que ninguém editou.
 *
 * O QUE UM VERDE AQUI NÃO PROVA, declarado:
 *
 *  1. Não prova que `open()` chama a fiação. A chamada é uma linha do fluxo de abertura, que
 *     precisa de DOM, de Quill e de mapa; quem a cobre é a captura de Playwright.
 *  2. Não prova que o navegador de verdade dá tempo ao `beforeunload`. Ele NÃO dá: o flush é
 *     disparado e não aguardado ali, por contrato, e isso é best-effort medido como intenção
 *     (o `_save` é CHAMADO), nunca como garantia de que o disco recebeu.
 *  3. Não prova nada sobre a troca de atlas ao vivo ponta a ponta. O que ele prende é o lado
 *     defensivo: com o escopo trocado, o autosave é RECUSADO em vez de gravar o briefing de um
 *     atlas dentro de outro.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupCleanup, cleanup } from '../../src/js/utilities/event-cleanup.js';
import { activateScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { ConnectionStates } from '../../src/js/store/sync/connection-state.js';
import { EventTypes } from '../../src/js/events/event_types.js';
import { BriefingEditorControl } from '../../src/js/briefing/editor/briefing-editor.control.js';

/** Os ouvintes de `window` registrados pelo duplo, na ordem. */
let janela;
/** Os assinantes do barramento, por tipo de evento. */
let barramento;
let editor;
let save;

/** Dispara um ouvinte de `window` pelo nome do evento. */
function dispararNaJanela(evento) {
    for (const l of janela.listeners) {
        if (l.event === evento) l.handler({});
    }
}

/** Dispara um evento do barramento com o payload dado. */
function dispararNoBarramento(tipo, payload) {
    for (const h of barramento.get(tipo) ?? []) h(payload);
}

beforeEach(() => {
    vi.useFakeTimers();
    janela = {
        listeners: [],
        addEventListener(event, handler, options) { this.listeners.push({ event, handler, options }); },
        removeEventListener(event, handler) {
            this.listeners = this.listeners.filter(l => !(l.event === event && l.handler === handler));
        }
    };
    vi.stubGlobal('window', janela);
    // Um `window` presente diz ao fence de época que isto é um DOCUMENTO, e documento sem
    // `localStorage` fecha o fence por desenho (F12, 2026-09-13): sem este duplo, `activateScope`
    // de um escopo remoto lança AbortError antes de o sujeito do teste existir.
    const memoria = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
        setItem: (k, v) => { memoria.set(k, String(v)); },
        removeItem: (k) => { memoria.delete(k); },
        key: (i) => [...memoria.keys()][i] ?? null,
        get length() { return memoria.size; }
    });
    barramento = new Map();

    activateScope(remoteScope('11111111-1111-4111-8111-111111111111'));

    // A instância é montada pela PROTOTYPE de propósito: o construtor alcança `getEventBus()` e
    // o `open()` precisa de DOM, e nada disso é o sujeito. O que se dirige são os dois métodos.
    editor = Object.create(BriefingEditorControl.prototype);
    setupCleanup(editor);
    editor._autosaveTimer = null;
    editor._openedInScope = null;
    editor._hasUnsavedChanges = false;
    editor._briefing = { id: 'b1', name: 'Briefing', slides: [], settings: {} };
    editor._eventBus = {
        emit: vi.fn(),
        on(tipo, handler) {
            if (!barramento.has(tipo)) barramento.set(tipo, []);
            barramento.get(tipo).push(handler);
            return () => {
                barramento.set(tipo, barramento.get(tipo).filter(h => h !== handler));
            };
        }
    };
    save = vi.fn(async () => { editor._hasUnsavedChanges = false; });
    editor._save = save;

    editor._wireAutosaveFlushTriggers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('a fiação dos gatilhos', () => {
    it('liga DOIS ouvintes de janela e DOIS do barramento, e nada mais', () => {
        expect(janela.listeners.map(l => l.event)).toEqual(['beforeunload', 'pagehide']);
        expect([...barramento.keys()].sort())
            .toEqual([EventTypes.CONNECTION_STATE_CHANGED, EventTypes.SESSION_CHANGED].sort());
    });

    it('carimba o escopo da ABERTURA, que é o que o guarda compara depois', () => {
        expect(editor._openedInScope).toBe('remote-11111111-1111-4111-8111-111111111111');
    });

    it('`cleanup` retira os quatro: o editor abre e fecha muitas vezes por sessão', () => {
        cleanup(editor);

        expect(janela.listeners).toEqual([]);
        for (const tipo of barramento.keys()) expect(barramento.get(tipo)).toEqual([]);
        // CONTROLE: com tudo desligado, disparar os quatro não grava nada.
        editor._scheduleAutosave();
        dispararNaJanela('beforeunload');
        dispararNaJanela('pagehide');
        dispararNoBarramento(EventTypes.CONNECTION_STATE_CHANGED, { currentState: ConnectionStates.OFFLINE });
        dispararNoBarramento(EventTypes.SESSION_CHANGED, {});
        expect(save).not.toHaveBeenCalled();
    });
});

describe('os três pontos de risco descarregam a represa', () => {
    it('fechar a aba descarrega, por `beforeunload` e por `pagehide`', async () => {
        editor._scheduleAutosave();
        dispararNaJanela('beforeunload');
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        // O temporizador foi CANCELADO junto: avançar o relógio não grava de novo.
        await vi.advanceTimersByTimeAsync(5000);
        expect(save).toHaveBeenCalledTimes(1);

        editor._scheduleAutosave();
        dispararNaJanela('pagehide');
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    });

    it('perder a conexão descarrega, e continuar ONLINE NÃO', async () => {
        editor._scheduleAutosave();
        // O controle vem PRIMEIRO: sem ele, um gatilho que disparasse em todo estado passaria
        // verde no caso de baixo e o editor gravaria a cada quadro de reconexão.
        dispararNoBarramento(EventTypes.CONNECTION_STATE_CHANGED, { currentState: ConnectionStates.ONLINE });
        expect(save).not.toHaveBeenCalled();
        expect(editor._autosaveTimer).not.toBeNull();

        dispararNoBarramento(EventTypes.CONNECTION_STATE_CHANGED, { currentState: ConnectionStates.OFFLINE });
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

        // `RECONNECTING` também serve de gatilho: nesse estado o envio de saída já não passa.
        editor._scheduleAutosave();
        dispararNoBarramento(EventTypes.CONNECTION_STATE_CHANGED, { currentState: ConnectionStates.RECONNECTING });
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

        // Payload ausente não estoura e conta como "não ONLINE".
        editor._scheduleAutosave();
        dispararNoBarramento(EventTypes.CONNECTION_STATE_CHANGED, undefined);
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    });

    it('a troca de sessão descarrega ENQUANTO o atlas é o mesmo', async () => {
        editor._scheduleAutosave();
        dispararNoBarramento(EventTypes.SESSION_CHANGED, { authenticated: false });
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    });
});

describe('o guarda de escopo', () => {
    it('RECUSA a gravação quando o atlas montado mudou desde a abertura', async () => {
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
        editor._scheduleAutosave();
        expect(editor._hasUnsavedChanges).toBe(true);

        // A troca ao vivo e o logout não avisam ANTES: quando o gatilho chega, a store já é a do
        // outro atlas, e o documento em memória é do anterior. Gravar ali criaria um briefing
        // alheio dentro do projeto novo.
        activateScope(remoteScope('22222222-2222-4222-8222-222222222222'));
        dispararNoBarramento(EventTypes.SESSION_CHANGED, {});
        await vi.advanceTimersByTimeAsync(5000);

        expect(save).not.toHaveBeenCalled();
        expect(aviso).toHaveBeenCalled();
        // O temporizador foi cancelado (nada vai gravar mais tarde), mas a marca de pendência
        // FICA DE PÉ, então o fechamento do editor ainda pergunta em vez de sair calado.
        expect(editor._autosaveTimer).toBeNull();
        expect(editor._hasUnsavedChanges).toBe(true);
    });

    it('CONTROLE: no MESMO escopo a mesma sequência grava', async () => {
        editor._scheduleAutosave();
        dispararNoBarramento(EventTypes.SESSION_CHANGED, {});
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    });
});

describe('idempotência', () => {
    it('sem represa pendente nenhum dos quatro gatilhos grava', async () => {
        dispararNaJanela('beforeunload');
        dispararNaJanela('pagehide');
        dispararNoBarramento(EventTypes.CONNECTION_STATE_CHANGED, { currentState: ConnectionStates.OFFLINE });
        dispararNoBarramento(EventTypes.SESSION_CHANGED, {});
        await vi.advanceTimersByTimeAsync(5000);

        // É o que faz o par `beforeunload`+`pagehide` custar UMA gravação e não duas: o segundo
        // já não encontra temporizador nenhum.
        expect(save).not.toHaveBeenCalled();
    });

    it('dois gatilhos em sequência sobre a MESMA represa gravam uma vez só', async () => {
        editor._scheduleAutosave();
        dispararNaJanela('beforeunload');
        dispararNaJanela('pagehide');
        await vi.advanceTimersByTimeAsync(5000);

        expect(save).toHaveBeenCalledTimes(1);
    });
});
