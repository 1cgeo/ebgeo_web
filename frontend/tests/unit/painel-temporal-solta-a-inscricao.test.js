// Path: tests/unit/painel-temporal-solta-a-inscricao.test.js

/**
 * @fileoverview ROOT CAUSE que este arquivo prende: `bindTimeContextRerender`
 * (`src/js/temporal/temporal-attributes-section.js`) assinava DOIS eventos do
 * barramento e só os cancelava dentro do próprio handler, quando o PRÓXIMO evento
 * temporal chegasse e a seção já tivesse saído do DOM. Cancelamento condicionado a
 * um evento futuro não é cancelamento: num mapa sem linha do tempo ativa aquele
 * evento nunca chega, e cada reconstrução do painel de feição (uma por alça de
 * geometria solta) somava dois ouvintes permanentes ao barramento, que é um
 * singleton de vida longa. `releaseTemporalSection` entra na cadeia de limpeza que
 * o hospedeiro já roda.
 *
 * O QUE ELE MEDE, e por que aqui: a sonda de vazamento existente
 * (`tests/e2e-ui/vazamento-viewers.spec.js` mais `tests/e2e-ui/helpers/sonda-vazamento.js`)
 * conta ouvinte de DOM, contexto WebGL e `setInterval`. Ela é CEGA ao `EventEmitter`
 * da casa, então este vazamento passaria verde por lá. A régua usada aqui é
 * `listenerCount` do emissor REAL (`src/js/events/event_emitter.js`), não um espião:
 * é o mesmo objeto que o produto usa, e é ele que acumula.
 *
 * ARMADILHA DO DUBLÊ, e ela decide a forma dos casos: `makeElement`
 * (`tests/helpers/dom-double.js`) não define `isConnected`, então toda seção
 * montada aqui é lida como DESCONECTADA. O fallback preguiçoso, portanto, derruba
 * as inscrições no PRIMEIRO evento temporal emitido. Consequência: nenhum caso que
 * queira medir o cancelamento EXPLÍCITO pode emitir antes de medir, senão ele
 * mediria o fallback e passaria verde sobre o código defeituoso. O parágrafo 4 é
 * justamente o caso que emite, e ele está rotulado: passa nos dois estados do
 * código, é caracterização do fallback, não guarda da correção.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from '../../src/js/events/event_emitter.js';
import { EventTypes } from '../../src/js/events/event_types.js';
import { makeDocumentStub } from '../helpers/dom-double.js';
import { DEFAULT_TEMPORAL_CONFIG } from '../../src/js/temporal/temporal.constants.js';

// Mutable box read at CALL time by the mock factory below (the factory is hoisted
// above these declarations, so it can only close over something already frozen in
// place by `vi.hoisted`).
const box = vi.hoisted(() => ({ bus: null, config: null }));

// PARTIAL mock: everything else in the barrel stays real (`getStorageTypeFromSource`
// is used by the persistence callbacks, `getStateManager` / `getVisibleLayerIds` by
// the transitive imports of `temporal-render.service.js` and
// `layers/visibility-filter.js`). Only the four doors this test needs to control are
// replaced. `temporal-render.service.js` imports `'../store'`, which resolves to the
// same module id as `@store`, so one mock covers both.
vi.mock('@store', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        getEventBus: () => box.bus,
        getControl: () => null,
        getMapTemporalConfigSync: () => box.config,
        updateFeatureProperty: () => {},
    };
});

const {
    createTemporalValiditySection,
    createTemporalAttributesSection,
    createTemporalReadonlySection,
    createTrajectorySection,
    releaseTemporalSection,
} = await import('../../src/js/temporal/temporal-attributes-section.js');

/** The two events `bindTimeContextRerender` subscribes to. */
const TEMPORAL_EVENTS = [EventTypes.TEMPORAL_CONFIG_CHANGED, EventTypes.MAP_TEMPORAL_CHANGED];

/** Listener counts on the real bus, one entry per subscribed event. */
function counts() {
    return TEMPORAL_EVENTS.map((event) => box.bus.listenerCount(event));
}

/** A feature carrying a full temporal payload (validity window and trajectory). */
function makeFeature() {
    return {
        properties: {
            id: 'feat-1',
            source: 'point',
            temporalInicio: 1_700_000_000_000,
            temporalFim: 1_700_003_600_000,
            trajetoria: [
                { t: 1_700_000_000_000, lng: -43.2, lat: -22.9 },
                { t: 1_700_003_600_000, lng: -43.1, lat: -22.8 },
            ],
        },
    };
}

/** The shared builder, with the wiring the 2D panel and the 3D/360 panels pass. */
function buildValiditySection() {
    return createTemporalValiditySection({ inicio: null, fim: null, onChange: () => {} });
}

let previousDocument;

beforeEach(() => {
    box.bus = new EventEmitter();
    box.config = { ...DEFAULT_TEMPORAL_CONFIG };
    previousDocument = globalThis.document;
    globalThis.document = makeDocumentStub();
});

afterEach(() => {
    globalThis.document = previousDocument;
});

describe('painel temporal: a inscrição é liberada com o hospedeiro', () => {
    // 1. A RÉGUA. Everything below counts subscriptions; if the ruler itself were
    // broken (a bus that never registers, an event name nobody listens to), every
    // other case would pass green while proving nothing.
    describe('1. a régua mede o que promete', () => {
        it('o barramento começa sem ouvinte temporal nenhum', () => {
            expect(counts()).toEqual([0, 0]);
        });

        it('uma seção montada assina EXATAMENTE um ouvinte por evento', () => {
            const section = buildValiditySection();

            expect(section).toBeTruthy();
            expect(counts()).toEqual([1, 1]);
            expect(box.bus.totalListenerCount()).toBe(2);
        });

        it('a régua enxerga o acúmulo: duas seções vivas são dois ouvintes por evento', () => {
            buildValiditySection();
            buildValiditySection();

            expect(counts()).toEqual([2, 2]);
        });
    });

    // 2. O DEFEITO. 30 rebuilds is roughly what one geometry edit costs (one panel
    // rebuild per handle drop). NOTHING is emitted here on purpose: emitting would
    // hand the lazy `isConnected` fallback the cancellation, and the case would pass
    // green over the broken code (see the fileoverview).
    describe('2. construir e liberar 30 vezes não deixa resíduo', () => {
        it('zera os dois eventos, sem emitir nada', () => {
            const sections = [];

            for (let i = 0; i < 30; i += 1) {
                const section = buildValiditySection();
                sections.push(section);
                releaseTemporalSection(section);
            }

            // Guards against an empty loop reporting success: 30 sections were really
            // built, and each one really subscribed before being released.
            expect(sections).toHaveLength(30);
            expect(sections.every(Boolean)).toBe(true);
            expect(counts()).toEqual([0, 0]);
            expect(box.bus.totalListenerCount()).toBe(0);
        });

        it('liberar duas vezes é inócuo, e liberar algo que nunca assinou também', () => {
            const section = buildValiditySection();

            releaseTemporalSection(section);
            releaseTemporalSection(section);
            releaseTemporalSection(globalThis.document.createElement('div'));
            releaseTemporalSection(null);
            releaseTemporalSection(undefined);

            expect(counts()).toEqual([0, 0]);
        });
    });

    // 3. AS TRÊS SEÇÕES que o painel de feição monta. Cada uma tem o seu próprio
    // ponto de `bindTimeContextRerender`, e uma correção que alcançasse só a
    // primeira deixaria as outras duas vazando pelo mesmo caminho.
    describe('3. as três seções do painel liberam a sua inscrição', () => {
        const casos = [
            {
                nome: 'validade (createTemporalAttributesSection)',
                build: () => createTemporalAttributesSection({
                    feature: makeFeature(),
                    featureType: 'point',
                    selectedFeatures: [makeFeature()],
                    control: null,
                }),
            },
            {
                nome: 'somente leitura (createTemporalReadonlySection, mapa travado)',
                // Returns null when the feature carries no temporal data at all, so
                // the fixture's finite `temporalInicio` is what makes this case exist.
                build: () => createTemporalReadonlySection({ feature: makeFeature() }),
            },
            {
                nome: 'trajetória (createTrajectorySection, só point/military_symbol/coordination_measure)',
                build: () => createTrajectorySection({
                    feature: makeFeature(),
                    featureType: 'point',
                    map: null,
                }),
            },
        ];

        for (const caso of casos) {
            it(`${caso.nome}: assina ao montar e some ao liberar`, () => {
                const section = caso.build();

                // Absolute assertion first: a builder that returned null (the readonly
                // one does, for a purely-spatial feature) would make the counts below
                // trivially zero and the case vacuous.
                expect(section).toBeTruthy();
                expect(counts()).toEqual([1, 1]);

                releaseTemporalSection(section);

                expect(counts()).toEqual([0, 0]);
            });
        }

        it('as três juntas, como o painel as monta: seis ouvintes que voltam a zero', () => {
            const sections = casos.map((caso) => caso.build());

            expect(sections).toHaveLength(3);
            expect(sections.every(Boolean)).toBe(true);
            expect(counts()).toEqual([3, 3]);

            sections.forEach((section) => releaseTemporalSection(section));

            expect(counts()).toEqual([0, 0]);
        });
    });

    // 4. CARACTERIZAÇÃO, NÃO GUARDA. Este bloco passa nos DOIS estados do código
    // (antes e depois de `releaseTemporalSection`), porque mede a rede de segurança
    // que já existia. Ele está aqui para que a rede não seja removida por engano ao
    // mexer no cancelamento explícito, e o rótulo evita que alguém o leia como prova
    // da correção.
    describe('4. o fallback preguiçoso continua vivo (caracterização)', () => {
        it('seção AINDA no DOM: o evento re-renderiza e mantém a inscrição', () => {
            const section = buildValiditySection();
            section.isConnected = true;

            box.bus.emit(EventTypes.MAP_TEMPORAL_CHANGED, {});

            expect(counts()).toEqual([1, 1]);
            // The rebuild really ran: the body was replaced and still carries the title.
            expect(section.children[0].textContent).toBe('Validade temporal');
        });

        it('seção FORA do DOM: o próximo evento temporal derruba a inscrição', () => {
            const section = buildValiditySection();
            section.isConnected = false;

            expect(counts()).toEqual([1, 1]);

            box.bus.emit(EventTypes.MAP_TEMPORAL_CHANGED, {});

            expect(counts()).toEqual([0, 0]);
        });

        it('e é isso que o caso 2 não pode usar: o fallback só age SE outro evento chegar', () => {
            // The same 30 rebuilds of case 2, released nowhere: with no event they stay.
            // This is the leak as the user met it (a map with no active timeline emits
            // no temporal event at all).
            const sections = [];
            for (let i = 0; i < 30; i += 1) {
                const section = buildValiditySection();
                section.isConnected = false;
                sections.push(section);
            }

            expect(sections).toHaveLength(30);
            expect(counts()).toEqual([30, 30]);
        });
    });

    // 5. FIAÇÃO, POR LEITURA DE FONTE. Os casos acima exercem o módulo temporal
    // sozinho: eles provam que `releaseTemporalSection` FUNCIONA, e nada mais. Quem
    // decide se o vazamento existe na tela são os TRÊS hospedeiros, e nenhum deles é
    // montável em node (o painel de feição é `async` e puxa a store inteira, os dois
    // painéis de marcador puxam Cesium e o visualizador 360).
    //
    // O ALCANCE DESTE BLOCO, dito em voz alta para que ninguém o leia por mais do que
    // ele é: leitura de fonte prova EXISTÊNCIA da chamada, nunca EXECUÇÃO dela. Um
    // `releaseTemporalSection` empilhado numa cadeia que o hospedeiro deixasse de
    // rodar passaria verde aqui. O que fecha esse buraco é o e2e de vazamento, não
    // este arquivo.
    describe('5. os três hospedeiros empilham a liberação na sua cadeia de limpeza', () => {
        const raiz = fileURLToPath(new URL('../../src/js/', import.meta.url));
        const hospedeiros = [
            {
                nome: 'painel de feição (2D)',
                arquivo: 'sidebar/panels/feature-panel-content.js',
                // Validade + trajetória (mapa editável) e o resumo somente leitura
                // (mapa travado): as três seções temporais que ele monta.
                esperado: 3,
            },
            { nome: 'painel de marcador 3D', arquivo: '3d_models_viewer_tool/components/marker-panel-3d.js', esperado: 1 },
            { nome: 'painel de marcador 360', arquivo: 'street_view_tool/components/marker-panel-360.js', esperado: 1 },
        ];

        for (const hospedeiro of hospedeiros) {
            it(`${hospedeiro.nome}: importa e empilha ${hospedeiro.esperado}`, () => {
                const fonte = readFileSync(join(raiz, hospedeiro.arquivo), 'utf8');

                // The import has to be there, or the pushes below would be a ReferenceError
                // at runtime instead of the cleanup this test claims to find.
                expect(fonte).toMatch(/import \{[^}]*releaseTemporalSection[^}]*\} from '@js\/temporal\/temporal-attributes-section\.js';/);

                // Line by line, skipping comments. Matching the whole file with a
                // single regex counted a COMMENTED-OUT push as wiring: measured while
                // running the negative control for this very case, which is the
                // "empty coverage passes green" class in person.
                const empilhadas = fonte
                    .split('\n')
                    .map((linha) => linha.trim())
                    .filter((linha) => !linha.startsWith('//') && !linha.startsWith('*'))
                    .filter((linha) => /cleanupFunctions\.push\(\(\) => releaseTemporalSection\(/.test(linha));
                expect(empilhadas).toHaveLength(hospedeiro.esperado);
            });
        }
    });
});
