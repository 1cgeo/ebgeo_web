// Path: tests/integration/mapa-semeado-sem-nome.repro.test.js

/**
 * O MAPA EM BRANCO DO BOOT É GRAVADO SEM `name`, E ISSO É O CONTRATO, NÃO UM DEFEITO.
 *
 * O SINTOMA, medido em 2026-09-21: o caso "additive image-write failure preserves the old atlas"
 * de `tests/e2e-ui/atomic-import.spec.js` reprovava com `['Principal', 'Principal_1']` recebido
 * como `[undefined, 'Principal_1']`. Ele lia `map.name` de cada documento cru de `ebgeo_maps`, e o
 * documento do mapa `Principal` não tem esse campo.
 *
 * A CAUSA, achada por `git bisect` sobre 89 commits (7 passos, o caso rodando em série com
 * `--retries=0`): o primeiro ruim é `543c9e37` ("base layer and temporal switch become the
 * person's view", 2026-09-20). Até ele, ENTRAR num mapa persistia o mapa base de recuo no
 * documento, e essa gravação passava por `LocalRepository.saveMap`, que carimba
 * `name: data.name || mapIdOrName`. Ou seja, o `name` do mapa semeado nunca foi escrito pelo
 * semeador: ele era efeito colateral de uma escrita que o produto deixou de fazer, com razão.
 * `07278ef6` (o commit que criou o caso, 2026-09-19) passa; `543c9e37` reprova.
 *
 * POR QUE O CONSERTO FOI NO SPEC E NÃO NO SEMEADOR. Num registro chaveado por NOME a chave É o
 * nome, e essa é a regra do produto, escrita depois de uma perda medida em 2026-09-07 (preferir
 * `data.name` à chave fez treze de catorze mapas colidirem numa entrada só no envio ao servidor;
 * ver `nomeDoMapa` em `src/js/projects/send-local-to-server.service.js`). Todo leitor de nome
 * resolve assim, e nenhum quebra com o campo ausente:
 *
 *   - `getAllMapNamesStore` (`store/map.operations.js`): `mapResolver.resolveToName(key) || key`;
 *   - `nomeDoMapa` (`projects/send-local-to-server.service.js`): a chave vence quando não é um id;
 *   - `prepare-additive-scope.js` e `prepare-ebgeo-scope.js`: `isValidId(key) ? map.name || key : key`;
 *   - `renameMap` e `deleteMap` (`store/repositories/local.repository.js`): `mapData.name || resolvedKey`;
 *   - `mapResolver.initialize` (`store/services/map-resolver.service.js`): `doc.name || chave`, e o
 *     cabeçalho de lá diz por extenso que "um documento de mapa pode chegar sem `name`";
 *   - `resolveRequestedLocalMap` (`store/map.operations.js`): `data.name ?? key`;
 *   - `countAtlasContents`, o `.ebgeo` e a aba de mapas não leem o campo.
 *
 * Medido no navegador em 2026-09-21, depois de um import aditivo e um recarregamento: o documento
 * semeado tem as oito chaves do conteúdo vazio e nada mais, e os três leitores de nome do produto
 * (`getAllMapNamesStore`, o `data.maps` do `.ebgeo` e `buildLocalAtlasExportData`) respondem
 * `['Principal_1', 'Principal']`.
 *
 * O QUE ESTE TESTE PRENDE: a forma do registro semeado, que é o que o spec passou a NÃO depender.
 * Ele fica vermelho tanto se o semeador passar a gravar o documento completo (e aí a decisão acima
 * precisa ser relida e o spec revisto) quanto se a chave deixar de ser o nome.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** O escopo local que `getScopedStore` resolve, e a gaveta de mapas em memória. */
const gavetas = new Map();

const escopoLocal = { kind: 'local', atlasId: 'ag3-repro', dbSuffix: '' };

/**
 * A fábrica de namespace é a ÚNICA peça falseada, e ela é falseada por CIMA da real
 * (`importOriginal`): `atlas-namespace.js` publica mais de quarenta símbolos e o grafo de
 * `repository.js` alcança vários deles por caminhos que não têm nada a ver com este caso
 * (o marcador de origem, o registro de atlas, os espelhos duráveis). Uma lista escrita à mão
 * quebraria a cada símbolo novo, com "No X export is defined on the mock", que é vermelho de
 * duplo em vez de vermelho de produto. O que se troca são as três funções que decidem ONDE se
 * escreve, e nada mais.
 */
vi.mock('../../src/js/store/atlas-namespace.js', async (importOriginal) => {
    const real = await importOriginal();
    const gaveta = (id) => {
        if (!gavetas.has(id)) gavetas.set(id, new Map());
        const dados = gavetas.get(id);
        return {
            async setItem(key, value) { dados.set(key, value); return value; },
            async getItem(key) { return dados.has(key) ? dados.get(key) : null; },
            async removeItem(key) { dados.delete(key); },
            async keys() { return [...dados.keys()]; },
            async iterate(fn) { for (const [key, value] of dados) fn(value, key); }
        };
    };
    return {
        ...real,
        getStore: (id) => gaveta(id),
        getStoreFor: (id) => gaveta(id),
        getGlobalStore: () => gaveta(real.StoreName.GLOBAL),
        getActiveScope: () => escopoLocal,
        activateScope: vi.fn()
    };
});

describe('o mapa em branco do boot não carrega `name`, e a chave é o nome', () => {
    beforeEach(() => {
        gavetas.clear();
    });

    it('`seedBlankDefaultMap` grava o CONTEÚDO vazio: sem `name`, sem `id` e sem `sync`', async () => {
        const { seedBlankDefaultMap } = await import('../../src/js/store/repository.js');
        const { DEFAULT_MAP_NAME } = await import('../../src/js/store/store.constants.js');
        const { StoreName } = await import('../../src/js/store/atlas-namespace.js');

        const nome = await seedBlankDefaultMap();
        expect(nome).toBe(DEFAULT_MAP_NAME);

        const mapas = gavetas.get(StoreName.MAPS);
        // PISO: sem esta linha as três seguintes falariam sobre um registro que não existe.
        expect([...mapas.keys()]).toEqual([DEFAULT_MAP_NAME]);

        const documento = mapas.get(DEFAULT_MAP_NAME);
        expect(documento).not.toHaveProperty('name');
        expect(documento).not.toHaveProperty('id');
        expect(documento).not.toHaveProperty('sync');
        // E ele É o conteúdo vazio, que é de onde a ausência vem.
        const { getEmptyMapData: conteudo } = await import('../../src/js/store/repository.utils.js');
        expect(Object.keys(documento)).toEqual(Object.keys(conteudo()));
    });

    it('a CHAVE do registro é um nome, nunca um identificador gerado: é ela que os leitores usam', async () => {
        const { seedBlankDefaultMap } = await import('../../src/js/store/repository.js');
        const { isValidId, isValidUUID } = await import('../../src/js/utilities/uuid.js');
        const { StoreName } = await import('../../src/js/store/atlas-namespace.js');

        const nome = await seedBlankDefaultMap();
        const [chave] = [...gavetas.get(StoreName.MAPS).keys()];

        expect(chave).toBe(nome);
        // A premissa de `nomeDoMapa` e das duas varreduras de import: chave que não é id É o nome.
        expect(isValidId(chave)).toBe(false);
        expect(isValidUUID(chave)).toBe(false);
        // CONTROLE: o predicado discrimina, senão as duas linhas acima passariam com ele quebrado.
        expect(isValidId('3202b560-6d1d-4cc6-aa39-06e05ff19dcd')).toBe(true);
    });

    it('CONTRASTE: o mapa em branco do IMPORT é um documento, e carrega os três campos', async () => {
        const { getEmptyMapData: documento } = await import('../../src/js/store/repositories/local.repository.js');
        // `prepare-ebgeo-scope.js` semeia o `Principal` de um arquivo sem mapas com ESTA função,
        // e depois grava sob a chave UUID, onde o `name` é load-bearing. A assimetria entre os dois
        // semeadores é o que torna a leitura de `map.name` enganosa: ela acerta para um e não para o
        // outro, e o registro chaveado por nome não precisa dela.
        const vazio = documento();
        expect(vazio.name).toBe('Novo Mapa');
        expect(vazio).toHaveProperty('id');
        expect(vazio).toHaveProperty('sync');
    });
});
