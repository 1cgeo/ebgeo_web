// Run from the repository root: node docs/reviews/monitoramento-probes-2026-09-12.mjs
// Read-only probes against the production modules, using synthetic browser callbacks.
import assert from 'node:assert/strict';
import { criarVitais } from '../../frontend/src/js/session/vitais.js';
import { configurarUso, registrarUso, descarregarUso } from '../../frontend/src/js/session/uso-lote.js';
import { EventoDeUso } from '../../frontend/src/js/session/eventos-de-uso.js';
import { criarSessaoId } from '../../frontend/src/js/session/sessao-id.js';
import { linhasDeFerramentas } from '../../frontend/src/js/admin/uso-phrases.js';

const callbacks = new Map();
class Observer {
    constructor(callback) { this.callback = callback; }
    observe({ type }) { callbacks.set(type, this.callback); }
    disconnect() {}
}
const vitais = criarVitais({ Observador: Observer, performance: {} });
vitais.observar();
const emit = (type, entries) => callbacks.get(type)({ getEntries: () => entries });
emit('layout-shift', [
    { startTime: 1000, value: 0.1, hadRecentInput: false },
    { startTime: 10000, value: 0.1, hadRecentInput: false },
]);
assert.equal(vitais.ler().cls, 0.1);
emit('event', Array.from({ length: 50 }, (_, i) => ({
    interactionId: i + 1, name: 'click', duration: i === 0 ? 1000 : 100,
})));
assert.equal(vitais.ler().inpMs, 100);

let now = Date.UTC(2026, 8, 12, 12);
let errorCount = 0;
let currentVitals = { lcpMs: 150 };
const sent = [];
const usage = configurarUso({
    pagina: 'mapa', sessaoId: '00000000-0000-4000-8000-000000000001',
    agora: () => now, intervaloMs: 0,
    enviar: body => { sent.push(body); return true; },
    erros: () => errorCount, vitais: () => currentVitals,
    alvo: {}, documento: {},
});
assert.equal(usage.instalada, true);
registrarUso(EventoDeUso.PAGINA_VISTA);
now += 30000;
assert.equal(descarregarUso(), true);
now += 600000;
errorCount = 1;
currentVitals = { lcpMs: 4000, inpMs: 1000, cls: 0.2 };
assert.equal(descarregarUso(), true);
assert.equal(sent.length, 2);
assert.equal(sent[1].erros, 1);
usage.desinstalar();

const backing = new Map();
const storage = { getItem: key => backing.get(key), setItem: (key, value) => backing.set(key, value) };
const first = criarSessaoId({ storage, uuid: () => '00000000-0000-4000-8000-000000000002' })();
const afterNavigation = criarSessaoId({ storage, uuid: () => '00000000-0000-4000-8000-000000000003' })();
assert.equal(first, afterNavigation);

const ranking = linhasDeFerramentas([
    { evento: 'pagina.vista', prop: '', contagem: 900 },
    { evento: 'ferramenta.ativada', prop: 'point', contagem: 100, totalCategoria: 100 },
]);
assert.equal(ranking[1].fatia, '100,0%');

console.log(JSON.stringify({
    cls: { actual: vitais.ler().cls, standardSessionWindowMaximum: 0.1 },
    inp: { actualMs: vitais.ler().inpMs, standardFor50InteractionsMs: 100 },
    quietSession: {
        elapsedMs: 630000, reportedDurationMs: sent[1].ultimoSinal - sent[1].inicio,
        batches: sent.length, finalErrorCount: errorCount, reportedErrorCount: sent[1].erros,
        finalLcpMs: currentVitals.lcpMs, reportedLcpMs: sent[1].vitais.lcpMs,
    },
    explicitStorageOptionSurvivesNavigation: first === afterNavigation,
    rankingPointShare: ranking[1].fatia,
}, null, 2));
