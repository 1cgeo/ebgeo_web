// Path: tests/unit/nome-do-atlas-local-no-menu-da-conta.test.js

/**
 * @fileoverview O selo "Atlas atual" do menu da conta, quando o atlas montado e LOCAL.
 *
 * O DEFEITO, MEDIDO NO NAVEGADOR EM 2026-09-07 (achado D6 da bancada escalada). O degrau 3.0
 * passou a gravar o nome do usuario nas duas casas do disco, e o cartao de "Seus atlas" o mostra;
 * a tela do MAPA, nao. Uma varredura do DOM inteiro da pagina do mapa nao achava o nome em
 * elemento nenhum, visivel ou escondido, e abrir o menu da conta devolvia o selo `account-atlas`
 * com a legenda "Atlas atual" e o nome VAZIO. A causa estava na primeira linha de
 * `_renderAtlasName` (`account/account.control.js`): a ausencia de `syncEngine.atlasId` escondia o
 * rotulo, e um atlas LOCAL nao tem `syncEngine.atlasId` nenhum. Quem renomeou o acervo so via o
 * nome novo indo ate "Seus atlas".
 *
 * A POPULACAO NAO E MARGINAL. O menu da conta so abre com sessao viva (`_openMenu` sai cedo sem
 * ela), e um usuario LOGADO que ainda nao abriu atlas de servidor esta exatamente neste caso: e o
 * estado de quem entra na conta e continua trabalhando no acervo do proprio navegador.
 *
 * O INSUMO E O REGISTRO DE VERDADE. `initLocalAtlases` e `renameLocalAtlas` rodam sobre
 * `fake-indexeddb`, e o nome que o selo mostra tem de ser o que ficou no disco; um dublê de
 * registro devolveria o nome que ele mesmo foi mandado devolver.
 *
 * O DOM E DE MENTIRA, e nao ha alternativa: a suite roda em `node`, sem `document`. Os tres
 * elementos do selo sao objetos com `textContent`, `hidden` e `setAttribute`, que e a superficie
 * inteira que `_applyAtlasName` toca. O que este arquivo mede e a DECISAO (qual nome, visivel ou
 * escondido, com selo de permissao ou sem), nunca a renderizacao.
 *
 * OS CONTROLES SAO OS DOIS LADOS QUE NAO PODEM TER MEXIDO: o atlas de SERVIDOR continua sendo
 * nomeado pela lista de projetos e continua trazendo o nivel de permissao, e a instalacao SEM
 * registro nenhum continua com o rotulo escondido, sem lancar.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** O que `_applyAtlasName` toca num elemento, e nada mais. */
function elemento() {
    return {
        textContent: '',
        hidden: false,
        atributos: {},
        setAttribute(chave, valor) { this.atributos[chave] = valor; }
    };
}

/**
 * Um `AccountControl` com o selo montado a mao. `onAdd` nunca roda (ele precisa de `document`),
 * entao os tres elementos que ele criaria entram aqui.
 * @param {Object} conta - O modulo `account.control.js` ja carregado.
 * @returns {{control: Object, rotulo: Object, nome: Object, nivel: Object}}
 */
function controleComSelo(conta) {
    const control = new conta.AccountControl();
    const rotulo = elemento();
    const nome = elemento();
    const nivel = elemento();
    control._atlasLabel = rotulo;
    control._atlasNameEl = nome;
    control._atlasLevelEl = nivel;
    return { control, rotulo, nome, nivel };
}

/** O nome que o usuario deu ao acervo dele, e que o degrau 3.0 preserva. */
const NOME_DO_SLOT = 'Atlas do 1 CGEO';

/** Um atlas de SERVIDOR, para o controle. */
const ATLAS_DE_SERVIDOR = 'aaaaaaaa-1111-4222-8333-444444444444';

let conta;
let api;
let ns;

beforeEach(async () => {
    // O banco global guarda o registro, e o modulo guarda um espelho dele: sem apagar os dois,
    // um caso herda a lista do anterior e o controle "sem registro nenhum" deixa de existir.
    const anterior = await import('@store/atlas-namespace.js');
    await anterior.getGlobalStore().clear();
    vi.resetModules();

    ns = await import('@store/atlas-namespace.js');
    api = await import('@store/local-atlas.api.js');
    conta = await import('@js/account/account.control.js');
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('atlas LOCAL montado: o mapa nomeia o acervo', () => {
    beforeEach(async () => {
        await api.initLocalAtlases({ origin: { kind: 'local', atlasId: null } });
        await api.renameLocalAtlas(api.getCurrentLocalAtlasId(), NOME_DO_SLOT);
    });

    it('a premissa: o nome esta no registro, e nao ha atlas de servidor montado', async () => {
        // Sem esta linha, os casos abaixo poderiam medir um registro vazio e passar por outro
        // motivo. E o `atlasId` ausente e a condicao que o defeito lia como "nao ha atlas".
        expect(api.getLocalAtlas(api.getCurrentLocalAtlasId()).name).toBe(NOME_DO_SLOT);
        const { syncEngine } = await import('@store/sync/sync-engine.js');
        expect(syncEngine.atlasId).toBeNull();
    });

    it('o rotulo fica VISIVEL, com o nome do slot local', async () => {
        const { control, rotulo, nome } = controleComSelo(conta);

        await control._renderAtlasName();

        expect(rotulo.hidden).toBe(false);
        expect(nome.textContent).toBe(NOME_DO_SLOT);
        expect(nome.atributos.title).toBe(NOME_DO_SLOT);
    });

    it('e SEM selo de permissao: o eixo de permissao e do servidor', async () => {
        // Um selo dizendo "Proprietario" sobre um atlas que so existe neste navegador afirmaria
        // uma concessao que ninguem fez.
        const { control, nivel } = controleComSelo(conta);

        await control._renderAtlasName();

        expect(nivel.textContent).toBe('');
        expect(nivel.hidden).toBe(true);
    });

    it('o nome ACOMPANHA a renomeacao, porque a leitura e do registro e nao de um cache', async () => {
        const { control, nome } = controleComSelo(conta);
        await control._renderAtlasName();
        expect(nome.textContent).toBe(NOME_DO_SLOT);

        await api.renameLocalAtlas(api.getCurrentLocalAtlasId(), 'Operação Alfa');
        await control._renderAtlasName();

        expect(nome.textContent).toBe('Operação Alfa');
    });
});

describe('os controles: o que o conserto NAO pode ter mexido', () => {
    it('(a) atlas de SERVIDOR montado: nome da lista de projetos e o nivel de permissao', async () => {
        await api.initLocalAtlases({ origin: { kind: 'local', atlasId: null } });
        await api.renameLocalAtlas(api.getCurrentLocalAtlasId(), NOME_DO_SLOT);
        const { syncEngine } = await import('@store/sync/sync-engine.js');
        const { apiClient } = await import('@store/sync/api-client.js');
        syncEngine._atlasId = ATLAS_DE_SERVIDOR;
        const lista = vi.spyOn(apiClient, 'listAtlas').mockResolvedValue([
            { id: ATLAS_DE_SERVIDOR, name: 'Operação Bravo', user_permission: 'owner' }
        ]);

        const { control, rotulo, nome, nivel } = controleComSelo(conta);
        await control._renderAtlasName();

        expect(lista).toHaveBeenCalledTimes(1);
        expect(rotulo.hidden).toBe(false);
        // O nome do SERVIDOR, nunca o do slot local, mesmo com um slot local nomeado no disco.
        expect(nome.textContent).toBe('Operação Bravo');
        expect(nome.textContent).not.toBe(NOME_DO_SLOT);
        expect(nivel.hidden).toBe(false);
        expect(nivel.textContent).not.toBe('');

        syncEngine._atlasId = null;
    });

    it('(b) sem registro nenhum: o rotulo fica ESCONDIDO, e nada e lancado', async () => {
        // A instalacao que boota sem passar pelo registro (as paginas sem mapa). `initLocalAtlases`
        // NAO roda neste caso, de proposito.
        expect(api.getCurrentLocalAtlasId()).toBeNull();
        const { control, rotulo, nome } = controleComSelo(conta);

        await expect(control._renderAtlasName()).resolves.toBeUndefined();

        expect(rotulo.hidden).toBe(true);
        expect(nome.textContent).toBe('');
    });

    it('(c) registro ILEGIVEL: o rotulo esconde em vez de derrubar o menu', async () => {
        // `getLocalAtlas` passa por `requireEntries()`, que LANCA quando nenhum boot carregou o
        // registro. O menu da conta e a unica porta para sair da conta, para a administracao e
        // para o compartilhamento: derruba-lo por causa de um selo seria caro.
        await api.initLocalAtlases({ origin: { kind: 'local', atlasId: null } });
        const { control, rotulo } = controleComSelo(conta);
        vi.spyOn(api, 'getLocalAtlas').mockImplementation(() => {
            throw new Error('local-atlas.api: registry not loaded');
        });

        await expect(control._renderAtlasName()).resolves.toBeUndefined();

        expect(rotulo.hidden).toBe(true);
    });

    it('(d) o banco global e mesmo a fonte: o registro de slots existe no disco', async () => {
        // Controle do INSTRUMENTO. Sem ele, um `initLocalAtlases` que nao escrevesse nada deixaria
        // os casos acima verdes por um motivo que nao e o deles.
        await api.initLocalAtlases({ origin: { kind: 'local', atlasId: null } });
        const id = api.getCurrentLocalAtlasId();
        await api.renameLocalAtlas(id, NOME_DO_SLOT);

        const gravado = await ns.getGlobalStore().getItem(ns.localAtlasRegistryKey(id));

        expect(gravado).toMatchObject({ name: NOME_DO_SLOT });
    });
});
