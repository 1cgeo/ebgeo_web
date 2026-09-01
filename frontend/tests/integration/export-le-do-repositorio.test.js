// Path: tests/integration/export-le-do-repositorio.test.js

/**
 * @fileoverview A TABELA DE SECOES OPCIONAIS DO `.ebgeo` LE DO REPOSITORIO, NUNCA DA MEMORIA.
 *
 * O DEFEITO. `optionalSectionTasks` (`src/js/import_export/export-optional-sections.js`) decide
 * quem alimenta cada secao opcional do arquivo. Ate 2026-09-01 duas entradas chamavam getters
 * SINCRONOS do barril `@store`, e getter sincrono de store significa uma coisa so: leitura de
 * `memoryStore`. `getMapGroups` cai em `memoryStore.groups[mapa]` e `getLayers` cai em
 * `memoryStore.layers[mapa]`.
 *
 * `memoryStore` e hidratado UM MAPA POR VEZ. Quem hidrata e `setCurrentMap`, chamando
 * `loadGroupsToMemory` e `loadLayersToMemory` para o mapa que a pessoa acabou de abrir, e nada
 * carrega os demais no boot. Entao exportar um atlas sem VISITAR cada mapa entregava, para todo
 * mapa nao corrente:
 *
 *   camadas: uma unica camada `default` INVENTADA na hora por `_ensureMapLayersExist`, que e
 *            falha ABERTA, porque um numero plausivel chega ao arquivo e ninguem desconfia;
 *   grupos:  `{}`, que reprova o predicado e faz a secao inteira sumir do arquivo, falha
 *            fechada.
 *
 * Medido em navegador real: um atlas de 11 mapas com 17 camadas e 2 grupos chegava ao servidor
 * com 11 camadas e ZERO grupos, sem um erro em lugar nenhum.
 *
 * A CORRECAO foi trocar os dois pelos gemeos assincronos de repositorio, `getMapGroupsFromDB` e
 * `getLayersRepo`. Este arquivo e o guarda da FONTE, e a propriedade que ele mede e a unica que
 * separa as duas versoes: com o dado NO DISCO e a memoria NAO HIDRATADA para aquele mapa, a
 * secao sai completa. Por isso nada aqui e dublado no caminho de leitura. O `localforage` e o
 * de producao sobre `fake-indexeddb` (`tests/setup/indexeddb.setup.js`), o repositorio e o real,
 * e a escrita usa os escritores reais (`setLayersCompat` / `setGroupsCompat`).
 *
 * POR QUE O GUARDA VIZINHO NAO SERVE, e nao ha nada errado com ele.
 * `tests/unit/export-optional-map-data.test.js` faz `vi.mock('@store')` dublando o barril
 * inteiro, entao QUALQUER nome que a tabela chame vira um duplo e a fonte fica invisivel para
 * ele: trocar `getLayersRepo` de volta por `getLayers` o deixa verde. O que ele prende e outro
 * eixo, o casamento entre o predicado de cada secao e o TIPO que o getter devolve. Os dois eixos
 * precisam dos dois arquivos.
 *
 * O QUE UM VERDE AQUI NAO PROVA, e a lista importa mais que a assercao:
 *
 *  1. Nao prova nada sobre as outras SETE secoes da tabela. So `groups` e `layers` tinham a
 *     fonte errada, e so elas sao medidas aqui.
 *  2. Nao prova que o exportador de verdade USA esta tabela. Quem le o fonte de
 *     `_exportOptionalMapData` e cobra a chamada e o guarda vizinho; aqui a tabela e percorrida
 *     por um ajudante que imita aquele laco, inclusive o `try/catch` por secao.
 *  3. Nao prova a FRESCURA do que esta no disco. Ler do repositorio exige descarregar a escrita
 *     adiada antes (`flushPendingLayerWrites`, chamada uma vez por `buildExportDataObject`),
 *     senao o documento sai com o estado de ate 300 ms atras. Este arquivo escreve direto no
 *     repositorio, entao aquele passo nao e exercitado.
 *  4. Nao prova o produto ponta a ponta. `fake-indexeddb` e um processo so, e o defeito original
 *     foi visto num navegador com um F5 no meio.
 *
 * SAO DOIS CONTROLES, e e o par que impede este arquivo de virar cobertura vazia.
 *
 * O CONTROLE POSITIVO: um mapa que de fato nao tem nada no disco continua saindo com UMA camada
 * (a padrao sintetizada por `LocalRepository.getLayers`) e SEM secao de grupos. E exatamente
 * esse o desfecho que a versao defeituosa produzia para TODO mapa nao visitado, entao ele e o
 * unico numero que separa "leu do disco" de "leu qualquer coisa": sem ele, um `> 0` ou uma
 * leitura que devolvesse o padrao passariam verde no proprio defeito.
 *
 * O CONTROLE NEGATIVO: o mesmo cenario, a mesma tabela, os mesmos predicados, trocando SO a
 * fonte das duas secoes pelos getters sincronos de memoria que a versao defeituosa chamava. Ele
 * mede a perda em vez de a afirmar (uma camada `default` no lugar de sete, e a secao de grupos
 * ausente), e existe porque a reversao do fonte, que seria o controle canonico, nao esta ao
 * alcance deste arquivo.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetIndexedDB } from '../helpers/idb-helpers.js';

// O toast e a unica porta de saida de UI que o grafo do store abre em node.
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn()
}));

// `localStorage` nao existe no ambiente `node` do vitest, e o grafo do sync o le para o
// `clientId` persistido. Sem ele o import do barril quebra antes de qualquer medicao.
const memoriaLocal = (() => {
    let dados = new Map();
    return {
        getItem: (k) => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); },
        removeItem: (k) => { dados.delete(k); },
        clear: () => { dados = new Map(); }
    };
})();
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: memoriaLocal, writable: true });
}

// ============================================================================
// O cenario
// ============================================================================

/** O mapa que a pessoa NAO visitou nesta sessao: tudo dele mora no disco. */
const MAPA_GUARDADO = 'Mapa Guardado';
/** O mapa corrente, o unico que a memoria conhece. */
const MAPA_CORRENTE = 'Principal';
/** O mapa que de fato nao tem nada: o controle negativo. */
const MAPA_VAZIO = 'Mapa Sem Nada';

/** Quantas camadas o mapa guardado tem NO DISCO. Numero absoluto de proposito. */
const CAMADAS_NO_DISCO = 7;
/** Quantos grupos o mapa guardado tem NO DISCO. */
const GRUPOS_NO_DISCO = 2;

/**
 * As sete camadas como o repositorio as guarda: array, na ordem, com os tres campos de sync
 * que uma camada carrega (`createdAt`, `updatedAt`, `version`) e nada alem deles.
 * @returns {Array<object>} As camadas a gravar.
 */
function camadasDeDisco() {
    const agora = 1_756_000_000_000;
    return Array.from({ length: CAMADAS_NO_DISCO }, (_, i) => ({
        id: `camada-${i + 1}`,
        name: `Camada ${i + 1}`,
        visible: true,
        locked: false,
        opacity: 1,
        order: i,
        createdAt: agora,
        updatedAt: agora,
        version: 1
    }));
}

/**
 * Os dois grupos como o repositorio os guarda: OBJETO chaveado por id, nunca `Map`.
 * @returns {object} Os grupos a gravar.
 */
function gruposDeDisco() {
    return {
        'grupo-a': { id: 'grupo-a', name: 'Escalao Avancado', features: [], visible: true, locked: false },
        'grupo-b': { id: 'grupo-b', name: 'Logistica', features: [], visible: true, locked: false }
    };
}

// ============================================================================
// Modulos, importados DEPOIS do reset de modulos em cada caso
// ============================================================================

let optionalSectionTasks;
let setLayersCompat;
let setGroupsCompat;
let createMapCompat;
let memoryStore;

/** Teto de preparo: a primeira rodada paga a transformacao do grafo do store inteiro. */
const TETO_DE_PREPARO_MS = 60000;

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await resetIndexedDB();
    globalThis.localStorage.clear();

    const servicos = await import('@store/services.js');
    const { awaitMapResolverReady } = await import('@store/services/map-resolver.service.js');
    const { disableOperationLogging } = await import('@store/sync/operation-dispatcher.js');

    // Os servicos sobem como no produto: e com eles de pe que a versao defeituosa lia a memoria
    // vazia sem lancar. Desliga-los faria o caso medir a ausencia deles, nao a fonte.
    servicos.initServices();
    await awaitMapResolverReady();
    // A fila de saida nao e o assunto: sem isto cada escrita enfileira uma op.
    disableOperationLogging();

    const repositorios = await import('@store/repositories/index.js');
    setLayersCompat = repositorios.setLayersCompat;
    setGroupsCompat = repositorios.setGroupsCompat;
    createMapCompat = repositorios.createMapCompat;
    ({ memoryStore } = await import('@store/memory-store.js'));

    ({ optionalSectionTasks } = await import('@js/import_export/export-optional-sections.js'));
}, TETO_DE_PREPARO_MS);

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// Ajudantes
// ============================================================================

/**
 * Percorre a tabela REAL como `_exportOptionalMapData` a percorre, `try/catch` por secao
 * inclusive, e devolve as secoes que teriam entrado no arquivo mais os erros engolidos.
 *
 * OS ERROS SAO DEVOLVIDOS DE PROPOSITO. O laco do exportador engole a excecao de cada secao para
 * que uma falha nao aborte o arquivo inteiro, e um ajudante que copiasse so o `catch` esconderia
 * a diferenca entre "a secao ficou de fora porque o predicado disse nao" e "a secao ficou de
 * fora porque o getter explodiu". As duas saem como ausencia, e sao coisas diferentes.
 * @param {string} mapName - O mapa a coletar.
 * @returns {Promise<{secoes: object, erros: Record<string, Error>}>} O que iria ao arquivo.
 */
async function coletarSecoes(mapName) {
    const secoes = {};
    const erros = {};
    for (const { key, fn, check, transform } of optionalSectionTasks(mapName)) {
        try {
            const value = await fn();
            if (check(value)) secoes[key] = transform ? transform(value) : value;
        } catch (error) {
            erros[key] = error;
        }
    }
    return { secoes, erros };
}

/**
 * Grava no DISCO, pelos escritores reais do repositorio, o mapa guardado com as suas sete
 * camadas e os seus dois grupos, e deixa o mapa CORRENTE sendo outro.
 * @returns {Promise<void>}
 */
async function semearDisco() {
    await createMapCompat(MAPA_CORRENTE);
    await createMapCompat(MAPA_GUARDADO);
    await createMapCompat(MAPA_VAZIO);

    await setLayersCompat(MAPA_GUARDADO, camadasDeDisco());
    await setGroupsCompat(MAPA_GUARDADO, gruposDeDisco());

    // O mapa corrente e OUTRO, que e a condicao do defeito: `setCurrentMap` so hidrata a memoria
    // do mapa que ela abre, e ninguem abriu o guardado.
    memoryStore.currentMap = MAPA_CORRENTE;
}

/**
 * A condicao sem a qual este arquivo nao mede nada: a memoria NAO conhece aquele mapa.
 *
 * Ela e conferida ANTES de cada coleta, e nao depois, porque os getters sincronos criam a
 * entrada que leem (`_ensureMapLayersExist`): perguntar depois responderia sobre um estado que a
 * propria pergunta fabricou.
 * @param {string} mapName - O mapa que deve estar ausente da memoria.
 */
function exigirMemoriaNaoHidratada(mapName) {
    expect(memoryStore.layers?.[mapName], `memoria de camadas de ${mapName}`).toBeUndefined();
    expect(memoryStore.groups?.[mapName], `memoria de grupos de ${mapName}`).toBeUndefined();
}

// ============================================================================
// TESTES
// ============================================================================

describe('a tabela de secoes opcionais le do repositorio, nao da memoria', () => {

    it('mapa NAO visitado: as sete camadas do disco entram no arquivo', async () => {
        await semearDisco();
        exigirMemoriaNaoHidratada(MAPA_GUARDADO);

        const { secoes, erros } = await coletarSecoes(MAPA_GUARDADO);

        // O getter nao explodiu: ausencia por excecao nao pode se disfarcar de ausencia por
        // predicado, nem presenca pode ser lida sem se saber que o caminho foi limpo.
        expect(erros.layers).toBeUndefined();

        expect(secoes.layers).toBeInstanceOf(Array);
        // ABSOLUTO. Com a fonte errada este numero era 1, a camada `default` inventada, e um
        // `> 0` passaria verde exatamente no defeito.
        expect(secoes.layers).toHaveLength(CAMADAS_NO_DISCO);
        expect(secoes.layers.map((l) => l.id)).toEqual([
            'camada-1', 'camada-2', 'camada-3', 'camada-4', 'camada-5', 'camada-6', 'camada-7'
        ]);
        // E nenhuma delas e a padrao sintetizada, que e a assinatura do defeito.
        expect(secoes.layers.some((l) => l.id === 'default')).toBe(false);
    });

    it('mapa NAO visitado: os dois grupos do disco entram no arquivo', async () => {
        await semearDisco();
        exigirMemoriaNaoHidratada(MAPA_GUARDADO);

        const { secoes, erros } = await coletarSecoes(MAPA_GUARDADO);

        expect(erros.groups).toBeUndefined();

        // Com a fonte errada a secao inteira SUMIA (o `{}` da memoria vazia reprova o
        // predicado), entao a presenca da chave ja e metade da medida.
        expect(secoes).toHaveProperty('groups');
        expect(Object.keys(secoes.groups)).toHaveLength(GRUPOS_NO_DISCO);
        expect(Object.keys(secoes.groups).sort()).toEqual(['grupo-a', 'grupo-b']);
        expect(secoes.groups['grupo-a'].name).toBe('Escalao Avancado');
        // OBJETO chaveado por id, que e o que o importador espera; nunca um `Map`.
        expect(secoes.groups).not.toBeInstanceOf(Map);
    });

    it('CONTROLE: mapa que de fato nao tem nada sai com UMA camada e sem secao de grupos', async () => {
        await semearDisco();
        exigirMemoriaNaoHidratada(MAPA_VAZIO);

        const { secoes, erros } = await coletarSecoes(MAPA_VAZIO);

        expect(erros.layers).toBeUndefined();
        expect(erros.groups).toBeUndefined();

        // Este e o desfecho que a versao defeituosa dava a TODO mapa nao visitado. Que ele
        // continue valendo AQUI, e so aqui, e o que prova que os dois casos acima mediram o
        // disco e nao um retorno qualquer.
        expect(secoes.layers).toHaveLength(1);
        expect(secoes.layers[0].id).toBe('default');
        expect(secoes).not.toHaveProperty('groups');
    });

    it('CONTROLE NEGATIVO: com a fonte de MEMORIA o mesmo cenario perde tudo', async () => {
        // O controle negativo canonico seria reverter o fonte e ver isto vermelho. Aqui ele e
        // feito SEM tocar em `export-optional-sections.js`: a tabela REAL e obtida como sempre e
        // so o `fn` das duas secoes e trocado pelos getters SINCRONOS que a versao defeituosa
        // chamava. O predicado, o `transform` e o laco continuam sendo os de verdade, entao o
        // que muda entre este caso e os de cima e uma coisa so: a FONTE.
        await semearDisco();
        exigirMemoriaNaoHidratada(MAPA_GUARDADO);

        const barril = await import('@store');
        const fonteDeMemoria = {
            groups: () => barril.getMapGroups(MAPA_GUARDADO),
            layers: () => barril.getLayers(MAPA_GUARDADO)
        };
        const tabelaAntiga = optionalSectionTasks(MAPA_GUARDADO).map((t) => (
            fonteDeMemoria[t.key] ? { ...t, fn: fonteDeMemoria[t.key] } : t
        ));

        const secoes = {};
        for (const { key, fn, check, transform } of tabelaAntiga) {
            try {
                const value = await fn();
                if (check(value)) secoes[key] = transform ? transform(value) : value;
            } catch {
                // mesma tolerancia por secao do exportador
            }
        }

        // A perda, medida: uma camada `default` que ninguem criou, no lugar das sete do disco.
        expect(secoes.layers).toHaveLength(1);
        expect(secoes.layers[0].id).toBe('default');
        // E a secao de grupos simplesmente nao existe.
        expect(secoes).not.toHaveProperty('groups');
    });

    it('os dois mapas sao lidos na MESMA sessao e nao se contaminam', async () => {
        // A leitura de um mapa nao pode aquecer nada que responda pelo outro: foi um cache com
        // vida maior que a pergunta que produziu o defeito original.
        await semearDisco();

        exigirMemoriaNaoHidratada(MAPA_GUARDADO);
        const guardado = await coletarSecoes(MAPA_GUARDADO);
        const vazio = await coletarSecoes(MAPA_VAZIO);

        expect(guardado.secoes.layers).toHaveLength(CAMADAS_NO_DISCO);
        expect(Object.keys(guardado.secoes.groups)).toHaveLength(GRUPOS_NO_DISCO);
        expect(vazio.secoes.layers).toHaveLength(1);
        expect(vazio.secoes).not.toHaveProperty('groups');
    });
});
