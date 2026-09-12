// Path: tests/unit/monitoramento-regressoes.test.js
import { it, expect, afterEach, vi } from 'vitest';
import { criarVitais } from '@js/session/vitais.js';
import { configurarUso, registrarUso, descarregarUso, desinstalarUso } from '@js/session/uso-lote.js';
import { EventoDeUso } from '@js/session/eventos-de-uso.js';
import { criarTransporteDeUso } from '@js/session/uso-transporte.js';
import { instalarPresenca, configurarPendenciasDePresenca } from '@js/session/presenca.js';
vi.mock('@store/sync/api-client.js', () => ({ apiClient: { authHeader: async () => ({}) } }));
afterEach(() => desinstalarUso());

it('leitura travada das pendências não impede o sinal de presença', async () => {
    vi.useFakeTimers();
    configurarPendenciasDePresenca(() => new Promise(() => {}));
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const p = instalarPresenca({ alvo: { fetch, setTimeout, clearTimeout, setInterval, clearInterval,
        document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } } });
    try {
        await vi.advanceTimersByTimeAsync(3000);
        expect(fetch).toHaveBeenCalledOnce();
        expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('pendentes');
    } finally { p.desinstalar(); configurarPendenciasDePresenca(null); vi.useRealTimers(); }
});

it('erro e LCP tardios atualizam sessão sem fabricar acionamentos', () => {
    let agora = 1000, erros = 0;
    const enviados = [];
    configurarUso({ pagina: 'mapa', sessaoId: '00000000-0000-4000-8000-000000000001',
        agora: () => agora, erros: () => erros, vitais: () => ({ lcpMs: agora }),
        enviar: corpo => { enviados.push(corpo); return true; }, intervaloMs: 0, alvo: {}, documento: {} });
    registrarUso(EventoDeUso.PAGINA_VISTA);
    descarregarUso();
    agora = 630000; erros = 1;
    descarregarUso();
    expect(enviados[1]).toMatchObject({ ultimoSinal: 630000, erros: 1, eventos: [], vitais: { lcpMs: 630000 } });
    expect(enviados.flatMap(l => l.eventos)).toHaveLength(1);
});

it('CLS usa a maior janela e INP agrupa interação e ignora um extremo a cada cinquenta', () => {
    const callbacks = new Map();
    class Observador {
        constructor(fn) { this.fn = fn; }
        observe({ type }) { callbacks.set(type, this.fn); }
        disconnect() {}
    }
    const performance = { interactionCount: 2 };
    const v = criarVitais({ performance, Observador });
    v.observar();
    callbacks.get('layout-shift')({ getEntries: () => [{ startTime: 1000, value: 0.1 }, { startTime: 10000, value: 0.1 }] });
    callbacks.get('event')({ getEntries: () => [
        ...Array.from({ length: 50 }, (_, i) => ({ interactionId: i + 1, duration: i ? 100 : 1000 })),
        { interactionId: 1, duration: 900 },
    ] });
    expect(v.ler().inpMs).toBe(1000);
    performance.interactionCount = 50;
    expect(v.ler()).toMatchObject({ cls: 0.1, inpMs: 100 });
});

it('fila mantém o mesmo lote até confirmação e retoma após reinstalar transporte', async () => {
    const dados = new Map();
    const storage = { get length() { return dados.size; }, key: i => [...dados.keys()][i],
        getItem: k => dados.get(k), setItem: (k, v) => dados.set(k, v), removeItem: k => dados.delete(k) };
    const fetch = vi.fn().mockRejectedValueOnce(new Error('resposta perdida')).mockResolvedValue({ ok: true });
    const alvo = { localStorage: storage, fetch };
    const t = criarTransporteDeUso({ alvo });
    t.enviar({ eventos: [] }, '/api/v1/uso/eventos');
    await vi.waitFor(() => expect(t.falhas()).toBe(1));
    expect(dados.size).toBe(1);
    const id = JSON.parse([...dados.values()][0]).corpo.loteId;
    criarTransporteDeUso({ alvo }).retomar();
    await vi.waitFor(() => expect(dados.size).toBe(0));
    expect(JSON.parse(fetch.mock.calls[1][1].body).loteId).toBe(id);
});
