// Path: tests/unit/presenca-saida-explicita.test.js

/**
 * @fileoverview A presença administrativa sai quando a página sai (relato do dono, 2026-09-22:
 * "ainda diz que tem usuário presente mesmo que depois de sair").
 *
 * Até esta data o painel só deixava de contar um navegador quando a janela de 90 s do servidor
 * passava, e a aba em segundo plano parava de pulsar, então quem só trocou de aba sumia da conta.
 * Os casos: a saída explícita no `pagehide` (com o MESMO `abaId` dos pulsos, que é o que o
 * servidor confere antes de apagar), a aba oculta que continua pulsando, a entrada em segundo
 * plano que NÃO pulsa (ela antecede o `pagehide` e chegaria depois da saída), a volta do cache de
 * navegação e o aviso às abas irmãs do mesmo navegador.
 *
 * O lado do servidor (apagar só se o último pulso for do mesmo documento) é
 * `backend/tests/integration/monitoramento-presenca.test.js`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@store/sync/api-client.js', () => ({ apiClient: { authHeader: async () => ({}) } }));

import { instalarPresenca, configurarPendenciasDePresenca } from '@js/session/presenca.js';

/** Canais de todas as "abas" do teste, para o duplo entregar a mensagem às outras. */
const canais = new Set();

class CanalFalso {
    constructor(nome) {
        this.nome = nome;
        this.onmessage = null;
        canais.add(this);
    }
    postMessage(data) {
        for (const c of canais) {
            if (c !== this && c.nome === this.nome) c.onmessage?.({ data });
        }
    }
    close() { canais.delete(this); }
}

/** Uma "janela" com o que `instalarPresenca` toca, e os ouvintes registrados à vista. */
function janela({ visibilidade = 'visible', localStorage } = {}) {
    const ouvintes = {};
    const doDocumento = {};
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const alvo = {
        fetch,
        setTimeout, clearTimeout,
        setInterval: () => 0, clearInterval: () => {},
        BroadcastChannel: CanalFalso,
        localStorage,
        addEventListener: (ev, fn) => { (ouvintes[ev] ||= new Set()).add(fn); },
        removeEventListener: (ev, fn) => { ouvintes[ev]?.delete(fn); },
        document: {
            visibilityState: visibilidade,
            addEventListener: (ev, fn) => { (doDocumento[ev] ||= new Set()).add(fn); },
            removeEventListener: (ev, fn) => { doDocumento[ev]?.delete(fn); },
        },
        disparar(ev, evento = {}) { for (const fn of ouvintes[ev] || []) fn(evento); },
        dispararNoDocumento(ev) { for (const fn of doDocumento[ev] || []) fn({}); },
    };
    return alvo;
}

const corpos = (fetch) => fetch.mock.calls.map(([, opcoes]) => JSON.parse(opcoes.body));

const instalados = [];
afterEach(() => {
    for (const p of instalados.splice(0)) p.desinstalar();
    configurarPendenciasDePresenca(null);
    canais.clear();
});

function instalar(alvo) {
    const p = instalarPresenca({ alvo });
    instalados.push(p);
    return p;
}

describe('presença administrativa: a saída é explícita e a aba oculta continua presente', () => {
    it('o `pagehide` manda a saída com keepalive e o MESMO abaId dos pulsos, e nada pulsa depois', async () => {
        const alvo = janela();
        const p = instalar(alvo);
        await vi.waitFor(() => expect(alvo.fetch).toHaveBeenCalledTimes(1));
        const [pulso] = corpos(alvo.fetch);
        expect(pulso.abaId).toMatch(/^[0-9a-f-]{36}$/);
        expect(pulso).not.toHaveProperty('saindo');

        alvo.disparar('pagehide', { persisted: false });
        expect(alvo.fetch).toHaveBeenCalledTimes(2);
        const [, opcoes] = alvo.fetch.mock.calls[1];
        expect(opcoes.keepalive).toBe(true);
        expect(JSON.parse(opcoes.body)).toEqual({ navegadorId: pulso.navegadorId, abaId: pulso.abaId, saindo: true });

        // Um pulso agendado que dispare depois da saída não pode trazer a linha de volta.
        await p.pulsar();
        expect(alvo.fetch).toHaveBeenCalledTimes(2);
    });

    it('a aba OCULTA continua pulsando, e a entrada em segundo plano não pulsa', async () => {
        const alvo = janela({ visibilidade: 'hidden' });
        const p = instalar(alvo);
        await vi.waitFor(() => expect(alvo.fetch).toHaveBeenCalledTimes(1));
        // O pulso do intervalo, com a aba oculta: antes de 2026-09-22 ele voltava sem enviar nada.
        await p.pulsar();
        await vi.waitFor(() => expect(alvo.fetch).toHaveBeenCalledTimes(2));

        // Ficar oculta é o que antecede o `pagehide` ao fechar a aba: aquele pulso chegaria depois
        // da saída e manteria o navegador contado a janela inteira.
        alvo.dispararNoDocumento('visibilitychange');
        await new Promise((r) => setTimeout(r, 0));
        expect(alvo.fetch).toHaveBeenCalledTimes(2);

        // Voltar a ficar visível pulsa na hora, como antes.
        alvo.document.visibilityState = 'visible';
        alvo.dispararNoDocumento('visibilitychange');
        await vi.waitFor(() => expect(alvo.fetch).toHaveBeenCalledTimes(3));
    });

    it('a página que VOLTA do cache de navegação pulsa de novo; a que só sai, não', async () => {
        const alvo = janela();
        instalar(alvo);
        await vi.waitFor(() => expect(alvo.fetch).toHaveBeenCalledTimes(1));
        alvo.disparar('pagehide', { persisted: true });
        expect(alvo.fetch).toHaveBeenCalledTimes(2);
        alvo.disparar('pageshow', { persisted: false });
        await new Promise((r) => setTimeout(r, 0));
        expect(alvo.fetch).toHaveBeenCalledTimes(2);
        alvo.disparar('pageshow', { persisted: true });
        await vi.waitFor(() => expect(alvo.fetch).toHaveBeenCalledTimes(3));
        expect(corpos(alvo.fetch)[2]).not.toHaveProperty('saindo');
    });

    it('a saída de uma aba faz a IRMÃ do mesmo navegador pulsar na hora', async () => {
        const dados = new Map();
        const localStorage = { getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => dados.set(k, v) };
        const abaA = janela({ localStorage });
        const abaB = janela({ localStorage, visibilidade: 'hidden' });
        instalar(abaA);
        instalar(abaB);
        await vi.waitFor(() => expect(abaA.fetch).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(abaB.fetch).toHaveBeenCalledTimes(1));
        expect(corpos(abaA.fetch)[0].navegadorId).toBe(corpos(abaB.fetch)[0].navegadorId);

        abaA.disparar('pagehide', { persisted: false });
        await vi.waitFor(() => expect(abaB.fetch).toHaveBeenCalledTimes(2));
        const irma = corpos(abaB.fetch)[1];
        expect(irma).not.toHaveProperty('saindo');
        expect(irma.abaId).not.toBe(corpos(abaA.fetch)[1].abaId);
        // E a aba que saiu não pulsa pela própria mensagem.
        expect(abaA.fetch).toHaveBeenCalledTimes(2);
    });

    it('desinstalar solta os ouvintes da janela e fecha o canal', async () => {
        const alvo = janela();
        const p = instalar(alvo);
        await vi.waitFor(() => expect(alvo.fetch).toHaveBeenCalledTimes(1));
        p.desinstalar();
        alvo.disparar('pagehide', { persisted: false });
        expect(alvo.fetch).toHaveBeenCalledTimes(1);
        expect(canais.size).toBe(0);
    });
});
