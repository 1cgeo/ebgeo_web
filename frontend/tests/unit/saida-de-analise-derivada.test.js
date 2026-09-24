// Path: tests/unit/saida-de-analise-derivada.test.js

/**
 * @fileoverview A SAÍDA DAS ANÁLISES (visada e viewshed) É DERIVADA POR CADA CLIENTE, e este arquivo
 * prende as três coisas que a decisão de 2026-09-23 exige.
 *
 * 1. A DIVISÃO, EM ABSOLUTO. `deriveAnalysisOutput` (`src/js/store/analysis-output.js`) sobre
 *    entradas conhecidas, com ids, cores e geometrias escritos à mão. Sem isto a equivalência abaixo
 *    passaria com os dois lados errados do mesmo jeito.
 *
 * 2. A EQUIVALÊNCIA AUTOR x PAR, NO MESMO CORPUS. O autor desenha pela ferramenta
 *    (`generateProcessedFeatures` das duas classes de geometria); o par deriva pelo caminho de
 *    entrada (`replaceDerivedOutput`, chamado por `applyRemoteFeatureOp`) e pelo retrato
 *    (`rederiveAllAnalysisOutputs`, chamado por `reshapeSnapshotMap`). Os três precisam dar o MESMO
 *    documento, campo a campo, senão o par vê uma análise diferente da do autor.
 *
 * 3. O CENSO DO CARIMBO. O despachante descarta a escrita de uma saída pelo BALDE que a op de store
 *    carimba como `storage`. Uma op de feição nova que nasça sem o carimbo volta a mandar a saída
 *    ao servidor, que a recusa, e o autor fica com recusas eternas: exatamente o defeito medido.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = { ...properties }; }
    },
}));
vi.mock('@js/terrain', () => ({
    createTerrainSampler: vi.fn(() => ({ elevation: () => 0, fast: true, zoom: 12 })),
}));

const {
    deriveAnalysisOutput, replaceDerivedOutput, rederiveAllAnalysisOutputs,
    derivedOutputBucketOf, isDerivedOutputBucket, derivedOutputIdsOf, isDerivedOutputOperation,
} = await import('@store/analysis-output.js');
const { default: AddLOSGeometry } = await import('../../src/js/analysis_tools/los_tool/add_los_geometry.js');
const { default: AddVisibilityGeometry } = await import(
    '../../src/js/analysis_tools/visibility_tool/add_visibility_geometry.js'
);

const LOS_ID = '11111111-1111-4111-8111-111111111111';
const VIS_ID = '22222222-2222-4222-8222-222222222222';

/** Visada OBSTRUÍDA: a MultiLineString já vem partida no ponto de obstrução. */
const losObstruida = () => ({
    type: 'Feature',
    properties: { id: LOS_ID, source: 'los', nome: 'Linha de Visada #1', width: 5, opacity: 1,
        layerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', confirmedVersion: 3, profileData: '[{"distance":0}]' },
    geometry: { type: 'MultiLineString', coordinates: [[[-43.26, -22.9], [-43.25, -22.9]], [[-43.25, -22.9], [-43.14, -22.9]]] },
});

/** Visada LIVRE: LineString inteira, só a metade visível existe. */
const losLivre = () => ({
    type: 'Feature',
    properties: { id: '33333333-3333-4333-8333-333333333333', source: 'los', width: 3, opacity: 0.8 },
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
});

/** Viewshed com três células, duas visíveis e uma obstruída. */
const viewshedMisto = () => ({
    type: 'Feature',
    properties: { id: VIS_ID, source: 'visibility', nome: 'Visibilidade #1', opacity: 0.5,
        cellData: [{ isVisible: true }, { isVisible: false }, { isVisible: true }] },
    geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[2, 2], [3, 2], [3, 3], [2, 2]]], [[[4, 4], [5, 4], [5, 5], [4, 4]]]] },
});

/** Viewshed inteiramente visível: só a metade visível nasce. */
const viewshedTodoVisivel = () => ({
    type: 'Feature',
    properties: { id: '44444444-4444-4444-8444-444444444444', source: 'visibility', cellData: [{ isVisible: true }] },
    geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] },
});

const CORPUS = [
    ['los', losObstruida],
    ['los', losLivre],
    ['visibility', viewshedMisto],
    ['visibility', viewshedTodoVisivel],
];

/** O documento de mapa mínimo que o caminho de entrada edita. */
const documento = () => ({ los: [], visibility: [], processed_los: [], processed_visibility: [], points: [] });

describe('a divisao da saida, em absoluto', () => {
    it('visada obstruida: duas linhas, verde e depois vermelha, com o id e as props da entrada', () => {
        const [visivel, obstruida] = deriveAnalysisOutput('los', losObstruida());
        expect(visivel).toEqual({
            type: 'Feature', id: `${LOS_ID}-visible`,
            properties: { ...losObstruida().properties, id: `${LOS_ID}-visible`, color: '#00FF00' },
            geometry: { type: 'LineString', coordinates: [[-43.26, -22.9], [-43.25, -22.9]] },
        });
        expect(obstruida.id).toBe(`${LOS_ID}-obstructed`);
        expect(obstruida.properties.color).toBe('#FF0000');
        expect(obstruida.geometry).toEqual({ type: 'LineString', coordinates: [[-43.25, -22.9], [-43.14, -22.9]] });
    });

    it('visada livre: uma so linha, verde, com a geometria da entrada', () => {
        const out = deriveAnalysisOutput('los', losLivre());
        expect(out.map((f) => f.id)).toEqual(['33333333-3333-4333-8333-333333333333-visible']);
        expect(out[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    });

    it('viewshed: as celulas se repartem pelo cellData, e nenhuma metade carrega cellData', () => {
        const [visivel, obstruida] = deriveAnalysisOutput('visibility', viewshedMisto());
        expect(visivel.id).toBe(`${VIS_ID}-visible`);
        expect(visivel.geometry.coordinates).toEqual([[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[4, 4], [5, 4], [5, 5], [4, 4]]]]);
        expect(obstruida.geometry.coordinates).toEqual([[[[2, 2], [3, 2], [3, 3], [2, 2]]]]);
        expect(Object.hasOwn(visivel.properties, 'cellData')).toBe(false);
        expect(Object.hasOwn(obstruida.properties, 'cellData')).toBe(false);
        expect(visivel.properties.nome).toBe('Visibilidade #1');
    });

    it('entrada que nao e entrada, ou sem geometria, nao deriva nada', () => {
        expect(deriveAnalysisOutput('points', losObstruida())).toEqual([]);
        expect(deriveAnalysisOutput('los', { properties: { id: 'x' } })).toEqual([]);
        expect(deriveAnalysisOutput('los', null)).toEqual([]);
        expect(deriveAnalysisOutput('visibility', { properties: { id: 'v' }, geometry: { type: 'Polygon', coordinates: [] } })).toEqual([]);
    });

    it('a lista unica: entrada -> saida, e so as duas saidas sao derivadas', () => {
        expect(derivedOutputBucketOf('los')).toBe('processed_los');
        expect(derivedOutputBucketOf('visibility')).toBe('processed_visibility');
        expect(derivedOutputBucketOf('lines')).toBeNull();
        expect(derivedOutputBucketOf('constructor')).toBeNull();
        expect(isDerivedOutputBucket('processed_los')).toBe(true);
        expect(isDerivedOutputBucket('processed_visibility')).toBe(true);
        expect(isDerivedOutputBucket('los')).toBe(false);
        expect(isDerivedOutputBucket(undefined)).toBe(false);
        expect(derivedOutputIdsOf('x')).toEqual(['x-visible', 'x-obstructed']);
    });
});

describe('reconhecer a op de saida de um cliente antigo, pelo TIPO', () => {
    const op = (entityId, source, extra = {}) => ({
        entityType: 'feature', entityId,
        data: { type: 'Feature', properties: { id: entityId, source }, geometry: {} }, ...extra,
    });

    it('metade de visada e de viewshed, no create e no delete (payload so em previousData)', () => {
        expect(isDerivedOutputOperation(op(`${LOS_ID}-visible`, 'los'))).toBe(true);
        expect(isDerivedOutputOperation(op(`${VIS_ID}-obstructed`, 'visibility'))).toBe(true);
        const apagar = { entityType: 'feature', entityId: `${LOS_ID}-obstructed`, data: null,
            previousData: { properties: { id: `${LOS_ID}-obstructed`, source: 'los' } } };
        expect(isDerivedOutputOperation(apagar)).toBe(true);
    });

    it('nao reconhece: a entrada, outro tipo com o mesmo sufixo, outra entidade, payload ausente', () => {
        expect(isDerivedOutputOperation(op(LOS_ID, 'los'))).toBe(false);
        expect(isDerivedOutputOperation(op('linha-visible', 'line'))).toBe(false);
        expect(isDerivedOutputOperation({ ...op(`${LOS_ID}-visible`, 'los'), entityType: 'group' })).toBe(false);
        expect(isDerivedOutputOperation({ entityType: 'feature', entityId: `${LOS_ID}-visible`, data: null, previousData: null })).toBe(false);
        expect(isDerivedOutputOperation(null)).toBe(false);
        // O payload nomeia OUTRA feicao: nao e' a metade que o id diz.
        const trocado = op(`${LOS_ID}-visible`, 'los');
        trocado.data.properties.id = 'outra';
        expect(isDerivedOutputOperation(trocado)).toBe(false);
    });
});

describe('equivalencia autor x par, no mesmo corpus', () => {
    const losGeom = new AddLOSGeometry();
    const visGeom = new AddVisibilityGeometry();
    const autor = (bucket, f) => (bucket === 'los' ? losGeom : visGeom).generateProcessedFeatures(f);

    it.each(CORPUS.map(([b, mk]) => [`${b}:${mk().properties.id}`, b, mk]))(
        '%s: a ferramenta, a op remota e o retrato dao o mesmo documento', (_nome, bucket, mk) => {
            const doAutor = JSON.parse(JSON.stringify(autor(bucket, mk())));

            const aoVivo = documento();
            aoVivo[bucket].push(mk());
            expect(replaceDerivedOutput(aoVivo, bucket, mk().properties.id, mk())).toBe(true);
            const saida = derivedOutputBucketOf(bucket);
            expect(JSON.parse(JSON.stringify(aoVivo[saida]))).toEqual(doAutor);

            const retrato = documento();
            retrato[bucket].push(mk());
            rederiveAllAnalysisOutputs(retrato);
            expect(JSON.parse(JSON.stringify(retrato[saida]))).toEqual(doAutor);
            expect(doAutor.length).toBeGreaterThan(0);
        });
});

describe('o caminho de entrada substitui, cascateia e nao toca no resto', () => {
    it('update troca as metades velhas pelas novas; delete (null) so remove', () => {
        const doc = documento();
        const outraVisada = losLivre();
        doc.los.push(losObstruida(), outraVisada);
        rederiveAllAnalysisOutputs(doc);
        expect(doc.processed_los).toHaveLength(3);

        // A visada ficou livre: a metade obstruída some, a visível é refeita.
        const livre = { ...losObstruida(), geometry: { type: 'LineString', coordinates: [[9, 9], [8, 8]] } };
        replaceDerivedOutput(doc, 'los', LOS_ID, livre);
        expect(doc.processed_los.map((f) => f.id).sort()).toEqual([
            `${LOS_ID}-visible`, `${outraVisada.properties.id}-visible`,
        ].sort());
        expect(doc.processed_los.find((f) => f.id === `${LOS_ID}-visible`).geometry.coordinates).toEqual([[9, 9], [8, 8]]);

        replaceDerivedOutput(doc, 'los', LOS_ID, null);
        expect(doc.processed_los.map((f) => f.id)).toEqual([`${outraVisada.properties.id}-visible`]);
    });

    it('balde que nao e entrada: nada muda e a resposta e false', () => {
        const doc = documento();
        doc.processed_los.push({ properties: { id: 'intocado' } });
        expect(replaceDerivedOutput(doc, 'points', 'p1', { properties: { id: 'p1' }, geometry: {} })).toBe(false);
        expect(doc.processed_los).toEqual([{ properties: { id: 'intocado' } }]);
    });

    it('o retrato descarta linhas legadas do servidor que a derivacao nunca produziria', () => {
        const doc = documento();
        doc.visibility.push(viewshedTodoVisivel());
        doc.processed_visibility.push({ type: 'Feature', properties: { id: '99999999-9999-4999-8999-999999999999', source: 'visibility' }, geometry: {} });
        rederiveAllAnalysisOutputs(doc);
        expect(doc.processed_visibility.map((f) => f.id)).toEqual(['44444444-4444-4444-8444-444444444444-visible']);
    });
});

describe('censo: toda op de feicao da store carimba o balde', () => {
    it('cada recordOperation(EntityType.FEATURE, ...) de src/js passa `storage`', () => {
        const raiz = fileURLToPath(new URL('../../src/js/', import.meta.url));
        const arquivos = execSync('git ls-files -- "*.js"', { cwd: raiz, encoding: 'utf8' })
            .split('\n').filter(Boolean);
        const sitios = [];
        for (const rel of arquivos) {
            const texto = readFileSync(new URL(rel, new URL('../../src/js/', import.meta.url)), 'utf8');
            const re = /recordOperation\(\s*EntityType\.FEATURE\s*,/g;
            let m;
            while ((m = re.exec(texto)) !== null) {
                const fim = texto.indexOf(');', m.index);
                sitios.push({ rel, chamada: texto.slice(m.index, fim) });
            }
        }
        // O piso: os oito sitios de hoje, todos em feature.operations.js. Se o numero cair a zero a
        // varredura parou de achar, e o verde abaixo nao estaria provando nada.
        expect(sitios.length).toBeGreaterThanOrEqual(8);
        const semCarimbo = sitios.filter((s) => !/\bstorage\b/.test(s.chamada)).map((s) => `${s.rel}: ${s.chamada.slice(0, 120)}`);
        expect(semCarimbo).toEqual([]);
    });
});
