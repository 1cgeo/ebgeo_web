import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
    adoptMirroredDiscardState, captureRemoteWriteFence, discardRemoteWrites, forgetRemoteWriteFence,
    remoteWritesDiscarded, reopenRemoteWrites,
} from '../../src/js/store/remote-write-fence.js';

beforeEach(() => {
    const values = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        // `removeItem` entrou com a destruição do namespace, que apaga a chave de época. Um dublê
        // sem ele não reprova: a remoção é best-effort e o TypeError cai no `catch`, então o caso
        // mediria a chave que continua lá por falta do dublê, não por falta do código.
        removeItem: key => values.delete(key),
    });
});
afterEach(() => vi.unstubAllGlobals());
const scope = id => ({ kind: 'remote', atlasId: id, dbSuffix: 'remote-' + id });

test('a confirmed discard invalidates an existing writer even after a fresh login', () => {
    const oldMount = scope('A');
    const oldWriter = captureRemoteWriteFence(oldMount);
    oldWriter();
    discardRemoteWrites(scope('A'));
    assert.throws(oldWriter, { name: 'AbortError' });
    assert.throws(() => captureRemoteWriteFence(scope('A')), { name: 'AbortError' });
    const fresh = scope('A');
    reopenRemoteWrites(fresh);
    captureRemoteWriteFence(fresh)();
    assert.throws(oldWriter, { name: 'AbortError' });
    assert.throws(() => captureRemoteWriteFence(oldMount), { name: 'AbortError' });
});

test('ordinary local atlases, adopted local atlases and other remote atlases are isolated', () => {
    const local = { kind: 'local', dbSuffix: 'remote-A' };
    const rescuedWriter = captureRemoteWriteFence(local);
    const otherWriter = captureRemoteWriteFence(scope('B'));
    discardRemoteWrites(scope('A'));
    rescuedWriter();
    otherWriter();
    assert.throws(() => discardRemoteWrites(local));
});

test('failure to persist consent cannot be announced as a successful discard', () => {
    localStorage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => discardRemoteWrites(scope('A')), /quota/);
});

test('corrupt metadata stops new writers instead of treating an unknown epoch as fresh', () => {
    localStorage.setItem('ebgeo_remote_write_epoch:remote-A', '{"epoch":"bad","discarded":false}');
    assert.throws(() => captureRemoteWriteFence(scope('A')), /inválido/);
});

// F12: a ausência de `localStorage` respondia `{ epoch: 0, discarded: false }`, que é a resposta
// mais permissiva possível para um fato que não pôde ser lido.
test('dentro de um documento, sem localStorage o fence FECHA', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', undefined);
    assert.throws(() => captureRemoteWriteFence(scope('A')), { name: 'AbortError' });
    assert.equal(remoteWritesDiscarded(scope('A')), true);
    assert.throws(() => discardRemoteWrites(scope('A')), /Não foi possível/);
});

// E O CONTROLE do caso acima, que é o que o impede de virar "fechado sempre": fora de um documento
// não há aba, não há consentimento e não há o que fencear, e é isso que mantém a suíte medindo o
// produto em vez de medir a ausência de storage do node.
test('fora de um documento, sem localStorage o fence continua aberto', () => {
    vi.stubGlobal('localStorage', undefined);
    assert.equal(typeof globalThis.window, 'undefined');
    captureRemoteWriteFence(scope('A'))();
    assert.equal(remoteWritesDiscarded(scope('A')), false);
});

// A DESTRUIÇÃO DO NAMESPACE apaga a chave de época (F12: elas nunca eram apagadas), e apagá-la
// liberaria de volta exatamente os escritores que nasceram antes de qualquer descarte, porque época
// 0 se lia como "nunca houve descarte".
test('apagar o registro junto com o namespace FECHA o escritor que o tinha', () => {
    // O escritor nasce com um registro JÁ EXISTENTE (é o caso de uma aba que montou depois de
    // qualquer descarte), então a presença é o que ele capturou.
    discardRemoteWrites(scope('A'));
    reopenRemoteWrites(scope('A'));
    const writer = captureRemoteWriteFence(scope('A'));
    writer();

    forgetRemoteWriteFence(scope('A'));

    assert.equal(localStorage.getItem('ebgeo_remote_write_epoch:remote-A'), null);
    assert.throws(writer, { name: 'AbortError' });
});

// O LIMITE DECLARADO, escrito como caso para que ninguém leia o de cima como cobertura total: um
// escritor nascido ANTES de qualquer registro lê `{ epoch: 0, present: false }` tanto num namespace
// que nunca foi descartado quanto num que acabou de ser destruído, e nada nesta chave separa os dois
// sem uma lápide por atlas para sempre. Quem impede a escrita perdida de RECRIAR os bancos é o freio
// de desmontagem (`store/sync/tab-lock-sync-brake.js`), com controle negativo próprio.
test('LIMITE: um escritor nascido antes de qualquer registro não é fechado pela chave apagada', () => {
    const writer = captureRemoteWriteFence(scope('Z'));
    writer();

    forgetRemoteWriteFence(scope('Z'));

    writer();
});

// O ESPELHO NO INDEXEDDB: a reconciliação decide sem adivinhar, e o empate fica com o descarte.
test('o espelho reconstrói o registro perdido, e a maior época vence', () => {
    assert.equal(adoptMirroredDiscardState(scope('A'), { epoch: 3, discarded: true }), 'restored');
    assert.throws(() => captureRemoteWriteFence(scope('A')), { name: 'AbortError' });

    localStorage.setItem('ebgeo_remote_write_epoch:remote-B', JSON.stringify({ epoch: 5, discarded: false }));
    assert.equal(adoptMirroredDiscardState(scope('B'), { epoch: 4, discarded: true }), 'kept');
    assert.equal(remoteWritesDiscarded(scope('B')), false);
    assert.equal(adoptMirroredDiscardState(scope('B'), { epoch: 5, discarded: true }), 'adopted');
    assert.equal(remoteWritesDiscarded(scope('B')), true);
    assert.equal(adoptMirroredDiscardState(scope('B'), null), 'absent');
    assert.equal(adoptMirroredDiscardState({ kind: 'local', dbSuffix: 'remote-B' }, { epoch: 9, discarded: true }), 'absent');
});
