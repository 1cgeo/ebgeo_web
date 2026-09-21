// Path: tests/unit/contagem-de-cores-nao-sincroniza.test.js
//
// A CONTAGEM DE CORES NÃO ATRAVESSA MAIS O SYNC (decisão do dono, 2026-09-21).
//
// O DEFEITO, conferido por leitura e não inferido: ela tinha DUAS chaves que nunca se entendiam.
// `setColorUsageCompat` gravava o disco sob a chave RESOLVIDA (`color_usage_<uuid>` sempre que o
// `mapResolver` estivesse de pé) e, na linha seguinte, sincronizava com o NOME do mapa
// (`logAtlasSetting({ colorUsage: { [mapNameOrId]: ... } })`). Do outro lado, o retrato e a op
// remota regravavam `color_usage_<nome>`. O leitor procura a chave por id primeiro: achando-a,
// IGNORA a por nome (a atualização do colega nunca chegava a quem já tinha a sua); não achando,
// MIGRA a por nome para o id e a APAGA, e o retrato seguinte a recriava. Vaivém sem fim, e o mapa
// renomeado ou excluído deixava o nome velho em `atlas.settings.colorUsage` para sempre, porque o
// servidor mescla e nunca poda.
//
// POR QUE PODAR EM VEZ DE CHAVEAR POR ID (a alternativa recusada): o dado é DERIVADO.
// `updateColorUsage` soma e subtrai a cada mudança de cor de feição e `performInitialColorAnalysis`
// o recalcula do zero quando falta, os dois em `store/store-state-manager.js`. Chavear por id
// consertaria o vaivém e manteria em trânsito um número que cada cliente já sabe calcular das
// feições que ele de qualquer forma recebe.
//
// O QUE ESTE ARQUIVO MEDE, e é a metade de SAÍDA: gravar a contagem continua gravando a chave
// local, e não enfileira mais op de ajuste nenhuma. A metade de ENTRADA (retrato com `colorUsage`
// não cria `color_usage_<nome>`) está em `tests/integration/remote-app-state-setting.test.js`,
// junto do irmão `mapBadgeColors`, que CONTINUA sincronizando porque não é derivado: é escolha do
// usuário.
//
// O QUE UM VERDE AQUI NÃO PROVA: nada sobre o servidor (quem cobra a recusa que não pode existir é
// `backend/tests/integration/sync-atlas-settings-app-state.test.js`) e nada sobre o `.ebgeo`, que
// CONTINUA levando a seção, porque é arquivo e não sync.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    /** O disco: chave de setting -> valor. */
    settings: new Map(),
    /** O que `_resolveSettingsKey` devolve; `null` = o resolvedor não está de pé. */
    idResolvido: null,
    logAtlasSetting: vi.fn(),
}));

// O repositório inteiro é um dublê: `getRepository()` devolve `localRepository` sem validar nada,
// então trocar o módulo basta e o grafo do localforage não sobe.
vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: {
        saveSetting: vi.fn(async (k, v) => { h.settings.set(k, v); }),
        getSetting: vi.fn(async (k) => (h.settings.has(k) ? h.settings.get(k) : null)),
        deleteSetting: vi.fn(async (k) => { h.settings.delete(k); }),
    },
    LocalRepository: class {},
    getEmptyMapData: () => ({ features: {} }),
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        get isInitialized() { return h.idResolvido !== null; },
        resolveToId: () => h.idResolvido,
    },
}));

// A ÚNICA porta de saída que esta escrita já teve. O dublê existe para que o controle negativo
// (restaurar a chamada) tenha ONDE cair: sem ele, reverter o conserto faria o teste falhar por
// erro de import, que é vermelho pelo motivo errado.
vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    logAtlasSetting: (...args) => h.logAtlasSetting(...args),
}));

import { setColorUsageCompat, getColorUsageCompat } from '../../src/js/store/repositories/index.js';

const NOME = 'Mapa Colorido';
const UUID = '11111111-2222-4333-8444-555555555555';
/** Absolutas, para que um `{}` não possa passar por sucesso. */
const CONTAGENS = { '#FF0000': 3, '#00FF00': 1 };

beforeEach(() => {
    h.settings.clear();
    h.idResolvido = UUID;
    h.logAtlasSetting.mockClear();
});

describe('contagem de cores: a saída não sincroniza', () => {
    it('PREMISSA: a chave local é a RESOLVIDA, e ela difere do nome', async () => {
        // Sem esta premissa o resto não mede nada: com mapa keyado pelo NOME as duas chaves
        // coincidem e a divergência que causou o defeito não existiria.
        await setColorUsageCompat(NOME, CONTAGENS);

        expect(h.settings.get(`color_usage_${UUID}`)).toEqual(CONTAGENS);
        expect(h.settings.has(`color_usage_${NOME}`)).toBe(false);
    });

    it('gravar a contagem num atlas remoto NÃO enfileira op de ajuste com `colorUsage`', async () => {
        await setColorUsageCompat(NOME, CONTAGENS);

        // A asserção é sobre a PORTA, não sobre a forma do payload: qualquer chamada a
        // `logAtlasSetting` vinda daqui é a sincronização de volta.
        expect(h.logAtlasSetting).not.toHaveBeenCalled();
    });

    it('e continua gravando a chave local: o conserto podou o sync, não a escrita', async () => {
        await setColorUsageCompat(NOME, CONTAGENS);

        // Sem este caso, um `setColorUsageCompat` vazio passaria verde no caso acima.
        expect(await getColorUsageCompat(NOME)).toEqual(CONTAGENS);
    });

    it('BORDA: contagem vazia também grava, e também não enfileira nada', async () => {
        // O zero é um estado legítimo (mapa cujas feições perderam a cor), e é justamente ele que
        // o boot de um leitor gravava, prendendo a fila daquele cliente.
        await setColorUsageCompat(NOME, {});

        expect(h.settings.get(`color_usage_${UUID}`)).toEqual({});
        expect(h.logAtlasSetting).not.toHaveBeenCalled();
    });

    it('BORDA: sem resolvedor de pé, a chave é o nome cru, e continua sem sincronizar', async () => {
        h.idResolvido = null;

        await setColorUsageCompat(NOME, CONTAGENS);

        expect(h.settings.get(`color_usage_${NOME}`)).toEqual(CONTAGENS);
        expect(h.logAtlasSetting).not.toHaveBeenCalled();
    });

    it('a SEMENTE legada continua sendo migrada: chave por nome vira chave por id e some', async () => {
        // É o que faz o retrato ANTIGO, já gravado no disco de quem usa o produto, continuar
        // servindo de ponto de partida depois da poda: o leitor a adota uma vez e a apaga, e agora
        // nada a recria, que é o fim do vaivém.
        h.settings.set(`color_usage_${NOME}`, CONTAGENS);

        expect(await getColorUsageCompat(NOME)).toEqual(CONTAGENS);
        expect(h.settings.get(`color_usage_${UUID}`)).toEqual(CONTAGENS);
        expect(h.settings.has(`color_usage_${NOME}`)).toBe(false);
    });
});
