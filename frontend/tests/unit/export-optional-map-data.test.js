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
// TIPO que o getter devolve. As seções são testadas juntas contra um retorno realista de cada
// uma, porque foi a divergência entre o tipo suposto e o tipo real que produziu o defeito, e
// ela pode voltar em qualquer uma das outras.
//
// PORTE (2026-08-20): veio de 1f2b3428 do ebgeo_web main, e mudou de forma em dois pontos.
//
// PRIMEIRO, o tamanho: lá a tabela tinha SETE seções, aqui tem NOVE (`gridStyle` e `comments`
// nasceram depois, no trabalho de grade por mapa e de comentário espacial). Copiar as sete
// teria produzido um teste que afirma completude sobre um recorte.
//
// SEGUNDO, e é o que importa: o teste do monolito COPIAVA a tabela do exportador, porque ela
// era um literal dentro de um método privado. Cópia não prende código, e isso foi MEDIDO aqui
// antes de reescrever: trocando o predicado real de `gridStyle` por `() => true` no fonte, a
// versão copiada seguia verde nos nove casos. Um teste de regressão que não vê o predicado
// errar é a mesma cobertura vazia que o defeito original explorou. Por isso a tabela saiu para
// `src/js/import_export/export-optional-sections.js` e este arquivo importa a função REAL: não
// há mais cópia para divergir.

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
    gridStyle: null,
    comments: {},
}));

vi.mock('@store', () => ({
    getColorUsage: vi.fn(async () => h.colorUsage),
    getMapNotes: vi.fn(async () => h.mapNotes),
    // OS GEMEOS DE REPOSITORIO, e os nomes importam. Ate 2026-09-01 a tabela chamava
    // `getMapGroups`/`getLayers`, que sao SINCRONOS e leem `memoryStore`, hidratado so para o
    // mapa corrente: exportar sem visitar um mapa mandava as camadas dele como uma `default`
    // inventada e a secao de grupos vazia. Este arquivo NAO prova a fonte (ele dubla o barril
    // inteiro, entao qualquer nome que a tabela chame vira um duplo); quem prova e
    // `tests/integration/export-le-do-repositorio.test.js`. O que ele prova aqui e o que sempre
    // provou: que o predicado casa com o TIPO devolvido.
    getMapGroupsFromDB: vi.fn(async () => h.groups),
    getLayersRepo: vi.fn(async () => h.layers),
    getCesium3dDataForExport: vi.fn(async () => h.cesium3d),
    getStreetview360DataForExport: vi.fn(async () => h.streetview360),
    getMapTemporalConfig: vi.fn(async () => h.temporal),
    getGridStyle: vi.fn(async () => h.gridStyle),
    getComments: vi.fn(async () => h.comments),
}));

const { DEFAULT_TEMPORAL_CONFIG } = await import('@js/temporal/temporal.constants.js');
// A tabela REAL do exportador, não uma cópia dela.
const { optionalSectionTasks } = await import('@js/import_export/export-optional-sections.js');

/**
 * Roda a tabela como o exportador roda, e devolve o que teria entrado no arquivo.
 * @param {string} [mapName] - mapa a coletar
 * @returns {Promise<Object>} as seções que passaram no predicado
 */
async function coletar(mapName = 'Principal') {
    const saida = {};
    for (const { key, fn, check, transform } of optionalSectionTasks(mapName)) {
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
    h.gridStyle = null;
    h.comments = {};
});

// O TESTE AGORA RODA A TABELA REAL, e isso abre um buraco novo: um módulo exportado que
// ninguém chama passaria verde aqui enquanto o exportador segue com uma tabela própria. Os
// dois casos abaixo fecham exatamente isso, lendo o fonte do serviço.
describe('o exportador REAL usa a tabela que este arquivo exercita', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const servico = readFileSync(join(dir, '..', '..', 'src', 'js', 'import_export', 'export-import.service.js'), 'utf8');

    it('_exportOptionalMapData chama optionalSectionTasks, e não monta tabela própria', () => {
        const ini = servico.indexOf('async _exportOptionalMapData');
        expect(ini, '_exportOptionalMapData sumiu do serviço').toBeGreaterThan(-1);
        const corpo = servico.slice(ini, ini + 900);
        expect(corpo).toMatch(/optionalSectionTasks\(mapName\)/);
        // A forma antiga: um literal com as entradas dentro do método. Se ela voltar, os casos
        // de comportamento deste arquivo passariam a medir um módulo paralelo ao que roda.
        expect(corpo).not.toMatch(/key: '/);
    });

    it('o serviço importa a tabela do módulo, e não redeclara os getters de seção', () => {
        expect(servico).toMatch(/import \{ optionalSectionTasks \} from '\.\/export-optional-sections\.js'/);
    });
});

describe('a tabela real: forma e completude', () => {
    it('tem exatamente as NOVE seções, na ordem em que são escritas no arquivo', () => {
        const chaves = optionalSectionTasks('Principal').map((t) => t.key);
        expect(chaves).toEqual([
            'colorUsage',
            'mapNotes',
            'groups',
            'layers',
            'cesium3d',
            'streetview360',
            'temporal',
            'gridStyle',
            'comments',
        ]);
    });

    it('toda entrada traz getter e predicado chamáveis', () => {
        const tarefas = optionalSectionTasks('Principal');
        expect(tarefas.length).toBe(9);
        for (const t of tarefas) {
            expect(typeof t.fn, `${t.key}.fn`).toBe('function');
            expect(typeof t.check, `${t.key}.check`).toBe('function');
        }
    });

    it('nenhum predicado depende de `.size`, que só existe em Map', () => {
        // `.size` foi a causa raiz de 1f2b3428: os getters devolvem objeto ou array, nunca Map.
        for (const t of optionalSectionTasks('Principal')) {
            expect(String(t.check), `${t.key}.check`).not.toMatch(/\.size/);
        }
    });

    // Nenhum predicado pode ser sempre-verdadeiro: um `() => true` faria a seção entrar no
    // arquivo mesmo vazia, e nenhum dos casos de conteúdo acima notaria.
    it('nenhum predicado aceita undefined ou null', () => {
        const tarefas = optionalSectionTasks('Principal');
        expect(tarefas.length).toBe(9);
        for (const t of tarefas) {
            expect(Boolean(t.check(undefined)), `${t.key}.check(undefined)`).toBe(false);
            expect(Boolean(t.check(null)), `${t.key}.check(null)`).toBe(false);
        }
    });

    // O objeto VAZIO separa as seções em TRÊS regimes, e a diferença é contrato de cada getter,
    // não descuido. Medi um por um em vez de supor uniformidade:
    //
    //   - seis CONTAM conteúdo (chaves ou comprimento), então `{}`/`[]` ficam de fora;
    //   - `cesium3d` e `streetview360` usam `!!v`, porque os getters devolvem `null` quando não
    //     há dado, nunca um objeto vazio;
    //   - `temporal` compara campo a campo com o default, e `{}` difere do default em todos
    //     eles (`undefined !== valor`), então passa. Também aqui o getter é quem garante a
    //     forma: ele devolve o default inteiro ou `null`.
    //
    // Fixar os três grupos faz um predicado que MUDE de regime aparecer, em vez de passar como
    // uniformidade que este arquivo nunca mediu.
    it('objeto vazio: seis seções recusam, três dependem do contrato do getter', () => {
        const porChave = Object.fromEntries(optionalSectionTasks('Principal').map((t) => [t.key, t.check]));
        const contamConteudo = ['colorUsage', 'mapNotes', 'groups', 'layers', 'gridStyle', 'comments'];
        const dependemDoGetter = ['cesium3d', 'streetview360', 'temporal'];
        expect([...contamConteudo, ...dependemDoGetter].sort()).toEqual(Object.keys(porChave).sort());

        for (const k of contamConteudo) {
            expect(Boolean(porChave[k]({})), `${k}.check({})`).toBe(false);
            expect(Boolean(porChave[k]([])), `${k}.check([])`).toBe(false);
        }
        for (const k of dependemDoGetter) {
            expect(Boolean(porChave[k]({})), `${k}.check({}) segue o contrato do getter`).toBe(true);
        }
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

    it('as NOVE seções entram juntas quando todas têm conteúdo', async () => {
        h.colorUsage = { '#FF0000': 3 };
        h.mapNotes = { title: 'Ordem de Operações', description: '' };
        h.groups = { 'g-1': { id: 'g-1', name: 'Grupo 1', features: [] } };
        h.layers = [{ id: 'default', name: 'Padrão' }];
        h.cesium3d = { markers: [{ id: 'm1' }], measurements: [], viewsheds: [], cameraPositions: {} };
        h.streetview360 = { orientations: { FOTO_1: {} }, markers: [] };
        h.temporal = { ...DEFAULT_TEMPORAL_CONFIG, ativo: true };
        h.gridStyle = { tipo: 'utm', espacamento: 1000, cor: '#000000' };
        h.comments = { 'c-1': { id: 'c-1', texto: 'Rever este eixo', lng: -44, lat: -22, replies: [] } };

        const saida = await coletar();

        expect(Object.keys(saida).sort()).toEqual(
            [
                'cesium3d',
                'colorUsage',
                'comments',
                'gridStyle',
                'groups',
                'layers',
                'mapNotes',
                'streetview360',
                'temporal',
            ].sort()
        );
    });

    it('e nenhuma entra quando estão vazias (controle negativo do caso acima)', async () => {
        h.temporal = { ...DEFAULT_TEMPORAL_CONFIG };   // igual ao default: não é configuração
        h.mapNotes = { title: '', description: '' };   // notas em branco não são notas
        h.gridStyle = {};                              // objeto vazio não é grade configurada
        h.comments = {};                               // mapa sem comentário

        expect(await coletar()).toEqual({});
    });

    // As duas seções que o monolito não tinha, cada uma com o predicado que a distingue de
    // vazio. Sem estes casos o porte teria acrescentado duas linhas à tabela sem verificá-las.
    it('gridStyle: objeto com chave entra, objeto vazio não', async () => {
        h.gridStyle = { tipo: 'utm', espacamento: 1000 };
        expect((await coletar()).gridStyle).toEqual({ tipo: 'utm', espacamento: 1000 });

        h.gridStyle = {};
        expect((await coletar()).gridStyle).toBeUndefined();

        h.gridStyle = null;
        expect((await coletar()).gridStyle).toBeUndefined();
    });

    it('comments: threads entram por contagem de chave, não por `.length`', async () => {
        h.comments = {
            'c-1': { id: 'c-1', texto: 'raiz', replies: [{ id: 'r-1' }] },
            'c-2': { id: 'c-2', texto: 'outra', replies: [] },
        };

        const saida = await coletar();

        expect(Object.keys(saida.comments)).toEqual(['c-1', 'c-2']);
        // Mesmo formato de `groups`: objeto chaveado por id. Um predicado por `.length` ou
        // `.size` aqui repetiria o defeito de 1f2b3428 numa seção nova.
        expect(h.comments.length).toBeUndefined();
        expect(h.comments.size).toBeUndefined();
    });
});
