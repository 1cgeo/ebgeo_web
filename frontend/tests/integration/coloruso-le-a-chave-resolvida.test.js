// Path: tests/integration/coloruso-le-a-chave-resolvida.test.js
//
// O `colorUsage` DO BARRIL LE A CHAVE QUE O ESCRITOR GRAVOU.
//
// O DEFEITO, medido em 2026-09-01 e nao inferido. `store.js` exportava como `getColorUsage` o
// irmao de `repository.js`, que montava a chave com o NOME cru (`color_usage_${mapName}`). Quem
// GRAVA e `setColorUsageCompat`, que monta a chave RESOLVIDA por `_resolveSettingsKey`, isto e,
// o UUID sempre que `mapResolver` esta de pe e o mapa e keyado por UUID. Os dois batem no MESMO
// store de settings, entao a divergencia era so a string:
//
//     gravado sob `color_usage_<uuid>`   ->   {"#FF0000":3,"#00FF00":1}
//     lido    sob `color_usage_<nome>`   ->   null, e o getter devolvia {}
//
// Resultado: a secao `colorUsage` sumia do `.ebgeo` e do envio ao servidor para TODO mapa de
// chave UUID, que e todo mapa de atlas sincronizado ou importado de `.ebgeo`. Os dois
// consumidores do barril eram a tabela de secoes opcionais (`export-optional-sections.js`) e a
// duplicacao de mapa (`map.manager.js`).
//
// POR QUE O MAPA PRECISA NASCER POR `addMap`, e nao por `createMapCompat`: e `addMap` que keya
// por UUID quando o log de operacoes esta ligado, que e o que `initServices` faz no boot. Um
// mapa keyado pelo NOME faz `_resolveSettingsKey` devolver o proprio nome, as duas chaves
// coincidem e o defeito NAO aparece. Ou seja, um teste montado do jeito mais obvio passaria
// verde sobre o codigo defeituoso, e e por isso que o primeiro caso assere que a chave
// resolvida DIFERE do nome antes de medir qualquer outra coisa.
//
// GRAVIDADE, dita por honestidade: `colorUsage` alimenta as amostras de cores frequentes do
// seletor de cor (`getFrequentColors` -> `tool_manager/helpers/color-picker.helpers.js`). E
// conveniencia de UI, recomputavel a partir das feicoes, nao conteudo de mapa. O defeito nao
// perdia feicao nenhuma.
//
// O QUE UM VERDE AQUI NAO PROVA: que o exportador chame este getter (quem cobra a fiacao da
// tabela e `tests/unit/export-optional-map-data.test.js`), nem nada sobre a duplicacao de mapa,
// que consome o mesmo simbolo por outro caminho.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetIndexedDB } from '../helpers/idb-helpers.js';

// O toast e a unica porta de UI que o grafo do store abre em node.
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

const NOME = 'Mapa Colorido';
/** As contagens gravadas. Absolutas, para que um `{}` nao possa passar por sucesso. */
const CONTAGENS = { '#FF0000': 3, '#00FF00': 1 };

let addMap;
let getColorUsageDoBarril;
let setColorUsageCompat;
let getRepository;
let mapResolver;

/** Teto de preparo: a primeira rodada paga a transformacao do grafo do store inteiro. */
const TETO_DE_PREPARO_MS = 60000;

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await resetIndexedDB();
    globalThis.localStorage.clear();

    const servicos = await import('@store/services.js');
    const resolverSvc = await import('@store/services/map-resolver.service.js');
    // Os servicos sobem como no produto: e com o log de operacoes LIGADO que `addMap` keya por
    // UUID, que e a condicao sem a qual o defeito nao existe.
    servicos.initServices();
    await resolverSvc.awaitMapResolverReady();
    mapResolver = resolverSvc.mapResolver;

    const repos = await import('@store/repositories/index.js');
    setColorUsageCompat = repos.setColorUsageCompat;
    getRepository = repos.getRepository;

    const barril = await import('@store');
    addMap = barril.addMap;
    getColorUsageDoBarril = barril.getColorUsage;
}, TETO_DE_PREPARO_MS);

describe('colorUsage: o barril le a chave que o escritor gravou', () => {
    it('PREMISSA: o mapa nasce keyado por UUID, e a chave resolvida difere do nome', async () => {
        await addMap(NOME, { features: {} });
        const chaves = await getRepository().getAllMapIds();
        const resolvido = mapResolver.resolveToId(NOME);

        // Sem esta premissa o resto do arquivo nao mede nada: com mapa keyado por nome as duas
        // chaves coincidem e o codigo defeituoso passaria verde.
        expect(chaves).toHaveLength(1);
        expect(chaves[0]).not.toBe(NOME);
        expect(resolvido).toBe(chaves[0]);
        expect(resolvido).not.toBe(NOME);
    });

    it('o escritor grava sob a chave RESOLVIDA, e nao sob o nome', async () => {
        await addMap(NOME, { features: {} });
        await setColorUsageCompat(NOME, CONTAGENS);

        const repo = getRepository();
        const resolvido = mapResolver.resolveToId(NOME);
        // As duas leituras cruas, para que o teste diga ONDE o dado esta e nao apenas que o
        // getter funciona. Foi esta assimetria que produziu o defeito.
        expect(await repo.getSetting(`color_usage_${resolvido}`)).toEqual(CONTAGENS);
        expect(await repo.getSetting(`color_usage_${NOME}`)).toBeNull();
    });

    it('o getter do barril acha o que foi gravado', async () => {
        await addMap(NOME, { features: {} });
        await setColorUsageCompat(NOME, CONTAGENS);

        // ABSOLUTO: com o leitor cru isto devolvia `{}`, que e bem-formado e passaria por
        // qualquer assercao de forma.
        expect(await getColorUsageDoBarril(NOME)).toEqual(CONTAGENS);
    });

    it('CONTROLE: mapa sem cor nenhuma devolve objeto vazio, e nao explode', async () => {
        await addMap(NOME, { features: {} });
        // Sem este caso nao da para distinguir "achou o dado" de "devolve sempre alguma coisa":
        // o vazio precisa continuar sendo vazio.
        expect(await getColorUsageDoBarril(NOME)).toEqual({});
    });

    it('CONTROLE: mapa que nao existe devolve vazio em vez de lancar', async () => {
        expect(await getColorUsageDoBarril('Mapa Que Nao Existe')).toEqual({});
    });
});
