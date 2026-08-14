// Path: tests/unit/geojson-dispatcher.test.js
//
// O QUE ESTE ARQUIVO PRENDE, E O QUE ELE DELIBERADAMENTE NAO PRENDE.
//
// A licao medida: chamadas EMENDADAS de `updateData` perdem dado. Dez chamadas
// seguidas aplicaram duas (a primeira e a ultima), e esperar 6 s nao recuperou as
// outras oito. As mesmas dez com 300 ms de folga aplicaram 10/10, e as mesmas dez
// num lote unico aplicaram 10/10.
//
// O despachante existe para tornar essa interleaving IMPOSSIVEL de produzir. Aqui
// prova-se a parte que e logica, em node, sem MapLibre:
//   1. a funcao pura de coalescencia (os pares add/patch/remove, com borda em cada);
//   2. a serializacao, contra um duplo de source cujo updateData so termina quando o
//      teste mandar: N chamadas emendadas produzem N feicoes e no maximo UM updateData
//      em voo por vez;
//   3. o caminho de erro: updateData que lanca cai para setData e nao perde feicao.
//
// O que NAO se prova aqui: que o MapLibre real coalesce, aplica o diff ou preserva o
// feature-state. Um teste em node que "provasse" isso estaria medindo o proprio duplo,
// que e cobertura vazia. Essa perna e a proxima fase, com Playwright contra o app real.

import { describe, test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';

import {
    GeoJsonDispatcher,
    coalesceOps,
    createEmptyPending,
    isPendingEmpty,
    pendingToDiff,
    applyPendingToFeatures,
    defaultKeyOf,
} from '@layers/geojson-dispatcher.js';

/* ---------------------------------------------------------------- helpers */

/**
 * @param {string} id - Feature id (also the promoted key)
 * @param {Object} [props] - Extra properties
 * @param {Array} [coords] - Point coordinates
 * @returns {Object} GeoJSON feature
 */
function feature(id, props = {}, coords = [0, 0]) {
    return {
        type: 'Feature',
        properties: { id, ...props },
        geometry: { type: 'Point', coordinates: coords },
    };
}

/** @returns {Object} pending batch built from a list of operations */
function pendingOf(...ops) {
    return coalesceOps(createEmptyPending(), ops);
}

/** @returns {Promise<void>} resolves after the macrotask queue turns */
function tick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/* ------------------------------------------------- pure coalescing: pairs */

describe('coalescencia pura: os pares', () => {
    test('add + remove do mesmo id vira remove, nao vira nada', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'add', feature: feature('a') },
            { kind: 'remove', id: 'a' },
        ));

        // Guardar o remove e a escolha correta: a chave pode ja existir na source, e
        // remove de id ausente e no-op documentado. Descartar os dois ressuscitaria uma
        // feicao que o usuario apagou.
        assert.deepEqual(diff, { remove: ['a'] });
        assert.equal(diff.add, undefined);
    });

    test('borda: add + remove + add devolve o add final, sem remove', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'add', feature: feature('a', { cor: 'velha' }) },
            { kind: 'remove', id: 'a' },
            { kind: 'add', feature: feature('a', { cor: 'nova' }) },
        ));

        assert.equal(diff.remove, undefined);
        assert.equal(diff.add.length, 1);
        assert.equal(diff.add[0].properties.cor, 'nova');
    });

    test('add + patch vira UM add com o estado final, sem update', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'add', feature: feature('a', { cor: 'azul', largura: 2 }) },
            { kind: 'patch', id: 'a', setProps: { cor: 'vermelho' } },
        ));

        assert.equal(diff.update, undefined);
        assert.equal(diff.add.length, 1);
        assert.equal(diff.add[0].properties.cor, 'vermelho');
        assert.equal(diff.add[0].properties.largura, 2);
    });

    test('borda: o patch sobre um add nao muta a feicao que o chamador passou', () => {
        const original = feature('a', { cor: 'azul' });
        const pending = pendingOf(
            { kind: 'add', feature: original },
            { kind: 'patch', id: 'a', setProps: { cor: 'vermelho' }, geometry: { type: 'Point', coordinates: [10, 20] } },
        );
        const diff = pendingToDiff(pending);

        assert.equal(original.properties.cor, 'azul');
        assert.deepEqual(original.geometry.coordinates, [0, 0]);
        assert.deepEqual(diff.add[0].geometry.coordinates, [10, 20]);
    });

    test('patch + remove vira remove, e o update some', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'patch', id: 'a', setProps: { cor: 'vermelho' } },
            { kind: 'remove', id: 'a' },
        ));

        assert.deepEqual(diff, { remove: ['a'] });
    });

    test('borda: remove + patch mantem o remove e descarta o patch', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'remove', id: 'a' },
            { kind: 'patch', id: 'a', setProps: { cor: 'vermelho' } },
        ));

        assert.deepEqual(diff, { remove: ['a'] });
    });

    test('remove + add vira add (upsert total), nunca update', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'remove', id: 'a' },
            { kind: 'add', feature: feature('a', { cor: 'nova' }) },
        ));

        // update de id inexistente e no-op silencioso no MapLibre: converter para update
        // perderia a feicao no caso em que a chave ainda nao existia.
        assert.equal(diff.update, undefined);
        assert.equal(diff.remove, undefined);
        assert.equal(diff.add[0].properties.cor, 'nova');
    });

    test('borda: add depois de patch descarta o patch (add e substituicao total)', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'patch', id: 'a', setProps: { cor: 'vermelho' } },
            { kind: 'add', feature: feature('a', { cor: 'azul' }) },
        ));

        assert.equal(diff.update, undefined);
        assert.equal(diff.add[0].properties.cor, 'azul');
    });

    test('add + add: o ultimo vence', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'add', feature: feature('a', { v: 1 }) },
            { kind: 'add', feature: feature('a', { v: 2 }) },
        ));

        assert.equal(diff.add.length, 1);
        assert.equal(diff.add[0].properties.v, 2);
    });

    test('remove + remove e idempotente', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'remove', id: 'a' },
            { kind: 'remove', id: 'a' },
        ));

        assert.deepEqual(diff, { remove: ['a'] });
    });

    test('patch + patch funde: valor posterior vence, chaves distintas somam', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'patch', id: 'a', setProps: { cor: 'azul', largura: 2 } },
            { kind: 'patch', id: 'a', setProps: { cor: 'vermelho' } },
        ));

        assert.equal(diff.update.length, 1);
        const props = new Map(diff.update[0].addOrUpdateProperties.map((p) => [p.key, p.value]));
        assert.equal(props.get('cor'), 'vermelho');
        assert.equal(props.get('largura'), 2);
    });

    test('borda: unset depois de set vira removeProperties, nao sobra o set', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'patch', id: 'a', setProps: { cor: 'azul' } },
            { kind: 'patch', id: 'a', unsetProps: ['cor'] },
        ));

        assert.deepEqual(diff.update[0].removeProperties, ['cor']);
        assert.deepEqual(diff.update[0].addOrUpdateProperties, []);
    });

    test('borda: clearProps apaga as mudancas anteriores e absorve o unset seguinte', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'patch', id: 'a', setProps: { cor: 'azul' } },
            { kind: 'patch', id: 'a', clearProps: true },
            { kind: 'patch', id: 'a', unsetProps: ['largura'], setProps: { nome: 'x' } },
        ));

        const patch = diff.update[0];
        assert.equal(patch.removeAllProperties, true);
        assert.equal(patch.removeProperties, undefined);
        assert.deepEqual(patch.addOrUpdateProperties, [{ key: 'nome', value: 'x' }]);
    });

    test('addOrUpdateProperties existe mesmo vazio (o merger do MapLibre faz findIndex nele)', () => {
        const diff = pendingToDiff(pendingOf(
            { kind: 'patch', id: 'a', geometry: { type: 'Point', coordinates: [1, 2] } },
        ));

        assert.deepEqual(diff.update[0].addOrUpdateProperties, []);
        assert.deepEqual(diff.update[0].newGeometry, { type: 'Point', coordinates: [1, 2] });
    });

    test('patch sem nenhuma mudanca nao gera update', () => {
        assert.equal(pendingToDiff(pendingOf({ kind: 'patch', id: 'a' })), null);
    });

    test('coalesceOps e pura: o pending de entrada nao muda', () => {
        const base = pendingOf({ kind: 'add', feature: feature('a') });
        const antes = pendingToDiff(base);

        coalesceOps(base, [{ kind: 'remove', id: 'a' }, { kind: 'add', feature: feature('b') }]);

        assert.deepEqual(pendingToDiff(base), antes);
    });

    test('a chave promovida e carimbada no id de topo (defesa contra o merger do MapLibre)', () => {
        const diff = pendingToDiff(pendingOf({ kind: 'add', feature: feature('uuid-1') }));

        // O merger interno chaveia `add` por feature.id e ignora promoteId: sem o carimbo,
        // N adds sem id de topo colapsam num so.
        assert.equal(diff.add[0].id, 'uuid-1');
    });
});

/* ------------------------------------------- pure coalescing: replaceAll */

describe('coalescencia pura: replaceAll', () => {
    test('replaceAll descarta o que estava pendente', () => {
        const pending = pendingOf(
            { kind: 'add', feature: feature('a') },
            { kind: 'remove', id: 'b' },
            { kind: 'replaceAll', features: [feature('z')] },
        );

        assert.equal(pending.entries.size, 0);
        assert.equal(pending.replaceAll.length, 1);
    });

    test('operacoes depois do replaceAll sao aplicadas SOBRE a colecao nova', () => {
        const pending = pendingOf(
            { kind: 'replaceAll', features: [feature('a'), feature('b')] },
            { kind: 'remove', id: 'a' },
            { kind: 'add', feature: feature('c') },
        );

        const ids = applyPendingToFeatures([feature('velha')], pending).map(defaultKeyOf);
        assert.deepEqual(ids, ['b', 'c']);
    });

    test('applyPendingToFeatures nao muta a colecao base nem as feicoes', () => {
        const base = [feature('a', { cor: 'azul' })];
        const pending = pendingOf({ kind: 'patch', id: 'a', setProps: { cor: 'vermelho' } });

        const out = applyPendingToFeatures(base, pending);

        assert.equal(base.length, 1);
        assert.equal(base[0].properties.cor, 'azul');
        assert.equal(out[0].properties.cor, 'vermelho');
    });

    test('remove de id ausente na colecao base e no-op', () => {
        const out = applyPendingToFeatures([feature('a')], pendingOf({ kind: 'remove', id: 'zzz' }));
        assert.deepEqual(out.map(defaultKeyOf), ['a']);
    });

    test('pending vazio e reconhecido como vazio', () => {
        assert.equal(isPendingEmpty(createEmptyPending()), true);
        assert.equal(isPendingEmpty(pendingOf({ kind: 'add', feature: feature('a') })), false);
    });
});

/* --------------------------------------------------------- source double */

/**
 * Duplo de map: so o que o despachante usa (on/off/getSource) mais um `fire` manual.
 * @returns {Object}
 */
function createFakeMap() {
    const listeners = new Map();
    const sources = new Map();
    return {
        sources,
        on(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        off(type, fn) {
            listeners.get(type)?.delete(fn);
        },
        listenerCount(type) {
            return listeners.get(type)?.size ?? 0;
        },
        fire(type, event) {
            for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
        },
        getSource(id) {
            return sources.get(id);
        },
    };
}

/**
 * Duplo de GeoJSONSource cujo updateData SO termina quando o teste chamar `settle()`.
 * Aplica o diff numa colecao propria, por um caminho independente do codigo sob teste.
 * @param {string} id - Source id
 * @param {Object} map - Fake map
 * @param {Object} [options] - `{ failUpdate }`
 * @returns {Object}
 */
function createFakeSource(id, map, options = {}) {
    const source = {
        id,
        features: [],
        diffs: [],
        setDataCalls: [],
        inFlight: 0,
        maxInFlight: 0,
        _loaded: true,

        loaded() {
            return this._loaded;
        },

        updateData(diff) {
            if (options.failUpdate) throw new Error(`Cannot update existing geojson data in ${id}`);
            this.diffs.push(diff);
            this.inFlight += 1;
            this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
            this._loaded = false;
            this._pendingDiff = diff;
        },

        setData(collection) {
            this.setDataCalls.push(collection);
            this.features = collection.features.slice();
            this.inFlight += 1;
            this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
            this._loaded = false;
            this._pendingDiff = null;
        },

        async getData() {
            return { type: 'FeatureCollection', features: this.features.slice() };
        },

        /** Applies the queued write and emits the settle signal the dispatcher waits on. */
        settle() {
            if (this._pendingDiff) applyDiff(this.features, this._pendingDiff);
            this._pendingDiff = null;
            this.inFlight -= 1;
            this._loaded = true;
            map.fire('sourcedata', { sourceId: id, dataType: 'source', sourceDataType: 'content' });
        },
    };
    map.sources.set(id, source);
    return source;
}

/**
 * Independent MapLibre-shaped diff applier: remove, then add, then update.
 * @param {Array} features - Collection (mutated in place, like the real source does)
 * @param {Object} diff - MapLibre diff
 */
function applyDiff(features, diff) {
    const indexOf = (id) => features.findIndex((f) => f.properties.id === id);

    for (const id of diff.remove ?? []) {
        const at = indexOf(id);
        if (at >= 0) features.splice(at, 1);
    }
    for (const f of diff.add ?? []) {
        const at = indexOf(f.properties.id);
        if (at >= 0) features[at] = f;
        else features.push(f);
    }
    for (const patch of diff.update ?? []) {
        const at = indexOf(patch.id);
        if (at < 0) continue;
        const current = features[at];
        const props = patch.removeAllProperties ? {} : { ...current.properties };
        for (const key of patch.removeProperties ?? []) delete props[key];
        for (const { key, value } of patch.addOrUpdateProperties ?? []) props[key] = value;
        features[at] = {
            ...current,
            properties: props,
            geometry: patch.newGeometry ?? current.geometry,
        };
    }
}

/* ------------------------------------------------------ serialization */

describe('serializacao: nenhuma chamada emendada de updateData', () => {
    let map;
    let source;
    let dispatcher;
    let erros;

    beforeEach(() => {
        map = createFakeMap();
        source = createFakeSource('points', map);
        erros = [];
        dispatcher = new GeoJsonDispatcher(map, 'points', {
            onError: (message, error) => erros.push({ message, error }),
            schedule: (cb) => setTimeout(cb, 0),
            cancelSchedule: (handle) => clearTimeout(handle),
            settleTimeoutMs: 50_000,
        });
    });

    afterEach(() => {
        dispatcher.destroy();
    });

    test('10 gestos emendados, com o primeiro ainda em voo, resultam em 10 feicoes', async () => {
        dispatcher.add(feature('f-1'));
        await tick();

        // Primeiro diff em voo, NAO liberado. Este e o regime que perdeu 8 de 10 na medicao.
        assert.equal(source.inFlight, 1);
        assert.equal(source.diffs.length, 1);

        for (let i = 2; i <= 10; i++) {
            dispatcher.add(feature(`f-${i}`));
            await tick();
            assert.equal(source.diffs.length, 1, `um segundo updateData saiu com o primeiro em voo (i=${i})`);
        }

        source.settle();
        await tick();

        assert.equal(source.diffs.length, 2, 'as 9 pendentes deviam sair como UM lote');
        source.settle();
        await tick();

        assert.equal(source.features.length, 10);
        assert.equal(source.maxInFlight, 1);
        assert.equal(dispatcher.isIdle(), true);
        assert.deepEqual(erros, []);
    });

    test('20 gestos, cada um liberado logo apos o anterior, dao 20 feicoes e 1 em voo por vez', async () => {
        for (let i = 1; i <= 20; i++) {
            dispatcher.add(feature(`g-${i}`));
            await tick();
            if (source.inFlight > 0) source.settle();
            await tick();
        }
        await dispatcher.flush();
        if (source.inFlight > 0) source.settle();
        await tick();

        assert.equal(source.features.length, 20);
        assert.equal(source.maxInFlight, 1);
    });

    test('add e remove emendados do mesmo id nao deixam a feicao para tras', async () => {
        dispatcher.add(feature('a'));
        await tick();
        dispatcher.remove('a');
        dispatcher.add(feature('b'));
        await tick();

        source.settle();
        await tick();
        source.settle();
        await tick();

        assert.deepEqual(source.features.map(defaultKeyOf), ['b']);
    });

    test('setData descarta o pendente daquela source', async () => {
        source.features = [feature('velha')];
        dispatcher.add(feature('nova'));
        dispatcher.setData([feature('x'), feature('y')]);
        await tick();
        source.settle();
        await tick();

        assert.equal(source.diffs.length, 0, 'nao deve sair diff nenhum: o setData sobrescreve tudo');
        assert.deepEqual(source.features.map(defaultKeyOf), ['x', 'y']);
    });

    test('flush espera o voo e devolve o despachante ocioso', async () => {
        dispatcher.add(feature('a'));
        const pronto = dispatcher.flush();
        await tick();
        source.settle();
        await pronto;

        assert.equal(dispatcher.isIdle(), true);
        assert.equal(source.features.length, 1);
    });

    test('destroy nao deixa listener nem timer pendurado', async () => {
        dispatcher.add(feature('a'));
        await tick();
        assert.ok(map.listenerCount('sourcedata') > 0);

        dispatcher.destroy();

        assert.equal(map.listenerCount('sourcedata'), 0);
        assert.equal(map.listenerCount('error'), 0);
        assert.equal(dispatcher._timers.size, 0);
    });

    test('source removida do mapa: o despachante se desfaz em vez de enfileirar para o vazio', async () => {
        map.sources.delete('points');
        dispatcher.add(feature('a'));
        await tick();

        assert.equal(dispatcher._destroyed, true);
        assert.equal(map.listenerCount('sourcedata'), 0);
    });

    // O INVARIANTE QUE DA RAZAO DE EXISTIR AO MODULO, e que ficou sem guarda ate agora.
    //
    // O cabecalho deste arquivo ja prometia provar "no maximo UM updateData em voo por
    // vez", e nao provava: removido o `if (this._pumping) return this._pumping` de
    // `_pump`, a suite INTEIRA do frontend passava, 3407 de 3407. Cobertura vazia sobre
    // a unica coisa que o despachante existe para garantir.
    //
    // A sequencia abaixo nao e artificial: `flush()` chegando com um diff ainda em voo
    // e o que `features_tab.js` e `label-tab.helpers.js` fazem quando precisam ler a
    // colecao depois de escrever. Sem o guarda, o `flush` abre um SEGUNDO laco de
    // bombeamento paralelo ao primeiro, e os dois `updateData` se sobrepoem, que e
    // exatamente a interleaving medida como perda de dado (dez emendadas aplicaram duas).
    test('flush concorrente com um diff em voo nao sobrepoe updateData', async () => {
        const map = createFakeMap();
        const source = createFakeSource('points', map);
        const dispatcher = new GeoJsonDispatcher(map, 'points', {
            schedule: (cb) => setTimeout(cb, 0),
            cancelSchedule: (handle) => clearTimeout(handle),
            settleTimeoutMs: 50_000,
        });

        dispatcher.add(feature('f1'));
        await tick();
        // Pre-condicao: sem ela o teste passaria por nunca ter havido voo nenhum, que e
        // a forma de verde vazio que este caso existe para nao repetir.
        assert.equal(source.inFlight, 1, 'pre-condicao: o primeiro diff tem de estar em voo');

        dispatcher.add(feature('f2'));
        const drenando = dispatcher.flush();
        await tick();

        assert.equal(
            source.maxInFlight,
            1,
            'dois updateData sobrepostos na mesma source e a interleaving que perde dado',
        );

        source.settle();
        await tick();
        if (source.inFlight > 0) source.settle();
        await drenando;

        assert.equal(source.maxInFlight, 1, 'nem durante a drenagem o voo pode dobrar');
        assert.deepEqual(
            source.features.map(defaultKeyOf).sort(),
            ['f1', 'f2'],
            'as duas feicoes chegam: serializar nao pode custar dado',
        );

        dispatcher.destroy();
});

/* ------------------------------------------------------------ error path */

describe('caminho de erro: updateData que lanca nao pode perder feicao', () => {
    test('cai para setData com a colecao inteira, sem perder o que estava no lote', async () => {
        const map = createFakeMap();
        const source = createFakeSource('points', map, { failUpdate: true });
        source.features = [feature('ja-existia')];

        const erros = [];
        const dispatcher = new GeoJsonDispatcher(map, 'points', {
            onError: (message, error) => erros.push({ message, error }),
            schedule: (cb) => setTimeout(cb, 0),
            cancelSchedule: (handle) => clearTimeout(handle),
            settleTimeoutMs: 50_000,
        });

        dispatcher.add(feature('nova-1'));
        dispatcher.add(feature('nova-2'));
        dispatcher.remove('ja-existia');
        await tick();
        await tick();
        source.settle();
        await tick();

        assert.equal(source.setDataCalls.length, 1, 'a queda para setData nao aconteceu');
        assert.deepEqual(source.features.map(defaultKeyOf), ['nova-1', 'nova-2']);
        assert.equal(erros.length, 1, 'a falha tem de ser reportada, nunca engolida');
        assert.match(erros[0].error.message, /Cannot update existing geojson data/);

        // Depois de uma falha a source para de receber diff: toda escrita seguinte vai
        // inteira, porque a causa tipica (chave nula ou repetida) mantem o diff quebrado.
        dispatcher.add(feature('nova-3'));
        await tick();
        await tick();
        source.settle();
        await tick();

        assert.equal(source.diffs.length, 0);
        assert.equal(source.setDataCalls.length, 2);
        assert.deepEqual(source.features.map(defaultKeyOf), ['nova-1', 'nova-2', 'nova-3']);

        dispatcher.destroy();
    });

    test('feicao sem chave vai pela colecao inteira em vez de sumir no diff', async () => {
        const map = createFakeMap();
        const source = createFakeSource('points', map);
        const erros = [];
        const dispatcher = new GeoJsonDispatcher(map, 'points', {
            onError: (message, error) => erros.push({ message, error }),
            schedule: (cb) => setTimeout(cb, 0),
            cancelSchedule: (handle) => clearTimeout(handle),
            settleTimeoutMs: 50_000,
        });

        // MapLibre descarta em silencio uma feicao cuja chave promovida e nula.
        dispatcher.add({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 1] } });
        dispatcher.add(feature('com-chave'));
        await tick();
        await tick();
        source.settle();
        await tick();

        assert.equal(source.diffs.length, 0);
        assert.equal(source.features.length, 2, 'a feicao sem chave nao pode sumir');
        assert.deepEqual(erros, []);

        dispatcher.destroy();
    });
    });
});
