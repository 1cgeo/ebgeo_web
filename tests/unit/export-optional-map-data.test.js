// Path: tests/unit/export-optional-map-data.test.js
//
// Regressão: os GRUPOS eram descartados do .ebgeo, em silêncio.
//
// `_exportOptionalMapData` decide o que entra no arquivo por um predicado por seção. O de
// grupos era `check: (v) => v?.size > 0`, e `.size` só existe em `Map`. O que `getMapGroups`
// devolve é um OBJETO simples (`memoryStore.groups[mapa]`, chaveado por id), então o predicado
// era `undefined > 0`, isto é, sempre falso: o usuário agrupava feições, salvava o projeto,
// reabria, e os grupos tinham sumido. Sem erro e sem aviso.
//
// O importador nunca teve culpa: `importGroupsDirectly` sempre soube ler a seção. Quem não a
// entregava era o exportador.
//
// O QUE ESTE TESTE PRENDE, e por que não é sobre grupos apenas: o predicado tem de casar com o
// TIPO que o getter devolve. As sete seções são testadas juntas contra um retorno realista de
// cada uma, porque foi a divergência entre o tipo suposto e o tipo real que produziu o defeito,
// e ela pode voltar em qualquer uma das outras seis.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const h = vi.hoisted(() => ({
    colorUsage: {},
    mapNotes: null,
    // O formato REAL: objeto chaveado por id de grupo. Se algum dia virar Map, este duplo é o
    // primeiro lugar que precisa mudar, e o teste falha em vez de o arquivo emagrecer calado.
    groups: {},
    layers: [],
    cesium3d: null,
    streetview360: null,
    temporal: null,
}));

vi.mock('../../src/js/store/index.js', () => ({
    getColorUsage: vi.fn(async () => h.colorUsage),
    getMapNotes: vi.fn(async () => h.mapNotes),
    getMapGroups: vi.fn(() => h.groups),
    getLayers: vi.fn(() => h.layers),
    getCesium3dDataForExport: vi.fn(async () => h.cesium3d),
    getStreetview360DataForExport: vi.fn(async () => h.streetview360),
    getMapTemporalConfig: vi.fn(async () => h.temporal),
}));

const { DEFAULT_TEMPORAL_CONFIG } = await import('../../src/js/temporal/temporal.constants.js');
const store = await import('../../src/js/store/index.js');

/**
 * A tabela de decisão do exportador, copiada de `_exportOptionalMapData`. Copiar é o preço de
 * o método ser privado e a lista ser um literal dentro dele; o valor é que o teste falha
 * quando os dois divergirem, que é exatamente o evento que este arquivo existe para pegar.
 * @returns {Array<{key: string, fn: Function, check: Function, transform?: Function}>}
 */
function tarefasDoExport(mapName) {
    return [
        { key: 'colorUsage', fn: () => store.getColorUsage(mapName), check: (v) => v && Object.keys(v).length > 0 },
        { key: 'mapNotes', fn: () => store.getMapNotes(mapName), check: (v) => v && (v.title || v.description) },
        { key: 'groups', fn: () => store.getMapGroups(mapName), check: (v) => v && Object.keys(v).length > 0 },
        { key: 'layers', fn: () => store.getLayers(mapName), check: (v) => v?.length > 0 },
        { key: 'cesium3d', fn: () => store.getCesium3dDataForExport(mapName), check: (v) => !!v },
        { key: 'streetview360', fn: () => store.getStreetview360DataForExport(mapName), check: (v) => !!v },
        {
            key: 'temporal',
            fn: () => store.getMapTemporalConfig(mapName),
            check: (v) => !!v && Object.keys(DEFAULT_TEMPORAL_CONFIG).some((k) => v[k] !== DEFAULT_TEMPORAL_CONFIG[k]),
        },
    ];
}

/** Roda a tabela como o exportador roda, e devolve o que teria entrado no arquivo. */
async function coletar(mapName = 'Principal') {
    const saida = {};
    for (const { key, fn, check, transform } of tarefasDoExport(mapName)) {
        const value = await fn();
        if (check(value)) saida[key] = transform ? transform(value) : value;
    }
    return saida;
}

beforeEach(() => {
    h.colorUsage = {};
    h.mapNotes = null;
    h.groups = {};
    h.layers = [];
    h.cesium3d = null;
    h.streetview360 = null;
    h.temporal = null;
});

// A TABELA ACIMA É UMA CÓPIA, e cópia não prende código. Sem o caso abaixo, este arquivo
// passaria verde com o exportador REAL ainda descartando os grupos, que é precisamente a forma
// de cobertura vazia que o defeito original explorou. Este caso lê o fonte e amarra os dois.
describe('a tabela copiada acima corresponde ao exportador REAL', () => {
    const fonte = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'js', 'import_export', 'export-import.service.js'),
        'utf8'
    );

    it('o predicado de `groups` no fonte NÃO depende de `.size`', () => {
        const linha = fonte.split(/\r?\n/).find((l) => l.includes("key: 'groups'"));
        expect(linha, 'a entrada de groups sumiu de _exportOptionalMapData').toBeDefined();
        // `.size` só existe em Map, e `getMapGroups` devolve objeto: era `undefined > 0`.
        expect(linha).not.toMatch(/\?\.size|\.size\s*>/);
        expect(linha).toMatch(/Object\.keys/);
    });

    it('as sete seções seguem existindo, e nenhuma ganhou predicado por `.size`', () => {
        const chaves = [...fonte.matchAll(/key: '(\w+)', fn:/g)].map((m) => m[1]);
        expect(chaves).toEqual(['colorUsage', 'mapNotes', 'groups', 'layers', 'cesium3d', 'streetview360']);
        // `temporal` é o sétimo e tem forma multilinha, então é conferido à parte.
        expect(fonte).toMatch(/key: 'temporal'/);

        // Sem os comentários: o comentário que EXPLICA o defeito cita `.size` de propósito, e
        // uma varredura ingênua acusaria a própria explicação. É o que aconteceu na primeira
        // versão deste caso.
        const bloco = fonte
            .slice(fonte.indexOf('const tasks = ['), fonte.indexOf('for (const { key, fn, check, transform }'))
            .split(/\r?\n/)
            .filter((l) => !l.trim().startsWith('//'))
            .join('\n');
        expect(bloco).not.toMatch(/\.size/);
    });
});

describe('_exportOptionalMapData: cada predicado casa com o tipo que o getter devolve', () => {
    it('GRUPOS entram no arquivo (a regressão): objeto com chaves é conteúdo, não vazio', async () => {
        h.groups = {
            'g-1': { id: 'g-1', name: 'Grupo 1', features: [{ id: 'f1', source: 'point' }] },
            'g-2': { id: 'g-2', name: 'Grupo 2', features: [{ id: 'f2', source: 'line' }] },
        };

        const saida = await coletar();

        expect(saida.groups).toBeDefined();
        expect(Object.keys(saida.groups)).toEqual(['g-1', 'g-2']);
        // A asserção que mata o defeito original: o objeto NÃO tem `.size`, então qualquer
        // predicado que dependa de `.size` volta a descartar tudo.
        expect(h.groups.size).toBeUndefined();
    });

    it('sem grupos, a seção não entra (controle: o predicado não vira sempre-verdadeiro)', async () => {
        h.groups = {};
        expect((await coletar()).groups).toBeUndefined();

        h.groups = null;
        expect((await coletar()).groups).toBeUndefined();
    });

    it('as outras seis seções continuam entrando quando têm conteúdo', async () => {
        h.colorUsage = { '#FF0000': 3 };
        h.mapNotes = { title: 'Ordem de Operações', description: '' };
        h.layers = [{ id: 'default', name: 'Padrão' }];
        h.cesium3d = { markers: [{ id: 'm1' }], measurements: [], viewsheds: [], cameraPositions: {} };
        h.streetview360 = { orientations: { FOTO_1: {} }, markers: [] };
        h.temporal = { ...DEFAULT_TEMPORAL_CONFIG, ativo: true };

        const saida = await coletar();

        expect(Object.keys(saida).sort()).toEqual(
            ['cesium3d', 'colorUsage', 'layers', 'mapNotes', 'streetview360', 'temporal'].sort()
        );
    });

    it('e nenhuma entra quando estão vazias (controle negativo do caso acima)', async () => {
        h.temporal = { ...DEFAULT_TEMPORAL_CONFIG };   // igual ao default: não é configuração
        h.mapNotes = { title: '', description: '' };   // notas em branco não são notas

        expect(await coletar()).toEqual({});
    });
});
